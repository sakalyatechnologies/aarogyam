//! The metrics middleware on a small router behind the standard layers, wired as the
//! `metrics` module docs show.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

use std::sync::Arc;
use std::time::SystemTime;

use aarogyam_api::metrics::{ApiSnapshot, Range, ServiceMetrics, UNMATCHED, track};
use axum::Router;
use axum::body::Body;
use axum::http::header::HOST;
use axum::http::{Method, Request, StatusCode};
use axum::middleware::from_fn_with_state;
use axum::routing::{get, post};
use sakalya_http::HttpConfig;
use tower::ServiceExt;

/// Two routes, one that answers and one that fails, with the middleware outermost.
fn app(metrics: &Arc<ServiceMetrics>) -> Router {
    let routes = Router::new()
        .route("/patients/{id}", get(|| async { "patient" }))
        .route(
            "/visits",
            post(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        );
    sakalya_http::with_standard_layers(routes, &HttpConfig::default())
        .layer(from_fn_with_state(Arc::clone(metrics), track))
}

async fn send(app: &Router, method: Method, path: &str) -> StatusCode {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header(HOST, "sunrise.localtest.me")
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(request).await.unwrap().status()
}

fn rows(snapshot: &ApiSnapshot) -> Vec<(&str, &str, u64, f64)> {
    let rows = snapshot.routes.iter();
    rows.map(|row| (row.method, &*row.route, row.requests, row.error_rate))
        .collect()
}

#[tokio::test]
async fn requests_are_recorded_under_their_route_template() {
    let metrics = Arc::new(ServiceMetrics::new());
    let app = app(&metrics);
    for number in ["SC-1042", "SC-1043", "SC-1044"] {
        let status = send(&app, Method::GET, &format!("/patients/{number}")).await;
        assert_eq!(status, StatusCode::OK);
    }
    let snapshot = metrics.snapshot(Range::LastHour, SystemTime::now());
    assert_eq!(rows(&snapshot), [("GET", "/patients/{id}", 3, 0.0)]);
}

#[tokio::test]
async fn failures_and_unmatched_requests_are_counted() {
    let metrics = Arc::new(ServiceMetrics::new());
    let app = app(&metrics);
    let failed = send(&app, Method::POST, "/visits").await;
    assert_eq!(failed, StatusCode::INTERNAL_SERVER_ERROR);
    let unmatched = send(&app, Method::GET, "/nowhere").await;
    assert_eq!(unmatched, StatusCode::NOT_FOUND);
    let snapshot = metrics.snapshot(Range::LastHour, SystemTime::now());
    let expected = [("POST", "/visits", 1, 1.0), ("GET", UNMATCHED, 1, 0.0)];
    assert_eq!(rows(&snapshot), expected);
    assert_eq!(snapshot.requests, 2);
}
