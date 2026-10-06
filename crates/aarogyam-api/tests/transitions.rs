//! Moves a phone may repeat after a lost answer (sign a note, arrive, call, done): asking again
//! for a state the record already has succeeds without a second history entry, and a move the
//! record's state doesn't allow is `409` with the record as it is.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one record from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::{Uuid, uuid};

/// A second doctor at Alpha, added by [`add_doctor`].
const ALPHA_DOCTOR: Uuid = uuid!("a0000000-0000-4000-8000-000000000005");

async fn add_doctor(app: &TestApp) {
    sqlx::raw_sql(
        "insert into aarogyam.users (id, auth_uid, display_name, email) values
           ('01900000-0000-7000-8000-0000000000a5', 'a0000000-0000-4000-8000-000000000005', 'Dev Doctor', 'dev@alpha.test');
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, '01900000-0000-7000-8000-0000000000a5', r.id, 'active'
         from aarogyam.organizations o join aarogyam.roles r on r.org_id = o.id and r.key = 'doctor'
         where o.slug = 'alpha';",
    )
    .execute(&app.owner)
    .await
    .unwrap();
}

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

async fn created(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = post(app, host, token, path, body).await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

async fn count(app: &TestApp, query: &str, id: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(query.to_owned()))
        .bind(id)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

/// Rows in an appointment's history: booked, changed and every status change.
async fn history(app: &TestApp, appointment: &str) -> i64 {
    count(
        app,
        "select count(*) from aarogyam.appointment_events where appointment_id = $1::uuid",
        appointment,
    )
    .await
}

/// A chair and a doctor in Alpha.
struct Setup {
    chair: String,
    doctor: String,
}

async fn setup(app: &TestApp, owner: &str) -> Setup {
    let chair = created(
        app,
        ALPHA,
        owner,
        "/api/v1/rooms",
        json!({ "name": "Chair 1" }),
    )
    .await;
    let doctor = created(
        app,
        ALPHA,
        owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
    )
    .await;
    Setup {
        chair: id_of(&chair),
        doctor: id_of(&doctor),
    }
}

async fn patient(app: &TestApp, host: &str, token: &str, name: &str) -> String {
    let body = created(
        app,
        host,
        token,
        "/api/v1/patients",
        json!({ "full_name": name, "sex": "female", "age_years": 30 }),
    )
    .await;
    id_of(&body)
}

async fn book(app: &TestApp, token: &str, s: &Setup, hour: u32) -> String {
    let patient = patient(app, ALPHA, token, &format!("Patient {hour}")).await;
    let saved = created(
        app,
        ALPHA,
        token,
        "/api/v1/appointments",
        json!({
            "patient_id": patient, "practitioner_id": s.doctor, "room_id": s.chair,
            "starts_at": format!("2030-01-07T{hour:02}:00:00+05:30"),
            "ends_at": format!("2030-01-07T{hour:02}:30:00+05:30"),
            "reason": "Check-up"
        }),
    )
    .await;
    id_of(&saved["appointment"])
}

async fn set(app: &TestApp, token: &str, appointment: &str, status: &str) -> (StatusCode, Value) {
    post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/appointments/{appointment}/status"),
        json!({ "status": status }),
    )
    .await
}

fn assert_refused(answer: &(StatusCode, Value), what: &str) {
    assert_eq!(answer.0, StatusCode::CONFLICT, "{what}: {}", answer.1);
    assert_eq!(answer.1["error"]["code"], "conflict", "{what}");
    assert!(answer.1["error"]["message"].is_string(), "{what}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_appointment_asked_for_the_status_it_has_changes_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let s = setup(&app, &owner).await;
    let appointment = book(&app, &desk, &s, 10).await;
    assert_eq!(history(&app, &appointment).await, 1);

    let first = set(&app, &desk, &appointment, "confirmed").await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(history(&app, &appointment).await, 2);
    assert_eq!(set(&app, &desk, &appointment, "confirmed").await, first);
    assert_eq!(history(&app, &appointment).await, 2);

    // Arriving issues one token; arriving again returns the same appointment and token.
    let arrived = set(&app, &desk, &appointment, "arrived").await;
    assert_eq!(arrived.0, StatusCode::OK, "{}", arrived.1);
    assert_eq!(arrived.1["appointment"]["token_number"], 1);
    assert!(arrived.1["queue_token_id"].is_string());
    for _ in 0..2 {
        assert_eq!(set(&app, &desk, &appointment, "arrived").await, arrived);
    }
    assert_eq!(history(&app, &appointment).await, 3);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.queue_tokens where appointment_id = $1::uuid",
            &appointment
        )
        .await,
        1
    );

    // Cancelling again keeps the first reason, even if the second request gives another.
    let other = book(&app, &desk, &s, 11).await;
    let (status, cancelled) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/appointments/{other}/status"),
        json!({ "status": "cancelled", "reason": "Patient called" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled}");
    let (status, again) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/appointments/{other}/status"),
        json!({ "status": "cancelled", "reason": "Clinic closed" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again, cancelled);
    assert_eq!(again["appointment"]["cancel_reason"], "Patient called");
    assert_eq!(history(&app, &other).await, 2);

    // A move the table doesn't allow is a 409 that carries the appointment as it is.
    let skipped = set(&app, &desk, &other, "arrived").await;
    assert_refused(&skipped, "cancelled to arrived");
    assert_eq!(skipped.1["current"], again);
    assert_eq!(history(&app, &other).await, 2);
    assert_eq!(
        set(&app, &desk, &appointment, "in_chair").await.0,
        StatusCode::OK
    );
    let done = set(&app, &desk, &appointment, "completed").await;
    assert_eq!(done.0, StatusCode::OK, "{}", done.1);
    for to in ["arrived", "in_chair", "no_show"] {
        let refused = set(&app, &desk, &appointment, to).await;
        assert_refused(&refused, to);
        assert_eq!(refused.1["current"], done.1, "{to}");
    }
    assert_eq!(
        refused_cancel(&app, &desk, &appointment).await.1["current"],
        done.1
    );
    assert_eq!(history(&app, &appointment).await, 5);
    let not_yet = book(&app, &desk, &s, 12).await;
    let refused = set(&app, &desk, &not_yet, "completed").await;
    assert_refused(&refused, "booked to completed");
    assert_eq!(refused.1["current"]["appointment"]["status"], "booked");

    // Bad input is still a 400: an unknown status, or a cancel without a reason.
    assert_eq!(
        set(&app, &desk, &not_yet, "rescheduled").await.0,
        StatusCode::BAD_REQUEST
    );
    let (status, error) = set(&app, &desk, &not_yet, "cancelled").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("reason")
    );

    // Another clinic never reaches it; a role without appointments.write is refused.
    let beta = app.token(BETA_OWNER);
    let (status, _) = post(
        &app,
        BETA,
        &beta,
        &format!("/api/v1/appointments/{appointment}/status"),
        json!({ "status": "completed" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let nothing = app.token(ALPHA_NOTHING);
    assert_eq!(
        set(&app, &nothing, &appointment, "completed").await.0,
        StatusCode::FORBIDDEN
    );
    app.finish().await;
}

/// A cancel request (with a reason) for an appointment that is already completed.
async fn refused_cancel(app: &TestApp, token: &str, appointment: &str) -> (StatusCode, Value) {
    let answer = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/appointments/{appointment}/status"),
        json!({ "status": "cancelled", "reason": "Too late" }),
    )
    .await;
    assert_refused(&answer, "completed to cancelled");
    answer
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_queue_token_asked_for_the_status_it_has_changes_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let s = setup(&app, &owner).await;

    // A walk-in is called in, seen, and each request can be repeated.
    let walker = patient(&app, ALPHA, &desk, "Walker").await;
    let token = created(
        &app,
        ALPHA,
        &desk,
        "/api/v1/queue",
        json!({ "patient_id": walker }),
    )
    .await;
    let path = format!("/api/v1/queue/{}/status", id_of(&token));
    let called = post(&app, ALPHA, &desk, &path, json!({ "status": "in_chair" })).await;
    assert_eq!(called.0, StatusCode::OK, "{}", called.1);
    assert!(called.1["called_at"].is_string());
    let again = post(&app, ALPHA, &desk, &path, json!({ "status": "in_chair" })).await;
    assert_eq!(again.0, StatusCode::OK, "{}", again.1);
    assert_eq!(again.1["called_at"], called.1["called_at"]);
    assert_eq!(again.1["status"], "in_chair");
    let seen = post(&app, ALPHA, &desk, &path, json!({ "status": "done" })).await;
    assert_eq!(seen.0, StatusCode::OK, "{}", seen.1);
    let again = post(&app, ALPHA, &desk, &path, json!({ "status": "done" })).await;
    assert_eq!(again.0, StatusCode::OK, "{}", again.1);
    assert_eq!(again.1["done_at"], seen.1["done_at"]);

    // Moving a finished token again is a 409 with the token as it is.
    for to in ["in_chair", "left"] {
        let refused = post(&app, ALPHA, &desk, &path, json!({ "status": to })).await;
        assert_refused(&refused, to);
        assert_eq!(refused.1["current"]["status"], "done", "{to}");
        assert_eq!(refused.1["current"]["done_at"], seen.1["done_at"], "{to}");
    }
    let (status, _) = post(&app, ALPHA, &desk, &path, json!({ "status": "dancing" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // A token with an appointment moves it too, once.
    let appointment = book(&app, &desk, &s, 10).await;
    let arrived = set(&app, &desk, &appointment, "arrived").await;
    let linked = arrived.1["queue_token_id"].as_str().unwrap().to_owned();
    let linked_path = format!("/api/v1/queue/{linked}/status");
    for _ in 0..3 {
        let answer = post(
            &app,
            ALPHA,
            &desk,
            &linked_path,
            json!({ "status": "in_chair" }),
        )
        .await;
        assert_eq!(answer.0, StatusCode::OK, "{}", answer.1);
        assert_eq!(answer.1["status"], "in_chair");
    }
    assert_eq!(history(&app, &appointment).await, 3);
    for _ in 0..2 {
        let answer = post(
            &app,
            ALPHA,
            &desk,
            &linked_path,
            json!({ "status": "done" }),
        )
        .await;
        assert_eq!(answer.0, StatusCode::OK, "{}", answer.1);
    }
    assert_eq!(history(&app, &appointment).await, 4);
    let (_, day) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/appointments?from=2030-01-07&to=2030-01-07",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(day["items"][0]["status"], "completed");
    // The appointment path agrees: it is already completed, and the token can't leave now.
    assert_eq!(
        set(&app, &desk, &appointment, "completed").await.0,
        StatusCode::OK
    );
    let refused = post(
        &app,
        ALPHA,
        &desk,
        &linked_path,
        json!({ "status": "left" }),
    )
    .await;
    assert_refused(&refused, "done to left");
    assert_eq!(history(&app, &appointment).await, 4);

    // Another clinic never reaches the token; a role without appointments.write is refused.
    let (status, _) = post(&app, BETA, &beta, &path, json!({ "status": "left" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = post(&app, ALPHA, &nothing, &path, json!({ "status": "done" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn signing_a_note_again_changes_nothing() {
    let app = TestApp::start().await;
    add_doctor(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let doctor = app.token(ALPHA_DOCTOR);
    let beta = app.token(BETA_OWNER);
    let nothing = app.token(ALPHA_NOTHING);
    let patient = patient(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = created(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Pain" }),
    )
    .await;
    let notes = format!("/api/v1/visits/{}/notes", id_of(&visit));
    let note = created(
        &app,
        ALPHA,
        &owner,
        &notes,
        json!({ "sections": { "subjective": "Pain on chewing, 36" } }),
    )
    .await;
    let note_id = id_of(&note);
    let sign = format!("/api/v1/notes/{note_id}/sign");
    let changes = "select count(*) from audit.audit_events \
                   where table_name = 'aarogyam.clinical_notes' and row_id = $1::uuid";

    let signed = post(&app, ALPHA, &owner, &sign, json!({})).await;
    assert_eq!(signed.0, StatusCode::OK, "{}", signed.1);
    assert_eq!(signed.1["status"], "signed");
    let recorded = count(&app, changes, &note_id).await;
    for _ in 0..2 {
        // The author asking again gets the signed note back, unchanged and not re-signed.
        let again = post(&app, ALPHA, &owner, &sign, json!({})).await;
        assert_eq!(again, signed);
    }
    assert_eq!(count(&app, changes, &note_id).await, recorded);

    // Someone else's signature on a signed note is not a repeat; someone else's draft is theirs.
    let other = post(&app, ALPHA, &doctor, &sign, json!({})).await;
    assert_refused(&other, "another member");
    assert_eq!(other.1["current"], signed.1);
    let draft = created(
        &app,
        ALPHA,
        &owner,
        &notes,
        json!({ "sections": { "plan": "Review in a week" } }),
    )
    .await;
    let draft_sign = format!("/api/v1/notes/{}/sign", id_of(&draft));
    assert_eq!(
        post(&app, ALPHA, &doctor, &draft_sign, json!({})).await.0,
        StatusCode::FORBIDDEN
    );

    // A note entered in error, or with nothing written, can't be signed: 409 with the note.
    let withdrawn = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/notes/{}/entered-in-error", id_of(&draft)),
        json!({ "reason": "wrong patient" }),
    )
    .await;
    assert_eq!(withdrawn.0, StatusCode::OK, "{}", withdrawn.1);
    let refused = post(&app, ALPHA, &owner, &draft_sign, json!({})).await;
    assert_refused(&refused, "entered in error");
    assert_eq!(refused.1["current"], withdrawn.1);
    let empty = created(&app, ALPHA, &owner, &notes, json!({})).await;
    let refused = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/notes/{}/sign", id_of(&empty)),
        json!({}),
    )
    .await;
    assert_refused(&refused, "nothing written");
    assert_eq!(refused.1["current"]["status"], "draft");

    // Another clinic never reaches the note; a role without clinical.write is refused.
    assert_eq!(
        post(&app, BETA, &beta, &sign, json!({})).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        post(&app, ALPHA, &nothing, &sign, json!({})).await.0,
        StatusCode::FORBIDDEN
    );
    app.finish().await;
}
