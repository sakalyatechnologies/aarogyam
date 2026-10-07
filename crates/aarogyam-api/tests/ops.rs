//! Pilot operations: the public health route, the client error endpoint (open to anyone, limited
//! per IP and in size, nothing stored) and 5xx reporting in Error Reporting's shape.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use std::sync::{Arc, Mutex};

use aarogyam_api::{ErrorReporting, router, standard_throttle};
use axum::Router;
use axum::http::{Method, StatusCode};
use axum::routing::get;
use sakalya_http::HttpConfig;
use serde_json::{Value, json};
use support::{offline_state, send};

#[expect(clippy::panic, reason = "the point of the test")]
async fn boom() -> &'static str {
    panic!("patient Asha Rao")
}

fn collecting() -> (Arc<ErrorReporting>, Arc<Mutex<Vec<Value>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let reporting = Arc::new(ErrorReporting::with_sink(
        "aarogyam-api",
        "test",
        move |line| {
            sink.lock()
                .unwrap()
                .push(serde_json::from_str(line).unwrap());
        },
    ));
    (reporting, lines)
}

#[tokio::test]
async fn health_is_public_and_touches_nothing() {
    let app = router(offline_state(HttpConfig::default()));
    let (status, body) = send(&app, Method::GET, "localhost", "/api/v1/health", None, None).await;
    assert_eq!((status, body), (StatusCode::OK, json!({ "status": "ok" })));
}

#[tokio::test]
async fn a_client_error_is_logged_scrubbed_and_nothing_else() {
    let (reporting, lines) = collecting();
    let app = router(offline_state(HttpConfig::default()).with_error_reporting(reporting));
    let report = json!({
        "app": "portal",
        "name": "TypeError",
        "message": "no record for 'Asha Rao', phone +91 98765 43210, asha@clinic.in",
        "stack": "TypeError\n    at show (https://p.example/assets/a.js?token=abc:10:5)",
        "page": "/patients/SC-1042?name=Asha",
        "request_id": "0192abcd-0000-7000-8000-000000000000",
    });
    let (status, _) = send(
        &app,
        Method::POST,
        "localhost",
        "/api/v1/client-errors",
        None,
        Some(report),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let lines = lines.lock().unwrap();
    assert_eq!(lines.len(), 1);
    let line = lines[0].to_string();
    for private in ["Asha", "98765", "asha@", "token=abc", "SC-1042"] {
        assert!(!line.contains(private), "{private} leaked into {line}");
    }
    assert_eq!(lines[0]["serviceContext"]["service"], "aarogyam-web-portal");
    assert_eq!(
        lines[0]["context"]["reportLocation"]["filePath"],
        "/patients/:id"
    );
    assert_eq!(
        lines[0]["request_id"],
        "0192abcd-0000-7000-8000-000000000000"
    );
}

#[tokio::test]
async fn client_errors_need_no_sign_in_but_must_say_something() {
    let app = router(offline_state(HttpConfig::default()));
    let (status, _) = send(
        &app,
        Method::POST,
        "localhost",
        "/api/v1/client-errors",
        None,
        Some(json!({ "app": "portal", "message": "boom" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(
        &app,
        Method::POST,
        "localhost",
        "/api/v1/client-errors",
        None,
        Some(json!({ "app": "portal", "message": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn client_errors_are_limited_per_ip_and_in_size() {
    let app =
        router(offline_state(HttpConfig::default()).with_throttle(standard_throttle().unwrap()));
    let small = json!({ "app": "portal", "message": "boom" });
    for _ in 0..20 {
        let (status, _) = send(
            &app,
            Method::POST,
            "localhost",
            "/api/v1/client-errors",
            None,
            Some(small.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    let (status, _) = send(
        &app,
        Method::POST,
        "localhost",
        "/api/v1/client-errors",
        None,
        Some(small),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);

    let app = router(offline_state(HttpConfig::default()));
    let huge = json!({ "app": "portal", "message": "x".repeat(20_000) });
    let (status, _) = send(
        &app,
        Method::POST,
        "localhost",
        "/api/v1/client-errors",
        None,
        Some(huge),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn a_server_error_is_reported_with_its_request_id_and_no_path_data() {
    let (reporting, lines) = collecting();
    // A panicking route behind the same layers as the API.
    let routes = Router::new()
        .route("/boom/{id}", get(boom))
        .route("/fine", get(|| async { "ok" }));
    let app = sakalya_http::with_standard_layers(routes, &HttpConfig::default()).layer(
        axum::middleware::from_fn_with_state(
            reporting,
            aarogyam_api::error_report::report_server_errors,
        ),
    );
    let (status, _) = send(&app, Method::GET, "localhost", "/fine", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(
        &app,
        Method::GET,
        "localhost",
        "/boom/Asha-Rao-9876543210",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let lines = lines.lock().unwrap();
    assert_eq!(lines.len(), 1, "only the 500 is reported");
    let event = &lines[0];
    assert_eq!(event["message"], "HTTP 500 GET /boom/{id}");
    assert_eq!(event["context"]["httpRequest"]["url"], "/boom/{id}");
    assert!(
        event["request_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
    );
    let text = event.to_string();
    assert!(!text.contains("Asha") && !text.contains("9876543210"));
}
