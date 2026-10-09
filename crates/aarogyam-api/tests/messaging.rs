//! Patient messaging on a real database: staff sending, send-time consent, opt-outs and quiet
//! hours, dedupe keys, the daily budget, unsubscribe links, Resend's webhook and appointment
//! reminders. Delivery goes through the log channel.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_notify::{Notifier, PortalLinks};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp, send_with_headers};
use time::{Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

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

async fn patient(app: &TestApp, name: &str, email: &str) -> String {
    let body = json!({ "full_name": name, "email": email });
    let (status, made) = call(
        app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        "/api/v1/patients",
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn consent(app: &TestApp, patient: &str, purpose: &str) -> String {
    let path = format!("/api/v1/patients/{patient}/consents");
    let body = json!({ "purpose": purpose, "method": "verbal" });
    let (status, made) = call(app, ALPHA, ALPHA_OWNER, Method::POST, &path, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn send(app: &TestApp, body: Value) -> (StatusCode, Value) {
    call(
        app,
        ALPHA,
        ALPHA_FRONT_DESK,
        Method::POST,
        "/api/v1/messages",
        Some(body),
    )
    .await
}

fn offer(patients: &[&str]) -> Value {
    json!({
        "patient_ids": patients, "channel": "email", "template_key": "promo.offer",
        "variables": { "subject": "Free check-up camp" }, "body": "Come on Sunday."
    })
}

fn note(patients: &[&str]) -> Value {
    json!({
        "patient_ids": patients, "channel": "email", "template_key": "care.note",
        "variables": { "subject": "About your visit" }, "body": "Please bring your reports."
    })
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

/// The patient's messages, oldest first: status and skip reason.
async fn outcomes(app: &TestApp, patient: &str) -> Vec<(String, Option<String>)> {
    sqlx::query_as(
        "select status, skip_reason from aarogyam.messages where patient_id = $1::uuid
         order by created_at, id",
    )
    .bind(patient)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

/// Sets Alpha's quiet hours, `HH:MM` to `HH:MM` in the clinic's time.
async fn quiet_hours(app: &TestApp, start: &str, end: &str) {
    sqlx::query(
        "insert into aarogyam.org_settings (org_id, notifications)
         select id, jsonb_build_object('quiet_hours', jsonb_build_object('start', $1::text, 'end', $2::text))
         from aarogyam.organizations where slug = 'alpha'
         on conflict (org_id) do update set notifications = excluded.notifications",
    )
    .bind(start)
    .bind(end)
    .execute(&app.owner)
    .await
    .unwrap();
}

/// No quiet hours, so reminders and promotional messages go whenever the test runs.
async fn never_quiet(app: &TestApp) {
    quiet_hours(app, "00:00", "00:00").await;
}

fn sent(report: &Value) -> i64 {
    report["messages_sent"].as_i64().unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_send_and_list_messages_within_their_clinic() {
    let app = TestApp::start().await;
    let leela = patient(&app, "Leela M", "leela@example.test").await;
    let batch = Uuid::now_v7().to_string();
    let mut body = note(&[&leela, &leela]);
    body["batch_id"] = json!(batch);

    // Front desk sends; repeats of a patient count once; the same batch again queues nothing.
    let (status, queued) = send(&app, body.clone()).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{queued}");
    assert_eq!(
        (queued["requested"].as_i64(), queued["queued"].as_i64()),
        (Some(1), Some(1))
    );
    let (_, again) = send(&app, body.clone()).await;
    assert_eq!(
        (again["queued"].as_i64(), again["already_queued"].as_i64()),
        (Some(0), Some(1))
    );
    let report = drain(&app).await;
    assert_eq!(sent(&report), 1, "{report}");
    assert_eq!(
        sent(&drain(&app).await),
        0,
        "a duplicate dedupe key sends once"
    );

    // messages.send: the assistant has none; another clinic sees no such patient.
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_ASSISTANT,
        Method::POST,
        "/api/v1/messages",
        Some(note(&[&leela])),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        BETA,
        BETA_OWNER,
        Method::POST,
        "/api/v1/messages",
        Some(note(&[&leela])),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Free text by email only, allow-listed variables, 1 to 50 patients.
    for (bad, why) in [
        (json!({ "channel": "whatsapp" }), "whatsapp"),
        (
            json!({ "template_key": "reminder.follow_up" }),
            "body on a reminder",
        ),
        (
            json!({ "variables": { "subject": "x", "patient_name": "Leela" } }),
            "unknown variable",
        ),
        (json!({ "patient_ids": [] }), "no patients"),
        (
            json!({ "patient_ids": (0..51).map(|_| Uuid::now_v7().to_string()).collect::<Vec<_>>() }),
            "51",
        ),
    ] {
        let mut wrong = note(&[&leela]);
        for (key, value) in bad.as_object().unwrap() {
            wrong[key] = value.clone();
        }
        let (status, refused) = send(&app, wrong).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{why}: {refused}");
    }

    // The list: metadata only, patients.read, in the clinic only.
    let list = format!("/api/v1/patients/{leela}/messages");
    let (status, listed) = call(&app, ALPHA, ALPHA_ASSISTANT, Method::GET, &list, None).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let item = &listed["items"][0];
    assert_eq!(
        (item["status"].as_str(), item["kind"].as_str()),
        (Some("sent"), Some("clinic.message"))
    );
    let text = listed.to_string();
    assert!(
        !text.contains("Please bring") && !text.contains("leela@") && !text.contains("About your")
    );
    let (status, _) = call(&app, BETA, BETA_OWNER, Method::GET, &list, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&app, ALPHA, ALPHA_NOTHING, Method::GET, &list, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn contact_preferences_are_recorded_within_the_clinic() {
    let app = TestApp::start().await;
    let leela = patient(&app, "Leela M", "leela@example.test").await;
    // Preferences: patients.write; an opt-out skips queued messages it covers.
    send(&app, note(&[&leela])).await;
    let prefs = format!("/api/v1/patients/{leela}/contact-preferences");
    let opt_out = json!({ "channel": "email", "category": "all", "opted_out": true });
    let (status, saved) = call(
        &app,
        ALPHA,
        ALPHA_FRONT_DESK,
        Method::POST,
        &prefs,
        Some(opt_out.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["items"][0]["source"], "staff");
    assert_eq!(
        outcomes(&app, &leela).await.last().unwrap().1.as_deref(),
        Some("opted_out")
    );
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_ASSISTANT,
        Method::POST,
        &prefs,
        Some(opt_out.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(&app, BETA, BETA_OWNER, Method::POST, &prefs, Some(opt_out)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let opt_in = json!({ "channel": "whatsapp", "category": "all", "opted_out": false, "whatsapp_opt_in": true });
    let (status, saved) = call(&app, ALPHA, ALPHA_OWNER, Method::POST, &prefs, Some(opt_in)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["items"].as_array().unwrap().len(), 2);
    let wrong = json!({ "channel": "email", "category": "all", "opted_out": false, "whatsapp_opt_in": true });
    let (status, _) = call(&app, ALPHA, ALPHA_OWNER, Method::POST, &prefs, Some(wrong)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn consent_is_checked_when_sending_not_only_when_queuing() {
    let app = TestApp::start().await;
    never_quiet(&app).await;
    let ravi = patient(&app, "Ravi K", "ravi@example.test").await;
    let promo = consent(&app, &ravi, "promotional").await;
    let (status, queued) = send(&app, offer(&[&ravi])).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{queued}");

    // Withdrawn between queuing and sending: the queued message is skipped, nothing is sent.
    let withdraw = format!("/api/v1/consents/{promo}/withdraw");
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        &withdraw,
        Some(json!({ "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        outcomes(&app, &ravi).await,
        [("skipped".into(), Some("consent_withdrawn".into()))]
    );
    assert_eq!(sent(&drain(&app).await), 0);

    // Queued with no consent at all: the send-time check skips it.
    send(&app, offer(&[&ravi])).await;
    let report = drain(&app).await;
    assert_eq!(
        (sent(&report), report["messages_skipped"].as_i64()),
        (0, Some(1))
    );
    assert_eq!(
        outcomes(&app, &ravi).await[1].1.as_deref(),
        Some("no_consent")
    );

    // Consenting again restores it; a care note needs no consent row.
    consent(&app, &ravi, "promotional").await;
    send(&app, offer(&[&ravi])).await;
    send(&app, note(&[&ravi])).await;
    assert_eq!(sent(&drain(&app).await), 2);
    app.finish().await;
}

/// `HH:MM` in India, `minutes` from now.
fn india_clock(minutes: i64) -> String {
    let at = (OffsetDateTime::now_utc() + Duration::minutes(minutes))
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap());
    format!("{:02}:{:02}", at.hour(), at.minute())
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn quiet_hours_reschedule_reminders_and_offers_but_not_care() {
    let app = TestApp::start().await;
    quiet_hours(&app, &india_clock(-60), &india_clock(60)).await;
    let meera = patient(&app, "Meera I", "meera@example.test").await;
    consent(&app, &meera, "promotional").await;
    send(&app, offer(&[&meera])).await;
    send(&app, note(&[&meera])).await;

    let report = drain(&app).await;
    assert_eq!(
        (sent(&report), report["messages_rescheduled"].as_i64()),
        (1, Some(1)),
        "{report}"
    );
    let (status, scheduled_for, attempts): (String, OffsetDateTime, i32) = sqlx::query_as(
        "select status, scheduled_for, attempts from aarogyam.messages
         where patient_id = $1::uuid and purpose = 'promotional'",
    )
    .bind(&meera)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    // Waits for the end of quiet hours, about an hour away; not failed, not an attempt.
    assert_eq!((status.as_str(), attempts), ("queued", 0));
    let wait = scheduled_for - OffsetDateTime::now_utc();
    assert!(
        wait > Duration::minutes(55) && wait < Duration::minutes(62),
        "{wait}"
    );
    assert_eq!(sent(&drain(&app).await), 0, "not due yet");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_daily_budget_moves_the_rest_to_tomorrow() {
    let app = TestApp::start_custom(sakalya_http::HttpConfig::default(), |state| {
        state.with_notifier(Notifier::log(PortalLinks::default()).with_daily_budget(1))
    })
    .await;
    let one = patient(&app, "One P", "one@example.test").await;
    let two = patient(&app, "Two P", "two@example.test").await;
    send(&app, note(&[&one, &two])).await;
    let report = drain(&app).await;
    assert_eq!(
        (sent(&report), report["messages_deferred"].as_i64()),
        (1, Some(1)),
        "{report}"
    );
    let (status, scheduled_for): (String, OffsetDateTime) = sqlx::query_as(
        "select status, scheduled_for from aarogyam.messages where status = 'queued'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let tomorrow = (OffsetDateTime::now_utc().date() + Duration::days(1))
        .midnight()
        .assume_utc();
    assert_eq!((status.as_str(), scheduled_for), ("queued", tomorrow));
    let report = drain(&app).await;
    assert_eq!(
        (sent(&report), report["messages_claimed"].as_i64()),
        (0, Some(0))
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_unsubscribe_link_opts_out_and_reveals_nobody() {
    let app = TestApp::start().await;
    never_quiet(&app).await;
    let asha = patient(&app, "Asha P", "asha.p@example.test").await;
    consent(&app, &asha, "promotional").await;
    send(&app, offer(&[&asha])).await;
    assert_eq!(sent(&drain(&app).await), 1);
    // The email carried a token; only its hash is stored. The log channel keeps no copy, so give
    // the message a token whose hash we know.
    let (stored,): (Option<String>,) = sqlx::query_as(
        "select unsubscribe_hash from aarogyam.messages where patient_id = $1::uuid",
    )
    .bind(&asha)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(stored.map(|hash| hash.len()), Some(64));
    let token = "k3QvR2b9X1mZ0aT8wY6eL4uN7sP5cH2j";
    sqlx::query("update aarogyam.messages set unsubscribe_hash = $1 where patient_id = $2::uuid")
        .bind(aarogyam_app::tokens::hash_token(token))
        .bind(&asha)
        .execute(&app.owner)
        .await
        .unwrap();

    // No sign-in, any host; the answer says nothing about whom.
    let path = format!("/api/v1/public/unsubscribe/{token}");
    let (status, answer) = app.send(Method::POST, BETA, &path, None, None).await;
    assert_eq!(status, StatusCode::OK, "{answer}");
    assert_eq!(answer, json!({ "unsubscribed": true }));
    let (status, again) = app.send(Method::POST, ALPHA, &path, None, None).await;
    assert_eq!(
        (status, again),
        (StatusCode::OK, json!({ "unsubscribed": true }))
    );
    let (status, refused) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/public/unsubscribe/not-a-token",
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!refused.to_string().contains("asha"));

    let (category, source): (String, String) = sqlx::query_as(
        "select category, source from aarogyam.contact_preferences
         where patient_id = $1::uuid and channel = 'email' and opted_out",
    )
    .bind(&asha)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        (category.as_str(), source.as_str()),
        ("promotional", "unsubscribe_link")
    );
    // Offers stop; care messages still go.
    send(&app, offer(&[&asha])).await;
    send(&app, note(&[&asha])).await;
    let report = drain(&app).await;
    assert_eq!(
        (sent(&report), report["messages_skipped"].as_i64()),
        (1, Some(1))
    );
    assert!(
        outcomes(&app, &asha)
            .await
            .contains(&("skipped".into(), Some("opted_out".into())))
    );
    app.finish().await;
}

const WEBHOOK_SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

async fn webhook(app: &TestApp, id: &str, body: &Value, stamp: i64, tamper: bool) -> StatusCode {
    let secret = secrecy::SecretString::from(WEBHOOK_SECRET);
    let signature =
        aarogyam_notify::svix::sign(&secret, id, stamp, body.to_string().as_bytes()).unwrap();
    let mut sent_body = body.clone();
    if tamper {
        sent_body["data"]["email_id"] = json!("re_someone_else");
    }
    let stamp = stamp.to_string();
    let headers = [
        ("svix-id", id),
        ("svix-timestamp", stamp.as_str()),
        ("svix-signature", signature.as_str()),
    ];
    let path = "/api/v1/webhooks/resend";
    let (status, _) = send_with_headers(
        &app.router,
        Method::POST,
        "localhost",
        path,
        None,
        Some(sent_body),
        &headers,
    )
    .await;
    status
}

fn resend_event(kind: &str, email_id: &str, at: &str) -> Value {
    json!({ "type": kind, "created_at": at, "data": { "email_id": email_id, "to": ["x@example.test"] } })
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn resend_webhooks_are_signed_idempotent_and_bounces_opt_out() {
    let app = TestApp::start_custom(sakalya_http::HttpConfig::default(), |state| {
        state.with_notifier(
            Notifier::log(PortalLinks::default())
                .with_resend_webhook_secret(secrecy::SecretString::from(WEBHOOK_SECRET)),
        )
    })
    .await;
    let kiran = patient(&app, "Kiran B", "kiran@example.test").await;
    send(&app, note(&[&kiran])).await;
    assert_eq!(sent(&drain(&app).await), 1);
    // As if Resend had sent it: its id is what webhooks name.
    sqlx::query("update aarogyam.messages set provider = 'resend', provider_message_id = 're_1' where patient_id = $1::uuid")
        .bind(&kiran)
        .execute(&app.owner)
        .await
        .unwrap();
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let bounced = resend_event("email.bounced", "re_1", "2026-10-09T10:00:05Z");

    // Tampered, stale or unsigned: refused, nothing recorded.
    assert_eq!(
        webhook(&app, "msg_a", &bounced, now, true).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        webhook(&app, "msg_a", &bounced, now - 600, false).await,
        StatusCode::UNAUTHORIZED
    );
    let (status, _) = app
        .send(
            Method::POST,
            "localhost",
            "/api/v1/webhooks/resend",
            None,
            Some(bounced.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let events = || async {
        sqlx::query_scalar::<_, i64>("select count(*) from aarogyam.message_events")
            .fetch_one(&app.owner)
            .await
            .unwrap()
    };
    assert_eq!(events().await, 0);

    // Valid: recorded once however often it arrives; the bounce opts the patient out of email.
    assert_eq!(
        webhook(&app, "msg_a", &bounced, now, false).await,
        StatusCode::OK
    );
    assert_eq!(
        webhook(&app, "msg_a", &bounced, now, false).await,
        StatusCode::OK
    );
    assert_eq!(events().await, 1);
    // A delivery report that happened earlier but arrives later doesn't undo the bounce.
    let delivered = resend_event("email.delivered", "re_1", "2026-10-09T10:00:01Z");
    assert_eq!(
        webhook(&app, "msg_b", &delivered, now, false).await,
        StatusCode::OK
    );
    assert_eq!(events().await, 2);
    let (delivery,): (Option<String>,) =
        sqlx::query_as("select delivery from aarogyam.messages where provider_message_id = 're_1'")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(delivery.as_deref(), Some("bounced"));
    let (category, source): (String, String) = sqlx::query_as(
        "select category, source from aarogyam.contact_preferences where patient_id = $1::uuid",
    )
    .bind(&kiran)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((category.as_str(), source.as_str()), ("all", "bounce"));
    // Staff email from the outbox, or an event type we don't keep: accepted, ignored.
    let other = resend_event("email.delivered", "re_staff", "2026-10-09T10:00:01Z");
    assert_eq!(
        webhook(&app, "msg_c", &other, now, false).await,
        StatusCode::OK
    );
    let unknown = resend_event("contact.created", "re_1", "2026-10-09T10:00:01Z");
    assert_eq!(
        webhook(&app, "msg_d", &unknown, now, false).await,
        StatusCode::OK
    );
    assert_eq!(events().await, 2);
    // Without a configured secret every webhook is refused.
    let plain = TestApp::start().await;
    assert_eq!(
        webhook(&plain, "msg_e", &bounced, now, false).await,
        StatusCode::UNAUTHORIZED
    );
    plain.finish().await;
    app.finish().await;
}

/// Books `patient` with a new doctor `hours` from now, straight in the database.
async fn appointment_in(app: &TestApp, patient: &str, hours: i64) -> Uuid {
    let body = json!({ "display_name": format!("Dr Rao {hours}") });
    let (status, doctor) = call(
        app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        "/api/v1/practitioners",
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{doctor}");
    let starts_at = OffsetDateTime::now_utc() + Duration::hours(hours);
    sqlx::query_scalar(
        "insert into aarogyam.appointments (org_id, patient_id, practitioner_id, branch_id, starts_at, ends_at, status)
         select p.org_id, p.id, $2::uuid, b.id, $3, $3 + interval '30 minutes', 'confirmed'
         from aarogyam.patients p
         join lateral (select id from aarogyam.branches where org_id = p.org_id limit 1) b on true
         where p.id = $1::uuid
         returning id",
    )
    .bind(patient)
    .bind(doctor["id"].as_str().unwrap())
    .bind(starts_at)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn appointment_reminders_go_once_a_day_before_and_follow_the_appointment() {
    let app = TestApp::start().await;
    never_quiet(&app).await;
    let sunil = patient(&app, "Sunil R", "sunil@example.test").await;
    let tara = patient(&app, "Tara V", "tara@example.test").await;
    let nobody = patient(&app, "No Consent", "no.consent@example.test").await;
    for who in [&sunil, &tara] {
        consent(&app, who, "reminders").await;
    }
    let booked = appointment_in(&app, &sunil, 20).await;
    let later = appointment_in(&app, &tara, 30).await;
    appointment_in(&app, &nobody, 21).await;

    // Within 26 hours and consenting: queued once, sent now (24 hours before has passed).
    let report = drain(&app).await;
    assert_eq!(
        (report["reminders_queued"].as_i64(), sent(&report)),
        (Some(1), 1),
        "{report}"
    );
    assert_eq!(
        drain(&app).await["reminders_queued"],
        0,
        "the dedupe key holds"
    );
    let (key, purpose): (String, String) = sqlx::query_as(
        "select dedupe_key, purpose from aarogyam.messages where appointment_id = $1",
    )
    .bind(booked)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(key, aarogyam_domain::messaging::reminder_dedupe_key(booked));
    assert_eq!(purpose, "reminders");

    // Queued, then the appointment is cancelled before it goes: skipped.
    sqlx::query("update aarogyam.appointments set starts_at = now() + interval '22 hours', ends_at = now() + interval '23 hours' where id = $1")
        .bind(later)
        .execute(&app.owner)
        .await
        .unwrap();
    let queued = aarogyam_dal::message_worker::queue_reminders(
        app.api_db().pool(),
        OffsetDateTime::now_utc(),
        10,
    )
    .await
    .unwrap();
    assert_eq!(queued, 1);
    sqlx::query("update aarogyam.appointments set status = 'cancelled', cancel_reason = 'Patient called' where id = $1")
        .bind(later)
        .execute(&app.owner)
        .await
        .unwrap();
    let report = drain(&app).await;
    assert_eq!(
        (sent(&report), report["messages_skipped"].as_i64()),
        (0, Some(1)),
        "{report}"
    );
    assert_eq!(
        outcomes(&app, &tara).await,
        [("skipped".into(), Some("appointment_changed".into()))]
    );
    assert!(
        outcomes(&app, &nobody).await.is_empty(),
        "no consent, nothing queued"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn message_tables_are_per_clinic_closed_to_patients_and_erased() {
    let app = TestApp::start().await;
    let (alpha, beta) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let lata = patient(&app, "Lata S", "lata@example.test").await;
    send(&app, note(&[&lata])).await;
    let prefs = format!("/api/v1/patients/{lata}/contact-preferences");
    let opt_out = json!({ "channel": "email", "category": "promotional", "opted_out": true });
    call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        &prefs,
        Some(opt_out),
    )
    .await;

    // Every table: a restrictive deny for patient accounts, and rows only in their own clinic.
    let tables = ["contact_preferences", "messages", "message_events"];
    let denied: i64 = sqlx::query_scalar(
        "select count(*) from pg_policies where schemaname = 'aarogyam' and tablename = any($1)
         and policyname = 'patient_account' and permissive = 'RESTRICTIVE'",
    )
    .bind(&tables[..])
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(denied, 3);
    let db = app.api_db();
    for (org, expected) in [(alpha, 2_i64), (beta, 0)] {
        let seen = db
            .scoped(&sakalya_db::Scope::tenant(org), async |tx| {
                sqlx::query_scalar::<_, i64>(
                    "select (select count(*) from aarogyam.messages)
                          + (select count(*) from aarogyam.contact_preferences)",
                )
                .fetch_one(tx.conn())
                .await
                .map_err(sakalya_db::DbError::from)
            })
            .await
            .unwrap();
        assert_eq!(seen, expected);
    }

    // Erasing the patient removes their messages and preferences.
    let erased: bool = sqlx::query_scalar("select app.erase_patient($1, $2::uuid, $3)")
        .bind(alpha)
        .bind(&lata)
        .bind(Uuid::now_v7())
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert!(erased);
    let left: i64 = sqlx::query_scalar(
        "select (select count(*) from aarogyam.messages where patient_id = $1::uuid)
              + (select count(*) from aarogyam.contact_preferences where patient_id = $1::uuid)",
    )
    .bind(&lata)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(left, 0);
    app.finish().await;
}
