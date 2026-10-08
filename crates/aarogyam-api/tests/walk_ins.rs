//! The walk-in fast path: one-step walk-ins, the phone lookup, starting a visit from the queue,
//! confirming patient-reported allergies; roles (intake.write reads nothing clinical) and other
//! clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), Some(body))
        .await
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, path, Some(token), None).await
}

fn new_walk_in(name: &str, phone: &str) -> Value {
    json!({
        "patient": { "full_name": name, "age_years": 34, "sex": "female", "phone": phone,
                     "preferred_language": "mr-IN" },
        "allergies": ["Penicillin", "penicillin ", "Latex"],
        "consents": [{ "purpose": "care", "method": "verbal" },
                     { "purpose": "reminders", "method": "verbal" }]
    })
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one journey, step by step")]
async fn the_front_desk_registers_a_walk_in_in_one_step() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let owner = app.token(ALPHA_OWNER);

    let (status, walk_in) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        new_walk_in("Sunita Patil", "98765 11111"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    assert_eq!(walk_in["registered"], true);
    assert_eq!(walk_in["patient"]["full_name"], "Sunita Patil");
    assert_eq!(walk_in["patient"]["age_years"], 34);
    assert_eq!(walk_in["patient"]["preferred_language"], "mr-IN");
    assert_eq!(walk_in["token"]["status"], "waiting");
    assert_eq!(walk_in["token"]["token_number"], 1);
    assert_eq!(walk_in["token"]["patient"]["id"], walk_in["patient"]["id"]);
    // The same substance twice (any case) is one allergy.
    assert_eq!(walk_in["allergies_recorded"], 2);
    assert_eq!(walk_in["consents_recorded"], json!(["care", "reminders"]));
    let patient = walk_in["patient"]["id"].as_str().unwrap().to_owned();

    // The front desk can't read clinical details: allergies, visits.
    for path in [
        format!("/api/v1/patients/{patient}/allergies"),
        format!("/api/v1/patients/{patient}/visits"),
    ] {
        let (status, _) = get(&app, ALPHA, &desk, &path).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
    // The banner tells them allergies exist, not what they are.
    let (status, flags) = get(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/patients/{patient}/clinical-flags"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{flags}");
    assert_eq!(flags["allergy_count"], 2);
    assert_eq!(flags["details_hidden"], true);
    assert_eq!(flags["allergies"], json!([]));
    assert_eq!(flags["allergies_reviewed"], "has_allergies");

    // The doctor sees them as patient-reported, not yet confirmed.
    let (status, list) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/allergies"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{list}");
    for item in items {
        assert_eq!(item["source"], "patient");
        assert_eq!(item["confirmed"], false);
        assert!(item["verified_by"].is_null());
    }

    // The consents carry the clinic's current notice, given verbally, recorded by the desk.
    let (_, consents) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/consents"),
    )
    .await;
    let consents = consents["items"].as_array().unwrap();
    assert_eq!(consents.len(), 2);
    for consent in consents {
        assert_eq!(consent["notice_version"], "v1 2026-10");
        assert_eq!(consent["method"], "verbal");
        assert_eq!(consent["recorded_by"], "Farah Desk");
    }

    // The queue shows the token.
    let (_, queue) = get(&app, ALPHA, &desk, "/api/v1/queue").await;
    assert_eq!(queue["items"].as_array().unwrap().len(), 1, "{queue}");

    // The phone lookup finds them again, with only what the desk needs.
    let (status, found) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients/lookup",
        json!({ "phone": "+91 98765 11111" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(
        found["items"],
        json!([{ "id": patient, "number": walk_in["patient"]["number"], "full_name": "Sunita Patil",
                 "age_years": 34, "sex": "female" }])
    );
    let (_, none) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients/lookup",
        json!({ "phone": "9000000000" }),
    )
    .await;
    assert_eq!(none["items"], json!([]));
    let (status, _) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients/lookup",
        json!({ "phone": "call me" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // An existing patient walks in again: no new registration, no repeated allergy or consent.
    let (status, again) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        json!({ "patient_id": patient, "allergies": ["Latex", "Sulfa"],
                "consents": [{ "purpose": "care", "method": "verbal" }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again["registered"], false);
    assert_eq!(again["token"]["token_number"], 2);
    assert_eq!(again["allergies_recorded"], 1);
    assert_eq!(again["consents_recorded"], json!([]));

    // "No known allergies" contradicts the record: refused, and nothing is issued.
    let (status, refused) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        json!({ "patient_id": patient, "no_known_allergies": true }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    let (_, queue) = get(&app, ALPHA, &desk, "/api/v1/queue").await;
    assert_eq!(queue["items"].as_array().unwrap().len(), 2, "{queue}");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn no_known_allergies_is_recorded_and_bad_walk_ins_change_nothing() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, walk_in) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        json!({ "patient": { "full_name": "Ramesh Jadhav" }, "no_known_allergies": true }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    let patient = walk_in["patient"]["id"].as_str().unwrap();
    let (_, flags) = get(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/patients/{patient}/clinical-flags"),
    )
    .await;
    assert_eq!(flags["allergies_reviewed"], "none_known");
    assert_eq!(flags["allergy_count"], 0);

    for body in [
        json!({}),
        json!({ "patient": { "full_name": "A" }, "patient_id": patient }),
        json!({ "patient": { "full_name": "A" }, "allergies": ["Dust"], "no_known_allergies": true }),
        json!({ "patient": { "full_name": "A" }, "allergies": [""] }),
        json!({ "patient": { "full_name": "" } }),
        json!({ "patient": { "full_name": "A", "phone": "12" } }),
        json!({ "patient": { "full_name": "A" }, "consents": [{ "purpose": "care", "method": "fax" }] }),
        json!({ "patient": { "full_name": "A" }, "consents": [{ "purpose": "care", "method": "verbal" },
                                                              { "purpose": "care", "method": "paper" }] }),
        json!({ "patient": { "full_name": "A" }, "notice_version": "x".repeat(41) }),
        json!({ "patient": { "full_name": "A" }, "practitioner_id": patient }),
    ] {
        let (status, error) = post(&app, ALPHA, &desk, "/api/v1/walk-ins", body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    let (_, queue) = get(&app, ALPHA, &desk, "/api/v1/queue").await;
    assert_eq!(queue["items"].as_array().unwrap().len(), 1, "{queue}");
    let (count,): (i64,) = sqlx::query_as("select count(*) from aarogyam.patients")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(count, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn intake_write_alone_reads_and_does_nothing_clinical() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, walk_in) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/walk-ins",
        new_walk_in("Kavya Rao", "9876522222"),
    )
    .await;
    let patient = walk_in["patient"]["id"].as_str().unwrap().to_owned();
    let token = walk_in["token"]["id"].as_str().unwrap().to_owned();
    let (_, list) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/allergies"),
    )
    .await;
    let allergy = list["items"][0]["id"].as_str().unwrap().to_owned();

    sqlx::raw_sql(
        "insert into aarogyam.role_permissions (org_id, role_id, permission)
         select org_id, id, 'intake.write' from aarogyam.roles where key = 'nothing'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let intake = app.token(ALPHA_NOTHING);
    let desk = app.token(ALPHA_FRONT_DESK);
    for who in [&intake, &desk] {
        for path in [
            format!("/api/v1/patients/{patient}/allergies"),
            format!("/api/v1/patients/{patient}/visits"),
            format!("/api/v1/patients/{patient}/conditions"),
        ] {
            let (status, _) = get(&app, ALPHA, who, &path).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        }
        for path in [
            format!("/api/v1/queue/{token}/start-visit"),
            format!("/api/v1/patients/{patient}/allergies/{allergy}/confirm"),
        ] {
            let (status, _) = post(&app, ALPHA, who, &path, json!({})).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        }
    }
    // intake.write alone doesn't register patients or issue tokens, nor look anyone up.
    let (status, _) = post(
        &app,
        ALPHA,
        &intake,
        "/api/v1/walk-ins",
        new_walk_in("Anil Shah", "9876533333"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(
        &app,
        ALPHA,
        &intake,
        "/api/v1/patients/lookup",
        json!({ "phone": "9876522222" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Nor does the assistant, who has intake.write but not patients.write.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = post(
        &app,
        ALPHA,
        &assistant,
        "/api/v1/walk-ins",
        new_walk_in("Anil Shah", "9876533333"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one journey, step by step")]
async fn a_doctor_starts_the_visit_from_the_queue_and_confirms_allergies() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let owner = app.token(ALPHA_OWNER);
    let (_, walk_in) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        new_walk_in("Meera Iyer", "9876544444"),
    )
    .await;
    let patient = walk_in["patient"]["id"].as_str().unwrap().to_owned();
    let token = walk_in["token"]["id"].as_str().unwrap().to_owned();
    let start = format!("/api/v1/queue/{token}/start-visit");

    let (status, started) = post(&app, ALPHA, &owner, &start, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{started}");
    assert_eq!(started["created"], true);
    assert_eq!(started["token"]["status"], "in_chair");
    assert_eq!(started["visit"]["patient_id"], patient.as_str());
    assert_eq!(started["visit"]["status"], "open");
    assert_eq!(started["visit"]["clinician"]["name"], "Asha Owner");
    let visit = started["visit"]["id"].as_str().unwrap().to_owned();

    // A second tap returns the same visit.
    let (status, again) = post(&app, ALPHA, &owner, &start, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["created"], false);
    assert_eq!(again["visit"]["id"], visit.as_str());
    let (linked,): (Option<uuid::Uuid>,) =
        sqlx::query_as("select queue_token_id from aarogyam.encounters where id = $1::uuid")
            .bind(&visit)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(linked.unwrap().to_string(), token);

    // Confirming a patient-reported allergy, twice: the second changes nothing.
    let (_, list) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/allergies"),
    )
    .await;
    let allergy = list["items"][0]["id"].as_str().unwrap().to_owned();
    let confirm = format!("/api/v1/patients/{patient}/allergies/{allergy}/confirm");
    let (status, confirmed) = post(&app, ALPHA, &owner, &confirm, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["confirmed"], true);
    assert_eq!(confirmed["source"], "patient");
    let verifier = confirmed["verified_by"].clone();
    assert!(verifier.is_string());
    let (status, twice) = post(&app, ALPHA, &owner, &confirm, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(twice["verified_by"], verifier);
    // Another patient's path to the allergy finds nothing.
    let (_, other) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        json!({ "patient": { "full_name": "Other Person" } }),
    )
    .await;
    let other = other["patient"]["id"].as_str().unwrap();
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{other}/allergies/{allergy}/confirm"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Closing the visit finishes its token.
    let (status, closed) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/close"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    let (_, queue) = get(&app, ALPHA, &owner, "/api/v1/queue").await;
    let row = queue["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == token.as_str())
        .unwrap()
        .clone();
    assert_eq!(row["status"], "done", "{queue}");

    // A patient who left without a visit can't have one started from that token.
    let (_, left) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        json!({ "patient_id": patient }),
    )
    .await;
    let left = left["token"]["id"].as_str().unwrap();
    let (status, _) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/queue/{left}/status"),
        json!({ "status": "left" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/queue/{left}/start-visit"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_gets_404_and_finds_no_one() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let (_, walk_in) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/walk-ins",
        new_walk_in("Sunil Rao", "9876555555"),
    )
    .await;
    let patient = walk_in["patient"]["id"].as_str().unwrap().to_owned();
    let token = walk_in["token"]["id"].as_str().unwrap().to_owned();
    let (_, list) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/allergies"),
    )
    .await;
    let allergy = list["items"][0]["id"].as_str().unwrap().to_owned();

    let (status, _) = post(
        &app,
        BETA,
        &beta,
        "/api/v1/walk-ins",
        json!({ "patient_id": patient, "no_known_allergies": true }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for path in [
        format!("/api/v1/queue/{token}/start-visit"),
        format!("/api/v1/patients/{patient}/allergies/{allergy}/confirm"),
    ] {
        let (status, _) = post(&app, BETA, &beta, &path, json!({})).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let (status, found) = post(
        &app,
        BETA,
        &beta,
        "/api/v1/patients/lookup",
        json!({ "phone": "9876555555" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(found["items"], json!([]));
    // Alpha's records are as they were.
    let (_, list) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/allergies"),
    )
    .await;
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["confirmed"] == false)
    );
    let (_, queue) = get(&app, ALPHA, &owner, "/api/v1/queue").await;
    assert_eq!(queue["items"][0]["status"], "waiting");
    app.finish().await;
}
