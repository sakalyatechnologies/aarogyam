//! Clinic opening hours on a real database: saving and reading a week with split shifts, bad
//! weeks refused, roles and other clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, DbErrorKind, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn put(app: &TestApp, host: &str, token: &str, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::PUT,
        host,
        "/api/v1/clinic-hours",
        Some(token),
        Some(body),
    )
    .await
}

async fn get(app: &TestApp, host: &str, token: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, "/api/v1/clinic-hours", Some(token), None)
        .await
}

fn split_week() -> Value {
    json!({ "shifts": [
        { "weekday": 1, "starts": "17:00", "ends": "20:00" },
        { "weekday": 1, "starts": "10:00", "ends": "13:00" },
        { "weekday": 6, "starts": "10:00", "ends": "14:00" }
    ] })
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_week_with_split_shifts_is_saved_and_read_back() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, empty) = get(&app, ALPHA, &owner).await;
    assert_eq!(status, StatusCode::OK, "{empty}");
    assert_eq!(empty["shifts"], json!([]));

    let (status, saved) = put(&app, ALPHA, &owner, split_week()).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let times: Vec<(u64, &str, &str)> = saved["shifts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            let text = |key: &str| s[key].as_str().unwrap();
            (s["weekday"].as_u64().unwrap(), text("starts"), text("ends"))
        })
        .collect();
    assert_eq!(
        times,
        [
            (1, "10:00", "13:00"),
            (1, "17:00", "20:00"),
            (6, "10:00", "14:00")
        ]
    );
    let (_, read) = get(&app, ALPHA, &owner).await;
    assert_eq!(read["shifts"], saved["shifts"]);

    // Saving again replaces the week; an empty list clears it.
    let (status, _) = put(&app, ALPHA, &owner, json!({ "shifts": [] })).await;
    assert_eq!(status, StatusCode::OK);
    let (_, cleared) = get(&app, ALPHA, &owner).await;
    assert_eq!(cleared["shifts"], json!([]));

    for body in [
        json!({ "shifts": [{ "weekday": 8, "starts": "10:00", "ends": "11:00" }] }),
        json!({ "shifts": [{ "weekday": 1, "starts": "12:00", "ends": "11:00" }] }),
        json!({ "shifts": [{ "weekday": 1, "starts": "10:00", "ends": "12:00" },
                           { "weekday": 1, "starts": "11:00", "ends": "13:00" }] }),
        json!({ "shifts": [{ "weekday": 1, "starts": "10am", "ends": "11:00" }] }),
        json!({ "branch_id": "not-an-id", "shifts": [] }),
        json!({ "branch_id": "01900000-0000-7000-8000-000000000999", "shifts": [] }),
    ] {
        let (status, error) = put(&app, ALPHA, &owner, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    // A misspelt field is refused rather than ignored.
    let (status, _) = put(&app, ALPHA, &owner, json!({ "shifts": [], "branch": "x" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn roles_and_other_clinics() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    put(&app, ALPHA, &owner, split_week()).await;

    // The front desk reads the hours but can't change them; a role with nothing does neither.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = get(&app, ALPHA, &desk).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = put(&app, ALPHA, &desk, json!({ "shifts": [] })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = get(&app, ALPHA, &nothing).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic's owner gets 404 on Alpha's host, and sees none of Alpha's hours at home.
    let beta = app.token(BETA_OWNER);
    let (status, _) = get(&app, ALPHA, &beta).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = put(&app, ALPHA, &beta, json!({ "shifts": [] })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, home) = get(&app, BETA, &beta).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(home["shifts"], json!([]));
    let (_, kept) = get(&app, ALPHA, &owner).await;
    assert_eq!(kept["shifts"].as_array().unwrap().len(), 3);

    // Beta can't hang hours on Alpha's branch, even writing the row directly.
    let (alpha, beta_id) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let (branch,): (uuid::Uuid,) =
        sqlx::query_as("select id from aarogyam.branches where org_id = $1 limit 1")
            .bind(alpha)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let error = app
        .api_db()
        .scoped(&Scope::tenant(beta_id), async |tx| {
            sqlx::query(
                "insert into aarogyam.clinic_hours (branch_id, weekday, starts, ends)
                 values ($1, 1, '09:00', '10:00')",
            )
            .bind(branch)
            .execute(tx.conn())
            .await
            .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Conflict, "{error}");
    app.finish().await;
}
