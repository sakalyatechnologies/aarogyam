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

async fn ok(app: &TestApp, method: Method, path: &str, token: &str, body: Value) -> Value {
    let (status, value) = app.send(method, ALPHA, path, Some(token), Some(body)).await;
    assert!(status.is_success(), "{path}: {status} {value}");
    value
}

async fn count(app: &TestApp, sql: &'static str, patient: &str) -> i64 {
    let query = sqlx::query_scalar(sql);
    let query = if sql.contains("$1") {
        query.bind(patient)
    } else {
        query
    };
    query.fetch_one(&app.owner).await.unwrap()
}

/// A patient with lab orders, messages, preferences and a chat reference is erased as the
/// registry says: lab orders kept with their free text cleared, messages and preferences
/// deleted, the staff chat message kept without the patient reference.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one story: seed each kind, erase, check each"
)]
async fn erasure_handles_labs_messages_preferences_and_chat_as_registered() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = patient(&app, ALPHA, &owner, "Lab Patient", "1960-01-01").await;
    let vendor = ok(
        &app,
        Method::POST,
        "/api/v1/lab-vendors",
        &owner,
        json!({ "name": "Precision Lab" }),
    )
    .await;
    let order = ok(
        &app,
        Method::POST,
        "/api/v1/lab-orders",
        &owner,
        json!({
            "vendor_id": vendor["id"], "patient_id": id, "send": true,
            "instructions": "Shade A2, patient is allergic to nickel",
            "items": [{ "work_type": "Crown", "teeth": [36] }],
        }),
    )
    .await;
    let path = format!(
        "/api/v1/lab-orders/{}/status",
        order["id"].as_str().unwrap()
    );
    ok(
        &app,
        Method::POST,
        &path,
        &owner,
        json!({ "status": "in_progress", "note": "Called the lab about Lab Patient" }),
    )
    .await;
    let queued = ok(
        &app,
        Method::POST,
        "/api/v1/messages",
        &owner,
        json!({
            "patient_ids": [id], "channel": "email", "template_key": "care.note",
            "variables": { "subject": "Your visit" }, "body": "Please bring reports.",
        }),
    )
    .await;
    assert_eq!(queued["queued"], 1, "{queued}");
    let prefs = format!("/api/v1/patients/{id}/contact-preferences");
    let opt_out = json!({ "channel": "email", "category": "promotional", "opted_out": true });
    ok(&app, Method::POST, &prefs, &owner, opt_out).await;
    sqlx::query("insert into aarogyam.message_events (org_id, message_id, provider, provider_event_id, kind, occurred_at) select m.org_id, m.id, 'log', 'evt-1', 'delivered', now() from aarogyam.messages m where m.patient_id = $1::uuid")
        .bind(&id)
        .execute(&app.owner)
        .await
        .unwrap();
    let arun = membership_of(&app, "Arun Assistant").await;
    let chat = ok(
        &app,
        Method::POST,
        "/api/v1/conversations",
        &owner,
        json!({ "kind": "direct", "membership_id": arun }),
    )
    .await;
    let talk = format!(
        "/api/v1/conversations/{}/messages",
        chat["id"].as_str().unwrap()
    );
    ok(
        &app,
        Method::POST,
        &talk,
        &owner,
        json!({ "client_id": Uuid::now_v7(), "body": "Crown ready?", "patient_id": id }),
    )
    .await;

    // The registry says what happens to each table.
    let action = |table: &'static str| {
        let app = &app;
        async move {
            sqlx::query_scalar::<_, String>(
                "select action from audit.erasure_steps where table_name = $1",
            )
            .bind(table)
            .fetch_one(&app.owner)
            .await
            .unwrap()
        }
    };
    for (table, expected) in [
        ("aarogyam.lab_orders", "update"),
        ("aarogyam.lab_order_items", "keep"),
        ("aarogyam.lab_order_events", "update"),
        ("aarogyam.messages", "delete"),
        ("aarogyam.message_events", "delete"),
        ("aarogyam.contact_preferences", "delete"),
        ("aarogyam.chat_messages", "update"),
    ] {
        assert_eq!(action(table).await, expected, "{table}");
    }

    assert_eq!(
        count(&app, "select count(*) from aarogyam.message_events", &id).await,
        1
    );
    backdate(&app, &[&id]).await;
    let db = app.owner_db();
    let alpha = ClinicId::from_uuid(app.clinic_id("alpha").await);
    let erased = erasure::apply(
        &db,
        OffsetDateTime::now_utc(),
        alpha,
        Uuid::now_v7(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(erased, 1);

    let by = |sql: &'static str| count(&app, sql, &id);
    assert_eq!(
        by("select count(*) from aarogyam.messages where patient_id = $1::uuid").await,
        0
    );
    assert_eq!(
        by("select count(*) from aarogyam.message_events").await,
        0,
        "events go with their messages"
    );
    assert_eq!(
        by("select count(*) from aarogyam.contact_preferences where patient_id = $1::uuid").await,
        0
    );
    // Lab orders stay for their retention, without the free text; items and history stay.
    assert_eq!(by("select count(*) from aarogyam.lab_orders where patient_id = $1::uuid and instructions is null").await, 1);
    assert_eq!(by("select count(*) from aarogyam.lab_order_items").await, 1);
    assert_eq!(
        by("select count(*) from aarogyam.lab_order_events where note is not null").await,
        0
    );
    assert!(by("select count(*) from aarogyam.lab_order_events").await >= 2);
    // The staff conversation stays; the patient reference goes.
    assert_eq!(
        by("select count(*) from aarogyam.chat_messages where patient_id = $1::uuid").await,
        0
    );
    assert_eq!(
        by("select count(*) from aarogyam.chat_messages where body = 'Crown ready?'").await,
        1
    );
    app.finish().await;
}

async fn membership_of(app: &TestApp, name: &str) -> String {
    sqlx::query_scalar::<_, Uuid>("select m.id from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id where u.display_name = $1")
        .bind(name)
        .fetch_one(&app.owner)
        .await
        .unwrap()
        .to_string()
}
