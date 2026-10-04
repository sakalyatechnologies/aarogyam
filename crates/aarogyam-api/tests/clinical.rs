//! The clinical record on a real database: visits, notes and addenda, vitals, conditions and
//! allergies, the dental chart, procedures and treatment plans, files, and the timeline.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one clinical flow from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, DbErrorKind, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::{Uuid, uuid};

/// A second doctor at Alpha, added by [`add_doctor`].
const ALPHA_DOCTOR: Uuid = uuid!("a0000000-0000-4000-8000-000000000005");

async fn add_doctor(app: &TestApp) {
    sqlx::raw_sql(
        "insert into aarogyam.users (id, auth_uid, display_name, email) values
           ('01900000-0000-7000-8000-0000000000a5', 'a0000000-0000-4000-8000-000000000005', 'Dev Doctor', 'dev@alpha.test');
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, '01900000-0000-7000-8000-0000000000a5', r.id, 'active'
         from aarogyam.organizations o join aarogyam.roles r on r.org_id = o.id and r.key = 'doctor'
         where o.slug = 'alpha';",
    )
    .execute(&app.owner)
    .await
    .unwrap();
}

async fn register(app: &TestApp, host: &str, token: &str, name: &str) -> String {
    let (status, patient) = app
        .send(
            Method::POST,
            host,
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
            Some(json!({ "chief_complaint": "Pain lower left" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    visit["id"].as_str().unwrap().to_owned()
}

/// Sends `body` (or nothing) and returns the status only.
async fn status_of(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> StatusCode {
    app.send(method, host, path, Some(token), body).await.0
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn notes_are_drafted_signed_frozen_and_amended() {
    let app = TestApp::start().await;
    add_doctor(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let doctor = app.token(ALPHA_DOCTOR);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;

    let (status, visits) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/visits"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(visits["items"][0]["status"], "open");
    assert_eq!(visits["items"][0]["clinician"]["name"], "Asha Owner");
    assert!(
        visits["items"][0]["number"]
            .as_str()
            .unwrap()
            .starts_with("V-")
    );
    // Starting a visit records it as the patient's last visit.
    let (_, opened) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}"),
            Some(&owner),
            None,
        )
        .await;
    assert!(opened["last_visit_at"].is_string());

    let (status, note) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{visit}/notes"),
            Some(&owner),
            Some(json!({ "sections": { "subjective": "Pain on chewing, 36" } })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    assert_eq!(note["status"], "draft");
    assert_eq!(note["kind"], "soap");
    let note_id = note["id"].as_str().unwrap().to_owned();
    let note_path = format!("/api/v1/notes/{note_id}");

    // Only the author edits and signs.
    let edit = json!({ "sections": { "subjective": "Pain on chewing, 36", "assessment": "Deep caries 36" } });
    let (status, edited) = app
        .send(
            Method::PATCH,
            ALPHA,
            &note_path,
            Some(&owner),
            Some(edit.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["sections"]["assessment"], "Deep caries 36");
    assert_eq!(
        status_of(
            &app,
            Method::PATCH,
            ALPHA,
            &note_path,
            &doctor,
            Some(edit.clone())
        )
        .await,
        StatusCode::FORBIDDEN
    );
    let sign_path = format!("{note_path}/sign");
    assert_eq!(
        status_of(&app, Method::POST, ALPHA, &sign_path, &doctor, None).await,
        StatusCode::FORBIDDEN
    );
    // Addenda are for signed notes.
    let addenda_path = format!("{note_path}/addenda");
    assert_eq!(
        status_of(
            &app,
            Method::POST,
            ALPHA,
            &addenda_path,
            &owner,
            Some(json!({ "body": "x" }))
        )
        .await,
        StatusCode::CONFLICT
    );
    let (status, signed) = app
        .send(Method::POST, ALPHA, &sign_path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["status"], "signed");
    assert!(signed["signed_at"].is_string());

    // Signed notes never change, through the API or directly in the database.
    assert_eq!(
        status_of(&app, Method::PATCH, ALPHA, &note_path, &owner, Some(edit)).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        status_of(&app, Method::POST, ALPHA, &sign_path, &owner, None).await,
        StatusCode::CONFLICT
    );
    let alpha = app.clinic_id("alpha").await;
    let frozen = app
        .api_db()
        .scoped(&Scope::tenant(alpha), async |tx| {
            sqlx::query("update aarogyam.clinical_notes set body = '{}' where id = $1::uuid")
                .bind(&note_id)
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(frozen.kind(), DbErrorKind::Forbidden);

    // Addenda: any clinician may add one; they are listed with the note.
    let (status, amended) = app
        .send(
            Method::POST,
            ALPHA,
            &addenda_path,
            Some(&doctor),
            Some(json!({ "body": "Tooth is 37, not 36." })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{amended}");
    assert_eq!(amended["addenda"][0]["author"]["name"], "Dev Doctor");
    assert_eq!(amended["status"], "signed");

    // Entered in error needs a reason; the note stays, marked.
    let error_path = format!("{note_path}/entered-in-error");
    assert_eq!(
        status_of(
            &app,
            Method::POST,
            ALPHA,
            &error_path,
            &owner,
            Some(json!({ "reason": "" }))
        )
        .await,
        StatusCode::BAD_REQUEST
    );
    let (status, voided) = app
        .send(
            Method::POST,
            ALPHA,
            &error_path,
            Some(&doctor),
            Some(json!({ "reason": "Written for the wrong patient" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{voided}");
    assert_eq!(voided["status"], "entered_in_error");
    assert_eq!(
        status_of(
            &app,
            Method::POST,
            ALPHA,
            &error_path,
            &owner,
            Some(json!({ "reason": "again" }))
        )
        .await,
        StatusCode::CONFLICT
    );

    // Opening the visit shows everything and writes the access record.
    let (status, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["visit"]["chief_complaint"], "Pain lower left");
    assert_eq!(
        detail["notes"][0]["addenda"][0]["body"],
        "Tooth is 37, not 36."
    );
    let (opens,): (i64,) = sqlx::query_as(
        "select count(*) from audit.access_log where patient_id = $1::uuid and resource = 'visit' and resource_id = $2::uuid",
    )
    .bind(&patient)
    .bind(&visit)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(opens, 1);

    // A closed visit takes no new notes.
    let close_path = format!("/api/v1/visits/{visit}/close");
    let (status, closed) = app
        .send(Method::POST, ALPHA, &close_path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["status"], "closed");
    assert!(closed["ended_at"].is_string());
    assert_eq!(
        status_of(&app, Method::POST, ALPHA, &close_path, &owner, None).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        status_of(
            &app,
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{visit}/notes"),
            &owner,
            Some(json!({ "sections": { "plan": "RCT" } }))
        )
        .await,
        StatusCode::CONFLICT
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn child_rows_must_belong_to_their_visits_patient() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let first = register(&app, ALPHA, &owner, "Meera Shah").await;
    let second = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let visit = start_visit(&app, &owner, &first).await;
    let alpha = app.clinic_id("alpha").await;
    let db = app.api_db();
    for statement in [
        "insert into aarogyam.clinical_notes (encounter_id, patient_id, author_id)
         select $1::uuid, $2::uuid, clinician_id from aarogyam.encounters where id = $1::uuid",
        "insert into aarogyam.observations (encounter_id, patient_id, kind, value_num, unit)
         values ($1::uuid, $2::uuid, 'pulse', 72, '/min')",
        "insert into aarogyam.procedures (encounter_id, patient_id, clinician_id, name, performed_at)
         select $1::uuid, $2::uuid, clinician_id, 'Scaling', now() from aarogyam.encounters where id = $1::uuid",
        "insert into aarogyam.specialty_records (encounter_id, patient_id, module, kind, schema_version, data)
         values ($1::uuid, $2::uuid, 'dental', 'tooth', 1, '{\"tooth\": 36, \"finding\": \"caries\"}')",
        "insert into aarogyam.attachments (encounter_id, patient_id, storage_key, mime_type, size_bytes, sha256)
         values ($1::uuid, $2::uuid, gen_random_uuid() || '/' || gen_random_uuid(), 'image/png', 10, repeat('a', 64))",
    ] {
        let error = db
            .scoped(&Scope::tenant(alpha), async |tx| {
                sqlx::query(sqlx::AssertSqlSafe(statement))
                    .bind(&visit)
                    .bind(&second)
                    .execute(tx.conn())
                    .await
                    .map_err(DbError::from)
            })
            .await
            .unwrap_err();
        assert_eq!(error.kind(), DbErrorKind::Conflict, "{statement}");
    }
    app.finish().await;
}

/// Every clinical route answers 404 to another clinic's member for this clinic's records.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn other_clinics_get_not_found() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let (_, note) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{visit}/notes"),
            Some(&owner),
            Some(json!({ "sections": { "plan": "RCT 36" } })),
        )
        .await;
    let note = note["id"].as_str().unwrap();
    let sections = json!({ "sections": { "plan": "x" } });
    for (method, path, body) in [
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/visits"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/visits"),
            Some(json!({})),
        ),
        (Method::GET, format!("/api/v1/visits/{visit}"), None),
        (Method::POST, format!("/api/v1/visits/{visit}/close"), None),
        (
            Method::POST,
            format!("/api/v1/visits/{visit}/notes"),
            Some(sections.clone()),
        ),
        (
            Method::PATCH,
            format!("/api/v1/notes/{note}"),
            Some(sections),
        ),
        (Method::POST, format!("/api/v1/notes/{note}/sign"), None),
        (
            Method::POST,
            format!("/api/v1/notes/{note}/addenda"),
            Some(json!({ "body": "x" })),
        ),
        (
            Method::POST,
            format!("/api/v1/notes/{note}/entered-in-error"),
            Some(json!({ "reason": "wrong patient" })),
        ),
    ] {
        // Beta's owner on Beta's host can't see Alpha's records.
        assert_eq!(
            status_of(&app, method.clone(), BETA, &path, &beta, body.clone()).await,
            StatusCode::NOT_FOUND,
            "{method} {path} from Beta"
        );
        // And on Alpha's host they aren't a member.
        assert_eq!(
            status_of(&app, method.clone(), ALPHA, &path, &beta, body).await,
            StatusCode::NOT_FOUND,
            "{method} {path} on Alpha"
        );
    }
    app.finish().await;
}

/// Reading needs clinical.read (the front desk has none); writing needs clinical.write (the
/// assistant only reads).
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn clinical_routes_need_their_permission() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let reads = [
        format!("/api/v1/patients/{patient}/visits"),
        format!("/api/v1/visits/{visit}"),
    ];
    for path in &reads {
        assert_eq!(
            status_of(&app, Method::GET, ALPHA, path, &desk, None).await,
            StatusCode::FORBIDDEN,
            "front desk GET {path}"
        );
        assert_eq!(
            status_of(&app, Method::GET, ALPHA, path, &assistant, None).await,
            StatusCode::OK,
            "assistant GET {path}"
        );
    }
    let writes = [
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/visits"),
            json!({}),
        ),
        (
            Method::POST,
            format!("/api/v1/visits/{visit}/close"),
            json!({}),
        ),
        (
            Method::POST,
            format!("/api/v1/visits/{visit}/notes"),
            json!({}),
        ),
    ];
    for (method, path, body) in writes {
        assert_eq!(
            status_of(&app, method.clone(), ALPHA, &path, &assistant, Some(body)).await,
            StatusCode::FORBIDDEN,
            "assistant {method} {path}"
        );
    }
    app.finish().await;
}
