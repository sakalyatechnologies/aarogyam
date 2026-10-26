//! Automatic no-shows and the day-end token close (migration 0682): the grace, the clinic's
//! day, once-only follow-ups, what the job leaves alone, a late arrival, the race with a
//! check-in, and the clinic wall.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one scenario from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

fn uuid_of(text: &str) -> Uuid {
    text.parse().unwrap()
}

async fn create(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

/// A doctor, a chair and a patient in the clinic at `host`.
struct Kit {
    host: &'static str,
    token: String,
    doctor: String,
    chair: String,
}

async fn kit(app: &TestApp, host: &'static str, token: String) -> Kit {
    let chair = create(
        app,
        host,
        &token,
        "/api/v1/rooms",
        json!({ "name": "Chair 1" }),
    )
    .await;
    let doctor = create(
        app,
        host,
        &token,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
    )
    .await;
    Kit {
        host,
        token,
        doctor: id_of(&doctor),
        chair: id_of(&chair),
    }
}

/// Books an appointment at `starts` to `ends` (offset times) and returns its id.
async fn book(app: &TestApp, k: &Kit, name: &str, starts: &str, ends: &str) -> String {
    let patient = create(
        app,
        k.host,
        &k.token,
        "/api/v1/patients",
        json!({ "full_name": name, "sex": "female", "age_years": 30 }),
    )
    .await;
    let saved = create(
        app,
        k.host,
        &k.token,
        "/api/v1/appointments",
        json!({
            "patient_id": id_of(&patient), "practitioner_id": k.doctor, "room_id": k.chair,
            "starts_at": starts, "ends_at": ends, "reason": "Check-up"
        }),
    )
    .await;
    id_of(&saved["appointment"])
}

async fn run(app: &TestApp, now: &str) -> i32 {
    sqlx::query_scalar::<_, i32>("select app.auto_no_show($1::timestamptz, 100)")
        .bind(now)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

async fn status_of(app: &TestApp, appointment: &str) -> String {
    sqlx::query_scalar("select status from aarogyam.appointments where id = $1")
        .bind(uuid_of(appointment))
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

async fn recalls(app: &TestApp, appointment: &str) -> i64 {
    sqlx::query_scalar(
        "select count(*) from aarogyam.recalls
         where source_appointment_id = $1 and kind = 'missed_visit'",
    )
    .bind(uuid_of(appointment))
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn events(app: &TestApp, appointment: &str, note: &str) -> i64 {
    sqlx::query_scalar(
        "select count(*) from aarogyam.appointment_events
         where appointment_id = $1 and note = $2 and to_status is not null",
    )
    .bind(uuid_of(appointment))
    .bind(note)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn status_change(
    app: &TestApp,
    k: &Kit,
    appointment: &str,
    status: &str,
) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        k.host,
        &format!("/api/v1/appointments/{appointment}/status"),
        Some(&k.token),
        Some(json!({ "status": status })),
    )
    .await
}

/// Moves the appointment to today's clinic noon (IST), so a real-clock request is on its day.
async fn move_to_today_noon(app: &TestApp, appointment: &str) -> String {
    sqlx::query_scalar(
        "update aarogyam.appointments
           set starts_at = ((now() at time zone 'Asia/Kolkata')::date + time '12:00')
                           at time zone 'Asia/Kolkata',
               ends_at = ((now() at time zone 'Asia/Kolkata')::date + time '12:30')
                         at time zone 'Asia/Kolkata'
         where id = $1 returning to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
    )
    .bind(uuid_of(appointment))
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_job_marks_only_missed_appointments_once_and_per_clinic() {
    let app = TestApp::start().await;
    let alpha = kit(&app, ALPHA, app.token(ALPHA_OWNER)).await;
    let beta = kit(&app, BETA, app.token(BETA_OWNER)).await;

    // 10:00 to 10:30 IST (04:30 to 05:00 UTC): the grace of 30 minutes ends at 05:30 UTC.
    let a = book(
        &app,
        &alpha,
        "Anu",
        "2030-01-07T10:00:00+05:30",
        "2030-01-07T10:30:00+05:30",
    )
    .await;
    // Ends 23:55 IST: the grace ends at 00:25 IST the next day, but the follow-up is due on the
    // appointment's own day.
    let late = book(
        &app,
        &alpha,
        "Late",
        "2030-01-07T23:40:00+05:30",
        "2030-01-07T23:55:00+05:30",
    )
    .await;
    let arrived = book(
        &app,
        &alpha,
        "Came",
        "2030-01-07T11:00:00+05:30",
        "2030-01-07T11:30:00+05:30",
    )
    .await;
    assert_eq!(
        status_change(&app, &alpha, &arrived, "arrived").await.0,
        StatusCode::OK
    );
    // Another clinic, same hour, with the job switched off.
    let b = book(
        &app,
        &beta,
        "Bea",
        "2030-01-07T10:00:00+05:30",
        "2030-01-07T10:30:00+05:30",
    )
    .await;
    sqlx::query(
        "update aarogyam.org_settings set booking = booking || '{\"no_show_auto\": false}'
         where org_id = (select id from aarogyam.organizations where slug = 'beta')",
    )
    .execute(&app.owner)
    .await
    .unwrap();

    // The boundary: exactly at the grace's end nothing moves, a second later it does.
    assert_eq!(run(&app, "2030-01-07T05:30:00Z").await, 0);
    assert_eq!(status_of(&app, &a).await, "booked");
    assert_eq!(run(&app, "2030-01-07T05:30:01Z").await, 1);
    assert_eq!(status_of(&app, &a).await, "no_show");
    assert_eq!(
        status_of(&app, &b).await,
        "booked",
        "the other clinic switched it off"
    );
    assert_eq!(
        status_of(&app, &arrived).await,
        "arrived",
        "arrived is never touched"
    );
    assert_eq!(events(&app, &a, "auto_no_show").await, 1);
    assert_eq!(recalls(&app, &a).await, 1);
    let due: String = sqlx::query_scalar(
        "select due_on::text from aarogyam.recalls where source_appointment_id = $1",
    )
    .bind(uuid_of(&a))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(due, "2030-01-07");

    // The clinic's day, not UTC's: 00:20 IST on the 8th is 18:50 UTC on the 7th.
    assert_eq!(run(&app, "2030-01-07T18:50:00Z").await, 0);
    assert_eq!(status_of(&app, &late).await, "booked");
    assert_eq!(run(&app, "2030-01-07T18:56:00Z").await, 1);
    let due: String = sqlx::query_scalar(
        "select due_on::text from aarogyam.recalls where source_appointment_id = $1",
    )
    .bind(uuid_of(&late))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(due, "2030-01-07");

    // Run twice: no second mark, and even a reopened appointment gets one follow-up only.
    assert_eq!(run(&app, "2030-01-09T00:00:00Z").await, 0);
    sqlx::query("update aarogyam.appointments set status = 'booked' where id = $1")
        .bind(uuid_of(&a))
        .execute(&app.owner)
        .await
        .unwrap();
    assert_eq!(run(&app, "2030-01-09T00:00:00Z").await, 1);
    assert_eq!(recalls(&app, &a).await, 1);
    assert_eq!(recalls(&app, &b).await, 0);

    // Today's counts: the no-shows are counted, the arrived one stays arrived.
    let (status, day) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/today?date=2030-01-07",
            Some(&alpha.token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{day}");
    assert_eq!(day["counts"]["no_shows"], 2);
    assert_eq!(day["counts"]["arrived"], 1);
    assert_eq!(day["counts"]["total"], 3);

    // A token on a still-booked appointment keeps it too.
    let held = book(
        &app,
        &alpha,
        "Held",
        "2030-01-08T10:00:00+05:30",
        "2030-01-08T10:30:00+05:30",
    )
    .await;
    sqlx::query(
        "insert into aarogyam.queue_tokens (org_id, branch_id, day, token_number, patient_id, appointment_id)
         select org_id, branch_id, '2030-01-08', 1, patient_id, id
         from aarogyam.appointments where id = $1",
    )
    .bind(uuid_of(&held))
    .execute(&app.owner)
    .await
    .unwrap();
    assert_eq!(run(&app, "2030-01-10T00:00:00Z").await, 0);
    assert_eq!(status_of(&app, &held).await, "booked");

    // The grace is a setting from 0 to 240 minutes.
    for bad in [241, 1000] {
        let (status, error) = app
            .send(
                Method::PATCH,
                ALPHA,
                "/api/v1/settings/clinic",
                Some(&alpha.token),
                Some(json!({ "online_booking": { "no_show_grace_minutes": bad } })),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {error}");
    }
    let (status, saved) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&alpha.token),
            Some(json!({ "online_booking": { "no_show_grace_minutes": 0, "no_show_auto": true } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["online_booking"]["no_show_grace_minutes"], 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_late_arrival_reopens_a_no_show_on_its_own_day_only() {
    let app = TestApp::start().await;
    let k = kit(&app, ALPHA, app.token(ALPHA_OWNER)).await;

    // An old no-show cannot come back.
    let old = book(
        &app,
        &k,
        "Old",
        "2030-01-07T10:00:00+05:30",
        "2030-01-07T10:30:00+05:30",
    )
    .await;
    assert_eq!(run(&app, "2030-01-07T06:00:00Z").await, 1);
    let (status, refused) = status_change(&app, &k, &old, "arrived").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(status_of(&app, &old).await, "no_show");

    // Today's: marked by the job, then the patient turns up.
    let today = book(
        &app,
        &k,
        "Today",
        "2030-02-07T10:00:00+05:30",
        "2030-02-07T10:30:00+05:30",
    )
    .await;
    let ends = move_to_today_noon(&app, &today).await;
    let after = sqlx::query_scalar::<_, String>(
        "select to_char(($1::timestamptz + interval '31 minutes') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
    )
    .bind(&ends)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(run(&app, &after).await, 1);
    assert_eq!(status_of(&app, &today).await, "no_show");
    let (status, back) = status_change(&app, &k, &today, "arrived").await;
    assert_eq!(status, StatusCode::OK, "{back}");
    assert_eq!(status_of(&app, &today).await, "arrived");
    assert!(back["queue_token_id"].is_string(), "{back}");
    assert_eq!(events(&app, &today, "Late arrival").await, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_check_in_racing_the_job_ends_arrived_with_one_token() {
    let app = TestApp::start().await;
    let k = kit(&app, ALPHA, app.token(ALPHA_OWNER)).await;
    let appointment = book(
        &app,
        &k,
        "Racer",
        "2030-02-07T10:00:00+05:30",
        "2030-02-07T10:30:00+05:30",
    )
    .await;
    let ends = move_to_today_noon(&app, &appointment).await;
    let after = sqlx::query_scalar::<_, String>(
        "select to_char(($1::timestamptz + interval '31 minutes') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
    )
    .bind(&ends)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let (job, arrival) = tokio::join!(
        run(&app, &after),
        status_change(&app, &k, &appointment, "arrived")
    );
    assert!(job <= 1);
    assert_eq!(arrival.0, StatusCode::OK, "{}", arrival.1);
    assert_eq!(status_of(&app, &appointment).await, "arrived");
    let tokens: i64 =
        sqlx::query_scalar("select count(*) from aarogyam.queue_tokens where appointment_id = $1")
            .bind(uuid_of(&appointment))
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(tokens, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_day_end_close_leaves_open_bills_in_the_queue() {
    let app = TestApp::start().await;
    let k = kit(&app, ALPHA, app.token(ALPHA_OWNER)).await;
    let mut tokens = Vec::new();
    for name in ["One", "Two", "Three"] {
        let patient = create(
            &app,
            ALPHA,
            &k.token,
            "/api/v1/patients",
            json!({ "full_name": name, "sex": "female", "age_years": 30 }),
        )
        .await;
        let queued = create(
            &app,
            ALPHA,
            &k.token,
            "/api/v1/queue",
            json!({ "patient_id": id_of(&patient) }),
        )
        .await;
        tokens.push(uuid_of(&id_of(&queued)));
    }
    sqlx::query(
        "update aarogyam.queue_tokens set status = 'in_chair', called_at = now() where id = $1",
    )
    .bind(tokens[1])
    .execute(&app.owner)
    .await
    .unwrap();
    sqlx::query(
        "update aarogyam.queue_tokens set status = 'ready_to_bill', called_at = now() where id = $1",
    )
    .bind(tokens[2])
    .execute(&app.owner)
    .await
    .unwrap();

    // The same clinic day: nothing closes.
    let close = |now: &'static str| {
        let owner = app.owner.clone();
        async move {
            sqlx::query_scalar::<_, i32>("select app.close_stale_tokens($1::timestamptz, 100)")
                .bind(now)
                .fetch_one(&owner)
                .await
                .unwrap()
        }
    };
    let status = |id: Uuid| {
        let owner = app.owner.clone();
        async move {
            sqlx::query_scalar::<_, String>(
                "select status from aarogyam.queue_tokens where id = $1",
            )
            .bind(id)
            .fetch_one(&owner)
            .await
            .unwrap()
        }
    };
    let today: String =
        sqlx::query_scalar("select (now() at time zone 'Asia/Kolkata')::date::text")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(today.len(), 10);
    assert_eq!(close("2000-01-01T00:00:00Z").await, 0);
    // Two days on: the waiting and in-chair tokens close, the one to bill stays.
    assert_eq!(close("2100-01-01T00:00:00Z").await, 2);
    assert_eq!(status(tokens[0]).await, "left");
    assert_eq!(status(tokens[1]).await, "left");
    assert_eq!(status(tokens[2]).await, "ready_to_bill");
    let reason: String =
        sqlx::query_scalar("select left_reason from aarogyam.queue_tokens where id = $1")
            .bind(tokens[0])
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(reason, "Closed at day end");
    assert_eq!(close("2100-01-01T00:00:00Z").await, 0);
    app.finish().await;
}
