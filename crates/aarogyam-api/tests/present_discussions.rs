//! "What we discussed" in Show patient (docs/plans/present-studio-design.md, sections 10, 12.4
//! and 12.5): append-only saves that supersede, entered in error, the closed-visit 409, keys
//! checked against the data files, and the frozen price. Permissions and cross-clinic 404s for
//! every route are in tests/clinical.rs (`every_route`); erasure is in tests/erasure.rs.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};

async fn call(
    app: &TestApp,
    method: Method,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, ALPHA, path, Some(token), body).await
}

async fn visit_with_patient(app: &TestApp, token: &str) -> (String, String) {
    let (status, made) = call(
        app,
        Method::POST,
        token,
        "/api/v1/patients",
        Some(
            json!({ "full_name": "Aarav Nair", "sex": "male", "age_years": 35,
                     "phone": "98765 40002" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    let patient = made["id"].as_str().unwrap().to_owned();
    let (status, visit) = call(
        app,
        Method::POST,
        token,
        &format!("/api/v1/patients/{patient}/visits"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    (patient, visit["id"].as_str().unwrap().to_owned())
}

async fn visit_of(app: &TestApp, token: &str) -> String {
    visit_with_patient(app, token).await.1
}

async fn rows(app: &TestApp, visit: &str) -> Vec<(String, bool)> {
    sqlx::query_as(
        "select status, supersedes_id is not null from aarogyam.present_discussions
         where encounter_id = $1::uuid order by created_at, id",
    )
    .bind(visit)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn saves_supersede_and_keep_history_and_errors_are_marked() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let visit = visit_of(&app, &owner).await;
    let path = format!("/api/v1/visits/{visit}/present-discussions");

    let (status, list) = call(&app, Method::GET, &owner, &path, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["discussions"], json!([]));

    let first = json!({ "tooth": 36, "situation": "deep_decay",
        "options": [{ "key": "extract" }, { "key": "rct_crown", "material": "zirconia" }] });
    let (status, one) = call(&app, Method::POST, &owner, &path, Some(first)).await;
    assert_eq!(status, StatusCode::CREATED, "{one}");
    assert_eq!(one["tooth"], 36);
    assert!(one.get("supersedes_id").is_none());

    // A second save for the same tooth and situation supersedes the first; a topic is separate.
    let second = json!({ "tooth": 36, "situation": "deep_decay", "send_to_patient": true,
        "options": [{ "key": "extract" }, { "key": "rct_crown", "preferred": true,
                                            "from_paise": 1 }] });
    let (status, two) = call(&app, Method::POST, &owner, &path, Some(second)).await;
    assert_eq!(status, StatusCode::CREATED, "{two}");
    assert_eq!(two["supersedes_id"], one["id"]);
    assert_eq!(two["options"][1]["preferred"], true);
    assert!(
        two["options"][1].get("from_paise").is_none(),
        "a caller's price is never kept: {two}"
    );
    let topic = json!({ "situation": "implant", "options": [{ "key": "implant" }] });
    let (status, three) = call(&app, Method::POST, &owner, &path, Some(topic)).await;
    assert_eq!(status, StatusCode::CREATED, "{three}");
    assert!(three.get("tooth").is_none());

    let (_, list) = call(&app, Method::GET, &owner, &path, None).await;
    let ids: Vec<&Value> = list["discussions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| &d["id"])
        .collect();
    assert_eq!(ids, [&two["id"], &three["id"]]);
    assert_eq!(
        rows(&app, &visit).await,
        [
            ("superseded".to_owned(), false),
            ("current".to_owned(), true),
            ("current".to_owned(), false)
        ]
    );

    // Entered in error: needs a reason, leaves the tooth with none, the history keeps the row.
    let wrong = format!("{path}/{}/entered-in-error", two["id"].as_str().unwrap());
    let (status, _) = call(
        &app,
        Method::POST,
        &owner,
        &wrong,
        Some(json!({ "reason": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let reason = json!({ "reason": "Wrong tooth" });
    let (status, body) = call(&app, Method::POST, &owner, &wrong, Some(reason.clone())).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, _) = call(&app, Method::POST, &owner, &wrong, Some(reason)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "no longer current");
    let (_, list) = call(&app, Method::GET, &owner, &path, None).await;
    assert_eq!(list["discussions"].as_array().unwrap().len(), 1);
    // The tooth can be saved again after the error.
    let again = json!({ "tooth": 36, "situation": "deep_decay", "options": [{ "key": "wait" }] });
    let (status, body) = call(&app, Method::POST, &owner, &path, Some(again)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(rows(&app, &visit).await.len(), 4);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn keys_are_checked_and_braces_and_aligners_are_refused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let visit = visit_of(&app, &owner).await;
    let path = format!("/api/v1/visits/{visit}/present-discussions");
    for body in [
        json!({ "tooth": 36, "situation": "nope", "options": [{ "key": "extract" }] }),
        json!({ "tooth": 99, "situation": "deep_decay", "options": [{ "key": "extract" }] }),
        json!({ "tooth": 36, "situation": "deep_decay", "options": [] }),
        json!({ "tooth": 36, "situation": "deep_decay", "options": [{ "key": "magic" }] }),
        json!({ "tooth": 36, "situation": "deep_decay",
                "options": [{ "key": "extract", "material": "gold_leaf" }] }),
        json!({ "situation": "implant", "options": [{ "key": "braces" }] }),
        json!({ "situation": "implant", "options": [{ "key": "aligners" }] }),
        json!({ "situation": "implant", "options": [{ "key": "orthodontic_fixed" }] }),
    ] {
        let (status, error) = call(&app, Method::POST, &owner, &path, Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    assert_eq!(rows(&app, &visit).await.len(), 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_closed_visit_refuses_saves_but_can_still_be_read() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let visit = visit_of(&app, &owner).await;
    let path = format!("/api/v1/visits/{visit}/present-discussions");
    let body = json!({ "tooth": 36, "situation": "deep_decay", "options": [{ "key": "extract" }] });
    let (status, saved) = call(&app, Method::POST, &owner, &path, Some(body.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    let (status, closed) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    let (status, error) = call(&app, Method::POST, &owner, &path, Some(body)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    let wrong = format!("{path}/{}/entered-in-error", saved["id"].as_str().unwrap());
    let (status, error) = call(
        &app,
        Method::POST,
        &owner,
        &wrong,
        Some(json!({ "reason": "Wrong tooth" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    let (status, list) = call(&app, Method::GET, &owner, &path, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["discussions"].as_array().unwrap().len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_from_price_is_frozen_only_when_sent_with_prices_on() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, visit) = visit_with_patient(&app, &owner).await;
    let (status, charted) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        Some(json!({ "visit_id": visit, "entries": [
            { "tooth": 36, "surface": "O", "finding": "caries", "caries_depth": "near_pulp" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{charted}");
    for (code, paise) in [("RCT", 600_000), ("CRN", 850_000)] {
        let (status, item) = call(
            &app,
            Method::POST,
            &owner,
            "/api/v1/price-items",
            Some(json!({ "name": code, "code": code, "price_paise": paise })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{item}");
    }
    let path = format!("/api/v1/visits/{visit}/present-discussions");
    let body = |send: bool| {
        json!({ "tooth": 36, "situation": "deep_decay", "send_to_patient": send,
                "options": [{ "key": "rct_crown" }, { "key": "extract" }] })
    };
    // Prices off: nothing is frozen even when sent.
    let (status, saved) = call(&app, Method::POST, &owner, &path, Some(body(true))).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert!(!saved.to_string().contains("from_paise"), "{saved}");
    // Prices on and mapped, but not sent: nothing is frozen.
    let (status, saved) = call(
        &app,
        Method::PUT,
        &owner,
        "/api/v1/settings/present",
        Some(json!({ "show_prices": true,
                     "price_map": { "root_canal": "RCT", "crown": "CRN" } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (status, saved) = call(&app, Method::POST, &owner, &path, Some(body(false))).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert!(!saved.to_string().contains("from_paise"), "{saved}");
    // Sent with prices on: the root canal and crown option is frozen; one with no parts is not.
    let (status, saved) = call(&app, Method::POST, &owner, &path, Some(body(true))).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["options"][0]["from_paise"], 1_450_000, "{saved}");
    // A later price-list change does not touch the saved row.
    sqlx::query("update aarogyam.price_items set price_paise = 1 where code = 'RCT'")
        .execute(&app.owner)
        .await
        .unwrap();
    let (_, list) = call(&app, Method::GET, &owner, &path, None).await;
    assert_eq!(
        list["discussions"][0]["options"][0]["from_paise"],
        1_450_000
    );
    app.finish().await;
}
