//! `GET /visits/{id}/story` on a real database (design section 1.7): the data the doctor's device
//! renders the patient's video from. The same refusals as Send, no patient name, no link minted,
//! permissions and the cross-clinic 404.
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

async fn call(
    app: &TestApp,
    method: Method,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, ALPHA, path, Some(token), body).await
}

async fn register(app: &TestApp, token: &str, body: Value) -> String {
    let (status, made) = call(app, Method::POST, token, "/api/v1/patients", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn start_visit(app: &TestApp, token: &str, patient: &str) -> String {
    let (status, visit) = call(
        app,
        Method::POST,
        token,
        &format!("/api/v1/patients/{patient}/visits"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    visit["id"].as_str().unwrap().to_owned()
}

async fn close(app: &TestApp, token: &str, visit: &str) {
    let (status, body) = call(
        app,
        Method::POST,
        token,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

fn story_path(visit: &str) -> String {
    format!("/api/v1/visits/{visit}/story")
}

async fn refusal(app: &TestApp, token: &str, visit: &str) -> String {
    let (status, body) = call(app, Method::GET, token, &story_path(visit), None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    body["error"]["code"].as_str().unwrap().to_owned()
}

async fn links(app: &TestApp, visit: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "select count(*) from aarogyam.share_links where resource = 'visit' and encounter_id = $1",
    )
    .bind(visit.parse::<Uuid>().unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_story_is_the_mouth_with_the_visit_number_and_no_name() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(
        &app,
        &owner,
        json!({ "full_name": "Aarav Nair", "sex": "male", "age_years": 9,
                "phone": "98765 40002" }),
    )
    .await;
    let visit = start_visit(&app, &owner, &patient).await;
    let (status, body) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        Some(json!({ "visit_id": visit, "entries": [
            { "tooth": 21, "finding": "root_canal", "procedure": "root_canal",
              "material": "calcium_hydroxide", "sitting": 4, "in_progress": true,
              "note": "Child anxious" },
            { "tooth": 55, "surface": "O", "finding": "caries", "caries_depth": "dentin" }
        ] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Open: no video, like no text.
    assert_eq!(refusal(&app, &owner, &visit).await, "visit_open");
    close(&app, &owner, &visit).await;
    let before = links(&app, &visit).await;

    let (status, headers, story) = app
        .send_full(
            Method::GET,
            ALPHA,
            &story_path(&visit),
            Some(&owner),
            None,
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{story}");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(story["story_version"], 1);
    assert_eq!(story["story_version"], story["chart"]["story_version"]);
    assert!(
        story["visit_number"].as_str().unwrap().starts_with("V-"),
        "{story}"
    );
    assert_eq!(story["visited_on"].as_str().unwrap().len(), 10);
    assert!(story["clinic_name"].is_string());
    assert_ne!(story["clinic_name"], "");
    assert_eq!(story["chart"]["dentition"], "mixed");
    assert_eq!(story["chart"]["focus"][0], 21);
    let rc = story["chart"]["teeth"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["tooth"] == 21)
        .unwrap()["treatments"][0]
        .clone();
    assert_eq!(rc["steps"][1]["state"], "current");
    let text = story.to_string();
    for leaked in [
        "Aarav", "Nair", "98765", "40002", "anxious", "\"note\"", "pin",
    ] {
        assert!(!text.contains(leaked), "{leaked}: {text}");
    }
    // Mints and revokes nothing.
    assert_eq!(links(&app, &visit).await, before);

    // Another clinic gets 404; a role without clinical.read and patients.contact gets 403.
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(Method::GET, BETA, &story_path(&visit), Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = call(&app, Method::GET, &desk, &story_path(&visit), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(Method::GET, ALPHA, &story_path(&visit), None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_story_refuses_as_send_does() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);

    // No mobile, and no relative to reach.
    let no_phone = register(
        &app,
        &owner,
        json!({ "full_name": "Arjun Rao", "sex": "male", "age_years": 40 }),
    )
    .await;
    let visit = start_visit(&app, &owner, &no_phone).await;
    close(&app, &owner, &visit).await;
    assert_eq!(refusal(&app, &owner, &visit).await, "no_phone");

    // Opted out of care messages on WhatsApp.
    let opted = register(
        &app,
        &owner,
        json!({ "full_name": "Leela Mehta", "sex": "female", "age_years": 52,
                "phone": "98765 11111" }),
    )
    .await;
    let (status, saved) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/patients/{opted}/contact-preferences"),
        Some(json!({ "channel": "whatsapp", "category": "care", "opted_out": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let visit = start_visit(&app, &owner, &opted).await;
    close(&app, &owner, &visit).await;
    assert_eq!(refusal(&app, &owner, &visit).await, "opted_out");

    // Care consent withdrawn.
    let withdrawn = register(
        &app,
        &owner,
        json!({ "full_name": "Kiran Das", "sex": "male", "age_years": 29,
                "phone": "98765 22222" }),
    )
    .await;
    let (status, given) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/patients/{withdrawn}/consents"),
        Some(json!({ "purpose": "care", "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{given}");
    let (status, body) = call(
        &app,
        Method::POST,
        &owner,
        &format!(
            "/api/v1/consents/{}/withdraw",
            given["id"].as_str().unwrap()
        ),
        Some(json!({ "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let visit = start_visit(&app, &owner, &withdrawn).await;
    close(&app, &owner, &visit).await;
    assert_eq!(refusal(&app, &owner, &visit).await, "no_consent");

    // An erased patient's visit is not found.
    let erased = register(
        &app,
        &owner,
        json!({ "full_name": "Old Patient", "sex": "female", "age_years": 70,
                "phone": "98765 33333" }),
    )
    .await;
    let visit = start_visit(&app, &owner, &erased).await;
    close(&app, &owner, &visit).await;
    sqlx::query(
        "update aarogyam.patients set status = 'erased', erased_at = now(), deleted_at = now()
         where id = $1::uuid",
    )
    .bind(&erased)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, _) = call(&app, Method::GET, &owner, &story_path(&visit), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
