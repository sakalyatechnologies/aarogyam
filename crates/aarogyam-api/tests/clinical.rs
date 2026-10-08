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

use aarogyam_app::files::LinkSigner;
use aarogyam_domain::ids::{AttachmentId, ClinicId, UserId};
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use sakalya_db::{DbError, DbErrorKind, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, FILE_KEY, TestApp};
use time::OffsetDateTime;
use tower::ServiceExt as _;
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
    // Signing again is a repeat for the author (the same note comes back) and a refusal for
    // anyone else (tests/transitions.rs).
    let (status, repeated) = app
        .send(Method::POST, ALPHA, &sign_path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{repeated}");
    assert_eq!(repeated, signed);
    assert_eq!(
        status_of(&app, Method::POST, ALPHA, &sign_path, &doctor, None).await,
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

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn vitals_are_checked_and_corrected_by_superseding() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let path = format!("/api/v1/visits/{visit}/observations");
    let record = async |body: Value| {
        app.send(Method::POST, ALPHA, &path, Some(&owner), Some(body))
            .await
    };

    let (status, saved) = record(json!({ "readings": [
        { "kind": "bp_systolic", "value": 120 },
        { "kind": "bp_diastolic", "value": 80 },
        { "kind": "pulse", "value": 72 },
        { "kind": "temperature", "value": 98.6, "unit": "°F" },
    ] }))
    .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["items"][0]["unit"], "mmHg");
    assert_eq!(saved["items"][0]["code"], "8480-6");
    assert_eq!(saved["items"][3]["unit"], "[degF]");
    assert_eq!(saved["items"][3]["value"], 98.6);
    let pulse = saved["items"][2]["id"].as_str().unwrap().to_owned();
    let systolic = saved["items"][0]["id"].as_str().unwrap().to_owned();

    for (body, field) in [
        (
            json!({ "readings": [{ "kind": "weight", "value": 1200 }] }),
            "readings",
        ),
        (
            json!({ "readings": [{ "kind": "spo2", "value": 101 }] }),
            "readings",
        ),
        (
            json!({ "readings": [{ "kind": "pulse", "value": 72, "unit": "kg" }] }),
            "readings",
        ),
        (
            json!({ "readings": [{ "kind": "glucose", "value": 90 }] }),
            "readings.kind",
        ),
        (json!({ "readings": [] }), "readings"),
        (
            json!({ "readings": [{ "kind": "bp_systolic", "value": 80 }, { "kind": "bp_diastolic", "value": 90 }] }),
            "readings",
        ),
        (
            json!({ "readings": [{ "kind": "pulse", "value": 72 }], "source": "ai_draft" }),
            "source",
        ),
    ] {
        let (status, error) = record(body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}: {error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }

    // A correction supersedes; the old value stays, marked corrected.
    let (status, corrected) =
        record(json!({ "readings": [{ "kind": "pulse", "value": 76, "supersedes_id": pulse }] }))
            .await;
    assert_eq!(status, StatusCode::CREATED, "{corrected}");
    assert_eq!(corrected["items"][0]["supersedes_id"], pulse.as_str());
    let corrected_id = corrected["items"][0]["id"].as_str().unwrap().to_owned();
    let (status, _) =
        record(json!({ "readings": [{ "kind": "pulse", "value": 78, "supersedes_id": pulse }] }))
            .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = record(
        json!({ "readings": [{ "kind": "weight", "value": 60, "supersedes_id": systolic }] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Values never change in place, even directly in the database.
    let alpha = app.clinic_id("alpha").await;
    let error = app
        .api_db()
        .scoped(&Scope::tenant(alpha), async |tx| {
            sqlx::query("update aarogyam.observations set value_num = 99 where id = $1::uuid")
                .bind(&corrected_id)
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Forbidden);

    // Entered in error keeps the value, marked.
    let (status, retracted) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/observations/{systolic}/entered-in-error"),
            Some(&owner),
            Some(json!({ "reason": "cuff too small" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{retracted}");
    assert_eq!(retracted["status"], "entered_in_error");

    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    let statuses: Vec<(&str, &str)> = detail["observations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| (o["kind"].as_str().unwrap(), o["status"].as_str().unwrap()))
        .collect();
    assert_eq!(
        statuses,
        [
            ("bp_systolic", "entered_in_error"),
            ("bp_diastolic", "final"),
            ("pulse", "corrected"),
            ("temperature", "final"),
            ("pulse", "final"),
        ]
    );

    // A closed visit takes corrections only.
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/visits/{visit}/close"),
        Some(&owner),
        None,
    )
    .await;
    let (status, _) = record(json!({ "readings": [{ "kind": "pulse", "value": 70 }] })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = record(
        json!({ "readings": [{ "kind": "pulse", "value": 75, "supersedes_id": corrected_id }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn allergies_and_flagged_conditions_raise_clinical_flags() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let other_visit = start_visit(&app, &owner, &other).await;
    let flags_path = format!("/api/v1/patients/{patient}/clinical-flags");

    let (_, flags) = app
        .send(Method::GET, ALPHA, &flags_path, Some(&owner), None)
        .await;
    assert_eq!(flags["allergy_count"], 0);

    let allergies = format!("/api/v1/patients/{patient}/allergies");
    let (status, allergy) = app
        .send(
            Method::POST,
            ALPHA,
            &allergies,
            Some(&owner),
            Some(json!({ "substance": "Penicillin", "reaction": "Hives", "severity": "severe", "source": "patient" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{allergy}");
    assert_eq!(allergy["source"], "patient");
    assert!(allergy["verified_by"].is_string());
    let allergy_id = allergy["id"].as_str().unwrap().to_owned();
    create(
        &app,
        &allergies,
        json!({ "substance": "Latex", "severity": "mild" }),
    )
    .await;
    let conditions = format!("/api/v1/patients/{patient}/conditions");
    let (status, diabetes) = app
        .send(
            Method::POST,
            ALPHA,
            &conditions,
            Some(&owner),
            Some(json!({ "display_text": "Type 2 diabetes", "flagged": true, "code": { "system": "icd10", "code": "E11" }, "onset": "2019-06-01" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{diabetes}");
    assert_eq!(diabetes["code"]["code"], "E11");
    create(
        &app,
        &conditions,
        json!({ "display_text": "Seasonal rhinitis" }),
    )
    .await;

    for (path, body, field) in [
        (&allergies, json!({ "substance": " " }), "substance"),
        (
            &allergies,
            json!({ "substance": "Ibuprofen", "severity": "fatal" }),
            "severity",
        ),
        (
            &allergies,
            json!({ "substance": "Ibuprofen", "source": "ai_draft" }),
            "source",
        ),
        (
            &conditions,
            json!({ "display_text": "Asthma", "code": { "system": "icd10", "code": "" } }),
            "code",
        ),
        (
            &conditions,
            json!({ "display_text": "Asthma", "onset": "2999-01-01" }),
            "onset",
        ),
        (
            &conditions,
            json!({ "display_text": "Asthma", "visit_id": other_visit }),
            "visit_id",
        ),
    ] {
        let (status, error) = app
            .send(Method::POST, ALPHA, path, Some(&owner), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}: {error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }

    let (status, flags) = app
        .send(Method::GET, ALPHA, &flags_path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{flags}");
    assert_eq!(flags["allergy_count"], 2);
    assert_eq!(flags["severe_allergy"], true);
    assert_eq!(flags["condition_count"], 1);
    assert_eq!(flags["allergies"][0]["substance"], "Penicillin");
    assert_eq!(flags["conditions"][0]["display_text"], "Type 2 diabetes");
    // The front desk learns that flags exist, not what they are.
    let (status, hidden) = app
        .send(Method::GET, ALPHA, &flags_path, Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(hidden["allergy_count"], 2);
    assert_eq!(hidden["details_hidden"], true);
    assert_eq!(hidden["allergies"], json!([]));

    // Resolving or retracting an allergy takes it off the banner; it stays on the list.
    let (status, resolved) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("{allergies}/{allergy_id}"),
            Some(&owner),
            Some(json!({ "status": "entered_in_error" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{resolved}");
    assert_eq!(resolved["substance"], "Penicillin");
    let (_, flags) = app
        .send(Method::GET, ALPHA, &flags_path, Some(&owner), None)
        .await;
    assert_eq!(flags["allergy_count"], 1);
    assert_eq!(flags["severe_allergy"], false);
    let (_, listed) = app
        .send(Method::GET, ALPHA, &allergies, Some(&owner), None)
        .await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 2);
    assert_eq!(listed["items"][1]["status"], "entered_in_error");
    // Another patient's allergy isn't reachable through this patient.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/patients/{other}/allergies/{allergy_id}"),
            Some(&owner),
            Some(json!({ "status": "active" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn dental_chart_entries_supersede_and_keep_history() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let other_visit = start_visit(&app, &owner, &other).await;
    let path = format!("/api/v1/patients/{patient}/dental-chart");
    let record = async |body: Value| {
        app.send(Method::POST, ALPHA, &path, Some(&owner), Some(body))
            .await
    };
    let current = |chart: &Value| -> Vec<(u64, String, String)> {
        chart["current"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["tooth"].as_u64().unwrap(),
                    e["surface"].as_str().unwrap_or("-").to_owned(),
                    e["finding"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    };

    let (status, chart) = record(json!({ "visit_id": visit, "entries": [
        { "tooth": 36, "surface": "O", "finding": "caries" },
        { "tooth": 36, "surface": "d", "finding": "caries", "note": "shallow" },
        { "tooth": 11, "finding": "watch" },
        { "tooth": 55, "finding": "missing" },
    ] }))
    .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert_eq!(
        current(&chart),
        [
            (11, "-".into(), "watch".into()),
            (36, "D".into(), "caries".into()),
            (36, "O".into(), "caries".into()),
            (55, "-".into(), "missing".into()),
        ]
    );
    let caries_o = chart["current"][2]["id"].as_str().unwrap().to_owned();

    // A filling supersedes the caries on the same surface only.
    let (status, chart) =
        record(json!({ "entries": [{ "tooth": 36, "surface": "O", "finding": "filled" }] })).await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert_eq!(
        current(&chart)[1..3],
        [
            (36, "D".into(), "caries".into()),
            (36, "O".into(), "filled".into())
        ]
    );
    assert_eq!(chart["current"][2]["supersedes_id"], caries_o.as_str());
    // A crown covers every surface.
    let (status, chart) = record(json!({ "entries": [{ "tooth": 36, "finding": "crown" }] })).await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert_eq!(
        current(&chart),
        [
            (11, "-".into(), "watch".into()),
            (36, "-".into(), "crown".into()),
            (55, "-".into(), "missing".into()),
        ]
    );

    // The tooth's history keeps everything, newest first.
    let (status, chart) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("{path}?tooth=36"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    let history: Vec<(&str, &str)> = chart["history"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["finding"].as_str().unwrap(),
                e["status"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        history,
        [
            ("crown", "current"),
            ("filled", "superseded"),
            ("caries", "superseded"),
            ("caries", "superseded"),
        ]
    );

    for body in [
        json!({ "entries": [{ "tooth": 19, "finding": "caries" }] }),
        json!({ "entries": [{ "tooth": 36, "surface": "X", "finding": "caries" }] }),
        json!({ "entries": [{ "tooth": 36, "surface": "O", "finding": "crown" }] }),
        json!({ "entries": [{ "tooth": 36, "finding": "decay" }] }),
        json!({ "entries": [] }),
    ] {
        let (status, error) = record(body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with("entries"),
            "{error}"
        );
    }
    let (status, _) = record(
        json!({ "visit_id": other_visit, "entries": [{ "tooth": 21, "finding": "caries" }] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("{path}?tooth=99"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The database keeps one current entry per tooth and surface, and entries never change.
    let alpha = app.clinic_id("alpha").await;
    let db = app.api_db();
    for (statement, kind) in [
        (
            "insert into aarogyam.specialty_records (patient_id, module, kind, schema_version, data)
             values ($1::uuid, 'dental', 'tooth', 1, '{\"tooth\": 36, \"finding\": \"caries\"}')",
            DbErrorKind::Conflict,
        ),
        (
            "update aarogyam.specialty_records set data = '{\"tooth\": 36, \"finding\": \"sound\"}'
             where patient_id = $1::uuid and tooth = 36 and status = 'current'",
            DbErrorKind::Forbidden,
        ),
    ] {
        let error = db
            .scoped(&Scope::tenant(alpha), async |tx| {
                sqlx::query(sqlx::AssertSqlSafe(statement))
                    .bind(&patient)
                    .execute(tx.conn())
                    .await
                    .map_err(DbError::from)
            })
            .await
            .unwrap_err();
        assert_eq!(error.kind(), kind, "{statement}");
    }

    // The visit shows the entries recorded in it.
    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(detail["chart_entries"].as_array().unwrap().len(), 4);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn procedures_carry_out_accepted_plan_items() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let other_visit = start_visit(&app, &owner, &other).await;
    let plans = format!("/api/v1/patients/{patient}/treatment-plans");
    let (status, plan) = app
        .send(
            Method::POST,
            ALPHA,
            &plans,
            Some(&owner),
            Some(
                json!({ "title": "Lower left molar", "visit_id": visit, "items": [
                { "name": "Root canal treatment", "tooth": 36, "estimate_paise": 450_000 },
                { "name": "Zirconia crown", "tooth": 36, "estimate_paise": 1_200_000, "phase": 2 },
                { "name": "Scaling", "estimate_paise": 80_000 },
            ] }),
            ),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{plan}");
    assert_eq!(plan["status"], "proposed");
    assert_eq!(plan["estimate_paise"], 1_730_000);
    let plan_id = plan["id"].as_str().unwrap().to_owned();
    let item = |n: usize| plan["items"][n]["id"].as_str().unwrap().to_owned();
    let (rct, scaling, crown) = (item(0), item(1), item(2));
    assert_eq!(plan["items"][2]["name"], "Zirconia crown");

    // A procedure can't carry out an item the patient hasn't accepted.
    let procedures = format!("/api/v1/visits/{visit}/procedures");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &procedures,
            Some(&owner),
            Some(json!({ "plan_item_id": rct })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let accept = format!("/api/v1/treatment-plans/{plan_id}/accept");
    let (status, accepted) = app
        .send(
            Method::POST,
            ALPHA,
            &accept,
            Some(&owner),
            Some(json!({ "item_ids": [rct, crown] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    assert_eq!(accepted["status"], "accepted");
    assert_eq!(accepted["items"][1]["status"], "cancelled");
    assert_eq!(accepted["estimate_paise"], 1_650_000);
    assert_eq!(
        status_of(&app, Method::POST, ALPHA, &accept, &owner, Some(json!({}))).await,
        StatusCode::CONFLICT
    );

    // Doing the root canal marks its item done; name, tooth and price come from the item.
    let (status, done) = app
        .send(
            Method::POST,
            ALPHA,
            &procedures,
            Some(&owner),
            Some(json!({ "plan_item_id": rct, "surfaces": ["O"] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{done}");
    assert_eq!(done["name"], "Root canal treatment");
    assert_eq!(done["tooth"], 36);
    assert_eq!(done["price_paise"], 450_000);
    assert_eq!(done["status"], "done");
    let rct_procedure = done["id"].as_str().unwrap().to_owned();
    let (_, listed) = app
        .send(Method::GET, ALPHA, &plans, Some(&owner), None)
        .await;
    assert_eq!(listed["items"][0]["status"], "in_progress");
    assert_eq!(listed["items"][0]["items"][0]["status"], "done");
    assert_eq!(
        listed["items"][0]["items"][0]["procedure_id"],
        rct_procedure.as_str()
    );
    for (body, expected) in [
        (json!({ "plan_item_id": rct }), StatusCode::CONFLICT),
        (json!({ "plan_item_id": scaling }), StatusCode::CONFLICT),
    ] {
        assert_eq!(
            status_of(
                &app,
                Method::POST,
                ALPHA,
                &procedures,
                &owner,
                Some(body.clone())
            )
            .await,
            expected,
            "{body}"
        );
    }
    // Another patient's visit can't carry out this patient's plan.
    assert_eq!(
        status_of(
            &app,
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{other_visit}/procedures"),
            &owner,
            Some(json!({ "plan_item_id": crown }))
        )
        .await,
        StatusCode::BAD_REQUEST
    );

    // A planned crown, completed later, completes the plan.
    let (status, planned) = app
        .send(
            Method::POST,
            ALPHA,
            &procedures,
            Some(&owner),
            Some(json!({ "plan_item_id": crown, "status": "planned" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{planned}");
    assert_eq!(planned["performed_at"], Value::Null);
    let crown_procedure = planned["id"].as_str().unwrap().to_owned();
    let (status, completed) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/procedures/{crown_procedure}/complete"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{completed}");
    assert!(completed["performed_at"].is_string());
    let (_, listed) = app
        .send(Method::GET, ALPHA, &plans, Some(&owner), None)
        .await;
    assert_eq!(listed["items"][0]["status"], "completed");

    // Done procedures never change; a mistaken one is retracted and its item reopens.
    let alpha = app.clinic_id("alpha").await;
    let error = app
        .api_db()
        .scoped(&Scope::tenant(alpha), async |tx| {
            sqlx::query("update aarogyam.procedures set price_paise = 1 where id = $1::uuid")
                .bind(&rct_procedure)
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Forbidden);
    let (status, retracted) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/procedures/{rct_procedure}/entered-in-error"),
            Some(&owner),
            Some(json!({ "reason": "recorded on the wrong tooth" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{retracted}");
    let (_, listed) = app
        .send(Method::GET, ALPHA, &plans, Some(&owner), None)
        .await;
    assert_eq!(listed["items"][0]["status"], "in_progress");
    assert_eq!(listed["items"][0]["items"][0]["status"], "accepted");
    assert_eq!(listed["items"][0]["items"][0]["procedure_id"], Value::Null);

    // Procedures without a plan, and bad input.
    let (status, adhoc) = app
        .send(
            Method::POST,
            ALPHA,
            &procedures,
            Some(&owner),
            Some(json!({ "name": "Composite filling", "tooth": 46, "surfaces": ["o", "D"], "price_paise": 150_000, "code": { "system": "custom", "code": "D2392" } })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{adhoc}");
    assert_eq!(adhoc["surfaces"], json!(["O", "D"]));
    for (body, field) in [
        (json!({ "name": "Filling", "tooth": 99 }), "tooth"),
        (json!({ "name": "Filling", "surfaces": ["O"] }), "surfaces"),
        (
            json!({ "name": "Filling", "price_paise": -1 }),
            "price_paise",
        ),
        (
            json!({ "name": "Filling", "status": "entered_in_error" }),
            "status",
        ),
        (json!({}), "name"),
    ] {
        let (status, error) = app
            .send(Method::POST, ALPHA, &procedures, Some(&owner), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}: {error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }
    let (_, list) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/procedures"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 3);
    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(detail["procedures"].as_array().unwrap().len(), 3);
    app.finish().await;
}

const BOUNDARY: &str = "aarogyam-test-boundary";

/// Uploads `bytes` as the `file` field of a multipart form, with the other fields given.
async fn upload(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    bytes: &[u8],
    fields: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::post(format!("/api/v1/patients/{patient}/attachments"))
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Fetches a path without a sign-in header and returns the status, content type and bytes.
async fn fetch(app: &TestApp, host: &str, path: &str) -> (StatusCode, String, Vec<u8>) {
    let request = Request::get(path)
        .header("host", host)
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let bytes = to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    (status, content_type, bytes.to_vec())
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn files_carry_a_label_and_tooth_and_stay_inside_their_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let mut jpeg = vec![0xFF_u8, 0xD8, 0xFF, 0xE0];
    jpeg.extend_from_slice(&[3_u8; 512]);

    let (status, file) = upload(
        &app,
        ALPHA,
        &owner,
        &patient,
        &jpeg,
        &[
            ("kind", "photo"),
            ("label", "  Intraoral \u{2013} upper "),
            ("tooth", "11"),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    assert_eq!(file["label"], "Intraoral \u{2013} upper");
    assert_eq!(file["tooth"], 11);
    let (_, plain) = upload(&app, ALPHA, &owner, &patient, &jpeg, &[("label", "OPG")]).await;
    assert_eq!(plain["label"], "OPG");
    assert!(plain["tooth"].is_null());

    // Too long a label is refused; the files list carries the labels.
    let long = "x".repeat(61);
    let (status, _) = upload(&app, ALPHA, &owner, &patient, &jpeg, &[("label", &long)]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // A retry with the same id but another label is a different file.
    let id = "0192f1c4-7b3a-7c2e-8f10-3a5d9e1b2c4d";
    let fields = [("id", id), ("label", "X-ray")];
    assert_eq!(
        upload(&app, ALPHA, &owner, &patient, &jpeg, &fields)
            .await
            .0,
        StatusCode::CREATED
    );
    assert_eq!(
        upload(&app, ALPHA, &owner, &patient, &jpeg, &fields)
            .await
            .0,
        StatusCode::CREATED
    );
    let changed = [("id", id), ("label", "Consent")];
    assert_eq!(
        upload(&app, ALPHA, &owner, &patient, &jpeg, &changed)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let path = format!("/api/v1/patients/{patient}/attachments");
    let (_, listed) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    let mut labels: Vec<&str> = listed["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|f| f["label"].as_str())
        .collect();
    labels.sort_unstable();
    assert_eq!(labels, ["Intraoral \u{2013} upper", "OPG", "X-ray"]);

    // Writing needs clinical.write; another clinic sees nothing.
    assert_eq!(
        upload(
            &app,
            ALPHA,
            &assistant,
            &patient,
            &jpeg,
            &[("label", "OPG")]
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, _) = app.send(Method::GET, BETA, &path, Some(&beta), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn files_upload_by_content_and_download_through_short_lived_links() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let other_visit = start_visit(&app, &owner, &other).await;
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&[7_u8; 2048]);

    let (status, file) = upload(
        &app,
        ALPHA,
        &owner,
        &patient,
        &png,
        &[
            ("kind", "xray"),
            ("tooth", "36"),
            ("visit_id", &visit),
            ("caption", "IOPA 36"),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    assert_eq!(file["mime_type"], "image/png");
    assert_eq!(file["kind"], "xray");
    assert_eq!(file["tooth"], 36);
    assert_eq!(file["size_bytes"], png.len());
    let id = file["id"].as_str().unwrap().to_owned();
    // Stored under ids only, never a name from the request.
    let alpha = app.clinic_id("alpha").await;
    assert!(app.files_dir.join(alpha.to_string()).join(&id).is_file());

    // Refused: wrong content, too large, missing file, bad tooth, another patient's visit.
    let html = b"<html><script>alert(1)</script></html>";
    let big = vec![0xFF_u8; 10 * 1024 * 1024 + 1];
    for (bytes, fields, expected) in [
        (&html[..], vec![], StatusCode::BAD_REQUEST),
        (&big[..], vec![], StatusCode::PAYLOAD_TOO_LARGE),
        (&png[..], vec![("tooth", "99")], StatusCode::BAD_REQUEST),
        (
            &png[..],
            vec![("visit_id", other_visit.as_str())],
            StatusCode::BAD_REQUEST,
        ),
        (&png[..], vec![("colour", "red")], StatusCode::BAD_REQUEST),
    ] {
        let (status, error) = upload(&app, ALPHA, &owner, &patient, bytes, &fields).await;
        assert_eq!(status, expected, "{fields:?}: {error}");
    }
    assert_eq!(
        status_of(
            &app,
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/attachments"),
            &owner,
            Some(json!({}))
        )
        .await,
        StatusCode::BAD_REQUEST
    );
    // Uploading needs clinical.write and a patient of this clinic.
    assert_eq!(
        upload(&app, ALPHA, &assistant, &patient, &png, &[]).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        upload(&app, BETA, &beta, &patient, &png, &[]).await.0,
        StatusCode::NOT_FOUND
    );

    let (_, listed) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/attachments"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(detail["attachments"][0]["id"], id.as_str());

    // A link works without a sign-in header, on this clinic's host only, and is recorded.
    let (status, link) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/attachments/{id}/download"),
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{link}");
    let url = link["url"].as_str().unwrap().to_owned();
    let (status, content_type, bytes) = fetch(&app, ALPHA, &url).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "image/png");
    assert_eq!(bytes, png);
    let (downloads,): (i64,) = sqlx::query_as(
        "select count(*) from audit.access_log
         where resource = 'attachment' and action = 'download' and resource_id = $1::uuid
           and actor_user_id = '01900000-0000-7000-8000-0000000000a2'",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(downloads, 1);
    assert_eq!(fetch(&app, BETA, &url).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        fetch(&app, ALPHA, &format!("{url}x")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        fetch(&app, ALPHA, &format!("/api/v1/attachments/{id}/content"))
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    // After five minutes the link stops working.
    let expired = LinkSigner::new(FILE_KEY).unwrap().sign(
        ClinicId::from_uuid(alpha),
        AttachmentId::from_uuid(Uuid::parse_str(&id).unwrap()),
        UserId::from_uuid(uuid!("01900000-0000-7000-8000-0000000000a1")),
        OffsetDateTime::now_utc() - time::Duration::seconds(1),
    );
    let (status, _, _) = fetch(
        &app,
        ALPHA,
        &format!("/api/v1/attachments/{id}/content?token={expired}"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic's member can't get a link.
    assert_eq!(
        status_of(
            &app,
            Method::GET,
            BETA,
            &format!("/api/v1/attachments/{id}/download"),
            &beta,
            None
        )
        .await,
        StatusCode::NOT_FOUND
    );
    app.finish().await;
}

/// A tiny `WebM` recording: the EBML header plus filler.
fn webm() -> Vec<u8> {
    let mut bytes = vec![0x1A, 0x45, 0xDF, 0xA3];
    bytes.extend_from_slice(&[9_u8; 1024]);
    bytes
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn voice_recordings_link_to_notes_and_signed_notes_take_them_only_with_an_addendum() {
    let app = TestApp::start().await;
    add_doctor(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let doctor = app.token(ALPHA_DOCTOR);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let other_visit = start_visit(&app, &owner, &other).await;
    let (status, note) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{visit}/notes"),
            Some(&owner),
            Some(json!({ "sections": { "subjective": "Pain on chewing" } })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    let note_id = note["id"].as_str().unwrap().to_owned();
    assert_eq!(note["source"], "typed");
    let audio = webm();
    let fields = |extra: &[(&'static str, String)]| -> Vec<(&'static str, String)> {
        let mut all = vec![
            ("note_id", note_id.clone()),
            ("duration_seconds", "42".to_owned()),
            ("language", "hi-IN".to_owned()),
        ];
        all.extend_from_slice(extra);
        all
    };
    let send = async |host: &str, token: &str, patient: &str, form: Vec<(&'static str, String)>| {
        let borrowed: Vec<(&str, &str)> = form.iter().map(|(k, v)| (*k, v.as_str())).collect();
        upload(&app, host, token, patient, &audio, &borrowed).await
    };

    let (status, file) = send(ALPHA, &owner, &patient, fields(&[])).await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    assert_eq!(file["kind"], "audio");
    assert_eq!(file["mime_type"], "audio/webm");
    assert_eq!(file["note_id"], note_id.as_str());
    assert_eq!(file["visit_id"], visit.as_str());
    assert_eq!(file["duration_seconds"], 42);
    assert_eq!(file["language"], "hi-IN");
    let id = file["id"].as_str().unwrap().to_owned();
    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(detail["attachments"][0]["note_id"], note_id.as_str());
    assert_eq!(detail["notes"][0]["source"], "voice");

    // Refused: no length, too long, bad language, another visit, another patient's note, a
    // note that is another member's draft, and audio sent as a document.
    for (form, expected) in [
        (vec![("note_id", note_id.clone())], StatusCode::BAD_REQUEST),
        (
            fields(&[("duration_seconds", "601".to_owned())]),
            StatusCode::BAD_REQUEST,
        ),
        (
            fields(&[("language", "fr-FR".to_owned())]),
            StatusCode::BAD_REQUEST,
        ),
        (
            fields(&[("visit_id", other_visit.clone())]),
            StatusCode::BAD_REQUEST,
        ),
        (
            fields(&[("kind", "document".to_owned())]),
            StatusCode::BAD_REQUEST,
        ),
        (
            fields(&[("addendum_id", Uuid::now_v7().to_string())]),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let (status, error) = send(ALPHA, &owner, &patient, form.clone()).await;
        assert_eq!(status, expected, "{form:?}: {error}");
    }
    assert_eq!(
        send(ALPHA, &owner, &other, fields(&[])).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(ALPHA, &doctor, &patient, fields(&[])).await.0,
        StatusCode::FORBIDDEN
    );
    // Recording needs clinical.write; another clinic gets 404 for everything.
    assert_eq!(
        send(ALPHA, &assistant, &patient, fields(&[])).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(BETA, &beta, &patient, fields(&[])).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status_of(
            &app,
            Method::GET,
            BETA,
            &format!("/api/v1/attachments/{id}/download"),
            &beta,
            None
        )
        .await,
        StatusCode::NOT_FOUND
    );

    // Playing needs clinical.read; opening the link is in the access record.
    let (status, link) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/attachments/{id}/download"),
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{link}");
    let (status, content_type, bytes) = fetch(&app, ALPHA, link["url"].as_str().unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "audio/webm");
    assert_eq!(bytes, audio);
    let (downloads,): (i64,) = sqlx::query_as(
        "select count(*) from audit.access_log
         where resource = 'attachment' and action = 'download' and resource_id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(downloads, 1);

    // Signed notes are frozen: a recording joins one only through the member's own addendum.
    let sign = format!("/api/v1/notes/{note_id}/sign");
    assert_eq!(
        status_of(&app, Method::POST, ALPHA, &sign, &owner, None).await,
        StatusCode::OK
    );
    assert_eq!(
        send(ALPHA, &owner, &patient, fields(&[])).await.0,
        StatusCode::BAD_REQUEST
    );
    let addenda = format!("/api/v1/notes/{note_id}/addenda");
    let (_, theirs) = app
        .send(
            Method::POST,
            ALPHA,
            &addenda,
            Some(&doctor),
            Some(json!({ "body": "Second opinion" })),
        )
        .await;
    let (status, mine) = app
        .send(
            Method::POST,
            ALPHA,
            &addenda,
            Some(&owner),
            Some(json!({ "body": "Dictated follow-up" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{mine}");
    let theirs = theirs["addenda"][0]["id"].as_str().unwrap().to_owned();
    let mine = mine["addenda"][1]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        send(ALPHA, &owner, &patient, fields(&[("addendum_id", theirs)]))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, file) = send(
        ALPHA,
        &owner,
        &patient,
        fields(&[("addendum_id", mine.clone())]),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    assert_eq!(file["addendum_id"], mine.as_str());
    // The signed note itself is unchanged by the recording.
    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(detail["notes"][0]["source"], "voice");
    assert_eq!(detail["attachments"].as_array().unwrap().len(), 2);

    // The database refuses a recording on a signed note without an addendum, even for a
    // direct insert.
    let alpha = app.clinic_id("alpha").await;
    let error = app
        .api_db()
        .scoped(&Scope::tenant(alpha), async |tx| {
            sqlx::query(
                "insert into aarogyam.attachments
                   (encounter_id, patient_id, note_id, kind, storage_key, mime_type, size_bytes, sha256, duration_seconds)
                 values ($1::uuid, $2::uuid, $3::uuid, 'audio', gen_random_uuid() || '/' || gen_random_uuid(),
                         'audio/webm', 10, repeat('a', 64), 5)",
            )
            .bind(&visit)
            .bind(&patient)
            .bind(&note_id)
            .execute(tx.conn())
            .await
            .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Invalid);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_timeline_lists_the_record_newest_first() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let signed = create(
        &app,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "assessment": "Deep caries 36" } }),
    )
    .await;
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/notes/{signed}/sign"),
        Some(&owner),
        None,
    )
    .await;
    // Drafts stay off the timeline.
    create(
        &app,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "plan": "draft" } }),
    )
    .await;
    create(
        &app,
        &format!("/api/v1/visits/{visit}/procedures"),
        json!({ "name": "Root canal treatment", "tooth": 36, "price_paise": 450_000 }),
    )
    .await;
    upload(
        &app,
        ALPHA,
        &owner,
        &patient,
        b"%PDF-1.7\n%%EOF",
        &[("caption", "Consent")],
    )
    .await;

    let path = format!("/api/v1/patients/{patient}/timeline");
    let (status, timeline) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{timeline}");
    let items = timeline["items"].as_array().unwrap();
    let kinds: Vec<&str> = items.iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["attachment", "procedure", "note", "visit"]);
    assert_eq!(items[1]["amount_paise"], 450_000);
    assert_eq!(items[1]["detail"], "tooth 36");
    assert_eq!(items[2]["detail"], "Deep caries 36");
    assert_eq!(items[3]["detail"], "Pain lower left");
    assert_eq!(items[3]["by"]["name"], "Asha Owner");
    // Paging: events before the second one.
    let before = items[1]["at"].as_str().unwrap();
    let (_, page) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("{path}?limit=1&before={}", before.replace('+', "%2B")),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["kind"], "note");
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("{path}?before=yesterday"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (reads,): (i64,) = sqlx::query_as(
        "select count(*) from audit.access_log where patient_id = $1::uuid and resource = 'chart'",
    )
    .bind(&patient)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(reads, 2);
    app.finish().await;
}

/// Procedures and materials: the seeded vocabulary and the clinic's additions arrive with the
/// chart, entries name them by id and show their labels in the history, and one clinic can
/// neither see nor use another's terms.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn dental_terms_are_seeded_added_per_clinic_and_named_by_entries() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let chart_path = format!("/api/v1/patients/{patient}/dental-chart");
    let add = async |host, token: &str, kind: &str, label: &str| {
        app.send(
            Method::POST,
            host,
            "/api/v1/dental-terms",
            Some(token),
            Some(json!({ "kind": kind, "label": label })),
        )
        .await
    };

    // The seeded vocabulary comes with the chart.
    let (status, chart) = app
        .send(Method::GET, ALPHA, &chart_path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    let labels = |chart: &Value, kind: &str| -> Vec<String> {
        chart["terms"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["kind"] == kind)
            .map(|t| t["label"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(labels(&chart, "material").len(), 10);
    assert!(labels(&chart, "material").contains(&"Zirconia".to_owned()));
    assert!(labels(&chart, "procedure").contains(&"Crown".to_owned()));

    // "Add new": saved once per clinic, found again ignoring case; a seeded label is the seeded term.
    let (status, added) = add(ALPHA, &owner, "material", "  Lithium   silicate ").await;
    assert_eq!(status, StatusCode::CREATED, "{added}");
    assert_eq!(added["label"], "Lithium silicate");
    assert_eq!(added["own"], true);
    let own = added["id"].as_str().unwrap().to_owned();
    let (status, again) = add(ALPHA, &owner, "material", "lithium SILICATE").await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["id"], own.as_str());
    let (status, seeded) = add(ALPHA, &owner, "material", "zirconia").await;
    assert_eq!(status, StatusCode::OK, "{seeded}");
    assert_eq!(
        (&seeded["id"], &seeded["own"]),
        (&json!("zirconia"), &json!(false))
    );
    for (kind, label) in [
        ("colour", "Blue"),
        ("material", "   "),
        ("procedure", &"x".repeat(81)),
    ] {
        let (status, error) = add(ALPHA, &owner, kind, label).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{kind} {label}: {error}");
    }
    let (status, _) = add(ALPHA, &app.token(ALPHA_ASSISTANT), "material", "Gold foil").await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Entries name terms by id; the chart and the history carry their labels.
    let (status, chart) = app
        .send(
            Method::POST,
            ALPHA,
            &chart_path,
            Some(&owner),
            Some(json!({ "entries": [
                { "tooth": 16, "finding": "crown", "procedure": "crown", "material": "zirconia" },
                { "tooth": 26, "surface": "O", "finding": "filled", "procedure": "inlay", "material": own },
                { "tooth": 27, "surface": "M", "finding": "caries" },
            ] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert!(labels(&chart, "material").contains(&"Lithium silicate".to_owned()));
    assert_eq!(chart["current"][0]["material"]["label"], "Zirconia");
    assert_eq!(chart["current"][0]["procedure"]["label"], "Crown");
    assert_eq!(chart["current"][1]["material"]["id"], own.as_str());
    assert_eq!(chart["current"][1]["material"]["label"], "Lithium silicate");
    assert_eq!(chart["current"][2]["material"], Value::Null);
    let (status, chart) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("{chart_path}?tooth=26"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert_eq!(chart["history"][0]["surface"], "O");
    assert_eq!(chart["history"][0]["procedure"]["label"], "Inlay");
    assert_eq!(chart["history"][0]["material"]["label"], "Lithium silicate");

    for entry in [
        json!({ "tooth": 16, "finding": "crown", "material": "unobtainium" }),
        json!({ "tooth": 16, "finding": "crown", "procedure": "zirconia" }),
        json!({ "tooth": 16, "finding": "crown", "procedure": own }),
        json!({ "tooth": 16, "finding": "sound", "material": "gold" }),
        json!({ "tooth": 16, "finding": "crown", "material": Uuid::now_v7() }),
    ] {
        let (status, error) = app
            .send(
                Method::POST,
                ALPHA,
                &chart_path,
                Some(&owner),
                Some(json!({ "entries": [entry] })),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{entry}: {error}");
    }

    // Beta sees only the seeded list, can't use Alpha's term, and keeps its own additions apart.
    let beta_patient = register(&app, BETA, &beta, "Ravi Kumar").await;
    let beta_chart = format!("/api/v1/patients/{beta_patient}/dental-chart");
    let (status, chart) = app
        .send(Method::GET, BETA, &beta_chart, Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert!(!labels(&chart, "material").contains(&"Lithium silicate".to_owned()));
    let (status, error) = app
        .send(
            Method::POST,
            BETA,
            &beta_chart,
            Some(&beta),
            Some(json!({ "entries": [{ "tooth": 26, "finding": "filled", "material": own }] })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, theirs) = add(BETA, &beta, "material", "Lithium silicate").await;
    assert_eq!(status, StatusCode::CREATED, "{theirs}");
    assert_ne!(theirs["id"], own.as_str());
    // On Alpha's host Beta's owner isn't a member.
    let (status, _) = add(ALPHA, &beta, "material", "Gold foil").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Row-level security keeps each clinic's terms to itself, and terms never change.
    let (alpha_id, beta_id) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();
    for (clinic, expected) in [
        (alpha_id, own.clone()),
        (beta_id, theirs["id"].as_str().unwrap().to_owned()),
    ] {
        let ids = db
            .scoped(&Scope::tenant(clinic), async |tx| {
                sqlx::query_scalar::<_, String>("select id::text from aarogyam.dental_terms")
                    .fetch_all(tx.conn())
                    .await
                    .map_err(DbError::from)
            })
            .await
            .unwrap();
        assert_eq!(ids, [expected]);
    }
    let error = db
        .scoped(&Scope::tenant(alpha_id), async |tx| {
            sqlx::query("update aarogyam.dental_terms set label = 'Changed'")
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Forbidden);
    app.finish().await;
}

/// The clinical tables pass the schema checks, and row-level security hides one clinic's
/// clinical rows from another even in a direct query.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn clinical_tables_pass_the_schema_checks_and_isolate_clinics() {
    let app = TestApp::start().await;
    let lint = include_str!("../../../db/checks/schema_lint.sql");
    for check in lint.split("-- name: ").skip(1) {
        let (name, query) = check.split_once('\n').unwrap();
        let violations: Vec<(String,)> = sqlx::query_as(sqlx::AssertSqlSafe(query.to_owned()))
            .fetch_all(&app.owner)
            .await
            .unwrap();
        // The migration ledger is created by sqlx itself, outside the migrations.
        let violations: Vec<String> = violations
            .into_iter()
            .map(|(v,)| v)
            .filter(|v| v != "private._sqlx_migrations")
            .collect();
        assert!(violations.is_empty(), "{name}: {violations:?}");
    }

    let owner = app.token(ALPHA_OWNER);
    for (method, path, body) in every_route(&app).await {
        if method == Method::POST && path.ends_with("/dental-chart") {
            let (status, chart) = app.send(method, ALPHA, &path, Some(&owner), body).await;
            assert_eq!(status, StatusCode::OK, "{chart}");
        }
    }
    let (alpha, beta) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();
    for table in [
        "encounters",
        "clinical_notes",
        "observations",
        "conditions",
        "allergies",
        "specialty_records",
        "procedures",
        "treatment_plans",
        "treatment_plan_items",
        "attachments",
    ] {
        let count = async |clinic| {
            db.scoped(&Scope::tenant(clinic), async |tx| {
                sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                    "select count(*) from aarogyam.{table}"
                )))
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
            })
            .await
            .unwrap()
        };
        assert!(count(alpha).await > 0, "{table} at Alpha");
        assert_eq!(count(beta).await, 0, "{table} at Beta");
    }
    app.finish().await;
}

/// Posts `body` as Alpha's owner and returns the new record's id.
async fn create(app: &TestApp, path: &str, body: Value) -> String {
    let owner = app.token(ALPHA_OWNER);
    let (status, created) = app
        .send(Method::POST, ALPHA, path, Some(&owner), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {created}");
    created["id"]
        .as_str()
        .or_else(|| created["items"][0]["id"].as_str())
        .unwrap()
        .to_owned()
}

/// One of each clinical record at Alpha, and every clinical route with a body that would be
/// accepted.
async fn every_route(app: &TestApp) -> Vec<(Method, String, Option<Value>)> {
    let owner = app.token(ALPHA_OWNER);
    let patient = register(app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(app, &owner, &patient).await;
    let note = create(
        app,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "plan": "RCT 36" } }),
    )
    .await;
    let reading = create(
        app,
        &format!("/api/v1/visits/{visit}/observations"),
        json!({ "readings": [{ "kind": "pulse", "value": 72 }] }),
    )
    .await;
    let condition = create(
        app,
        &format!("/api/v1/patients/{patient}/conditions"),
        json!({ "display_text": "Type 2 diabetes", "flagged": true }),
    )
    .await;
    let allergy = create(
        app,
        &format!("/api/v1/patients/{patient}/allergies"),
        json!({ "substance": "Penicillin" }),
    )
    .await;
    let plan = create(
        app,
        &format!("/api/v1/patients/{patient}/treatment-plans"),
        json!({ "title": "Molar", "items": [{ "name": "Root canal", "tooth": 36, "estimate_paise": 1 }] }),
    )
    .await;
    let procedure = create(
        app,
        &format!("/api/v1/visits/{visit}/procedures"),
        json!({ "name": "Scaling", "status": "planned" }),
    )
    .await;
    let (_, file) = upload(app, ALPHA, &owner, &patient, b"%PDF-1.7\n%%EOF", &[]).await;
    let attachment = file["id"].as_str().unwrap().to_owned();
    let sections = json!({ "sections": { "plan": "x" } });
    let reason = json!({ "reason": "wrong patient" });
    vec![
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
            Some(reason.clone()),
        ),
        (
            Method::POST,
            format!("/api/v1/visits/{visit}/observations"),
            Some(json!({ "readings": [{ "kind": "pulse", "value": 80 }] })),
        ),
        (
            Method::POST,
            format!("/api/v1/observations/{reading}/entered-in-error"),
            Some(reason),
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/conditions"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/conditions"),
            Some(json!({ "display_text": "Hypertension" })),
        ),
        (
            Method::PATCH,
            format!("/api/v1/patients/{patient}/conditions/{condition}"),
            Some(json!({ "status": "resolved" })),
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/allergies"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/allergies"),
            Some(json!({ "substance": "Latex" })),
        ),
        (
            Method::PATCH,
            format!("/api/v1/patients/{patient}/allergies/{allergy}"),
            Some(json!({ "status": "resolved" })),
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/allergies/{allergy}/confirm"),
            None,
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/clinical-flags"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/visits/{visit}/procedures"),
            Some(json!({ "name": "Scaling" })),
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/procedures"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/procedures/{procedure}/complete"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/procedures/{procedure}/entered-in-error"),
            Some(json!({ "reason": "wrong patient" })),
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/treatment-plans"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/treatment-plans"),
            Some(json!({ "title": "Plan", "items": [{ "name": "Scaling", "estimate_paise": 1 }] })),
        ),
        (
            Method::POST,
            format!("/api/v1/treatment-plans/{plan}/accept"),
            Some(json!({})),
        ),
        (
            Method::PATCH,
            format!("/api/v1/treatment-plan-items/{plan}"),
            Some(json!({ "status": "done" })),
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/attachments"),
            None,
        ),
        (
            Method::GET,
            format!("/api/v1/attachments/{attachment}/download"),
            None,
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/dental-chart"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{patient}/dental-chart"),
            Some(json!({ "entries": [{ "tooth": 36, "surface": "O", "finding": "caries" }] })),
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/timeline"),
            None,
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/notes"),
            None,
        ),
        (
            Method::PUT,
            format!("/api/v1/patients/{patient}/summary-note"),
            Some(json!({ "body": "## History\n- **Diabetic**" })),
        ),
        (Method::POST, format!("/api/v1/visits/{visit}/close"), None),
    ]
}

/// A path with every UUID segment (or `{name}` placeholder) replaced by `{}`.
fn template(path: &str) -> String {
    path.split('/')
        .map(|part| {
            if Uuid::try_parse(part).is_ok() || part.starts_with('{') {
                "{}"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// [`every_route`] lists every clinical operation in the OpenAPI document, except the upload
/// (multipart, checked in the files test), the signed download (no sign-in) and adding a dental
/// term (checked in its own test).
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn every_clinical_route_is_checked() {
    let app = TestApp::start().await;
    let document = serde_json::to_value(aarogyam_api::openapi()).unwrap();
    let mut documented: Vec<String> = Vec::new();
    for (path, operations) in document["paths"].as_object().unwrap() {
        for (method, operation) in operations.as_object().unwrap() {
            let clinical = operation["tags"]
                .as_array()
                .is_some_and(|tags| tags.contains(&json!("clinical")));
            // Adding a dental term names no record, so it has no cross-clinic 404; its own test
            // proves clinics can't see or use each other's terms.
            let skipped = path.ends_with("/content")
                || path.ends_with("/dental-terms")
                || (path.ends_with("/attachments") && method == "post");
            if clinical && !skipped {
                documented.push(format!("{} {}", method.to_uppercase(), template(path)));
            }
        }
    }
    let mut checked: Vec<String> = every_route(&app)
        .await
        .into_iter()
        .map(|(method, path, _)| format!("{method} {}", template(&path)))
        .collect();
    documented.sort();
    checked.sort();
    checked.dedup();
    assert_eq!(checked, documented);
    app.finish().await;
}

/// Every clinical route answers 404 to another clinic's member for this clinic's records.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn other_clinics_get_not_found() {
    let app = TestApp::start().await;
    let beta = app.token(BETA_OWNER);
    for (method, path, body) in every_route(&app).await {
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
/// assistant only reads). The clinical flags need only patients.read, so the front desk sees
/// that a flag exists.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn clinical_routes_need_their_permission() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    for (method, path, body) in every_route(&app).await {
        let flags = path.ends_with("/clinical-flags");
        if method == Method::GET {
            let expected = if flags {
                StatusCode::OK
            } else {
                StatusCode::FORBIDDEN
            };
            assert_eq!(
                status_of(&app, method.clone(), ALPHA, &path, &desk, None).await,
                expected,
                "front desk {method} {path}"
            );
            assert_eq!(
                status_of(&app, method.clone(), ALPHA, &path, &assistant, None).await,
                StatusCode::OK,
                "assistant {method} {path}"
            );
        } else {
            assert_eq!(
                status_of(&app, method.clone(), ALPHA, &path, &assistant, body).await,
                StatusCode::FORBIDDEN,
                "assistant {method} {path}"
            );
        }
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn plan_items_are_finished_one_by_one_and_then_frozen() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let (status, plan) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/treatment-plans"),
            Some(&owner),
            Some(json!({ "title": "Molar", "items": [
                { "name": "Root canal treatment", "estimate_paise": 450_000 },
                { "name": "Scaling", "estimate_paise": 80_000 },
            ] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{plan}");
    let plan_id = plan["id"].as_str().unwrap().to_owned();
    let first = plan["items"][0]["id"].as_str().unwrap().to_owned();
    let second = plan["items"][1]["id"].as_str().unwrap().to_owned();
    let patch = |id: &str| format!("/api/v1/treatment-plan-items/{id}");
    let set = |status: &str| Some(json!({ "status": status }));

    // A proposed item can't be finished before the plan is accepted.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &patch(&first),
            Some(&owner),
            set("done"),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/treatment-plans/{plan_id}/accept"),
            Some(&owner),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &patch(&first),
            Some(&assistant),
            set("done"),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::PATCH,
            BETA,
            &patch(&first),
            Some(&beta),
            set("done"),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &patch(&first),
            Some(&owner),
            set("proposed"),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, after) = app
        .send(
            Method::PATCH,
            ALPHA,
            &patch(&first),
            Some(&owner),
            set("done"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(after["status"], "in_progress");
    assert_eq!(after["items"][0]["status"], "done");
    // Finished items are frozen.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &patch(&first),
            Some(&owner),
            set("cancelled"),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, after) = app
        .send(
            Method::PATCH,
            ALPHA,
            &patch(&second),
            Some(&owner),
            set("cancelled"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(after["status"], "completed");
    app.finish().await;
}
