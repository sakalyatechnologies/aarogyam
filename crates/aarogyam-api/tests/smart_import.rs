//! Smart import on a real database: a clinic's own Excel or CSV file mapped automatically,
//! previewed, imported once, duplicates merged or skipped, and the to-do list of patients
//! imported without some details. Also each route's round trips.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use std::collections::BTreeMap;
use std::fmt::Write as _;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use sakalya_db::{DbError, Scope};
use sakalya_testkit::{PgRoundTrips, TripCounts};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt as _;

const WORKBOOK: &[u8] = include_bytes!("../../aarogyam-app/testdata/patients.xlsx");
const BOUNDARY: &str = "aarogyam-import-boundary";

/// A multipart upload of `bytes` as `name`, with an optional sheet.
fn upload_request(
    host: &str,
    token: &str,
    name: &str,
    bytes: &[u8],
    sheet: Option<&str>,
) -> Request<Body> {
    let mut body = Vec::new();
    if let Some(sheet) = sheet {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"sheet\"\r\n\r\n{sheet}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    Request::post("/api/v1/imports/sessions")
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap()
}

type Make = Box<dyn Fn() -> Request<Body>>;

async fn call(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn upload(
    app: &TestApp,
    host: &str,
    token: &str,
    name: &str,
    bytes: &[u8],
    sheet: Option<&str>,
) -> (StatusCode, Value) {
    call(&app.router, upload_request(host, token, name, bytes, sheet)).await
}

/// The suggested mapping as the clinic would accept it: field to column.
fn accepted(session: &Value) -> Value {
    let mapping: BTreeMap<String, Value> = session["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| Some((s["field"].as_str()?.to_owned(), s["column"].clone())))
        .collect();
    json!(mapping)
}

async fn register(app: &TestApp, token: &str, body: Value) -> (String, String) {
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    (
        patient["id"].as_str().unwrap().to_owned(),
        patient["number"].as_str().unwrap().to_owned(),
    )
}

async fn count(app: &TestApp, sql: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one import from upload to the to-do list"
)]
async fn a_spreadsheet_is_mapped_previewed_and_imported_once() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let (ravi, ravi_number) = register(
        &app,
        &desk,
        json!({ "full_name": "Ravi Kumar", "phone": "9876543211" }),
    )
    .await;

    let (status, session) = upload(
        &app,
        ALPHA,
        &desk,
        "C:\\desk\\patients.xlsx",
        WORKBOOK,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{session}");
    assert_eq!(session["file_name"], "patients.xlsx");
    assert_eq!(session["kind"], "xlsx");
    assert_eq!(session["sheets"], json!(["Patients", "Old"]));
    assert_eq!(session["header_row"], 3);
    assert_eq!(session["row_count"], 4);
    let fields: Vec<Value> = session["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["field"].clone())
        .collect();
    assert_eq!(
        fields,
        [
            Value::Null,
            json!("full_name"),
            json!("phone"),
            json!("sex"),
            json!("date_of_birth"),
            json!("address"),
            json!("last_visit"),
            json!("balance")
        ]
    );
    assert_eq!(session["suggestions"][2]["basis"], "header_and_values");
    assert_eq!(
        session["sample"][0][2], "9876543210",
        "the desk may see phones"
    );
    let id = session["id"].as_str().unwrap().to_owned();
    let mapping = accepted(&session);
    let preview_path = format!("/api/v1/imports/sessions/{id}/preview");
    let commit_path = format!("/api/v1/imports/sessions/{id}/commit");
    let patients_before = count(&app, "select count(*) from aarogyam.patients").await;

    let (status, preview) = app
        .send(
            Method::POST,
            ALPHA,
            &preview_path,
            Some(&desk),
            Some(json!({ "mapping": mapping })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let actions: Vec<&str> = preview["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["action"].as_str().unwrap())
        .collect();
    assert_eq!(actions, ["import", "skip", "import", "fail"]);
    assert_eq!(
        (
            preview["imported"].as_u64(),
            preview["incomplete"].as_u64(),
            preview["skipped"].as_u64(),
            preview["failed"].as_u64()
        ),
        (Some(2), Some(1), Some(1), Some(1))
    );
    let rows = preview["rows"].as_array().unwrap();
    assert_eq!(rows[0]["row"], 4);
    assert_eq!(rows[0]["values"]["date_of_birth"], "1990-04-12");
    assert_eq!(rows[0]["values"]["phone"], "+919876543210");
    assert_eq!(rows[0]["missing"], json!([]));
    assert_eq!(rows[1]["duplicate_of"]["number"], ravi_number.as_str());
    assert_eq!(rows[2]["missing"], json!(["phone", "sex", "date_of_birth"]));
    assert!(
        rows[3]["errors"][0]
            .as_str()
            .unwrap()
            .starts_with("full_name")
    );
    assert!(preview["notes"][0].as_str().unwrap().starts_with("balance"));
    assert_eq!(
        count(&app, "select count(*) from aarogyam.patients").await,
        patients_before,
        "a preview saves nothing"
    );

    // Only patients.write imports; another clinic can't see the session at all.
    let (status, _) = upload(&app, ALPHA, &assistant, "x.csv", b"Name\nA\n", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for path in [&preview_path, &commit_path] {
        let body = Some(json!({ "mapping": mapping }));
        let (status, _) = app
            .send(Method::POST, ALPHA, path, Some(&assistant), body.clone())
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        let (status, _) = app.send(Method::POST, BETA, path, Some(&beta), body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let (status, _) = app
        .send(
            Method::DELETE,
            BETA,
            &format!("/api/v1/imports/sessions/{id}"),
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for (body, field) in [
        (json!({ "mapping": { "phone": 2 } }), "mapping"),
        (
            json!({ "mapping": { "full_name": 1, "phone": 1 } }),
            "mapping",
        ),
        (json!({ "mapping": { "full_name": 99 } }), "mapping"),
        (
            json!({ "mapping": { "blood": 1, "full_name": 1 } }),
            "mapping",
        ),
        (
            json!({ "mapping": mapping, "duplicates": "keep" }),
            "duplicates",
        ),
        (
            json!({ "mapping": mapping, "rows": [{ "row": 4, "choice": "maybe" }] }),
            "rows",
        ),
    ] {
        let (status, error) = app
            .send(Method::POST, ALPHA, &preview_path, Some(&desk), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }

    // Ravi's row merges into his record, filling only what was empty.
    let choices = json!({ "mapping": mapping, "rows": [{ "row": 5, "choice": "merge" }] });
    let (status, commit) = app
        .send(
            Method::POST,
            ALPHA,
            &commit_path,
            Some(&desk),
            Some(choices.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{commit}");
    let actions: Vec<&str> = commit["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["action"].as_str().unwrap())
        .collect();
    assert_eq!(actions, ["imported", "merged", "imported", "failed"]);
    assert_eq!(
        (
            commit["imported"].as_u64(),
            commit["merged"].as_u64(),
            commit["incomplete"].as_u64()
        ),
        (Some(2), Some(1), Some(1))
    );
    assert_eq!(commit["rows"][1]["patient_id"], ravi.as_str());
    assert_eq!(
        commit["rows"][0]["values"],
        json!({}),
        "no values echoed after commit"
    );
    let priya = commit["rows"][0]["patient_id"].as_str().unwrap().to_owned();
    let meera = commit["rows"][2]["patient_id"].as_str().unwrap().to_owned();
    assert_eq!(
        count(&app, "select count(*) from aarogyam.patients").await,
        patients_before + 2
    );
    let (_, opened) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{priya}"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(opened["date_of_birth"], "1990-04-12");
    assert_eq!(opened["sex"], "female");
    let (_, merged) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{ravi}"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(merged["sex"], "male");
    assert_eq!(merged["date_of_birth"], "1985-10-01");
    assert_eq!(merged["full_name"], "Ravi Kumar");

    // Committing again changes nothing and answers the same.
    let (status, again) = app
        .send(
            Method::POST,
            ALPHA,
            &commit_path,
            Some(&desk),
            Some(choices),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["import_id"], commit["import_id"]);
    assert_eq!(again["rows"][0]["number"], commit["rows"][0]["number"]);
    assert_eq!(again["incomplete"], 1);
    assert_eq!(
        count(&app, "select count(*) from aarogyam.patients").await,
        patients_before + 2
    );
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &preview_path,
            Some(&desk),
            Some(json!({ "mapping": mapping })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Each row keeps its file, sheet and row; the session's rows are gone.
    let recorded: (String, String, String, i32, i32, i32, i32, i32) = sqlx::query_as(
        "select source, file_name, sheet_name, total_rows, imported_rows, merged_rows, failed_rows, incomplete_rows
         from aarogyam.imports where session_id is not null",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        recorded,
        (
            "xlsx".into(),
            "patients.xlsx".into(),
            "Patients".into(),
            4,
            2,
            1,
            1,
            1
        )
    );
    let lines: Vec<i32> = sqlx::query_scalar(
        "select r.row_number from aarogyam.import_rows r join aarogyam.imports i on i.id = r.import_id
         where i.session_id is not null order by 1",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(lines, [4, 5, 6, 7]);
    assert_eq!(
        count(&app, "select count(*) from aarogyam.import_sessions where cells is null and status = 'committed'").await,
        1
    );
    assert_eq!(
        count(&app, "select count(*) from audit.audit_events where table_name = 'aarogyam.import_sessions' and (changes::text like '%Priya%')").await,
        0,
        "cells never reach the audit log"
    );

    // The to-do list: Meera lacks three details; filling one leaves two.
    let list = "/api/v1/imports/incomplete";
    let (status, todo) = app
        .send(Method::GET, ALPHA, list, Some(&assistant), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{todo}");
    let items = todo["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["patient_id"], meera.as_str());
    assert_eq!(
        items[0]["missing"],
        json!(["phone", "sex", "date_of_birth"])
    );
    assert_eq!(
        (
            items[0]["file_name"].as_str(),
            items[0]["sheet"].as_str(),
            items[0]["row"].as_u64()
        ),
        (Some("patients.xlsx"), Some("Patients"), Some(6))
    );
    let (_, theirs) = app.send(Method::GET, BETA, list, Some(&beta), None).await;
    assert_eq!(theirs["items"], json!([]));
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/patients/{meera}"),
            Some(&desk),
            Some(json!({ "phone": "9876543299" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, todo) = app.send(Method::GET, ALPHA, list, Some(&desk), None).await;
    assert_eq!(todo["items"][0]["missing"], json!(["sex", "date_of_birth"]));
    let gap = todo["items"][0]["id"].as_str().unwrap().to_owned();
    let dismiss = format!("/api/v1/imports/incomplete/{gap}/dismiss");
    let (status, _) = app
        .send(Method::POST, BETA, &dismiss, Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::POST, ALPHA, &dismiss, Some(&assistant), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for _ in 0..2 {
        let (status, _) = app
            .send(Method::POST, ALPHA, &dismiss, Some(&desk), None)
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    let (_, todo) = app.send(Method::GET, ALPHA, list, Some(&desk), None).await;
    assert_eq!(todo["items"], json!([]));

    // The next file with the same headers maps itself from memory.
    let csv = "Naav,Mobile No.,Patta\nAnil,9876500011,Pune\n";
    let (_, next) = upload(&app, ALPHA, &desk, "next.csv", csv.as_bytes(), None).await;
    assert_eq!(next["suggestions"][2]["basis"], "saved");
    assert_eq!(next["suggestions"][2]["field"], "address");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn files_in_other_shapes_and_ending_a_session() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);

    // Windows-1252, semicolons, a Marathi header: "José" has é as 0xE9.
    let csv = b"Naav;Vay;Ling\r\nJos\xe9 D;42 yrs;Purush\r\n";
    let (status, session) = upload(&app, ALPHA, &desk, "old.csv", csv, None).await;
    assert_eq!(status, StatusCode::CREATED, "{session}");
    assert_eq!(session["kind"], "csv");
    assert_eq!(session["sample"][0][0], "José D");
    let mapping = accepted(&session);
    assert_eq!(mapping, json!({ "full_name": 0, "age_years": 1, "sex": 2 }));
    let id = session["id"].as_str().unwrap().to_owned();
    let (_, preview) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/imports/sessions/{id}/preview"),
            Some(&desk),
            Some(json!({ "mapping": mapping })),
        )
        .await;
    assert_eq!(preview["rows"][0]["missing"], json!(["phone"]));
    assert_eq!(preview["rows"][0]["values"]["sex"], "male");

    let session_path = format!("/api/v1/imports/sessions/{id}");
    let (status, _) = app
        .send(Method::DELETE, BETA, &session_path, Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for _ in 0..2 {
        let (status, _) = app
            .send(Method::DELETE, ALPHA, &session_path, Some(&desk), None)
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{session_path}/commit"),
            Some(&desk),
            Some(json!({ "mapping": mapping })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "a discarded session can't be imported"
    );
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.import_sessions where cells is not null"
        )
        .await,
        0
    );

    // The second sheet, chosen by name.
    let (status, old) = upload(&app, ALPHA, &desk, "patients.xlsx", WORKBOOK, Some("Old")).await;
    assert_eq!(status, StatusCode::CREATED, "{old}");
    assert_eq!(old["sheet"], "Old");
    assert_eq!(old["header_row"], 1);

    for (bytes, sheet, expected) in [
        (Vec::new(), None, StatusCode::BAD_REQUEST),
        (b"Name\n".to_vec(), None, StatusCode::BAD_REQUEST),
        (
            vec![0xd0, 0xcf, 0x11, 0xe0, 0, 0],
            None,
            StatusCode::BAD_REQUEST,
        ),
        (WORKBOOK.to_vec(), Some("Nope"), StatusCode::BAD_REQUEST),
        (
            vec![b'a'; 5 * 1024 * 1024 + 1],
            None,
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
    ] {
        let (status, error) = upload(&app, ALPHA, &desk, "bad", &bytes, sheet).await;
        assert_eq!(status, expected, "{error}");
    }
    // Expired sessions are ended (and their rows cleared) when the clinic next uploads.
    sqlx::query("update aarogyam.import_sessions set expires_at = now() - interval '1 minute' where sheet_name = 'Old'")
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!(
                "/api/v1/imports/sessions/{}/preview",
                old["id"].as_str().unwrap()
            ),
            Some(&desk),
            Some(json!({ "mapping": { "full_name": 0 } })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    upload(&app, ALPHA, &desk, "x.csv", b"Name\nA\n", None).await;
    assert_eq!(count(&app, "select count(*) from aarogyam.import_sessions where status = 'expired' and cells is null").await, 1);
    app.finish().await;
}

/// Row-level security hides one clinic's import sessions, remembered headers and to-do list
/// from another, even in a direct query.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn import_tables_isolate_clinics() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, session) = upload(&app, ALPHA, &desk, "a.csv", b"Name,Mobile\nAsha,\n", None).await;
    let id = session["id"].as_str().unwrap();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/imports/sessions/{id}/commit"),
            Some(&desk),
            Some(json!({ "mapping": { "full_name": 0, "phone": 1 } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (alpha, beta) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();
    for table in ["import_sessions", "import_column_memory", "patient_gaps"] {
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

/// One request's statement round trips, after background release checks settle.
async fn trips_of(router: &Router, trips: &PgRoundTrips, request: Request<Body>) -> TripCounts {
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let mark = trips.mark();
    let (status, body) = call(router, request).await;
    assert!(status.is_success(), "{status} {body}");
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    trips.counts_since(mark)
}

fn json_request(method: Method, path: &str, token: &str, body: Option<Value>) -> Request<Body> {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", ALPHA)
        .header("authorization", format!("Bearer {token}"));
    match body {
        Some(body) => request
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => request.body(Body::empty()).unwrap(),
    }
}

/// The import routes' round trips. Budgets, warm (cold has one more for the host and
/// permissions): upload 3 (begin, one statement that opens the session, ends expired ones and
/// reads remembered headers, commit); preview 4 (the session, then existing matches); a first
/// commit 9 (lock, matches, numbers, patients, merges, identifiers, one statement for the
/// import, rows, to-do list, memory and session); a repeated commit 4; the to-do list,
/// dismissing and discarding 3.
#[tokio::test]
#[ignore = "needs Postgres: DATABASE_URL=postgres://localhost:5432/postgres"]
#[expect(
    clippy::too_many_lines,
    reason = "one entry per route; splitting hides the budgets"
)]
async fn import_routes_stay_within_their_round_trip_budget() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let csv = b"Name,Mobile,Old ID\nAsha Rao,9876543210,P-1\nRavi,,P-2\n".to_vec();
    let mapping = json!({ "mapping": { "full_name": 0, "phone": 1, "legacy_id": 2 } });
    let (db, trips) = app.counting_db().await;
    let warmer = app.router_on(db.clone());
    let new_session = async || -> String {
        let (_, session) = call(&warmer, upload_request(ALPHA, &desk, "a.csv", &csv, None)).await;
        session["id"].as_str().unwrap().to_owned()
    };
    let committed = new_session().await;
    let (_, done) = call(
        &warmer,
        json_request(
            Method::POST,
            &format!("/api/v1/imports/sessions/{committed}/commit"),
            &desk,
            Some(mapping.clone()),
        ),
    )
    .await;
    assert!(done["import_id"].is_string(), "{done}");
    let (_, todo) = call(
        &warmer,
        json_request(Method::GET, "/api/v1/imports/incomplete", &desk, None),
    )
    .await;
    let gap = todo["items"][0]["id"].as_str().unwrap().to_owned();
    let open = new_session().await;

    let routes: Vec<(&str, Make, usize)> = vec![
        (
            "POST /imports/sessions",
            Box::new({
                let (desk, csv) = (desk.clone(), csv.clone());
                move || upload_request(ALPHA, &desk, "a.csv", &csv, None)
            }),
            3,
        ),
        (
            "POST preview",
            Box::new({
                let (desk, m, open) = (desk.clone(), mapping.clone(), open.clone());
                move || {
                    json_request(
                        Method::POST,
                        &format!("/api/v1/imports/sessions/{open}/preview"),
                        &desk,
                        Some(m.clone()),
                    )
                }
            }),
            4,
        ),
        (
            "POST commit (again)",
            Box::new({
                let (desk, m, c) = (desk.clone(), mapping.clone(), committed.clone());
                move || {
                    json_request(
                        Method::POST,
                        &format!("/api/v1/imports/sessions/{c}/commit"),
                        &desk,
                        Some(m.clone()),
                    )
                }
            }),
            4,
        ),
        (
            "GET /imports/incomplete",
            Box::new({
                let desk = desk.clone();
                move || json_request(Method::GET, "/api/v1/imports/incomplete", &desk, None)
            }),
            3,
        ),
        (
            "POST dismiss",
            Box::new({
                let (desk, gap) = (desk.clone(), gap.clone());
                move || {
                    json_request(
                        Method::POST,
                        &format!("/api/v1/imports/incomplete/{gap}/dismiss"),
                        &desk,
                        None,
                    )
                }
            }),
            3,
        ),
        (
            "DELETE session",
            Box::new({
                let (desk, open) = (desk.clone(), open.clone());
                move || {
                    json_request(
                        Method::DELETE,
                        &format!("/api/v1/imports/sessions/{open}"),
                        &desk,
                        None,
                    )
                }
            }),
            3,
        ),
    ];
    let mut table = String::from("\nroute                     cold  warm\n");
    let mut over = Vec::new();
    for (name, make, budget) in &routes {
        for _ in 0..3 {
            trips_of(&warmer, &trips, make()).await;
        }
        let fresh = app.router_on(db.clone());
        let cold = trips_of(&fresh, &trips, make()).await;
        let warm = trips_of(&fresh, &trips, make()).await;
        writeln!(
            table,
            "{name:<26}{:>4}  {:>4}",
            cold.statements, warm.statements
        )
        .unwrap();
        if warm.statements > *budget || cold.statements > budget + 1 {
            over.push(*name);
        }
    }
    // A first commit, once: it can't be repeated.
    let first = new_session().await;
    let commit = trips_of(
        &warmer,
        &trips,
        json_request(
            Method::POST,
            &format!("/api/v1/imports/sessions/{first}/commit"),
            &desk,
            Some(mapping.clone()),
        ),
    )
    .await;
    writeln!(
        table,
        "{:<26}{:>4}",
        "POST commit (first)", commit.statements
    )
    .unwrap();
    if commit.statements > 9 {
        over.push("POST commit (first)");
    }
    println!("{table}");
    app.finish().await;
    assert!(over.is_empty(), "over budget: {over:?}{table}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patients_registered_without_an_age_or_sex_are_on_the_to_do_list() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let list = "/api/v1/imports/incomplete";
    let (no_age, _) = register(
        &app,
        &owner,
        json!({ "full_name": "Kavya Rao", "sex": "female" }),
    )
    .await;
    let (bare, _) = register(&app, &owner, json!({ "full_name": "Om Joshi" })).await;
    register(
        &app,
        &owner,
        json!({ "full_name": "Ira Sen", "sex": "female", "age_years": 40 }),
    )
    .await;

    let (status, todo) = app.send(Method::GET, ALPHA, list, Some(&owner), None).await;
    assert_eq!(status, StatusCode::OK, "{todo}");
    let items = todo["items"].as_array().unwrap();
    let missing: Vec<(&str, &Value)> = items
        .iter()
        .map(|item| (item["patient_id"].as_str().unwrap(), &item["missing"]))
        .collect();
    assert_eq!(
        missing,
        [
            (no_age.as_str(), &json!(["date_of_birth"])),
            (bare.as_str(), &json!(["sex", "date_of_birth"]))
        ]
    );
    // Not imported: nothing to dismiss, no file row.
    assert_eq!(items[0]["id"], Value::Null);
    assert_eq!(items[0]["row"], Value::Null);
    assert_eq!(items[0]["imported_at"], Value::Null);

    // Giving an age takes them off; another clinic sees none of them.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/patients/{no_age}"),
            Some(&owner),
            Some(json!({ "age_years": 31 })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, todo) = app.send(Method::GET, ALPHA, list, Some(&owner), None).await;
    assert_eq!(todo["items"].as_array().unwrap().len(), 1);
    let beta = app.token(BETA_OWNER);
    let (_, theirs) = app.send(Method::GET, BETA, list, Some(&beta), None).await;
    assert_eq!(theirs["items"], json!([]));
    app.finish().await;
}
