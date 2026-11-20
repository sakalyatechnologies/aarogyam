//! The mouth snapshot and the exact detail taps on a real database
//! (docs/plans/visit-story-v2-offers-design.md, sections 1.12 and 1.13): the depth carried
//! forward (DT1), the condition merge under a lock (DT2), mobility on milk teeth (DT5), details
//! untouched by old clients, `/visits/{id}/mouth` while the visit is open, and the detail words
//! in the message only when recorded. Cross-clinic 404s and permissions for every new route are
//! in tests/clinical.rs (`every_route`).
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

async fn call(
    app: &TestApp,
    method: Method,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, ALPHA, path, Some(token), body).await
}

async fn patient_with_visit(app: &TestApp, token: &str, age: u8) -> (String, String) {
    let (status, made) = call(
        app,
        Method::POST,
        token,
        "/api/v1/patients",
        Some(
            json!({ "full_name": "Aarav Nair", "sex": "male", "age_years": age,
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

async fn chart(app: &TestApp, token: &str, patient: &str, visit: &str, entries: Value) -> Value {
    let (status, body) = call(
        app,
        Method::POST,
        token,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        Some(json!({ "visit_id": visit, "entries": entries })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

fn entry(chart: &Value, tooth: u64, surface: &str) -> Value {
    chart["current"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["tooth"] == tooth && e["surface"] == surface)
        .cloned()
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn caries_depth_is_kept_by_old_clients_and_cleared_by_null() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, visit) = patient_with_visit(&app, &owner, 35).await;
    let first = chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([{ "tooth": 36, "surface": "O", "finding": "caries", "caries_depth": "near_pulp" }]),
    )
    .await;
    let original = entry(&first, 36, "O");
    assert_eq!(original["caries_depth"], "near_pulp");
    // DT1: an old client's correction (no caries_depth key, as correctionBatch sends) keeps it.
    let corrected = chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([{ "tooth": 36, "surface": "O", "finding": "caries", "note": "Distal too",
                 "supersedes_id": original["id"] }]),
    )
    .await;
    assert_eq!(entry(&corrected, 36, "O")["caries_depth"], "near_pulp");
    let replaced = chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([{ "tooth": 36, "surface": "O", "finding": "caries" }]),
    )
    .await;
    assert_eq!(entry(&replaced, 36, "O")["caries_depth"], "near_pulp");
    // An explicit null clears it.
    let cleared = chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([{ "tooth": 36, "surface": "O", "finding": "caries", "caries_depth": null }]),
    )
    .await;
    assert!(entry(&cleared, 36, "O").get("caries_depth").is_none());
    // Only caries takes a depth.
    let (status, error) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        Some(
            json!({ "entries": [{ "tooth": 36, "surface": "O", "finding": "filled",
                                   "caries_depth": "enamel" }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(error.to_string().contains("caries_depth"), "{error}");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn conditions_merge_under_a_lock_and_eruptions_supersede() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, visit) = patient_with_visit(&app, &owner, 35).await;
    let condition =
        |tooth: u8| format!("/api/v1/patients/{patient}/dental-chart/teeth/{tooth}/condition");

    // The chart answers without conditions or eruptions until one is recorded.
    let (_, empty) = call(
        &app,
        Method::GET,
        &owner,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        None,
    )
    .await;
    assert!(empty.get("conditions").is_none() && empty.get("eruptions").is_none());

    // DT2: two taps at the same moment both land.
    let path = condition(31);
    let (bleeding, mobility) = tokio::join!(
        call(
            &app,
            Method::PUT,
            &owner,
            &path,
            Some(json!({ "bleeding": true }))
        ),
        call(
            &app,
            Method::PUT,
            &owner,
            &path,
            Some(json!({ "mobility": 2 }))
        ),
    );
    assert_eq!(bleeding.0, StatusCode::OK, "{}", bleeding.1);
    assert_eq!(mobility.0, StatusCode::OK, "{}", mobility.1);
    let (_, read) = call(
        &app,
        Method::GET,
        &owner,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        None,
    )
    .await;
    let current = &read["conditions"][0];
    assert_eq!(
        (current["bleeding"].clone(), current["mobility"].clone()),
        (json!(true), json!(2))
    );
    assert_eq!(current["visit_id"], visit.as_str());
    // null clears one field and keeps the others.
    let (status, cleared) = call(
        &app,
        Method::PUT,
        &owner,
        &path,
        Some(json!({ "bleeding": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert!(
        cleared.get("bleeding").is_none() && cleared["mobility"] == 2,
        "{cleared}"
    );
    // Nothing left is refused.
    let (status, _) = call(
        &app,
        Method::PUT,
        &owner,
        &path,
        Some(json!({ "mobility": null })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // DT5: a loose milk tooth.
    let (status, milk) = call(
        &app,
        Method::PUT,
        &owner,
        &condition(75),
        Some(json!({ "mobility": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{milk}");
    // Infection, pocket and mobility don't go on a missing tooth.
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([{ "tooth": 46, "finding": "missing" }]),
    )
    .await;
    let (status, error) = call(
        &app,
        Method::PUT,
        &owner,
        &condition(46),
        Some(json!({ "infection": "abscess" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = call(
        &app,
        Method::PUT,
        &owner,
        &condition(46),
        Some(json!({ "bleeding": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Eruption: permanent teeth only; an angle only when not through.
    let eruption =
        |tooth: u8| format!("/api/v1/patients/{patient}/dental-chart/teeth/{tooth}/eruption");
    let (status, _) = call(
        &app,
        Method::PUT,
        &owner,
        &eruption(55),
        Some(json!({ "eruption": "erupted" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        Method::PUT,
        &owner,
        &eruption(48),
        Some(json!({ "eruption": "erupted", "angulation": "vertical" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, impacted) = call(
        &app,
        Method::PUT,
        &owner,
        &eruption(48),
        Some(json!({ "eruption": "impacted", "angulation": "mesioangular" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{impacted}");
    let (status, erupted) = call(
        &app,
        Method::PUT,
        &owner,
        &eruption(48),
        Some(json!({ "eruption": "erupted" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{erupted}");
    assert!(erupted.get("angulation").is_none());

    // An old client's chart save and status save leave the details as they are.
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([{ "tooth": 31, "surface": "B", "finding": "caries" }]),
    )
    .await;
    let (status, _) = call(
        &app,
        Method::PUT,
        &owner,
        &format!("/api/v1/patients/{patient}/dental-chart/teeth/31/status"),
        Some(json!({ "health": "watch" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, after) = call(
        &app,
        Method::GET,
        &owner,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        None,
    )
    .await;
    let teeth: Vec<u64> = after["conditions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["tooth"].as_u64().unwrap())
        .collect();
    assert_eq!(teeth, [31, 46, 75]);
    assert_eq!(after["eruptions"][0]["eruption"], "erupted");

    // Entered in error needs a reason; the tooth then has no condition.
    let in_error = format!("{}/entered-in-error", condition(75));
    let (status, _) = call(
        &app,
        Method::POST,
        &owner,
        &in_error,
        Some(json!({ "reason": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        Method::POST,
        &owner,
        &in_error,
        Some(json!({ "reason": "Wrong tooth" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(
        &app,
        Method::POST,
        &owner,
        &in_error,
        Some(json!({ "reason": "Wrong tooth" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let one_current: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.specialty_records
         where kind = 'tooth_condition' and tooth = 31 and status = 'current'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(one_current, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_mouth_snapshot_works_while_the_visit_is_open() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, visit) = patient_with_visit(&app, &owner, 9).await;
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([
            { "tooth": 21, "finding": "root_canal", "procedure": "root_canal",
              "material": "calcium_hydroxide", "sitting": 4, "in_progress": true,
              "note": "Child anxious" },
            { "tooth": 55, "surface": "O", "finding": "caries", "caries_depth": "dentin" },
            { "tooth": 75, "surface": "O", "finding": "filled", "elsewhere": true,
              "note": "Done at City Dental" }
        ]),
    )
    .await;
    let path = format!("/api/v1/visits/{visit}/mouth");
    let (status, headers, mouth) = app
        .send_full(Method::GET, ALPHA, &path, Some(&owner), None, &[])
        .await;
    assert_eq!(status, StatusCode::OK, "{mouth}");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(mouth["story_version"], 1);
    assert_eq!(mouth["dentition"], "mixed");
    let tooth = |n: u64| {
        mouth["teeth"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["tooth"] == n)
            .cloned()
            .unwrap()
    };
    let rc = &tooth(21)["treatments"][0];
    assert_eq!(rc["state"], "in_progress");
    assert_eq!(rc["steps"][1]["state"], "current");
    assert_eq!(rc["steps"][1]["sitting"], 4);
    assert_eq!(tooth(55)["details"]["caries_depth"], "dentin");
    assert_eq!(tooth(75)["work"][0]["origin"], "elsewhere");
    let text = mouth.to_string();
    for leaked in ["anxious", "City Dental", "\"note\""] {
        assert!(!text.contains(leaked), "{leaked}: {text}");
    }
    // Another clinic, or a role without clinical.read, gets nothing.
    let beta = app.token(BETA_OWNER);
    let (status, _) = app.send(Method::GET, BETA, &path, Some(&beta), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = call(&app, Method::GET, &desk, &path, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_message_says_a_detail_only_when_recorded() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, visit) = patient_with_visit(&app, &owner, 35).await;
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!([
            { "tooth": 36, "surface": "O", "finding": "caries", "caries_depth": "near_pulp" },
            { "tooth": 46, "surface": "O", "finding": "caries" }
        ]),
    )
    .await;
    let teeth = format!("/api/v1/patients/{patient}/dental-chart/teeth");
    let (status, _) = call(
        &app,
        Method::PUT,
        &owner,
        &format!("{teeth}/31/condition"),
        Some(json!({ "mobility": 2, "bleeding": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &app,
        Method::PUT,
        &owner,
        &format!("{teeth}/48/eruption"),
        Some(json!({ "eruption": "impacted", "angulation": "mesioangular" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, preview) = call(
        &app,
        Method::POST,
        &owner,
        &format!("/api/v1/visits/{visit}/patient-message/preview"),
        Some(json!({ "sections": ["found"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let text = preview["text"].as_str().unwrap();
    for part in [
        "Decay close to the nerve",
        "(36)",
        "Decay",
        "(46)",
        "Tooth is loose (grade 2)",
    ] {
        assert!(text.contains(part), "missing {part}: {text}");
    }
    // "What we found" holds three lines; the other detail words are checked in the domain.
    // 46 had no depth recorded: it gets the plain words, never "close to the nerve".
    assert_eq!(text.matches("close to the nerve").count(), 1, "{text}");
    assert!(!text.contains("pocket"), "{text}");
    app.finish().await;
}
