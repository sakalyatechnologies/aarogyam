//! Real sign-in: Supabase tokens checked against published keys (the testkit's JWKS server),
//! and development tokens accepted beside them only when configured for local development.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use aarogyam_api::TokenCheck;
use axum::http::{Method, StatusCode};
use sakalya_auth::{JwtConfig, JwtVerifier};
use sakalya_http::HttpConfig;
use sakalya_testkit::{JwksServer, TestIssuer, TestKey, unix_now};
use support::people::{ALPHA_FRONT_DESK, ALPHA_OWNER};
use support::{ALPHA, TestApp, dev_tokens};

const ISSUER: &str = "https://project.supabase.test/auth/v1";

async fn supabase_verifier() -> (JwksServer, JwtVerifier) {
    let jwks = JwksServer::start(&[TestKey::Current]).await.unwrap();
    let verifier =
        JwtVerifier::remote(JwtConfig::new(ISSUER, "authenticated", jwks.url())).unwrap();
    (jwks, verifier)
}

async fn session(app: &TestApp, token: &str) -> StatusCode {
    app.send(Method::GET, ALPHA, "/api/v1/session", Some(token), None)
        .await
        .0
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn supabase_tokens_are_checked_against_the_published_keys() {
    let (_jwks, verifier) = supabase_verifier().await;
    let app = TestApp::start_configured(
        HttpConfig::default(),
        TokenCheck::Supabase(verifier),
        |state| state,
    )
    .await;
    let issuer = TestIssuer::new(ISSUER, "authenticated");

    let valid = issuer.mint(ALPHA_OWNER).sign().unwrap();
    assert_eq!(session(&app, &valid).await, StatusCode::OK);

    let wrong_audience = TestIssuer::new(ISSUER, "service_role")
        .mint(ALPHA_OWNER)
        .sign()
        .unwrap();
    assert_eq!(
        session(&app, &wrong_audience).await,
        StatusCode::UNAUTHORIZED
    );

    let expired = issuer
        .mint(ALPHA_OWNER)
        .expires_at(unix_now() - 3600)
        .sign()
        .unwrap();
    assert_eq!(session(&app, &expired).await, StatusCode::UNAUTHORIZED);

    let anonymous = issuer.mint(ALPHA_OWNER).anonymous(true).sign().unwrap();
    assert_eq!(session(&app, &anonymous).await, StatusCode::UNAUTHORIZED);

    let other_issuer = TestIssuer::new("https://elsewhere.test/auth/v1", "authenticated")
        .mint(ALPHA_OWNER)
        .sign()
        .unwrap();
    assert_eq!(session(&app, &other_issuer).await, StatusCode::UNAUTHORIZED);

    // Without development tokens configured, a development token is refused, and the
    // development sign-in route doesn't exist.
    let dev = app.token(ALPHA_OWNER);
    assert_eq!(session(&app, &dev).await, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/dev/token",
            None,
            Some(serde_json::json!({ "auth_uid": ALPHA_OWNER })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn locally_both_kinds_of_token_work_side_by_side() {
    let (_jwks, verifier) = supabase_verifier().await;
    let app = TestApp::start_configured(
        HttpConfig::default(),
        TokenCheck::SupabaseAndDev {
            supabase: verifier,
            dev: dev_tokens(),
        },
        |state| state,
    )
    .await;
    let supabase = TestIssuer::new(ISSUER, "authenticated")
        .mint(ALPHA_OWNER)
        .sign()
        .unwrap();
    assert_eq!(session(&app, &supabase).await, StatusCode::OK);
    let dev = app.token(ALPHA_FRONT_DESK);
    assert_eq!(session(&app, &dev).await, StatusCode::OK);

    // A token naming the development issuer is checked with the development secret only, so
    // a Supabase-signed token can't pass as one, nor the reverse.
    let forged = TestIssuer::new("aarogyam-test", "authenticated")
        .mint(ALPHA_OWNER)
        .sign()
        .unwrap();
    assert_eq!(session(&app, &forged).await, StatusCode::UNAUTHORIZED);
    assert_eq!(session(&app, "not.a.token").await, StatusCode::UNAUTHORIZED);
    app.finish().await;
}
