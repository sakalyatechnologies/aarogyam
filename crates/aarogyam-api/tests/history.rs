//! `GET /patients/{id}/history`: the full-page history's visit cards.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::{ALPHA_ASSISTANT, ALPHA_FRONT_DESK, ALPHA_OWNER, BETA_OWNER};
use support::{ALPHA, BETA, TestApp, send_with_headers};
use uuid::{Uuid, uuid};

const DOCTOR: Uuid = uuid!("a0000000-0000-4000-8000-0000000000dc");

async fn post(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn history(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    query: &str,
) -> (StatusCode, Value) {
    app.send(
        Method::GET,
        host,
        &format!("/api/v1/patients/{patient}/history{query}"),
        Some(token),
        None,
    )
    .await
}

/// A patient with one visit holding a signed note, a chart entry, a procedure, an X-ray, a
/// prescription written during the visit (no visit link), an issued bill and a plan; and a file
/// outside any visit. Returns (patient, visit).
#[expect(clippy::too_many_lines, reason = "one record of each kind, in order")]
async fn rich_patient(app: &TestApp, owner: &str) -> (String, String) {
    let patient = post(
        app,
        owner,
        "/api/v1/patients",
        json!({ "full_name": "Meera Shah" }),
    )
    .await;
    let patient = patient["id"].as_str().unwrap().to_owned();
    let visit = post(
        app,
        owner,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Pain lower left" }),
    )
    .await;
    let visit = visit["id"].as_str().unwrap().to_owned();
    let note = post(
        app,
        owner,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "subjective": "[09:41] Pain on biting since a week\nCold hurts", "assessment": "Deep caries 36" } }),
    )
    .await;
    let note = note["id"].as_str().unwrap();
    post(app, owner, &format!("/api/v1/notes/{note}/sign"), json!({})).await;
    // A draft never reaches the card.
    post(
        app,
        owner,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "plan": "draft words" } }),
    )
    .await;
    post(
        app,
        owner,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        json!({ "visit_id": visit, "entries": [{ "tooth": 26, "finding": "caries" }] }),
    )
    .await;
    post(
        app,
        owner,
        &format!("/api/v1/visits/{visit}/procedures"),
        json!({ "name": "Root canal treatment", "tooth": 36, "price_paise": 450_000 }),
    )
    .await;
    let (status, xray) = app
        .upload(
            ALPHA,
            owner,
            &patient,
            &PNG,
            &[
                ("visit_id", visit.as_str()),
                ("label", "X-ray"),
                ("kind", "xray"),
            ],
        )
        .await;
    assert!(status.is_success(), "{xray}");
    let (status, loose) = app
        .upload(
            ALPHA,
            owner,
            &patient,
            b"%PDF-1.7\n%%EOF",
            &[("label", "Report")],
        )
        .await;
    assert!(status.is_success(), "{loose}");
    post(
        app,
        owner,
        &format!("/api/v1/patients/{patient}/prescriptions"),
        json!({ "items": [{ "drug_name": "Chlorhexidine mouthwash", "dose": "10 ml", "frequency": "1-0-1" }] }),
    )
    .await;
    let bill = post(
        app,
        owner,
        "/api/v1/invoices",
        json!({ "patient_id": patient, "encounter_id": visit, "items": [
            { "description": "Consultation", "unit_price_paise": 50_000 }
        ] }),
    )
    .await;
    let bill = bill["id"].as_str().unwrap();
    post(
        app,
        owner,
        &format!("/api/v1/invoices/{bill}/issue"),
        json!({}),
    )
    .await;
    post(
        app,
        owner,
        &format!("/api/v1/patients/{patient}/treatment-plans"),
        json!({ "title": "Lower left molar", "visit_id": visit, "items": [
            { "name": "Root canal treatment", "tooth": 36, "estimate_paise": 450_000 }
        ] }),
    )
    .await;
    (patient, visit)
}

/// A 1×1 PNG.
const PNG: [u8; 67] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
];

/// Copies `visit` into `count` older closed visits; pairs share a start time so the cursor's
/// tie-break is exercised.
async fn older_visits(app: &TestApp, visit: &str, count: i32) {
    sqlx::query(
        "insert into aarogyam.encounters
           (org_id, number, patient_id, clinician_id, branch_id, status, started_at, ended_at, created_by)
         select e.org_id, 'V-' || (1000 + g), e.patient_id, e.clinician_id, e.branch_id, 'closed',
                e.started_at - make_interval(days => (g + 1) / 2),
                e.started_at - make_interval(days => (g + 1) / 2) + interval '1 hour', e.created_by
         from aarogyam.encounters e, generate_series(1, $2) g where e.id = $1::uuid",
    )
    .bind(visit)
    .bind(count)
    .execute(&app.owner)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_history_shows_rich_cards_and_writes_the_access_record() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, visit) = rich_patient(&app, &owner).await;

    let (status, headers, page) = app
        .send_full(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/history"),
            Some(&owner),
            None,
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(headers["cache-control"], "no-store");
    assert!(page.get("next_cursor").is_none(), "{page}");
    let card = &page["visits"][0];
    assert_eq!(card["id"], visit.as_str());
    assert_eq!(card["status"], "open");
    assert_eq!(card["chief_complaint"], "Pain lower left");
    assert_eq!(card["clinician"]["name"], "Asha Owner");
    assert_eq!(card["note_first_line"], "Pain on biting since a week");
    assert_eq!(card["counts"]["notes"], 1, "drafts don't count");
    assert_eq!(card["counts"]["procedures"], 1);
    let teeth: Vec<(u64, &str)> = card["teeth"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| (t["tooth"].as_u64().unwrap(), t["work"].as_str().unwrap()))
        .collect();
    assert_eq!(teeth, [(26, "found"), (36, "done")]);
    assert_eq!(card["teeth"][0]["finding"], "caries");
    assert_eq!(card["teeth"][1]["label"], "Root canal treatment");
    assert_eq!(card["image_count"], 1);
    assert_eq!(card["images"][0]["mime_type"], "image/png");
    assert_eq!(card["medicines"], json!(["CHLORHEXIDINE MOUTHWASH"]));
    assert_eq!(card["bills"][0]["status"], "issued");
    assert_eq!(card["bills"][0]["total_paise"], 50_000);
    assert_eq!(card["bills"][0]["paid_paise"], 0);
    assert_eq!(card["plans"][0]["title"], "Lower left molar");
    assert_eq!(card["plans"][0]["status"], "proposed");
    assert_eq!(page["loose_files"].as_array().unwrap().len(), 1);
    assert_eq!(page["loose_files"][0]["label"], "Report");

    let logged: i64 = sqlx::query_scalar(
        "select count(*) from audit.access_log
         where patient_id = $1::uuid and resource = 'chart' and action = 'view'",
    )
    .bind(&patient)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(logged, 1);

    // The assistant reads the record but not money: no bills at all.
    let (status, page) = history(&app, ALPHA, &app.token(ALPHA_ASSISTANT), &patient, "").await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert!(page["visits"][0].get("bills").is_none(), "{page}");
    assert_eq!(
        page["visits"][0]["medicines"],
        json!(["CHLORHEXIDINE MOUTHWASH"])
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_history_needs_clinical_read_and_stays_in_its_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, _) = rich_patient(&app, &owner).await;
    let (status, _) = history(&app, ALPHA, &app.token(ALPHA_FRONT_DESK), &patient, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = history(&app, BETA, &app.token(BETA_OWNER), &patient, "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = history(&app, ALPHA, &owner, &Uuid::now_v7().to_string(), "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for bad in [
        "?before=yesterday",
        "?before=12~nope",
        "?limit=0",
        "?limit=201",
    ] {
        let (status, _) = history(&app, ALPHA, &owner, &patient, bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_long_history_pages_by_cursor_with_ties_and_no_query_per_visit() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, visit) = rich_patient(&app, &owner).await;

    // Statements for one visit...
    let (db, trips) = app.counting_db().await;
    let router = app.router_on(db);
    let uri = format!("/api/v1/patients/{patient}/history");
    let count = async || {
        let mark = trips.mark();
        let (status, body) =
            send_with_headers(&router, Method::GET, ALPHA, &uri, Some(&owner), None, &[]).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        (trips.counts_since(mark).statements, body)
    };
    count().await;
    let (one, _) = count().await;
    // ...are the statements for a hundred.
    older_visits(&app, &visit, 99).await;
    let (hundred, page) = count().await;
    assert_eq!(page["visits"].as_array().unwrap().len(), 100);
    assert_eq!(one, hundred, "a statement per visit crept in");

    // Pages of 7 walk every visit once, ties included, newest first.
    let mut seen: Vec<String> = Vec::new();
    let mut query = "?limit=7".to_owned();
    loop {
        let (status, page) = history(&app, ALPHA, &owner, &patient, &query).await;
        assert_eq!(status, StatusCode::OK, "{page}");
        let visits = page["visits"].as_array().unwrap();
        seen.extend(visits.iter().map(|v| v["id"].as_str().unwrap().to_owned()));
        if seen.len() > 7 {
            assert!(
                page["loose_files"].as_array().unwrap().is_empty(),
                "loose files on page 1 only"
            );
        }
        match page.get("next_cursor").and_then(Value::as_str) {
            Some(cursor) => query = format!("?limit=7&before={cursor}"),
            None => break,
        }
    }
    let all: Vec<String> = page["visits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(seen, all);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn own_reach_sees_only_its_own_visits() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (patient, _) = rich_patient(&app, &owner).await;
    sqlx::query(
        "with u as (insert into aarogyam.users (auth_uid, display_name, email)
                    values ($1, 'Dev Doctor', 'dev@alpha.test') returning id)
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, u.id, r.id, 'active' from aarogyam.organizations o, u, aarogyam.roles r
         where o.slug = 'alpha' and r.org_id = o.id and r.key = 'doctor'",
    )
    .bind(DOCTOR)
    .execute(&app.owner)
    .await
    .unwrap();
    let doctor = app.token(DOCTOR);
    // The owner's visit is closed, then the doctor sees the patient in a visit of their own.
    let (_, page) = history(&app, ALPHA, &owner, &patient, "").await;
    let theirs = page["visits"][0]["id"].as_str().unwrap().to_owned();
    post(
        &app,
        &owner,
        &format!("/api/v1/visits/{theirs}/close"),
        json!({}),
    )
    .await;
    let mine = post(
        &app,
        &doctor,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({}),
    )
    .await;
    let mine = mine["id"].as_str().unwrap();

    let (_, role) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/roles/doctor",
            Some(&owner),
            None,
        )
        .await;
    let permissions: Vec<Value> = role["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|grant| {
            let key = grant["key"].as_str().unwrap();
            let scope = if key == "clinical.read" { "own" } else { "all" };
            json!({ "key": key, "scope": scope })
        })
        .collect();
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            "/api/v1/roles/doctor/permissions",
            Some(&owner),
            Some(json!({ "permissions": permissions })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, page) = history(&app, ALPHA, &doctor, &patient, "").await;
    assert_eq!(status, StatusCode::OK, "{page}");
    let ids: Vec<&str> = page["visits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [mine]);
    assert!(page["loose_files"].as_array().unwrap().is_empty(), "{page}");
    app.finish().await;
}
