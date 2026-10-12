//! The front desk on a real database: chairs and doctors, booking, statuses and the queue,
//! Today, patient identifiers and imports.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one front-desk journey end to end, step by step"
)]

mod support;

use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{
    AppointmentId, ClinicId, MembershipId, PatientId, PractitionerId, RoomId, UserId,
};
use aarogyam_domain::permission::{Permission, PermissionSet, Scope};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::macros::datetime;
use time::{Duration, OffsetDateTime};
use uuid::{Uuid, uuid};

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn created(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

async fn patient(app: &TestApp, host: &str, token: &str, name: &str) -> String {
    let body = created(
        app,
        host,
        token,
        "/api/v1/patients",
        json!({ "full_name": name, "sex": "female", "age_years": 30 }),
    )
    .await;
    id_of(&body)
}

/// Two chairs and a doctor in Alpha.
struct Setup {
    chair1: String,
    chair2: String,
    doctor: String,
}

async fn setup(app: &TestApp, owner: &str) -> Setup {
    let chair1 = created(
        app,
        ALPHA,
        owner,
        "/api/v1/rooms",
        json!({ "name": "Chair 1" }),
    )
    .await;
    let chair2 = created(
        app,
        ALPHA,
        owner,
        "/api/v1/rooms",
        json!({ "name": "Chair 2" }),
    )
    .await;
    let doctor = created(
        app,
        ALPHA,
        owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
    )
    .await;
    Setup {
        chair1: id_of(&chair1),
        chair2: id_of(&chair2),
        doctor: id_of(&doctor),
    }
}

fn booking(patient: &str, doctor: &str, room: &str, starts: &str, ends: &str) -> Value {
    json!({
        "patient_id": patient, "practitioner_id": doctor, "room_id": room,
        "starts_at": starts, "ends_at": ends, "reason": "Check-up"
    })
}

async fn status(app: &TestApp, token: &str, appointment: &str, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/appointments/{appointment}/status"),
        Some(token),
        Some(body),
    )
    .await
}

/// Alpha's owner, acting through the use cases with a clock the test chooses.
async fn owner_actor(app: &TestApp) -> ClinicActor {
    let user = uuid!("01900000-0000-7000-8000-0000000000a1");
    let clinic = app.clinic_id("alpha").await;
    let membership: Uuid = sqlx::query_scalar(
        "select id from aarogyam.memberships where org_id = $1 and user_id = $2",
    )
    .bind(clinic)
    .bind(user)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    ClinicActor {
        clinic_id: ClinicId::from_uuid(clinic),
        timezone: "Asia/Kolkata".into(),
        number_prefix: "AD".into(),
        user_id: UserId::from_uuid(user),
        membership_id: MembershipId::from_uuid(membership),
        role_key: "owner".into(),
        permissions: Permission::ALL
            .into_iter()
            .fold(PermissionSet::EMPTY, |set, permission| {
                set.with(permission, Scope::All)
            }),
        support_grant: None,
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn chairs_doctors_hours_and_leave_follow_permissions() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let s = setup(&app, &owner).await;

    // Names are unique per branch, whatever the case; blank names are refused.
    let (code, error) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/rooms",
            Some(&owner),
            Some(json!({ "name": "chair 1" })),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT, "{error}");
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/rooms",
            Some(&owner),
            Some(json!({ "name": " " })),
        )
        .await;
    assert_eq!(code, StatusCode::BAD_REQUEST);
    // Changing needs settings.manage; listing needs appointments.read.
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/rooms",
            Some(&desk),
            Some(json!({ "name": "Chair 3" })),
        )
        .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let (code, rooms) = app
        .send(Method::GET, ALPHA, "/api/v1/rooms", Some(&assistant), None)
        .await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(rooms["items"].as_array().unwrap().len(), 2);
    let (_, doctors) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/practitioners",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(doctors["items"][0]["calendar_color"], "#0F766E");
    let (code, renamed) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/rooms/{}", s.chair2),
            Some(&owner),
            Some(json!({ "name": "Chair B", "sort_order": 2 })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{renamed}");
    assert_eq!(renamed["name"], "Chair B");

    // Weekly hours: replaced as a whole, overlapping shifts refused.
    let hours = format!("/api/v1/practitioners/{}/working-hours", s.doctor);
    let overlapping = json!({ "shifts": [
        { "weekday": 1, "starts": "09:00", "ends": "13:00" },
        { "weekday": 1, "starts": "12:00", "ends": "14:00" }
    ]});
    let (code, error) = app
        .send(Method::PUT, ALPHA, &hours, Some(&owner), Some(overlapping))
        .await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "{error}");
    let week = json!({ "shifts": [
        { "weekday": 3, "starts": "17:00", "ends": "20:00" },
        { "weekday": 1, "starts": "09:00", "ends": "13:00" }
    ]});
    let (code, saved) = app
        .send(Method::PUT, ALPHA, &hours, Some(&owner), Some(week.clone()))
        .await;
    assert_eq!(code, StatusCode::OK, "{saved}");
    assert_eq!(saved["shifts"][0]["weekday"], 1);
    assert_eq!(saved["shifts"][1]["starts"], "17:00");
    let (_, read) = app
        .send(Method::GET, ALPHA, &hours, Some(&assistant), None)
        .await;
    assert_eq!(read, saved);
    let (code, _) = app
        .send(Method::PUT, ALPHA, &hours, Some(&desk), Some(week))
        .await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    // Leave: the front desk records it; the assistant can't.
    let leave = json!({
        "practitioner_id": s.doctor, "starts_at": "2030-01-07T09:00:00+05:30",
        "ends_at": "2030-01-07T18:00:00+05:30", "reason": "Conference"
    });
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/leave-blocks",
            Some(&assistant),
            Some(leave.clone()),
        )
        .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let block = created(&app, ALPHA, &desk, "/api/v1/leave-blocks", leave).await;
    let (_, listed) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/leave-blocks?from=2030-01-01&to=2030-01-31",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
    let leave_path = format!("/api/v1/leave-blocks/{}", id_of(&block));

    // Beta can't see or touch any of it.
    for (method, path) in [
        (Method::PATCH, format!("/api/v1/rooms/{}", s.chair1)),
        (Method::DELETE, format!("/api/v1/rooms/{}", s.chair1)),
        (Method::PATCH, format!("/api/v1/practitioners/{}", s.doctor)),
        (
            Method::DELETE,
            format!("/api/v1/practitioners/{}", s.doctor),
        ),
        (Method::GET, hours.clone()),
        (Method::DELETE, leave_path.clone()),
        (Method::PUT, hours.clone()),
        (Method::POST, "/api/v1/leave-blocks".to_owned()),
    ] {
        let body = match method {
            Method::PATCH => Some(json!({ "name": "Mine", "display_name": "Mine" })),
            Method::PUT => Some(json!({ "shifts": [] })),
            Method::POST => Some(json!({
                "practitioner_id": s.doctor, "starts_at": "2030-01-07T09:00:00+05:30",
                "ends_at": "2030-01-07T18:00:00+05:30"
            })),
            _ => None,
        };
        let (code, _) = app
            .send(method.clone(), BETA, &path, Some(&beta), body)
            .await;
        assert_eq!(code, StatusCode::NOT_FOUND, "{method} {path}");
    }
    let (_, beta_rooms) = app
        .send(Method::GET, BETA, "/api/v1/rooms", Some(&beta), None)
        .await;
    assert_eq!(beta_rooms["items"], json!([]));

    let (code, _) = app
        .send(Method::DELETE, ALPHA, &leave_path, Some(&desk), None)
        .await;
    assert_eq!(code, StatusCode::NO_CONTENT);
    let (code, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            &format!("/api/v1/rooms/{}", s.chair2),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(code, StatusCode::NO_CONTENT);
    let (_, rooms) = app
        .send(Method::GET, ALPHA, "/api/v1/rooms", Some(&owner), None)
        .await;
    assert_eq!(rooms["items"].as_array().unwrap().len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_chair_takes_one_booking_at_a_time() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let s = setup(&app, &owner).await;
    let priya = patient(&app, ALPHA, &desk, "Priya Sharma").await;
    let ravi = patient(&app, ALPHA, &desk, "Ravi Kumar").await;
    let path = "/api/v1/appointments";

    let first = created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(
            &priya,
            &s.doctor,
            &s.chair1,
            "2030-01-07T10:00:00+05:30",
            "2030-01-07T10:30:00+05:30",
        ),
    )
    .await;
    assert_eq!(first["warnings"], json!([]));
    let first_id = first["appointment"]["id"].as_str().unwrap().to_owned();
    assert_eq!(first["appointment"]["status"], "booked");
    assert_eq!(first["appointment"]["patient"]["number"], "AD-1");
    assert_eq!(first["appointment"]["room"], "Chair 1");
    assert_eq!(first["appointment"]["starts_at"], "2030-01-07T04:30:00Z");

    // Same chair, overlapping: refused with a clear message.
    let (code, error) = app
        .send(
            Method::POST,
            ALPHA,
            path,
            Some(&desk),
            Some(booking(
                &ravi,
                &s.doctor,
                &s.chair1,
                "2030-01-07T10:15:00+05:30",
                "2030-01-07T10:45:00+05:30",
            )),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT, "{error}");
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("chair is already booked")
    );
    // Another chair: allowed, but the doctor is busy.
    let second = created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(
            &ravi,
            &s.doctor,
            &s.chair2,
            "2030-01-07T10:15:00+05:30",
            "2030-01-07T10:45:00+05:30",
        ),
    )
    .await;
    assert_eq!(second["warnings"][0]["code"], "practitioner_busy");
    let second_id = second["appointment"]["id"].as_str().unwrap().to_owned();
    let second_path = format!("{path}/{second_id}");

    // Moving into the taken chair is refused; moving the time keeps the length.
    let (code, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &second_path,
            Some(&desk),
            Some(json!({ "room_id": s.chair1 })),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT);
    let (code, moved) = app
        .send(
            Method::PATCH,
            ALPHA,
            &second_path,
            Some(&desk),
            Some(json!({ "starts_at": "2030-01-07T11:00:00+05:30", "notes": "Prefers mornings" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{moved}");
    assert_eq!(moved["appointment"]["ends_at"], "2030-01-07T06:00:00Z");
    assert_eq!(moved["appointment"]["has_notes"], true);
    assert_eq!(moved["warnings"], json!([]));

    // The calendar: a day, filters, and a range limit.
    let (_, day) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/appointments?from=2030-01-07&to=2030-01-07",
            Some(&desk),
            None,
        )
        .await;
    let items = day["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["id"], first_id.as_str());
    let (_, filtered) = app
        .send(
            Method::GET,
            ALPHA,
            &format!(
                "/api/v1/appointments?from=2030-01-07&to=2030-01-07&room_id={}",
                s.chair2
            ),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(filtered["items"].as_array().unwrap().len(), 1);
    // A six-week month grid (42 days) is fine.
    let (code, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/appointments?from=2029-12-31&to=2030-02-10",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(code, StatusCode::OK);
    let (code, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/appointments?from=2029-12-31&to=2030-02-11",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(code, StatusCode::BAD_REQUEST);

    // A cancelled booking frees the chair.
    let (code, _) = status(
        &app,
        &desk,
        &first_id,
        json!({ "status": "cancelled", "reason": "Patient called" }),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(
            &ravi,
            &s.doctor,
            &s.chair1,
            "2030-01-07T10:15:00+05:30",
            "2030-01-07T10:45:00+05:30",
        ),
    )
    .await;

    // Every change is in the appointment's history.
    let kinds: Vec<String> = sqlx::query_scalar(
        "select kind from aarogyam.appointment_events where appointment_id = $1 order by at, id",
    )
    .bind(Uuid::parse_str(&second_id).unwrap())
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(kinds, ["booked", "changed"]);

    // Hours and leave warn; a doctor with upcoming bookings can't be removed.
    let hours = format!("/api/v1/practitioners/{}/working-hours", s.doctor);
    let week = json!({ "shifts": [{ "weekday": 1, "starts": "09:00", "ends": "13:00" }] });
    app.send(Method::PUT, ALPHA, &hours, Some(&owner), Some(week))
        .await;
    let late = created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(
            &priya,
            &s.doctor,
            &s.chair2,
            "2030-01-07T15:00:00+05:30",
            "2030-01-07T15:30:00+05:30",
        ),
    )
    .await;
    assert_eq!(late["warnings"][0]["code"], "outside_working_hours");
    let (code, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            &format!("/api/v1/practitioners/{}", s.doctor),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT);

    // The assistant may look but not book; Beta sees nothing and touches nothing.
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            path,
            Some(&app.token(ALPHA_ASSISTANT)),
            Some(booking(
                &priya,
                &s.doctor,
                &s.chair2,
                "2030-01-08T10:00:00+05:30",
                "2030-01-08T10:30:00+05:30",
            )),
        )
        .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let (code, _) = app
        .send(
            Method::PATCH,
            BETA,
            &second_path,
            Some(&beta),
            Some(json!({ "notes": "x" })),
        )
        .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (code, _) = app
        .send(
            Method::POST,
            BETA,
            &format!("{second_path}/status"),
            Some(&beta),
            Some(json!({ "status": "arrived" })),
        )
        .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (_, theirs) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/appointments?from=2030-01-07&to=2030-01-07",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(theirs["items"], json!([]));
    let (code, _) = app
        .send(
            Method::POST,
            BETA,
            path,
            Some(&beta),
            Some(booking(
                &priya,
                &s.doctor,
                &s.chair1,
                "2030-01-09T10:00:00+05:30",
                "2030-01-09T10:30:00+05:30",
            )),
        )
        .await;
    assert_eq!(
        code,
        StatusCode::NOT_FOUND,
        "Alpha's patient is unknown to Beta"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn statuses_follow_the_table_and_arrivals_get_tokens() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let s = setup(&app, &owner).await;
    let (a, b, c, walk) = (
        patient(&app, ALPHA, &desk, "Anil").await,
        patient(&app, ALPHA, &desk, "Bela").await,
        patient(&app, ALPHA, &desk, "Chitra").await,
        patient(&app, ALPHA, &desk, "Dinesh").await,
    );
    let mut ids = Vec::new();
    for (index, who) in [&a, &b, &c].into_iter().enumerate() {
        let hour = 10 + index;
        let body = created(
            &app,
            ALPHA,
            &desk,
            "/api/v1/appointments",
            booking(
                who,
                &s.doctor,
                &s.chair1,
                &format!("2030-01-07T{hour}:00:00+05:30"),
                &format!("2030-01-07T{hour}:30:00+05:30"),
            ),
        )
        .await;
        ids.push(body["appointment"]["id"].as_str().unwrap().to_owned());
    }

    // Bad input is a 400 that says why; a move the table doesn't allow is a 409 (tests/transitions.rs).
    for (body, field) in [
        (json!({ "status": "cancelled" }), "reason"),
        (json!({ "status": "rescheduled" }), "status"),
    ] {
        let (code, error) = status(&app, &desk, &ids[0], body).await;
        assert_eq!(code, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }
    let (code, error) = status(&app, &desk, &ids[0], json!({ "status": "completed" })).await;
    assert_eq!(code, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["current"]["appointment"]["status"], "booked");

    // Arrivals get the day's tokens in order; a walk-in gets the next one.
    let (code, arrived) = status(&app, &desk, &ids[0], json!({ "status": "arrived" })).await;
    assert_eq!(code, StatusCode::OK, "{arrived}");
    assert_eq!(arrived["appointment"]["token_number"], 1);
    assert!(arrived["appointment"]["arrived_at"].is_string());
    // Arriving again is a repeat: the same appointment, no second token.
    let (code, repeated) = status(&app, &desk, &ids[0], json!({ "status": "arrived" })).await;
    assert_eq!(code, StatusCode::OK, "{repeated}");
    assert_eq!(repeated, arrived);
    status(&app, &desk, &ids[1], json!({ "status": "confirmed" })).await;
    let (_, second) = status(&app, &desk, &ids[1], json!({ "status": "arrived" })).await;
    assert_eq!(second["appointment"]["token_number"], 2);
    let walk_in = created(
        &app,
        ALPHA,
        &desk,
        "/api/v1/queue",
        json!({ "patient_id": walk }),
    )
    .await;
    assert_eq!(walk_in["token_number"], 3);
    assert_eq!(walk_in["appointment_id"], Value::Null);
    let (_, queue) = app
        .send(Method::GET, ALPHA, "/api/v1/queue", Some(&desk), None)
        .await;
    let numbers: Vec<i64> = queue["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|token| token["token_number"].as_i64().unwrap())
        .collect();
    assert_eq!(numbers, [1, 2, 3]);
    assert!(
        queue["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["status"] == "waiting")
    );

    // The chair and completion move the token along.
    status(&app, &desk, &ids[0], json!({ "status": "in_chair" })).await;
    let (_, done) = status(&app, &desk, &ids[0], json!({ "status": "completed" })).await;
    assert_eq!(done["appointment"]["status"], "completed");
    let (_, queue) = app
        .send(Method::GET, ALPHA, "/api/v1/queue", Some(&desk), None)
        .await;
    assert_eq!(queue["items"][0]["status"], "done");
    // A walk-in moves through the queue on its own.
    let token_path = format!("/api/v1/queue/{}/status", id_of(&walk_in));
    for (next, expected) in [
        ("in_chair", StatusCode::OK),
        ("done", StatusCode::OK),
        ("done", StatusCode::OK),
        ("in_chair", StatusCode::CONFLICT),
    ] {
        let (code, _) = app
            .send(
                Method::POST,
                ALPHA,
                &token_path,
                Some(&desk),
                Some(json!({ "status": next })),
            )
            .await;
        assert_eq!(code, expected, "{next}");
    }
    // A booked patient who leaves the queue cancels the appointment with a reason.
    let b_token = queue["items"][1]["id"].as_str().unwrap();
    let (code, left) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/queue/{b_token}/status"),
            Some(&desk),
            Some(json!({ "status": "left" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{left}");
    let (_, day) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/appointments?from=2030-01-07&to=2030-01-07",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(day["items"][1]["status"], "cancelled");
    assert_eq!(day["items"][1]["cancel_reason"], "Left without being seen");
    // No-show, then nothing more; finished appointments can't be moved.
    let (code, _) = status(&app, &desk, &ids[2], json!({ "status": "no_show" })).await;
    assert_eq!(code, StatusCode::OK);
    let (code, _) = status(&app, &desk, &ids[2], json!({ "status": "arrived" })).await;
    assert_eq!(code, StatusCode::CONFLICT);
    let (code, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/appointments/{}", ids[0]),
            Some(&desk),
            Some(json!({ "starts_at": "2030-01-08T10:00:00+05:30" })),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT);

    // Beta sees an empty queue and can't touch Alpha's tokens or patients.
    let (_, theirs) = app
        .send(Method::GET, BETA, "/api/v1/queue", Some(&beta), None)
        .await;
    assert_eq!(theirs["items"], json!([]));
    let (code, _) = app
        .send(
            Method::POST,
            BETA,
            &token_path,
            Some(&beta),
            Some(json!({ "status": "left" })),
        )
        .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (code, _) = app
        .send(
            Method::POST,
            BETA,
            "/api/v1/queue",
            Some(&beta),
            Some(json!({ "patient_id": walk })),
        )
        .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/queue",
            Some(&app.token(ALPHA_ASSISTANT)),
            Some(json!({ "patient_id": walk })),
        )
        .await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    // Numbers restart each clinic day.
    let actor = owner_actor(&app).await;
    let tomorrow = OffsetDateTime::now_utc() + Duration::days(1);
    let token = aarogyam_app::queue::walk_in(
        &app.api_db(),
        &actor,
        None,
        aarogyam_app::queue::WalkIn {
            patient_id: PatientId::from_uuid(Uuid::parse_str(&walk).unwrap()),
            practitioner_id: None,
            branch_id: None,
        },
        tomorrow,
    )
    .await
    .unwrap();
    assert_eq!(token.row.token_number, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn today_counts_the_clinic_day() {
    use aarogyam_app::Moved;
    use aarogyam_app::appointments::{self as appointments, NewAppointment};
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let s = setup(&app, &owner).await;
    created(
        &app,
        ALPHA,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Off Today" }),
    )
    .await;
    app.send(
        Method::PUT,
        ALPHA,
        &format!("/api/v1/practitioners/{}/working-hours", s.doctor),
        Some(&owner),
        Some(json!({ "shifts": [{ "weekday": 1, "starts": "09:00", "ends": "17:00" }] })),
    )
    .await;
    let people = [
        patient(&app, ALPHA, &owner, "Asha").await,
        patient(&app, ALPHA, &owner, "Bela").await,
        patient(&app, ALPHA, &owner, "Chitra").await,
        patient(&app, ALPHA, &owner, "Dev").await,
    ];
    let db = app.api_db();
    let actor = owner_actor(&app).await;
    // Monday 7 January 2030, 11:00 in the clinic.
    let now = datetime!(2030-01-07 11:00 +05:30);
    let at = |h: u8, m: u8| now.replace_time(time::Time::from_hms(h, m, 0).unwrap());
    let id = |text: &str| Uuid::parse_str(text).unwrap();
    let book = async |who: usize, room: &str, start: OffsetDateTime, minutes: i64| {
        let saved = appointments::book(
            &db,
            &actor,
            None,
            NewAppointment {
                patient_id: PatientId::from_uuid(id(&people[who])),
                practitioner_id: PractitionerId::from_uuid(id(&s.doctor)),
                room_id: Some(RoomId::from_uuid(id(room))),
                branch_id: None,
                starts_at: start,
                ends_at: Some(start + Duration::minutes(minutes)),
                kind: None,
                reason: None,
                notes: None,
                source: None,
            },
            now,
        )
        .await
        .unwrap();
        AppointmentId::from_uuid(saved.appointment.row.id)
    };
    let set = async |appointment: AppointmentId, to: &str, when: OffsetDateTime| {
        let reason = (to == "cancelled").then_some("Clinic closed early");
        let moved = appointments::set_status(&db, &actor, None, appointment, to, reason, when)
            .await
            .unwrap();
        assert!(
            !matches!(moved, Moved::Refused { .. }),
            "{to} was refused: {moved:?}"
        );
    };
    let done = book(0, &s.chair1, at(9, 0), 30).await;
    set(done, "arrived", at(9, 0)).await;
    set(done, "in_chair", at(9, 5)).await;
    set(done, "completed", at(9, 30)).await;
    let seated = book(1, &s.chair1, at(10, 45), 45).await;
    set(seated, "arrived", at(10, 40)).await;
    set(seated, "in_chair", at(10, 50)).await;
    let late = book(2, &s.chair2, at(10, 30), 30).await;
    let waiting = book(3, &s.chair2, at(11, 0), 30).await;
    set(waiting, "arrived", at(10, 20)).await;
    let missed = book(2, &s.chair2, at(9, 0), 30).await;
    set(missed, "no_show", at(9, 30)).await;
    let cancelled = book(0, &s.chair1, at(12, 0), 30).await;
    set(cancelled, "cancelled", at(10, 0)).await;
    let next = book(3, &s.chair1, at(12, 30), 30).await;
    book(1, &s.chair1, at(10, 0) + Duration::days(1), 30).await;
    aarogyam_app::queue::walk_in(
        &db,
        &actor,
        None,
        aarogyam_app::queue::WalkIn {
            patient_id: PatientId::from_uuid(id(&people[0])),
            practitioner_id: None,
            branch_id: None,
        },
        at(10, 55),
    )
    .await
    .unwrap();

    let today = aarogyam_app::today::today(&db, &actor, None, now, None)
        .await
        .unwrap();
    assert_eq!(today.date.to_string(), "2030-01-07");
    assert_eq!(today.appointments.len(), 7);
    let c = today.counts;
    assert_eq!(
        (
            c.total,
            c.booked,
            c.arrived,
            c.in_chair,
            c.done,
            c.no_shows,
            c.cancelled,
            c.waiting
        ),
        (6, 2, 1, 1, 1, 1, 1, 2)
    );
    let hours: Vec<(u8, usize, usize)> = today
        .by_hour
        .iter()
        .map(|bar| (bar.hour, bar.booked, bar.completed))
        .collect();
    assert_eq!(hours, [(9, 2, 1), (10, 2, 0), (11, 1, 0), (12, 1, 0)]);
    let chair = |index: Option<usize>| index.map(|i| today.appointments[i].row.id);
    assert_eq!(today.chairs.len(), 2);
    assert_eq!(chair(today.chairs[0].current), Some(seated.uuid()));
    assert_eq!(chair(today.chairs[0].next), Some(next.uuid()));
    assert_eq!(chair(today.chairs[1].current), None);
    assert_eq!(chair(today.chairs[1].next), Some(late.uuid()));
    let attention: Vec<(&str, i64)> = today
        .attention
        .iter()
        .map(|item| (item.kind.code(), item.minutes))
        .collect();
    assert_eq!(attention, [("long_wait", 40), ("late_arrival", 30)]);
    assert_eq!(today.team.len(), 1, "only doctors with hours today");
    assert_eq!(today.team[0].appointments, 6);
    assert_eq!(today.recent_patients.len(), 4);
    assert_eq!(
        today.recent_patients[0].row.appointment_id, None,
        "the walk-in is newest"
    );

    // Over HTTP: the shape, for whoever reads the calendar, and nothing of Alpha in Beta.
    let (code, body) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/today",
            Some(&app.token(ALPHA_ASSISTANT)),
            None,
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    for key in [
        "date",
        "as_of",
        "appointments",
        "counts",
        "by_hour",
        "chairs",
        "recent_patients",
        "team",
        "attention",
    ] {
        assert!(body.get(key).is_some(), "{key}");
    }
    assert_eq!(body["chairs"][0]["name"], "Chair 1");
    let (_, theirs) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/today",
            Some(&app.token(BETA_OWNER)),
            None,
        )
        .await;
    assert_eq!(theirs["chairs"], json!([]));
    assert_eq!(theirs["team"], json!([]));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patients_import_from_csv_after_a_preview() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);

    // An identifier on an existing patient, unique per clinic and kind.
    let existing = patient(&app, ALPHA, &desk, "Old Patient").await;
    let other = patient(&app, ALPHA, &desk, "Other Patient").await;
    let ids_path = format!("/api/v1/patients/{existing}/identifiers");
    let kept = created(
        &app,
        ALPHA,
        &desk,
        &ids_path,
        json!({ "kind": "legacy", "value": "OLD-9" }),
    )
    .await;
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{other}/identifiers"),
            Some(&desk),
            Some(json!({ "kind": "legacy", "value": "OLD-9" })),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT);
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            &ids_path,
            Some(&desk),
            Some(json!({ "kind": "passport", "value": "X" })),
        )
        .await;
    assert_eq!(code, StatusCode::BAD_REQUEST);
    for (method, path) in [
        (Method::GET, ids_path.clone()),
        (Method::POST, ids_path.clone()),
        (Method::DELETE, format!("{ids_path}/{}", id_of(&kept))),
    ] {
        let body =
            (method == Method::POST).then(|| json!({ "kind": "file_number", "value": "B-1" }));
        let (code, _) = app
            .send(method.clone(), BETA, &path, Some(&beta), body)
            .await;
        assert_eq!(code, StatusCode::NOT_FOUND, "{method} {path}");
    }
    // Beta may use the same number for its own patient.
    let theirs = patient(&app, BETA, &beta, "Beta Patient").await;
    created(
        &app,
        BETA,
        &beta,
        &format!("/api/v1/patients/{theirs}/identifiers"),
        json!({ "kind": "legacy", "value": "OLD-9" }),
    )
    .await;

    let csv = "Name,Gender,DOB,Mobile,Old ID,File\n\
               Priya Sharma,F,12/04/1990,98765 43210,OLD-1,F-1\n\
               Ravi Kumar,M,,98765 43211,OLD-2,F-2\n\
               ,F,,,OLD-3,\n\
               Meera,robot,31/02/1990,12,OLD-4,\n\
               Anil,M,,,OLD-9,\n\
               Sunil,M,,,OLD-1,\n";
    let mapping = json!({
        "full_name": "Name", "sex": "gender", "date_of_birth": "DOB", "phone": "Mobile",
        "legacy_id": "Old ID", "file_number": "File"
    });
    let path = "/api/v1/imports/patients";
    let request = |mode: &str| json!({ "csv": csv, "mode": mode, "mapping": mapping });
    let count = async || -> i64 {
        sqlx::query_scalar("select count(*) from aarogyam.patients")
            .fetch_one(&app.owner)
            .await
            .unwrap()
    };
    let before = count().await;

    let (code, preview) = app
        .send(
            Method::POST,
            ALPHA,
            path,
            Some(&desk),
            Some(request("preview")),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{preview}");
    assert_eq!(
        (preview["total"].as_u64(), preview["valid"].as_u64()),
        (Some(6), Some(2))
    );
    assert_eq!(preview["import_id"], Value::Null);
    let rows = preview["rows"].as_array().unwrap();
    assert_eq!(rows[0]["line"], 2);
    assert_eq!(rows[0]["valid"], true);
    assert!(
        rows[2]["errors"][0]
            .as_str()
            .unwrap()
            .starts_with("full_name")
    );
    assert_eq!(rows[3]["errors"].as_array().unwrap().len(), 3);
    assert!(
        rows[4]["errors"][0]
            .as_str()
            .unwrap()
            .contains("already has")
    );
    assert!(rows[5]["errors"][0].as_str().unwrap().contains("repeated"));
    assert!(
        !preview.to_string().contains("robot"),
        "errors never echo values"
    );
    assert_eq!(count().await, before, "a preview saves nothing");

    for (body, field) in [
        (
            json!({ "csv": csv, "mode": "preview", "mapping": { "full_name": "Nom" } }),
            "mapping",
        ),
        (
            json!({ "csv": csv, "mode": "dry", "mapping": mapping }),
            "mode",
        ),
        (
            json!({ "csv": format!("Name\n{}", "x\n".repeat(5001)), "mode": "preview", "mapping": { "full_name": "Name" } }),
            "csv",
        ),
    ] {
        let (code, error) = app
            .send(Method::POST, ALPHA, path, Some(&desk), Some(body))
            .await;
        assert_eq!(code, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            path,
            Some(&app.token(ALPHA_ASSISTANT)),
            Some(request("commit")),
        )
        .await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    let (code, commit) = app
        .send(
            Method::POST,
            ALPHA,
            path,
            Some(&desk),
            Some(request("commit")),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{commit}");
    assert!(commit["import_id"].is_string());
    assert_eq!(commit["rows"][0]["number"], "AD-3");
    assert_eq!(commit["rows"][1]["number"], "AD-4");
    assert_eq!(commit["rows"][2]["number"], Value::Null);
    assert_eq!(count().await, before + 2);
    let priya = commit["rows"][0]["patient_id"].as_str().unwrap();
    let (_, kept) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{priya}/identifiers"),
            Some(&desk),
            None,
        )
        .await;
    let kept: Vec<(&str, &str)> = kept["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["kind"].as_str().unwrap(),
                item["value"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(kept, [("file_number", "F-1"), ("legacy", "OLD-1")]);
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
    assert_eq!(opened["phone"], "+919876543210");
    let recorded: (i32, i32, i32, i64) = sqlx::query_as(
        "select i.total_rows, i.imported_rows, i.failed_rows,
                (select count(*) from aarogyam.import_rows r where r.import_id = i.id)
         from aarogyam.imports i",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(recorded, (6, 2, 4, 6));
    // The same file again: every legacy ID is now taken.
    let (_, again) = app
        .send(
            Method::POST,
            ALPHA,
            path,
            Some(&desk),
            Some(request("preview")),
        )
        .await;
    assert_eq!(again["valid"], 0);
    app.finish().await;
}
