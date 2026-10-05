//! The clinic letterhead on a real database: settings validation, image upload by content,
//! signed image links, permissions, other clinics, and the public share-link page.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt;

const BOUNDARY: &str = "aarogyam-letterhead-boundary";
const SETTINGS: &str = "/api/v1/settings/clinic";

fn png(extra: usize) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(8 + extra, 7);
    bytes
}

async fn put_image(
    app: &TestApp,
    host: &str,
    token: &str,
    slot: &str,
    bytes: &[u8],
) -> (StatusCode, Value) {
    let mut body = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::put(format!("/api/v1/settings/letterhead/images/{slot}"))
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn fetch(app: &TestApp, host: &str, path: &str) -> (StatusCode, String, Vec<u8>) {
    let request = Request::get(path)
        .header("host", host)
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let kind = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, kind, bytes.to_vec())
}

async fn patch(app: &TestApp, token: &str, body: Value) -> (StatusCode, Value) {
    app.send(Method::PATCH, ALPHA, SETTINGS, Some(token), Some(body))
        .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn letterhead_settings_are_validated_and_merged() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, settings) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(settings["letterhead"]["mode"], "template");
    assert_eq!(settings["letterhead"]["template"], "classic");
    assert_eq!(settings["letterhead"]["show"]["gstin"], false);

    let (status, saved) = patch(
        &app,
        &owner,
        json!({ "letterhead": {
            "template": "modern_band", "accent": "#0f766e", "footer": "Open Mon to Sat",
            "email": "care@alpha.test", "show": { "gstin": true } } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let letterhead = &saved["letterhead"];
    assert_eq!(letterhead["template"], "modern_band");
    assert_eq!(letterhead["accent"], "#0F766E");
    assert_eq!(letterhead["show"]["gstin"], true);
    assert_eq!(letterhead["show"]["phone"], true, "unlisted flags stay");
    // Other branding survives, and so does the letterhead across a brand change.
    let (_, saved) = patch(&app, &owner, json!({ "branding": { "brand": "#112233" } })).await;
    assert_eq!(saved["branding"]["brand"], "#112233");
    assert_eq!(saved["letterhead"]["template"], "modern_band");

    for (body, field) in [
        (json!({ "mode": "paper" }), "letterhead.mode"),
        (json!({ "mode": "upload" }), "letterhead.mode"),
        (json!({ "template": "fancy" }), "letterhead.template"),
        (json!({ "accent": "teal" }), "letterhead.accent"),
        (json!({ "footer": "x".repeat(201) }), "letterhead.footer"),
        (json!({ "email": "nobody" }), "letterhead.email"),
        (json!({ "timings": "x".repeat(201) }), "letterhead.timings"),
        (
            json!({ "doctor_ids": ["0192f1c4-0000-7000-8000-000000000000"] }),
            "letterhead.doctor_ids",
        ),
    ] {
        let (status, error) = patch(&app, &owner, json!({ "letterhead": body })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{body}: {error}"
        );
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn images_are_checked_stored_and_served_through_signed_links() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let image = png(4096);

    // Only PNG or JPEG by content, at most 2 MB; settings.manage only.
    for (bytes, expected) in [
        (&b"%PDF-1.7 hello"[..], StatusCode::BAD_REQUEST),
        (&b"<svg onload=alert(1)>"[..], StatusCode::BAD_REQUEST),
        (&b""[..], StatusCode::BAD_REQUEST),
    ] {
        let (status, error) = put_image(&app, ALPHA, &owner, "letterhead", bytes).await;
        assert_eq!(status, expected, "{error}");
    }
    let too_big = png(2 * 1024 * 1024 + 1);
    let (status, _) = put_image(&app, ALPHA, &owner, "letterhead", &too_big).await;
    assert!(
        matches!(
            status,
            StatusCode::BAD_REQUEST | StatusCode::PAYLOAD_TOO_LARGE
        ),
        "{status}"
    );
    let (status, _) = put_image(&app, ALPHA, &owner, "banner", &image).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "unknown slot");
    let (status, _) = put_image(&app, ALPHA, &desk, "letterhead", &image).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, saved) = put_image(&app, ALPHA, &owner, "letterhead", &image).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["has_image"], true);
    let alpha = app.clinic_id("alpha").await;
    assert_eq!(
        std::fs::read_dir(app.files_dir.join(alpha.to_string()))
            .unwrap()
            .count(),
        1
    );
    // Upload mode needs an image; once there, it is allowed.
    let (status, saved) = patch(&app, &owner, json!({ "letterhead": { "mode": "upload" } })).await;
    assert_eq!(status, StatusCode::OK, "{saved}");

    // Printing members get the document with a signed link; the link needs no sign-in.
    let (status, document) = app
        .send(Method::GET, ALPHA, "/api/v1/letterhead", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{document}");
    assert_eq!(document["clinic"]["name"], "Alpha Dental");
    let url = document["image_url"].as_str().unwrap().to_owned();
    let (status, kind, bytes) = fetch(&app, ALPHA, &url).await;
    assert_eq!(
        (status, kind.as_str(), bytes),
        (StatusCode::OK, "image/png", image.clone())
    );
    // Another clinic's host, a tampered token and a made-up image are all 404.
    assert_eq!(fetch(&app, BETA, &url).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        fetch(&app, ALPHA, &format!("{url}x")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        fetch(
            &app,
            ALPHA,
            "/api/v1/letterhead/images/0192f1c4-0000-7000-8000-000000000000/content?token=1.2"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    // The nothing-role and other clinics get no document or upload.
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/letterhead",
            Some(&nothing),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/letterhead", Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = put_image(&app, ALPHA, &beta, "letterhead", &image).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, beta_document) = app
        .send(Method::GET, BETA, "/api/v1/letterhead", Some(&beta), None)
        .await;
    assert_eq!(beta_document["clinic"]["name"], "Beta Dental");
    assert_eq!(beta_document["image_url"], Value::Null);

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn replacing_removes_the_old_image_and_deleting_falls_back_to_the_design() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let alpha = app.clinic_id("alpha").await;
    let (status, _) = put_image(&app, ALPHA, &owner, "letterhead", &png(4096)).await;
    assert_eq!(status, StatusCode::OK);
    let (_, document) = app
        .send(Method::GET, ALPHA, "/api/v1/letterhead", Some(&owner), None)
        .await;
    assert_eq!(document["image_url"], Value::Null, "template mode hides it");
    let (status, _) = patch(&app, &owner, json!({ "letterhead": { "mode": "upload" } })).await;
    assert_eq!(status, StatusCode::OK);
    let (_, document) = app
        .send(Method::GET, ALPHA, "/api/v1/letterhead", Some(&owner), None)
        .await;
    let url = document["image_url"].as_str().unwrap().to_owned();
    // Replacing removes the old file; deleting falls back to the generated design.
    let (status, _) = put_image(&app, ALPHA, &owner, "letterhead", &png(5000)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetch(&app, ALPHA, &url).await.0, StatusCode::NOT_FOUND);
    let (status, removed) = app
        .send(
            Method::DELETE,
            ALPHA,
            "/api/v1/settings/letterhead/images/letterhead",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{removed}");
    assert_eq!(
        (&removed["has_image"], &removed["mode"]),
        (&json!(false), &json!("template"))
    );
    assert_eq!(
        std::fs::read_dir(app.files_dir.join(alpha.to_string()))
            .unwrap()
            .count(),
        0
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn doctors_with_qualifications_print_and_other_clinics_doctors_are_refused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let (status, doctor) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/practitioners",
            Some(&owner),
            Some(
                json!({ "display_name": "Dr Asha Rao", "qualifications": "BDS, MDS Orthodontics",
                         "registration_number": "A-1234" }),
            ),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{doctor}");
    assert_eq!(doctor["qualifications"], "BDS, MDS Orthodontics");
    let (status, other) = app
        .send(
            Method::POST,
            BETA,
            "/api/v1/practitioners",
            Some(&beta),
            Some(json!({ "display_name": "Dr Beta" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{other}");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/practitioners",
            Some(&owner),
            Some(json!({ "display_name": "Dr Bad", "qualifications": "x".repeat(161) })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // A doctor of another clinic cannot be put on this clinic's letterhead.
    let (status, error) = patch(
        &app,
        &owner,
        json!({ "letterhead": { "doctor_ids": [other["id"]] } }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = patch(
        &app,
        &owner,
        json!({ "letterhead": { "doctor_ids": [doctor["id"]] } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, document) = app
        .send(Method::GET, ALPHA, "/api/v1/letterhead", Some(&owner), None)
        .await;
    assert_eq!(document["doctors"].as_array().unwrap().len(), 1);
    assert_eq!(document["doctors"][0]["name"], "Dr Asha Rao");
    assert_eq!(document["doctors"][0]["registration_number"], "A-1234");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_share_link_page_gets_the_letterhead_without_a_sign_in() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&owner),
            Some(json!({ "full_name": "Rahul Verma", "sex": "male", "age_years": 40 })),
        )
        .await;
    let path = format!(
        "/api/v1/patients/{}/prescriptions",
        patient["id"].as_str().unwrap()
    );
    let (status, rx) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "items": [{ "drug_name": "Metronidazole", "dose": "1 tablet", "frequency": "1-1-1" }] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{rx}");
    let id = rx["id"].as_str().unwrap();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/prescriptions/{id}/issue"),
            Some(&owner),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, link) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/prescriptions/{id}/share"),
            Some(&owner),
            None,
        )
        .await;
    let token = link["token"].as_str().unwrap();
    put_image(&app, ALPHA, &owner, "logo", &png(1024)).await;

    let shared = format!("/api/v1/shared/{token}/letterhead");
    let (status, document) = app.send(Method::GET, ALPHA, &shared, None, None).await;
    assert_eq!(status, StatusCode::OK, "{document}");
    assert_eq!(document["clinic"]["name"], "Alpha Dental");
    let logo = document["logo_url"].as_str().unwrap();
    assert_eq!(fetch(&app, ALPHA, logo).await.0, StatusCode::OK);
    // The document holds no patient or prescription data.
    let text = document.to_string();
    assert!(
        !text.contains("Rahul") && !text.contains("Metronidazole"),
        "{text}"
    );
    // Unknown tokens and other clinics' hosts get nothing.
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/shared/not-a-token/letterhead",
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app.send(Method::GET, BETA, &shared, None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
