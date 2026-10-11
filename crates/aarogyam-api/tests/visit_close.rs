//! Closing a visit with a follow-up and a fee, and payment proof, on a real database.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime};

async fn register(app: &TestApp, token: &str, name: &str) -> String {
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    patient["id"].as_str().unwrap().to_owned()
}

async fn start_visit(app: &TestApp, token: &str, patient: &str) -> String {
    let (status, visit) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/visits"),
            Some(token),
            Some(json!({ "chief_complaint": "Check-up" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    visit["id"].as_str().unwrap().to_owned()
}

async fn close(
    app: &TestApp,
    token: &str,
    visit: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/visits/{visit}/close"),
        Some(token),
        body,
    )
    .await
}

async fn count(app: &TestApp, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

fn day(offset: i64) -> String {
    let date = (OffsetDateTime::now_utc() + Duration::days(offset)).date();
    date.to_string()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_empty_close_changes_nothing_else() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let (status, closed) = close(&app, &owner, &visit, None).await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["status"], "closed");
    assert_eq!(closed["recall_id"], Value::Null);
    assert_eq!(closed["invoice_id"], Value::Null);
    assert_eq!(
        count(&app, "select count(*) from aarogyam.recalls").await,
        0
    );
    assert_eq!(
        count(&app, "select count(*) from aarogyam.invoices").await,
        0
    );
    // Closing again is refused and makes nothing.
    let (status, _) = close(&app, &owner, &visit, Some(json!({ "fee_paise": 50_000 }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        count(&app, "select count(*) from aarogyam.invoices").await,
        0
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn close_plans_a_follow_up_and_bills_the_fee() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner, "Meera Shah").await;

    // Follow-up only.
    let visit = start_visit(&app, &owner, &patient).await;
    let due = day(14);
    let (status, closed) = close(
        &app,
        &owner,
        &visit,
        Some(json!({ "follow_up_on": due, "follow_up_reason": "Review after scaling" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert!(closed["recall_id"].is_string());
    assert_eq!(closed["invoice_id"], Value::Null);
    let (reason, due_on, source): (String, String, String) = sqlx::query_as(
        "select reason, due_on::text, source_encounter_id::text from aarogyam.recalls",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((reason.as_str(), due_on), ("Review after scaling", due));
    assert_eq!(source, visit);

    // Fee only: one draft bill linked to the visit.
    let visit = start_visit(&app, &owner, &patient).await;
    let (status, closed) = close(
        &app,
        &owner,
        &visit,
        Some(json!({ "fee_paise": 50_000, "note": "Paid at desk" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["recall_id"], Value::Null);
    let invoice = closed["invoice_id"].as_str().unwrap();
    let (_, bill) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/invoices/{invoice}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(bill["status"], "draft");
    assert_eq!(bill["encounter_id"], visit);
    assert_eq!(bill["subtotal_paise"], 50_000);
    assert_eq!(bill["notes"], "Paid at desk");

    // Both, with a priced procedure: two lines.
    let visit = start_visit(&app, &owner, &patient).await;
    let (status, procedure) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{visit}/procedures"),
            Some(&owner),
            Some(json!({ "name": "Scaling", "price_paise": 120_000 })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{procedure}");
    let (status, closed) = close(
        &app,
        &owner,
        &visit,
        Some(json!({ "fee_paise": 30_000, "follow_up_on": day(0) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert!(closed["recall_id"].is_string());
    let invoice = closed["invoice_id"].as_str().unwrap();
    let (_, bill) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/invoices/{invoice}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(bill["subtotal_paise"], 150_000);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.invoice_items where procedure_id is not null"
        )
        .await,
        1
    );

    // Procedures alone are billed too, and a bill already on the visit isn't doubled.
    let visit = start_visit(&app, &owner, &patient).await;
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/visits/{visit}/procedures"),
        Some(&owner),
        Some(json!({ "name": "Filling", "price_paise": 80_000 })),
    )
    .await;
    let (status, existing) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/invoices",
            Some(&owner),
            Some(json!({ "patient_id": patient, "encounter_id": visit,
                         "items": [{ "description": "Filling", "unit_price_paise": 80_000 }] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{existing}");
    let (_, closed) = close(&app, &owner, &visit, Some(json!({ "fee_paise": 10_000 }))).await;
    assert_eq!(closed["invoice_id"], existing["id"]);
    assert_eq!(
        count(
            &app,
            &format!("select count(*) from aarogyam.invoices where encounter_id = '{visit}'")
        )
        .await,
        1
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn close_refuses_bad_input_without_closing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let patient = register(&app, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    for body in [
        json!({ "follow_up_on": day(-2) }),
        json!({ "follow_up_on": "soon" }),
        json!({ "fee_paise": 0 }),
        json!({ "follow_up_reason": "x".repeat(301), "follow_up_on": day(3) }),
    ] {
        let (status, error) = close(&app, &owner, &visit, Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    }
    // Another clinic sees no such visit; a role without clinical.write is refused.
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &format!("/api/v1/visits/{visit}/close"),
            Some(&beta),
            Some(json!({ "fee_paise": 100 })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = close(&app, &desk, &visit, Some(json!({ "fee_paise": 100 }))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = close(&app, &owner, &visit, None).await;
    assert_eq!(status, StatusCode::OK, "nothing above closed it");
    assert_eq!(
        count(&app, "select count(*) from aarogyam.recalls").await,
        0
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn payment_proof_must_belong_to_the_same_patient() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, &owner, "Meera Shah").await;
    let other = register(&app, &owner, "Ravi Kumar").await;
    let mut png = vec![0x89_u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    png.extend_from_slice(&[7_u8; 256]);
    let (status, proof) = app
        .upload(ALPHA, &owner, &patient, &png, &[("kind", "payment_proof")])
        .await;
    assert_eq!(status, StatusCode::CREATED, "{proof}");
    assert_eq!(proof["kind"], "payment_proof");
    let proof = proof["id"].as_str().unwrap();
    let (_, theirs) = app
        .upload(ALPHA, &owner, &other, &png, &[("kind", "payment_proof")])
        .await;
    let (_, plain) = app
        .upload(ALPHA, &owner, &patient, &png, &[("kind", "document")])
        .await;
    let pay = |key: &'static str, patient: String, attachment: String| {
        let app = &app;
        let owner = owner.clone();
        async move {
            app.send_with(
                Method::POST,
                ALPHA,
                "/api/v1/payments",
                Some(&owner),
                Some(
                    json!({ "patient_id": patient, "method": "upi", "amount_paise": 10_000,
                             "attachment_id": attachment }),
                ),
                &[("idempotency-key", key)],
            )
            .await
        }
    };
    let (status, error) = pay(
        "key-0000-0001",
        patient.clone(),
        theirs["id"].as_str().unwrap().to_owned(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = pay(
        "key-0000-0002",
        patient.clone(),
        plain["id"].as_str().unwrap().to_owned(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = pay(
        "key-0000-0003",
        patient.clone(),
        uuid::Uuid::now_v7().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        count(&app, "select count(*) from aarogyam.payments").await,
        0
    );
    let (status, paid) = pay("key-0000-0004", patient.clone(), proof.to_owned()).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    assert_eq!(paid["attachment_id"], proof);
    let (_, list) = app
        .send(Method::GET, ALPHA, "/api/v1/payments", Some(&owner), None)
        .await;
    assert_eq!(list["items"][0]["attachment_id"], proof);
    // Another clinic's proof is not found.
    let (status, _) = app
        .send_with(
            Method::POST,
            BETA,
            "/api/v1/payments",
            Some(&beta),
            Some(
                json!({ "patient_id": patient, "method": "cash", "amount_paise": 100,
                         "attachment_id": proof }),
            ),
            &[("idempotency-key", "key-0000-0005")],
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
