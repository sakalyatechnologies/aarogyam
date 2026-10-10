//! `GET /reports/analytics` additions: patients by sex, procedures by category, the chair-time
//! split, and booked against walk-in visits. Counts only, so they need no `finance.view`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime, UtcOffset};

async fn post(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

fn count(list: &Value, key: &str) -> i64 {
    list.as_array()
        .unwrap()
        .iter()
        .find(|row| row["key"] == key)
        .map_or(0, |row| row["count"].as_i64().unwrap())
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn analytics_split_chair_time_sex_procedures_and_walk_ins() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let today = OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date();
    let tomorrow = today + Duration::days(1);

    let doctor = post(
        &app,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha" }),
    )
    .await;
    let shifts: Vec<Value> = (1..=7)
        .map(|d| json!({ "weekday": d, "starts": "09:00", "ends": "17:00" }))
        .collect();
    let hours = format!(
        "/api/v1/practitioners/{}/working-hours",
        doctor["id"].as_str().unwrap()
    );
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            &hours,
            Some(&owner),
            Some(json!({ "shifts": shifts })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let chair = post(&app, &owner, "/api/v1/rooms", json!({ "name": "Chair 1" })).await;
    let woman = post(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Meera Shah", "sex": "female", "age_years": 30 }),
    )
    .await;
    let man = post(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Ravi Kumar", "sex": "male", "age_years": 40 }),
    )
    .await;
    for (patient, start, end, kind) in [
        (&woman, "10:00", "10:30", "new"),
        (&man, "11:00", "12:00", "procedure"),
    ] {
        post(
            &app,
            &owner,
            "/api/v1/appointments",
            json!({
            "patient_id": patient["id"], "practitioner_id": doctor["id"], "room_id": chair["id"],
            "kind": kind, "starts_at": format!("{tomorrow}T{start}:00+05:30"),
            "ends_at": format!("{tomorrow}T{end}:00+05:30") }),
        )
        .await;
    }
    post(
        &app,
        &owner,
        "/api/v1/queue",
        json!({ "patient_id": woman["id"] }),
    )
    .await;

    // A root canal done in a visit and billed from a price item in `endodontics`.
    let item = post(
        &app,
        &owner,
        "/api/v1/price-items",
        json!({ "name": "Root canal", "price_paise": 400_000, "category": "endodontics" }),
    )
    .await;
    let visit = post(
        &app,
        &owner,
        &format!("/api/v1/patients/{}/visits", man["id"].as_str().unwrap()),
        json!({}),
    )
    .await;
    let procedure = post(
        &app,
        &owner,
        &format!(
            "/api/v1/visits/{}/procedures",
            visit["id"].as_str().unwrap()
        ),
        json!({ "name": "Root canal" }),
    )
    .await;
    post(&app, &owner, "/api/v1/invoices", json!({ "patient_id": man["id"], "items": [
        { "price_item_id": item["id"], "procedure_id": procedure["id"], "description": "Root canal", "unit_price_paise": 400_000 }] })).await;

    let path = format!("/api/v1/reports/analytics?from={today}&to={tomorrow}");
    let get =
        async |host: &str, token: &str| app.send(Method::GET, host, &path, Some(token), None).await;
    let (status, report) = get(ALPHA, &owner).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(count(&report["patients"]["sex"], "female"), 1);
    assert_eq!(count(&report["patients"]["sex"], "male"), 1);
    assert_eq!(report["patients"]["sex"].as_array().unwrap().len(), 4);
    assert_eq!(count(&report["procedures_by_category"], "endodontics"), 1);
    assert_eq!(
        report["chair_time"],
        json!({ "treatment": 60, "consult": 30, "admin": 0 })
    );
    assert_eq!(
        report["visit_sources"],
        json!({ "booked": 2, "walk_in": 1 })
    );

    // Counts need no finance.view; another clinic sees none of this; no analytics.view is 403.
    let (status, other) = get(BETA, &app.token(BETA_OWNER)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(other["visit_sources"], json!({ "booked": 0, "walk_in": 0 }));
    assert_eq!(other["procedures_by_category"], json!([]));
    assert_eq!(
        get(ALPHA, &app.token(ALPHA_NOTHING)).await.0,
        StatusCode::FORBIDDEN
    );
    app.finish().await;
}
