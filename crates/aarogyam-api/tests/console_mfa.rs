//! Sakalya staff need a second step (`aal2`) for every console route; clinic routes don't.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_http::HttpConfig;
use support::people::{ALPHA_OWNER, STAFF};
use support::{ALPHA, CONSOLE, TestApp};

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn console_routes_need_the_second_step() {
    let app = TestApp::start().await;
    let routes = [
        "/api/v1/console/clinics",
        "/api/v1/console/metrics",
        "/api/v1/console/quality",
    ];
    for path in routes {
        // One factor only: refused, with a code the console recognises.
        let (status, body) = app
            .send(
                Method::GET,
                CONSOLE,
                path,
                Some(&app.token_aal1(STAFF)),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_eq!(body["error"]["code"], "mfa_required", "{path}: {body}");
        // Both factors: allowed (a missing quality directory is a 200 or 404, never 403).
        let (status, body) = app
            .send(Method::GET, CONSOLE, path, Some(&app.token(STAFF)), None)
            .await;
        assert_ne!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_ne!(status, StatusCode::UNAUTHORIZED, "{path}: {body}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn console_needs_no_second_step_when_the_setting_is_off() {
    let app =
        TestApp::start_custom(HttpConfig::default(), |state| state.with_staff_mfa(false)).await;
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&app.token_aal1(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The console reads the setting from /me to skip its own gate.
    let (_, me) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/me",
            Some(&app.token_aal1(STAFF)),
            None,
        )
        .await;
    assert_eq!(me["staff_mfa_required"], false, "{me}");
    // Someone who isn't staff is still refused.
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&app.token_aal1(ALPHA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn people_who_are_not_staff_learn_nothing_about_the_second_step() {
    let app = TestApp::start().await;
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&app.token_aal1(ALPHA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"]["code"], "forbidden", "{body}");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn clinic_users_are_unaffected() {
    let app = TestApp::start().await;
    // A clinic member with one factor still works in the clinic.
    let (status, body) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/patients",
            Some(&app.token_aal1(ALPHA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    app.finish().await;
}
