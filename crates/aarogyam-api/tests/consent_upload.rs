//! The desk that registers a walk-in (`patients.write`, no clinical access) uploads the intake
//! signature as a file of kind `consent` and links it to the consent; every other kind still
//! needs `clinical.write`, and the desk still lists no clinical files.
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
use tower::ServiceExt as _;

const BOUNDARY: &str = "aarogyam-consent-boundary";

async fn upload(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    fields: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut png = vec![0x89_u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    png.extend_from_slice(&[5_u8; 512]);
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sign.png\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(&png);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::post(format!("/api/v1/patients/{patient}/attachments"))
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

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_desk_uploads_a_consent_signature_and_links_it() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let nothing = app.token(ALPHA_NOTHING);
    let beta = app.token(BETA_OWNER);
    let (status, meera) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&owner),
            Some(json!({ "full_name": "Meera Shah" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{meera}");
    let meera = meera["id"].as_str().unwrap().to_owned();
    let (status, consent) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{meera}/consents"),
            Some(&desk),
            Some(json!({ "purpose": "care", "notice_version": "v1", "method": "paper" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{consent}");
    let consent = consent["id"].as_str().unwrap().to_owned();

    // Only a consent form: a photo still needs clinical.write, and a role with nothing is out.
    let (status, _) = upload(&app, ALPHA, &desk, &meera, &[("kind", "photo")]).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = upload(&app, ALPHA, &nothing, &meera, &[("kind", "consent")]).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // A desk consent form is not linked to a clinical note.
    let note = uuid::Uuid::now_v7().to_string();
    let (status, body) = upload(
        &app,
        ALPHA,
        &desk,
        &meera,
        &[("kind", "consent"), ("note_id", &note)],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    // Another clinic's patient is not found.
    let (status, _) = upload(&app, BETA, &beta, &meera, &[("kind", "consent")]).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, file) = upload(&app, ALPHA, &desk, &meera, &[("kind", "consent")]).await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    assert_eq!(file["kind"], "consent");
    let file = file["id"].as_str().unwrap().to_owned();

    // The desk links it to the consent (G10), as the phone does after the walk-in.
    let (status, signed) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/patients/{meera}/consents/{consent}/signature"),
            Some(&desk),
            Some(json!({ "signature_attachment_id": file })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["signature_attachment_id"], file.as_str());

    // Listing and downloading stay as they were: the desk sees no consent or clinical file.
    let (status, files) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{meera}/attachments"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{files}");
    assert_eq!(files["items"].as_array().map(Vec::len), Some(0), "{files}");
}
