//! Overdue lab work on the staff notifications feed (migration 0395): the reminder job's overdue
//! step writes one alert per order and due date, members see it by `labs.read` and its scope, the
//! work coming back handles it, and nothing crosses clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, Time, UtcOffset};
use uuid::{Uuid, uuid};

const DOCTOR_A: Uuid = uuid!("a0000000-0000-4000-8000-0000000000fa");

fn ist() -> UtcOffset {
    UtcOffset::from_hms(5, 30, 0).unwrap()
}

fn today() -> Date {
    OffsetDateTime::now_utc().to_offset(ist()).date()
}

async fn post_ok(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, path, Some(token), None).await
}

/// A doctor in Alpha with a sign-in, labs narrowed to their own orders. Returns the membership.
async fn own_doctor(app: &TestApp) -> String {
    let id: Uuid = sqlx::query_scalar(
        "with u as (insert into aarogyam.users (auth_uid, display_name, email)
                    values ($1, 'Dr Anil', 'anil@alpha.test') returning id)
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, u.id, r.id, 'active' from aarogyam.organizations o, u, aarogyam.roles r
         where o.slug = 'alpha' and r.org_id = o.id and r.key = 'doctor' returning id",
    )
    .bind(DOCTOR_A)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    sqlx::query(
        "update aarogyam.role_permissions rp set scope = 'own' from aarogyam.roles r
         where r.id = rp.role_id and r.key = 'doctor' and rp.permission = 'labs.read'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    id.to_string()
}

/// A crown due in two days, sent now, with `doctor` responsible when given.
async fn order(app: &TestApp, owner: &str, vendor: &str, doctor: Option<&str>) -> Value {
    let patient = post_ok(
        app,
        owner,
        "/api/v1/patients",
        json!({ "full_name": "Ravi Kumar" }),
    )
    .await;
    let mut body = json!({
        "vendor_id": vendor, "patient_id": patient["id"], "send": true,
        "due_on": (today() + Duration::days(2)).to_string(),
        "items": [{ "work_type": "Crown", "teeth": [36] }],
    });
    if let Some(doctor) = doctor {
        body["doctor_id"] = json!(doctor);
    }
    post_ok(app, owner, "/api/v1/lab-orders", body).await
}

async fn run_late(app: &TestApp) -> usize {
    let day = (today() + Duration::days(3)).with_time(Time::from_hms(10, 0, 0).unwrap());
    let report = aarogyam_notify::remind_labs(&app.api_db(), day.assume_offset(ist()))
        .await
        .unwrap();
    report.overdue
}

async fn lab_alerts(app: &TestApp, host: &str, token: &str) -> Vec<Value> {
    let (status, feed) = get(app, host, token, "/api/v1/notifications").await;
    assert_eq!(status, StatusCode::OK, "{feed}");
    feed["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["kind"] == "lab_overdue")
        .cloned()
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn overdue_lab_work_is_told_once_to_who_reaches_it() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let anil_id = own_doctor(&app).await;
    sqlx::query(
        "delete from aarogyam.role_permissions rp using aarogyam.roles r
         where r.id = rp.role_id and r.key = 'front_desk' and rp.permission = 'appointments.read'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let vendor = post_ok(
        &app,
        &owner,
        "/api/v1/lab-vendors",
        json!({ "name": "Precision Lab" }),
    )
    .await;
    let vendor = vendor["id"].as_str().unwrap();
    let anils = order(&app, &owner, vendor, Some(&anil_id)).await;
    let others = order(&app, &owner, vendor, None).await;

    // Two runs, or two at once, write one alert per order.
    let (a, b) = tokio::join!(run_late(&app), run_late(&app));
    assert_eq!(a + b, 2);
    assert_eq!(run_late(&app).await, 0);
    let (written,): (i64,) = sqlx::query_as(
        "select count(*) from aarogyam.staff_notifications where kind = 'lab_overdue'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(written, 2);

    // The owner sees both, with the order's brief and no appointment or patient.
    let seen = lab_alerts(&app, ALPHA, &owner).await;
    assert_eq!(seen.len(), 2);
    let alert = seen
        .iter()
        .find(|n| n["lab_order"]["id"] == anils["id"])
        .unwrap();
    assert_eq!(alert["lab_order"]["number"], anils["number"]);
    assert_eq!(alert["lab_order"]["vendor_name"], "Precision Lab");
    assert_eq!(alert["lab_order"]["due_on"], anils["due_on"]);
    assert!(alert["appointment"].is_null());
    assert!(!alert.to_string().contains("Ravi"), "{alert}");

    // A doctor at `own` sees only their order's, in the feed, the count and the badges.
    let anil = app.token(DOCTOR_A);
    let mine = lab_alerts(&app, ALPHA, &anil).await;
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0]["lab_order"]["id"], anils["id"]);
    let (_, count) = get(&app, ALPHA, &anil, "/api/v1/notifications/count").await;
    assert_eq!(count["unread"], 1);
    let (_, badges) = get(&app, ALPHA, &anil, "/api/v1/me/badges").await;
    assert_eq!(badges["notifications_unread"], 1, "{badges}");
    let theirs = seen
        .iter()
        .find(|n| n["lab_order"]["id"] == others["id"])
        .unwrap();
    let read = |id: &Value| format!("/api/v1/notifications/{}/read", id.as_str().unwrap());
    let (status, _) = app
        .send(Method::POST, ALPHA, &read(&theirs["id"]), Some(&anil), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &read(&mine[0]["id"]),
            Some(&anil),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Another clinic sees none of it and can't mark it read.
    let beta = app.token(BETA_OWNER);
    assert_eq!(lab_alerts(&app, BETA, &beta).await.len(), 0);
    let (status, _) = app
        .send(Method::POST, BETA, &read(&theirs["id"]), Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // labs.read alone opens the feed (lab alerts only); neither permission is 403.
    let desk = app.token(ALPHA_FRONT_DESK);
    assert_eq!(lab_alerts(&app, ALPHA, &desk).await.len(), 2);
    let (status, _) = get(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        "/api/v1/notifications",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The work coming back handles the alert.
    let path = format!(
        "/api/v1/lab-orders/{}/status",
        others["id"].as_str().unwrap()
    );
    post_ok(&app, &owner, &path, json!({ "status": "received" })).await;
    let after = lab_alerts(&app, ALPHA, &owner).await;
    let handled = after
        .iter()
        .find(|n| n["lab_order"]["id"] == others["id"])
        .unwrap();
    assert!(handled["handled"]["at"].is_string(), "{handled}");
    app.finish().await;
}
