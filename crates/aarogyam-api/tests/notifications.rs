//! Clinic notifications for online bookings on a real database: written with the booking,
//! seen by every member who handles appointments with their own read state, handled by the
//! status change, scoped like appointments, kept in their clinic, and reminded then escalated
//! by the outbox job.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_domain::notification::OpenHours;
use aarogyam_notify::ReminderReport;
use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, Time, UtcOffset};
use uuid::{Uuid, uuid};

const RAVI: Uuid = uuid!("e0000000-0000-4000-8000-0000000000a1");
const MEERA: Uuid = uuid!("e0000000-0000-4000-8000-0000000000a2");
const DOCTOR_A: Uuid = uuid!("a0000000-0000-4000-8000-0000000000ea");
const DOCTOR_B: Uuid = uuid!("a0000000-0000-4000-8000-0000000000eb");

/// Open around the clock, and never open: the job's hours, for tests at any time of day.
const ALWAYS: OpenHours = OpenHours {
    opens: Time::MIDNIGHT,
    closes: match Time::from_hms_nano(23, 59, 59, 999_999_999) {
        Ok(time) => time,
        Err(_) => Time::MIDNIGHT,
    },
};
const NEVER: OpenHours = OpenHours {
    opens: Time::MIDNIGHT,
    closes: Time::MIDNIGHT,
};

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

/// Tomorrow in the clinic (Asia/Kolkata).
fn tomorrow() -> Date {
    OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date()
        + Duration::days(1)
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

/// Gives a practitioner working hours all day, every day.
async fn all_day(app: &TestApp, owner: &str, doctor: &str) {
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "00:00", "ends": "23:45" }))
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
}

/// A doctor in Alpha working all day, without a sign-in.
async fn doctor(app: &TestApp, owner: &str) -> String {
    let body = json!({ "display_name": "Dr Asha" });
    let doctor = id_of(&created(app, owner, "/api/v1/practitioners", body).await);
    all_day(app, owner, &doctor).await;
    doctor
}

/// Books `time` (`HH:MM`) tomorrow with `doctor` on the public page as `person`.
async fn book(app: &TestApp, doctor: &str, time: &str, person: Uuid, email: &str) -> Value {
    let token = app.tokens.mint_with_email(person, Some(email)).unwrap();
    let body = json!({
        "starts_at": format!("{}T{time}:00+05:30", tomorrow()), "practitioner_id": doctor,
        "full_name": "Priya Nair", "phone": "98765 43210", "reason": "Toothache"
    });
    let (status, booked) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/public/bookings",
            Some(&token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{booked}");
    booked
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> Value {
    let (status, body) = app.send(Method::GET, host, path, Some(token), None).await;
    assert_eq!(status, StatusCode::OK, "GET {path}: {body}");
    body
}

async fn feed(app: &TestApp, token: &str) -> Vec<Value> {
    get(app, ALPHA, token, "/api/v1/notifications").await["items"]
        .as_array()
        .unwrap()
        .clone()
}

async fn unread(app: &TestApp, token: &str) -> i64 {
    get(app, ALPHA, token, "/api/v1/notifications/count").await["unread"]
        .as_i64()
        .unwrap()
}

/// One run of the outbox job's reminder step, `minutes` from now.
async fn remind_in(app: &TestApp, minutes: i64, hours: OpenHours) -> ReminderReport {
    let at = OffsetDateTime::now_utc() + Duration::minutes(minutes);
    aarogyam_notify::remind(&app.api_db(), at, hours)
        .await
        .unwrap()
}

async fn post(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), None).await
}

async fn set_status(app: &TestApp, token: &str, appointment: &str, body: Value) {
    let path = format!("/api/v1/appointments/{appointment}/status");
    let (status, moved) = app
        .send(Method::POST, ALPHA, &path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK, "{moved}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_online_booking_tells_everyone_who_handles_appointments() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    let doctor = doctor(&app, &owner).await;
    let booked = book(&app, &doctor, "10:00", RAVI, "ravi@example.test").await;
    assert_eq!(booked["status"], "requested");
    let appointment = id_of(&booked);

    for token in [&owner, &desk, &assistant] {
        let items = feed(&app, token).await;
        assert_eq!(items.len(), 1, "{items:?}");
        let item = &items[0];
        assert_eq!(item["kind"], "booking_requested");
        assert_eq!(item["read"], false);
        assert_eq!(item["handled"], Value::Null);
        assert_eq!(item["appointment"]["id"], appointment.as_str());
        assert_eq!(item["appointment"]["status"], "requested");
        assert_eq!(item["appointment"]["practitioner_name"], "Dr Asha");
        assert!(
            item["appointment"]["starts_at"]
                .as_str()
                .unwrap()
                .ends_with("+05:30")
        );
        // IDs, times and the doctor only: nothing about the patient.
        let text = item.to_string();
        for private in ["Priya", "Nair", "Toothache", "98765", "ravi@"] {
            assert!(!text.contains(private), "{private} in {text}");
        }
        assert_eq!(unread(&app, token).await, 1);
    }

    // Read state is per person.
    let id = id_of(&feed(&app, &desk).await[0]);
    let read = format!("/api/v1/notifications/{id}/read");
    assert_eq!(
        post(&app, ALPHA, &desk, &read).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post(&app, ALPHA, &desk, &read).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(unread(&app, &desk).await, 0);
    assert_eq!(unread(&app, &owner).await, 1);
    let mine = feed(&app, &desk).await;
    assert_eq!(mine[0]["read"], true);
    assert!(mine[0]["read_at"].is_string());
    let only_unread = "/api/v1/notifications?unread_only=true";
    assert_eq!(
        get(&app, ALPHA, &desk, only_unread).await["items"],
        json!([])
    );
    assert_eq!(
        get(&app, ALPHA, &owner, only_unread).await["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(feed(&app, &owner).await[0]["read"], false);

    // Confirming handles it, by name, in the same transaction.
    set_status(&app, &desk, &appointment, json!({ "status": "confirmed" })).await;
    let item = &feed(&app, &owner).await[0];
    assert_eq!(item["appointment"]["status"], "confirmed");
    assert_eq!(item["handled"]["name"], "Farah Desk");
    assert!(item["handled"]["membership_id"].is_string());
    assert!(item["handled"]["at"].is_string());

    // Read all is per person too.
    let (status, marked) = post(&app, ALPHA, &owner, "/api/v1/notifications/read-all").await;
    assert_eq!(status, StatusCode::OK, "{marked}");
    assert_eq!(marked["marked"], 1);
    assert_eq!(unread(&app, &owner).await, 0);
    assert_eq!(unread(&app, &assistant).await, 1);

    // Paging: nothing older than the only notification; a bad cursor is refused.
    let page = format!("/api/v1/notifications?before={id}&limit=5");
    assert_eq!(get(&app, ALPHA, &owner, &page).await["items"], json!([]));
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/notifications?before=x",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // A role without appointments.read gets nothing.
    let nothing = app.token(ALPHA_NOTHING);
    for path in [
        "/api/v1/notifications",
        "/api/v1/notifications/count",
        "/api/v1/inbox",
    ] {
        let (status, _) = app
            .send(Method::GET, ALPHA, path, Some(&nothing), None)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "GET {path}");
    }
    for path in [read.as_str(), "/api/v1/notifications/read-all"] {
        assert_eq!(
            post(&app, ALPHA, &nothing, path).await.0,
            StatusCode::FORBIDDEN,
            "POST {path}"
        );
    }
    app.finish().await;
}

/// A patient record with an email, linked to `person`'s patient-app account. Returns the
/// patient's token.
async fn linked_patient(app: &TestApp, owner: &str, person: Uuid, email: &str) -> String {
    let body = json!({ "full_name": "Ravi Kumar", "sex": "male", "age_years": 40,
                       "phone": "+919876543210", "email": email });
    let patient = id_of(&created(app, owner, "/api/v1/patients", body).await);
    let path = format!("/api/v1/patients/{patient}/app-invitations");
    let invited = created(app, owner, &path, json!({})).await;
    let token = app.tokens.mint_with_email(person, Some(email)).unwrap();
    let (status, body) = app
        .send(
            Method::POST,
            "app.localtest.me",
            "/api/v1/me/patient/links",
            Some(&token),
            Some(json!({ "code": invited["code"] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    token
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn auto_confirmed_bookings_and_patient_cancellations_are_told_too() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let doctor = doctor(&app, &owner).await;
    let settings = |booking: Value| json!({ "online_booking": booking });
    let (status, saved) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            Some(settings(
                json!({ "auto_confirm": true, "reminder_minutes": 20 }),
            )),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["online_booking"]["reminder_minutes"], 20);
    assert_eq!(saved["online_booking"]["auto_confirm"], true);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            Some(settings(json!({ "reminder_minutes": 3 }))),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // From the patient app, confirmed at once: the clinic is told all the same.
    let ravi = linked_patient(&app, &owner, RAVI, "ravi@example.test").await;
    let body = json!({ "practitioner_id": doctor,
                       "starts_at": format!("{}T11:00:00+05:30", tomorrow()) });
    let (status, booked) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/me/patient/bookings",
            Some(&ravi),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{booked}");
    assert_eq!(booked["status"], "confirmed");
    let appointment = id_of(&booked);
    let items = feed(&app, &desk).await;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["kind"], "booking_confirmed_auto");
    assert_eq!(items[0]["appointment"]["id"], appointment.as_str());

    // The patient cancels: a new notification, and the earlier one counts as handled by nobody.
    let cancel = format!("/api/v1/me/patient/appointments/{appointment}/cancel");
    let (status, cancelled) = post(&app, ALPHA, &ravi, &cancel).await;
    assert_eq!(status, StatusCode::OK, "{cancelled}");
    let items = feed(&app, &desk).await;
    assert_eq!(items.len(), 2, "{items:?}");
    assert_eq!(items[0]["kind"], "booking_cancelled_by_patient");
    assert_eq!(items[0]["appointment"]["status"], "cancelled");
    assert_eq!(items[0]["handled"], Value::Null);
    assert_eq!(items[1]["kind"], "booking_confirmed_auto");
    assert!(items[1]["handled"]["at"].is_string());
    assert_eq!(items[1]["handled"]["membership_id"], Value::Null);
    assert_eq!(unread(&app, &desk).await, 2);
    // Cancelling again changes nothing.
    assert_eq!(post(&app, ALPHA, &ravi, &cancel).await.0, StatusCode::OK);
    assert_eq!(feed(&app, &desk).await.len(), 2);

    // The patient account still can't read the staff tables directly.
    let (alpha, account) = (app.clinic_id("alpha").await, RAVI);
    let account_id: Uuid =
        sqlx::query_scalar("select id from aarogyam.patient_accounts where auth_uid = $1")
            .bind(account)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let seen = app
        .api_db()
        .scoped(&patient_scope(alpha, account_id), async |tx| {
            sqlx::query_scalar::<_, i64>("select count(*) from aarogyam.staff_notifications")
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap();
    assert_eq!(seen, 0);
    app.finish().await;
}

fn patient_scope(clinic: Uuid, account: Uuid) -> Scope {
    const PATIENT_ACCOUNT: sakalya_db::ActorKind =
        match sakalya_db::ActorKind::new("patient_account") {
            Ok(kind) => kind,
            Err(_) => panic!("invalid actor kind"),
        };
    Scope::tenant(clinic)
        .with_user(account)
        .with_actor_kind(PATIENT_ACCOUNT)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn notifications_stay_in_their_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let doctor = doctor(&app, &owner).await;
    book(&app, &doctor, "10:00", RAVI, "ravi@example.test").await;
    let id = id_of(&feed(&app, &owner).await[0]);
    assert_eq!(remind_in(&app, 16, ALWAYS).await.reminded, 1);
    assert_eq!(
        post(
            &app,
            ALPHA,
            &owner,
            &format!("/api/v1/notifications/{id}/read")
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );

    // Beta's owner sees none of it, and Alpha's notification is not found there.
    assert_eq!(
        get(&app, BETA, &beta, "/api/v1/notifications").await["items"],
        json!([])
    );
    assert_eq!(
        get(&app, BETA, &beta, "/api/v1/notifications/count").await["unread"],
        0
    );
    assert_eq!(
        get(&app, BETA, &beta, "/api/v1/inbox").await["items"],
        json!([])
    );
    let read = format!("/api/v1/notifications/{id}/read");
    assert_eq!(
        post(&app, BETA, &beta, &read).await.0,
        StatusCode::NOT_FOUND
    );
    let (status, marked) = post(&app, BETA, &beta, "/api/v1/notifications/read-all").await;
    assert_eq!(
        (status, marked["marked"].as_u64()),
        (StatusCode::OK, Some(0))
    );
    // Alpha's token on Beta's host is not a member there.
    for path in [
        "/api/v1/notifications",
        "/api/v1/notifications/count",
        "/api/v1/inbox",
    ] {
        let (status, _) = app.send(Method::GET, BETA, path, Some(&owner), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "GET {path}");
    }
    assert_eq!(
        post(&app, BETA, &owner, &read).await.0,
        StatusCode::NOT_FOUND
    );

    // Row-level security hides the rows directly too.
    let (alpha, beta_id) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();
    for table in [
        "staff_notifications",
        "staff_notification_reads",
        "staff_inbox_messages",
    ] {
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
        assert_eq!(count(alpha).await, 1, "{table} at Alpha");
        assert_eq!(count(beta_id).await, 0, "{table} at Beta");
    }
    // Beta can't attach a notification to Alpha's appointment, even directly.
    let appointment: Uuid =
        sqlx::query_scalar("select appointment_id from aarogyam.staff_notifications")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let refused = db
        .scoped(&Scope::tenant(beta_id), async |tx| {
            sqlx::query("insert into aarogyam.staff_notifications (kind, appointment_id) values ('booking_requested', $1)")
                .bind(appointment)
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await;
    assert!(refused.is_err());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn unanswered_requests_are_reminded_then_escalated_to_the_owners() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let doctor = doctor(&app, &owner).await;
    let booked = book(&app, &doctor, "10:00", RAVI, "ravi@example.test").await;
    let inbox = async |token: &str, query: &str| -> Vec<Value> {
        get(&app, ALPHA, token, &format!("/api/v1/inbox{query}")).await["items"]
            .as_array()
            .unwrap()
            .clone()
    };

    // Too young, or the clinic is closed: nothing yet.
    assert_eq!(remind_in(&app, 0, ALWAYS).await, ReminderReport::default());
    let waiting = ReminderReport {
        open: 1,
        ..ReminderReport::default()
    };
    assert_eq!(remind_in(&app, 14, ALWAYS).await, waiting);
    assert_eq!(remind_in(&app, 16, NEVER).await, waiting);

    // After 15 minutes in opening hours: one reminder for everyone, once.
    assert_eq!(remind_in(&app, 16, ALWAYS).await.reminded, 1);
    assert_eq!(remind_in(&app, 17, ALWAYS).await.reminded, 0);
    let messages = inbox(&desk, "").await;
    assert_eq!(messages.len(), 1, "{messages:?}");
    assert_eq!(messages[0]["kind"], "booking_reminder");
    assert_eq!(messages[0]["audience"], "clinic");
    assert_eq!(messages[0]["open"], true);
    assert_eq!(messages[0]["appointment_id"], booked["id"]);
    assert_eq!(messages[0]["practitioner_name"], "Dr Asha");
    assert!(!messages[0].to_string().contains("Priya"));
    assert!(feed(&app, &desk).await[0]["reminded_at"].is_string());
    assert_eq!(feed(&app, &desk).await[0]["escalated_at"], Value::Null);

    // As long again after the reminder: the owners are told; the front desk isn't.
    assert_eq!(remind_in(&app, 30, ALWAYS).await.escalated, 0);
    assert_eq!(remind_in(&app, 32, ALWAYS).await.escalated, 1);
    assert_eq!(remind_in(&app, 33, ALWAYS).await, ReminderReport::default());
    let owners = inbox(&owner, "").await;
    assert_eq!(owners.len(), 2, "{owners:?}");
    assert_eq!(owners[0]["kind"], "booking_escalation");
    assert_eq!(owners[0]["audience"], "owners");
    assert_eq!(inbox(&desk, "").await.len(), 1);
    assert!(feed(&app, &owner).await[0]["escalated_at"].is_string());
    // Paging the inbox.
    let older = format!("?before={}&limit=1", owners[0]["id"].as_str().unwrap());
    assert_eq!(inbox(&owner, &older).await[0]["kind"], "booking_reminder");

    // Declining handles it: the messages close, and nothing more is sent.
    set_status(
        &app,
        &desk,
        &id_of(&booked),
        json!({ "status": "cancelled", "reason": "Doctor away" }),
    )
    .await;
    assert_eq!(inbox(&owner, "?open_only=true").await, Vec::<Value>::new());
    assert_eq!(inbox(&owner, "").await[0]["open"], false);
    assert_eq!(feed(&app, &owner).await[0]["handled"]["name"], "Farah Desk");
    assert_eq!(
        remind_in(&app, 120, ALWAYS).await,
        ReminderReport::default()
    );

    // An auto-confirmed booking is never reminded.
    sqlx::query("update aarogyam.org_settings set booking = '{\"auto_confirm\": true}'")
        .execute(&app.owner)
        .await
        .unwrap();
    book(&app, &doctor, "11:00", MEERA, "meera@example.test").await;
    assert_eq!(
        remind_in(&app, 120, ALWAYS).await,
        ReminderReport::default()
    );
    app.finish().await;
}

/// A doctor in Alpha with a sign-in and a practitioner record working all day. Returns the
/// practitioner id.
async fn signed_in_doctor(app: &TestApp, owner: &str, auth_uid: Uuid, name: &str) -> String {
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
    let body = json!({ "display_name": name, "membership_id": membership });
    let doctor = id_of(&created(app, owner, "/api/v1/practitioners", body).await);
    all_day(app, owner, &doctor).await;
    doctor
}

/// Narrows the doctor role's appointment permissions to `own`.
async fn narrow_doctors(app: &TestApp, owner: &str) {
    let role = get(app, ALPHA, owner, "/api/v1/roles/doctor").await;
    let permissions: Vec<Value> = role["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|grant| {
            let key = grant["key"].as_str().unwrap();
            let scope = if key.starts_with("appointments.") {
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
            Some(owner),
            Some(json!({ "permissions": permissions })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_doctor_limited_to_their_own_sees_only_their_bookings() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let doctor_a = signed_in_doctor(&app, &owner, DOCTOR_A, "Dr Anil").await;
    let doctor_b = signed_in_doctor(&app, &owner, DOCTOR_B, "Dr Bela").await;
    let mine = book(&app, &doctor_a, "10:00", RAVI, "ravi@example.test").await;
    let theirs = book(&app, &doctor_b, "10:00", MEERA, "meera@example.test").await;
    let anil = app.token(DOCTOR_A);

    // At `all` (the standard doctor role) both are seen.
    assert_eq!(feed(&app, &anil).await.len(), 2);
    narrow_doctors(&app, &owner).await;
    let items = feed(&app, &anil).await;
    assert_eq!(items.len(), 1, "{items:?}");
    assert_eq!(items[0]["appointment"]["id"], mine["id"]);
    assert_eq!(unread(&app, &anil).await, 1);
    // A colleague's notification is not found, as in another clinic.
    let all = feed(&app, &owner).await;
    assert_eq!(all.len(), 2);
    let colleague = all
        .iter()
        .find(|n| n["appointment"]["id"] == theirs["id"])
        .unwrap();
    let read = format!("/api/v1/notifications/{}/read", id_of(colleague));
    assert_eq!(
        post(&app, ALPHA, &anil, &read).await.0,
        StatusCode::NOT_FOUND
    );
    // Read all reaches only their own.
    let (_, marked) = post(&app, ALPHA, &anil, "/api/v1/notifications/read-all").await;
    assert_eq!(marked["marked"], 1);
    assert_eq!(unread(&app, &owner).await, 2);

    // Reminders follow the same reach; escalations go to owners only.
    assert_eq!(remind_in(&app, 16, ALWAYS).await.reminded, 2);
    let inbox = get(&app, ALPHA, &anil, "/api/v1/inbox").await;
    assert_eq!(inbox["items"].as_array().unwrap().len(), 1);
    assert_eq!(inbox["items"][0]["appointment_id"], mine["id"]);
    assert_eq!(remind_in(&app, 32, ALWAYS).await.escalated, 2);
    assert_eq!(
        get(&app, ALPHA, &anil, "/api/v1/inbox").await["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        get(&app, ALPHA, &owner, "/api/v1/inbox").await["items"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    app.finish().await;
}
