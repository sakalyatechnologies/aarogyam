//! Patients checking themselves in with the clinic's QR code, on a real database: the key and
//! the switch, what the public side refuses and never reveals, the caps, the front desk's
//! accept and dismiss (one winner, blanks filled but never overwritten, consents recorded with
//! the notice version), the sweep, erasure, and other clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::assert_is_empty,
    reason = "the failure message of an emptiness check on a list of JSON is enough"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one journey end to end, step by step"
)]

mod support;

use aarogyam_app::erasure;
use aarogyam_domain::ids::ClinicId;
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::OffsetDateTime;
use uuid::Uuid;

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

/// Switches the QR on for Alpha and returns its key.
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
    assert_eq!(body["enabled"], true);
    let url = body["url"].as_str().unwrap();
    assert!(
        url.starts_with(&format!("https://{ALPHA}/arrive?k=")),
        "{url}"
    );
    url.split("?k=").nth(1).unwrap().to_owned()
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

async fn pending(app: &TestApp, token: &str, host: &str) -> Vec<Value> {
    let (status, body) = call(
        app,
        Method::GET,
        host,
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

async fn rows(app: &TestApp, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&app.owner).await.unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_key_and_the_switch_gate_the_public_page() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);

    // Off by default: no address, and the page is a plain 404 whatever the key.
    let (status, body) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/settings/self-check-in",
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["enabled"], false);
    assert!(body.get("url").is_none());
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/public/arrive?k=anything",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Only settings.manage reaches the settings.
    for method in [Method::GET, Method::PUT] {
        let (status, _) = call(
            &app,
            method,
            ALPHA,
            "/api/v1/settings/self-check-in",
            Some(&desk),
            Some(json!({ "enabled": true })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/settings/self-check-in/key",
        Some(&desk),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let key = enable(&app).await;
    let (status, page) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/public/arrive?k={key}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert!(
        page["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["code"] == "tooth_pain")
    );
    assert!(
        page["health_flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["code"] == "diabetes")
    );
    assert!(page["notice_version"].is_string());
    // A wrong or missing key, and another clinic's host, are 404s.
    for path in [
        "/api/v1/public/arrive?k=wrong".to_owned(),
        "/api/v1/public/arrive".to_owned(),
    ] {
        let (status, _) = call(&app, Method::GET, ALPHA, &path, None, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let (status, _) = call(
        &app,
        Method::GET,
        BETA,
        &format!("/api/v1/public/arrive?k={key}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send_arrival(&app, arrival("wrong", "98765 43210")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // New QR: the old key stops working, the new one works, and the settings show the new one.
    let (status, fresh) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/settings/self-check-in/key",
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{fresh}");
    let new_key = fresh["url"]
        .as_str()
        .unwrap()
        .split("?k=")
        .nth(1)
        .unwrap()
        .to_owned();
    assert_ne!(new_key, key);
    let (status, _) = send_arrival(&app, arrival(&key, "98765 43210")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send_arrival(&app, arrival(&new_key, "98765 43210")).await;
    assert_eq!(status, StatusCode::CREATED);

    // Switched off again: 404 even with the right key; the key is kept for switching back on.
    let (status, off) = call(
        &app,
        Method::PUT,
        ALPHA,
        "/api/v1/settings/self-check-in",
        Some(&owner),
        Some(json!({ "enabled": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{off}");
    let (status, _) = send_arrival(&app, arrival(&new_key, "98765 43210")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Another clinic's settings are its own.
    let beta_owner = app.token(BETA_OWNER);
    let (_, beta) = call(
        &app,
        Method::GET,
        BETA,
        "/api/v1/settings/self-check-in",
        Some(&beta_owner),
        None,
    )
    .await;
    assert_eq!(beta["enabled"], false);
    assert!(beta.get("url").is_none());
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_public_side_checks_input_keeps_the_honeypot_empty_and_caps_the_list() {
    let app = TestApp::start().await;
    let key = enable(&app).await;

    // Honeypot: 201 and nothing stored. Other refusals say what is wrong.
    let mut trap = arrival(&key, "98765 43210");
    trap["website"] = json!("http://spam.example");
    let (status, body) = send_arrival(&app, trap).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body, json!({}));
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.self_check_ins").await,
        0
    );

    let mut no_consent = arrival(&key, "98765 43210");
    no_consent["consent_care"] = json!(false);
    let (status, body) = send_arrival(&app, no_consent).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("consent_care")
    );
    for (field, value) in [
        ("phone", json!("12")),
        ("reasons", json!(["nonsense"])),
        ("health", json!(["gout"])),
        ("email", json!("not an email")),
        ("sex", json!("robot")),
        ("address", json!({ "pincode": "011001" })),
        ("date_of_birth", json!("yesterday")),
        ("relation", json!("landlord")),
    ] {
        let mut bad = arrival(&key, "98765 43210");
        bad[field] = value;
        if field == "relation" {
            bad["for_self"] = json!(false);
            bad["contact_name"] = json!("Ravi");
        }
        let (status, body) = send_arrival(&app, bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}: {body}");
    }
    let mut none = arrival(&key, "98765 43210");
    none["reasons"] = json!([]);
    let (status, _) = send_arrival(&app, none.clone()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    none["reason_text"] = json!("sore gums");
    let (status, _) = send_arrival(&app, none).await;
    assert_eq!(status, StatusCode::CREATED);
    // Nothing public ever made a patient.
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.patients").await,
        0
    );

    // A phone makes at most 6 requests an hour; the answer is the same for a known phone.
    for _ in 0..5 {
        let (status, _) = send_arrival(&app, arrival(&key, "98765 43210")).await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, body) = send_arrival(&app, arrival(&key, "98765 43210")).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
    assert_eq!(body["error"]["code"], "rate_limited");

    // 200 waiting is full: refused with list_full, and none is dropped.
    let alpha = app.clinic_id("alpha").await;
    sqlx::query(
        "insert into aarogyam.self_check_ins (org_id, payload, phone_hash)
         select $1, '{}'::jsonb, '\\x00'::bytea from generate_series(1, 200)",
    )
    .bind(alpha)
    .execute(&app.owner)
    .await
    .unwrap();
    let before = rows(&app, "select count(*) from aarogyam.self_check_ins").await;
    let (status, body) = send_arrival(&app, arrival(&key, "98765 99999")).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
    assert_eq!(body["error"]["code"], "list_full");
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.self_check_ins").await,
        before
    );
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn accepting_registers_the_patient_records_consent_and_clears_the_payload() {
    let app = TestApp::start().await;
    let key = enable(&app).await;
    let desk = app.token(ALPHA_FRONT_DESK);

    let mut family = arrival(&key, "98765 43210");
    family["for_self"] = json!(false);
    family["contact_name"] = json!("Ravi Rao");
    family["relation"] = json!("parent");
    family["first_name"] = json!("Meera");
    family["age_years"] = json!(9);
    family["sex"] = json!("female");
    family["email"] = json!("meera@example.in");
    family["address"] = json!({ "line1": "12 Main Rd", "city": "Pune", "district": "Pune", "state": "Maharashtra", "pincode": "411001" });
    family["health"] = json!(["diabetes"]);
    family["allergies_text"] = json!("Penicillin, latex");
    family["reminders"] = json!(true);
    family["reason_text"] = json!("sore gums");
    let (status, _) = send_arrival(&app, family).await;
    assert_eq!(status, StatusCode::CREATED);

    let waiting = pending(&app, &desk, ALPHA).await;
    assert_eq!(waiting.len(), 1);
    let card = &waiting[0];
    assert_eq!(card["first_name"], "Meera");
    assert_eq!(card["reason_labels"], json!(["Tooth pain"]));
    assert_eq!(card["health_labels"], json!(["Diabetes"]));
    assert_eq!(card["matches"]["items"], json!([]));
    assert!(card["phone"].is_string());
    let id = card["id"].as_str().unwrap().to_owned();

    let (status, walk_in) = accept(&app, &desk, &id, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    assert_eq!(walk_in["registered"], true);
    assert_eq!(walk_in["patient"]["full_name"], "Meera Rao");
    assert_eq!(walk_in["patient"]["address"]["pincode"], "411001");
    assert_eq!(walk_in["token"]["status"], "waiting");
    assert_eq!(walk_in["token"]["reason"], "Tooth pain, sore gums");
    assert_eq!(walk_in["allergies_recorded"], 2);
    assert_eq!(walk_in["conditions_recorded"], 1);
    assert_eq!(walk_in["consents_recorded"], json!(["care", "reminders"]));
    let patient = walk_in["patient"]["id"].as_str().unwrap().to_owned();

    // Consent: method app, the notice version the patient was shown, and who agreed.
    let consents: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        "select purpose, method, notice_version, note from aarogyam.patient_consents
         where patient_id = $1::uuid order by purpose",
    )
    .bind(&patient)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(consents.len(), 2);
    for (_, method, version, note) in &consents {
        assert_eq!(method, "app");
        assert!(!version.is_empty());
        assert_eq!(
            note.as_deref(),
            Some("given on the check-in form by guardian")
        );
    }
    // The family note names who filled the form.
    let note: String =
        sqlx::query_scalar("select body from aarogyam.patient_notes where patient_id = $1::uuid")
            .bind(&patient)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(note, "Registered by Ravi Rao, parent");

    // The request keeps ids and a status only; the payload is gone and the list is empty.
    let (status, payload_null, patient_id, token_id): (String, bool, Option<Uuid>, Option<Uuid>) =
        sqlx::query_as(
            "select status, payload is null, patient_id, token_id from aarogyam.self_check_ins",
        )
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(status, "accepted");
    assert!(payload_null);
    assert_eq!(patient_id.map(|id| id.to_string()), Some(patient));
    assert!(token_id.is_some());
    assert!(pending(&app, &desk, ALPHA).await.is_empty());

    // A second accept (or dismiss) is a conflict, not a second patient.
    let (status, body) = accept(&app, &desk, &id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "already_handled");
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/arrivals/{id}/dismiss"),
        Some(&desk),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.patients").await,
        1
    );
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn two_desks_accepting_at_once_make_one_patient() {
    let app = TestApp::start().await;
    let key = enable(&app).await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let owner = app.token(ALPHA_OWNER);
    let (status, _) = send_arrival(&app, arrival(&key, "98765 43210")).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = pending(&app, &desk, ALPHA).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let (first, second) = tokio::join!(
        accept(&app, &desk, &id, json!({})),
        accept(&app, &owner, &id, json!({}))
    );
    let mut codes = [first.0, second.0];
    codes.sort();
    assert_eq!(
        codes,
        [StatusCode::CREATED, StatusCode::CONFLICT],
        "{first:?} {second:?}"
    );
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.patients").await,
        1
    );
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.queue_tokens").await,
        1
    );
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_existing_patient_gets_blanks_filled_and_nothing_overwritten() {
    let app = TestApp::start().await;
    let key = enable(&app).await;
    let owner = app.token(ALPHA_OWNER);

    let (status, patient) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/patients",
        Some(&owner),
        Some(json!({
            "full_name": "Asha Rao", "phone": "98765 43210", "sex": "female",
            "email": "old@example.in", "date_of_birth": "1990-05-04"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let patient_id = patient["id"].as_str().unwrap().to_owned();

    let mut again = arrival(&key, "98765 43210");
    again["email"] = json!("new@example.in");
    again["sex"] = json!("male");
    again["date_of_birth"] = json!("1991-01-01");
    again["address"] = json!({ "city": "Pune", "pincode": "411001" });
    let (status, _) = send_arrival(&app, again).await;
    assert_eq!(status, StatusCode::CREATED);

    // The card offers the registered patient with the same phone.
    let waiting = pending(&app, &owner, ALPHA).await;
    assert_eq!(waiting[0]["matches"]["items"][0]["id"], json!(patient_id));
    let id = waiting[0]["id"].as_str().unwrap().to_owned();

    let (status, walk_in) = accept(
        &app,
        &owner,
        &id,
        json!({ "patient_id": patient_id, "check_in": false }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    assert_eq!(walk_in["registered"], false);
    assert!(walk_in.get("token").is_none());
    let (status, now) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/patients/{patient_id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{now}");
    // What was there stays; the blank address is filled.
    assert_eq!(now["email"], "old@example.in");
    assert_eq!(now["sex"], "female");
    assert_eq!(now["date_of_birth"], "1990-05-04");
    assert_eq!(now["address"]["city"], "Pune");
    assert_eq!(now["address"]["pincode"], "411001");
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.patients").await,
        1
    );

    // Another request for an address that differs fills only the missing parts.
    let mut third = arrival(&key, "98765 43210");
    third["address"] = json!({ "city": "Mumbai", "state": "Maharashtra" });
    let (status, _) = send_arrival(&app, third).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = pending(&app, &owner, ALPHA).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, _) = accept(&app, &owner, &id, json!({ "patient_id": patient_id })).await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, now) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/patients/{patient_id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(now["address"]["city"], "Pune");
    assert_eq!(now["address"]["state"], "Maharashtra");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn dismissing_clears_the_request_and_other_clinics_see_nothing() {
    let app = TestApp::start().await;
    let key = enable(&app).await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta_owner = app.token(BETA_OWNER);
    let nothing = app.token(ALPHA_NOTHING);

    let (status, _) = send_arrival(&app, arrival(&key, "98765 43210")).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = pending(&app, &desk, ALPHA).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // Permissions: a role with nothing can't list, accept or dismiss.
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/arrivals",
        Some(&nothing),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = accept(&app, &nothing, &id, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/arrivals/{id}/dismiss"),
        Some(&nothing),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic's member sees an empty list and gets 404 for this request.
    assert!(pending(&app, &beta_owner, BETA).await.is_empty());
    let (status, _) = call(
        &app,
        Method::POST,
        BETA,
        &format!("/api/v1/arrivals/{id}/accept"),
        Some(&beta_owner),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &app,
        Method::POST,
        BETA,
        &format!("/api/v1/arrivals/{id}/dismiss"),
        Some(&beta_owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(pending(&app, &desk, ALPHA).await.len(), 1);

    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/arrivals/{id}/dismiss"),
        Some(&desk),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, payload_null): (String, bool) =
        sqlx::query_as("select status, payload is null from aarogyam.self_check_ins")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(status, "dismissed");
    assert!(payload_null);
    assert!(pending(&app, &desk, ALPHA).await.is_empty());
    let (status, _) = accept(&app, &desk, &id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.patients").await,
        0
    );
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_sweep_deletes_old_pending_and_old_handled_requests_only() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    sqlx::query(
        "insert into aarogyam.self_check_ins (org_id, status, payload, phone_hash, handled_at)
         values ($1, 'pending', '{}', '\\x01', null),
                ($1, 'pending', '{}', '\\x02', null),
                ($1, 'accepted', null, '\\x03', now()),
                ($1, 'dismissed', null, '\\x04', now())",
    )
    .bind(alpha)
    .execute(&app.owner)
    .await
    .unwrap();
    sqlx::query("alter table aarogyam.self_check_ins disable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    for (hash, created, handled) in [
        ("\\x01", "25 hours", None),
        ("\\x02", "2 hours", None),
        ("\\x03", "9 days", Some("8 days")),
        ("\\x04", "2 days", Some("1 day")),
    ] {
        sqlx::query(
            "update aarogyam.self_check_ins
             set created_at = now() - $2::interval,
                 handled_at = case when $3::text is null then null else now() - $3::text::interval end
             where phone_hash = $1::text::bytea",
        )
        .bind(hash)
        .bind(created)
        .bind(handled)
        .execute(&app.owner)
        .await
        .unwrap();
    }
    sqlx::query("alter table aarogyam.self_check_ins enable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();

    let deleted = aarogyam_notify::sweep_self_check_ins(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(deleted, 2);
    let left: Vec<(Vec<u8>,)> =
        sqlx::query_as("select phone_hash from aarogyam.self_check_ins order by phone_hash")
            .fetch_all(&app.owner)
            .await
            .unwrap();
    assert_eq!(left, vec![(vec![2],), (vec![4],)]);
    // Running again finds nothing more.
    let again = aarogyam_notify::sweep_self_check_ins(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(again, 0);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn erasing_a_patient_deletes_their_arrival_request() {
    let app = TestApp::start().await;
    let key = enable(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let (status, _) = send_arrival(&app, arrival(&key, "98765 43210")).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = pending(&app, &owner, ALPHA).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, walk_in) = accept(&app, &owner, &id, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    let patient = walk_in["patient"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.self_check_ins").await,
        1
    );

    sqlx::query("alter table aarogyam.patients disable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    sqlx::query(
        "update aarogyam.patients set created_at = now() - interval '9 years' where id = $1::uuid",
    )
    .bind(&patient)
    .execute(&app.owner)
    .await
    .unwrap();
    sqlx::query("alter table aarogyam.patients enable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    let erased = erasure::apply(
        &app.owner_db(),
        OffsetDateTime::now_utc(),
        ClinicId::from_uuid(app.clinic_id("alpha").await),
        Uuid::now_v7(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(erased, 1);
    assert_eq!(
        rows(&app, "select count(*) from aarogyam.self_check_ins").await,
        0
    );
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_patient_address_round_trips_with_a_checked_pin_code() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, body) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/patients",
        Some(&owner),
        Some(json!({ "full_name": "Asha Rao", "address": { "pincode": "01234" } })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, patient) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/patients",
        Some(&owner),
        Some(json!({ "full_name": "Asha Rao", "address": { "line1": "12  Main Rd", "pincode": "411001" } })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    assert_eq!(patient["address"]["line1"], "12 Main Rd");
    let id = patient["id"].as_str().unwrap();
    let (_, opened) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/patients/{id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(opened["address"]["pincode"], "411001");
    // Lists leave the address out.
    let (_, found) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/patients/search",
        Some(&owner),
        Some(json!({ "q": "Asha" })),
    )
    .await;
    assert!(found["items"][0].get("address").is_none());
    // An edit replaces it, and an empty one clears it.
    let (status, edited) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/patients/{id}"),
        Some(&owner),
        Some(json!({ "address": { "city": "Pune", "pincode": "411002" } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["address"]["pincode"], "411002");
    assert!(edited["address"]["line1"].is_null());
    let (_, cleared) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/patients/{id}"),
        Some(&owner),
        Some(json!({ "address": {} })),
    )
    .await;
    assert!(cleared.get("address").is_none());
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_pin_code_route_names_district_and_state() {
    let app = TestApp::start().await;
    let (status, found) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/public/pincodes/411001",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(found["pin"], "411001");
    assert!(found["district"].as_str().unwrap().contains("Pune"));
    assert!(found["state"].as_str().unwrap().contains("Maharashtra"));
    for bad in ["01234", "abcdef", "0123456"] {
        let (status, _) = call(
            &app,
            Method::GET,
            ALPHA,
            &format!("/api/v1/public/pincodes/{bad}"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/public/pincodes/999999",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // The console host is not a clinic.
    let (status, _) = call(
        &app,
        Method::GET,
        support::CONSOLE,
        "/api/v1/public/pincodes/411001",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
