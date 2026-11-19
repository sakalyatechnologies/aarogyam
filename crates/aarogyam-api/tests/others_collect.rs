//! `others_collect` on `GET /api/v1/session` on a real database: whether another active member
//! who collects and is not clinical (an assistant or front desk) is there to take a bill. Sent
//! only to callers who collect; a second doctor, a suspended or left member, the caller and a
//! clinical owner do not count; another clinic's desk does not either.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::Value;
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

async fn role(app: &TestApp, clinic: Uuid, key: &str) -> Uuid {
    sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = $2")
        .bind(clinic)
        .bind(key)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

/// A second member of `role_key`, signed in.
async fn another_member(app: &TestApp, clinic: Uuid, role_key: &str) -> String {
    let auth_uid = Uuid::new_v4();
    let user: Uuid = sqlx::query_scalar(
        "insert into aarogyam.users (auth_uid, display_name, email) values ($1, 'Extra Member', $2)
         returning id",
    )
    .bind(auth_uid)
    .bind(format!("{auth_uid}@extra.test"))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let role_id = role(app, clinic, role_key).await;
    sqlx::query(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         values ($1, $2, $3, 'active')",
    )
    .bind(clinic)
    .bind(user)
    .bind(role_id)
    .execute(&app.owner)
    .await
    .unwrap();
    app.token(auth_uid)
}

/// Sets the status of `auth_uid`'s membership in `clinic`.
async fn set_status(app: &TestApp, clinic: Uuid, auth_uid: Uuid, status: &str) {
    sqlx::query(
        "update aarogyam.memberships m set status = $3 from aarogyam.users u
         where u.id = m.user_id and m.org_id = $1 and u.auth_uid = $2",
    )
    .bind(clinic)
    .bind(auth_uid)
    .bind(status)
    .execute(&app.owner)
    .await
    .unwrap();
}

async fn session(app: &TestApp, host: &str, token: &str) -> Value {
    let (status, body) = app
        .send(Method::GET, host, "/api/v1/session", Some(token), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

/// The caller's `others_collect`; `None` when the field is absent.
async fn others(app: &TestApp, host: &str, token: &str) -> Option<bool> {
    let body = session(app, host, token).await;
    body.get("others_collect")
        .map(|value| value.as_bool().unwrap())
}

fn holds(body: &Value, permission: &str) -> bool {
    body["membership"]["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|key| key == permission)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_desk_collector_counts_and_non_collectors_get_no_field() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    // The assistant and front desk collect and are not clinical.
    assert_eq!(others(&app, ALPHA, &owner).await, Some(true));
    assert_eq!(
        others(&app, ALPHA, &app.token(ALPHA_FRONT_DESK)).await,
        Some(true)
    );
    // A member who can't collect is told nothing.
    let nothing = session(&app, ALPHA, &app.token(ALPHA_NOTHING)).await;
    assert!(!holds(&nothing, "payments.collect") && !holds(&nothing, "billing.write"));
    assert!(nothing.get("others_collect").is_none(), "{nothing}");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_caller_suspended_left_and_clinical_owner_do_not_count() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    set_status(&app, clinic, ALPHA_ASSISTANT, "suspended").await;
    // The owner collects but is clinical; the assistant is suspended; the caller is not counted.
    let owner_session = session(&app, ALPHA, &owner).await;
    assert!(holds(&owner_session, "payments.collect"));
    assert!(holds(&owner_session, "clinical.write"));
    assert_eq!(others(&app, ALPHA, &desk).await, Some(false));
    // The front desk is there for the owner.
    assert_eq!(others(&app, ALPHA, &owner).await, Some(true));
    // Once the front desk has left, nobody is.
    set_status(&app, clinic, ALPHA_FRONT_DESK, "left").await;
    assert_eq!(others(&app, ALPHA, &owner).await, Some(false));
    // An owner role without clinical.write counts like a desk.
    set_status(&app, clinic, ALPHA_FRONT_DESK, "active").await;
    sqlx::query(
        "delete from aarogyam.role_permissions where role_id = $1 and permission = 'clinical.write'",
    )
    .bind(role(&app, clinic, "owner").await)
    .execute(&app.owner)
    .await
    .unwrap();
    assert_eq!(others(&app, ALPHA, &desk).await, Some(true));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_doctor_does_not_count() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    set_status(&app, clinic, ALPHA_ASSISTANT, "suspended").await;
    set_status(&app, clinic, ALPHA_FRONT_DESK, "left").await;
    let doctor = another_member(&app, clinic, "doctor").await;
    let doctor_session = session(&app, ALPHA, &doctor).await;
    // The doctor template collects and is clinical.
    assert!(holds(&doctor_session, "payments.collect"));
    assert!(holds(&doctor_session, "clinical.write"));
    assert_eq!(doctor_session["others_collect"], false);
    assert_eq!(others(&app, ALPHA, &owner).await, Some(false));
    // A front desk joining changes that for both.
    another_member(&app, clinic, "front_desk").await;
    assert_eq!(others(&app, ALPHA, &owner).await, Some(true));
    assert_eq!(others(&app, ALPHA, &doctor).await, Some(true));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinics_desk_does_not_count() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let beta = app.clinic_id("beta").await;
    let alpha_owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    set_status(&app, alpha, ALPHA_ASSISTANT, "suspended").await;
    set_status(&app, alpha, ALPHA_FRONT_DESK, "suspended").await;
    assert_eq!(others(&app, BETA, &beta_owner).await, Some(false));
    another_member(&app, beta, "front_desk").await;
    assert_eq!(others(&app, BETA, &beta_owner).await, Some(true));
    assert_eq!(others(&app, ALPHA, &alpha_owner).await, Some(false));
    app.finish().await;
}
