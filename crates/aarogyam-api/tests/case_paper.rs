//! The case-paper registration fields, on a real database: the intake saved per patient, the
//! checklist and allergies recorded at registration, and the QR arrival carrying the same
//! fields to the patient on accept.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn call(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, token, body).await
}

async fn register_patient(app: &TestApp, token: &str, body: Value) -> (StatusCode, Value) {
    call(
        app,
        Method::POST,
        ALPHA,
        "/api/v1/patients",
        Some(token),
        Some(body),
    )
    .await
}

async fn enable(app: &TestApp) -> String {
    let owner = app.token(ALPHA_OWNER);
    let (status, body) = call(
        app,
        Method::PUT,
        ALPHA,
        "/api/v1/settings/self-check-in",
        Some(&owner),
        Some(json!({ "enabled": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["url"]
        .as_str()
        .unwrap()
        .split("?k=")
        .nth(1)
        .unwrap()
        .to_owned()
}

fn arrival(key: &str, phone: &str) -> Value {
    json!({
        "k": key, "first_name": "Asha", "last_name": "Rao", "phone": phone,
        "reasons": ["tooth_pain"], "consent_care": true, "for_self": true
    })
}

async fn send_arrival(app: &TestApp, body: Value) -> (StatusCode, Value) {
    call(
        app,
        Method::POST,
        ALPHA,
        "/api/v1/public/arrivals",
        None,
        Some(body),
    )
    .await
}

async fn pending(app: &TestApp, token: &str) -> Vec<Value> {
    let (status, body) = call(
        app,
        Method::GET,
        ALPHA,
        "/api/v1/arrivals",
        Some(token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"].as_array().unwrap().clone()
}

async fn accept(app: &TestApp, token: &str, id: &str, body: Value) -> (StatusCode, Value) {
    call(
        app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/arrivals/{id}/accept"),
        Some(token),
        Some(body),
    )
    .await
}

async fn count(app: &TestApp, sql: &'static str, patient: &str) -> i64 {
    sqlx::query_scalar(sql)
        .bind(patient)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

/// The case-paper fields: none until saved, replaced as a whole, refused when bad, other
/// clinics get 404, and the option lists are served.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_intake_is_saved_per_patient() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let (status, patient) =
        register_patient(&app, &owner, json!({ "full_name": "Meera Shah" })).await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let path = format!(
        "/api/v1/patients/{}/intake",
        patient["id"].as_str().unwrap()
    );

    let (status, none) = call(&app, Method::GET, ALPHA, &path, Some(&owner), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(none, json!({}));

    let body = json!({
        "blood_group": "O+", "alt_phone": "98765 43210", "emergency_contact_name": "Ravi Shah",
        "emergency_contact_phone": "9123456780", "referred_by": "Dr Rao", "call_time": "evening",
        "occupation": "Teacher", "heard_via": "google", "family_doctor_name": "Dr Iyer",
        "family_doctor_address": "Baner, Pune", "health_other": "Thyroid tablets",
        "pregnant": true, "due_date": "2027-03-01", "nursing": false
    });
    let (status, saved) = call(&app, Method::PUT, ALPHA, &path, Some(&owner), Some(body)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["alt_phone"], "+919876543210");
    let (_, read) = call(&app, Method::GET, ALPHA, &path, Some(&owner), None).await;
    assert_eq!(read, saved);

    // A full replace: a field left out is cleared.
    let (status, again) = call(
        &app,
        Method::PUT,
        ALPHA,
        &path,
        Some(&owner),
        Some(json!({ "occupation": "Pilot" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again, json!({ "occupation": "Pilot" }));

    let (status, body) = call(
        &app,
        Method::PUT,
        ALPHA,
        &path,
        Some(&owner),
        Some(json!({ "blood_group": "C+" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body.to_string().contains("blood_group"), "{body}");

    for method in [Method::GET, Method::PUT] {
        let body = (method == Method::PUT).then(|| json!({ "occupation": "x" }));
        let (status, _) = call(&app, method, BETA, &path, Some(&beta), body).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    let (status, options) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/patients/intake-options",
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{options}");
    assert_eq!(options["blood_groups"].as_array().unwrap().len(), 8);
    assert_eq!(options["heard_via"][0]["code"], "friend_family");
    let flags = options["health_flags"].as_array().unwrap();
    assert!(flags.iter().any(|f| f["code"] == "none"));
    assert!(flags.iter().any(|f| f["code"] == "diabetes"));
    app.finish().await;
}

/// Registering with the checklist, allergies and intake records them all; "none" with another
/// flag and a bad blood group are refused and register nothing.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn registering_records_the_case_paper() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, patient) = register_patient(
        &app,
        &desk,
        json!({
            "full_name": "Kiran Joshi",
            "health": ["asthma", "pregnant"],
            "allergies_text": "Penicillin, latex",
            "intake": { "blood_group": "AB-", "emergency_contact_phone": "9123456780" }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let id = patient["id"].as_str().unwrap();
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.conditions where patient_id = $1::uuid",
            id
        )
        .await,
        2
    );
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.allergies where patient_id = $1::uuid",
            id
        )
        .await,
        2
    );
    let (status, intake) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/patients/{id}/intake"),
        Some(&desk),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["blood_group"], "AB-");
    assert_eq!(intake["emergency_contact_phone"], "+919123456780");
    assert_eq!(intake["pregnant"], true);

    let before: i64 = sqlx::query_scalar("select count(*) from aarogyam.patients")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let (status, body) = register_patient(
        &app,
        &desk,
        json!({ "full_name": "Bad Mix", "health": ["none", "asthma"] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body.to_string().contains("health"), "{body}");
    let (status, body) = register_patient(
        &app,
        &desk,
        json!({ "full_name": "Bad Group", "intake": { "blood_group": "Z" } }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let after: i64 = sqlx::query_scalar("select count(*) from aarogyam.patients")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(after, before);
    app.finish().await;
}

/// A QR arrival carries the intake, the desk sees it, accepting writes it for a new patient and
/// only fills blanks for a matched one; "none" with another flag and a bad blood group are
/// refused at submit.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_arrival_carries_the_intake_to_the_patient() {
    let app = TestApp::start().await;
    let key = enable(&app).await;
    let desk = app.token(ALPHA_FRONT_DESK);

    for (field, value) in [
        ("health", json!(["none", "asthma"])),
        ("intake", json!({ "blood_group": "Q" })),
    ] {
        let mut bad = arrival(&key, "98765 43210");
        bad[field] = value;
        let (status, body) = send_arrival(&app, bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert_eq!(pending(&app, &desk).await.len(), 0);

    let mut first = arrival(&key, "98765 43210");
    first["health"] = json!(["nursing", "tb"]);
    first["intake"] = json!({
        "blood_group": "B+", "alt_phone": "9123456780", "call_time": "any", "heard_via": "doctor"
    });
    let (status, _) = send_arrival(&app, first).await;
    assert_eq!(status, StatusCode::CREATED);
    let waiting = pending(&app, &desk).await;
    assert_eq!(waiting[0]["intake"]["blood_group"], "B+");
    let id = waiting[0]["id"].as_str().unwrap().to_owned();
    let (status, walk_in) = accept(&app, &desk, &id, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    let patient = walk_in["patient"]["id"].as_str().unwrap().to_owned();
    let path = format!("/api/v1/patients/{patient}/intake");
    let (_, saved) = call(&app, Method::GET, ALPHA, &path, Some(&desk), None).await;
    assert_eq!(saved["blood_group"], "B+");
    assert_eq!(saved["alt_phone"], "+919123456780");
    assert_eq!(saved["nursing"], true);

    // A second arrival for the same patient fills blanks only.
    let mut second = arrival(&key, "98765 43210");
    second["intake"] = json!({ "blood_group": "A+", "occupation": "Teacher" });
    let (status, _) = send_arrival(&app, second).await;
    assert_eq!(status, StatusCode::CREATED);
    let waiting = pending(&app, &desk).await;
    let id = waiting[0]["id"].as_str().unwrap().to_owned();
    let (status, body) = accept(&app, &desk, &id, json!({ "patient_id": patient })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (_, merged) = call(&app, Method::GET, ALPHA, &path, Some(&desk), None).await;
    assert_eq!(merged["blood_group"], "B+");
    assert_eq!(merged["occupation"], "Teacher");
    assert_eq!(merged["heard_via"], "doctor");
    app.finish().await;
}

/// Without `patients.contact` the intake phones come back masked, and sending a masked value
/// back keeps the stored one.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn intake_phones_are_masked_without_contact() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let (_, patient) = register_patient(&app, &owner, json!({ "full_name": "Meera Shah" })).await;
    let path = format!(
        "/api/v1/patients/{}/intake",
        patient["id"].as_str().unwrap()
    );
    let body = json!({
        "alt_phone": "9876543210", "emergency_contact_phone": "9123456780",
        "family_doctor_phone": "9000012345", "occupation": "Teacher"
    });
    let (status, _) = call(&app, Method::PUT, ALPHA, &path, Some(&owner), Some(body)).await;
    assert_eq!(status, StatusCode::OK);

    let (_, masked) = call(&app, Method::GET, ALPHA, &path, Some(&assistant), None).await;
    for field in [
        "alt_phone",
        "emergency_contact_phone",
        "family_doctor_phone",
    ] {
        assert!(masked[field].as_str().unwrap().contains('*'), "{masked}");
    }
    let (_, full) = call(&app, Method::GET, ALPHA, &path, Some(&owner), None).await;
    assert_eq!(full["alt_phone"], "+919876543210");

    let mut edit = masked.clone();
    edit["occupation"] = json!("Pilot");
    let (status, saved) = call(
        &app,
        Method::PUT,
        ALPHA,
        &path,
        Some(&assistant),
        Some(edit),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert!(saved["alt_phone"].as_str().unwrap().contains('*'));
    let (_, after) = call(&app, Method::GET, ALPHA, &path, Some(&owner), None).await;
    assert_eq!(after["alt_phone"], "+919876543210");
    assert_eq!(after["family_doctor_phone"], "+919000012345");
    assert_eq!(after["occupation"], "Pilot");
    app.finish().await;
}
