//! Portal v2 settings on a real database: the person's own profile, signing out other sessions,
//! the clinic logo, `branding.mode` auto, the booking defaults, the notification switches (each
//! one proved to change what happens) and the staff notification kinds with their links. Nothing
//! crosses clinics, and bad input is a 400.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_notify::{flag_alerts, remind_labs};
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::format_description::well_known::Rfc3339;
use time::{Date, Duration, OffsetDateTime, Time, UtcOffset};
use tower::ServiceExt;
use uuid::Uuid;

const APP: &str = "app.localtest.me";
const SETTINGS: &str = "/api/v1/settings/clinic";
const NOTIFICATIONS: &str = "/api/v1/settings/notifications";
const BOUNDARY: &str = "aarogyam-settings-boundary";

fn ist() -> UtcOffset {
    UtcOffset::from_hms(5, 30, 0).unwrap()
}

fn today() -> Date {
    OffsetDateTime::now_utc().to_offset(ist()).date()
}

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn call(
    app: &TestApp,
    host: &str,
    who: Uuid,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let token = app.token(who);
    app.send(method, host, path, Some(&token), body).await
}

async fn created(app: &TestApp, who: Uuid, path: &str, body: Value) -> Value {
    let (status, value) = call(app, ALPHA, who, Method::POST, path, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

async fn ok(app: &TestApp, method: Method, path: &str, body: Option<Value>) -> Value {
    let (status, value) = call(app, ALPHA, ALPHA_OWNER, method.clone(), path, body).await;
    assert_eq!(status, StatusCode::OK, "{method} {path}: {value}");
    value
}

async fn patient(app: &TestApp, name: &str, email: Option<&str>) -> String {
    let body = json!({ "full_name": name, "email": email });
    id_of(&created(app, ALPHA_OWNER, "/api/v1/patients", body).await)
}

async fn consent(app: &TestApp, patient: &str, purpose: &str) {
    let path = format!("/api/v1/patients/{patient}/consents");
    let body = json!({ "purpose": purpose, "method": "verbal" });
    created(app, ALPHA_OWNER, &path, body).await;
}

/// Changes Alpha's notification switches through the API.
async fn switches(app: &TestApp, body: Value) -> Value {
    ok(app, Method::PATCH, NOTIFICATIONS, Some(body)).await
}

async fn feed(app: &TestApp, host: &str, who: Uuid) -> Vec<Value> {
    let (status, feed) = call(app, host, who, Method::GET, "/api/v1/notifications", None).await;
    assert_eq!(status, StatusCode::OK, "{feed}");
    feed["items"].as_array().unwrap().clone()
}

fn of_kind(items: &[Value], kind: &str) -> Vec<Value> {
    items
        .iter()
        .filter(|item| item["kind"] == kind)
        .cloned()
        .collect()
}

async fn count_messages(app: &TestApp, kind: &str) -> i64 {
    sqlx::query_scalar("select count(*) from aarogyam.messages where kind = $1")
        .bind(kind)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

fn png() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(2048, 7);
    bytes
}

/// Posts `bytes` as a multipart field to the clinic logo route.
async fn logo(
    app: &TestApp,
    host: &str,
    who: Uuid,
    field: &str,
    bytes: &[u8],
) -> (StatusCode, Value) {
    let mut body = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"x.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::post("/api/v1/settings/clinic/logo")
        .header("host", host)
        .header("authorization", format!("Bearer {}", app.token(who)))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn doctor(app: &TestApp) -> String {
    let body = json!({ "display_name": "Dr Rao" });
    id_of(&created(app, ALPHA_OWNER, "/api/v1/practitioners", body).await)
}

/// Books `patient` with `doctor` straight in the database, `minutes` from now.
async fn appointment_in(app: &TestApp, patient: &str, doctor: &str, minutes: i64) -> Uuid {
    sqlx::query_scalar(
        "insert into aarogyam.appointments (org_id, patient_id, practitioner_id, branch_id, starts_at, ends_at, status)
         select p.org_id, p.id, $2::uuid, b.id, $3, $3 + interval '30 minutes', 'confirmed'
         from aarogyam.patients p
         join lateral (select id from aarogyam.branches where org_id = p.org_id limit 1) b on true
         where p.id = $1::uuid
         returning id",
    )
    .bind(patient)
    .bind(doctor)
    .bind(OffsetDateTime::now_utc() + Duration::minutes(minutes))
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn queue_reminders(app: &TestApp) -> i32 {
    aarogyam_dal::message_worker::queue_reminders(
        app.api_db().pool(),
        OffsetDateTime::now_utc(),
        50,
    )
    .await
    .unwrap()
}

fn instant(text: &Value) -> OffsetDateTime {
    OffsetDateTime::parse(text.as_str().unwrap(), &Rfc3339).unwrap()
}

// ---------------------------------------------------------------------------------------------
// Own profile and sessions
// ---------------------------------------------------------------------------------------------

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn people_change_their_own_name_and_phone() {
    let app = TestApp::start().await;
    let patch = |who: Uuid, body: Value| {
        let app = &app;
        async move { call(app, APP, who, Method::PATCH, "/api/v1/me", Some(body)).await }
    };
    let (status, changed) = patch(
        ALPHA_OWNER,
        json!({ "display_name": "Asha Rao", "phone": "98765 43210" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["display_name"], "Asha Rao");
    assert_eq!(changed["phone"], "+919876543210");
    // GET /me shows them too, additively.
    let (_, me) = call(&app, APP, ALPHA_OWNER, Method::GET, "/api/v1/me", None).await;
    assert_eq!(me["display_name"], "Asha Rao");
    assert_eq!(me["phone"], "+919876543210");
    assert!(me["clinics"].is_array());

    // What is left out stays; an empty phone clears it.
    let (_, name_only) = patch(ALPHA_OWNER, json!({ "display_name": "Asha R" })).await;
    assert_eq!(name_only["phone"], "+919876543210");
    let (_, cleared) = patch(ALPHA_OWNER, json!({ "phone": "" })).await;
    assert_eq!(cleared["phone"], Value::Null);
    assert_eq!(cleared["display_name"], "Asha R");

    // Bad input is a 400 that names the field.
    for (body, field) in [
        (json!({ "display_name": "" }), "display_name"),
        (json!({ "display_name": "x".repeat(300) }), "display_name"),
        (json!({ "phone": "12" }), "phone"),
    ] {
        let (status, error) = patch(ALPHA_OWNER, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(error.to_string().contains(field), "{error}");
    }

    // A phone another account holds is a conflict.
    patch(ALPHA_OWNER, json!({ "phone": "9876543210" })).await;
    let (status, error) = patch(BETA_OWNER, json!({ "phone": "9876543210" })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");

    // The change history names the person; it never keeps the phone number in the clear.
    let (actor, logged): (Option<Uuid>, Value) = sqlx::query_as(
        "select actor_user_id, changes from audit.audit_events
         where table_name = 'aarogyam.users' and action = 'update'
           and row_id = '01900000-0000-7000-8000-0000000000a1'::uuid
         order by at desc limit 1",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        actor,
        Some(uuid::uuid!("01900000-0000-7000-8000-0000000000a1"))
    );
    assert!(
        !logged.to_string().contains("9876543210"),
        "phone in the clear: {logged}"
    );
    // Nobody else's profile moved.
    let (_, beta) = call(&app, APP, BETA_OWNER, Method::GET, "/api/v1/me", None).await;
    assert_eq!(beta["display_name"], "Bina Owner");
    assert_eq!(beta["phone"], Value::Null);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn signing_out_everywhere_else_keeps_the_current_session() {
    let app = TestApp::start().await;
    let laptop = app.token(ALPHA_OWNER);
    let phone = app.token(ALPHA_OWNER);
    let tablet = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    for token in [&laptop, &phone, &tablet] {
        let (status, _) = app
            .send(Method::GET, ALPHA, "/api/v1/session", Some(token), None)
            .await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _) = app
        .send(Method::GET, BETA, "/api/v1/session", Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    let revoke = "/api/v1/me/sessions/revoke-others";
    let (status, done) = app
        .send(Method::POST, APP, revoke, Some(&laptop), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["revoked"], 2);
    for token in [&phone, &tablet] {
        let (status, _) = app
            .send(Method::GET, ALPHA, "/api/v1/session", Some(token), None)
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&laptop), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, mine) = app
        .send(Method::GET, APP, "/api/v1/me/sessions", Some(&laptop), None)
        .await;
    assert_eq!(mine["items"].as_array().unwrap().len(), 1);
    assert_eq!(mine["items"][0]["current"], true);
    // Repeating it finds nothing more, and another person's session is untouched.
    let (_, again) = app
        .send(Method::POST, APP, revoke, Some(&laptop), None)
        .await;
    assert_eq!(again["revoked"], 0);
    let (status, _) = app
        .send(Method::GET, BETA, "/api/v1/session", Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    app.finish().await;
}

// ---------------------------------------------------------------------------------------------
// Clinic logo, branding, booking
// ---------------------------------------------------------------------------------------------

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_clinic_logo_is_uploaded_and_stays_in_its_clinic() {
    let app = TestApp::start().await;
    let (status, settings) = logo(&app, ALPHA, ALPHA_OWNER, "file", &png()).await;
    assert_eq!(status, StatusCode::OK, "{settings}");
    assert_eq!(settings["name"], "Alpha Dental");
    assert_eq!(settings["letterhead"]["has_logo"], true);
    let read = ok(&app, Method::GET, SETTINGS, None).await;
    assert_eq!(read["letterhead"]["has_logo"], true);
    // Beta has none, and Beta's owner can't reach Alpha's route (404: not a member there).
    let (_, beta) = call(&app, BETA, BETA_OWNER, Method::GET, SETTINGS, None).await;
    assert_eq!(beta["letterhead"]["has_logo"], false);
    let (status, _) = logo(&app, ALPHA, BETA_OWNER, "file", &png()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Needs settings.manage; only a PNG or JPEG, and the `file` field.
    let (status, _) = logo(&app, ALPHA, ALPHA_ASSISTANT, "file", &png()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = logo(&app, ALPHA, ALPHA_OWNER, "file", b"not an image at all").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = logo(&app, ALPHA, ALPHA_OWNER, "other", &png()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let still = ok(&app, Method::GET, SETTINGS, None).await;
    assert_eq!(still["letterhead"]["has_logo"], true);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_portal_theme_may_follow_the_device() {
    let app = TestApp::start().await;
    let settings = ok(
        &app,
        Method::PATCH,
        SETTINGS,
        Some(json!({ "branding": { "brand": "#0F766E", "mode": "auto" } })),
    )
    .await;
    assert_eq!(settings["branding"]["mode"], "auto");
    let session = ok(&app, Method::GET, "/api/v1/session", None).await;
    assert_eq!(session["clinic"]["branding"]["mode"], "auto");
    // Only the key given changes.
    let dark = ok(
        &app,
        Method::PATCH,
        SETTINGS,
        Some(json!({ "branding": { "mode": "dark" } })),
    )
    .await;
    assert_eq!(dark["branding"]["mode"], "dark");
    assert_eq!(dark["branding"]["brand"], "#0F766E");
    let (status, error) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::PATCH,
        SETTINGS,
        Some(json!({ "branding": { "mode": "sepia" } })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (_, beta) = call(&app, BETA, BETA_OWNER, Method::GET, SETTINGS, None).await;
    assert_ne!(beta["branding"]["mode"], "auto");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn booking_defaults_are_validated_and_applied() {
    let app = TestApp::start().await;
    let before = ok(&app, Method::GET, SETTINGS, None).await;
    assert_eq!(before["online_booking"]["default_visit_minutes"], 30);
    assert_eq!(before["online_booking"]["auto_confirm"], false);

    for bad in [20, 0, 90] {
        let (status, error) = call(
            &app,
            ALPHA,
            ALPHA_OWNER,
            Method::PATCH,
            SETTINGS,
            Some(json!({ "online_booking": { "default_visit_minutes": bad } })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {error}");
    }
    let changed = ok(
        &app,
        Method::PATCH,
        SETTINGS,
        Some(json!({ "online_booking": { "default_visit_minutes": 45, "auto_confirm": true } })),
    )
    .await;
    assert_eq!(changed["online_booking"]["default_visit_minutes"], 45);
    assert_eq!(changed["online_booking"]["auto_confirm"], true);
    // Another setting left out stays.
    assert_eq!(
        changed["online_booking"]["slot_minutes"],
        before["online_booking"]["slot_minutes"]
    );
    let (_, beta) = call(&app, BETA, BETA_OWNER, Method::GET, SETTINGS, None).await;
    assert_eq!(beta["online_booking"]["default_visit_minutes"], 30);

    // A booking by staff without an end lasts the default; an end given is kept.
    let patient = patient(&app, "Ravi Kumar", None).await;
    let doctor = doctor(&app).await;
    let start = (OffsetDateTime::now_utc() + Duration::days(3))
        .replace_time(Time::from_hms(10, 0, 0).unwrap());
    let rfc = |at: OffsetDateTime| at.format(&Rfc3339).unwrap();
    let made = created(
        &app,
        ALPHA_OWNER,
        "/api/v1/appointments",
        json!({ "patient_id": patient, "practitioner_id": doctor, "starts_at": rfc(start) }),
    )
    .await;
    assert_eq!(
        instant(&made["appointment"]["ends_at"]) - start,
        Duration::minutes(45)
    );
    let later = start + Duration::hours(2);
    let explicit = created(
        &app,
        ALPHA_OWNER,
        "/api/v1/appointments",
        json!({ "patient_id": patient, "practitioner_id": doctor,
                "starts_at": rfc(later), "ends_at": rfc(later + Duration::minutes(20)) }),
    )
    .await;
    assert_eq!(
        instant(&explicit["appointment"]["ends_at"]) - later,
        Duration::minutes(20)
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn auto_confirm_decides_whether_an_online_booking_waits_for_the_desk() {
    let app = TestApp::start().await;
    let doctor = doctor(&app).await;
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "09:00", "ends": "12:00" }))
        .collect();
    ok(
        &app,
        Method::PUT,
        &format!("/api/v1/practitioners/{doctor}/working-hours"),
        Some(json!({ "shifts": shifts })),
    )
    .await;
    let target = today() + Duration::days(2);
    let book = |time: &'static str| {
        let person = Uuid::now_v7();
        let token = app
            .tokens
            .mint_with_email(person, Some(&format!("{person}@example.test")))
            .unwrap();
        let body = json!({
            "starts_at": format!("{target}T{time}:00+05:30"), "practitioner_id": doctor,
            "full_name": "Priya Nair", "phone": "98765 43210", "reason": "Toothache"
        });
        let app = &app;
        async move {
            app.send(
                Method::POST,
                ALPHA,
                "/api/v1/public/bookings",
                Some(&token),
                Some(body),
            )
            .await
        }
    };
    let (status, waiting) = book("09:00").await;
    assert_eq!(status, StatusCode::CREATED, "{waiting}");
    assert_eq!(waiting["status"], "requested");

    ok(
        &app,
        Method::PATCH,
        SETTINGS,
        Some(json!({ "online_booking": { "auto_confirm": true } })),
    )
    .await;
    let (status, confirmed) = book("10:00").await;
    assert_eq!(status, StatusCode::CREATED, "{confirmed}");
    assert_eq!(confirmed["status"], "confirmed");
    let items = feed(&app, ALPHA, ALPHA_OWNER).await;
    assert_eq!(of_kind(&items, "booking_requested").len(), 1);
    assert_eq!(of_kind(&items, "booking_confirmed_auto").len(), 1);
    app.finish().await;
}

// ---------------------------------------------------------------------------------------------
// Notification switches
// ---------------------------------------------------------------------------------------------

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn notification_switches_have_defaults_validation_and_keep_other_keys() {
    let app = TestApp::start().await;
    let prefs = ok(&app, Method::GET, NOTIFICATIONS, None).await;
    assert_eq!(
        prefs,
        json!({
            "reminder_24h": true, "reminder_2h": false, "receipts": false, "recall": true,
            "low_stock": true, "lab_due": true,
            "quiet_hours": { "enabled": true, "start": "21:00", "end": "09:00" }
        })
    );
    // settings.manage only.
    for who in [ALPHA_ASSISTANT, ALPHA_FRONT_DESK, ALPHA_NOTHING] {
        let (status, _) = call(&app, ALPHA, who, Method::GET, NOTIFICATIONS, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(
            &app,
            ALPHA,
            who,
            Method::PATCH,
            NOTIFICATIONS,
            Some(json!({ "receipts": true })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    // Another feature keeps its keys in the same object; a change here leaves them alone.
    sqlx::query(
        "insert into aarogyam.org_settings (org_id, notifications)
         select id, '{\"promo_weekly_cap\": 3}'::jsonb from aarogyam.organizations where slug = 'alpha'
         on conflict (org_id) do update set notifications = excluded.notifications",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let changed = switches(
        &app,
        json!({ "receipts": true, "quiet_hours": { "start": "22:30" } }),
    )
    .await;
    assert_eq!(changed["receipts"], true);
    assert_eq!(changed["reminder_24h"], true);
    assert_eq!(changed["quiet_hours"]["start"], "22:30");
    assert_eq!(changed["quiet_hours"]["end"], "09:00");
    let stored: Value = sqlx::query_scalar(
        "select s.notifications from aarogyam.org_settings s
         join aarogyam.organizations o on o.id = s.org_id where o.slug = 'alpha'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(stored["promo_weekly_cap"], 3);
    assert_eq!(stored["receipts"], true);
    // Bad quiet hours are a 400 naming the field, and change nothing.
    for (body, field) in [
        (
            json!({ "quiet_hours": { "start": "25:99" } }),
            "quiet_hours.start",
        ),
        (
            json!({ "quiet_hours": { "end": "late" } }),
            "quiet_hours.end",
        ),
        (
            json!({ "quiet_hours": { "start": "09:00" } }),
            "quiet_hours",
        ),
    ] {
        let (status, error) = call(
            &app,
            ALPHA,
            ALPHA_OWNER,
            Method::PATCH,
            NOTIFICATIONS,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(error.to_string().contains(field), "{field}: {error}");
    }
    let same = ok(&app, Method::GET, NOTIFICATIONS, None).await;
    assert_eq!(same["quiet_hours"]["start"], "22:30");
    // Beta has its own, untouched; Beta's owner can't reach Alpha's.
    let (_, beta) = call(&app, BETA, BETA_OWNER, Method::GET, NOTIFICATIONS, None).await;
    assert_eq!(beta["receipts"], false);
    assert_eq!(beta["quiet_hours"]["start"], "21:00");
    let (status, _) = call(&app, ALPHA, BETA_OWNER, Method::GET, NOTIFICATIONS, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

async fn pay(app: &TestApp, patient: &str, bill: &str, key: &str, paise: i64) -> StatusCode {
    let body = json!({ "patient_id": patient, "method": "upi", "amount_paise": paise,
        "allocations": [{ "invoice_id": bill, "amount_paise": paise }] });
    let (status, paid) = app
        .send_with(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(&app.token(ALPHA_OWNER)),
            Some(body),
            &[("idempotency-key", key)],
        )
        .await;
    assert!(status.is_success(), "{paid}");
    status
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_receipts_switch_decides_whether_a_payment_queues_a_receipt() {
    let app = TestApp::start().await;
    let patient = patient(&app, "Priya Sharma", Some("priya@example.test")).await;
    let line = json!([{ "description": "Scaling", "unit_price_paise": 100_000 }]);
    let bill = id_of(
        &created(
            &app,
            ALPHA_OWNER,
            "/api/v1/invoices",
            json!({ "patient_id": patient, "items": line }),
        )
        .await,
    );
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/invoices/{bill}/issue"),
        None,
    )
    .await;
    // Off by default: no receipt is queued.
    pay(&app, &patient, &bill, "receipt-key-0001", 30_000).await;
    assert_eq!(count_messages(&app, "payment.receipt").await, 0);
    // On: the next payment queues exactly one, tied to the payment.
    switches(&app, json!({ "receipts": true })).await;
    pay(&app, &patient, &bill, "receipt-key-0002", 30_000).await;
    assert_eq!(count_messages(&app, "payment.receipt").await, 1);
    let (key, purpose): (String, String) = sqlx::query_as(
        "select dedupe_key, purpose from aarogyam.messages where kind = 'payment.receipt'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(key.starts_with("receipt:"), "{key}");
    assert_eq!(purpose, "care");
    // A retry of the same payment finds it and queues nothing more.
    let again = pay(&app, &patient, &bill, "receipt-key-0002", 30_000).await;
    assert_eq!(again, StatusCode::OK);
    assert_eq!(count_messages(&app, "payment.receipt").await, 1);
    // Switched off again, the next payment queues none.
    switches(&app, json!({ "receipts": false })).await;
    pay(&app, &patient, &bill, "receipt-key-0003", 10_000).await;
    assert_eq!(count_messages(&app, "payment.receipt").await, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_reminder_switches_decide_which_reminders_are_queued() {
    let app = TestApp::start().await;
    switches(&app, json!({ "quiet_hours": { "enabled": false } })).await;
    let doctor = doctor(&app).await;
    let sunil = patient(&app, "Sunil R", Some("sunil@example.test")).await;
    let tara = patient(&app, "Tara V", Some("tara@example.test")).await;
    for who in [&sunil, &tara] {
        consent(&app, who, "reminders").await;
    }
    let day_before = appointment_in(&app, &sunil, &doctor, 20 * 60).await;

    // The day-before reminder is on by default; switched off, nothing is queued.
    switches(&app, json!({ "reminder_24h": false })).await;
    assert_eq!(queue_reminders(&app).await, 0);
    switches(&app, json!({ "reminder_24h": true })).await;
    assert_eq!(queue_reminders(&app).await, 1);
    let key: String =
        sqlx::query_scalar("select dedupe_key from aarogyam.messages where appointment_id = $1")
            .bind(day_before)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert!(key.ends_with(":24h"), "{key}");

    // An appointment under two and a half hours away: with the two-hour reminder on it gets that
    // one (saying so), and only that.
    let soon = appointment_in(&app, &tara, &doctor, 100).await;
    switches(&app, json!({ "reminder_2h": true })).await;
    assert_eq!(queue_reminders(&app).await, 1);
    let (key, variables): (String, Value) = sqlx::query_as(
        "select dedupe_key, variables from aarogyam.messages where appointment_id = $1",
    )
    .bind(soon)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(key.ends_with(":2h"), "{key}");
    assert_eq!(variables["lead_hours"], 2);
    assert_eq!(queue_reminders(&app).await, 0, "each is queued once");
    app.finish().await;
}

async fn drain(app: &TestApp) -> Value {
    let (status, report) = app
        .send(
            Method::POST,
            "localhost",
            "/api/v1/internal/outbox/drain",
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    report
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_quiet_hours_switch_lets_offers_go_at_any_hour() {
    let app = TestApp::start().await;
    let clock = |minutes: i64| {
        let at = (OffsetDateTime::now_utc() + Duration::minutes(minutes)).to_offset(ist());
        format!("{:02}:{:02}", at.hour(), at.minute())
    };
    switches(
        &app,
        json!({ "quiet_hours": { "enabled": true, "start": clock(-60), "end": clock(60) } }),
    )
    .await;
    let meera = patient(&app, "Meera I", Some("meera@example.test")).await;
    consent(&app, &meera, "promotional").await;
    let (status, queued) = call(
        &app,
        ALPHA,
        ALPHA_FRONT_DESK,
        Method::POST,
        "/api/v1/messages",
        Some(json!({
            "patient_ids": [meera], "channel": "email", "template_key": "promo.offer",
            "variables": { "subject": "Camp" }, "body": "Come on Sunday."
        })),
    )
    .await;
    assert!(status.is_success(), "{queued}");
    let held = drain(&app).await;
    assert_eq!(held["messages_rescheduled"], 1, "{held}");
    assert_eq!(held["messages_sent"], 0);
    // Switched off, the held offer goes at its next try.
    switches(&app, json!({ "quiet_hours": { "enabled": false } })).await;
    sqlx::query("update aarogyam.messages set scheduled_for = now() where status = 'queued'")
        .execute(&app.owner)
        .await
        .unwrap();
    let sent = drain(&app).await;
    assert_eq!(sent["messages_sent"], 1, "{sent}");
    assert_eq!(sent["messages_rescheduled"], 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_lab_switch_decides_whether_overdue_work_alerts_staff() {
    let app = TestApp::start().await;
    let vendor = id_of(
        &created(
            &app,
            ALPHA_OWNER,
            "/api/v1/lab-vendors",
            json!({ "name": "Precision Lab" }),
        )
        .await,
    );
    let patient = patient(&app, "Ravi Kumar", None).await;
    let order = || {
        let body = json!({
            "vendor_id": vendor, "patient_id": patient, "send": true,
            "due_on": (today() + Duration::days(2)).to_string(),
            "items": [{ "work_type": "Crown", "teeth": [36] }],
        });
        let app = &app;
        async move { created(app, ALPHA_OWNER, "/api/v1/lab-orders", body).await }
    };
    let run_late = || async {
        let day = (today() + Duration::days(3)).with_time(Time::from_hms(10, 0, 0).unwrap());
        remind_labs(&app.api_db(), day.assume_offset(ist()))
            .await
            .unwrap()
            .overdue
    };
    switches(&app, json!({ "lab_due": false })).await;
    order().await;
    assert_eq!(run_late().await, 1, "the order is still flagged overdue");
    assert_eq!(
        of_kind(&feed(&app, ALPHA, ALPHA_OWNER).await, "lab_overdue").len(),
        0
    );
    switches(&app, json!({ "lab_due": true })).await;
    order().await;
    assert_eq!(run_late().await, 1);
    assert_eq!(
        of_kind(&feed(&app, ALPHA, ALPHA_OWNER).await, "lab_overdue").len(),
        1
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_low_stock_switch_decides_whether_today_lists_it() {
    let app = TestApp::start().await;
    let item = id_of(
        &created(
            &app,
            ALPHA_OWNER,
            "/api/v1/inventory-items",
            json!({ "name": "Gauze", "category": "restorative", "unit": "box", "reorder_level": 10 }),
        )
        .await,
    );
    created(
        &app,
        ALPHA_OWNER,
        "/api/v1/stock/receive",
        json!({ "item_id": item, "quantity": 3, "unit_cost_paise": 4500, "batch_no": "B-1" }),
    )
    .await;
    let low = |today: &Value| today["low_stock"].as_array().map_or(0, Vec::len);
    let shown = ok(&app, Method::GET, "/api/v1/today", None).await;
    assert_eq!(low(&shown), 1, "{shown}");
    switches(&app, json!({ "low_stock": false })).await;
    let hidden = ok(&app, Method::GET, "/api/v1/today", None).await;
    assert_eq!(low(&hidden), 0, "{hidden}");
    // The stock itself is still there for the stock screen.
    let stock = ok(&app, Method::GET, "/api/v1/stock/low", None).await;
    assert_eq!(stock["items"].as_array().unwrap().len(), 1);
    switches(&app, json!({ "low_stock": true })).await;
    let back = ok(&app, Method::GET, "/api/v1/today", None).await;
    assert_eq!(low(&back), 1);
    app.finish().await;
}

// ---------------------------------------------------------------------------------------------
// Staff notification kinds with links
// ---------------------------------------------------------------------------------------------

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_recall_switch_decides_whether_a_follow_up_alerts_staff() {
    let app = TestApp::start().await;
    let patient = patient(&app, "Meera Iyer", None).await;
    let yesterday = (today() - Duration::days(1)).to_string();
    let recall = created(
        &app,
        ALPHA_OWNER,
        &format!("/api/v1/patients/{patient}/recalls"),
        json!({ "due_on": yesterday, "reason": "Six-month cleaning", "kind": "cleaning" }),
    )
    .await;
    let recall_id = id_of(&recall);
    let now = OffsetDateTime::now_utc();

    switches(&app, json!({ "recall": false })).await;
    assert_eq!(flag_alerts(&app.api_db(), now).await.unwrap().recalls, 0);
    assert_eq!(
        of_kind(&feed(&app, ALPHA, ALPHA_OWNER).await, "recall_due").len(),
        0
    );

    switches(&app, json!({ "recall": true })).await;
    assert_eq!(flag_alerts(&app.api_db(), now).await.unwrap().recalls, 1);
    assert_eq!(
        flag_alerts(&app.api_db(), now).await.unwrap().recalls,
        0,
        "once per recall"
    );
    let items = of_kind(&feed(&app, ALPHA, ALPHA_OWNER).await, "recall_due");
    assert_eq!(items.len(), 1);
    let alert = &items[0];
    assert_eq!(alert["href"], format!("/patients/{patient}"));
    assert_eq!(alert["recall"]["id"], recall_id);
    assert_eq!(alert["recall"]["kind"], "cleaning");
    assert_eq!(alert["recall"]["due_on"], yesterday);
    assert!(
        !alert.to_string().contains("Six-month cleaning"),
        "the reason can hold health information"
    );
    assert!(alert["handled"].is_null());
    // Seen with patients.read; a role with none of the feed's permissions gets 403.
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_NOTHING,
        Method::GET,
        "/api/v1/notifications",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        of_kind(&feed(&app, ALPHA, ALPHA_ASSISTANT).await, "recall_due").len(),
        1
    );
    // Nothing crosses clinics: Beta sees none and can't mark Alpha's alert read.
    assert_eq!(feed(&app, BETA, BETA_OWNER).await.len(), 0);
    let read = format!("/api/v1/notifications/{}/read", id_of(alert));
    let (status, _) = call(&app, BETA, BETA_OWNER, Method::POST, &read, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Doing the recall handles the alert.
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/recalls/{recall_id}/done"),
        None,
    )
    .await;
    let items = of_kind(&feed(&app, ALPHA, ALPHA_OWNER).await, "recall_due");
    assert!(items[0]["handled"].is_object(), "{}", items[0]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one scenario walks each kind of alert in turn"
)]
async fn arrivals_the_queue_and_bills_tell_staff_with_a_link() {
    let app = TestApp::start().await;
    let doctor = doctor(&app).await;
    let patient = patient(&app, "Priya Sharma", Some("priya@example.test")).await;

    // A booked patient arrives: `arrival`, about the appointment, linking to the queue.
    let appointment = appointment_in(&app, &patient, &doctor, 30).await;
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/appointments/{appointment}/status"),
        Some(json!({ "status": "arrived" })),
    )
    .await;
    let items = feed(&app, ALPHA, ALPHA_OWNER).await;
    let arrival = &of_kind(&items, "arrival")[0];
    assert_eq!(arrival["href"], "/queue");
    assert_eq!(arrival["appointment"]["id"], appointment.to_string());

    // Their token has waited: `patient_waiting` from the reminder job, once, linking to the queue.
    let token: Uuid =
        sqlx::query_scalar("select id from aarogyam.queue_tokens where appointment_id = $1")
            .bind(appointment)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let later = OffsetDateTime::now_utc() + Duration::minutes(20);
    assert_eq!(flag_alerts(&app.api_db(), later).await.unwrap().waiting, 1);
    assert_eq!(flag_alerts(&app.api_db(), later).await.unwrap().waiting, 0);
    let items = feed(&app, ALPHA, ALPHA_OWNER).await;
    let waiting = &of_kind(&items, "patient_waiting")[0];
    assert_eq!(waiting["href"], "/queue");
    assert_eq!(waiting["queue_token"]["id"], token.to_string());
    assert!(waiting["queue_token"]["number"].is_number());

    // The doctor sends them in: `send_in`, and the waiting alert is handled.
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/queue/{token}/status"),
        Some(json!({ "status": "in_chair" })),
    )
    .await;
    let items = feed(&app, ALPHA, ALPHA_OWNER).await;
    let send_in = &of_kind(&items, "send_in")[0];
    assert_eq!(send_in["href"], "/queue");
    assert_eq!(send_in["queue_token"]["id"], token.to_string());
    assert!(of_kind(&items, "patient_waiting")[0]["handled"].is_object());
    assert!(of_kind(&items, "arrival")[0]["handled"].is_object());

    // A visit closes while its bill is still a draft: `collect_payment`, linking to the bill.
    let visit = id_of(
        &created(
            &app,
            ALPHA_OWNER,
            &format!("/api/v1/patients/{patient}/visits"),
            json!({ "chief_complaint": "Pain" }),
        )
        .await,
    );
    let line = json!([{ "description": "Scaling", "unit_price_paise": 100_000 }]);
    let bill = id_of(
        &created(
            &app,
            ALPHA_OWNER,
            "/api/v1/invoices",
            json!({ "patient_id": patient, "encounter_id": visit, "items": line }),
        )
        .await,
    );
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        None,
    )
    .await;
    let items = feed(&app, ALPHA, ALPHA_OWNER).await;
    let collect = &of_kind(&items, "collect_payment")[0];
    assert_eq!(collect["href"], format!("/billing/invoices/{bill}"));
    assert_eq!(collect["invoice"]["id"], bill);
    assert!(collect["invoice"]["number"].is_null(), "still a draft");

    // Issuing that bill adds no second alert; a bill issued on its own writes `payment_due`,
    // and paying it in full handles the alert.
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/invoices/{bill}/issue"),
        None,
    )
    .await;
    assert_eq!(
        of_kind(&feed(&app, ALPHA, ALPHA_OWNER).await, "payment_due").len(),
        0
    );
    let other = id_of(
        &created(
            &app,
            ALPHA_OWNER,
            "/api/v1/invoices",
            json!({ "patient_id": patient, "items": line }),
        )
        .await,
    );
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/invoices/{other}/issue"),
        None,
    )
    .await;
    let items = feed(&app, ALPHA, ALPHA_OWNER).await;
    let due = of_kind(&items, "payment_due");
    assert_eq!(due.len(), 1, "{items:?}");
    assert_eq!(due[0]["href"], format!("/billing/invoices/{other}"));
    assert_eq!(due[0]["invoice"]["id"], other);
    assert!(due[0]["invoice"]["number"].is_string());
    pay(&app, &patient, &other, "settle-0000-0001", 100_000).await;
    let items = feed(&app, ALPHA, ALPHA_OWNER).await;
    assert!(of_kind(&items, "payment_due")[0]["handled"].is_object());

    // Nothing crosses clinics: Beta sees none of it and can't mark Alpha's alert read.
    assert_eq!(feed(&app, BETA, BETA_OWNER).await.len(), 0);
    let (status, _) = call(
        &app,
        BETA,
        BETA_OWNER,
        Method::POST,
        &format!("/api/v1/notifications/{}/read", id_of(&due[0])),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let count = ok(&app, Method::GET, "/api/v1/notifications/count", None).await;
    assert!(count["unread"].as_i64().unwrap() >= 4, "{count}");
    app.finish().await;
}
