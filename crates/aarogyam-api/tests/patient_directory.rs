//! The patient directory (B4): list rows carry flags, money only with `billing.read`, the
//! directory summary, walk-in conditions and family links, the patient photo, and the
//! consent-to-sign link.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt;

async fn register(app: &TestApp, host: &str, token: &str, body: Value) -> String {
    let (status, value) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{value}");
    value["id"].as_str().unwrap().to_owned()
}

async fn items(app: &TestApp, token: &str) -> Vec<Value> {
    let (status, list) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(token), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    list["items"].as_array().unwrap().clone()
}

fn row<'a>(rows: &'a [Value], id: &str) -> &'a Value {
    rows.iter().find(|r| r["id"] == id).unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn list_rows_carry_flags_and_money_only_with_billing_read() {
    let app = TestApp::start().await;
    let (owner, desk, assistant) = (
        app.token(ALPHA_OWNER),
        app.token(ALPHA_FRONT_DESK),
        app.token(ALPHA_ASSISTANT),
    );
    let asha = register(&app, ALPHA, &owner, json!({ "full_name": "Asha Verma" })).await;
    let ravi = register(&app, ALPHA, &owner, json!({ "full_name": "Ravi Kumar" })).await;
    // Ravi has a reported allergy and consent to care on record; Asha neither.
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/walk-ins",
            Some(&desk),
            Some(json!({ "patient_id": ravi, "allergies": ["Latex"],
                         "consents": [{ "purpose": "care", "method": "verbal" }] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    // The walk-in answers with the flags as they are after it.
    assert_eq!(body["patient"]["allergy_alert"], true);
    assert_eq!(body["patient"]["consent_pending"], false);

    let rows = items(&app, &owner).await;
    let (a, r) = (row(&rows, &asha), row(&rows, &ravi));
    assert_eq!(a["allergy_alert"], false);
    assert_eq!(a["consent_pending"], true);
    assert_eq!(a["has_photo"], false);
    assert_eq!(r["allergy_alert"], true);
    assert_eq!(r["consent_pending"], false);
    assert_eq!(a["balance_paise"], 0);

    // Searching and opening carry the same flags.
    let (_, found) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients/search",
            Some(&owner),
            Some(json!({ "q": "Ravi" })),
        )
        .await;
    assert_eq!(found["items"][0]["allergy_alert"], true);
    let (_, opened) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{ravi}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(opened["allergy_alert"], true);
    assert_eq!(opened["consent_pending"], false);
    // An edit answers with them too.
    let (status, edited) = app
        .send_with(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/patients/{ravi}"),
            Some(&owner),
            Some(json!({ "full_name": "Ravi Kumar" })),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["allergy_alert"], true);

    // Without billing.read the money keys are absent, not null or zero, on every response.
    let rows = items(&app, &assistant).await;
    for r in &rows {
        let object = r.as_object().unwrap();
        assert!(!object.contains_key("balance_paise"), "{r}");
        assert!(!object.contains_key("lifetime_paid_paise"), "{r}");
    }
    let (_, found) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients/search",
            Some(&assistant),
            Some(json!({ "q": "Ravi" })),
        )
        .await;
    assert!(
        !found["items"][0]
            .as_object()
            .unwrap()
            .contains_key("balance_paise")
    );
    let (_, opened) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{ravi}"),
            Some(&assistant),
            None,
        )
        .await;
    assert!(!opened.as_object().unwrap().contains_key("balance_paise"));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_directory_summary_counts_and_gates_the_balance() {
    let app = TestApp::start().await;
    let (owner, assistant, nothing, beta) = (
        app.token(ALPHA_OWNER),
        app.token(ALPHA_ASSISTANT),
        app.token(ALPHA_NOTHING),
        app.token(BETA_OWNER),
    );
    let asha = register(&app, ALPHA, &owner, json!({ "full_name": "Asha Verma" })).await;
    let ravi = register(&app, ALPHA, &owner, json!({ "full_name": "Ravi Kumar" })).await;
    register(&app, BETA, &beta, json!({ "full_name": "Beta Patient" })).await;
    // Ravi registered long ago; Asha owes money; Ravi has a recall due.
    sqlx::query("alter table aarogyam.patients disable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    sqlx::query(
        "update aarogyam.patients set created_at = now() - interval '90 days' where id = $1::uuid",
    )
    .bind(&ravi)
    .execute(&app.owner)
    .await
    .unwrap();
    sqlx::query("alter table aarogyam.patients enable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, bill) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/invoices",
            Some(&owner),
            Some(json!({ "patient_id": asha,
                         "items": [{ "description": "Work", "unit_price_paise": 50_000 }] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{bill}");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/invoices/{}/issue", bill["id"].as_str().unwrap()),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, recall) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{ravi}/recalls"),
            Some(&owner),
            Some(json!({ "reason": "Check-up", "due_on": "2020-01-01" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{recall}");

    let (status, summary) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/patients/summary",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(
        summary["total"], 2,
        "the other clinic's patient is not counted"
    );
    assert_eq!(summary["new_this_month"], 1);
    assert_eq!(summary["recalls_due"], 1);
    assert_eq!(summary["with_balance"], 1);

    // Without billing.read the balance count is absent; without patients.read it is refused.
    let (status, summary) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/patients/summary",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(summary["total"], 2);
    assert!(!summary.as_object().unwrap().contains_key("with_balance"));
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/patients/summary",
            Some(&nothing),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // The other clinic counts only its own.
    let (_, summary) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/patients/summary",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(summary["total"], 1);
    assert_eq!(summary["with_balance"], 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_walk_in_records_reported_conditions_and_joins_a_family() {
    let app = TestApp::start().await;
    let (desk, owner, beta) = (
        app.token(ALPHA_FRONT_DESK),
        app.token(ALPHA_OWNER),
        app.token(BETA_OWNER),
    );
    let walk_in = async |body: Value| {
        app.send(
            Method::POST,
            ALPHA,
            "/api/v1/walk-ins",
            Some(&desk),
            Some(body),
        )
        .await
    };

    let (status, mother) = walk_in(json!({
        "patient": { "full_name": "Sunita Patil", "phone": "98765 11111" },
        "conditions": ["Diabetes", "diabetes ", "High blood pressure"]
    }))
    .await;
    assert_eq!(status, StatusCode::CREATED, "{mother}");
    assert_eq!(mother["conditions_recorded"], 2);
    assert_eq!(mother["family_linked"], false);
    let mother_id = mother["patient"]["id"].as_str().unwrap().to_owned();
    // They show as patient-reported, flagged conditions awaiting a clinician.
    let (status, conditions) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{mother_id}/conditions"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{conditions}");
    let listed = conditions["items"].as_array().unwrap();
    assert_eq!(listed.len(), 2);
    for c in listed {
        assert_eq!(c["source"], "patient");
        assert_eq!(c["flagged"], true);
        assert_eq!(c["status"], "active");
        assert_eq!(c["verified_by"], Value::Null);
    }
    let (_, flags) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{mother_id}/clinical-flags"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(flags["condition_count"], 2, "{flags}");
    assert!(
        flags["conditions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["flagged"] == true)
    );
    // Repeating a condition already active records nothing new.
    let (_, again) = walk_in(json!({ "patient_id": mother_id, "conditions": ["Diabetes"] })).await;
    assert_eq!(again["conditions_recorded"], 0);

    // Bad input is refused whole.
    let blank = walk_in(json!({ "patient": { "full_name": "X" }, "conditions": ["  "] })).await;
    assert_eq!(blank.0, StatusCode::BAD_REQUEST, "{}", blank.1);
    let many: Vec<String> = (0..21).map(|n| format!("Condition {n}")).collect();
    let too_many = walk_in(json!({ "patient": { "full_name": "X" }, "conditions": many })).await;
    assert_eq!(too_many.0, StatusCode::BAD_REQUEST);

    // A child joins the mother's family at the same phone.
    let (status, child) = walk_in(json!({
        "patient": { "full_name": "Aarav Patil", "age_years": 6, "phone": "98765 11111" },
        "family_of": { "patient_id": mother_id, "relation": "guardian" }
    }))
    .await;
    assert_eq!(status, StatusCode::CREATED, "{child}");
    assert_eq!(child["family_linked"], true);
    let child_id = child["patient"]["id"].as_str().unwrap().to_owned();
    let (status, found) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients/lookup",
            Some(&desk),
            Some(json!({ "phone": "9876511111" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{found}");
    let matches = found["items"].as_array().unwrap();
    assert_eq!(matches.len(), 2);
    let of = |id: &str| matches.iter().find(|m| m["id"] == id).unwrap();
    assert_eq!(of(&child_id)["family"][0]["id"], mother_id);
    assert_eq!(of(&child_id)["family"][0]["relation"], "guardian");
    assert_eq!(of(&mother_id)["family"][0]["id"], child_id);
    assert_eq!(of(&mother_id)["family"][0]["relation"], "child");
    // A patient with no relatives has an empty family.
    let (_, lone) =
        walk_in(json!({ "patient": { "full_name": "Lone Patient", "phone": "9876522222" } })).await;
    assert_eq!(lone["family_linked"], false);
    let (_, found) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients/lookup",
            Some(&desk),
            Some(json!({ "phone": "9876522222" })),
        )
        .await;
    assert_eq!(found["items"][0]["family"], json!([]));

    // Refused: an unknown relation, oneself, and a relative of another clinic (404).
    let (status, _) = walk_in(json!({ "patient": { "full_name": "Y" },
        "family_of": { "patient_id": mother_id, "relation": "cousin" } }))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = walk_in(json!({ "patient_id": mother_id,
        "family_of": { "patient_id": mother_id, "relation": "other" } }))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let stranger = register(&app, BETA, &beta, json!({ "full_name": "Beta Patient" })).await;
    let (status, _) = walk_in(json!({ "patient": { "full_name": "Z" },
        "family_of": { "patient_id": stranger, "relation": "spouse" } }))
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Nothing from the refused walk-ins stayed behind.
    let (_, rows) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&owner), None)
        .await;
    let names: Vec<&str> = rows["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["full_name"].as_str().unwrap())
        .collect();
    assert!(!names.contains(&"Z") && !names.contains(&"Y"), "{names:?}");

    // Erasure knows the new tables.
    let registered: Vec<String> = sqlx::query_scalar(
        "select table_name from audit.erasure_steps
         where table_name in ('aarogyam.patient_relations', 'aarogyam.patient_photos',
                              'aarogyam.consent_requests') and action = 'delete'",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(registered.len(), 3);
    app.finish().await;
}

fn png() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(2048, 7);
    bytes
}

async fn photo_request(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    method: Method,
    file: Option<&[u8]>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    const BOUNDARY: &str = "aarogyam-photo-boundary";
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("/api/v1/patients/{patient}/photo"))
        .header("host", host)
        .header("authorization", format!("Bearer {token}"));
    let mut body = Vec::new();
    if let Some(bytes) = file {
        builder = builder.header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        );
        body.extend_from_slice(
            format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"p.bin\"\r\n\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    }
    let response = app
        .router
        .clone()
        .oneshot(builder.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let (status, headers) = (response.status(), response.headers().clone());
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, headers, bytes.to_vec())
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_patient_photo_is_set_read_replaced_and_removed_within_reach() {
    let app = TestApp::start().await;
    let (desk, owner, nothing, beta) = (
        app.token(ALPHA_FRONT_DESK),
        app.token(ALPHA_OWNER),
        app.token(ALPHA_NOTHING),
        app.token(BETA_OWNER),
    );
    let patient = register(&app, ALPHA, &owner, json!({ "full_name": "Asha Verma" })).await;

    // No photo yet.
    let (status, ..) = photo_request(&app, ALPHA, &owner, &patient, Method::GET, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Checked by content, not by name.
    let (status, ..) = photo_request(
        &app,
        ALPHA,
        &desk,
        &patient,
        Method::PUT,
        Some(b"GIF89a-no"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, ..) = photo_request(&app, ALPHA, &desk, &patient, Method::PUT, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // A role without patients.write can't set one; another clinic can't see the patient.
    let (status, ..) =
        photo_request(&app, ALPHA, &nothing, &patient, Method::PUT, Some(&png())).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, ..) = photo_request(&app, BETA, &beta, &patient, Method::PUT, Some(&png())).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, ..) = photo_request(&app, ALPHA, &desk, &patient, Method::PUT, Some(&png())).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, headers, bytes) =
        photo_request(&app, ALPHA, &owner, &patient, Method::GET, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "image/png");
    assert_eq!(headers["cache-control"], "private, no-store");
    assert_eq!(bytes, png());
    // Reading is for patients.read only, and never across clinics.
    let (status, ..) = photo_request(&app, ALPHA, &nothing, &patient, Method::GET, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, ..) = photo_request(&app, BETA, &beta, &patient, Method::GET, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let rows = items(&app, &owner).await;
    assert_eq!(row(&rows, &patient)["has_photo"], true);

    // A replacement leaves one row.
    let mut second = png();
    second.push(9);
    let (status, ..) =
        photo_request(&app, ALPHA, &desk, &patient, Method::PUT, Some(&second)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, _, bytes) = photo_request(&app, ALPHA, &owner, &patient, Method::GET, None).await;
    assert_eq!(bytes, second);
    let count: i64 = sqlx::query_scalar("select count(*) from aarogyam.patient_photos")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(count, 1);

    // Removing is allowed twice; another clinic can't remove it.
    let (status, ..) = photo_request(&app, BETA, &beta, &patient, Method::DELETE, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for _ in 0..2 {
        let (status, ..) = photo_request(&app, ALPHA, &desk, &patient, Method::DELETE, None).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    let (status, ..) = photo_request(&app, ALPHA, &owner, &patient, Method::GET, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let rows = items(&app, &owner).await;
    assert_eq!(row(&rows, &patient)["has_photo"], false);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_patient_signs_consent_through_a_one_time_link() {
    let app = TestApp::start().await;
    let (desk, owner, nothing, beta) = (
        app.token(ALPHA_FRONT_DESK),
        app.token(ALPHA_OWNER),
        app.token(ALPHA_NOTHING),
        app.token(BETA_OWNER),
    );
    let patient = register(
        &app,
        ALPHA,
        &owner,
        json!({ "full_name": "Asha Verma", "email": "asha@example.in" }),
    )
    .await;
    let no_email = register(
        &app,
        ALPHA,
        &owner,
        json!({ "full_name": "Phone Only", "phone": "9876500009" }),
    )
    .await;
    let ask = |token: String, host: &'static str, id: String, body: Value| {
        let app = &app;
        async move {
            app.send(
                Method::POST,
                host,
                &format!("/api/v1/patients/{id}/consents/request"),
                Some(&token),
                Some(body),
            )
            .await
        }
    };

    // Refused: no permission, another clinic's patient, a patient with no email, bad purposes.
    assert_eq!(
        ask(nothing.clone(), ALPHA, patient.clone(), json!({}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        ask(beta.clone(), BETA, patient.clone(), json!({})).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        ask(desk.clone(), ALPHA, no_email, json!({})).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        ask(
            desk.clone(),
            ALPHA,
            patient.clone(),
            json!({ "purposes": ["care", "care"] })
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        ask(
            desk.clone(),
            ALPHA,
            patient.clone(),
            json!({ "purposes": ["nonsense"] })
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    let (status, requested) = ask(
        desk.clone(),
        ALPHA,
        patient.clone(),
        json!({ "purposes": ["care", "reminders"] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{requested}");
    assert_eq!(requested["channel"], "email");
    assert_eq!(requested["purposes"], json!(["care", "reminders"]));
    // It is a care message in the queue, holding the patient's id and the token, no address.
    let (kind, purpose, channel, status_text, secret): (
        String,
        String,
        String,
        String,
        Option<String>,
    ) = sqlx::query_as(
        "select kind, purpose, channel, status, secret from aarogyam.messages
             where kind = 'consent.requested'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        (
            kind.as_str(),
            purpose.as_str(),
            channel.as_str(),
            status_text.as_str()
        ),
        ("consent.requested", "care", "email", "queued")
    );
    let token = secret.unwrap();
    let stored: String = sqlx::query_scalar("select token_hash from aarogyam.consent_requests")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_ne!(stored, token, "only the hash is stored");

    // The patient (no sign-in) reads the link on the clinic's host.
    let public = |method: Method, host: &'static str, token: String, body: Option<Value>| {
        let app = &app;
        async move {
            app.send(
                method,
                host,
                &format!("/api/v1/public/consents/{token}"),
                None,
                body,
            )
            .await
        }
    };
    let (status, link) = public(Method::GET, ALPHA, token.clone(), None).await;
    assert_eq!(status, StatusCode::OK, "{link}");
    assert_eq!(link["state"], "pending");
    assert_eq!(link["purposes"], json!(["care", "reminders"]));
    assert!(link["clinic_name"].as_str().is_some());
    assert!(
        !link.to_string().contains("Asha"),
        "no patient data on the page"
    );
    // Not on another clinic's host, nor with a made-up token.
    assert_eq!(
        public(Method::GET, BETA, token.clone(), None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        public(Method::GET, ALPHA, "nope".into(), None).await.0,
        StatusCode::NOT_FOUND
    );

    // Signing needs a clear yes, and only for purposes asked about.
    let (status, _) = public(
        Method::POST,
        ALPHA,
        token.clone(),
        Some(json!({ "agree": false })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = public(
        Method::POST,
        ALPHA,
        token.clone(),
        Some(json!({ "agree": true, "purposes": ["promotional"] })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, rows) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&owner), None)
        .await;
    assert_eq!(
        row(rows["items"].as_array().unwrap(), &patient)["consent_pending"],
        true
    );

    let (status, signed) = public(
        Method::POST,
        ALPHA,
        token.clone(),
        Some(json!({ "agree": true, "purposes": ["care"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["recorded"], json!(["care"]));
    let (_, consents) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/consents"),
            Some(&owner),
            None,
        )
        .await;
    let consent = &consents["items"][0];
    assert_eq!(
        (consent["purpose"].as_str(), consent["method"].as_str()),
        (Some("care"), Some("app"))
    );
    let (_, rows) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&owner), None)
        .await;
    assert_eq!(
        row(rows["items"].as_array().unwrap(), &patient)["consent_pending"],
        false
    );
    // Once only.
    let (status, again) = public(
        Method::POST,
        ALPHA,
        token.clone(),
        Some(json!({ "agree": true })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{again}");
    let (_, link) = public(Method::GET, ALPHA, token, None).await;
    assert_eq!(link["state"], "signed");

    // An expired link can be read but not signed.
    let (status, _) = ask(desk.clone(), ALPHA, patient.clone(), json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    let secret: String = sqlx::query_scalar(
        "select secret from aarogyam.messages where kind = 'consent.requested' order by created_at desc limit 1",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    sqlx::query("update aarogyam.consent_requests set expires_at = now() - interval '1 hour' where signed_at is null")
        .execute(&app.owner)
        .await
        .unwrap();
    let (_, link) = public(Method::GET, ALPHA, secret.clone(), None).await;
    assert_eq!(link["state"], "expired");
    let (status, _) = public(Method::POST, ALPHA, secret, Some(json!({ "agree": true }))).await;
    assert_eq!(status, StatusCode::GONE);
    app.finish().await;
}
