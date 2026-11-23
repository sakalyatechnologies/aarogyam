//! The phone app's small gaps: change a family link, drug alternatives, `/me/stats`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};

async fn register(app: &TestApp, token: &str, name: &str) -> String {
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name, "sex": "female", "age_years": 40, "phone": "+919820000077" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn family(app: &TestApp, token: &str, patient: &str) -> Vec<Value> {
    let (_, body) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/family"),
            Some(token),
            None,
        )
        .await;
    body["items"].as_array().unwrap().clone()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_family_link_can_change_its_relation() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let mother = register(&app, &desk, "Meera Shah").await;
    let child = register(&app, &desk, "Aarav Shah").await;
    let (status, made) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{mother}/family"),
            Some(&desk),
            Some(json!({ "related_patient_id": child, "relation": "other" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    let path = format!(
        "/api/v1/patients/{mother}/family/{}",
        made["id"].as_str().unwrap()
    );

    let (status, changed) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "relation": "child", "is_primary_contact": true })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["relation"], "child");
    assert_eq!(changed["is_primary_contact"], true);
    assert_eq!(family(&app, &desk, &child).await[0]["relation"], "parent");

    // A field left out stays; an unknown relation is refused.
    let (_, kept) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "is_primary_contact": false })),
        )
        .await;
    assert_eq!(kept["relation"], "child");
    assert_eq!(kept["is_primary_contact"], false);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "relation": "cousin" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Unknown link, another clinic, and a role without patients.write.
    let missing = format!("/api/v1/patients/{mother}/family/{}", uuid::Uuid::nil());
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &missing,
            Some(&desk),
            Some(json!({ "relation": "child" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&beta),
            Some(json!({ "relation": "other" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let nobody = app.token(ALPHA_NOTHING);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&nobody),
            Some(json!({ "relation": "other" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(family(&app, &desk, &mother).await[0]["relation"], "child");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn drug_alternatives_exclude_the_drug_and_stay_scoped() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, found) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/drugs/search",
            Some(&owner),
            Some(json!({ "q": "para" })),
        )
        .await;
    let id = found["items"][0]["id"].as_str().unwrap().to_owned();
    let path = format!("/api/v1/drugs/{id}/alternatives?limit=5");
    let (status, list) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(list.as_array().unwrap().iter().all(|d| d["id"] != id));

    let unknown = format!("/api/v1/drugs/{}/alternatives", uuid::Uuid::nil());
    let (status, _) = app
        .send(Method::GET, ALPHA, &unknown, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let beta = app.token(BETA_OWNER);
    let (status, _) = app.send(Method::GET, ALPHA, &path, Some(&beta), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app.send(Method::GET, ALPHA, &path, Some(&desk), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn my_stats_are_zero_without_a_doctor_record_and_staff_only() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, day) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/me/stats?date=2026-01-05",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{day}");
    assert_eq!(day["date"], "2026-01-05");
    assert_eq!(day["patients_seen"], 0);
    assert_eq!(day["procedures_done"], 0);
    assert_eq!(day["prescriptions_issued"], 0);
    assert_eq!(day["collected_paise"], 0);
    let (status, today) = app
        .send(Method::GET, ALPHA, "/api/v1/me/stats", Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{today}");
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/me/stats?date=nope",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/me/stats", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/me/stats", Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
