//! Permission scopes: a role narrowed to `own` reaches only the member's own patients and
//! records, and gets `404` for a colleague's, as for another clinic's. At `all` it reaches both;
//! the front desk, at `all`, is unaffected.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::{ALPHA_FRONT_DESK, ALPHA_OWNER};
use support::{ALPHA, TestApp};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime, UtcOffset};
use uuid::{Uuid, uuid};

const DOCTOR_A: Uuid = uuid!("a0000000-0000-4000-8000-0000000000da");
const DOCTOR_B: Uuid = uuid!("a0000000-0000-4000-8000-0000000000db");

/// Adds a doctor to Alpha with a sign-in, and their practitioner record. Returns the
/// practitioner id.
async fn doctor(app: &TestApp, owner: &str, auth_uid: Uuid, name: &str) -> String {
    let membership: Uuid = sqlx::query_scalar(
        "with u as (insert into aarogyam.users (auth_uid, display_name, email)
                    values ($1, $2, $1::text || '@alpha.test') returning id)
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, u.id, r.id, 'active' from aarogyam.organizations o, u, aarogyam.roles r
         where o.slug = 'alpha' and r.org_id = o.id and r.key = 'doctor'
         returning id",
    )
    .bind(auth_uid)
    .bind(name)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    created(
        app,
        owner,
        "/api/v1/practitioners",
        json!({ "display_name": name, "membership_id": membership }),
    )
    .await
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> String {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value["id"]
        .as_str()
        .or_else(|| value["appointment"]["id"].as_str())
        .unwrap()
        .to_owned()
}

/// Sets every scopable permission of the doctor role to `scope`.
async fn narrow_doctors(app: &TestApp, owner: &str, scope: &str) {
    let (status, role) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/roles/doctor",
            Some(owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{role}");
    let scopable = [
        "patients.read",
        "appointments.read",
        "appointments.write",
        "clinical.read",
        "clinical.write",
        "prescriptions.issue",
    ];
    let permissions: Vec<Value> = role["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|grant| {
            let key = grant["key"].as_str().unwrap();
            let scope = if scopable.contains(&key) {
                scope
            } else {
                "all"
            };
            json!({ "key": key, "scope": scope })
        })
        .collect();
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            "/api/v1/roles/doctor/permissions",
            Some(owner),
            Some(json!({ "permissions": permissions })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn get(app: &TestApp, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, ALPHA, path, Some(token), None).await
}

fn ids(list: &Value) -> Vec<String> {
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

/// Two doctors' records: each has a patient booked with them today and a visit with a note and
/// a draft prescription.
struct World {
    patient_a: String,
    patient_b: String,
    appointment_b: String,
    practitioner_b: String,
    visit_a: String,
    visit_b: String,
    note_b: String,
    rx_b: String,
    day: String,
}

async fn world(app: &TestApp, owner: &str) -> World {
    let practitioner_a = doctor(app, owner, DOCTOR_A, "Dr Asha").await;
    let practitioner_b = doctor(app, owner, DOCTOR_B, "Dr Bala").await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let patient_a = created(
        app,
        &desk,
        "/api/v1/patients",
        json!({ "full_name": "Ravi Kumar" }),
    )
    .await;
    let patient_b = created(
        app,
        &desk,
        "/api/v1/patients",
        json!({ "full_name": "Meera Iyer" }),
    )
    .await;
    let ist = UtcOffset::from_hms(5, 30, 0).unwrap();
    let starts = (OffsetDateTime::now_utc() + Duration::minutes(2)).to_offset(ist);
    let slot = |at: OffsetDateTime| at.format(&Rfc3339).unwrap();
    let book = |patient: &str, practitioner: &str| {
        json!({
            "patient_id": patient, "practitioner_id": practitioner,
            "starts_at": slot(starts), "ends_at": slot(starts + Duration::minutes(30))
        })
    };
    created(
        app,
        &desk,
        "/api/v1/appointments",
        book(&patient_a, &practitioner_a),
    )
    .await;
    let appointment_b = created(
        app,
        &desk,
        "/api/v1/appointments",
        book(&patient_b, &practitioner_b),
    )
    .await;
    let (token_a, token_b) = (app.token(DOCTOR_A), app.token(DOCTOR_B));
    let visit = json!({ "chief_complaint": "Pain" });
    let visit_a = created(
        app,
        &token_a,
        &format!("/api/v1/patients/{patient_a}/visits"),
        visit.clone(),
    )
    .await;
    let visit_b = created(
        app,
        &token_b,
        &format!("/api/v1/patients/{patient_b}/visits"),
        visit,
    )
    .await;
    let note_b = created(
        app,
        &token_b,
        &format!("/api/v1/visits/{visit_b}/notes"),
        json!({ "sections": { "subjective": "Pain on chewing" } }),
    )
    .await;
    let rx_b = created(
        app,
        &token_b,
        &format!("/api/v1/patients/{patient_b}/prescriptions"),
        json!({ "diagnosis_text": "Pericoronitis", "items": [] }),
    )
    .await;
    for patient in [&patient_a, &patient_b] {
        created(
            app,
            owner,
            &format!("/api/v1/patients/{patient}/recalls"),
            json!({ "due_on": "2020-01-01", "reason": "Cleaning" }),
        )
        .await;
    }
    World {
        patient_a,
        patient_b,
        appointment_b,
        practitioner_b,
        visit_a,
        visit_b,
        note_b,
        rx_b,
        day: starts.date().to_string(),
    }
}

/// Reads keyed by a patient, a visit or a record of doctor B.
fn colleague_reads(w: &World) -> Vec<String> {
    let p = &w.patient_b;
    vec![
        format!("/api/v1/patients/{p}"),
        format!("/api/v1/patients/{p}/clinical-flags"),
        format!("/api/v1/patients/{p}/identifiers"),
        format!("/api/v1/patients/{p}/allergies"),
        format!("/api/v1/patients/{p}/conditions"),
        format!("/api/v1/patients/{p}/dental-chart"),
        format!("/api/v1/patients/{p}/attachments"),
        format!("/api/v1/patients/{p}/visits"),
        format!("/api/v1/patients/{p}/procedures"),
        format!("/api/v1/patients/{p}/treatment-plans"),
        format!("/api/v1/patients/{p}/prescriptions"),
        format!("/api/v1/patients/{p}/timeline"),
        format!("/api/v1/patients/{p}/notes"),
        format!("/api/v1/visits/{}", w.visit_b),
        format!("/api/v1/prescriptions/{}", w.rx_b),
    ]
}

/// Lists, search and counts hold only the doctor's own.
async fn lists_hold_only_own(app: &TestApp, w: &World, doctor_a: &str) {
    let (_, list) = get(app, doctor_a, "/api/v1/patients").await;
    assert_eq!(ids(&list), [w.patient_a.as_str()]);
    for (query, expected) in [("Meera", 0), ("Ravi", 1), ("", 1)] {
        let (status, found) = app
            .send(
                Method::POST,
                ALPHA,
                "/api/v1/patients/search",
                Some(doctor_a),
                Some(json!({ "q": query })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{found}");
        assert_eq!(ids(&found).len(), expected, "search {query:?}: {found}");
    }
    let calendar = format!("/api/v1/appointments?from={0}&to={0}", w.day);
    let (_, booked) = get(app, doctor_a, &calendar).await;
    assert_eq!(booked["items"].as_array().unwrap().len(), 1, "{booked}");
    assert_eq!(
        booked["items"][0]["patient"]["id"],
        w.patient_a.as_str(),
        "{booked}"
    );
    let (_, today) = get(app, doctor_a, "/api/v1/today").await;
    assert_eq!(
        today["appointments"].as_array().unwrap().len(),
        1,
        "{today}"
    );
    let (_, recalls) = get(app, doctor_a, "/api/v1/recalls").await;
    assert_eq!(recalls["items"].as_array().unwrap().len(), 1, "{recalls}");
    assert_eq!(recalls["items"][0]["patient"]["id"], w.patient_a.as_str());
    let (_, visits) = get(
        app,
        doctor_a,
        &format!("/api/v1/patients/{}/visits", w.patient_a),
    )
    .await;
    assert_eq!(ids(&visits), [w.visit_a.as_str()]);
}

/// Writes on doctor B's records.
fn colleague_writes(w: &World) -> Vec<(Method, String, Value)> {
    vec![
        (
            Method::POST,
            format!("/api/v1/patients/{}/visits", w.patient_b),
            json!({}),
        ),
        (
            Method::POST,
            format!("/api/v1/visits/{}/close", w.visit_b),
            json!({}),
        ),
        (
            Method::POST,
            format!("/api/v1/visits/{}/notes", w.visit_b),
            json!({ "sections": { "subjective": "x" } }),
        ),
        (
            Method::PATCH,
            format!("/api/v1/notes/{}", w.note_b),
            json!({ "sections": { "plan": "x" } }),
        ),
        (
            Method::POST,
            format!("/api/v1/notes/{}/sign", w.note_b),
            json!({}),
        ),
        (
            Method::PUT,
            format!("/api/v1/patients/{}/summary-note", w.patient_b),
            json!({ "body": "x" }),
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{}/allergies", w.patient_b),
            json!({ "substance": "Penicillin" }),
        ),
        (
            Method::POST,
            format!("/api/v1/patients/{}/prescriptions", w.patient_b),
            json!({ "items": [] }),
        ),
        (
            Method::PATCH,
            format!("/api/v1/prescriptions/{}", w.rx_b),
            json!({ "advice": "x" }),
        ),
        (
            Method::POST,
            format!("/api/v1/prescriptions/{}/cancel", w.rx_b),
            json!({ "reason": "Wrong patient" }),
        ),
        (
            Method::PATCH,
            format!("/api/v1/appointments/{}", w.appointment_b),
            json!({ "notes": "x" }),
        ),
        (
            Method::POST,
            format!("/api/v1/appointments/{}/status", w.appointment_b),
            json!({ "status": "confirmed" }),
        ),
        (
            Method::PATCH,
            format!("/api/v1/patients/{}", w.patient_b),
            json!({ "full_name": "X Y" }),
        ),
    ]
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn own_scope_reaches_only_the_members_records() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let w = world(&app, &owner).await;
    narrow_doctors(&app, &owner, "own").await;
    let doctor_a = app.token(DOCTOR_A);

    lists_hold_only_own(&app, &w, &doctor_a).await;
    let calendar = format!("/api/v1/appointments?from={0}&to={0}", w.day);

    // Their own records open; a colleague's are not found.
    for path in [
        format!("/api/v1/patients/{}", w.patient_a),
        format!("/api/v1/visits/{}", w.visit_a),
        format!("/api/v1/patients/{}/timeline", w.patient_a),
    ] {
        let (status, body) = get(&app, &doctor_a, &path).await;
        assert_eq!(status, StatusCode::OK, "GET {path}: {body}");
    }
    for path in colleague_reads(&w) {
        let (status, body) = get(&app, &doctor_a, &path).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "GET {path}: {body}");
    }

    // Writes on a colleague's records are not found either.
    for (method, path, body) in colleague_writes(&w) {
        let (status, error) = app
            .send(method.clone(), ALPHA, &path, Some(&doctor_a), Some(body))
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}: {error}");
    }
    // Nor may they book a colleague's diary.
    let (status, error) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/appointments",
            Some(&doctor_a),
            Some(json!({
                "patient_id": w.patient_a, "practitioner_id": w.practitioner_b,
                "starts_at": "2030-01-07T10:00:00+05:30", "ends_at": "2030-01-07T10:30:00+05:30"
            })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");

    // The front desk holds `all` and sees both.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, list) = get(&app, &desk, "/api/v1/patients").await;
    assert_eq!(ids(&list).len(), 2);
    let (_, booked) = get(&app, &desk, &calendar).await;
    assert_eq!(booked["items"].as_array().unwrap().len(), 2);
    let (status, _) = get(&app, &desk, &format!("/api/v1/patients/{}", w.patient_b)).await;
    assert_eq!(status, StatusCode::OK);

    // Back at `all`, the doctor sees both again.
    narrow_doctors(&app, &owner, "all").await;
    let (_, list) = get(&app, &doctor_a, "/api/v1/patients").await;
    assert_eq!(ids(&list).len(), 2);
    let (_, booked) = get(&app, &doctor_a, &calendar).await;
    assert_eq!(booked["items"].as_array().unwrap().len(), 2);
    for path in colleague_reads(&w) {
        let (status, body) = get(&app, &doctor_a, &path).await;
        assert_eq!(status, StatusCode::OK, "GET {path}: {body}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn assigned_narrows_like_own() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let w = world(&app, &owner).await;
    narrow_doctors(&app, &owner, "assigned").await;
    let doctor_a = app.token(DOCTOR_A);
    let (_, list) = get(&app, &doctor_a, "/api/v1/patients").await;
    assert_eq!(ids(&list), [w.patient_a.as_str()]);
    let (status, _) = get(
        &app,
        &doctor_a,
        &format!("/api/v1/patients/{}", w.patient_b),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
