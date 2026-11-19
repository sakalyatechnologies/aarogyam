//! Walk-ins on the calendar (`GET /calendar/walk-ins`): visits with no appointment, with the
//! doctor, chair and token they have; never a visit tied to an appointment through itself or
//! its queue token. Same range rule, permission and reach as the appointment list.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::{ALPHA_FRONT_DESK, ALPHA_NOTHING, ALPHA_OWNER, BETA_OWNER};
use support::{ALPHA, BETA, TestApp};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime, UtcOffset};
use uuid::{Uuid, uuid};

const DOCTOR_A: Uuid = uuid!("a0000000-0000-4000-8000-0000000000da");
const DOCTOR_B: Uuid = uuid!("a0000000-0000-4000-8000-0000000000db");
/// A doctor-role member with no practitioner record.
const DOCTOR_C: Uuid = uuid!("a0000000-0000-4000-8000-0000000000dc");

/// Adds a doctor-role member to Alpha with a sign-in. Returns the membership id.
async fn member(app: &TestApp, auth_uid: Uuid, name: &str) -> Uuid {
    sqlx::query_scalar(
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
    .unwrap()
}

/// A doctor-role member with a practitioner record. Returns the practitioner id.
async fn doctor(app: &TestApp, owner: &str, auth_uid: Uuid, name: &str) -> String {
    let membership = member(app, auth_uid, name).await;
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
        .or_else(|| value["visit"]["id"].as_str())
        .unwrap()
        .to_owned()
}

async fn patient(app: &TestApp, name: &str) -> String {
    let desk = app.token(ALPHA_FRONT_DESK);
    created(app, &desk, "/api/v1/patients", json!({ "full_name": name })).await
}

/// A visit the clinician starts directly, with no appointment or token.
async fn visit(app: &TestApp, token: &str, patient: &str) -> String {
    created(
        app,
        token,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Pain" }),
    )
    .await
}

async fn exec(app: &TestApp, sql: &'static str, id: &str) {
    sqlx::query(sql)
        .bind(id.parse::<Uuid>().unwrap())
        .execute(&app.owner)
        .await
        .unwrap();
}

/// The clinic's clock (Alpha is in India).
fn clinic_now() -> OffsetDateTime {
    OffsetDateTime::now_utc().to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
}

/// The clinic's local day today.
fn today() -> String {
    clinic_now().date().to_string()
}

async fn walk_ins(app: &TestApp, host: &str, token: &str, query: &str) -> (StatusCode, Value) {
    app.send(
        Method::GET,
        host,
        &format!("/api/v1/calendar/walk-ins?{query}"),
        Some(token),
        None,
    )
    .await
}

fn visit_ids(list: &Value) -> Vec<String> {
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["visit_id"].as_str().unwrap().to_owned())
        .collect()
}

fn item<'a>(list: &'a Value, visit: &str) -> &'a Value {
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["visit_id"] == visit)
        .unwrap()
}

/// A walk-in token seated in a new chair, started into a visit by `doctor`. Returns the visit
/// and the chair.
async fn seated_walk_in(app: &TestApp, owner: &str, doctor: &str) -> (String, String) {
    let desk = app.token(ALPHA_FRONT_DESK);
    let chair = created(app, owner, "/api/v1/rooms", json!({ "name": "Chair 1" })).await;
    let meera = patient(app, "Meera Iyer").await;
    let (status, token) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/queue",
            Some(&desk),
            Some(json!({ "patient_id": meera })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{token}");
    let token_id = token["id"].as_str().unwrap().to_owned();
    sqlx::query("update aarogyam.queue_tokens set room_id = $2 where id = $1")
        .bind(token_id.parse::<Uuid>().unwrap())
        .bind(chair.parse::<Uuid>().unwrap())
        .execute(&app.owner)
        .await
        .unwrap();
    let visit = created(
        app,
        doctor,
        &format!("/api/v1/queue/{token_id}/start-visit"),
        json!({}),
    )
    .await;
    (visit, chair)
}

/// Two booked patients who arrived and were started from their tokens: the first visit has
/// its appointment; the second lost the link (as an older visit might) but its token still
/// has the appointment. Neither is a walk-in.
async fn booked_visits(app: &TestApp, doctor: &str, practitioner: &str) {
    let desk = app.token(ALPHA_FRONT_DESK);
    let now = clinic_now();
    let starts = if (now + Duration::minutes(70)).date() == now.date() {
        now
    } else {
        now - Duration::minutes(70)
    };
    let mut visits = Vec::new();
    for (name, offset) in [("Anil Rao", 0), ("Kavya Nair", 31)] {
        let booked = patient(app, name).await;
        let at = starts + Duration::minutes(offset);
        let appointment = created(
            app,
            &desk,
            "/api/v1/appointments",
            json!({
                "patient_id": booked, "practitioner_id": practitioner,
                "starts_at": at.format(&Rfc3339).unwrap(),
                "ends_at": (at + Duration::minutes(30)).format(&Rfc3339).unwrap()
            }),
        )
        .await;
        let (status, arrived) = app
            .send(
                Method::POST,
                ALPHA,
                &format!("/api/v1/appointments/{appointment}/status"),
                Some(&desk),
                Some(json!({ "status": "arrived" })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{arrived}");
        let token = arrived["queue_token_id"].as_str().unwrap();
        visits.push(
            created(
                app,
                doctor,
                &format!("/api/v1/queue/{token}/start-visit"),
                json!({}),
            )
            .await,
        );
    }
    exec(
        app,
        "update aarogyam.encounters set appointment_id = null where id = $1",
        &visits[1],
    )
    .await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn lists_only_visits_with_no_appointment() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let practitioner_a = doctor(&app, &owner, DOCTOR_A, "Dr Asha").await;
    let practitioner_b = doctor(&app, &owner, DOCTOR_B, "Dr Bala").await;
    let (token_a, token_b) = (app.token(DOCTOR_A), app.token(DOCTOR_B));
    let day = today();

    // A plain walk-in visit by doctor A.
    let ravi = patient(&app, "Ravi Kumar").await;
    let direct = visit(&app, &token_a, &ravi).await;

    let (queued, chair) = seated_walk_in(&app, &owner, &token_b).await;
    booked_visits(&app, &token_b, &practitioner_b).await;

    // Doctor A's visit is closed.
    exec(
        &app,
        "update aarogyam.encounters set status = 'closed', ended_at = now() where id = $1",
        &direct,
    )
    .await;

    let range = format!("from={day}&to={day}");
    let (status, listed) = walk_ins(&app, ALPHA, &desk, &range).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let mut ids = visit_ids(&listed);
    ids.sort();
    let mut wanted = vec![direct.clone(), queued.clone()];
    wanted.sort();
    assert_eq!(ids, wanted, "{listed}");

    let closed = item(&listed, &direct);
    assert_eq!(closed["status"], "closed");
    assert!(closed["ends_at"].is_string());
    assert_eq!(closed["practitioner"]["id"], practitioner_a.as_str());
    assert_eq!(closed["practitioner"]["display_name"], "Dr Asha");
    assert_eq!(closed["patient"]["id"], ravi.as_str());
    assert_eq!(closed["patient"]["full_name"], "Ravi Kumar");
    assert!(closed.get("room_id").is_none() && closed.get("token_number").is_none());
    assert!(closed.get("chief_complaint").is_none() && closed.get("number").is_none());

    let open = item(&listed, &queued);
    assert_eq!(open["status"], "open");
    assert!(open.get("ends_at").is_none());
    assert_eq!(open["room_id"], chair.as_str());
    assert_eq!(open["room"], "Chair 1");
    assert!(open["token_number"].is_i64());
    assert_eq!(open["practitioner"]["id"], practitioner_b.as_str());

    // Filters: the chair matches the token's room; the doctor the clinician's record.
    let (_, by_chair) = walk_ins(&app, ALPHA, &desk, &format!("{range}&room_id={chair}")).await;
    assert_eq!(visit_ids(&by_chair), vec![queued.clone()]);
    let (_, by_doctor) = walk_ins(
        &app,
        ALPHA,
        &desk,
        &format!("{range}&practitioner_id={practitioner_a}"),
    )
    .await;
    assert_eq!(visit_ids(&by_doctor), vec![direct.clone()]);

    // Another day holds none of them.
    let (_, earlier) = walk_ins(&app, ALPHA, &desk, "from=2020-01-01&to=2020-01-31").await;
    assert_eq!(visit_ids(&earlier), Vec::<String>::new());
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn range_and_permission_follow_the_appointment_list() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, body) = walk_ins(&app, ALPHA, &desk, "from=2026-01-01&to=2026-02-11").await;
    assert_eq!(status, StatusCode::OK, "42 days counting both: {body}");
    let (status, body) = walk_ins(&app, ALPHA, &desk, "from=2026-01-01&to=2026-02-12").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, body) = walk_ins(&app, ALPHA, &desk, "from=2026-02-01&to=2026-01-01").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let nothing = app.token(ALPHA_NOTHING);
    let (status, body) = walk_ins(&app, ALPHA, &nothing, "from=2026-01-01&to=2026-01-01").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/calendar/walk-ins?from=2026-01-01&to=2026-01-01",
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn own_reach_sees_only_own_visits_and_other_clinics_see_none() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    doctor(&app, &owner, DOCTOR_A, "Dr Asha").await;
    doctor(&app, &owner, DOCTOR_B, "Dr Bala").await;
    member(&app, DOCTOR_C, "Dr Chitra").await;
    let (token_a, token_b, token_c) = (
        app.token(DOCTOR_A),
        app.token(DOCTOR_B),
        app.token(DOCTOR_C),
    );
    let visit_a = visit(&app, &token_a, &patient(&app, "Ravi Kumar").await).await;
    let visit_b = visit(&app, &token_b, &patient(&app, "Meera Iyer").await).await;
    let visit_c = visit(&app, &token_c, &patient(&app, "Anil Rao").await).await;
    let visit_owner = visit(&app, &owner, &patient(&app, "Kavya Nair").await).await;

    // Narrow the doctor role's appointments.read to own.
    let (status, role) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/roles/doctor",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{role}");
    let permissions: Vec<Value> = role["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|grant| {
            let key = grant["key"].as_str().unwrap();
            let scope = if key == "appointments.read" {
                "own"
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
            Some(&owner),
            Some(json!({ "permissions": permissions })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let day = today();
    let range = format!("from={day}&to={day}");
    let (status, listed) = walk_ins(&app, ALPHA, &token_a, &range).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    assert_eq!(visit_ids(&listed), vec![visit_a.clone()]);
    // A clinician with no practitioner record still sees their own, with no doctor.
    let (_, listed) = walk_ins(&app, ALPHA, &token_c, &range).await;
    assert_eq!(visit_ids(&listed), vec![visit_c.clone()]);
    assert!(item(&listed, &visit_c).get("practitioner").is_none());

    // The owner, at all, sees every one; filtering by a doctor leaves out the ones with none.
    let (_, all) = walk_ins(&app, ALPHA, &owner, &range).await;
    let mut ids = visit_ids(&all);
    ids.sort();
    let mut wanted = vec![visit_a, visit_b, visit_c, visit_owner];
    wanted.sort();
    assert_eq!(ids, wanted);

    // Another clinic's member: nothing from Alpha in their own clinic, and no way into Alpha.
    let beta = app.token(BETA_OWNER);
    let (status, listed) = walk_ins(&app, BETA, &beta, &range).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    assert_eq!(visit_ids(&listed), Vec::<String>::new(), "{listed}");
    let (status, _) = walk_ins(&app, ALPHA, &beta, &range).await;
    assert!(
        matches!(status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "{status}"
    );
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_deleted_patient_follows_the_appointment_list() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let practitioner = doctor(&app, &owner, DOCTOR_A, "Dr Asha").await;
    let token_a = app.token(DOCTOR_A);
    let ravi = patient(&app, "Ravi Kumar").await;
    let walk_in = visit(&app, &token_a, &ravi).await;
    let now = clinic_now();
    let at = if (now + Duration::minutes(40)).date() == now.date() {
        now + Duration::minutes(5)
    } else {
        now - Duration::minutes(40)
    };
    let appointment = created(
        &app,
        &desk,
        "/api/v1/appointments",
        json!({
            "patient_id": ravi, "practitioner_id": practitioner,
            "starts_at": at.format(&Rfc3339).unwrap(),
            "ends_at": (at + Duration::minutes(30)).format(&Rfc3339).unwrap()
        }),
    )
    .await;
    exec(
        &app,
        "update aarogyam.patients set deleted_at = now() where id = $1",
        &ravi,
    )
    .await;

    let day = now.date();
    let range = format!("from={day}&to={day}");
    let (_, appointments) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/appointments?{range}"),
            Some(&desk),
            None,
        )
        .await;
    let booked_shown = appointments["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["id"] == appointment.as_str());
    let (status, listed) = walk_ins(&app, ALPHA, &desk, &range).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let walk_in_shown = visit_ids(&listed).contains(&walk_in);
    assert_eq!(
        walk_in_shown, booked_shown,
        "walk-ins and appointments treat a deleted patient alike"
    );
}
