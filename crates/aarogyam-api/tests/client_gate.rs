//! The version gate: an app below its minimum is told to update (`426`) before anything else
//! looks at the request, browsers and unknown apps are never refused, and `GET /api/v1/meta`
//! says which versions are served.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_api::router;
use aarogyam_domain::client::ClientPolicy;
use axum::Router;
use axum::http::{Method, StatusCode};
use sakalya_http::HttpConfig;
use serde_json::{Value, json};
use support::{ALPHA, offline_state, send_with_headers};

fn app(min: &str, latest: &str) -> Router {
    let policy = ClientPolicy::parse(min, latest).unwrap();
    router(offline_state(HttpConfig::default()).with_client_policy(policy))
}

/// Sends a request, naming the app in `x-client` when `client` is given.
async fn call(
    router: &Router,
    method: Method,
    path: &str,
    client: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let headers: Vec<(&str, &str)> = client
        .map(|value| ("x-client", value))
        .into_iter()
        .collect();
    send_with_headers(router, method, ALPHA, path, None, body, &headers).await
}

#[tokio::test]
async fn an_app_below_its_minimum_is_told_to_update() {
    let router = app("aarogyam-staff=0.2.0", "aarogyam-staff=0.3.1");
    for old in [
        "aarogyam-staff/0.1.9",
        "aarogyam-staff/0.1.0",
        "aarogyam-staff/0.0.1",
        // A pre-release counts as the release it leads up to.
        "aarogyam-staff/0.1.9-beta.2+45",
    ] {
        for (method, path, body) in [
            (Method::GET, "/api/v1/session", None),
            (Method::GET, "/api/v1/me", None),
            (Method::POST, "/api/v1/patients/search", Some(json!({}))),
            (Method::GET, "/api/v1/public/booking", None),
        ] {
            let (status, error) = call(&router, method.clone(), path, Some(old), body).await;
            assert_eq!(
                status,
                StatusCode::UPGRADE_REQUIRED,
                "{old} {method} {path}"
            );
            assert_eq!(error["error"]["code"], "client_upgrade_required");
            assert!(error["error"]["message"].is_string());
        }
    }
}

#[tokio::test]
async fn everyone_else_gets_through_to_the_route() {
    let router = app("aarogyam-staff=0.2.0", "");
    // Past the gate these routes ask for a sign-in, which this request doesn't have.
    for client in [
        Some("aarogyam-staff/0.2.0"),
        // A beta of the minimum release counts as that release.
        Some("aarogyam-staff/0.2.0-beta.2"),
        // Numbers, not text: 0.10.0 is newer than 0.9.0.
        Some("aarogyam-staff/0.10.0"),
        Some("aarogyam-staff/1.0.0"),
        // Another app, one that isn't listed, and headers that aren't <app>/<version>.
        Some("aarogyam-patient/0.0.1"),
        Some("garbage"),
        Some("aarogyam-staff/"),
        Some("aarogyam-staff/one.two.three"),
        Some("Aarogyam-Staff/0.0.1"),
        // A browser sends no such header.
        None,
    ] {
        let (status, _) = call(&router, Method::GET, "/api/v1/me", client, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{client:?}");
    }
    // With no minimum set at all, nothing is refused.
    let open = app("", "");
    let (status, _) = call(
        &open,
        Method::GET,
        "/api/v1/me",
        Some("aarogyam-staff/0.0.1"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn meta_is_public_and_an_old_app_can_still_read_it() {
    let router = app("aarogyam-staff=0.2.0", "aarogyam-staff=0.3.1");
    for client in [
        None,
        Some("aarogyam-staff/0.1.0"),
        Some("aarogyam-staff/0.3.1"),
    ] {
        let (status, meta) = call(&router, Method::GET, "/api/v1/meta", client, None).await;
        assert_eq!(status, StatusCode::OK, "{client:?}");
        assert_eq!(
            meta,
            json!({ "clients": [{
                "app": "aarogyam-staff", "min_version": "0.2.0", "latest_version": "0.3.1",
            }] })
        );
    }
    // Liveness checks never carry the header, and are not gated if they do.
    let (status, _) = call(
        &router,
        Method::GET,
        "/healthz",
        Some("aarogyam-staff/0.1.0"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Latest never trails the minimum, an app named only in latest has no minimum, and with
    // nothing configured the list is empty.
    let router = app(
        "aarogyam-staff=2.0.0",
        "aarogyam-staff=1.0.0,aarogyam-patient=0.5.0",
    );
    let (_, meta) = call(&router, Method::GET, "/api/v1/meta", None, None).await;
    assert_eq!(
        meta["clients"],
        json!([
            { "app": "aarogyam-patient", "min_version": "0.0.0", "latest_version": "0.5.0" },
            { "app": "aarogyam-staff", "min_version": "2.0.0", "latest_version": "2.0.0" },
        ])
    );
    let (status, meta) = call(&app("", ""), Method::GET, "/api/v1/meta", None, None).await;
    assert_eq!((status, meta), (StatusCode::OK, json!({ "clients": [] })));
}
