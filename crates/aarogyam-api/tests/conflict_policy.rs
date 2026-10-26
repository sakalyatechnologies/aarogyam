//! The booking conflict policy on a real database (migrations 0683, 0685): a patient may ask
//! for a time the doctor holds (`request`, the default) or is refused (`strict`); who is told;
//! who sets the policy; approving, double booking and moving; and leave winning over a request.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one journey end to end, step by step"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

fn day(days: i64) -> Date {
    OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date()
        + Duration::days(days)
}

fn at(date: Date, time: &str) -> String {
    format!("{date}T{time}:00+05:30")
}

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn call(
    app: &TestApp,
    host: &str,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

async fn ok(app: &TestApp, token: &str, method: Method, path: &str, body: Value) -> Value {
    let (status, value) = call(app, ALPHA, token, method, path, Some(body)).await;
    assert!(status.is_success(), "{path}: {status} {value}");
    value
}

async fn new_member(app: &TestApp, clinic: Uuid, role_key: &str) -> (String, Uuid) {
    let auth_uid = Uuid::new_v4();
    let user: Uuid = sqlx::query_scalar(
        "insert into aarogyam.users (auth_uid, display_name, email) values ($1, 'Extra Member', $2)
         returning id",
    )
    .bind(auth_uid)
    .bind(format!("{auth_uid}@alpha.test"))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let role_id: Uuid =
        sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = $2")
            .bind(clinic)
            .bind(role_key)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let member: Uuid = sqlx::query_scalar(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         values ($1, $2, $3, 'active') returning id",
    )
    .bind(clinic)
    .bind(user)
    .bind(role_id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    (app.token(auth_uid), member)
}

/// Two doctors who sign in (each with a practitioner row) and the owner, the desk and the
/// first doctor's id. Doctor A works 09:00 to 10:00 every day. The clinic default is untouched.
struct Clinic {
    a: String,
    b: String,
    a_token: String,
    b_token: String,
    owner: String,
    desk: String,
}

async fn clinic(app: &TestApp) -> Clinic {
    let alpha = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let (a_token, a_member) = new_member(app, alpha, "doctor").await;
    let (b_token, b_member) = new_member(app, alpha, "doctor").await;
    let mut ids = Vec::new();
    for (name, member) in [("Dr Asha", a_member), ("Dr Bose", b_member)] {
        let doctor = ok(
            app,
            &owner,
            Method::POST,
            "/api/v1/practitioners",
            json!({ "display_name": name, "membership_id": member.to_string() }),
        )
        .await;
        let id = id_of(&doctor);
        let shifts: Vec<Value> = (1..=7)
            .map(|weekday| json!({ "weekday": weekday, "starts": "09:00", "ends": "10:00" }))
            .collect();
        ok(
            app,
            &owner,
            Method::PUT,
            &format!("/api/v1/practitioners/{id}/working-hours"),
            json!({ "shifts": shifts }),
        )
        .await;
        ids.push(id);
    }
    Clinic {
        b: ids.pop().unwrap(),
        a: ids.pop().unwrap(),
        a_token,
        b_token,
        owner,
        desk: app.token(ALPHA_FRONT_DESK),
    }
}

fn verified(app: &TestApp, email: &str) -> String {
    app.tokens
        .mint_with_email(Uuid::now_v7(), Some(email))
        .unwrap()
}

fn request(doctor: &str, starts_at: &str) -> Value {
    json!({
        "starts_at": starts_at, "practitioner_id": doctor,
        "full_name": "Priya Nair", "phone": "98765 43210", "reason": "Toothache"
    })
}

async fn book(app: &TestApp, token: &str, doctor: &str, starts_at: &str) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        ALPHA,
        "/api/v1/public/bookings",
        Some(token),
        Some(request(doctor, starts_at)),
    )
    .await
}

async fn set_clinic_policy(app: &TestApp, owner: &str, policy: &str) {
    ok(
        app,
        owner,
        Method::PATCH,
        "/api/v1/settings/clinic",
        json!({ "online_booking": { "conflict_policy": policy } }),
    )
    .await;
}

async fn feed_kinds(app: &TestApp, token: &str) -> Vec<String> {
    let (status, body) = call(
        app,
        ALPHA,
        token,
        Method::GET,
        "/api/v1/notifications?limit=100",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["kind"].as_str().unwrap().to_owned())
        .collect()
}

async fn overlap_of(app: &TestApp, appointment: &str) -> bool {
    sqlx::query_scalar("select requested_overlap from aarogyam.appointments where id = $1")
        .bind(Uuid::parse_str(appointment).unwrap())
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

async fn mail(app: &TestApp, kind: &str) -> i64 {
    sqlx::query_scalar("select count(*) from aarogyam.messages where kind = $1")
        .bind(kind)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

/// A confirmed online booking holding `starts_at`.
async fn held(app: &TestApp, c: &Clinic, starts_at: &str) -> String {
    let (status, first) = book(app, &verified(app, "first@example.test"), &c.a, starts_at).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let id = id_of(&first);
    ok(
        app,
        &c.desk,
        Method::POST,
        &format!("/api/v1/appointments/{id}/status"),
        json!({ "status": "confirmed" }),
    )
    .await;
    id
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_default_lets_a_patient_ask_for_a_taken_time_and_tells_the_desk_and_that_doctor() {
    let app = TestApp::start().await;
    let c = clinic(&app).await;
    let target = day(2);
    let slot = at(target, "09:15");
    held(&app, &c, &slot).await;

    // The slot is marked requestable, not free.
    let (_, open) = app
        .send(
            Method::GET,
            ALPHA,
            &format!(
                "/api/v1/public/availability?date={target}&practitioner_id={}",
                c.a
            ),
            None,
            None,
        )
        .await;
    let free: Vec<&str> = open["slots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| &s.as_str().unwrap()[11..16])
        .collect();
    let requestable: Vec<&str> = open["requestable_slots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| &s.as_str().unwrap()[11..16])
        .collect();
    assert!(!free.contains(&"09:15"), "{open}");
    assert_eq!(requestable, ["09:15"]);

    let (status, asked) = book(&app, &verified(&app, "second@example.test"), &c.a, &slot).await;
    assert_eq!(status, StatusCode::CREATED, "{asked}");
    assert_eq!(asked["status"], "requested");
    let id = id_of(&asked);
    assert!(overlap_of(&app, &id).await);

    // The desk and that doctor are told; the other doctor and the owner's own kind list differ.
    assert!(
        feed_kinds(&app, &c.desk)
            .await
            .contains(&"booking_conflict".to_owned())
    );
    assert!(
        feed_kinds(&app, &c.a_token)
            .await
            .contains(&"booking_conflict".to_owned())
    );
    assert!(
        !feed_kinds(&app, &c.b_token)
            .await
            .contains(&"booking_conflict".to_owned())
    );
    // One bell row per appointment: the held booking wrote booking_requested, the request
    // booking_conflict alone.
    let kinds: Vec<(String, String)> = sqlx::query_as(
        "select appointment_id::text, kind from aarogyam.staff_notifications
         where kind in ('booking_requested', 'booking_conflict') order by created_at",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(kinds.len(), 2, "{kinds:?}");
    assert_eq!(kinds[0].1, "booking_requested");
    assert_eq!(
        (kinds[1].0.as_str(), kinds[1].1.as_str()),
        (id.as_str(), "booking_conflict")
    );
    let desk_rows = feed_kinds(&app, &c.desk).await;
    assert_eq!(
        desk_rows
            .iter()
            .filter(|k| *k == "booking_conflict")
            .count(),
        1
    );
    assert_eq!(
        feed_kinds(&app, &c.a_token)
            .await
            .iter()
            .filter(|k| *k == "booking_conflict")
            .count(),
        1
    );
    // The reminder clock runs on it like on a request.
    let at = OffsetDateTime::now_utc() + Duration::minutes(16);
    let report = aarogyam_notify::remind(
        &app.api_db(),
        at,
        aarogyam_domain::notification::OpenHours {
            opens: time::Time::MIDNIGHT,
            closes: time::Time::from_hms(23, 59, 59).unwrap(),
        },
    )
    .await
    .unwrap();
    assert_eq!(report.reminded, 1, "{report:?}");
    // The row names no one: only the appointment.
    let row: (Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "select appointment_id, queue_token_id from aarogyam.staff_notifications
         where kind = 'booking_conflict'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(row.0, Some(Uuid::parse_str(&id).unwrap()));
    assert_eq!(row.1, None);

    // Deciding it marks the row handled.
    ok(
        &app,
        &c.desk,
        Method::POST,
        &format!("/api/v1/appointments/{id}/status"),
        json!({ "status": "cancelled", "reason": "Taken" }),
    )
    .await;
    let open_rows: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.staff_notifications
         where kind = 'booking_conflict' and handled_at is null",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(open_rows, 0);
    assert_eq!(mail(&app, "booking.declined").await, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn strict_refuses_a_taken_time() {
    let app = TestApp::start().await;
    let c = clinic(&app).await;
    set_clinic_policy(&app, &c.owner, "strict").await;
    let target = day(2);
    let slot = at(target, "09:15");
    held(&app, &c, &slot).await;
    let (status, body) = book(&app, &verified(&app, "second@example.test"), &c.a, &slot).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (_, open) = app
        .send(
            Method::GET,
            ALPHA,
            &format!(
                "/api/v1/public/availability?date={target}&practitioner_id={}",
                c.a
            ),
            None,
            None,
        )
        .await;
    assert_eq!(open["requestable_slots"], json!([]));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_doctor_sets_their_own_policy_and_null_follows_the_clinic() {
    let app = TestApp::start().await;
    let c = clinic(&app).await;
    set_clinic_policy(&app, &c.owner, "strict").await;
    let slot = at(day(2), "09:15");
    held(&app, &c, &slot).await;
    let path = format!("/api/v1/practitioners/{}/conflict-policy", c.a);

    // Null follows the clinic: strict.
    let (_, view) = call(&app, ALPHA, &c.desk, Method::GET, &path, None).await;
    assert_eq!(view["policy"], Value::Null);
    assert_eq!(view["effective"], "strict");
    let (status, _) = book(&app, &verified(&app, "x1@example.test"), &c.a, &slot).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Their own choice wins over the clinic's.
    let view = ok(
        &app,
        &c.a_token,
        Method::PUT,
        &path,
        json!({ "policy": "request" }),
    )
    .await;
    assert_eq!(view["policy"], "request");
    assert_eq!(view["effective"], "request");
    let (status, _) = book(&app, &verified(&app, "x2@example.test"), &c.a, &slot).await;
    assert_eq!(status, StatusCode::CREATED);

    // A colleague, the desk and nobody-in-particular can't change it; a bad value is refused.
    for token in [&c.b_token, &c.desk, &app.token(ALPHA_NOTHING)] {
        let (status, body) = call(
            &app,
            ALPHA,
            token,
            Method::PUT,
            &path,
            Some(json!({ "policy": "strict" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
    let (status, _) = call(
        &app,
        ALPHA,
        &c.owner,
        Method::PUT,
        &path,
        Some(json!({ "policy": "whenever" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The owner sets any doctor's, including back to the clinic's.
    let view = ok(
        &app,
        &c.owner,
        Method::PUT,
        &path,
        json!({ "policy": null }),
    )
    .await;
    assert_eq!(view["policy"], Value::Null);
    assert_eq!(view["effective"], "strict");
    let (status, _) = book(&app, &verified(&app, "x3@example.test"), &c.a, &slot).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Another clinic sees no such doctor.
    let beta = app.token(BETA_OWNER);
    for method in [Method::GET, Method::PUT] {
        let (status, _) = app
            .send(
                method,
                BETA,
                &path,
                Some(&beta),
                Some(json!({ "policy": "strict" })),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn leave_wins_over_a_request() {
    let app = TestApp::start().await;
    let c = clinic(&app).await;
    let target = day(2);
    ok(
        &app,
        &c.desk,
        Method::POST,
        "/api/v1/leave-blocks",
        json!({
            "practitioner_id": c.a, "starts_at": at(target, "08:00"),
            "ends_at": at(target, "18:00"), "reason": "Conference"
        }),
    )
    .await;
    let (status, body) = book(
        &app,
        &verified(&app, "leave@example.test"),
        &c.a,
        &at(target, "09:15"),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"]["code"], "practitioner_on_leave");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn two_requests_for_one_taken_time_both_land_and_the_first_decision_wins() {
    let app = TestApp::start().await;
    let c = clinic(&app).await;
    let slot = at(day(2), "09:15");
    held(&app, &c, &slot).await;

    let attempts: Vec<_> = (0..2)
        .map(|n| {
            let router = app.router.clone();
            let token = verified(&app, &format!("racer{n}@example.test"));
            let body = request(&c.a, &slot);
            tokio::spawn(async move {
                support::send(
                    &router,
                    Method::POST,
                    ALPHA,
                    "/api/v1/public/bookings",
                    Some(&token),
                    Some(body),
                )
                .await
            })
        })
        .collect();
    let mut ids = Vec::new();
    for attempt in attempts {
        let (status, body) = attempt.await.unwrap();
        assert_eq!(status, StatusCode::CREATED, "{body}");
        assert_eq!(body["status"], "requested");
        ids.push(id_of(&body));
    }
    let status_path = |id: &str| format!("/api/v1/appointments/{id}/status");

    // Approving into the held time needs an explicit double booking.
    let (status, body) = call(
        &app,
        ALPHA,
        &c.desk,
        Method::POST,
        &status_path(&ids[0]),
        Some(json!({ "status": "confirmed" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "slot_occupied");
    ok(
        &app,
        &c.desk,
        Method::POST,
        &status_path(&ids[0]),
        json!({ "status": "confirmed", "double_book": true }),
    )
    .await;

    // The other stays requested, its alert still open, and approving it is refused.
    let other: String =
        sqlx::query_scalar("select status from aarogyam.appointments where id = $1")
            .bind(Uuid::parse_str(&ids[1]).unwrap())
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(other, "requested");
    let open_rows: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.staff_notifications
         where kind = 'booking_conflict' and handled_at is null and appointment_id = $1",
    )
    .bind(Uuid::parse_str(&ids[1]).unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(open_rows, 1);
    let (status, body) = call(
        &app,
        ALPHA,
        &c.desk,
        Method::POST,
        &status_path(&ids[1]),
        Some(json!({ "status": "confirmed" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "slot_occupied");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn move_reschedules_and_confirms_in_one_call() {
    let app = TestApp::start().await;
    let c = clinic(&app).await;
    let target = day(2);
    let slot = at(target, "09:15");
    held(&app, &c, &slot).await;
    let (_, asked) = book(&app, &verified(&app, "mover@example.test"), &c.a, &slot).await;
    let id = id_of(&asked);
    let path = format!("/api/v1/appointments/{id}/move");

    // Into the held time: refused. Into another doctor's leave-free hour: fine. Without
    // appointments.write: refused.
    let (status, body) = call(
        &app,
        ALPHA,
        &c.desk,
        Method::POST,
        &path,
        Some(json!({ "starts_at": slot })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "slot_occupied");
    let (status, _) = call(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        Method::POST,
        &path,
        Some(json!({ "starts_at": at(target, "09:45") })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic sees no such appointment.
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &path,
            Some(&app.token(BETA_OWNER)),
            Some(json!({ "starts_at": at(target, "09:45") })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let moved = ok(
        &app,
        &c.desk,
        Method::POST,
        &path,
        json!({ "starts_at": at(target, "09:45") }),
    )
    .await;
    assert_eq!(moved["appointment"]["status"], "confirmed");
    let starts = OffsetDateTime::parse(
        moved["appointment"]["starts_at"].as_str().unwrap(),
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    assert_eq!(
        starts,
        OffsetDateTime::parse(
            &at(target, "09:45"),
            &time::format_description::well_known::Rfc3339
        )
        .unwrap()
    );
    assert_eq!(mail(&app, "booking.confirmed").await, 2);

    // Another doctor works too: move there.
    let again = ok(
        &app,
        &c.desk,
        Method::POST,
        &path,
        json!({ "starts_at": slot, "practitioner_id": c.b }),
    )
    .await;
    assert_eq!(again["appointment"]["status"], "confirmed");
    app.finish().await;
}
