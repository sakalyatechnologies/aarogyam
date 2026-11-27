//! The visit list for the front desk: `patients.read` is enough, and the chief complaint is
//! left out when the role lacks `clinical.read`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn list(app: &TestApp, host: &str, token: &str, patient: &str) -> (StatusCode, Value) {
    app.send(
        Method::GET,
        host,
        &format!("/api/v1/patients/{patient}/visits"),
        Some(token),
        None,
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_desk_lists_visits_without_clinical_fields() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let nothing = app.token(ALPHA_NOTHING);
    let beta = app.token(BETA_OWNER);

    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&owner),
            Some(json!({ "full_name": "Meera Shah" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let patient = patient["id"].as_str().unwrap().to_owned();
    let (status, visit) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/visits"),
            Some(&owner),
            Some(json!({ "chief_complaint": "SECRET-COMPLAINT" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");

    let (status, body) = list(&app, ALPHA, &desk, &patient).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let item = &body["items"][0];
    assert_eq!(item["id"], visit["id"]);
    assert_eq!(item["status"], "open");
    assert!(item["started_at"].is_string());
    assert!(item["clinician"]["name"].is_string());
    assert!(item["chief_complaint"].is_null());
    assert!(!body.to_string().contains("SECRET-COMPLAINT"));

    let (status, body) = list(&app, ALPHA, &owner, &patient).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["items"][0]["chief_complaint"], "SECRET-COMPLAINT");

    let (status, _) = list(&app, ALPHA, &nothing, &patient).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = list(&app, BETA, &beta, &patient).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
