//! Automatic patient messages (BE7): the welcome after a walk-in registers, the visit summary
//! link and its PIN after a close, and the follow-up booking message. Each is written in the
//! transaction of its event, respects the clinic's switches and the patient's contact
//! preferences, stays inside the clinic, and is never repeated.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one patient from start to finish"
)]

mod support;

use aarogyam_domain::messaging::placeholders;
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime};

async fn post(
    app: &TestApp,
    host: &str,
    who: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(who), Some(body))
        .await
}

async fn patient(app: &TestApp, token: &str, name: &str, email: &str) -> String {
    let (status, made) = post(
        app,
        ALPHA,
        token,
        "/api/v1/patients",
        json!({ "full_name": name, "email": email, "phone": "98765 43210" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn visit(app: &TestApp, token: &str, patient: &str) -> String {
    let (status, made) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Toothache" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn close(app: &TestApp, token: &str, host: &str, visit: &str, body: Value) -> StatusCode {
    post(
        app,
        host,
        token,
        &format!("/api/v1/visits/{visit}/close"),
        body,
    )
    .await
    .0
}

/// The patient's automatic messages, oldest first: kind, channel, status, skip reason.
async fn rows(app: &TestApp, patient: &str) -> Vec<(String, String, String, Option<String>)> {
    sqlx::query_as(
        "select kind, channel, status, skip_reason from aarogyam.messages
         where patient_id = $1::uuid and dedupe_key like 'auto:%' order by created_at, id",
    )
    .bind(patient)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

async fn count(app: &TestApp, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(sql.to_owned()))
        .fetch_one(&app.owner)
        .await
        .unwrap()
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

async fn set_switches(app: &TestApp, token: &str, switches: Value) {
    let (status, body) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(token),
            Some(json!({ "auto_messages": switches })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

fn walk_in(name: &str, email: &str) -> Value {
    json!({ "patient": { "full_name": name, "phone": "98765 11111", "email": email,
                         "preferred_language": "hi-IN" },
            "no_known_allergies": true })
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_new_walk_in_gets_one_welcome_and_an_existing_one_none() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, first) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        walk_in("Sunita Patil", "sunita@example.in"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let id = first["patient"]["id"].as_str().unwrap().to_owned();
    let welcome = rows(&app, &id).await;
    assert_eq!(
        welcome,
        [(
            "patient.welcome".into(),
            "email".into(),
            "queued".into(),
            None
        )]
    );
    // Only links go in the message: no name, no phone, no email.
    let stored: (Value, Option<String>) = sqlx::query_as(
        "select variables, secret from aarogyam.messages where patient_id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(stored.0, json!({}));
    assert!(stored.1.is_none());
    // The same patient walking in again is not new: still one welcome.
    let (status, again) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        json!({ "patient_id": id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again["registered"], false);
    assert_eq!(rows(&app, &id).await.len(), 1);
    // The worker sends it (the log channel here).
    let report = drain(&app).await;
    assert!(report["messages_sent"].as_i64().unwrap() >= 1, "{report}");
    assert_eq!(rows(&app, &id).await[0].2, "sent");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_clinic_switches_decide_and_default_as_documented() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, settings) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{settings}");
    assert_eq!(
        settings["auto_messages"],
        json!({ "welcome": true, "visit_summary": true, "follow_up_booking": false })
    );
    set_switches(&app, &owner, json!({ "welcome": false })).await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, off) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        walk_in("Asha Rao", "asha@example.in"),
    )
    .await;
    let id = off["patient"]["id"].as_str().unwrap().to_owned();
    assert!(rows(&app, &id).await.is_empty());
    // Other switches keep their values.
    let (_, settings) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(settings["auto_messages"]["visit_summary"], true);
    // A visit close with the summary off writes nothing and makes no link.
    set_switches(&app, &owner, json!({ "visit_summary": false })).await;
    let visit = visit(&app, &owner, &id).await;
    assert_eq!(
        close(&app, &owner, ALPHA, &visit, json!({})).await,
        StatusCode::OK
    );
    assert!(rows(&app, &id).await.is_empty());
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.share_links where resource = 'visit'"
        )
        .await,
        0
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn closing_queues_the_summary_and_its_pin_once_and_a_repeat_adds_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = patient(&app, &owner, "Meera Shah", "meera@example.in").await;
    let visit = visit(&app, &owner, &id).await;
    assert_eq!(
        close(&app, &owner, ALPHA, &visit, json!({})).await,
        StatusCode::OK
    );
    assert_eq!(
        rows(&app, &id).await,
        [
            (
                "visit.summary".into(),
                "email".into(),
                "queued".into(),
                None
            ),
            (
                "visit.summary_pin".into(),
                "email".into(),
                "queued".into(),
                None
            ),
        ]
    );
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.share_links where resource = 'visit'"
        )
        .await,
        1
    );
    // The link's token and the PIN wait only in the one-time secret column, never in variables.
    let secrets: Vec<(Value, Option<String>)> = sqlx::query_as(
        "select variables, secret from aarogyam.messages
         where patient_id = $1::uuid order by created_at, id",
    )
    .bind(&id)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert!(
        secrets
            .iter()
            .all(|(vars, secret)| *vars == json!({}) && secret.is_some())
    );
    // Closing again (an offline retry) returns 200 and queues nothing new.
    assert_eq!(
        close(&app, &owner, ALPHA, &visit, json!({})).await,
        StatusCode::OK
    );
    assert_eq!(rows(&app, &id).await.len(), 2);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.share_links where resource = 'visit'"
        )
        .await,
        1
    );
    // Sending clears the secrets.
    drain(&app).await;
    let left = count(
        &app,
        "select count(*) from aarogyam.messages where secret is not null",
    )
    .await;
    assert_eq!(left, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_visit_that_already_has_a_live_link_is_not_sent_a_second() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = patient(&app, &owner, "Ravi Rao", "ravi@example.in").await;
    let visit = visit(&app, &owner, &id).await;
    let (status, link) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/share"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    assert_eq!(
        close(&app, &owner, ALPHA, &visit, json!({})).await,
        StatusCode::OK
    );
    assert!(rows(&app, &id).await.is_empty());
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.share_links where resource = 'visit'"
        )
        .await,
        1
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_opt_out_is_recorded_as_a_skip_and_makes_no_link() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = patient(&app, &owner, "Leela Mehta", "leela@example.in").await;
    let (status, saved) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{id}/contact-preferences"),
        json!({ "channel": "email", "category": "all", "opted_out": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let visit = visit(&app, &owner, &id).await;
    assert_eq!(
        close(&app, &owner, ALPHA, &visit, json!({})).await,
        StatusCode::OK
    );
    assert_eq!(
        rows(&app, &id).await,
        [(
            "visit.summary".into(),
            "email".into(),
            "skipped".into(),
            Some("opted_out".into())
        )]
    );
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.share_links where resource = 'visit'"
        )
        .await,
        0
    );
    // No address is a skip too.
    let (_, bare) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "No Contact" }),
    )
    .await;
    let bare = bare["id"].as_str().unwrap().to_owned();
    let visit = visit_of(&app, &owner, &bare).await;
    assert_eq!(
        close(&app, &owner, ALPHA, &visit, json!({})).await,
        StatusCode::OK
    );
    assert_eq!(rows(&app, &bare).await[0].3.as_deref(), Some("no_address"));
    app.finish().await;
}

async fn visit_of(app: &TestApp, token: &str, patient: &str) -> String {
    visit(app, token, patient).await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_follow_up_message_waits_until_two_days_before_and_needs_reminder_consent() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = patient(&app, &owner, "Meera Shah", "meera@example.in").await;
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{id}/consents"),
        json!({ "purpose": "reminders", "method": "verbal" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let today = OffsetDateTime::now_utc().date();
    let due = |days: i64| (today + Duration::days(days)).to_string();
    // Off by default: a follow-up alone sends nothing about it.
    let first = visit(&app, &owner, &id).await;
    close(
        &app,
        &owner,
        ALPHA,
        &first,
        json!({ "follow_up_on": due(10) }),
    )
    .await;
    assert!(
        rows(&app, &id)
            .await
            .iter()
            .all(|row| row.0 != "visit.follow_up_booking")
    );
    set_switches(&app, &owner, json!({ "follow_up_booking": true })).await;
    let second = visit(&app, &owner, &id).await;
    assert_eq!(
        close(
            &app,
            &owner,
            ALPHA,
            &second,
            json!({ "follow_up_on": due(10) })
        )
        .await,
        StatusCode::OK
    );
    let follow_ups: Vec<_> = rows(&app, &id)
        .await
        .into_iter()
        .filter(|row| row.0 == "visit.follow_up_booking")
        .collect();
    assert_eq!(follow_ups.len(), 1);
    assert_eq!(follow_ups[0].2, "queued");
    let (at, vars): (OffsetDateTime, Value) = sqlx::query_as(
        "select scheduled_for, variables from aarogyam.messages
         where kind = 'visit.follow_up_booking' and patient_id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(at > OffsetDateTime::now_utc() + Duration::days(7), "{at}");
    assert!(at < OffsetDateTime::now_utc() + Duration::days(9), "{at}");
    assert_eq!(vars.as_object().unwrap().len(), 1);
    // A follow-up closer than two days goes now.
    let third = visit(&app, &owner, &id).await;
    close(
        &app,
        &owner,
        ALPHA,
        &third,
        json!({ "follow_up_on": due(1) }),
    )
    .await;
    let soon: OffsetDateTime = sqlx::query_scalar(
        "select max(scheduled_for) from aarogyam.messages
         where kind = 'visit.follow_up_booking' and patient_id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(soon < OffsetDateTime::now_utc() + Duration::minutes(1));
    // Repeats add nothing.
    close(
        &app,
        &owner,
        ALPHA,
        &third,
        json!({ "follow_up_on": due(1) }),
    )
    .await;
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.messages where kind = 'visit.follow_up_booking'"
        )
        .await,
        2
    );
    // Without reminder consent the reason is recorded instead.
    let other = patient(&app, &owner, "Tara Nair", "tara@example.in").await;
    let fourth = visit(&app, &owner, &other).await;
    close(
        &app,
        &owner,
        ALPHA,
        &fourth,
        json!({ "follow_up_on": due(10) }),
    )
    .await;
    let skipped: Vec<_> = rows(&app, &other)
        .await
        .into_iter()
        .filter(|row| row.0 == "visit.follow_up_booking")
        .collect();
    assert_eq!(skipped[0].3.as_deref(), Some("no_consent"));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn whatsapp_needs_opt_in_and_an_approved_template_and_stays_off_without_credentials() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = patient(&app, &owner, "Meera Shah", "meera@example.in").await;
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{id}/contact-preferences"),
        json!({ "channel": "whatsapp", "category": "all", "opted_out": false,
                "whatsapp_opt_in": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Opted in, but Meta has approved nothing yet: email.
    let first = visit(&app, &owner, &id).await;
    close(&app, &owner, ALPHA, &first, json!({})).await;
    assert!(rows(&app, &id).await.iter().all(|row| row.1 == "email"));
    // Approved: WhatsApp, and with no credentials the worker skips it as channel_disabled.
    sqlx::query(
        "update aarogyam.message_templates set status = 'approved'
         where channel = 'whatsapp' and key in ('visit.summary', 'visit.summary_pin')",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let second = visit(&app, &owner, &id).await;
    close(&app, &owner, ALPHA, &second, json!({})).await;
    let all = rows(&app, &id).await;
    assert_eq!(all.iter().filter(|row| row.1 == "whatsapp").count(), 2);
    drain(&app).await;
    let reasons: Vec<Option<String>> = sqlx::query_scalar(
        "select skip_reason from aarogyam.messages
         where patient_id = $1::uuid and channel = 'whatsapp'",
    )
    .bind(&id)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        reasons,
        [
            Some("channel_disabled".into()),
            Some("channel_disabled".into())
        ]
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn messages_stay_inside_their_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let id = patient(&app, &owner, "Meera Shah", "meera@example.in").await;
    let visit = visit(&app, &owner, &id).await;
    // Another clinic's owner can neither close Alpha's visit nor cause a message for it.
    assert_eq!(
        close(&app, &beta, BETA, &visit, json!({})).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        count(&app, "select count(*) from aarogyam.messages").await,
        0
    );
    assert_eq!(
        close(&app, &owner, ALPHA, &visit, json!({})).await,
        StatusCode::OK
    );
    let per_clinic: Vec<(String, i64)> = sqlx::query_as(
        "select o.slug, count(*) from aarogyam.messages m
         join aarogyam.organizations o on o.id = m.org_id group by o.slug",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(per_clinic, [("alpha".to_owned(), 2)]);
    // Beta's own walk-in writes to Beta only, and Beta's switch is its own.
    let (status, made) = post(
        &app,
        BETA,
        &beta,
        "/api/v1/walk-ins",
        walk_in("Beta Patient", "b@example.in"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    let per_clinic: Vec<(String, i64)> = sqlx::query_as(
        "select o.slug, count(*) from aarogyam.messages m
         join aarogyam.organizations o on o.id = m.org_id group by o.slug order by 1",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        per_clinic,
        [("alpha".to_owned(), 2), ("beta".to_owned(), 1)]
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn templates_say_thanks_in_three_languages_with_links_and_no_patient_details() {
    let app = TestApp::start().await;
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "select distinct on (t.key, t.channel, t.language) t.key, t.channel, t.language, t.body
         from aarogyam.message_templates t
         where t.key in ('patient.welcome', 'visit.summary', 'visit.summary_pin',
                         'visit.follow_up_booking')
         order by t.key, t.channel, t.language",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    // Four messages, two channels, three languages.
    assert_eq!(rows.len(), 24);
    for (key, channel, language, body) in &rows {
        let names = placeholders(key, body)
            .unwrap_or_else(|error| panic!("{key} {channel} {language}: {error}"));
        assert!(
            names.contains(&"clinic_name".to_owned()),
            "{key} {language}"
        );
        for banned in ["patient", "diagnos", "tooth", "drug", "medicine", "name}}"] {
            assert!(
                !body.to_lowercase().contains(banned)
                    || banned == "name}}" && body.contains("clinic_name"),
                "{key} {language} says {banned}"
            );
        }
        // Meta refuses a template that ends on a variable.
        assert!(!body.trim_end().ends_with("}}"), "{key} {language}");
    }
    for language in ["en-IN", "hi-IN", "mr-IN"] {
        assert!(rows.iter().any(|row| row.2 == language));
    }
    assert!(
        rows.iter()
            .filter(|row| row.1 == "whatsapp")
            .all(|row| !row.3.is_empty())
    );
    let drafts: i64 = count(
        &app,
        "select count(*) from aarogyam.message_templates
         where channel = 'whatsapp' and key like 'visit.%' and status <> 'draft'",
    )
    .await;
    assert_eq!(drafts, 0);
    app.finish().await;
}
