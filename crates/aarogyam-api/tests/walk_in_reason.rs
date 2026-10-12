//! The reason for a visit on a walk-in: optional, trimmed, at most 200 characters, returned
//! wherever a queue token is, masked in the change history and cleared on erasure.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "one test walks the reason through every place a token is returned"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), Some(body))
        .await
}

async fn patient(app: &TestApp, token: &str) -> String {
    let (status, made) = post(
        app,
        ALPHA,
        token,
        "/api/v1/patients",
        json!({ "full_name": "Ravi K" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_walk_in_reason_round_trips_and_is_optional() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let ravi = patient(&app, &owner).await;
    let sita = patient(&app, &owner).await;
    let omar = patient(&app, &owner).await;

    // POST /queue: trimmed, returned on the token.
    let (code, token) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/queue",
        json!({ "patient_id": ravi, "reason": "  Toothache  " }),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{token}");
    assert_eq!(token["reason"], "Toothache");

    // POST /walk-ins: the token it returns carries it; blank means none; absent means none.
    let (code, walk) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/walk-ins",
        json!({ "patient_id": sita, "reason": "Check-up" }),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{walk}");
    assert_eq!(walk["token"]["reason"], "Check-up");
    let (_, blank) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/walk-ins",
        json!({ "patient_id": omar, "reason": "   " }),
    )
    .await;
    assert_eq!(blank["token"]["reason"], Value::Null);
    let (code, none) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/queue",
        json!({ "patient_id": omar }),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{none}");
    assert_eq!(none["reason"], Value::Null);

    // GET /queue and /today show it.
    let (_, queue) = app
        .send(Method::GET, ALPHA, "/api/v1/queue", Some(&owner), None)
        .await;
    let reasons: Vec<&Value> = queue["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| &t["reason"])
        .collect();
    assert_eq!(
        reasons,
        [
            &json!("Toothache"),
            &json!("Check-up"),
            &Value::Null,
            &Value::Null
        ]
    );
    let (_, today) = app
        .send(Method::GET, ALPHA, "/api/v1/today", Some(&owner), None)
        .await;
    let shown: Vec<&str> = today["recent_patients"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["reason"].as_str())
        .collect();
    assert!(
        shown.contains(&"Toothache") && shown.contains(&"Check-up"),
        "{today}"
    );

    // Exactly 200 characters is fine; 201 is a 400 naming the field, on both paths, and
    // issues no token.
    let long = "x".repeat(200);
    let (code, ok) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/queue",
        json!({ "patient_id": ravi, "reason": long }),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{ok}");
    let too_long = "x".repeat(201);
    for path in ["/api/v1/queue", "/api/v1/walk-ins"] {
        let (code, error) = post(
            &app,
            ALPHA,
            &owner,
            path,
            json!({ "patient_id": ravi, "reason": too_long }),
        )
        .await;
        assert_eq!(code, StatusCode::BAD_REQUEST, "{path}: {error}");
        assert!(error.to_string().contains("reason"), "{error}");
        assert!(!error.to_string().contains("xxxx"), "{error}");
    }
    let (_, queue) = app
        .send(Method::GET, ALPHA, "/api/v1/queue", Some(&owner), None)
        .await;
    assert_eq!(queue["items"].as_array().unwrap().len(), 5);

    // The change history masks it; erasure clears it.
    let token_id = token["id"].as_str().unwrap();
    let (code, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/queue/{token_id}/status"),
        json!({ "status": "called" }),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let (leaked,): (i64,) = sqlx::query_as(
        "select count(*) from audit.audit_events
         where table_name = 'aarogyam.queue_tokens' and changes::text like '%Toothache%'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(leaked, 0);
    let (action, clause): (String, Option<String>) = sqlx::query_as(
        "select action, set_clause from audit.erasure_steps where table_name = 'aarogyam.queue_tokens'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(action, "update");
    assert_eq!(clause.as_deref(), Some("reason = null"));

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_cannot_queue_or_see_the_walk_in() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let ravi = patient(&app, &owner).await;
    let (code, _) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/queue",
        json!({ "patient_id": ravi, "reason": "Toothache" }),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED);

    for path in ["/api/v1/queue", "/api/v1/walk-ins"] {
        let (code, error) = post(
            &app,
            BETA,
            &beta,
            path,
            json!({ "patient_id": ravi, "reason": "Toothache" }),
        )
        .await;
        assert_eq!(code, StatusCode::NOT_FOUND, "{path}: {error}");
    }
    let (_, theirs) = app
        .send(Method::GET, BETA, "/api/v1/queue", Some(&beta), None)
        .await;
    assert_eq!(theirs["items"], json!([]));

    app.finish().await;
}
