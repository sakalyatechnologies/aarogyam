//! Client-chosen ids on the creates a phone may repeat after a lost answer: a retry with the same
//! id and content returns the record that exists, the same id with other content is `id_conflict`,
//! and another clinic's records never collide with it.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one offline flow from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

/// A random version 4 UUID, which a client may not use as an id.
const VERSION_4: &str = "a0000000-0000-4000-8000-000000000001";

fn new_id() -> String {
    Uuid::now_v7().to_string()
}

/// How many rows, in any clinic, have this id.
async fn rows(app: &TestApp, table: &str, id: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "select count(*) from aarogyam.{table} where id = $1::uuid"
    )))
    .bind(id)
    .fetch_one(&app.owner)
    .await
    .unwrap()
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

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), Some(body))
        .await
}

async fn start_visit(app: &TestApp, token: &str, patient: &str) -> String {
    let (status, visit) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Pain lower left" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    visit["id"].as_str().unwrap().to_owned()
}

fn visit_number(visit: &Value) -> i64 {
    visit["number"]
        .as_str()
        .and_then(|number| number.strip_prefix("V-"))
        .and_then(|digits| digits.parse().ok())
        .unwrap()
}

fn assert_id_conflict(answer: &(StatusCode, Value), what: &str) {
    assert_eq!(answer.0, StatusCode::CONFLICT, "{what}: {}", answer.1);
    assert_eq!(answer.1["error"]["code"], "id_conflict", "{what}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_visit_started_again_with_the_same_id_is_the_same_visit() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let id = new_id();
    let path = format!("/api/v1/patients/{patient}/visits");
    let body = json!({ "id": id, "chief_complaint": "Toothache" });

    let (status, first) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["id"], id);

    // A retry returns the visit that exists, not a second one, and takes no new visit number.
    let (status, again) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again, first);
    assert_eq!(rows(&app, "encounters", &id).await, 1);
    let (_, next) = post(&app, ALPHA, &owner, &path, json!({})).await;
    assert_eq!(visit_number(&next), visit_number(&first) + 1);

    // The same id with other content is refused: another complaint, none, or another patient.
    for (changed, what) in [
        (
            json!({ "id": id, "chief_complaint": "Swelling" }),
            "complaint",
        ),
        (json!({ "id": id }), "no complaint"),
    ] {
        assert_id_conflict(&post(&app, ALPHA, &owner, &path, changed).await, what);
    }
    let other_path = format!("/api/v1/patients/{other}/visits");
    assert_id_conflict(
        &post(&app, ALPHA, &owner, &other_path, body.clone()).await,
        "another patient",
    );
    assert_eq!(rows(&app, "encounters", &id).await, 1);

    // An id must be a version 7 UUID.
    for bad in [
        "not-an-id",
        VERSION_4,
        "00000000-0000-0000-0000-000000000000",
    ] {
        let (status, error) = post(&app, ALPHA, &owner, &path, json!({ "id": bad })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {error}");
        assert_eq!(error["error"]["code"], "invalid_request");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with("id:"),
            "{error}"
        );
    }

    // Another clinic may use the same id for its own visit; neither sees the other's.
    let beta_patient = register(&app, BETA, &beta_owner, "Bina Patient").await;
    let beta_path = format!("/api/v1/patients/{beta_patient}/visits");
    let (status, theirs) = post(
        &app,
        BETA,
        &beta_owner,
        &beta_path,
        json!({ "id": id, "chief_complaint": "Their own reason" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{theirs}");
    assert_eq!(rows(&app, "encounters", &id).await, 2);
    let visit_path = format!("/api/v1/visits/{id}");
    let (_, mine) = app
        .send(Method::GET, ALPHA, &visit_path, Some(&owner), None)
        .await;
    assert_eq!(mine["visit"]["chief_complaint"], "Toothache");
    let (_, beta_copy) = app
        .send(Method::GET, BETA, &visit_path, Some(&beta_owner), None)
        .await;
    assert_eq!(beta_copy["visit"]["chief_complaint"], "Their own reason");
    // Beta still can't reach Alpha's patient, with or without an id.
    let (status, _) = post(&app, BETA, &beta_owner, &path, json!({ "id": new_id() })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Starting a visit needs clinical.write and a sign-in; a refused request leaves nothing.
    let fresh = new_id();
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = post(&app, ALPHA, &nothing, &path, json!({ "id": fresh })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            None,
            Some(json!({ "id": fresh })),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(rows(&app, "encounters", &fresh).await, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_draft_note_and_its_addendum_are_made_once_however_often_they_are_sent() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let other_visit = start_visit(&app, &owner, &patient).await;
    let note_id = new_id();
    let path = format!("/api/v1/visits/{visit}/notes");
    let body = json!({ "id": note_id, "sections": { "subjective": "Pain on chewing, 36" } });

    let (status, first) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["id"], note_id);
    assert_eq!(first["status"], "draft");
    let (status, again) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again, first);
    assert_eq!(rows(&app, "clinical_notes", &note_id).await, 1);

    // Other sections, another kind, or another visit: the id belongs to a different note.
    let changed = [
        json!({ "id": note_id, "sections": { "subjective": "Something else" } }),
        json!({ "id": note_id, "kind": "progress", "sections": { "subjective": "Pain on chewing, 36" } }),
    ];
    for changed in changed {
        assert_id_conflict(&post(&app, ALPHA, &owner, &path, changed).await, "content");
    }
    let elsewhere = format!("/api/v1/visits/{other_visit}/notes");
    assert_id_conflict(
        &post(&app, ALPHA, &owner, &elsewhere, body.clone()).await,
        "another visit",
    );
    let (status, error) = post(&app, ALPHA, &owner, &path, json!({ "id": VERSION_4 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");

    // The visit closes and the note is signed; a late retry of the create still gets the note.
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/close"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let note_path = format!("/api/v1/notes/{note_id}");
    let (status, signed) = post(&app, ALPHA, &owner, &format!("{note_path}/sign"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    let (status, late) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{late}");
    assert_eq!(late["status"], "signed");
    assert_eq!(rows(&app, "clinical_notes", &note_id).await, 1);

    // An addendum to the signed note, retried.
    let addendum_id = new_id();
    let addenda = format!("{note_path}/addenda");
    let text = json!({ "id": addendum_id, "body": "Allergy to penicillin noted" });
    let (status, first) = post(&app, ALPHA, &owner, &addenda, text.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["addenda"].as_array().unwrap().len(), 1);
    assert_eq!(first["addenda"][0]["id"], addendum_id);
    let (status, again) = post(&app, ALPHA, &owner, &addenda, text.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again, first);
    assert_eq!(rows(&app, "note_addenda", &addendum_id).await, 1);
    assert_id_conflict(
        &post(
            &app,
            ALPHA,
            &owner,
            &addenda,
            json!({ "id": addendum_id, "body": "Different words" }),
        )
        .await,
        "addendum text",
    );
    // A new addendum with a new id is a second one.
    let (status, second) = post(
        &app,
        ALPHA,
        &owner,
        &addenda,
        json!({ "id": new_id(), "body": "Follow up in a week" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second}");
    assert_eq!(second["addenda"].as_array().unwrap().len(), 2);

    // Another clinic's member reaches neither; a role without clinical.write is refused.
    let fresh = new_id();
    let (status, _) = post(
        &app,
        BETA,
        &beta_owner,
        &addenda,
        json!({ "id": fresh, "body": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post(&app, BETA, &beta_owner, &path, json!({ "id": fresh })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = post(
        &app,
        ALPHA,
        &nothing,
        &addenda,
        json!({ "id": fresh, "body": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(&app, ALPHA, &nothing, &path, json!({ "id": fresh })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(rows(&app, "clinical_notes", &fresh).await, 0);
    assert_eq!(rows(&app, "note_addenda", &fresh).await, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn vitals_sent_again_with_the_same_ids_are_recorded_once() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    let path = format!("/api/v1/visits/{visit}/observations");
    let (pulse, systolic, diastolic) = (new_id(), new_id(), new_id());
    let body = json!({
        "recorded_at": "2026-10-05T10:00:00+05:30",
        "readings": [
            { "id": pulse, "kind": "pulse", "value": 72 },
            { "id": systolic, "kind": "bp_systolic", "value": 120 },
            { "id": diastolic, "kind": "bp_diastolic", "value": 80 },
        ]
    });

    let (status, first) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let ids: Vec<&str> = first["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [pulse.as_str(), systolic.as_str(), diastolic.as_str()]);

    // A retry returns the same readings and writes nothing more, even once the visit is closed.
    let (status, again) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again, first);
    for id in [&pulse, &systolic, &diastolic] {
        assert_eq!(rows(&app, "observations", id).await, 1);
    }
    let close = format!("/api/v1/visits/{visit}/close");
    assert_eq!(
        post(&app, ALPHA, &owner, &close, json!({})).await.0,
        StatusCode::OK
    );
    let (status, late) = post(&app, ALPHA, &owner, &path, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{late}");
    assert_eq!(late, first);

    // One changed value, or a time that differs, makes the whole request a conflict.
    let mut changed = body.clone();
    changed["readings"][0]["value"] = json!(80);
    assert_id_conflict(&post(&app, ALPHA, &owner, &path, changed).await, "value");
    let mut later = body.clone();
    later["recorded_at"] = json!("2026-10-05T11:00:00+05:30");
    assert_id_conflict(&post(&app, ALPHA, &owner, &path, later).await, "time");
    let (_, stored) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/visits/{visit}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(stored["observations"].as_array().unwrap().len(), 3);

    // New readings still need an open visit, but a correction does not, and it can be retried.
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &path,
        json!({ "readings": [{ "id": new_id(), "kind": "spo2", "value": 98 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let corrected = new_id();
    let correction = json!({
        "readings": [{ "id": corrected, "kind": "pulse", "value": 75, "supersedes_id": pulse }]
    });
    let (status, fixed) = post(&app, ALPHA, &owner, &path, correction.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{fixed}");
    assert_eq!(fixed["items"][0]["supersedes_id"], pulse);
    let (status, retried) = post(&app, ALPHA, &owner, &path, correction.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{retried}");
    assert_eq!(retried, fixed);
    assert_eq!(rows(&app, "observations", &corrected).await, 1);
    // The reading it corrected is no longer final, so the original request is still a retry.
    let (status, replay) = post(&app, ALPHA, &owner, &path, body).await;
    assert_eq!(status, StatusCode::CREATED, "{replay}");
    assert_eq!(replay["items"][0]["status"], "corrected");

    // Another clinic cannot add to this visit or reuse its ids for its own readings of Alpha's.
    let (status, _) = post(
        &app,
        BETA,
        &beta_owner,
        &path,
        json!({ "readings": [{ "id": new_id(), "kind": "pulse", "value": 70 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = post(
        &app,
        ALPHA,
        &nothing,
        &path,
        json!({ "readings": [{ "id": new_id(), "kind": "pulse", "value": 70 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, error) = post(
        &app,
        ALPHA,
        &owner,
        &path,
        json!({ "readings": [{ "id": VERSION_4, "kind": "pulse", "value": 70 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("readings.id:")
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
async fn a_recording_uploaded_again_with_the_same_id_is_kept_once() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let visit = start_visit(&app, &owner, &patient).await;
    // A note made on the phone, with its own id, and a recording attached to it by that id.
    let note_id = new_id();
    let (status, note) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "id": note_id, "sections": { "subjective": "Dictated" } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    let audio = webm();
    let id = new_id();
    let fields = [
        ("id", id.as_str()),
        ("kind", "audio"),
        ("visit_id", visit.as_str()),
        ("note_id", note_id.as_str()),
        ("duration_seconds", "12"),
        ("language", "en-IN"),
    ];
    let (status, first) = app.upload(ALPHA, &owner, &patient, &audio, &fields).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["id"], id);
    assert_eq!(first["note_id"], note_id);
    let alpha = app.clinic_id("alpha").await;
    let stored = app.files_dir.join(alpha.to_string()).join(&id);
    assert_eq!(std::fs::read(&stored).unwrap(), audio);

    // A retry returns the same record, even after the note was signed, and stores nothing new.
    let (status, again) = app.upload(ALPHA, &owner, &patient, &audio, &fields).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again, first);
    let sign = format!("/api/v1/notes/{note_id}/sign");
    assert_eq!(
        post(&app, ALPHA, &owner, &sign, json!({})).await.0,
        StatusCode::OK
    );
    let (status, late) = app.upload(ALPHA, &owner, &patient, &audio, &fields).await;
    assert_eq!(status, StatusCode::CREATED, "{late}");
    assert_eq!(late, first);
    assert_eq!(rows(&app, "attachments", &id).await, 1);

    // Other bytes or other details under the same id are refused, and the first file survives.
    let mut other = webm();
    other.push(1);
    let answer = app.upload(ALPHA, &owner, &patient, &other, &fields).await;
    assert_id_conflict(&answer, "other bytes");
    assert_eq!(
        std::fs::read(&stored).unwrap(),
        audio,
        "the first file was kept"
    );
    let longer = [
        ("id", id.as_str()),
        ("kind", "audio"),
        ("visit_id", visit.as_str()),
        ("note_id", note_id.as_str()),
        ("duration_seconds", "30"),
        ("language", "en-IN"),
    ];
    let answer = app.upload(ALPHA, &owner, &patient, &audio, &longer).await;
    assert_id_conflict(&answer, "other length");
    let answer = app
        .upload(
            ALPHA,
            &owner,
            &patient,
            &audio,
            &[
                ("id", id.as_str()),
                ("kind", "audio"),
                ("duration_seconds", "12"),
                ("language", "en-IN"),
            ],
        )
        .await;
    assert_id_conflict(&answer, "no note");
    assert_eq!(
        std::fs::read(&stored).unwrap(),
        audio,
        "the first file was kept"
    );
    assert_eq!(rows(&app, "attachments", &id).await, 1);

    // An id must be a version 7 UUID.
    for bad in ["not-an-id", VERSION_4] {
        let (status, error) = app
            .upload(
                ALPHA,
                &owner,
                &patient,
                &audio,
                &[("id", bad), ("kind", "audio"), ("duration_seconds", "12")],
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {error}");
    }

    // Another clinic may use the same id for a file of its own, kept apart from Alpha's.
    let beta_patient = register(&app, BETA, &beta_owner, "Bina Patient").await;
    let (status, theirs) = app
        .upload(
            BETA,
            &beta_owner,
            &beta_patient,
            &other,
            &[
                ("id", id.as_str()),
                ("kind", "audio"),
                ("duration_seconds", "5"),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{theirs}");
    assert_eq!(rows(&app, "attachments", &id).await, 2);
    let beta = app.clinic_id("beta").await;
    assert_eq!(
        std::fs::read(app.files_dir.join(beta.to_string()).join(&id)).unwrap(),
        other
    );
    assert_eq!(std::fs::read(&stored).unwrap(), audio);
    // Alpha's patient and note are not Beta's to attach to, with or without an id.
    let answer = app
        .upload(
            BETA,
            &beta_owner,
            &patient,
            &audio,
            &[
                ("id", new_id().as_str()),
                ("kind", "audio"),
                ("duration_seconds", "5"),
            ],
        )
        .await;
    assert_eq!(answer.0, StatusCode::NOT_FOUND);

    // Uploading needs clinical.write.
    let fresh = new_id();
    let answer = app
        .upload(
            ALPHA,
            &assistant,
            &patient,
            &audio,
            &[
                ("id", fresh.as_str()),
                ("kind", "audio"),
                ("duration_seconds", "5"),
            ],
        )
        .await;
    assert_eq!(answer.0, StatusCode::FORBIDDEN);
    assert_eq!(rows(&app, "attachments", &fresh).await, 0);
    app.finish().await;
}
