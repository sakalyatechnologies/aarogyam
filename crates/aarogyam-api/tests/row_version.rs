//! Optimistic concurrency: patients, appointments and draft notes carry a `row_version` (also the
//! `ETag`), edits may send it back in `If-Match`, and an edit of a record that changed since
//! is `412 stale_version`. Without `If-Match` an edit behaves as it always did.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one record from start to finish"
)]

mod support;

use axum::http::{HeaderMap, Method, StatusCode};
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

fn etag(headers: &HeaderMap) -> String {
    headers
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .unwrap()
        .to_owned()
}

/// Sends a JSON request, with `If-Match` when given.
async fn send(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
    if_match: Option<&str>,
) -> (StatusCode, HeaderMap, Value) {
    let headers: Vec<(&str, &str)> = if_match
        .map(|value| ("if-match", value))
        .into_iter()
        .collect();
    app.send_full(method, host, path, Some(token), body, &headers)
        .await
}

async fn created(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

fn assert_stale(answer: &(StatusCode, HeaderMap, Value), current: &str, what: &str) {
    assert_eq!(
        answer.0,
        StatusCode::PRECONDITION_FAILED,
        "{what}: {}",
        answer.2
    );
    assert_eq!(answer.2["error"]["code"], "stale_version", "{what}");
    assert_eq!(
        etag(&answer.1),
        current,
        "{what}: the answer names the current version"
    );
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_patient_edit_can_be_made_conditional_on_the_version_read() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let nothing = app.token(ALPHA_NOTHING);

    let (status, headers, patient) = send(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/patients",
        &owner,
        Some(json!({ "full_name": "Meera Shah" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    assert_eq!(patient["row_version"], 1);
    assert_eq!(etag(&headers), "\"1\"");
    let id = id_of(&patient);
    let path = format!("/api/v1/patients/{id}");
    let (_, headers, opened) = send(&app, Method::GET, ALPHA, &path, &owner, None, None).await;
    assert_eq!(opened["row_version"], 1);
    assert_eq!(etag(&headers), "\"1\"");

    // Without If-Match an edit works as it always did, and the version moves.
    let (status, headers, edited) = send(
        &app,
        Method::PATCH,
        ALPHA,
        &path,
        &owner,
        Some(json!({ "full_name": "Meera S. Shah" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["row_version"], 2);
    assert_eq!(etag(&headers), "\"2\"");

    // With the version just read, it goes through; with an older one it is refused.
    let edit = async |changes: Value, if_match: &str| {
        send(
            &app,
            Method::PATCH,
            ALPHA,
            &path,
            &owner,
            Some(changes),
            Some(if_match),
        )
        .await
    };
    let (status, headers, second) = edit(json!({ "sex": "female" }), "\"2\"").await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(
        (second["row_version"].as_i64(), etag(&headers).as_str()),
        (Some(3), "\"3\"")
    );
    let stale = edit(json!({ "full_name": "Someone Else" }), "\"2\"").await;
    assert_stale(&stale, "\"3\"", "an older version");
    let (_, _, unchanged) = send(&app, Method::GET, ALPHA, &path, &owner, None, None).await;
    assert_eq!(unchanged["full_name"], "Meera S. Shah");
    assert_eq!(unchanged["row_version"], 3);

    // A weak validator and * are accepted; anything else that isn't a version is a 400.
    let (status, _, weak) = edit(json!({ "sex": "other" }), "W/\"3\"").await;
    assert_eq!(status, StatusCode::OK, "{weak}");
    let (status, _, any) = edit(json!({ "sex": "female" }), "*").await;
    assert_eq!(status, StatusCode::OK, "{any}");
    assert_eq!(any["row_version"], 5);
    for bad in ["abc", "0", "-1", "\"\"", "+5", "\"5\", \"6\""] {
        let (status, _, error) = edit(json!({ "sex": "other" }), bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {error}");
        assert_eq!(error["error"]["code"], "invalid_request");
    }

    // An edit that changes nothing, and a visit setting the last visit, don't move the version.
    let (_, _, same) = send(
        &app,
        Method::PATCH,
        ALPHA,
        &path,
        &owner,
        Some(json!({ "full_name": "Meera S. Shah" })),
        None,
    )
    .await;
    assert_eq!(same["row_version"], 5);
    created(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{id}/visits"),
        json!({ "chief_complaint": "Pain" }),
    )
    .await;
    let (_, _, after_visit) = send(&app, Method::GET, ALPHA, &path, &owner, None, None).await;
    assert!(after_visit["last_visit_at"].is_string());
    assert_eq!(after_visit["row_version"], 5);
    // The counter is bookkeeping: the change history lists what changed, not the version.
    let versioned: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events
         where table_name = 'aarogyam.patients' and row_id = $1::uuid and changes ? 'row_version'",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(versioned, 0);

    // Lists carry the version too.
    let (_, _, list) = send(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/patients",
        &owner,
        None,
        None,
    )
    .await;
    assert_eq!(list["items"][0]["row_version"], 5);

    // Permissions come first, and another clinic never learns the record exists.
    let wrong = Some("\"1\"");
    let current = Some("\"5\"");
    for (token, host, if_match, expected) in [
        (&assistant, ALPHA, current, StatusCode::FORBIDDEN),
        (&nothing, ALPHA, current, StatusCode::FORBIDDEN),
        (&beta, BETA, current, StatusCode::NOT_FOUND),
        (&beta, BETA, wrong, StatusCode::NOT_FOUND),
    ] {
        let (status, _, _) = send(
            &app,
            Method::PATCH,
            host,
            &path,
            token,
            Some(json!({ "sex": "other" })),
            if_match,
        )
        .await;
        assert_eq!(status, expected, "{host} {if_match:?}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_appointment_edit_can_be_made_conditional_on_the_version_read() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let nothing = app.token(ALPHA_NOTHING);
    let chair = id_of(
        &created(
            &app,
            ALPHA,
            &owner,
            "/api/v1/rooms",
            json!({ "name": "Chair 1" }),
        )
        .await,
    );
    let doctor = id_of(
        &created(
            &app,
            ALPHA,
            &owner,
            "/api/v1/practitioners",
            json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
        )
        .await,
    );
    let patient = id_of(
        &created(
            &app,
            ALPHA,
            &desk,
            "/api/v1/patients",
            json!({ "full_name": "Anil" }),
        )
        .await,
    );
    let (status, headers, booked) = send(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/appointments",
        &desk,
        Some(json!({
            "patient_id": patient, "practitioner_id": doctor, "room_id": chair,
            "starts_at": "2030-01-07T10:00:00+05:30", "ends_at": "2030-01-07T10:30:00+05:30",
        })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{booked}");
    assert_eq!(booked["appointment"]["row_version"], 1);
    assert_eq!(etag(&headers), "\"1\"");
    let id = id_of(&booked["appointment"]);
    let path = format!("/api/v1/appointments/{id}");
    let status_path = format!("{path}/status");

    // A status change is a change: the version moves, and the answer carries it.
    let (status, headers, confirmed) = send(
        &app,
        Method::POST,
        ALPHA,
        &status_path,
        &desk,
        Some(json!({ "status": "confirmed" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["appointment"]["row_version"], 2);
    assert_eq!(etag(&headers), "\"2\"");

    let edit = async |changes: Value, if_match: Option<&str>| {
        send(
            &app,
            Method::PATCH,
            ALPHA,
            &path,
            &desk,
            Some(changes),
            if_match,
        )
        .await
    };
    let stale = edit(json!({ "reason": "Check-up" }), Some("\"1\"")).await;
    assert_stale(&stale, "\"2\"", "booked version");
    let (status, headers, edited) = edit(json!({ "reason": "Check-up" }), Some("\"2\"")).await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["appointment"]["row_version"], 3);
    assert_eq!(etag(&headers), "\"3\"");
    // Repeating the status change changes nothing, so the version holds.
    let (_, headers, again) = send(
        &app,
        Method::POST,
        ALPHA,
        &status_path,
        &desk,
        Some(json!({ "status": "confirmed" })),
        None,
    )
    .await;
    assert_eq!(again["appointment"]["row_version"], 3);
    assert_eq!(etag(&headers), "\"3\"");
    // Without If-Match an edit is unconditional, as before.
    let (status, _, plain) = edit(json!({ "notes": "Bring X-rays" }), None).await;
    assert_eq!(status, StatusCode::OK, "{plain}");
    assert_eq!(plain["appointment"]["row_version"], 4);
    let (_, _, day) = send(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/appointments?from=2030-01-07&to=2030-01-07",
        &desk,
        None,
        None,
    )
    .await;
    assert_eq!(day["items"][0]["row_version"], 4);

    // A finished appointment answers the precondition first: stale is 412, current is 409.
    let (status, _, _) = send(
        &app,
        Method::POST,
        ALPHA,
        &status_path,
        &desk,
        Some(json!({ "status": "cancelled", "reason": "Patient called" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_stale(
        &edit(json!({ "reason": "x" }), Some("\"4\"")).await,
        "\"5\"",
        "after cancel",
    );
    let (status, _, _) = edit(json!({ "reason": "x" }), Some("\"5\"")).await;
    assert_eq!(status, StatusCode::CONFLICT);

    for (token, host, if_match, expected) in [
        (&nothing, ALPHA, Some("\"5\""), StatusCode::FORBIDDEN),
        (&beta, BETA, Some("\"5\""), StatusCode::NOT_FOUND),
        (&beta, BETA, Some("\"1\""), StatusCode::NOT_FOUND),
    ] {
        let (status, _, _) = send(
            &app,
            Method::PATCH,
            host,
            &path,
            token,
            Some(json!({ "reason": "x" })),
            if_match,
        )
        .await;
        assert_eq!(status, expected, "{host} {if_match:?}");
    }
    app.finish().await;
}

/// A tiny `WebM` recording: the EBML header plus filler.
fn webm() -> Vec<u8> {
    let mut bytes = vec![0x1A, 0x45, 0xDF, 0xA3];
    bytes.extend_from_slice(&[9_u8; 1024]);
    bytes
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_draft_note_edit_can_be_made_conditional_on_the_version_read() {
    let app = TestApp::start().await;
    add_doctor(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let doctor = app.token(ALPHA_DOCTOR);
    let beta = app.token(BETA_OWNER);
    let nothing = app.token(ALPHA_NOTHING);
    let patient = id_of(
        &created(
            &app,
            ALPHA,
            &owner,
            "/api/v1/patients",
            json!({ "full_name": "Meera Shah" }),
        )
        .await,
    );
    let visit = id_of(
        &created(
            &app,
            ALPHA,
            &owner,
            &format!("/api/v1/patients/{patient}/visits"),
            json!({ "chief_complaint": "Pain" }),
        )
        .await,
    );
    let (status, headers, note) = send(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/visits/{visit}/notes"),
        &owner,
        Some(json!({ "sections": { "subjective": "Pain on chewing" } })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    assert_eq!(note["row_version"], 1);
    assert_eq!(etag(&headers), "\"1\"");
    let id = id_of(&note);
    let path = format!("/api/v1/notes/{id}");
    let edit = async |text: &str, token: &str, host: &str, if_match: Option<&str>| {
        let changes = json!({ "sections": { "subjective": text } });
        send(
            &app,
            Method::PATCH,
            host,
            &path,
            token,
            Some(changes),
            if_match,
        )
        .await
    };

    let (status, headers, edited) = edit("Pain on chewing, 36", &owner, ALPHA, Some("\"1\"")).await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["row_version"], 2);
    assert_eq!(etag(&headers), "\"2\"");
    let stale = edit("Overwritten", &owner, ALPHA, Some("\"1\"")).await;
    assert_stale(&stale, "\"2\"", "an older draft");

    // A recording attached to the draft marks it as voice, but that is not an edit of its text.
    let (status, file) = app
        .upload(
            ALPHA,
            &owner,
            &patient,
            &webm(),
            &[
                ("kind", "audio"),
                ("visit_id", visit.as_str()),
                ("note_id", id.as_str()),
                ("duration_seconds", "12"),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    let (_, _, detail) = send(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/visits/{visit}"),
        &owner,
        None,
        None,
    )
    .await;
    assert_eq!(detail["notes"][0]["source"], "voice");
    assert_eq!(detail["notes"][0]["row_version"], 2);
    let (status, _, again) = edit("Pain on chewing, 36 and 37", &owner, ALPHA, Some("\"2\"")).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["row_version"], 3);

    // Signing is a change and a repeat is not; a signed note refuses edits, stale or not.
    let sign = format!("{path}/sign");
    let (status, headers, signed) = send(
        &app,
        Method::POST,
        ALPHA,
        &sign,
        &owner,
        Some(json!({})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["row_version"], 4);
    assert_eq!(etag(&headers), "\"4\"");
    let (_, headers, repeated) = send(
        &app,
        Method::POST,
        ALPHA,
        &sign,
        &owner,
        Some(json!({})),
        None,
    )
    .await;
    assert_eq!(repeated["row_version"], 4);
    assert_eq!(etag(&headers), "\"4\"");
    let (status, _, _) = edit("Too late", &owner, ALPHA, Some("\"4\"")).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_stale(
        &edit("Too late", &owner, ALPHA, Some("\"3\"")).await,
        "\"4\"",
        "after signing",
    );
    // An addendum leaves the note itself as it was.
    let (status, headers, amended) = send(
        &app,
        Method::POST,
        ALPHA,
        &format!("{path}/addenda"),
        &owner,
        Some(json!({ "body": "Allergy noted" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{amended}");
    assert_eq!(amended["row_version"], 4);
    assert_eq!(etag(&headers), "\"4\"");
    let (status, headers, voided) = send(
        &app,
        Method::POST,
        ALPHA,
        &format!("{path}/entered-in-error"),
        &owner,
        Some(json!({ "reason": "wrong patient" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{voided}");
    assert_eq!(voided["row_version"], 5);
    assert_eq!(etag(&headers), "\"5\"");

    // Someone else's draft is theirs to edit whatever version you name; other clinics and roles
    // without clinical.write get what they always got.
    let (_, _, theirs) = send(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/visits/{visit}/notes"),
        &owner,
        Some(json!({ "sections": { "plan": "Review" } })),
        None,
    )
    .await;
    let draft = format!("/api/v1/notes/{}", id_of(&theirs));
    for (token, host, expected) in [
        (&doctor, ALPHA, StatusCode::FORBIDDEN),
        (&nothing, ALPHA, StatusCode::FORBIDDEN),
        (&beta, BETA, StatusCode::NOT_FOUND),
    ] {
        let (status, _, _) = send(
            &app,
            Method::PATCH,
            host,
            &draft,
            token,
            Some(json!({ "sections": { "plan": "Changed" } })),
            Some("\"1\""),
        )
        .await;
        assert_eq!(status, expected, "{host}");
    }
    app.finish().await;
}

/// The database's own bookkeeping: what moves the counter and what does not.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_counter_moves_only_when_the_record_changes() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = id_of(
        &created(
            &app,
            ALPHA,
            &owner,
            "/api/v1/patients",
            json!({ "full_name": "Meera Shah" }),
        )
        .await,
    );
    let version = async |sql: &str| -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
            .bind(&patient)
            .fetch_one(&app.owner)
            .await
            .unwrap()
    };
    let read = "select row_version from aarogyam.patients where id = $1::uuid";
    assert_eq!(version(read).await, 1);
    // Setting a column to the value it has, or one the system maintains by itself, is not a change.
    version("with u as (update aarogyam.patients set full_name = full_name where id = $1::uuid returning 1) select count(*) from u").await;
    version("with u as (update aarogyam.patients set last_visit_at = now() where id = $1::uuid returning 1) select count(*) from u").await;
    assert_eq!(version(read).await, 1);
    // A client cannot name its own version either.
    version("with u as (update aarogyam.patients set row_version = 99, full_name = 'Meera S.' where id = $1::uuid returning 1) select count(*) from u").await;
    assert_eq!(version(read).await, 2);
    app.finish().await;
}
