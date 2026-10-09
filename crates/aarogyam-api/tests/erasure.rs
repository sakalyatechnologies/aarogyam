//! The erasure job: patients past their clinic's retention period are erased to a tombstone, one
//! clinic at a time, with their change history scrubbed and an erasure log that can be replayed
//! after a restore. Legal hold stops it; children and other clinics are untouched.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_app::erasure::{self, Erased};
use aarogyam_domain::ids::ClinicId;
use aarogyam_domain::retention::PatientRetentionYears;
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::OffsetDateTime;
use uuid::Uuid;

async fn patient(app: &TestApp, host: &str, token: &str, name: &str, birth: &str) -> String {
    let body = json!({ "full_name": name, "date_of_birth": birth, "phone": "+919812345678" });
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
    let id = value["id"].as_str().unwrap().to_owned();
    // An edit, so the change history holds an old value.
    let edit = json!({ "email": "old@example.test" });
    let (status, value) = app
        .send(
            Method::PATCH,
            host,
            &format!("/api/v1/patients/{id}"),
            Some(token),
            Some(edit),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    id
}

/// Registered nine years ago and never seen since.
async fn backdate(app: &TestApp, ids: &[&str]) {
    sqlx::query("alter table aarogyam.patients disable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    sqlx::query("update aarogyam.patients set created_at = now() - interval '9 years' where id = any($1::uuid[])")
        .bind(ids)
        .execute(&app.owner)
        .await
        .unwrap();
    sqlx::query("alter table aarogyam.patients enable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
}

async fn row(app: &TestApp, id: &str) -> (String, Option<String>, String) {
    sqlx::query_as(
        "select full_name, phone_e164, status from aarogyam.patients where id = $1::uuid",
    )
    .bind(id)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

/// Change history entries for a row that still hold values.
async fn history_with_values(app: &TestApp, id: &str) -> i64 {
    let (count,): (i64,) = sqlx::query_as(
        "select count(*) from audit.audit_events where row_id = $1::uuid and changes is not null",
    )
    .bind(id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    count
}

async fn hold(app: &TestApp, host: &str, token: &str, id: &str, body: Value) -> StatusCode {
    let path = format!("/api/v1/patients/{id}/legal-hold");
    app.send(Method::PUT, host, &path, Some(token), Some(body))
        .await
        .0
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn legal_hold_needs_the_owner_a_reason_and_this_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = patient(&app, ALPHA, &owner, "Kavya Rao", "1980-01-01").await;
    let on = json!({ "held": true, "reason": "Dispute with insurer" });
    assert_eq!(
        hold(&app, ALPHA, &app.token(ALPHA_FRONT_DESK), &id, on.clone()).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        hold(&app, BETA, &app.token(BETA_OWNER), &id, on.clone()).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        hold(&app, ALPHA, &owner, &id, json!({ "held": true })).await,
        StatusCode::BAD_REQUEST
    );
    let (status, held) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/patients/{id}/legal-hold"),
            Some(&owner),
            Some(on),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{held}");
    assert_eq!(
        (held["held"].as_bool(), held["reason"].as_str()),
        (Some(true), Some("Dispute with insurer"))
    );
    assert_eq!(
        hold(&app, ALPHA, &owner, &id, json!({ "held": false })).await,
        StatusCode::OK
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patients_past_retention_are_erased_except_held_children_and_other_clinics() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let old = patient(&app, ALPHA, &owner, "Old Adult", "1960-01-01").await;
    let held = patient(&app, ALPHA, &owner, "Held Adult", "1960-01-01").await;
    let child = patient(&app, ALPHA, &owner, "Old Child", "2020-01-01").await;
    let recent = patient(&app, ALPHA, &owner, "Recent", "1990-01-01").await;
    let beta_old = patient(&app, BETA, &app.token(BETA_OWNER), "Beta Old", "1960-01-01").await;
    backdate(&app, &[&old, &held, &child, &beta_old]).await;
    let reason = json!({ "held": true, "reason": "Court case pending" });
    assert_eq!(
        hold(&app, ALPHA, &owner, &held, reason).await,
        StatusCode::OK
    );

    let db = app.owner_db();
    let now = OffsetDateTime::now_utc();
    let alpha = ClinicId::from_uuid(app.clinic_id("alpha").await);
    let plan = erasure::plan(&db, now, Some(alpha)).await.unwrap();
    assert_eq!(plan.len(), 1);
    assert_eq!(plan[0].patients, [old.parse::<Uuid>().unwrap()]);
    assert_eq!(plan[0].held, 1);
    assert_eq!(
        row(&app, &old).await.0,
        "Old Adult",
        "a dry run changes nothing"
    );

    let mut log = Vec::new();
    let run = Uuid::now_v7();
    let erased = erasure::apply(&db, now, alpha, run, |entry| {
        log.push(entry);
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(erased, 1);
    assert_eq!(
        row(&app, &old).await,
        ("Erased".into(), None, "erased".into())
    );
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{old}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for (id, name) in [
        (&held, "Held Adult"),
        (&child, "Old Child"),
        (&recent, "Recent"),
        (&beta_old, "Beta Old"),
    ] {
        assert_eq!(row(&app, id).await.0, name);
    }
    // The change history keeps who and when, not what.
    let left = history_with_values(&app, &old).await;
    assert_eq!(left, 0);
    let kept = history_with_values(&app, &held).await;
    assert!(kept > 0);
    let (logged,): (i64,) = sqlx::query_as(
        "select count(*) from audit.erasure_log where patient_id = $1::uuid and run_id = $2",
    )
    .bind(&old)
    .bind(run)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(logged, 1);
    assert_eq!(
        erasure::apply(&db, now, alpha, Uuid::now_v7(), |_| Ok(()))
            .await
            .unwrap(),
        0
    );

    // A restore from backup brings the patient back; replaying the log erases them again.
    sqlx::query("update aarogyam.patients set full_name = 'Old Adult', status = 'active', erased_at = null, deleted_at = null where id = $1::uuid")
        .bind(&old)
        .execute(&app.owner)
        .await
        .unwrap();
    let entries: Vec<Erased> = serde_json::from_str(&serde_json::to_string(&log).unwrap()).unwrap();
    assert_eq!(erasure::replay(&db, &entries).await.unwrap(), 1);
    assert_eq!(row(&app, &old).await.0, "Erased");

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_clinic_that_keeps_records_longer_has_nothing_past_retention_yet() {
    let app = TestApp::start().await;
    let beta_old = patient(&app, BETA, &app.token(BETA_OWNER), "Beta Old", "1960-01-01").await;
    backdate(&app, &[&beta_old]).await;
    let db = app.owner_db();
    let now = OffsetDateTime::now_utc();
    let beta = ClinicId::from_uuid(app.clinic_id("beta").await);
    assert_eq!(
        erasure::plan(&db, now, Some(beta)).await.unwrap()[0]
            .patients
            .len(),
        1
    );
    let ten = PatientRetentionYears::new(10).unwrap();
    assert!(
        erasure::set_patient_years(&db, beta, Some(ten))
            .await
            .unwrap()
    );
    assert!(
        erasure::plan(&db, now, Some(beta))
            .await
            .unwrap()
            .is_empty()
    );
    app.finish().await;
}

/// Every clinic table that names a patient says what erasure does to it: a new table (labs,
/// messages, chat) adds its row to `audit.erasure_steps` in its own migration, or fails here.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn every_table_naming_a_patient_is_registered_for_erasure() {
    let app = TestApp::start().await;
    let missing: Vec<String> = sqlx::query_scalar(
        "select c.table_schema || '.' || c.table_name from information_schema.columns c
         join information_schema.tables t using (table_schema, table_name)
         where c.table_schema = 'aarogyam' and c.column_name = 'patient_id'
           and t.table_type = 'BASE TABLE'
           and c.table_schema || '.' || c.table_name not in (select table_name from audit.erasure_steps)
         order by 1",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert!(
        missing.is_empty(),
        "register these in audit.erasure_steps: {missing:?}"
    );
    app.finish().await;
}
