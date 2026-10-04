//! The router in-process with no database: health, request IDs, the edge secret, and the
//! development sign-in route existing only with development tokens.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use aarogyam_api::{AppState, Hosts, TokenCheck, router};
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use sakalya_auth::{JwtConfig, JwtVerifier};
use sakalya_db::{Db, DbConfig};
use sakalya_http::{EdgeConfig, EdgeSecret, HttpConfig, REQUEST_ID_HEADER};
use sakalya_throttle::{KeyKind, RuleConfig, Throttle, ThrottleConfig};
use secrecy::SecretString;
use serde_json::json;
use support::{offline_router, offline_state, send};
use tower::ServiceExt;

#[tokio::test]
async fn health_check_answers_ok_with_a_request_id() {
    let request = Request::get("/healthz")
        .header("host", "localhost")
        .body(Body::empty())
        .unwrap();
    let response = offline_router(HttpConfig::default())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key(REQUEST_ID_HEADER));
    let body = to_bytes(response.into_body(), 64).await.unwrap();
    assert_eq!(&body[..], b"ok");
}

#[tokio::test]
async fn unknown_api_route_is_not_found() {
    let router = offline_router(HttpConfig::default());
    let (status, _) = send(
        &router,
        Method::GET,
        "localhost",
        "/api/v1/does-not-exist",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn development_tokens_are_minted_locally() {
    let router = offline_router(HttpConfig::default());
    let body = json!({ "auth_uid": "a0000000-0000-4000-8000-000000000001" });
    let (status, token) = send(
        &router,
        Method::POST,
        "localhost",
        "/api/v1/dev/token",
        None,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(token["expires_in"], 3600);
    assert_eq!(
        token["access_token"].as_str().unwrap().split('.').count(),
        3
    );
}

#[tokio::test]
async fn deployed_servers_have_no_development_sign_in() {
    let url = SecretString::from("postgres://aarogyam_api@localhost:5432/never_contacted");
    let db = Db::connect_lazy(&DbConfig::new(url)).unwrap();
    let verifier = JwtVerifier::remote(JwtConfig::new(
        "https://example.supabase.co/auth/v1",
        "authenticated",
        "https://example.supabase.co/auth/v1/.well-known/jwks.json",
    ))
    .unwrap();
    let hosts = Hosts {
        portal_domain: "aarogyam.example".into(),
        console: "console.aarogyam.example".into(),
        app: "app.aarogyam.example".into(),
    };
    let router = router(AppState::new(
        db,
        HttpConfig::default(),
        TokenCheck::Supabase(verifier),
        hosts,
    ));
    let body = json!({ "auth_uid": "a0000000-0000-4000-8000-000000000001" });
    let (status, _) = send(
        &router,
        Method::POST,
        "app.aarogyam.example",
        "/api/v1/dev/token",
        None,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn behind_the_edge_requests_without_the_secret_are_refused() {
    let secret =
        EdgeSecret::new(SecretString::from("an-edge-secret-of-at-least-32-bytes!")).unwrap();
    let router = offline_router(HttpConfig::default().with_edge(EdgeConfig::new(secret)));
    // Straight at the Cloud Run URL: no secret, so the API pretends nothing is there.
    let (status, _) = send(
        &router,
        Method::GET,
        "aarogyam-api.a.run.app",
        "/api/v1/me",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Probes still reach the health check.
    let (status, _) = send(
        &router,
        Method::GET,
        "aarogyam-api.a.run.app",
        "/healthz",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn floods_are_refused_before_any_token_is_checked() {
    let throttle = Throttle::new(ThrottleConfig::default().with_rules(vec![RuleConfig::new(
        "ip",
        KeyKind::Ip,
        2,
        60,
    )]))
    .unwrap();
    let router = router(offline_state(HttpConfig::default()).with_throttle(throttle));
    for _ in 0..2 {
        let (status, _) = send(&router, Method::GET, "localhost", "/api/v1/me", None, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    let (status, _) = send(&router, Method::GET, "localhost", "/api/v1/me", None, None).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    // Health checks are never throttled.
    let (status, _) = send(&router, Method::GET, "localhost", "/healthz", None, None).await;
    assert_eq!(status, StatusCode::OK);
}
