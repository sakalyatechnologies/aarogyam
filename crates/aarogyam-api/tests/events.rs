//! The live event stream: events after a queue change, identifiers only, a permission, and the
//! clinic boundary.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use std::time::Duration;

use axum::body::{Body, BodyDataStream};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tokio_stream::StreamExt;
use tower::ServiceExt;

struct Stream {
    body: BodyDataStream,
    seen: String,
}

async fn open(app: &TestApp, host: &str, token: &str, query: &str) -> (StatusCode, Option<Stream>) {
    open_after(app, host, token, query, None).await
}

async fn open_after(
    app: &TestApp,
    host: &str,
    token: &str,
    query: &str,
    last_id: Option<&str>,
) -> (StatusCode, Option<Stream>) {
    let mut builder = Request::builder();
    if let Some(last_id) = last_id {
        builder = builder.header("last-event-id", last_id);
    }
    let request = builder
        .method(Method::GET)
        .uri(format!("/api/v1/events{query}"))
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    if status != StatusCode::OK {
        return (status, None);
    }
    assert_eq!(
        response.headers()["content-type"],
        "text/event-stream",
        "the stream's content type"
    );
    let stream = Stream {
        body: response.into_body().into_data_stream(),
        seen: String::new(),
    };
    (status, Some(stream))
}

impl Stream {
    /// Reads until the text seen contains `needle`; false on timeout.
    async fn until(&mut self, needle: &str, wait: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + wait;
        while !self.seen.contains(needle) {
            match tokio::time::timeout_at(deadline, self.body.next()).await {
                Ok(Some(Ok(bytes))) => self.seen.push_str(&String::from_utf8_lossy(&bytes)),
                _ => return false,
            }
        }
        true
    }
}

async fn post(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "{path}: {status} {value}");
    value
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn switched_off_the_stream_answers_404_so_clients_keep_polling() {
    let app = TestApp::start_custom(sakalya_http::HttpConfig::default(), |state| {
        state.with_live_events(false)
    })
    .await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, stream) = open(&app, ALPHA, &desk, "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(stream.is_none());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_queue_change_reaches_the_stream_with_identifiers_only() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let owner = app.token(ALPHA_OWNER);
    let (status, stream) = open(&app, ALPHA, &desk, "").await;
    assert_eq!(status, StatusCode::OK);
    let mut stream = stream.unwrap();
    assert!(stream.until("event: ready", Duration::from_secs(10)).await);

    let patient = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients",
        json!({ "full_name": "Zubin Mehta", "sex": "male", "age_years": 40 }),
    )
    .await;
    let token = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/queue",
        json!({ "patient_id": patient["id"] }),
    )
    .await;
    let id = token["id"].as_str().unwrap();
    assert!(
        stream
            .until("event: queue.changed", Duration::from_secs(10))
            .await
    );

    post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/queue/{id}/call"),
        json!({}),
    )
    .await;
    assert!(stream.until(id, Duration::from_secs(10)).await);
    assert!(
        !stream.seen.contains("Zubin"),
        "no patient data: {}",
        stream.seen
    );
    assert!(!stream.seen.contains("Mehta"));

    post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/queue/{id}/start-visit"),
        json!({}),
    )
    .await;
    assert!(
        stream
            .until("event: visit.changed", Duration::from_secs(10))
            .await
    );
    // Sending the patient in writes the `send_in` staff notification (migration 0617).
    assert!(
        stream
            .until("event: notification.created", Duration::from_secs(10))
            .await
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_never_sees_these_events_or_branches() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let (_, stream) = open(&app, BETA, &beta, "").await;
    let mut stream = stream.unwrap();
    assert!(stream.until("event: ready", Duration::from_secs(10)).await);

    let patient = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients",
        json!({ "full_name": "Asha Rao", "sex": "female", "age_years": 30 }),
    )
    .await;
    let token = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/queue",
        json!({ "patient_id": patient["id"] }),
    )
    .await;
    assert!(
        !stream
            .until("event: queue.changed", Duration::from_secs(2))
            .await,
        "clinic B saw clinic A's event: {}",
        stream.seen
    );
    // Clinic A's branch is not a branch of clinic B.
    let branch = token["branch_id"].as_str().unwrap();
    let (status, _) = open(&app, BETA, &beta, &format!("?branch_id={branch}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Its own branch works and filters.
    let (status, _) = open(&app, ALPHA, &desk, &format!("?branch_id={branch}")).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = open(&app, ALPHA, &desk, "?branch_id=nope").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_stream_needs_a_signed_in_member_with_appointments_read() {
    let app = TestApp::start().await;
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = open(&app, ALPHA, &nothing, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/events", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

/// The id of the first event named `name` in what the stream has shown.
fn id_of(seen: &str, name: &str) -> i64 {
    let at = seen.find(&format!("event: {name}")).unwrap();
    let before = &seen[..at];
    let line = before
        .lines()
        .rev()
        .find(|line| line.starts_with("id: "))
        .or_else(|| seen[at..].lines().find(|line| line.starts_with("id: ")))
        .unwrap();
    line.trim_start_matches("id: ").parse().unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_reconnect_with_last_event_id_replays_what_it_missed_or_resets() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, stream) = open(&app, ALPHA, &desk, "").await;
    let mut stream = stream.unwrap();
    assert!(stream.until("event: ready", Duration::from_secs(10)).await);
    let patient = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients",
        json!({ "full_name": "Rita Shah", "sex": "female", "age_years": 33 }),
    )
    .await;
    post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/queue",
        json!({ "patient_id": patient["id"] }),
    )
    .await;
    assert!(
        stream
            .until("event: queue.changed", Duration::from_secs(10))
            .await
    );
    // The stream drops. Meanwhile the patient is moved on.
    let first = id_of(&stream.seen, "queue.changed");
    drop(stream);
    let token = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/queue",
        json!({ "patient_id": patient["id"] }),
    )
    .await;
    let missed = token["id"].as_str().unwrap().to_owned();

    // Resume after the first event: the missed one comes back, with an id past the first.
    let (status, stream) = open_after(&app, ALPHA, &desk, "", Some(&first.to_string())).await;
    assert_eq!(status, StatusCode::OK);
    let mut stream = stream.unwrap();
    assert!(stream.until(&missed, Duration::from_secs(10)).await);
    assert!(id_of(&stream.seen, "queue.changed") > first);
    assert!(!stream.seen.contains("event: resync"));
    assert!(!stream.seen.contains("Shah"));
    drop(stream);

    // An id from the future (or another database) cannot be resumed: resync.
    let (_, stream) = open_after(&app, ALPHA, &desk, "", Some("999999999999")).await;
    let mut stream = stream.unwrap();
    assert!(stream.until("event: resync", Duration::from_secs(10)).await);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_appointment_status_change_is_signalled_to_its_clinic_only() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let (_, a) = open(&app, ALPHA, &owner, "").await;
    let (_, b) = open(&app, BETA, &beta, "").await;
    let (mut a, mut b) = (a.unwrap(), b.unwrap());
    assert!(a.until("event: ready", Duration::from_secs(10)).await);
    assert!(b.until("event: ready", Duration::from_secs(10)).await);

    let chair = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/rooms",
        json!({ "name": "Chair 1" }),
    )
    .await;
    let doctor = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
    )
    .await;
    let patient = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Zubin Mehta", "sex": "male", "age_years": 40 }),
    )
    .await;
    let saved = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/appointments",
        json!({
            "patient_id": patient["id"], "practitioner_id": doctor["id"], "room_id": chair["id"],
            "starts_at": "2031-03-03T10:00:00+05:30", "ends_at": "2031-03-03T10:30:00+05:30",
            "reason": "Check-up"
        }),
    )
    .await;
    let id = saved["appointment"]["id"].as_str().unwrap();
    assert!(
        a.until("event: appointment.changed", Duration::from_secs(10))
            .await
    );
    sqlx::query("update aarogyam.appointments set status = 'no_show' where id = $1::uuid")
        .bind(id)
        .execute(&app.owner)
        .await
        .unwrap();
    assert!(
        a.until(&format!("\"id\":\"{id}\""), Duration::from_secs(10))
            .await,
        "{}",
        a.seen
    );
    for secret in ["Zubin", "Mehta", "Check-up", "no_show"] {
        assert!(
            !a.seen.contains(secret),
            "payload leaks {secret}: {}",
            a.seen
        );
    }
    assert!(
        !b.until("appointment.changed", Duration::from_secs(2)).await,
        "clinic B saw clinic A's event: {}",
        b.seen
    );
    app.finish().await;
}
