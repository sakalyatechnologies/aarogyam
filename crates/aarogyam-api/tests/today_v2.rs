//! The data behind Today v2: the month calendar's busy days, Today for any clinic day (past
//! days show what was done, future days what is booked, money only with `finance.view`), the
//! open lab slice with its derived stage and late flag, weekly collections, and the queue's
//! `called` and `ready_to_bill` states with the doctor filter. Nothing crosses clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use aarogyam_app::appointments::{self as appointments, NewAppointment};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{
    AppointmentId, ClinicId, EncounterId, MembershipId, PatientId, PractitionerId, QueueTokenId,
    RoomId, UserId,
};
use aarogyam_domain::permission::{Permission, PermissionSet, Scope};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::macros::datetime;
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use uuid::{Uuid, uuid};

fn ist() -> UtcOffset {
    UtcOffset::from_hms(5, 30, 0).unwrap()
}

fn today() -> Date {
    OffsetDateTime::now_utc().to_offset(ist()).date()
}

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, path, Some(token), None).await
}

async fn get_ok(app: &TestApp, token: &str, path: &str) -> Value {
    let (status, value) = get(app, ALPHA, token, path).await;
    assert_eq!(status, StatusCode::OK, "GET {path}: {value}");
    value
}

async fn patient(app: &TestApp, token: &str, name: &str) -> String {
    id_of(
        &created(
            app,
            token,
            "/api/v1/patients",
            json!({ "full_name": name, "sex": "female", "age_years": 30 }),
        )
        .await,
    )
}

/// A doctor working every day, and a chair.
async fn doctor_and_chair(app: &TestApp, owner: &str) -> (String, String) {
    let doctor = id_of(
        &created(
            app,
            owner,
            "/api/v1/practitioners",
            json!({ "display_name": "Dr Asha" }),
        )
        .await,
    );
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "08:00", "ends": "20:00" }))
        .collect();
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{doctor}/working-hours"),
            Some(owner),
            Some(json!({ "shifts": shifts })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let chair = id_of(&created(app, owner, "/api/v1/rooms", json!({ "name": "Chair 1" })).await);
    (doctor, chair)
}

/// A booking for a new patient at `starts_at` for half an hour.
async fn book(app: &TestApp, owner: &str, doctor: &str, chair: &str, starts_at: &str) -> String {
    let patient = patient(app, owner, "Meera Iyer").await;
    let starts =
        OffsetDateTime::parse(starts_at, &time::format_description::well_known::Rfc3339).unwrap();
    let ends = (starts + Duration::minutes(30))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let saved = created(
        app,
        owner,
        "/api/v1/appointments",
        json!({ "patient_id": patient, "practitioner_id": doctor, "room_id": chair,
                "starts_at": starts_at, "ends_at": ends }),
    )
    .await;
    id_of(&saved["appointment"])
}

async fn set_status(app: &TestApp, owner: &str, appointment: &str, body: Value) {
    let (status, value) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/appointments/{appointment}/status"),
            Some(owner),
            Some(body.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body:?}: {value}");
}

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

fn day_of<'a>(summary: &'a Value, date: &str) -> &'a Value {
    summary["days"]
        .as_array()
        .unwrap()
        .iter()
        .find(|day| day["date"] == date)
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_month_summary_counts_each_clinic_day() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (doctor, chair) = doctor_and_chair(&app, &owner).await;
    let done = book(&app, &owner, &doctor, &chair, "2030-01-07T09:00:00+05:30").await;
    set_status(&app, &owner, &done, json!({ "status": "arrived" })).await;
    set_status(&app, &owner, &done, json!({ "status": "in_chair" })).await;
    set_status(&app, &owner, &done, json!({ "status": "completed" })).await;
    let cancelled = book(&app, &owner, &doctor, &chair, "2030-01-07T10:00:00+05:30").await;
    set_status(
        &app,
        &owner,
        &cancelled,
        json!({ "status": "cancelled", "reason": "Patient asked" }),
    )
    .await;
    book(&app, &owner, &doctor, &chair, "2030-01-07T11:00:00+05:30").await;
    let missed = book(&app, &owner, &doctor, &chair, "2030-01-09T10:00:00+05:30").await;
    set_status(&app, &owner, &missed, json!({ "status": "no_show" })).await;
    // The last evening of January and the first minutes of February in the clinic: 19:00 UTC
    // on 31 January is already 1 February in Mumbai.
    book(&app, &owner, &doctor, &chair, "2030-01-31T22:00:00+05:30").await;
    book(&app, &owner, &doctor, &chair, "2030-02-01T00:30:00+05:30").await;

    let summary = get_ok(
        &app,
        &owner,
        "/api/v1/appointments/month-summary?month=2030-01",
    )
    .await;
    assert_eq!(summary["month"], "2030-01");
    assert_eq!(summary["days"].as_array().unwrap().len(), 31);
    assert_eq!(
        day_of(&summary, "2030-01-07"),
        &json!({ "date": "2030-01-07", "booked": 1, "completed": 1, "cancelled": 1,
                 "no_shows": 0, "total": 2 })
    );
    assert_eq!(
        day_of(&summary, "2030-01-09"),
        &json!({ "date": "2030-01-09", "booked": 0, "completed": 0, "cancelled": 0,
                 "no_shows": 1, "total": 1 })
    );
    assert_eq!(day_of(&summary, "2030-01-31")["booked"], 1, "{summary}");
    assert_eq!(day_of(&summary, "2030-01-08")["total"], 0);
    let february = get_ok(
        &app,
        &owner,
        "/api/v1/appointments/month-summary?month=2030-02",
    )
    .await;
    assert_eq!(february["days"].as_array().unwrap().len(), 28);
    assert_eq!(day_of(&february, "2030-02-01")["booked"], 1, "{february}");

    // Anyone who reads the calendar may read it; nobody else.
    let assistant = app.token(ALPHA_ASSISTANT);
    let seen = get_ok(
        &app,
        &assistant,
        "/api/v1/appointments/month-summary?month=2030-01",
    )
    .await;
    assert_eq!(day_of(&seen, "2030-01-07")["total"], 2);
    let (status, _) = get(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        "/api/v1/appointments/month-summary?month=2030-01",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Beta sees none of Alpha's days.
    let (status, theirs) = get(
        &app,
        BETA,
        &app.token(BETA_OWNER),
        "/api/v1/appointments/month-summary?month=2030-01",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert!(
        theirs["days"]
            .as_array()
            .unwrap()
            .iter()
            .all(|day| day["total"] == 0 && day["cancelled"] == 0)
    );

    // Bad months are refused.
    for path in [
        "/api/v1/appointments/month-summary",
        "/api/v1/appointments/month-summary?month=2030",
        "/api/v1/appointments/month-summary?month=2030-13",
        "/api/v1/appointments/month-summary?month=1999-12",
        "/api/v1/appointments/month-summary?month=next",
    ] {
        let (status, body) = get(&app, ALPHA, &owner, path).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}: {body}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn today_shows_a_future_day_and_keeps_its_shape() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (doctor, chair) = doctor_and_chair(&app, &owner).await;
    let first = book(&app, &owner, &doctor, &chair, "2030-01-07T09:00:00+05:30").await;
    book(&app, &owner, &doctor, &chair, "2030-01-07T10:00:00+05:30").await;
    let gone = book(&app, &owner, &doctor, &chair, "2030-01-07T11:00:00+05:30").await;
    set_status(
        &app,
        &owner,
        &gone,
        json!({ "status": "cancelled", "reason": "Patient asked" }),
    )
    .await;
    book(&app, &owner, &doctor, &chair, "2030-01-08T09:00:00+05:30").await;

    let day = get_ok(&app, &owner, "/api/v1/today?date=2030-01-07").await;
    assert_eq!(day["date"], "2030-01-07");
    let listed = day["appointments"].as_array().unwrap();
    assert_eq!(
        listed.len(),
        3,
        "the day's appointments, cancelled included"
    );
    assert_eq!(listed[0]["id"], first.as_str());
    assert_eq!(day["counts"]["total"], 2);
    assert_eq!(day["counts"]["booked"], 2);
    assert_eq!(day["counts"]["cancelled"], 1);
    // A day to come has the next patient in the chair, and nobody in it, late or waiting.
    assert_eq!(day["chairs"][0]["current"], Value::Null);
    assert_eq!(day["chairs"][0]["next"]["appointment_id"], first.as_str());
    assert_eq!(day["attention"], json!([]));
    assert_eq!(day["completed_visits"], json!([]));
    assert_eq!(day["recent_patients"], json!([]));
    // A doctor with hours that weekday is on the team.
    assert_eq!(day["team"].as_array().unwrap().len(), 1);
    assert_eq!(day["team"][0]["appointments"], 2);

    // Without a date it is still today, with every field it had before.
    let now = get_ok(&app, &owner, "/api/v1/today").await;
    assert_eq!(now["date"], today().to_string());
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
        "low_stock",
        "completed_visits",
        "money",
    ] {
        assert!(now.get(key).is_some(), "{key}");
    }
    for key in [
        "total",
        "booked",
        "arrived",
        "in_chair",
        "done",
        "no_shows",
        "cancelled",
        "waiting",
        "called",
        "ready_to_bill",
    ] {
        assert!(now["counts"].get(key).is_some(), "counts.{key}");
    }

    // Money: the day's figures for finance.view, absent for everyone else.
    assert_eq!(day["money"]["collected_paise"], 0);
    let assistant = app.token(ALPHA_ASSISTANT);
    let theirs = get_ok(&app, &assistant, "/api/v1/today?date=2030-01-07").await;
    assert_eq!(theirs["money"], Value::Null);
    assert_eq!(theirs["appointments"].as_array().unwrap().len(), 3);

    // Another clinic, another day; and bad dates are refused.
    let (status, beta) = get(
        &app,
        BETA,
        &app.token(BETA_OWNER),
        "/api/v1/today?date=2030-01-07",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{beta}");
    assert_eq!(beta["appointments"], json!([]));
    let (status, _) = get(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        "/api/v1/today?date=2030-01-07",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for path in [
        "/api/v1/today?date=tomorrow",
        "/api/v1/today?date=2030-02-30",
        "/api/v1/today?date=1999-12-31",
        "/api/v1/today?date=2101-01-01",
    ] {
        let (status, body) = get(&app, ALPHA, &owner, path).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}: {body}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_past_day_shows_what_was_done() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (doctor, chair) = doctor_and_chair(&app, &owner).await;
    let people = [
        patient(&app, &owner, "Asha").await,
        patient(&app, &owner, "Bela").await,
    ];
    let db = app.api_db();
    let actor = owner_actor(&app).await;
    let id = |text: &str| Uuid::parse_str(text).unwrap();
    // Thursday 1 October 2026, in the clinic.
    let now = datetime!(2026-10-01 09:00 +05:30);
    let at = |h: u8, m: u8| now.replace_time(time::Time::from_hms(h, m, 0).unwrap());
    let book_at = async |who: usize, start: OffsetDateTime| {
        let saved = appointments::book(
            &db,
            &actor,
            None,
            NewAppointment {
                patient_id: PatientId::from_uuid(id(&people[who])),
                practitioner_id: PractitionerId::from_uuid(id(&doctor)),
                room_id: Some(RoomId::from_uuid(id(&chair))),
                branch_id: None,
                starts_at: start,
                ends_at: Some(start + Duration::minutes(30)),
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
    let seen = book_at(0, at(9, 30)).await;
    book_at(1, at(10, 30)).await;
    for (to, when) in [
        ("arrived", at(9, 25)),
        ("in_chair", at(9, 35)),
        ("completed", at(10, 0)),
    ] {
        appointments::set_status(&db, &actor, None, seen, to, None, when)
            .await
            .unwrap();
    }
    // Still booked at the end of the day: a day gone by has no chair in use and no next patient.
    // A walk-in seen and closed on that day.
    let walk_in = aarogyam_app::queue::walk_in(
        &db,
        &actor,
        None,
        aarogyam_app::queue::WalkIn {
            patient_id: PatientId::from_uuid(id(&people[1])),
            practitioner_id: None,
            branch_id: None,
        },
        at(11, 0),
    )
    .await
    .unwrap();
    let started = aarogyam_app::queue::start_visit(
        &db,
        &actor,
        None,
        QueueTokenId::from_uuid(walk_in.row.id),
        at(11, 5),
    )
    .await
    .unwrap();
    aarogyam_app::visits::close(
        &db,
        &actor,
        None,
        EncounterId::from_uuid(started.visit.id.uuid()),
        at(11, 40),
    )
    .await
    .unwrap();

    let day = get_ok(&app, &owner, "/api/v1/today?date=2026-10-01").await;
    assert_eq!(day["date"], "2026-10-01");
    assert_eq!(day["appointments"].as_array().unwrap().len(), 2);
    assert_eq!(day["counts"]["done"], 1);
    assert_eq!(day["counts"]["booked"], 1);
    assert_eq!(day["chairs"][0]["current"], Value::Null);
    assert_eq!(day["chairs"][0]["next"], Value::Null);
    assert_eq!(
        day["attention"],
        json!([]),
        "late and long waits are about now"
    );
    let queue = day["recent_patients"].as_array().unwrap();
    assert_eq!(
        queue.len(),
        2,
        "the seen appointment's token and the walk-in"
    );
    assert!(queue.iter().all(|t| t["status"] == "done"), "{queue:?}");
    let visits = day["completed_visits"].as_array().unwrap();
    assert_eq!(visits.len(), 1, "{day}");
    assert_eq!(visits[0]["patient"]["full_name"], "Bela");
    assert_eq!(visits[0]["ended_at"], "2026-10-01T06:10:00Z");
    assert_eq!(visits[0]["billed_paise"], 0, "no bill for the visit yet");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn money_on_a_day_needs_finance_view() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, &owner, "Ravi Kumar").await;
    let visit = id_of(
        &created(
            &app,
            &owner,
            &format!("/api/v1/patients/{patient}/visits"),
            json!({ "chief_complaint": "Pain" }),
        )
        .await,
    );
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{visit}/close"),
            Some(&owner),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let bill = created(
        &app,
        &owner,
        "/api/v1/invoices",
        json!({ "patient_id": patient, "encounter_id": visit,
                "items": [{ "description": "Scaling", "unit_price_paise": 300_000 }] }),
    )
    .await;
    let bill = id_of(&bill);
    let (status, issued) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/invoices/{bill}/issue"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    let (status, _) = app
        .send_with(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(&owner),
            Some(
                json!({ "patient_id": patient, "method": "upi", "amount_paise": 100_000,
                    "allocations": [{ "invoice_id": bill, "amount_paise": 100_000 }] }),
            ),
            &[("idempotency-key", "key-today-0001")],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let day = get_ok(&app, &owner, "/api/v1/today").await;
    let visits = day["completed_visits"].as_array().unwrap();
    assert_eq!(visits.len(), 1, "{day}");
    assert_eq!(visits[0]["number"].as_str().unwrap().get(..2), Some("V-"));
    assert_eq!(visits[0]["billed_paise"], 300_000);
    assert_eq!(visits[0]["paid_paise"], 100_000);
    assert_eq!(day["money"]["collected_paise"], 100_000);
    assert_eq!(day["money"]["payments"], 1);
    assert_eq!(day["money"]["invoiced_paise"], 300_000);
    assert_eq!(day["money"]["invoices"], 1);

    // The same day without finance.view: the visit, but no money anywhere.
    let assistant = app.token(ALPHA_ASSISTANT);
    let plain = get_ok(&app, &assistant, "/api/v1/today").await;
    assert_eq!(plain["completed_visits"].as_array().unwrap().len(), 1);
    assert_eq!(plain["completed_visits"][0]["billed_paise"], Value::Null);
    assert_eq!(plain["completed_visits"][0]["paid_paise"], Value::Null);
    assert_eq!(plain["money"], Value::Null);
    let text = plain.to_string();
    assert!(
        !text.contains("300000") && !text.contains("100000"),
        "{text}"
    );

    // Weekly collections: the payment is in this week, the last of eight.
    let weeks = get_ok(&app, &owner, "/api/v1/reports/collections?weeks=8").await;
    let by_week = weeks["by_week"].as_array().unwrap();
    assert_eq!(by_week.len(), 8);
    let monday = today() - Duration::days(i64::from(today().weekday().number_days_from_monday()));
    assert_eq!(by_week[7]["date"], monday.to_string());
    assert_eq!(by_week[7]["amount_paise"], 100_000);
    assert_eq!(by_week[0]["amount_paise"], 0);
    assert_eq!(weeks["to"], today().to_string());
    let one = get_ok(&app, &owner, "/api/v1/reports/collections?weeks=1").await;
    assert_eq!(one["by_week"].as_array().unwrap().len(), 1);
    for path in [
        "/api/v1/reports/collections?weeks=0",
        "/api/v1/reports/collections?weeks=53",
        "/api/v1/reports/collections?weeks=8&from=2026-01-01",
        "/api/v1/reports/collections?weeks=eight",
    ] {
        let (status, body) = get(&app, ALPHA, &owner, path).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}: {body}");
    }
    for token in [
        app.token(ALPHA_FRONT_DESK),
        app.token(ALPHA_ASSISTANT),
        app.token(ALPHA_NOTHING),
    ] {
        let (status, _) = get(&app, ALPHA, &token, "/api/v1/reports/collections?weeks=8").await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, theirs) = get(
        &app,
        BETA,
        &app.token(BETA_OWNER),
        "/api/v1/reports/collections?weeks=8",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["collected_paise"], 0);
    app.finish().await;
}

async fn lab_order(
    app: &TestApp,
    owner: &str,
    vendor: &str,
    patient: &str,
    send: bool,
    due: Option<Date>,
) -> String {
    let mut body = json!({
        "vendor_id": vendor, "patient_id": patient, "send": send,
        "items": [{ "work_type": "Crown", "teeth": [36] }],
    });
    if let Some(due) = due {
        body["due_on"] = json!(due.to_string());
    }
    id_of(&created(app, owner, "/api/v1/lab-orders", body).await)
}

async fn move_lab(app: &TestApp, owner: &str, order: &str, status: &str) {
    let (code, body) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/lab-orders/{order}/status"),
            Some(owner),
            Some(json!({ "status": status })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{status}: {body}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_open_lab_slice_has_a_stage_and_a_late_flag() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, &owner, "Ravi Kumar").await;
    let vendor = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/lab-vendors",
            json!({ "name": "Precision Lab" }),
        )
        .await,
    );
    let day = today();
    let late = lab_order(
        &app,
        &owner,
        &vendor,
        &patient,
        true,
        Some(day - Duration::days(2)),
    )
    .await;
    let soon = lab_order(
        &app,
        &owner,
        &vendor,
        &patient,
        true,
        Some(day + Duration::days(3)),
    )
    .await;
    move_lab(&app, &owner, &soon, "in_progress").await;
    let draft = lab_order(
        &app,
        &owner,
        &vendor,
        &patient,
        false,
        Some(day + Duration::days(5)),
    )
    .await;
    let back = lab_order(
        &app,
        &owner,
        &vendor,
        &patient,
        true,
        Some(day - Duration::days(1)),
    )
    .await;
    move_lab(&app, &owner, &back, "received").await;
    let fitted = lab_order(
        &app,
        &owner,
        &vendor,
        &patient,
        true,
        Some(day + Duration::days(1)),
    )
    .await;
    move_lab(&app, &owner, &fitted, "received").await;
    move_lab(&app, &owner, &fitted, "fitted").await;
    let cancelled = lab_order(&app, &owner, &vendor, &patient, false, None).await;
    move_lab(&app, &owner, &cancelled, "cancelled").await;
    let undated = lab_order(&app, &owner, &vendor, &patient, true, None).await;

    let open = get_ok(&app, &owner, "/api/v1/lab-orders?open=1").await;
    let items = open["items"].as_array().unwrap();
    let ids: Vec<&str> = items.iter().map(|o| o["id"].as_str().unwrap()).collect();
    // Soonest due first, undated last; fitted and cancelled work is not open.
    assert_eq!(
        ids,
        [
            late.as_str(),
            back.as_str(),
            soon.as_str(),
            draft.as_str(),
            undated.as_str()
        ],
        "{open}"
    );
    let stage = |index: usize| {
        (
            items[index]["pipeline_stage"].as_str().unwrap(),
            &items[index]["late"],
        )
    };
    assert_eq!(stage(0), ("sent", &json!(true)));
    assert_eq!(items[0]["days_late"], 2);
    // Back from the lab and past its day is not late: only work still at the lab is.
    assert_eq!(stage(1), ("ready_to_fit", &json!(false)));
    assert_eq!(items[1]["days_late"], Value::Null);
    assert_eq!(stage(2), ("in_progress", &json!(false)));
    assert_eq!(stage(3), ("to_send", &json!(false)));
    assert_eq!(stage(4), ("sent", &json!(false)));
    // The costs stay hidden as before, and the existing fields stay.
    assert_eq!(items[0]["status"], "sent");
    assert!(items[0].get("vendor_name").is_some());

    let same = get_ok(&app, &owner, "/api/v1/lab-orders?open=true").await;
    assert_eq!(same["items"].as_array().unwrap().len(), 5);
    let off = get_ok(&app, &owner, "/api/v1/lab-orders?open=0").await;
    assert_eq!(off["items"].as_array().unwrap().len(), 7);
    // Together with the other filters.
    let overdue = get_ok(&app, &owner, "/api/v1/lab-orders?open=1&overdue=true").await;
    assert_eq!(overdue["items"].as_array().unwrap().len(), 1);
    let sent = get_ok(&app, &owner, "/api/v1/lab-orders?open=1&status=sent").await;
    assert_eq!(sent["items"].as_array().unwrap().len(), 2);
    // Every order carries the derived fields, one order and a patient's list included.
    let one = get_ok(&app, &owner, &format!("/api/v1/lab-orders/{fitted}")).await;
    assert_eq!(one["pipeline_stage"], "fitted");
    assert_eq!(one["late"], false);
    let all = get_ok(
        &app,
        &owner,
        &format!("/api/v1/patients/{patient}/lab-orders"),
    )
    .await;
    assert!(
        all["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["id"] == late.as_str() && o["late"] == true)
    );

    let (status, body) = get(&app, ALPHA, &owner, "/api/v1/lab-orders?open=maybe").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, _) = get(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        "/api/v1/lab-orders?open=1",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, theirs) = get(
        &app,
        BETA,
        &app.token(BETA_OWNER),
        "/api/v1/lab-orders?open=1",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["items"], json!([]));
    app.finish().await;
}

async fn token_status(
    app: &TestApp,
    owner: &str,
    token: &str,
    status: &str,
) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/queue/{token}/status"),
        Some(owner),
        Some(json!({ "status": status })),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_doctor_sends_a_patient_in_and_the_desk_bills() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (doctor, _) = doctor_and_chair(&app, &owner).await;
    let other = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/practitioners",
            json!({ "display_name": "Dr Dev" }),
        )
        .await,
    );
    let asha = patient(&app, &owner, "Asha").await;
    let bela = patient(&app, &owner, "Bela").await;
    let mine = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/queue",
            json!({ "patient_id": asha, "practitioner_id": doctor }),
        )
        .await,
    );
    let theirs = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/queue",
            json!({ "patient_id": bela, "practitioner_id": other }),
        )
        .await,
    );

    // The doctor filter on the queue.
    let queue = get_ok(
        &app,
        &owner,
        &format!("/api/v1/queue?practitioner_id={doctor}"),
    )
    .await;
    let items = queue["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], mine.as_str());
    assert_eq!(
        get_ok(&app, &owner, "/api/v1/queue").await["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let (status, _) = get(&app, ALPHA, &owner, "/api/v1/queue?practitioner_id=nobody").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Send in: called, stamped once, and a repeat changes nothing.
    let path = format!("/api/v1/queue/{mine}/call");
    let (status, called) = app
        .send(Method::POST, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{called}");
    assert_eq!(called["status"], "called");
    assert!(called["called_at"].is_string());
    let (status, again) = app
        .send(Method::POST, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["called_at"], called["called_at"]);
    let day = get_ok(&app, &owner, "/api/v1/today").await;
    assert_eq!(day["counts"]["called"], 1);
    assert_eq!(
        day["counts"]["waiting"], 1,
        "only the other token still waits"
    );
    let listed = get_ok(&app, &owner, "/api/v1/queue").await;
    assert!(
        listed["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == mine.as_str() && t["status"] == "called")
    );

    // Permissions and clinics: the doctor's call needs clinical.write, and is Alpha's alone.
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/queue/{theirs}/call"),
            Some(&app.token(ALPHA_FRONT_DESK)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &path,
            Some(&app.token(BETA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The order is called, in the chair, ready to bill, done; no going back or past a step.
    let (status, refused) = token_status(&app, &owner, &mine, "ready_to_bill").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["current"]["status"], "called");
    let (status, _) = token_status(&app, &owner, &mine, "waiting").await;
    assert_ne!(status, StatusCode::OK);
    let (status, seated) = token_status(&app, &owner, &mine, "in_chair").await;
    assert_eq!(status, StatusCode::OK, "{seated}");
    let (status, refused) = app
        .send(Method::POST, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["current"]["status"], "in_chair");
    let (status, billing) = token_status(&app, &owner, &mine, "ready_to_bill").await;
    assert_eq!(status, StatusCode::OK, "{billing}");
    assert_eq!(billing["status"], "ready_to_bill");
    let day = get_ok(&app, &owner, "/api/v1/today").await;
    assert_eq!(day["counts"]["ready_to_bill"], 1);
    assert_eq!(day["counts"]["called"], 0);
    let (status, done) = token_status(&app, &owner, &mine, "done").await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert!(done["done_at"].is_string());

    // The earlier shortcuts still work: waiting straight to the chair, and a called patient
    // who leaves.
    let (status, _) = token_status(&app, &owner, &theirs, "in_chair").await;
    assert_eq!(status, StatusCode::OK);
    let late = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/queue",
            json!({ "patient_id": asha, "practitioner_id": doctor }),
        )
        .await,
    );
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/queue/{late}/call"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, left) = token_status(&app, &owner, &late, "left").await;
    assert_eq!(status, StatusCode::OK, "{left}");
    // A called patient who is seated by Start visit moves to the chair.
    let seated = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/queue",
            json!({ "patient_id": bela, "practitioner_id": doctor }),
        )
        .await,
    );
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/queue/{seated}/call"),
        Some(&owner),
        None,
    )
    .await;
    let (status, started) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/queue/{seated}/start-visit"),
            Some(&owner),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{started}");
    assert_eq!(started["token"]["status"], "in_chair");
    app.finish().await;
}
