//! A clinic's own dental terms: listing, renaming and retiring. Retired terms leave the
//! type-ahead and can't be used for new entries, but old entries keep showing them; a rename
//! shows on old entries too. Other clinics see nothing.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn send(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

fn offered(chart: &Value, id: &str) -> bool {
    chart["terms"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == id)
}

/// A patient with a filled tooth whose material is a new clinic term (with a typo).
async fn setup() -> (TestApp, String, String, String, Value) {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, patient) = send(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/patients",
        &owner,
        Some(json!({ "full_name": "Meera Shah" })),
    )
    .await;
    let chart_path = format!(
        "/api/v1/patients/{}/dental-chart",
        patient["id"].as_str().unwrap()
    );
    let (status, term) = send(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/dental-terms",
        &owner,
        Some(json!({ "kind": "material", "label": "Lithium silcate" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{term}");
    let id = term["id"].as_str().unwrap().to_owned();
    let entry = json!({ "entries": [{ "tooth": 26, "surface": "O", "finding": "filled", "procedure": "inlay", "material": id }] });
    let (status, _) = send(
        &app,
        Method::POST,
        ALPHA,
        &chart_path,
        &owner,
        Some(entry.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    (app, owner, chart_path, id, entry)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn renames_show_on_old_entries_and_the_history_keeps_the_old_label() {
    let (app, owner, chart_path, id, _) = setup().await;
    // Rename: a typo fixed; the old entry shows the new label.
    let (status, renamed) = send(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/dental-terms/{id}"),
        &owner,
        Some(json!({ "label": "Lithium silicate" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    let (_, chart) = send(&app, Method::GET, ALPHA, &chart_path, &owner, None).await;
    assert_eq!(chart["current"][0]["material"]["label"], "Lithium silicate");
    // Not to a standard term, nor to another of the clinic's labels.
    let (status, _) = send(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/dental-terms/{id}"),
        &owner,
        Some(json!({ "label": "Zirconia" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, other) = send(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/dental-terms",
        &owner,
        Some(json!({ "kind": "material", "label": "Gold foil" })),
    )
    .await;
    let (status, _) = send(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/dental-terms/{}", other["id"].as_str().unwrap()),
        &owner,
        Some(json!({ "label": "lithium SILICATE" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The change history keeps the old label.
    let (old,): (Value,) = sqlx::query_as(
        "select changes from audit.audit_events where row_id = $1::uuid and changes ? 'label'",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(old["label"][0], "Lithium silcate");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn retired_terms_leave_the_type_ahead_but_stay_on_old_entries() {
    let (app, owner, chart_path, id, entry) = setup().await;
    send(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/dental-terms/{id}"),
        &owner,
        Some(json!({ "label": "Lithium silicate" })),
    )
    .await;
    // Retire: gone from the type-ahead and from new entries, still on the old one.
    let (status, retired) = send(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/dental-terms/{id}/retire"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{retired}");
    assert_eq!(retired["retired"], true);
    assert_eq!(retired["retired_by"], "Asha Owner");
    let (_, chart) = send(&app, Method::GET, ALPHA, &chart_path, &owner, None).await;
    assert!(!offered(&chart, &id));
    assert_eq!(chart["current"][0]["material"]["label"], "Lithium silicate");
    let (status, _) = send(&app, Method::POST, ALPHA, &chart_path, &owner, Some(entry)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, list) = send(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/dental-terms",
        &owner,
        None,
    )
    .await;
    let listed: Vec<&Value> = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["id"] == id.as_str())
        .collect();
    assert_eq!(listed[0]["retired"], true);
    assert_eq!(listed[0]["added_by"], "Asha Owner");

    // Restore, or "Add new" with the same label, brings it back.
    let (status, _) = send(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/dental-terms/{id}/restore"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, chart) = send(&app, Method::GET, ALPHA, &chart_path, &owner, None).await;
    assert!(offered(&chart, &id));
    send(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/dental-terms/{id}/retire"),
        &owner,
        None,
    )
    .await;
    let (status, again) = send(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/dental-terms",
        &owner,
        Some(json!({ "kind": "material", "label": "Lithium Silicate" })),
    )
    .await;
    assert_eq!(
        (status, again["id"].as_str()),
        (StatusCode::OK, Some(id.as_str()))
    );
    assert_eq!(again["retired"], false);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_settings_managers_change_terms_and_clinics_stay_apart() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, term) = send(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/dental-terms",
        &owner,
        Some(json!({ "kind": "procedure", "label": "Maryland bridge" })),
    )
    .await;
    let id = term["id"].as_str().unwrap();
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = send(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/dental-terms",
        &assistant,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "clinical.read lists them");
    let (status, _) = send(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/dental-terms",
        &app.token(ALPHA_NOTHING),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for (method, path, body) in [
        (
            Method::PATCH,
            format!("/api/v1/dental-terms/{id}"),
            Some(json!({ "label": "Bridge" })),
        ),
        (
            Method::POST,
            format!("/api/v1/dental-terms/{id}/retire"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/dental-terms/{id}/restore"),
            None,
        ),
    ] {
        let (status, _) = send(&app, method.clone(), ALPHA, &path, &assistant, body.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}");
        let (status, _) = send(
            &app,
            method.clone(),
            BETA,
            &path,
            &app.token(BETA_OWNER),
            body,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path} from Beta");
    }
    let (_, list) = send(
        &app,
        Method::GET,
        BETA,
        "/api/v1/dental-terms",
        &app.token(BETA_OWNER),
        None,
    )
    .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 0);
    // Only the label and the retirement ever change, even for the schema owner.
    sqlx::query("update aarogyam.dental_terms set kind = 'material'")
        .execute(&app.owner)
        .await
        .unwrap_err();
    app.finish().await;
}
