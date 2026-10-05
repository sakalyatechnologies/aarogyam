//! Patients booking for themselves on a real database: free slots on the clinic host, booking
//! with a verified email, the front desk's Confirm and Decline, double booking, matching that
//! never reveals a record, caps and throttles.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one journey end to end, step by step"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

/// A local day in the clinic (Asia/Kolkata) `days` ahead of today.
fn day(days: i64) -> Date {
    OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date()
        + Duration::days(days)
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

/// A doctor in Alpha working 09:00 to 10:00 every day, and the owner's token.
async fn clinic(app: &TestApp) -> (String, String) {
    let owner = app.token(ALPHA_OWNER);
    let doctor = id_of(
        &created(
            app,
            &owner,
            "/api/v1/practitioners",
            json!({ "display_name": "Dr Asha" }),
        )
        .await,
    );
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "09:00", "ends": "10:00" }))
        .collect();
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{doctor}/working-hours"),
            Some(&owner),
            Some(json!({ "shifts": shifts })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    (doctor, owner)
}

async fn slots(app: &TestApp, host: &str, doctor: &str, date: Date) -> (StatusCode, Value) {
    app.send(
        Method::GET,
        host,
        &format!("/api/v1/public/availability?date={date}&practitioner_id={doctor}"),
        None,
        None,
    )
    .await
}

fn local_times(body: &Value) -> Vec<String> {
    body["slots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|slot| slot.as_str().unwrap()[11..16].to_owned())
        .collect()
}

/// The RFC 3339 start of the slot at `time` (`HH:MM`) on `date`, as the API offers it.
fn at(date: Date, time: &str) -> String {
    format!("{date}T{time}:00+05:30")
}

fn verified(app: &TestApp, person: Uuid, email: &str) -> String {
    app.tokens.mint_with_email(person, Some(email)).unwrap()
}

fn request(doctor: &str, starts_at: &str) -> Value {
    json!({
        "starts_at": starts_at, "practitioner_id": doctor,
        "full_name": "Priya Nair", "phone": "98765 43210", "reason": "Toothache"
    })
}

async fn book(app: &TestApp, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        ALPHA,
        "/api/v1/public/bookings",
        token,
        Some(body),
    )
    .await
}

async fn queued(app: &TestApp, key: &str) -> Vec<(Option<String>, Value)> {
    sqlx::query_as(
        "select recipient, payload from aarogyam.outbox_events where event_key = $1 order by created_at",
    )
    .bind(key)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn free_slots_are_public_per_clinic_and_follow_the_clinic_settings() {
    let app = TestApp::start().await;
    let (doctor, owner) = clinic(&app).await;
    let target = day(3);

    let (status, open) = slots(&app, ALPHA, &doctor, target).await;
    assert_eq!(status, StatusCode::OK, "{open}");
    assert_eq!(local_times(&open), ["09:00", "09:15", "09:30", "09:45"]);
    assert_eq!(open["slot_minutes"], 15);
    assert!(open["slots"][0].as_str().unwrap().ends_with("+05:30"));
    assert!(open.get("patient").is_none());

    // Leave 09:30 to 09:45, and an appointment at 09:00 in a chair.
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/leave-blocks",
            Some(&owner),
            Some(json!({
                "practitioner_id": doctor, "starts_at": at(target, "09:30"),
                "ends_at": at(target, "09:45")
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let patient = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/patients",
            json!({ "full_name": "Ravi Kumar", "age_years": 40 }),
        )
        .await,
    );
    let chair = id_of(&created(&app, &owner, "/api/v1/rooms", json!({ "name": "Chair 1" })).await);
    created(
        &app,
        &owner,
        "/api/v1/appointments",
        json!({
            "patient_id": patient, "practitioner_id": doctor, "room_id": chair,
            "starts_at": at(target, "09:00"), "ends_at": at(target, "09:15")
        }),
    )
    .await;
    let (_, open) = slots(&app, ALPHA, &doctor, target).await;
    assert_eq!(local_times(&open), ["09:15", "09:45"]);
    assert!(!open.to_string().contains("Ravi"));

    // Bigger slots and a buffer, set by the clinic.
    let (status, settings) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            Some(json!({ "online_booking": { "slot_minutes": 30, "buffer_minutes": 15 } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{settings}");
    assert_eq!(settings["online_booking"]["slot_minutes"], 30);
    assert_eq!(settings["online_booking"]["auto_confirm"], false);
    let (_, open) = slots(&app, ALPHA, &doctor, target).await;
    assert_eq!(local_times(&open), Vec::<String>::new());
    let (status, bad) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            Some(json!({ "online_booking": { "slot_minutes": 7 } })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    assert!(
        bad["error"]["message"]
            .as_str()
            .unwrap()
            .contains("slot_minutes")
    );
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&desk),
            Some(json!({ "online_booking": { "auto_confirm": true } })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Outside the window, a bad date and a bad doctor.
    let (_, far) = slots(&app, ALPHA, &doctor, day(90)).await;
    assert_eq!(local_times(&far), Vec::<String>::new());
    let (status, _) = slots(&app, ALPHA, &doctor, day(-1)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/public/availability?date=soon&practitioner_id={doctor}"),
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The doctors list names only bookable doctors; Beta has none, and can't see Alpha's.
    let (status, options) = app
        .send(Method::GET, ALPHA, "/api/v1/public/booking", None, None)
        .await;
    assert_eq!(status, StatusCode::OK, "{options}");
    assert_eq!(options["clinic_name"], "Alpha Dental");
    assert_eq!(options["doctors"][0]["name"], "Dr Asha");
    let (_, beta) = app
        .send(Method::GET, BETA, "/api/v1/public/booking", None, None)
        .await;
    assert_eq!(beta["doctors"], json!([]));
    let (status, _) = slots(&app, BETA, &doctor, target).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "Alpha's doctor is unknown at Beta"
    );
    let (status, _) = slots(&app, "nowhere.localtest.me", &doctor, target).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // The clinic can switch it off.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            Some(json!({ "online_booking": { "enabled": false } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = slots(&app, ALPHA, &doctor, target).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_verified_patient_requests_and_the_front_desk_decides() {
    let app = TestApp::start().await;
    let (doctor, owner) = clinic(&app).await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let target = day(2);
    let person = Uuid::now_v7();
    let token = verified(&app, person, "Priya@Example.test");

    // Needs a sign-in with a verified email.
    let (status, _) = book(&app, None, request(&doctor, &at(target, "09:15"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = book(
        &app,
        Some(&app.token(person)),
        request(&doctor, &at(target, "09:15")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Only an offered slot can be taken.
    for starts in [
        at(target, "09:20"),
        at(target, "11:00"),
        at(day(-1), "09:15"),
    ] {
        let (status, body) = book(&app, Some(&token), request(&doctor, &starts)).await;
        assert_eq!(status, StatusCode::CONFLICT, "{starts}: {body}");
    }
    let mut bad = request(&doctor, &at(target, "09:15"));
    bad["phone"] = json!("12");
    let (status, _) = book(&app, Some(&token), bad).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The request: no patient record in the answer, requested until the desk confirms.
    let (status, booked) = book(&app, Some(&token), request(&doctor, &at(target, "09:15"))).await;
    assert_eq!(status, StatusCode::CREATED, "{booked}");
    assert_eq!(booked["status"], "requested");
    assert_eq!(booked["doctor_name"], "Dr Asha");
    let mut keys: Vec<_> = booked.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "clinic_name",
            "doctor_name",
            "ends_at",
            "id",
            "starts_at",
            "status"
        ]
    );
    let (_, open) = slots(&app, ALPHA, &doctor, target).await;
    assert_eq!(local_times(&open), ["09:00", "09:30", "09:45"]);

    // It is on the calendar at once, as a self-registered patient's website booking.
    let (_, calendar) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/appointments?from={target}&to={target}"),
            Some(&desk),
            None,
        )
        .await;
    let item = &calendar["items"][0];
    assert_eq!(item["status"], "requested");
    assert_eq!(item["source"], "website");
    assert_eq!(item["kind"], "new");
    assert_eq!(item["patient"]["full_name"], "Priya Nair");
    let tags: Vec<String> = sqlx::query_scalar("select unnest(tags) from aarogyam.patients")
        .fetch_all(&app.owner)
        .await
        .unwrap();
    assert_eq!(tags, ["self_registered"]);

    // One email, to the verified address, with no reason or clinical detail.
    let mail = queued(&app, "booking.requested").await;
    assert_eq!(mail.len(), 1);
    assert_eq!(mail[0].0.as_deref(), Some("priya@example.test"));
    let payload = mail[0].1.to_string();
    assert!(!payload.contains("Toothache") && !payload.contains("Priya"));
    assert!(payload.contains("Alpha Dental") && payload.contains("Dr Asha"));

    // Confirm and decline go through the status endpoint, with the right permissions.
    let path = format!(
        "/api/v1/appointments/{}/status",
        booked["id"].as_str().unwrap()
    );
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&assistant),
            Some(json!({ "status": "confirmed" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &path,
            Some(&app.token(BETA_OWNER)),
            Some(json!({ "status": "confirmed" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "status": "arrived" })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a request must be answered first"
    );
    let (status, answered) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "status": "confirmed" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{answered}");
    assert_eq!(queued(&app, "booking.confirmed").await.len(), 1);

    // A second request, declined with a reason; the slot frees up.
    let (_, second) = book(&app, Some(&token), request(&doctor, &at(target, "09:45"))).await;
    let second_path = format!(
        "/api/v1/appointments/{}/status",
        second["id"].as_str().unwrap()
    );
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &second_path,
            Some(&desk),
            Some(json!({ "status": "cancelled" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "declining needs a reason");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &second_path,
            Some(&desk),
            Some(json!({ "status": "cancelled", "reason": "Doctor unavailable" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(queued(&app, "booking.declined").await.len(), 1);
    let (_, open) = slots(&app, ALPHA, &doctor, target).await;
    assert_eq!(local_times(&open), ["09:00", "09:30", "09:45"]);

    // The clinic may auto-confirm.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            Some(json!({ "online_booking": { "auto_confirm": true } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let other = verified(&app, Uuid::now_v7(), "meera@example.test");
    let (status, auto) = book(&app, Some(&other), request(&doctor, &at(target, "09:00"))).await;
    assert_eq!(status, StatusCode::CREATED, "{auto}");
    assert_eq!(auto["status"], "confirmed");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn matching_uses_the_verified_email_and_never_shows_a_record() {
    let app = TestApp::start().await;
    let (doctor, owner) = clinic(&app).await;
    let target = day(2);
    let known = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/patients",
            json!({ "full_name": "Kavita Rao", "phone": "9000000001", "email": "kavita@example.test", "age_years": 33 }),
        )
        .await,
    );
    // A record whose phone matches but whose email doesn't is never used.
    let by_phone = id_of(
        &created(
            &app,
            &owner,
            "/api/v1/patients",
            json!({ "full_name": "Other Person", "phone": "98765 43210", "age_years": 50 }),
        )
        .await,
    );

    let token = verified(&app, Uuid::now_v7(), "kavita@example.test");
    let (status, matched) = book(&app, Some(&token), request(&doctor, &at(target, "09:00"))).await;
    assert_eq!(status, StatusCode::CREATED, "{matched}");
    let stranger = verified(&app, Uuid::now_v7(), "new@example.test");
    let (status, fresh) = book(
        &app,
        Some(&stranger),
        request(&doctor, &at(target, "09:15")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{fresh}");
    // Same shape either way.
    let shape = |body: &Value| {
        let mut keys: Vec<_> = body.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    };
    assert_eq!(shape(&matched), shape(&fresh));
    assert_eq!(matched["status"], fresh["status"]);

    let (patient, kind): (Uuid, String) =
        sqlx::query_as("select patient_id, kind from aarogyam.appointments where id = $1")
            .bind(Uuid::parse_str(matched["id"].as_str().unwrap()).unwrap())
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(patient.to_string(), known);
    assert_eq!(kind, "follow_up");
    let (name, phone): (String, Option<String>) =
        sqlx::query_as("select full_name, phone_e164 from aarogyam.patients where id = $1")
            .bind(patient)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(
        (name.as_str(), phone.as_deref()),
        ("Kavita Rao", Some("+919000000001"))
    );
    let count: i64 = sqlx::query_scalar("select count(*) from aarogyam.patients")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(
        count, 3,
        "one new self-registered patient, the others untouched"
    );
    let used: i64 =
        sqlx::query_scalar("select count(*) from aarogyam.appointments where patient_id = $1")
            .bind(Uuid::parse_str(&by_phone).unwrap())
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(used, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn open_bookings_per_person_are_capped() {
    let app = TestApp::start().await;
    let (doctor, _) = clinic(&app).await;
    let target = day(2);
    let token = verified(&app, Uuid::now_v7(), "cap@example.test");
    for time in ["09:00", "09:15"] {
        let (status, body) = book(&app, Some(&token), request(&doctor, &at(target, time))).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    let (status, body) = book(&app, Some(&token), request(&doctor, &at(target, "09:30"))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("most upcoming")
    );
    // Another person is unaffected.
    let other = verified(&app, Uuid::now_v7(), "other@example.test");
    let (status, _) = book(&app, Some(&other), request(&doctor, &at(target, "09:30"))).await;
    assert_eq!(status, StatusCode::CREATED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn two_people_racing_for_one_slot_never_both_get_it() {
    let app = TestApp::start().await;
    let (doctor, _) = clinic(&app).await;
    for (round, time) in ["09:00", "09:15", "09:30"].into_iter().enumerate() {
        let starts = at(day(2 + i64::try_from(round).unwrap()), time);
        let tokens: Vec<String> = (0..4)
            .map(|n| {
                verified(
                    &app,
                    Uuid::now_v7(),
                    &format!("racer{round}{n}@example.test"),
                )
            })
            .collect();
        let attempts: Vec<_> = tokens
            .iter()
            .map(|token| {
                let router = app.router.clone();
                let body = request(&doctor, &starts);
                let token = token.clone();
                tokio::spawn(async move {
                    support::send(
                        &router,
                        Method::POST,
                        ALPHA,
                        "/api/v1/public/bookings",
                        Some(&token),
                        Some(body),
                    )
                    .await
                })
            })
            .collect();
        let mut results = Vec::new();
        for attempt in attempts {
            results.push(attempt.await.unwrap());
        }
        let won = results
            .iter()
            .filter(|(s, _)| *s == StatusCode::CREATED)
            .count();
        let lost = results
            .iter()
            .filter(|(s, _)| *s == StatusCode::CONFLICT)
            .count();
        assert_eq!((won, lost), (1, 3), "round {round}: {results:?}");
        let held: i64 = sqlx::query_scalar(
            "select count(*) from aarogyam.appointments
             where practitioner_id = $1 and starts_at = $2::timestamptz and status = 'requested'",
        )
        .bind(Uuid::parse_str(&doctor).unwrap())
        .bind(&starts)
        .fetch_one(&app.owner)
        .await
        .unwrap();
        assert_eq!(held, 1);
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn booking_is_throttled_per_person() {
    let app = TestApp::start_custom(sakalya_http::HttpConfig::default(), |state| {
        state.with_throttle(aarogyam_api::standard_throttle().unwrap())
    })
    .await;
    let (doctor, _) = clinic(&app).await;
    let token = verified(&app, Uuid::now_v7(), "busy@example.test");
    let mut last = StatusCode::OK;
    for _ in 0..7 {
        let (status, _) = book(&app, Some(&token), request(&doctor, &at(day(2), "11:00"))).await;
        last = status;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
    // Another person has their own allowance.
    let other = verified(&app, Uuid::now_v7(), "calm@example.test");
    let (status, _) = book(&app, Some(&other), request(&doctor, &at(day(2), "11:00"))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}
