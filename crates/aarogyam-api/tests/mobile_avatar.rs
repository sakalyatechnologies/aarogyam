//! `PUT /me/avatar`: a staff avatar as a preset id or a photo, shown on `/session`, `/me` and
//! `/staff`, with photos read through signed links on the clinic's host.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::Value;
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt;

const BOUNDARY: &str = "aarogyam-avatar-boundary";

fn png() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(2048, 7);
    bytes
}

/// A multipart form with the given `(name, bytes)` fields; the `file` field is a file.
async fn form(
    app: &TestApp,
    host: &str,
    token: &str,
    fields: &[(&str, &[u8])],
) -> (StatusCode, Value) {
    let mut body = Vec::new();
    for (name, value) in fields {
        let file = if *name == "file" {
            "; filename=\"a.bin\""
        } else {
            ""
        };
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"{file}\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(value);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::put("/api/v1/me/avatar")
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

async fn fetch(app: &TestApp, host: &str, path: &str) -> (StatusCode, Vec<u8>) {
    let request = Request::get(path)
        .header("host", host)
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    (
        status,
        to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_member_sets_a_preset_or_photo_avatar_and_others_see_it() {
    let app = TestApp::start().await;
    let (owner, desk) = (app.token(ALPHA_OWNER), app.token(ALPHA_FRONT_DESK));
    let get = async |host: &str, path: &str, token: &str| {
        app.send(Method::GET, host, path, Some(token), None).await.1
    };

    // A preset: any member may set their own, and the owner's staff list and /me show it.
    let (status, avatar) = form(&app, ALPHA, &desk, &[("preset", b"tooth_3")]).await;
    assert_eq!(status, StatusCode::OK, "{avatar}");
    assert_eq!(avatar["preset"], "tooth_3");
    assert_eq!(avatar["photo_url"], Value::Null);
    let session = get(ALPHA, "/api/v1/session", &desk).await;
    assert_eq!(session["user"]["avatar"]["preset"], "tooth_3");
    let staff = get(ALPHA, "/api/v1/staff", &owner).await;
    let member = |staff: &Value, id: &Value| {
        staff["members"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == *id)
            .unwrap()
            .clone()
    };
    let desk_member = member(&staff, &session["membership"]["id"]);
    assert_eq!(desk_member["avatar"]["preset"], "tooth_3");
    let mine = get("app.localtest.me", "/api/v1/me", &desk).await;
    assert_eq!(mine["clinics"][0]["avatar"]["preset"], "tooth_3");

    // A photo replaces the preset, is checked by content, and is served by its signed link.
    let (status, _) = form(&app, ALPHA, &desk, &[("file", b"GIF89a-not-allowed")]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = form(&app, ALPHA, &desk, &[("preset", b"Bad Id")]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = form(&app, ALPHA, &desk, &[("preset", b"ok"), ("file", &png())]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, avatar) = form(&app, ALPHA, &desk, &[("file", &png())]).await;
    assert_eq!(status, StatusCode::OK, "{avatar}");
    assert_eq!(avatar["preset"], Value::Null);
    let url = avatar["photo_url"].as_str().unwrap().to_owned();
    assert_eq!(fetch(&app, ALPHA, &url).await, (StatusCode::OK, png()));
    let staff = get(ALPHA, "/api/v1/staff", &owner).await;
    assert!(member(&staff, &desk_member["id"])["avatar"]["photo_url"].is_string());

    // The link is clinic-bound and tamper-proof; another clinic's member can't set ours.
    assert_eq!(fetch(&app, BETA, &url).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        fetch(&app, ALPHA, &format!("{url}x")).await.0,
        StatusCode::NOT_FOUND
    );
    let beta = app.token(BETA_OWNER);
    let (status, _) = form(&app, ALPHA, &beta, &[("preset", b"tooth_3")]).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = form(&app, ALPHA, &app.token(STRANGER), &[("preset", b"tooth_3")]).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Removing it clears the avatar and the photo link stops working.
    let (status, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            "/api/v1/me/avatar",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(fetch(&app, ALPHA, &url).await.0, StatusCode::NOT_FOUND);
    let session = get(ALPHA, "/api/v1/session", &desk).await;
    assert_eq!(session["user"]["avatar"], Value::Null);
    app.finish().await;
}
