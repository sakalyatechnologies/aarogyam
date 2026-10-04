//! The console's Quality dashboard: `GET /api/v1/console/quality` reads recorded runs from a
//! directory of JSON files (`scripts/quality-run.sh`'s output). No patient data involved, so
//! these tests still need a database only because `PlatformRequest` looks up the caller's staff
//! role there.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_http::HttpConfig;
use serde_json::json;
use support::people::{ALPHA_OWNER, STAFF, STRANGER};
use support::{ALPHA, CONSOLE, TestApp};
use uuid::Uuid;

fn run_json(run_id: &str, started_at: &str, passed: u32, failed: u32) -> serde_json::Value {
    let failures: Vec<_> = (0..failed)
        .map(|n| json!({ "test": format!("suite::case_{n}"), "message": "assertion failed" }))
        .collect();
    json!({
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": started_at,
        "environment": "local",
        "commit": "abc123",
        "suites": [
            {
                "name": "aarogyam-dal (unit)",
                "kind": "unit",
                "passed": passed,
                "failed": failed,
                "skipped": 0,
                "duration_ms": 1234,
                "failures": failures,
            }
        ],
    })
}

async fn with_runs(files: &[(&str, serde_json::Value)]) -> (TestApp, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("aarogyam-quality-{}", Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    for (name, body) in files {
        std::fs::write(dir.join(name), serde_json::to_vec(body).unwrap()).unwrap();
    }
    let dir_for_state = dir.clone();
    let app = TestApp::start_custom(HttpConfig::default(), move |state| {
        state.with_quality_dir(dir_for_state)
    })
    .await;
    (app, dir)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_see_runs_newest_first_with_trend_and_failures() {
    let (app, _dir) = with_runs(&[
        (
            "2024-01-01T00-00-00Z.json",
            run_json("r1", "2024-01-01T00:00:00Z", 8, 2),
        ),
        (
            "2024-01-02T00-00-00Z.json",
            run_json("r2", "2024-01-02T00:00:00Z", 10, 0),
        ),
    ])
    .await;
    let staff = app.token(STAFF);
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/quality?limit=30",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let runs = body["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0]["run_id"], "r2", "newest first");
    let trend = body["trend"][0]["points"].as_array().unwrap();
    assert_eq!(trend[0]["run_id"], "r1", "trend is oldest first");
    assert_eq!(trend[1]["run_id"], "r2");
    // The newest run (r2) passed cleanly; no failing tests.
    assert_eq!(body["failing"].as_array().unwrap().len(), 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_newest_runs_failures_are_reported() {
    let (app, _dir) =
        with_runs(&[("only.json", run_json("r1", "2024-01-01T00:00:00Z", 8, 2))]).await;
    let staff = app.token(STAFF);
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/quality",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let failing = body["failing"].as_array().unwrap();
    assert_eq!(failing.len(), 2);
    assert_eq!(failing[0]["run_id"], "r1");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_malformed_file_is_skipped_not_fatal() {
    let dir = std::env::temp_dir().join(format!("aarogyam-quality-{}", Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("good.json"),
        serde_json::to_vec(&run_json("r1", "2024-01-01T00:00:00Z", 5, 0)).unwrap(),
    )
    .unwrap();
    std::fs::write(dir.join("broken.json"), b"{ not json").unwrap();
    std::fs::write(dir.join("ignore-me.txt"), b"not a run file").unwrap();
    let dir_for_state = dir.clone();
    let app = TestApp::start_custom(HttpConfig::default(), move |state| {
        state.with_quality_dir(dir_for_state)
    })
    .await;
    let staff = app.token(STAFF);
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/quality",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let runs = body["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1, "only the valid run counts: {body}");
    assert_eq!(runs[0]["run_id"], "r1");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn non_staff_are_forbidden_and_clinic_hosts_get_404() {
    let (app, _dir) = with_runs(&[]).await;
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/quality",
            Some(&app.token(STRANGER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/quality",
            Some(&app.token(ALPHA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/console/quality",
            Some(&app.token(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_missing_directory_is_an_empty_dashboard_not_an_error() {
    let dir = std::env::temp_dir().join(format!("aarogyam-quality-missing-{}", Uuid::now_v7()));
    let app = TestApp::start_custom(HttpConfig::default(), move |state| {
        state.with_quality_dir(dir)
    })
    .await;
    let staff = app.token(STAFF);
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/quality",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["runs"].as_array().unwrap().len(), 0);
    app.finish().await;
}
