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
            Method::GET,
            format!("/api/v1/patients/{patient}/clinical-flags"),
            None,
        ),
        (Method::POST, format!("/api/v1/visits/{visit}/close"), None),
    ]
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
