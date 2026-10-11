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
    let request = Request::builder()
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
    assert!(
        stream
            .until("event: notification.created", Duration::from_secs(10))
            .await
    );
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
