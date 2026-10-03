//! The router in-process, with the standard middleware applied and no database.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

use aarogyam_api::{AppState, router};
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use axum::response::Response;
use sakalya_db::{Db, DbConfig};
use sakalya_http::{HttpConfig, REQUEST_ID_HEADER};
use secrecy::SecretString;
use tower::ServiceExt;

/// A state whose pool connects on first use, which these routes never trigger.
fn state() -> AppState {
    let url = SecretString::from("postgres://aarogyam_api@localhost:5432/never_contacted");
    let db = Db::connect_lazy(&DbConfig::new(url)).unwrap();
    AppState::new(db, HttpConfig::default())
}

async fn get(path: &str) -> Response {
    let request = Request::get(path).body(Body::empty()).unwrap();
    router(state()).oneshot(request).await.unwrap()
}

#[tokio::test]
async fn health_check_answers_ok() {
    let response = get("/healthz").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 64).await.unwrap();
    assert_eq!(&body[..], b"ok");
}

#[tokio::test]
async fn responses_carry_a_request_id() {
    let response = get("/healthz").await;
    assert!(response.headers().contains_key(REQUEST_ID_HEADER));
}

#[tokio::test]
async fn unknown_api_route_is_not_found() {
    let response = get("/api/v1/does-not-exist").await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
