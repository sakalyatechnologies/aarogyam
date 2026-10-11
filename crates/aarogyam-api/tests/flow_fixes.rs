//! The queue token at the end of a visit: closing sends it to the desk or finishes it, a payment
//! that clears the balance finishes it, and a called token can be started and closed.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn send(app: &TestApp, token: &str, method: Method, path: &str, body: Value) -> Value {
    let (status, value) = app.send(method, ALPHA, path, Some(token), Some(body)).await;
    assert!(status.is_success(), "{path}: {status} {value}");
    value
}

/// A walk-in token for a new patient; returns (patient id, token id).
async fn walk_in(app: &TestApp, desk: &str, name: &str) -> (String, String) {
    let patient = send(
        app,
        desk,
        Method::POST,
        "/api/v1/patients",
        json!({ "full_name": name, "sex": "female", "age_years": 30 }),
    )
    .await;
    let token = send(
        app,
        desk,
        Method::POST,
        "/api/v1/queue",
        json!({ "patient_id": id_of(&patient) }),
    )
    .await;
    (id_of(&patient), id_of(&token))
}

async fn status_of_token(app: &TestApp, token: &str, id: &str) -> String {
    let (_, queue) = app
        .send(Method::GET, ALPHA, "/api/v1/queue", Some(token), None)
        .await;
    queue["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id)
        .unwrap()["status"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn start(app: &TestApp, owner: &str, token: &str) -> String {
    let started = send(
        app,
        owner,
        Method::POST,
        &format!("/api/v1/queue/{token}/start-visit"),
        json!({}),
    )
    .await;
    id_of(&started["visit"])
}

async fn collect_rows(app: &TestApp, token: &str) -> Vec<bool> {
    sqlx::query_scalar(
        "select handled_at is not null from aarogyam.staff_notifications
         where queue_token_id = $1::uuid and kind = 'collect_payment' order by id",
    )
    .bind(token)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn closing_with_a_balance_sends_the_token_to_the_desk_and_payment_finishes_it() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (patient, token) = walk_in(&app, &desk, "Meera Shah").await;
    let visit = start(&app, &owner, &token).await;
    assert_eq!(status_of_token(&app, &desk, &token).await, "in_chair");

    let closed = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        json!({ "fee_paise": 50_000 }),
    )
    .await;
    assert_eq!(status_of_token(&app, &desk, &token).await, "ready_to_bill");
    assert_eq!(collect_rows(&app, &token).await, vec![false]);

    let invoice = closed["invoice_id"].as_str().unwrap();
    send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{invoice}/issue"),
        json!({}),
    )
    .await;
    // A part payment leaves the token at the desk.
    let part = json!({ "patient_id": patient, "method": "cash", "amount_paise": 20_000,
                       "allocations": [{ "invoice_id": invoice, "amount_paise": 20_000 }] });
    let (status, body) = app
        .send_with(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(&desk),
            Some(part),
            &[("idempotency-key", "flow-part-0001")],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(status_of_token(&app, &desk, &token).await, "ready_to_bill");
    // The rest clears it: the token is done, and no new collect_payment row appears.
    let rest = json!({ "patient_id": patient, "method": "upi", "amount_paise": 30_000,
                       "allocations": [{ "invoice_id": invoice, "amount_paise": 30_000 }] });
    let (status, body) = app
        .send_with(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(&desk),
            Some(rest),
            &[("idempotency-key", "flow-rest-0001")],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(status_of_token(&app, &desk, &token).await, "done");
    assert_eq!(collect_rows(&app, &token).await, vec![true]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn closing_without_a_balance_finishes_the_token() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, token) = walk_in(&app, &desk, "Asha Rao").await;
    let visit = start(&app, &owner, &token).await;
    send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        json!({}),
    )
    .await;
    assert_eq!(status_of_token(&app, &desk, &token).await, "done");
    assert!(collect_rows(&app, &token).await.is_empty());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_called_token_can_be_started_into_a_visit_and_closed() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, token) = walk_in(&app, &desk, "Ravi Iyer").await;
    send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/queue/{token}/call"),
        json!({}),
    )
    .await;
    assert_eq!(status_of_token(&app, &desk, &token).await, "called");
    let visit = start(&app, &owner, &token).await;
    assert_eq!(status_of_token(&app, &desk, &token).await, "in_chair");
    send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        json!({}),
    )
    .await;
    assert_eq!(status_of_token(&app, &desk, &token).await, "done");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_called_token_whose_visit_exists_closes_to_done() {
    // A visit opened while the token was still called (before the start step moved it).
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, token) = walk_in(&app, &desk, "Ravi Iyer").await;
    let visit = start(&app, &owner, &token).await;
    sqlx::query("update aarogyam.queue_tokens set status = 'called' where id = $1::uuid")
        .bind(&token)
        .execute(&app.owner)
        .await
        .unwrap();
    send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        json!({}),
    )
    .await;
    assert_eq!(status_of_token(&app, &desk, &token).await, "done");
    app.finish().await;
}

fn v7() -> String {
    uuid::Uuid::now_v7().to_string()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn offline_retries_return_the_same_result() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, token) = walk_in(&app, &desk, "Meera Shah").await;
    let visit = start(&app, &owner, &token).await;

    // A procedure with a client id: the retry returns the one that exists.
    let proc_id = v7();
    let path = format!("/api/v1/visits/{visit}/procedures");
    let body = json!({ "id": proc_id, "name": "Scaling", "price_paise": 10_000 });
    let first = send(&app, &owner, Method::POST, &path, body.clone()).await;
    let again = send(&app, &owner, Method::POST, &path, body).await;
    assert_eq!(first["id"], proc_id);
    assert_eq!(again["id"], first["id"]);
    let (count,): (i64,) = sqlx::query_as("select count(*) from aarogyam.procedures")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(count, 1);
    // The same id for different work is a conflict.
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "id": proc_id, "name": "Extraction" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Signing twice is 200 with the same body.
    let note = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "plan": "Review in a week" } }),
    )
    .await;
    let sign = format!("/api/v1/notes/{}/sign", id_of(&note));
    let signed = send(&app, &owner, Method::POST, &sign, json!({})).await;
    let again = send(&app, &owner, Method::POST, &sign, json!({})).await;
    assert_eq!(signed["status"], "signed");
    assert_eq!(again, signed);

    // Closing twice is 200 with the same body.
    let close = format!("/api/v1/visits/{visit}/close");
    let closed = send(
        &app,
        &owner,
        Method::POST,
        &close,
        json!({ "fee_paise": 9_000 }),
    )
    .await;
    let again = send(
        &app,
        &owner,
        Method::POST,
        &close,
        json!({ "fee_paise": 9_000 }),
    )
    .await;
    assert_eq!(again, closed);
    let (count,): (i64,) = sqlx::query_as("select count(*) from aarogyam.invoices")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(count, 1);
    app.finish().await;
}
