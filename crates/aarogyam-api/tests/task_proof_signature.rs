//! A consent can carry the patient's signature (a `consent` file of the same patient), and a
//! task occurrence can carry a proof photo that only its people and task managers may read.
//! Another clinic's files and occurrences are 404.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime};
use tower::ServiceExt as _;
use uuid::Uuid;

const BOUNDARY: &str = "aarogyam-g4g10-boundary";
const JPEG: [u8; 4] = [0xFF, 0xD8, 0xFF, 0xE0];
const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn multipart(parts: &[(&str, &[u8])]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, bytes) in parts {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"x\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    body
}

/// A raw request: the status, the content type and the body bytes.
async fn raw(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: &str,
    body: Option<Vec<u8>>,
) -> (StatusCode, Option<String>, Vec<u8>) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", host)
        .header("authorization", format!("Bearer {token}"));
    if body.is_some() {
        request = request.header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        );
    }
    let request = request
        .body(body.map_or_else(Body::empty, Body::from))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let mime = response
        .headers()
        .get("content-type")
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, mime, bytes.to_vec())
}

fn json_of(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap_or(Value::Null)
}

async fn patient(app: &TestApp, host: &str, token: &str) -> String {
    let (status, body) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": "Meera Shah" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn attach(app: &TestApp, host: &str, token: &str, patient: &str, kind: &str) -> String {
    let mut file = JPEG.to_vec();
    file.extend_from_slice(&[3_u8; 256]);
    let body = multipart(&[("kind", kind.as_bytes()), ("file", &file)]);
    let (status, _, bytes) = raw(
        app,
        Method::POST,
        host,
        &format!("/api/v1/patients/{patient}/attachments"),
        token,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{}", json_of(&bytes));
    json_of(&bytes)["id"].as_str().unwrap().to_owned()
}

async fn consent(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    signature: Option<&str>,
) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        &format!("/api/v1/patients/{patient}/consents"),
        Some(token),
        Some(
            json!({ "purpose": "care", "method": "paper", "notice_version": "v1 2026-10",
                     "signature_attachment_id": signature }),
        ),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_consent_keeps_its_signature_file() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let nothing = app.token(ALPHA_NOTHING);
    let beta = app.token(BETA_OWNER);
    let meera = patient(&app, ALPHA, &owner).await;
    let other = patient(&app, ALPHA, &owner).await;
    let signature = attach(&app, ALPHA, &owner, &meera, "consent").await;
    let photo = attach(&app, ALPHA, &owner, &meera, "photo").await;
    let elsewhere = attach(&app, ALPHA, &owner, &other, "consent").await;

    // Wrong kind, another patient's file, an unknown file: 400, 400, 404.
    assert_eq!(
        consent(&app, ALPHA, &owner, &meera, Some(&photo)).await.0,
        StatusCode::BAD_REQUEST
    );
    let (status, body) = consent(&app, ALPHA, &owner, &meera, Some(&elsewhere)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body.to_string().contains("signature_attachment_id"),
        "{body}"
    );
    assert_eq!(
        consent(
            &app,
            ALPHA,
            &owner,
            &meera,
            Some(&Uuid::new_v4().to_string())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        consent(&app, ALPHA, &nothing, &meera, Some(&signature))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    // Another clinic cannot use this clinic's file or patient.
    let beta_patient = patient(&app, BETA, &beta).await;
    assert_eq!(
        consent(&app, BETA, &beta, &beta_patient, Some(&signature))
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    let (status, made) = consent(&app, ALPHA, &owner, &meera, Some(&signature)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    assert_eq!(made["signature_attachment_id"], signature.as_str());
    let (_, list) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{meera}/consents"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(
        list["items"][0]["signature_attachment_id"],
        signature.as_str()
    );
    // Without a signature the field is null.
    let (status, plain) = consent(&app, ALPHA, &owner, &other, None).await;
    assert_eq!(status, StatusCode::CREATED, "{plain}");
    assert!(plain["signature_attachment_id"].is_null());

    // The database refuses a wrong kind even when the API is bypassed.
    let clinic = app.clinic_id("alpha").await;
    let refused = sqlx::query(
        "insert into aarogyam.patient_consents
           (org_id, patient_id, purpose, notice_version, method, recorded_by, signature_attachment_id)
         select $1, $2, 'research', 'v1', 'paper', m.id, $3 from aarogyam.memberships m
         where m.org_id = $1 limit 1",
    )
    .bind(clinic)
    .bind(meera.parse::<Uuid>().unwrap())
    .bind(photo.parse::<Uuid>().unwrap())
    .execute(&app.owner)
    .await;
    assert!(refused.is_err());
}

async fn role(app: &TestApp, clinic: Uuid, key: &str) -> Uuid {
    sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = $2")
        .bind(clinic)
        .bind(key)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

async fn occurrence(app: &TestApp, clinic: Uuid, template: Uuid, role_id: Uuid) -> Uuid {
    let due = OffsetDateTime::now_utc() - Duration::hours(1);
    sqlx::query_scalar(
        "insert into aarogyam.task_occurrences
           (org_id, template_id, title, action, assignee_role_id, local_date, due_at)
         values ($1, $2, 'Close up', 'none', $3,
                 (select ($4 at time zone o.timezone)::date from aarogyam.organizations o
                  where o.id = $1), $4) returning id",
    )
    .bind(clinic)
    .bind(template)
    .bind(role_id)
    .bind(due)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn a_task_keeps_its_proof_photo_for_its_people_and_managers() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let nothing = app.token(ALPHA_NOTHING);
    let beta = app.token(BETA_OWNER);
    let desk_role = role(&app, clinic, "front_desk").await;
    let (status, task) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/tasks",
            Some(&owner),
            Some(
                json!({ "title": "Lock up", "assignee_role_id": desk_role, "action": "none",
                         "schedule": { "kind": "daily", "due_time": "19:45" } }),
            ),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let template: Uuid = task["id"].as_str().unwrap().parse().unwrap();
    let occ = occurrence(&app, clinic, template, desk_role).await;
    let proof = format!("/api/v1/tasks/occurrences/{occ}/proof");
    let complete = format!("/api/v1/tasks/occurrences/{occ}/complete");
    let mut png = PNG.to_vec();
    png.extend_from_slice(&[1_u8; 64]);
    let form = |bytes: &[u8]| Some(multipart(&[("file", bytes)]));

    // Nothing to read yet.
    let (status, ..) = raw(&app, Method::GET, ALPHA, &proof, &owner, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Permission: no tasks.use is 403; a member of another role is 403; another clinic is 404.
    for token in [&nothing, &assistant] {
        let (status, ..) = raw(&app, Method::POST, ALPHA, &proof, token, form(&png)).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, ..) = raw(&app, Method::POST, BETA, &proof, &beta, form(&png)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Not an image, or no file.
    let (status, ..) = raw(&app, Method::POST, ALPHA, &proof, &desk, form(b"hello")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, ..) = raw(
        &app,
        Method::POST,
        ALPHA,
        &proof,
        &desk,
        Some(multipart(&[("other", &png)])),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Completing with a proof that was never uploaded is a 400 and the task stays open.
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            &complete,
            Some(&desk),
            Some(json!({ "proof_file_id": Uuid::new_v4() })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body.to_string().contains("proof_file_id"), "{body}");

    let (status, _, bytes) = raw(&app, Method::POST, ALPHA, &proof, &desk, form(&png)).await;
    assert_eq!(status, StatusCode::OK, "{}", json_of(&bytes));
    let file_id = json_of(&bytes)["proof_file_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, listed) = app
        .send(Method::GET, ALPHA, "/api/v1/tasks/mine", Some(&desk), None)
        .await;
    assert_eq!(listed["items"][0]["has_proof"], true, "{listed}");

    // A replacement changes the id; the old one no longer completes.
    let (status, _, bytes) = raw(&app, Method::POST, ALPHA, &proof, &desk, form(&png)).await;
    assert_eq!(status, StatusCode::OK);
    let newest = json_of(&bytes)["proof_file_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(newest, file_id);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &complete,
            Some(&desk),
            Some(json!({ "proof_file_id": file_id })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, done) = app
        .send(
            Method::POST,
            ALPHA,
            &complete,
            Some(&desk),
            Some(json!({ "proof_file_id": newest })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["status"], "done");
    assert_eq!(done["has_proof"], true);

    // Who may read it: the person, a manager; not another role, not no-permission, not another
    // clinic.
    for token in [&desk, &owner] {
        let (status, kind, bytes) = raw(&app, Method::GET, ALPHA, &proof, token, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(kind.as_deref(), Some("image/png"));
        assert_eq!(bytes, png);
    }
    for (token, want) in [
        (&assistant, StatusCode::FORBIDDEN),
        (&nothing, StatusCode::FORBIDDEN),
    ] {
        let (status, ..) = raw(&app, Method::GET, ALPHA, &proof, token, None).await;
        assert_eq!(status, want);
    }
    let (status, ..) = raw(&app, Method::GET, BETA, &proof, &beta, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
