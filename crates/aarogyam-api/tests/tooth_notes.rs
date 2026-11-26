//! Free-text tooth notes on a real database: add then list newest first, the idempotent retry,
//! the open visit, bad input, that none of it crosses clinics, and the chart's `tooth_notes`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

async fn register(app: &TestApp, token: &str) -> String {
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": "Meera Shah" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    patient["id"].as_str().unwrap().to_owned()
}

fn path(patient: &str, tooth: i64) -> String {
    format!("/api/v1/patients/{patient}/dental-chart/teeth/{tooth}/notes")
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn notes_are_added_and_listed_newest_first() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    for text in ["  first look ", "second look"] {
        let (status, note) = app
            .send(
                Method::POST,
                ALPHA,
                &path(&patient, 36),
                Some(&owner),
                Some(json!({ "body": text })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{note}");
        assert_eq!(note["tooth"], 36);
        assert!(note.get("visit_id").is_none());
    }
    let (status, list) = app
        .send(Method::GET, ALPHA, &path(&patient, 36), Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["body"], "second look");
    assert_eq!(items[1]["body"], "first look");
    assert!(items[0]["recorded_by"].is_string());
    let (_, other) = app
        .send(Method::GET, ALPHA, &path(&patient, 37), Some(&owner), None)
        .await;
    assert_eq!(other["items"].as_array().unwrap().len(), 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_retry_returns_the_first_note_and_another_body_conflicts() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    let client_id = Uuid::now_v7();
    let post = async |body: &str| {
        app.send(
            Method::POST,
            ALPHA,
            &path(&patient, 36),
            Some(&owner),
            Some(json!({ "client_id": client_id, "body": body })),
        )
        .await
    };
    let (status, first) = post("watch the cusp").await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let (status, again) = post("watch the cusp").await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(first["id"], again["id"]);
    let (status, refused) = post("something else").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["error"]["code"], "id_conflict", "{refused}");
    let count: i64 =
        sqlx::query_scalar("select count(*) from aarogyam.tooth_notes where patient_id = $1::uuid")
            .bind(&patient)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(count, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_note_joins_the_open_visit() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    let (status, visit) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/visits"),
            Some(&owner),
            Some(json!({ "chief_complaint": "Pain lower left" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    let (status, note) = app
        .send(
            Method::POST,
            ALPHA,
            &path(&patient, 46),
            Some(&owner),
            Some(json!({ "body": "tender to percussion" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    assert_eq!(note["visit_id"], visit["id"]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bad_input_is_a_400() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    for (tooth, body) in [(36, "   "), (36, "x"), (19, "note"), (99, "note")] {
        let text = if body == "x" {
            "x".repeat(2001)
        } else {
            body.to_owned()
        };
        let (status, error) = app
            .send(
                Method::POST,
                ALPHA,
                &path(&patient, tooth),
                Some(&owner),
                Some(json!({ "body": text })),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{tooth} {error}");
    }
    let (status, _) = app
        .send(Method::GET, ALPHA, &path(&patient, 19), Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinics_patient_is_a_404() {
    let app = TestApp::start().await;
    let alpha = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, &alpha).await;
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &path(&patient, 36),
            Some(&beta),
            Some(json!({ "body": "not yours" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::GET, BETA, &path(&patient, 36), Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_chart_marks_teeth_with_their_latest_note() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    for text in ["older", "newest note"] {
        let (status, note) = app
            .send(
                Method::POST,
                ALPHA,
                &path(&patient, 24),
                Some(&owner),
                Some(json!({ "body": text })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{note}");
    }
    let (status, chart) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/dental-chart"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    let marks: &Vec<Value> = chart["tooth_notes"].as_array().unwrap();
    assert_eq!(marks.len(), 1);
    assert_eq!(marks[0]["tooth"], 24);
    assert_eq!(marks[0]["latest_note"], "newest note");
    app.finish().await;
}
