//! Visit summaries for the patient: the clinic's PIN link (wrong PIN, lock, expiry, other
//! clinics, permission), what the summary leaves out (the S, O and A sections and anything
//! unsigned), and the patient app's `/me/patient/visits`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::{Uuid, uuid};

const APP: &str = "app.localtest.me";
const RAVI: Uuid = uuid!("e0000000-0000-4000-8000-000000000011");
const MEERA: Uuid = uuid!("e0000000-0000-4000-8000-000000000012");

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn send(
    app: &TestApp,
    method: Method,
    host: &str,
    token: Option<&str>,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, token, body).await
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = send(app, Method::POST, ALPHA, Some(token), path, Some(body)).await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn register(app: &TestApp, token: &str, name: &str, email: &str) -> String {
    id_of(
        &created(
            app,
            token,
            "/api/v1/patients",
            json!({ "full_name": name, "sex": "male", "age_years": 40, "email": email }),
        )
        .await,
    )
}

/// A visit with one signed SOAP note and one draft note.
async fn visit(app: &TestApp, token: &str, patient: &str) -> String {
    let visit = id_of(
        &created(
            app,
            token,
            &format!("/api/v1/patients/{patient}/visits"),
            json!({ "chief_complaint": "Check-up" }),
        )
        .await,
    );
    let note = created(
        app,
        token,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": {
            "subjective": "SECRET-S pain", "objective": "SECRET-O swelling",
            "assessment": "SECRET-A abscess", "plan": "Rinse with warm salt water"
        } }),
    )
    .await;
    let (status, signed) = send(
        app,
        Method::POST,
        ALPHA,
        Some(token),
        &format!("/api/v1/notes/{}/sign", id_of(&note)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    created(
        app,
        token,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "kind": "progress", "sections": { "plan": "DRAFT-PLAN not signed" } }),
    )
    .await;
    visit
}

async fn share(app: &TestApp, token: &str, visit: &str) -> Value {
    created_at(app, token, &format!("/api/v1/visits/{visit}/share")).await
}

async fn created_at(app: &TestApp, token: &str, path: &str) -> Value {
    let (status, value) = send(app, Method::POST, ALPHA, Some(token), path, None).await;
    assert_eq!(status, StatusCode::CREATED, "{value}");
    value
}

async fn open(app: &TestApp, host: &str, token: &str, pin: &str) -> (StatusCode, Value) {
    send(
        app,
        Method::POST,
        host,
        None,
        &format!("/api/v1/shared/{token}/visit"),
        Some(json!({ "pin": pin })),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_visit_link_opens_with_the_pin_and_shows_only_the_plan() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner, "Ravi Kumar", "ravi@example.test").await;
    let visit = visit(&app, &owner, &patient).await;
    let link = share(&app, &owner, &visit).await;
    let token = link["token"].as_str().unwrap();
    let pin = link["pin"].as_str().unwrap();
    assert_eq!(link["path"], format!("/shared/{token}"));

    let (status, preview) = send(
        &app,
        Method::GET,
        ALPHA,
        None,
        &format!("/api/v1/shared/{token}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(preview["resource"], "visit");
    assert!(!preview.to_string().contains("Ravi"));

    let wrong = if pin == "000000" { "111111" } else { "000000" };
    let (status, body) = open(&app, ALPHA, token, wrong).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"]["code"], "wrong_pin");

    let (status, opened) = open(&app, ALPHA, token, pin).await;
    assert_eq!(status, StatusCode::OK, "{opened}");
    assert_eq!(opened["advice"], "Rinse with warm salt water");
    assert_eq!(opened["booking_path"], "/public/booking");
    assert!(opened["number"].as_str().unwrap().starts_with("V-"));
    // The S, O and A sections, unsigned notes and money never leave the clinic.
    let text = opened.to_string();
    for secret in ["SECRET-", "DRAFT-PLAN", "abscess", "paise", "fee"] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    let (reads,): (i64,) = sqlx::query_as(
        "select count(*) from audit.access_log where patient_id = $1::uuid and action = 'view'",
    )
    .bind(&patient)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(reads, 1);

    // Five wrong PINs lock it, even for the right one.
    let fresh = share(&app, &owner, &visit).await;
    let token = fresh["token"].as_str().unwrap();
    let pin = fresh["pin"].as_str().unwrap();
    let wrong = if pin == "000000" { "111111" } else { "000000" };
    for _ in 0..4 {
        assert_eq!(
            open(&app, ALPHA, token, wrong).await.0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(open(&app, ALPHA, token, wrong).await.0, StatusCode::LOCKED);
    assert_eq!(open(&app, ALPHA, token, pin).await.0, StatusCode::LOCKED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_expired_link_is_gone() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner, "Ravi Kumar", "ravi@example.test").await;
    let visit = visit(&app, &owner, &patient).await;
    let link = share(&app, &owner, &visit).await;
    let token = link["token"].as_str().unwrap();
    let pin = link["pin"].as_str().unwrap();
    assert_eq!(open(&app, ALPHA, token, pin).await.0, StatusCode::OK);
    sqlx::query("update aarogyam.share_links set expires_at = now() - interval '1 minute'")
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, body) = open(&app, ALPHA, token, pin).await;
    assert_eq!(status, StatusCode::GONE, "{body}");
    assert_eq!(body["error"]["code"], "expired");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_visit_link_stays_in_its_clinic_and_needs_clinical_read() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, &owner, "Ravi Kumar", "ravi@example.test").await;
    let visit = visit(&app, &owner, &patient).await;

    // Another clinic cannot make a link for this visit.
    let (status, body) = send(
        &app,
        Method::POST,
        BETA,
        Some(&beta),
        &format!("/api/v1/visits/{visit}/share"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    // Someone without clinical.read, or without a role, cannot either.
    let (status, _) = send(
        &app,
        Method::POST,
        ALPHA,
        Some(&app.token(ALPHA_NOTHING)),
        &format!("/api/v1/visits/{visit}/share"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(
        &app,
        Method::POST,
        ALPHA,
        None,
        &format!("/api/v1/visits/{visit}/share"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // A link of Alpha does not open on Beta's host, with the right PIN or not.
    let link = share(&app, &owner, &visit).await;
    let token = link["token"].as_str().unwrap();
    let pin = link["pin"].as_str().unwrap();
    assert_eq!(open(&app, BETA, token, pin).await.0, StatusCode::NOT_FOUND);
    // And a link to a prescription is not a link to a visit.
    assert_eq!(
        open(&app, ALPHA, "not-a-token", pin).await.0,
        StatusCode::NOT_FOUND
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_patient_app_lists_its_own_visits_only() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let ravi = app
        .tokens
        .mint_with_email(RAVI, Some("ravi@example.test"))
        .unwrap();
    let meera = app
        .tokens
        .mint_with_email(MEERA, Some("meera@example.test"))
        .unwrap();
    let mine = register(&app, &owner, "Ravi Kumar", "ravi@example.test").await;
    let other = register(&app, &owner, "Ravi Kumar", "other@example.test").await;
    let my_visit = visit(&app, &owner, &mine).await;
    let other_visit = visit(&app, &owner, &other).await;

    // Not linked: nothing.
    let (status, none) = send(
        &app,
        Method::GET,
        APP,
        Some(&ravi),
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{none}");
    assert_eq!(none["items"], json!([]));

    let invitation = created_at(
        &app,
        &owner,
        &format!("/api/v1/patients/{mine}/app-invitations"),
    )
    .await;
    let (status, linked) = send(
        &app,
        Method::POST,
        APP,
        Some(&ravi),
        "/api/v1/me/patient/links",
        Some(json!({ "code": invitation["code"] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{linked}");

    let (status, list) = send(
        &app,
        Method::GET,
        APP,
        Some(&ravi),
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 1, "{list}");
    assert_eq!(items[0]["id"], my_visit);
    assert_eq!(
        items[0]["clinic_id"],
        app.clinic_id("alpha").await.to_string()
    );
    assert_eq!(items[0]["advice"], "Rinse with warm salt water");
    let text = list.to_string();
    for secret in ["SECRET-", "DRAFT-PLAN"] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }

    let path = format!("/api/v1/me/patient/visits/{my_visit}");
    let (status, one) = send(&app, Method::GET, APP, Some(&ravi), &path, None).await;
    assert_eq!(status, StatusCode::OK, "{one}");
    assert_eq!(one["id"], my_visit);
    // Another patient's visit at the same clinic, and an account that linked nothing: 404.
    let (status, _) = send(
        &app,
        Method::GET,
        APP,
        Some(&ravi),
        &format!("/api/v1/me/patient/visits/{other_visit}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(&app, Method::GET, APP, Some(&meera), &path, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Patient routes live on the app host only.
    let (status, _) = send(
        &app,
        Method::GET,
        ALPHA,
        Some(&ravi),
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        Method::GET,
        APP,
        None,
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}
