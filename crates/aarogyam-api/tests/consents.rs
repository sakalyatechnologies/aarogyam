//! Notice and consent records: recording, withdrawing, listing, roles, other clinics, and the
//! database's own guards (row-level security, composite keys, a withdrawn record is final).
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, DbErrorKind, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn patient(app: &TestApp, token: &str) -> String {
    let (status, value) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": "Kavya Rao" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{value}");
    value["id"].as_str().unwrap().to_owned()
}

async fn record(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        &format!("/api/v1/patients/{patient}/consents"),
        Some(token),
        Some(body),
    )
    .await
}

async fn list(app: &TestApp, host: &str, token: &str, patient: &str) -> (StatusCode, Value) {
    app.send(
        Method::GET,
        host,
        &format!("/api/v1/patients/{patient}/consents"),
        Some(token),
        None,
    )
    .await
}

async fn withdraw(
    app: &TestApp,
    host: &str,
    token: &str,
    consent: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        &format!("/api/v1/consents/{consent}/withdraw"),
        Some(token),
        Some(body),
    )
    .await
}

fn paper(purpose: &str) -> Value {
    json!({ "purpose": purpose, "notice_version": "v1 2026-10", "method": "paper", "note": "Form 12" })
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_consent_is_recorded_listed_withdrawn_and_given_again() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, &owner).await;

    let (status, empty) = list(&app, ALPHA, &desk, &patient).await;
    assert_eq!(status, StatusCode::OK, "{empty}");
    assert_eq!(empty["items"], json!([]));

    let (status, care) = record(&app, ALPHA, &desk, &patient, paper("care")).await;
    assert_eq!(status, StatusCode::CREATED, "{care}");
    assert_eq!(care["purpose"], "care");
    assert_eq!(care["notice_version"], "v1 2026-10");
    assert_eq!(care["method"], "paper");
    assert_eq!(care["status"], "given");
    assert_eq!(care["recorded_by"], "Farah Desk");
    assert_eq!(care["note"], "Form 12");
    assert!(care["withdrawn_at"].is_null());

    // A time the patient agreed earlier than the entry is kept as given.
    let (status, promo) = record(
        &app,
        ALPHA,
        &desk,
        &patient,
        json!({ "purpose": "promotional", "notice_version": "v1 2026-10", "method": "verbal",
                "given_at": "2026-10-01T10:00:00+05:30" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{promo}");
    assert!(
        promo["given_at"]
            .as_str()
            .unwrap()
            .starts_with("2026-10-01T04:30:00"),
        "{promo}"
    );

    // A second active consent for the same purpose is refused until the first is withdrawn.
    let (status, again) = record(&app, ALPHA, &desk, &patient, paper("care")).await;
    assert_eq!(status, StatusCode::CONFLICT, "{again}");

    let (status, gone) = withdraw(
        &app,
        ALPHA,
        &desk,
        promo["id"].as_str().unwrap(),
        json!({ "method": "verbal", "note": "Asked at the desk" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{gone}");
    assert_eq!(gone["status"], "withdrawn");
    assert_eq!(gone["withdrawn_by"], "Farah Desk");
    assert_eq!(gone["withdrawn_method"], "verbal");
    assert_eq!(gone["withdrawal_note"], "Asked at the desk");
    assert!(gone["withdrawn_at"].is_string());

    // Withdrawing twice is a conflict; the record keeps its history.
    let (status, twice) = withdraw(
        &app,
        ALPHA,
        &desk,
        promo["id"].as_str().unwrap(),
        json!({ "method": "app" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{twice}");

    // Consent can be given again after a withdrawal: a new row, the old one stays.
    let (status, new) = record(&app, ALPHA, &desk, &patient, paper("promotional")).await;
    assert_eq!(status, StatusCode::CREATED, "{new}");
    let (_, listed) = list(&app, ALPHA, &owner, &patient).await;
    let items = listed["items"].as_array().unwrap();
    assert_eq!(items.len(), 3, "{listed}");
    let statuses: Vec<_> = items
        .iter()
        .filter(|c| c["purpose"] == "promotional")
        .map(|c| c["status"].as_str().unwrap())
        .collect();
    assert!(
        statuses.contains(&"given") && statuses.contains(&"withdrawn"),
        "{listed}"
    );

    // Every change is in the change history.
    let (changes,): (i64,) = sqlx::query_as(
        "select count(*) from audit.audit_events where table_name = 'aarogyam.patient_consents'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(changes, 4);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bad_input_is_refused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, &owner).await;
    for body in [
        json!({ "purpose": "marketing", "notice_version": "v1", "method": "paper" }),
        json!({ "purpose": "care", "notice_version": "v1", "method": "fax" }),
        json!({ "purpose": "care", "notice_version": "", "method": "paper" }),
        json!({ "purpose": "care", "notice_version": "x".repeat(41), "method": "paper" }),
        json!({ "purpose": "care", "notice_version": "v1", "method": "paper", "note": "x".repeat(501) }),
        json!({ "purpose": "care", "notice_version": "v1", "method": "paper", "given_at": "yesterday" }),
        json!({ "purpose": "care", "notice_version": "v1", "method": "paper", "given_at": "2999-01-01T00:00:00Z" }),
    ] {
        let (status, error) = record(&app, ALPHA, &owner, &patient, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    let (_, listed) = list(&app, ALPHA, &owner, &patient).await;
    assert_eq!(listed["items"], json!([]));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn roles_and_other_clinics() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, &owner).await;
    let (_, made) = record(&app, ALPHA, &owner, &patient, paper("care")).await;
    let consent = made["id"].as_str().unwrap();

    // The assistant may read but not record or withdraw; a role with nothing may do neither.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = list(&app, ALPHA, &assistant, &patient).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = record(&app, ALPHA, &assistant, &patient, paper("reminders")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = withdraw(
        &app,
        ALPHA,
        &assistant,
        consent,
        json!({ "method": "paper" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = list(&app, ALPHA, &nothing, &patient).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic's owner gets 404 on every route, and nothing changes.
    let beta = app.token(BETA_OWNER);
    let (status, _) = list(&app, BETA, &beta, &patient).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = record(&app, BETA, &beta, &patient, paper("reminders")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = withdraw(&app, BETA, &beta, consent, json!({ "method": "paper" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, listed) = list(&app, ALPHA, &owner, &patient).await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
    assert_eq!(listed["items"][0]["status"], "given");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_database_keeps_clinics_apart_and_withdrawn_records_final() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, &owner).await;
    let (_, made) = record(&app, ALPHA, &owner, &patient, paper("care")).await;
    let consent = made["id"].as_str().unwrap().to_owned();
    let (alpha, beta) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();

    // Row-level security: Beta sees none of Alpha's consents.
    let seen = db
        .scoped(&Scope::tenant(beta), async |tx| {
            sqlx::query_scalar::<_, i64>("select count(*) from aarogyam.patient_consents")
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap();
    assert_eq!(seen, 0);

    // The composite key: Beta cannot attach a consent to Alpha's patient, nor use Alpha's
    // membership as its recorder, even by writing the rows directly.
    let (member,): (uuid::Uuid,) =
        sqlx::query_as("select id from aarogyam.memberships where org_id = $1 limit 1")
            .bind(alpha)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let error = db
        .scoped(&Scope::tenant(beta), async |tx| {
            sqlx::query(
                "insert into aarogyam.patient_consents (patient_id, purpose, notice_version, method, recorded_by)
                 values ($1::uuid, 'care', 'v1', 'paper', $2)",
            )
            .bind(&patient)
            .bind(member)
            .execute(tx.conn())
            .await
            .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Conflict, "{error}");
    let (rows,): (i64,) =
        sqlx::query_as("select count(*) from aarogyam.patient_consents where org_id = $1")
            .bind(beta)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(rows, 0);

    // Alpha cannot move a row to Beta, and cannot edit a consent's content or undo a withdrawal.
    let moved = db
        .scoped(&Scope::tenant(alpha), async |tx| {
            sqlx::query("update aarogyam.patient_consents set org_id = $1")
                .bind(beta)
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await;
    assert!(moved.is_err());
    let (status, _) = withdraw(&app, ALPHA, &owner, &consent, json!({ "method": "paper" })).await;
    assert_eq!(status, StatusCode::OK);
    for sql in [
        "update aarogyam.patient_consents set status = 'given', withdrawn_at = null, withdrawn_by = null, withdrawn_method = null",
        "update aarogyam.patient_consents set notice_version = 'v2'",
        "update aarogyam.patient_consents set purpose = 'research'",
    ] {
        let error = db
            .scoped(&Scope::tenant(alpha), async |tx| {
                sqlx::query(sql)
                    .execute(tx.conn())
                    .await
                    .map_err(DbError::from)
            })
            .await
            .unwrap_err();
        assert_eq!(error.kind(), DbErrorKind::Forbidden, "{sql}");
    }
    app.finish().await;
}
