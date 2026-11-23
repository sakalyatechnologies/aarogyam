//! `/me/ui-prefs` on a real database: defaults, save then read, a partial update, an unknown
//! value, and per-member, per-clinic and per-role isolation.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

const PATH: &str = "/api/v1/me/ui-prefs";

async fn get(app: &TestApp, host: &str, token: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, PATH, Some(token), None).await
}

async fn put(app: &TestApp, host: &str, token: &str, body: Value) -> (StatusCode, Value) {
    app.send(Method::PUT, host, PATH, Some(token), Some(body))
        .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn ui_prefs_default_save_and_stay_per_member() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);

    let (status, first) = get(&app, ALPHA, &owner).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(
        first,
        json!({ "present_style": "story", "history_view": "page", "language": null })
    );

    let (status, saved) = put(&app, ALPHA, &owner, json!({ "present_style": "xray" })).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["present_style"], "xray");
    // A partial update keeps the other field.
    let (_, saved) = put(&app, ALPHA, &owner, json!({ "history_view": "popup" })).await;
    assert_eq!(
        saved,
        json!({ "present_style": "xray", "history_view": "popup", "language": null })
    );
    let (_, read) = get(&app, ALPHA, &owner).await;
    assert_eq!(read, saved);

    // Language: set, kept by a PUT without it, cleared by an explicit null.
    let (_, saved) = put(&app, ALPHA, &owner, json!({ "language": "hi" })).await;
    assert_eq!(saved["language"], "hi");
    let (_, saved) = put(&app, ALPHA, &owner, json!({ "present_style": "xray" })).await;
    assert_eq!(saved["language"], "hi");
    let (_, saved) = put(&app, ALPHA, &owner, json!({ "language": null })).await;
    assert_eq!(saved["language"], Value::Null);
    let (_, saved) = put(&app, ALPHA, &owner, json!({ "language": "mr" })).await;
    assert_eq!(saved["language"], "mr");
    let (_, saved) = put(&app, ALPHA, &owner, json!({ "language": null })).await;
    assert_eq!(saved["language"], Value::Null);

    for bad in [
        json!({ "language": "fr" }),
        json!({ "present_style": "nope" }),
        json!({ "history_view": "x" }),
    ] {
        let (status, _) = put(&app, ALPHA, &owner, bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (_, read) = get(&app, ALPHA, &owner).await;
    assert_eq!(read["present_style"], "xray");

    // Another member of the clinic, and another clinic, keep their own defaults.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, theirs) = get(&app, ALPHA, &assistant).await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["present_style"], "story");
    let beta = app.token(BETA_OWNER);
    let (status, theirs) = get(&app, BETA, &beta).await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["present_style"], "story");

    // Clinic B's member on clinic A's host is a 404, and a PUT there never touches A's row.
    let (status, _) = get(&app, ALPHA, &beta).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = put(&app, ALPHA, &beta, json!({ "present_style": "face" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, read) = get(&app, ALPHA, &owner).await;
    assert_eq!(read["present_style"], "xray");

    // A role without clinical.read is refused.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = get(&app, ALPHA, &desk).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = put(&app, ALPHA, &desk, json!({ "present_style": "face" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
