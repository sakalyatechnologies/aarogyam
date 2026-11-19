//! The console's cost estimate (`/api/v1/console/insights/cost`). Sakalya staff only, console
//! host only. Tests have no metadata server, so Cloud Run usage is unavailable and only the free
//! plans show; the pricing itself is tested in `aarogyam_app::cloud_cost`.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use support::people::{ALPHA_OWNER, STAFF, STRANGER};
use support::{ALPHA, CONSOLE, TestApp};

const PATH: &str = "/api/v1/console/insights/cost";

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_cost_estimate_is_for_sakalya_staff_on_the_console_only() {
    let app = TestApp::start().await;
    for person in [ALPHA_OWNER, STRANGER] {
        let (status, body) = app
            .send(Method::GET, CONSOLE, PATH, Some(&app.token(person)), None)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
    // Not on a clinic's host, even for staff.
    let (status, _) = app
        .send(Method::GET, ALPHA, PATH, Some(&app.token(STAFF)), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app.send(Method::GET, CONSOLE, PATH, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn off_cloud_run_the_estimate_says_so_and_shows_the_free_plans() {
    let app = TestApp::start().await;
    let (status, body) = app
        .send(Method::GET, CONSOLE, PATH, Some(&app.token(STAFF)), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["source"], "unavailable");
    assert!(body["error"].is_null());
    assert!(body["total_usd"].is_null());
    assert!(body["forecast_inr"].is_null());
    assert_eq!(body["gst_percent"], 18.0);
    assert_eq!(
        body["billing_url"],
        "https://console.cloud.google.com/billing"
    );
    assert!(
        body["label"]
            .as_str()
            .unwrap()
            .contains("the free tier is shared across the billing account")
    );
    let items = body["items"].as_array().unwrap();
    let keys: Vec<_> = items
        .iter()
        .map(|item| item["key"].as_str().unwrap())
        .collect();
    assert_eq!(keys, ["supabase_db", "cloudflare"]);
    let db = &items[0];
    assert!(db["used"].as_f64().unwrap() > 0.0);
    assert_eq!(db["free"], 500.0 * 1024.0 * 1024.0);
    assert_eq!(db["cost_usd"], 0.0);
    assert!(items[1]["used"].is_null());
    let fraction = body["elapsed_fraction"].as_f64().unwrap();
    assert!(fraction > 0.0 && fraction <= 1.0);
    app.finish().await;
}
