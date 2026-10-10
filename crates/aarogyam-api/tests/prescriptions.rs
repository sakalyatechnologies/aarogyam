//! Prescriptions on a real database: drafts, the allergy check with a fake allergy source,
//! cancel and reissue, Quick Rx, patient links with a PIN, and the QR verification page.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use std::sync::Arc;

use aarogyam_app::prescriptions::{AllergyFuture, AllergySource};
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::prescription::RecordedAllergy;
use axum::http::{Method, StatusCode};
use sakalya_db::ScopedTx;
use sakalya_http::HttpConfig;
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

/// Every patient is allergic to penicillin, severely.
#[derive(Debug)]
struct PenicillinAllergy;

impl AllergySource for PenicillinAllergy {
    fn allergies<'a>(&'a self, _tx: &'a mut ScopedTx, _patient: PatientId) -> AllergyFuture<'a> {
        Box::pin(async {
            Ok(vec![RecordedAllergy {
                substance: "Penicillin".into(),
                severe: true,
            }])
        })
    }
}

async fn start() -> TestApp {
    TestApp::start_custom(HttpConfig::default(), |state| {
        state.with_allergy_source(Arc::new(PenicillinAllergy))
    })
    .await
}

async fn patient(app: &TestApp, host: &str, token: &str) -> String {
    let body = json!({ "full_name": "Rahul Verma", "sex": "male", "age_years": 40 });
    let (status, body) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn drug(app: &TestApp, token: &str, q: &str) -> Value {
    let (status, found) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/drugs/search",
            Some(token),
            Some(json!({ "q": q })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{found}");
    found["items"][0].clone()
}

async fn draft(app: &TestApp, token: &str, patient: &str, items: Value) -> Value {
    let path = format!("/api/v1/patients/{patient}/prescriptions");
    let body = json!({ "diagnosis_text": "Pericoronitis 38", "items": items });
    let (status, rx) = app
        .send(Method::POST, ALPHA, &path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{rx}");
    rx
}

async fn issue(app: &TestApp, token: &str, id: &str, body: Value) -> (StatusCode, Value) {
    let path = format!("/api/v1/prescriptions/{id}/issue");
    app.send(Method::POST, ALPHA, &path, Some(token), Some(body))
        .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_allergy_alert_needs_an_override_reason() {
    let app = start().await;
    sqlx::raw_sql(
        "update aarogyam.org_settings set prescription = '{\"footer\": \"Dr Asha, BDS\"}'
         where org_id = (select id from aarogyam.organizations where slug = 'alpha')",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let amox = drug(&app, &owner, "clavulanic acid 625").await;
    assert_eq!(amox["strength"], "625 mg");
    let para = drug(&app, &owner, "paracetamol 650").await;
    let items = json!([
        { "drug_id": amox["id"] },
        { "drug_id": para["id"], "frequency": "SOS", "timing": "sos" },
        { "drug_name": "Chlorhexidine mouthwash", "dose": "10 ml", "frequency": "1-0-1" }
    ]);
    let rx = draft(&app, &owner, &patient, items).await;
    assert_eq!(rx["items"][0]["drug_name"], "AMOXICILLIN + CLAVULANIC ACID");
    assert_eq!(rx["items"][0]["frequency"], "1-0-1");
    assert_eq!(rx["items"][1]["frequency"], "SOS");
    let id = rx["id"].as_str().unwrap();

    let (status, blocked) = issue(&app, &owner, id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{blocked}");
    assert_eq!(blocked["code"], "allergy_alerts");
    assert_eq!(blocked["alerts"].as_array().unwrap().len(), 1);
    assert_eq!(blocked["alerts"][0]["line_no"], 1);
    assert_eq!(blocked["alerts"][0]["severity"], "serious");
    let (status, _) = issue(&app, &owner, id, json!({ "override_reason": "no" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let reason = json!({ "override_reason": "Tolerated amoxicillin last year" });
    let (status, issued) = issue(&app, &owner, id, reason).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert!(issued["number"].as_str().unwrap().starts_with("RX-"));
    assert_eq!(issued["override_reason"], "Tolerated amoxicillin last year");
    assert_eq!(issued["alerts"][0]["action"], "overridden");
    assert_eq!(issued["print"]["footer"], "Dr Asha, BDS");
    assert_eq!(issued["print"]["brand_line"], "Prescribed with Aarogyam");
    assert_eq!(issued["print"]["doctor"]["name"], "Asha Owner");
    assert_eq!(issued["print"]["patient"]["age_years"], 40);
    assert_eq!(issued["print"]["letterhead"]["name"], "Alpha Dental");
    assert!(
        issued["print"]["verify_path"]
            .as_str()
            .unwrap()
            .starts_with("/verify/prescriptions/")
    );

    // Frozen: not through the API, nor in the database.
    let path = format!("/api/v1/prescriptions/{id}");
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "advice": "x" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let frozen = sqlx::query("update aarogyam.prescriptions set advice = 'x' where id = $1::uuid")
        .bind(id)
        .execute(&app.owner)
        .await;
    assert!(frozen.unwrap_err().to_string().contains("is final"));
    let (status, _) = issue(&app, &owner, id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn cancel_reissues_and_quick_rx_repeats_the_last() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let last = format!("/api/v1/patients/{patient}/prescriptions/last");
    let (status, _) = app
        .send(Method::GET, ALPHA, &last, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let items = json!([{ "drug_name": "Ibuprofen", "strength": "400 mg", "dose": "1 tablet", "frequency": "1-1-1", "duration_days": 3 }]);
    let rx = draft(&app, &owner, &patient, items).await;
    let id = rx["id"].as_str().unwrap().to_owned();
    let (status, issued) = issue(&app, &owner, &id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["alerts"], json!([]));

    let (status, quick) = app
        .send(Method::GET, ALPHA, &last, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(quick["id"], id.as_str());

    let cancel = format!("/api/v1/prescriptions/{id}/cancel");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &cancel,
            Some(&owner),
            Some(json!({ "reason": "" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, done) = app
        .send(
            Method::POST,
            ALPHA,
            &cancel,
            Some(&owner),
            Some(json!({ "reason": "Wrong strength" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["cancelled"]["status"], "cancelled");
    assert_eq!(done["cancelled"]["superseded_by"], done["draft"]["id"]);
    assert_eq!(done["draft"]["status"], "draft");
    assert_eq!(done["draft"]["supersedes_id"], id.as_str());
    assert_eq!(done["draft"]["items"][0]["drug_name"], "IBUPROFEN");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &cancel,
            Some(&owner),
            Some(json!({ "reason": "Again" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let history = format!("/api/v1/patients/{patient}/prescriptions");
    let (_, all) = app
        .send(Method::GET, ALPHA, &history, Some(&owner), None)
        .await;
    assert_eq!(all["items"].as_array().unwrap().len(), 2);
    let (status, _) = app
        .send(Method::GET, ALPHA, &last, Some(&owner), None)
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "a cancelled prescription isn't repeated"
    );
    app.finish().await;
}

async fn shared(app: &TestApp, token: &str, pin: &str) -> (StatusCode, Value) {
    let path = format!("/api/v1/shared/{token}/open");
    app.send(
        Method::POST,
        ALPHA,
        &path,
        None,
        Some(json!({ "pin": pin })),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patient_links_open_with_the_pin_and_lock_after_five_wrong_tries() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let items = json!([{ "drug_name": "Metronidazole", "dose": "1 tablet", "frequency": "1-1-1" }]);
    let rx = draft(&app, &owner, &patient, items).await;
    let id = rx["id"].as_str().unwrap();
    let share = format!("/api/v1/prescriptions/{id}/share");
    let (status, _) = app
        .send(Method::POST, ALPHA, &share, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "drafts aren't shared");
    let (_, issued) = issue(&app, &owner, id, json!({})).await;
    let (status, link) = app
        .send(Method::POST, ALPHA, &share, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    let token = link["token"].as_str().unwrap();
    let pin = link["pin"].as_str().unwrap();
    assert_eq!((token.len(), pin.len()), (43, 6));

    // Before the PIN: only that it exists and which clinic sent it.
    let (status, preview) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/shared/{token}"),
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        preview,
        json!({ "clinic_name": "Alpha Dental", "resource": "prescription",
                                "state": "usable", "expires_at": preview["expires_at"] })
    );
    let (status, _) = app
        .send(
            Method::GET,
            BETA,
            &format!("/api/v1/shared/{token}"),
            None,
            None,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "another clinic's host knows nothing"
    );

    let (status, opened) = shared(&app, token, pin).await;
    assert_eq!(status, StatusCode::OK, "{opened}");
    assert_eq!(opened["number"], issued["number"]);
    let (actor, purpose, link_id): (String, String, uuid::Uuid) = sqlx::query_as(
        "select actor_kind, purpose, share_link_id from audit.access_log
         where share_link_id is not null and action = 'view'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        (actor.as_str(), purpose.as_str()),
        ("patient", "patient_self")
    );
    assert_eq!(link_id.to_string(), link["id"].as_str().unwrap());

    let wrong = if pin == "000000" { "111111" } else { "000000" };
    for left in (1..5).rev() {
        let (status, body) = shared(&app, token, wrong).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(
            body["error"]["message"]
                .as_str()
                .unwrap()
                .contains(&format!("{left} tries"))
        );
    }
    let (status, _) = shared(&app, token, "12ab").await;
    assert_eq!(status, StatusCode::LOCKED, "the fifth wrong PIN locks it");
    let (status, _) = shared(&app, token, pin).await;
    assert_eq!(status, StatusCode::LOCKED, "even the right PIN once locked");
    let (_, preview) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/shared/{token}"),
            None,
            None,
        )
        .await;
    assert_eq!(preview["state"], "locked");
    let (status, _) = shared(&app, "not-a-token", pin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Expired links refuse.
    sqlx::query("update aarogyam.share_links set expires_at = now() - interval '1 minute', locked_at = null")
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, _) = shared(&app, token, pin).await;
    assert_eq!(status, StatusCode::GONE);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_qr_page_reveals_no_patient_data() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let items = json!([{ "drug_name": "Cetirizine", "dose": "1 tablet", "frequency": "0-0-1" }]);
    let rx = draft(&app, &owner, &patient, items).await;
    let (_, issued) = issue(&app, &owner, rx["id"].as_str().unwrap(), json!({})).await;
    // The QR code opens the portal's page, which asks the API with the same token.
    let page = issued["print"]["verify_path"].as_str().unwrap();
    let token = page.strip_prefix("/verify/prescriptions/").unwrap();
    let path = format!("/api/v1/verify/prescriptions/{token}");
    let (status, check) = app.send(Method::GET, ALPHA, &path, None, None).await;
    assert_eq!(status, StatusCode::OK, "{check}");
    let keys: Vec<&String> = check.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["clinic_name", "issued_on", "number", "status"]);
    assert_eq!(check["status"], "valid");
    assert!(!check.to_string().contains("Rahul"));
    let (status, _) = app.send(Method::GET, BETA, &path, None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let cancel = format!(
        "/api/v1/prescriptions/{}/cancel",
        rx["id"].as_str().unwrap()
    );
    app.send(
        Method::POST,
        ALPHA,
        &cancel,
        Some(&owner),
        Some(json!({ "reason": "Duplicate", "reissue": false })),
    )
    .await;
    let (_, check) = app.send(Method::GET, ALPHA, &path, None, None).await;
    assert_eq!(check["status"], "cancelled");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn prescriptions_stay_within_the_clinic_and_follow_the_role() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let items = json!([{ "drug_name": "Paracetamol", "dose": "1 tablet", "frequency": "1-1-1" }]);
    let rx = draft(&app, &owner, &patient, items.clone()).await;
    let id = rx["id"].as_str().unwrap();
    let reason = json!({ "reason": "Not ours" });
    let cases = [
        (Method::GET, format!("/api/v1/prescriptions/{id}"), None),
        (
            Method::PATCH,
            format!("/api/v1/prescriptions/{id}"),
            Some(json!({})),
        ),
        (
            Method::POST,
            format!("/api/v1/prescriptions/{id}/issue"),
            Some(json!({})),
        ),
        (
            Method::POST,
            format!("/api/v1/prescriptions/{id}/cancel"),
            Some(reason),
        ),
        (
            Method::POST,
            format!("/api/v1/prescriptions/{id}/share"),
            None,
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/prescriptions"),
            None,
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/prescriptions/last"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/prescriptions"),
            Some(json!({ "items": items })),
        ),
    ];
    for (method, path, body) in cases {
        let (status, _) = app
            .send(method.clone(), BETA, &path, Some(&beta), body)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}");
    }
    // The front desk can't write or read prescriptions; the assistant reads but can't issue.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/prescriptions/{id}"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/prescriptions/{id}"),
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = issue(&app, &assistant, id, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn follow_ups_are_planned_listed_and_done_per_clinic() {
    let app = start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let patient = patient(&app, ALPHA, &desk).await;
    let path = format!("/api/v1/patients/{patient}/recalls");
    let body =
        json!({ "due_on": "2027-04-01", "reason": "Six-month cleaning", "kind": "cleaning" });
    let (status, recall) = app
        .send(Method::POST, ALPHA, &path, Some(&desk), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{recall}");
    assert_eq!(recall["status"], "due");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "due_on": "2027-04-01", "reason": "" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let assistant = app.token(ALPHA_ASSISTANT);
    let (_, due) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/recalls?due_before=2027-04-02",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(due["items"].as_array().unwrap().len(), 1);
    let (_, later) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/recalls?due_before=2027-04-01",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(later["items"], json!([]));
    let done = format!("/api/v1/recalls/{}/done", recall["id"].as_str().unwrap());
    let (status, _) = app
        .send(Method::POST, ALPHA, &done, Some(&assistant), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let beta = app.token(BETA_OWNER);
    let (status, _) = app.send(Method::POST, BETA, &done, Some(&beta), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let body = json!({ "due_on": "2027-04-01", "reason": "x" });
    let (status, _) = app
        .send(Method::POST, BETA, &path, Some(&beta), Some(body))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, theirs) = app
        .send(Method::GET, BETA, "/api/v1/recalls", Some(&beta), None)
        .await;
    assert_eq!(theirs["items"], json!([]));
    let (status, closed) = app
        .send(Method::POST, ALPHA, &done, Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(closed["status"], "done");
    let (status, _) = app
        .send(Method::POST, ALPHA, &done, Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_allergy_check_reads_the_recorded_allergies() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let path = format!("/api/v1/patients/{patient}/allergies");
    let allergy = json!({ "substance": "Penicillin", "severity": "severe" });
    let (status, body) = app
        .send(Method::POST, ALPHA, &path, Some(&owner), Some(allergy))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let amox = drug(&app, &owner, "amoxicillin 500").await;
    let rx = draft(&app, &owner, &patient, json!([{ "drug_id": amox["id"] }])).await;
    let (status, blocked) = issue(&app, &owner, rx["id"].as_str().unwrap(), json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{blocked}");
    assert_eq!(blocked["alerts"][0]["severity"], "serious");

    // A bill or prescription names only a visit of the same patient.
    let stranger = json!({ "patient_id": patient, "encounter_id": uuid::Uuid::now_v7(),
                           "items": [{ "description": "X", "unit_price_paise": 100 }] });
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/invoices",
            Some(&owner),
            Some(stranger),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

async fn patient_with(app: &TestApp, token: &str, extra: Value) -> String {
    let mut body = json!({ "full_name": "Rahul Verma", "sex": "male", "age_years": 40 });
    body.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn rx_draft(app: &TestApp, token: &str, patient: &str) -> String {
    let items = json!([{ "drug_name": "Ibuprofen", "dose": "1 tablet", "frequency": "1-1-1" }]);
    draft(app, token, patient, items).await["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn queued(app: &TestApp) -> Vec<(String, Value, Option<String>)> {
    sqlx::query_as(
        "select p.email, m.variables, m.secret from aarogyam.messages m
         join aarogyam.patients p on p.org_id = m.org_id and p.id = m.patient_id
         where m.kind = 'prescription.shared' order by m.created_at",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn issuing_emails_the_patient_a_link_without_the_pin_or_medicines() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient_with(&app, &owner, json!({ "email": "rahul@example.in" })).await;
    let id = rx_draft(&app, &owner, &patient).await;
    let (status, issued) = issue(&app, &owner, &id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    let message = &issued["patient_message"];
    assert_eq!(message["status"], "sent");
    let pin = message["pin"].as_str().unwrap().to_owned();
    assert_eq!(pin.len(), 6);

    let rows = queued(&app).await;
    assert_eq!(rows.len(), 1);
    let (recipient, payload, token) = &rows[0];
    assert_eq!(recipient, "rahul@example.in");
    let stored = payload.to_string();
    for secret in [pin.as_str(), "Ibuprofen", "Pericoronitis", "Rahul", "Verma"] {
        assert!(!stored.contains(secret), "payload leaks {secret}");
    }
    assert_eq!(payload["portal_host"], ALPHA);
    let token = token.clone().unwrap();

    // The queued link opens the prescription with the PIN.
    let (status, opened) = shared(&app, &token, &pin).await;
    assert_eq!(status, StatusCode::OK, "{opened}");

    // The queued message is delivered.
    let (_, report) = app
        .send(
            Method::POST,
            "localhost",
            "/api/v1/internal/outbox/drain",
            None,
            None,
        )
        .await;
    // A patient email: the patient message step sends it, through the log channel here.
    assert_eq!(report["messages_sent"], 1, "{report}");

    // Cancel and reissue sends a second, fresh link.
    let cancel = format!("/api/v1/prescriptions/{id}/cancel");
    let (_, cancelled) = app
        .send(
            Method::POST,
            ALPHA,
            &cancel,
            Some(&owner),
            Some(json!({ "reason": "Wrong dose" })),
        )
        .await;
    let again = cancelled["draft"]["id"].as_str().unwrap();
    let (status, issued) = issue(&app, &owner, again, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["patient_message"]["status"], "sent");
    assert_eq!(queued(&app).await.len(), 2);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn nothing_is_sent_without_an_email_or_when_the_doctor_declines() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let none = patient(&app, ALPHA, &owner).await;
    let id = rx_draft(&app, &owner, &none).await;
    let (status, issued) = issue(&app, &owner, &id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["patient_message"]["status"], "not_sent");
    assert_eq!(issued["patient_message"]["reason"], "no_email");
    assert!(issued["patient_message"]["pin"].is_null());

    let with = patient_with(&app, &owner, json!({ "email": "rahul@example.in" })).await;
    let id = rx_draft(&app, &owner, &with).await;
    let (status, issued) = issue(&app, &owner, &id, json!({ "notify_patient": false })).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["patient_message"]["reason"], "declined");
    assert_eq!(queued(&app).await.len(), 0);
    let (links,): (i64,) = sqlx::query_as("select count(*) from aarogyam.share_links")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(links, 0);
    app.finish().await;
}
