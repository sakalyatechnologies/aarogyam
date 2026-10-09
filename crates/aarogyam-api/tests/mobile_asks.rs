//! Additions the staff phone apps asked for: chart corrections across surfaces, seating in a
//! chosen chair, idempotent expenses, staff avatars, richer analytics, record share links and
//! UPI payment links.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn register(app: &TestApp, host: &str, token: &str, name: &str) -> String {
    let (status, patient) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    patient["id"].as_str().unwrap().to_owned()
}

fn entry<'a>(chart: &'a Value, tooth: u64, surface: Option<&str>) -> &'a Value {
    chart["current"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["tooth"] == tooth && e["surface"].as_str() == surface)
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_chart_correction_can_move_an_entry_to_another_surface() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let beta_patient = register(&app, BETA, &beta, "Asha Rao").await;
    let path = format!("/api/v1/patients/{patient}/dental-chart");
    let record = async |path: &str, token: &str, host: &str, body: Value| {
        app.send(Method::POST, host, path, Some(token), Some(body))
            .await
    };

    let (status, chart) = record(
        &path,
        &owner,
        ALPHA,
        json!({ "entries": [
        { "tooth": 36, "surface": "O", "finding": "caries" },
        { "tooth": 36, "surface": "D", "finding": "filled" },
    ] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    let wrong = entry(&chart, 36, Some("O"))["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // The caries was on the mesial surface of 37, not the occlusal of 36.
    let fix = json!({ "entries": [
        { "tooth": 37, "surface": "M", "finding": "caries", "supersedes_id": wrong },
    ] });
    let (status, chart) = record(&path, &owner, ALPHA, fix.clone()).await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert_eq!(
        entry(&chart, 37, Some("M"))["supersedes_id"],
        wrong.as_str()
    );
    assert_eq!(chart["current"].as_array().unwrap().len(), 2, "{chart}");
    assert_eq!(entry(&chart, 36, Some("D"))["finding"], "filled");

    // Only a current entry can be corrected: the second try is refused.
    let (status, _) = record(&path, &owner, ALPHA, fix).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The change of status is audited.
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events
         where table_name = 'aarogyam.specialty_records' and row_id = $1::uuid
           and action = 'update'",
    )
    .bind(&wrong)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // Another patient's entry, or another clinic's, can't be named.
    let (_, other_chart) = record(
        &format!("/api/v1/patients/{other}/dental-chart"),
        &owner,
        ALPHA,
        json!({ "entries": [{ "tooth": 11, "finding": "watch" }] }),
    )
    .await;
    let others = entry(&other_chart, 11, None)["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, beta_chart) = record(
        &format!("/api/v1/patients/{beta_patient}/dental-chart"),
        &beta,
        BETA,
        json!({ "entries": [{ "tooth": 21, "finding": "watch" }] }),
    )
    .await;
    let betas = entry(&beta_chart, 21, None)["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for id in [others, betas] {
        let body = json!({ "entries": [{ "tooth": 11, "finding": "watch", "supersedes_id": id }] });
        let (status, error) = record(&path, &owner, ALPHA, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    }

    // Beta can't reach Alpha's patient, and a role without clinical.write can't record.
    let body = json!({ "entries": [{ "tooth": 11, "finding": "watch" }] });
    let (status, _) = record(&path, &beta, BETA, body.clone()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = record(&path, &app.token(ALPHA_NOTHING), ALPHA, body).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}
