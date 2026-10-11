//! The waiting-room states `called` and `ready_to_bill`: the doctor's call, the legal moves, the
//! per-doctor filter, the staff notifications each move writes and who sees them, the permission
//! and the clinic boundary.
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

const DOCTOR_UID: Uuid = uuid!("a0000000-0000-4000-8000-0000000000d1");
const OTHER_UID: Uuid = uuid!("a0000000-0000-4000-8000-0000000000d2");

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

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

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, path, Some(token), None).await
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = post(app, ALPHA, token, path, body).await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

/// A doctor in Alpha with a sign-in and a practitioner record; returns the practitioner id.
async fn signed_in_doctor(app: &TestApp, owner: &str, auth_uid: Uuid, name: &str) -> String {
    let membership: Uuid = sqlx::query_scalar(
        "with u as (insert into aarogyam.users (auth_uid, display_name, email)
                    values ($1, $2, $1::text || '@alpha.test') returning id)
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, u.id, r.id, 'active' from aarogyam.organizations o, u, aarogyam.roles r
         where o.slug = 'alpha' and r.org_id = o.id and r.key = 'doctor'
         returning id",
    )
    .bind(auth_uid)
    .bind(name)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let body = json!({ "display_name": name, "membership_id": membership });
    id_of(&created(app, owner, "/api/v1/practitioners", body).await)
}

async fn walk_in(app: &TestApp, desk: &str, name: &str, doctor: &str) -> String {
    let patient = created(
        app,
        desk,
        "/api/v1/patients",
        json!({ "full_name": name, "sex": "female", "age_years": 30 }),
    )
    .await;
    let token = created(
        app,
        desk,
        "/api/v1/queue",
        json!({ "patient_id": id_of(&patient), "practitioner_id": doctor }),
    )
    .await;
    id_of(&token)
}

async fn status_of(app: &TestApp, token: &str, id: &str, to: &str) -> (StatusCode, Value) {
    post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/queue/{id}/status"),
        json!({ "status": to }),
    )
    .await
}

async fn call(app: &TestApp, token: &str, id: &str) -> (StatusCode, Value) {
    post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/queue/{id}/call"),
        json!({}),
    )
    .await
}

/// The kinds of a token's notifications with their audiences and whether they are handled.
async fn rows(app: &TestApp, id: &str) -> Vec<(String, String, bool)> {
    sqlx::query_as(
        "select kind, audience, handled_at is not null from aarogyam.staff_notifications
         where queue_token_id = $1::uuid order by id",
    )
    .bind(id)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

async fn feed_kinds(app: &TestApp, token: &str) -> Vec<String> {
    let (status, body) = get(app, ALPHA, token, "/api/v1/notifications").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["kind"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_token_moves_through_call_chair_billing_and_done() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let doctor = signed_in_doctor(&app, &owner, DOCTOR_UID, "Dr Dev").await;
    let doc = app.token(DOCTOR_UID);
    let id = walk_in(&app, &desk, "Walker", &doctor).await;

    // Not yet seen or billed: skipping states is refused with the token as it is.
    let (status, body) = status_of(&app, &desk, &id, "ready_to_bill").await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["current"]["status"], "waiting");

    let (status, called) = call(&app, &doc, &id).await;
    assert_eq!(status, StatusCode::OK, "{called}");
    assert_eq!(called["status"], "called");
    assert!(called["called_at"].is_string());
    // A repeat changes nothing.
    let (status, again) = call(&app, &doc, &id).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["called_at"], called["called_at"]);

    // The desk can send the patient back to waiting; the call time is cleared.
    let (status, back) = status_of(&app, &desk, &id, "waiting").await;
    assert_eq!(status, StatusCode::OK, "{back}");
    assert_eq!(back["called_at"], Value::Null);
    let (status, _) = call(&app, &doc, &id).await;
    assert_eq!(status, StatusCode::OK);

    let (status, seated) = status_of(&app, &desk, &id, "in_chair").await;
    assert_eq!(status, StatusCode::OK, "{seated}");
    let (status, billing) = status_of(&app, &desk, &id, "ready_to_bill").await;
    assert_eq!(status, StatusCode::OK, "{billing}");
    assert_eq!(billing["status"], "ready_to_bill");
    // Calling a token that is already past `called` is refused.
    let (status, refused) = call(&app, &doc, &id).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["current"]["status"], "ready_to_bill");
    let (status, done) = status_of(&app, &desk, &id, "done").await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert!(done["done_at"].is_string());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_queue_filters_by_doctor() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let first = signed_in_doctor(&app, &owner, DOCTOR_UID, "Dr Dev").await;
    let second = signed_in_doctor(&app, &owner, OTHER_UID, "Dr Esha").await;
    let a = walk_in(&app, &desk, "Alpha One", &first).await;
    let b = walk_in(&app, &desk, "Alpha Two", &second).await;

    let (_, all) = get(&app, ALPHA, &desk, "/api/v1/queue").await;
    assert_eq!(all["items"].as_array().unwrap().len(), 2, "{all}");
    let (status, only) = get(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/queue?practitioner_id={first}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{only}");
    let ids: Vec<&str> = only["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [a.as_str()], "{only}");
    assert!(!ids.contains(&b.as_str()));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn each_move_writes_its_notification_for_its_audience() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    let doctor = signed_in_doctor(&app, &owner, DOCTOR_UID, "Dr Dev").await;
    let doc = app.token(DOCTOR_UID);
    let other = signed_in_doctor(&app, &owner, OTHER_UID, "Dr Esha").await;
    let other_doc = app.token(OTHER_UID);
    let id = walk_in(&app, &desk, "Walker", &doctor).await;

    assert_eq!(
        rows(&app, &id).await,
        [("patient_waiting".into(), "doctor".into(), false)]
    );
    // Only the token's doctor is told, not another doctor, the desk or an assistant.
    assert_eq!(feed_kinds(&app, &doc).await, ["patient_waiting"]);
    assert_eq!(feed_kinds(&app, &other_doc).await, Vec::<String>::new());
    assert!(
        !feed_kinds(&app, &desk)
            .await
            .contains(&"patient_waiting".to_owned())
    );
    let (_, count) = get(&app, ALPHA, &doc, "/api/v1/notifications/count").await;
    assert_eq!(count["unread"], 1, "{count}");
    let item = get(&app, ALPHA, &doc, "/api/v1/notifications").await.1["items"][0].clone();
    let waiting_id = item["id"].as_str().unwrap().to_owned();
    // Another doctor cannot read the doctor's notification.
    let path = format!("/api/v1/notifications/{waiting_id}/read");
    let (status, _) = post(&app, ALPHA, &other_doc, &path, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(item["queue_token"]["id"], id);
    assert_eq!(item["queue_token"]["status"], "waiting");
    assert!(item["queue_token"]["patient_number"].is_string());
    assert!(
        !item.to_string().contains("Walker"),
        "no name in a notification: {item}"
    );

    // Calling answers the doctor's one and tells the desk.
    assert_eq!(call(&app, &doc, &id).await.0, StatusCode::OK);
    assert_eq!(
        rows(&app, &id).await,
        [
            ("patient_waiting".into(), "doctor".into(), true),
            ("send_in".into(), "front_desk".into(), false)
        ]
    );
    assert!(
        feed_kinds(&app, &desk)
            .await
            .contains(&"send_in".to_owned())
    );
    // Marking it read clears the desk's count for it.
    let (_, count) = get(&app, ALPHA, &desk, "/api/v1/notifications/count").await;
    assert_eq!(count["unread"], 1, "{count}");
    let feed = get(&app, ALPHA, &desk, "/api/v1/notifications").await.1;
    let nid = feed["items"][0]["id"].as_str().unwrap().to_owned();
    let (status, _) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/notifications/{nid}/read"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, count) = get(&app, ALPHA, &desk, "/api/v1/notifications/count").await;
    assert_eq!(count["unread"], 0, "{count}");
    let _ = (&other, &assistant);

    // Seating answers the send-in; the bill tells the desk and finance; done closes it.
    assert_eq!(
        status_of(&app, &desk, &id, "in_chair").await.0,
        StatusCode::OK
    );
    assert_eq!(
        status_of(&app, &desk, &id, "ready_to_bill").await.0,
        StatusCode::OK
    );
    let all = rows(&app, &id).await;
    assert_eq!(all.len(), 3, "{all:?}");
    assert_eq!(all[1], ("send_in".into(), "front_desk".into(), true));
    assert_eq!(all[2], ("collect_payment".into(), "billing".into(), false));
    assert!(
        feed_kinds(&app, &desk)
            .await
            .contains(&"collect_payment".to_owned())
    );
    assert!(
        feed_kinds(&app, &owner)
            .await
            .contains(&"collect_payment".to_owned())
    );
    assert_eq!(status_of(&app, &desk, &id, "done").await.0, StatusCode::OK);
    assert!(rows(&app, &id).await.iter().all(|row| row.2));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn calling_needs_clinical_write() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let doctor = signed_in_doctor(&app, &owner, DOCTOR_UID, "Dr Dev").await;
    let id = walk_in(&app, &desk, "Walker", &doctor).await;
    for token in [app.token(ALPHA_FRONT_DESK), app.token(ALPHA_NOTHING)] {
        let (status, body) = call(&app, &token, &id).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
    // Someone who is not a member of the clinic does not learn the token exists.
    let (status, _) = call(&app, &app.token(STRANGER), &id).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/queue/{id}/call"),
            None,
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // Nothing moved.
    let (_, queue) = get(&app, ALPHA, &desk, "/api/v1/queue").await;
    assert_eq!(queue["items"][0]["status"], "waiting");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_cannot_call_or_see_the_token() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let doctor = signed_in_doctor(&app, &owner, DOCTOR_UID, "Dr Dev").await;
    let id = walk_in(&app, &desk, "Walker", &doctor).await;

    let (status, body) = post(
        &app,
        BETA,
        &beta,
        &format!("/api/v1/queue/{id}/call"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let (status, body) = post(
        &app,
        BETA,
        &beta,
        &format!("/api/v1/queue/{id}/status"),
        json!({ "status": "in_chair" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let (_, queue) = get(&app, BETA, &beta, "/api/v1/queue").await;
    assert_eq!(queue["items"], json!([]));
    assert_eq!(feed_kinds_on(&app, BETA, &beta).await, Vec::<String>::new());
    app.finish().await;
}

async fn feed_kinds_on(app: &TestApp, host: &str, token: &str) -> Vec<String> {
    let (status, body) = get(app, host, token, "/api/v1/notifications").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["kind"].as_str().unwrap().to_owned())
        .collect()
}
