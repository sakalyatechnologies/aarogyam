//! Campaigns on a real database: audiences and their count-only preview, the count token,
//! fan-out (idempotent, resumable, in batches of 500), the caps, the kill switch, counts by skip
//! reason, test-send, and owner-only, clinic-scoped access on every endpoint. Delivery goes
//! through the log channel.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use aarogyam_dal::campaigns::fan_out_next;
use aarogyam_notify::{Notifier, PortalLinks};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime};
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

/// The owner calls Alpha.
async fn owner(
    app: &TestApp,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    call(app, ALPHA, ALPHA_OWNER, method, path, body).await
}

async fn patient(app: &TestApp, name: &str, email: Option<&str>) -> String {
    let mut body = json!({ "full_name": name });
    if let Some(email) = email {
        body["email"] = json!(email);
    }
    let (status, made) = owner(app, Method::POST, "/api/v1/patients", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn consent(app: &TestApp, patient: &str) -> String {
    let path = format!("/api/v1/patients/{patient}/consents");
    let body = json!({ "purpose": "promotional", "method": "verbal" });
    let (status, made) = owner(app, Method::POST, &path, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
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

/// No quiet hours, so promotional messages go whenever the test runs.
async fn never_quiet(app: &TestApp) {
    set_notifications(
        app,
        json!({ "quiet_hours": { "start": "00:00", "end": "00:00" } }),
    )
    .await;
}

async fn set_notifications(app: &TestApp, notifications: Value) {
    sqlx::query(
        "insert into aarogyam.org_settings (org_id, notifications)
         select id, $1 from aarogyam.organizations where slug = 'alpha'
         on conflict (org_id) do update set notifications = excluded.notifications",
    )
    .bind(notifications)
    .execute(&app.owner)
    .await
    .unwrap();
}

fn everyone() -> Value {
    json!({ "kind": "all_active" })
}

async fn audience(app: &TestApp, name: &str, filter: Value) -> String {
    let body = json!({ "name": name, "filter": filter });
    let (status, made) = owner(app, Method::POST, "/api/v1/audiences", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

/// The clinic's `promo.offer` template for a channel, and its status.
async fn template(app: &TestApp, channel: &str) -> (String, String) {
    let (_, list) = owner(app, Method::GET, "/api/v1/templates", None).await;
    let found = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["key"] == "promo.offer" && t["channel"] == channel)
        .unwrap();
    (
        found["id"].as_str().unwrap().to_owned(),
        found["status"].as_str().unwrap().to_owned(),
    )
}

fn minutes_ago(minutes: i64) -> String {
    let at = OffsetDateTime::now_utc() - Duration::minutes(minutes);
    at.format(&time::format_description::well_known::Rfc3339)
        .unwrap()
}

/// A draft campaign by email, due a minute ago.
async fn campaign(app: &TestApp, audience: &str) -> String {
    let (template, _) = template(app, "email").await;
    let body = json!({
        "name": "Diwali check-up", "audience_id": audience, "template_id": template,
        "channel": "email", "offer_text": "Free dental check-up this week",
        "scheduled_at": minutes_ago(1)
    });
    let (status, made) = owner(app, Method::POST, "/api/v1/campaigns", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn preview(app: &TestApp, filter: Value) -> (i64, String) {
    let body = json!({ "filter": filter });
    let (status, made) = owner(app, Method::POST, "/api/v1/audiences/preview", Some(body)).await;
    assert_eq!(status, StatusCode::OK, "{made}");
    (
        made["count"].as_i64().unwrap(),
        made["count_token"].as_str().unwrap().to_owned(),
    )
}

async fn schedule(app: &TestApp, id: &str, token: &str) -> (StatusCode, Value) {
    let path = format!("/api/v1/campaigns/{id}/schedule");
    owner(
        app,
        Method::POST,
        &path,
        Some(json!({ "count_token": token })),
    )
    .await
}

/// Previews the everyone filter and schedules the campaign with that token.
async fn schedule_everyone(app: &TestApp, id: &str) {
    let (_, token) = preview(app, everyone()).await;
    let (status, done) = schedule(app, id, &token).await;
    assert_eq!(status, StatusCode::OK, "{done}");
}

/// One fan-out call as the job makes it, without the send step.
async fn fan_out(app: &TestApp) -> Option<aarogyam_dal::campaigns::FanOut> {
    fan_out_next(app.api_db().pool(), 500).await.unwrap()
}

/// A campaign's messages as the API counts them: `status/skip_reason` and how many.
async fn counts(app: &TestApp, id: &str) -> Vec<(String, i64)> {
    let (status, got) = owner(app, Method::GET, &format!("/api/v1/campaigns/{id}"), None).await;
    assert_eq!(status, StatusCode::OK, "{got}");
    got["counts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let reason = c["skip_reason"]
                .as_str()
                .map(|r| format!("/{r}"))
                .unwrap_or_default();
            (
                format!("{}{reason}", c["status"].as_str().unwrap()),
                c["count"].as_i64().unwrap(),
            )
        })
        .collect()
}

/// What to change on a patient directly, as the owner: absent fields stay.
#[derive(Default)]
struct Edit<'a> {
    sex: Option<&'a str>,
    born: Option<&'a str>,
    tag: Option<&'a str>,
    visited: Option<&'a str>,
    status: Option<&'a str>,
}

async fn edit(app: &TestApp, id: &str, edit: Edit<'_>) {
    sqlx::query(
        "update aarogyam.patients set sex = coalesce($2, sex),
           date_of_birth = coalesce($3::date, date_of_birth),
           tags = case when $4::text is null then tags else array[$4::text] end,
           last_visit_at = coalesce($5::timestamptz, last_visit_at), status = coalesce($6, status)
         where id = $1::uuid",
    )
    .bind(id)
    .bind(edit.sex)
    .bind(edit.born)
    .bind(edit.tag)
    .bind(edit.visited)
    .bind(edit.status)
    .execute(&app.owner)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn audiences_round_trip_and_a_preview_reveals_only_a_count() {
    let app = TestApp::start().await;
    let ravi = patient(&app, "Ravi K", None).await;
    let meera = patient(&app, "Meera I", None).await;
    let _sunil = patient(&app, "Sunil R", None).await;
    let gone = patient(&app, "Gone G", None).await;
    let ravi_is = Edit {
        sex: Some("female"),
        born: Some("1990-10-15"),
        tag: Some("vip"),
        visited: Some("2026-01-10"),
        ..Edit::default()
    };
    edit(&app, &ravi, ravi_is).await;
    let meera_is = Edit {
        sex: Some("male"),
        born: Some("2012-03-02"),
        visited: Some("2026-09-01"),
        ..Edit::default()
    };
    edit(&app, &meera, meera_is).await;
    edit(
        &app,
        &gone,
        Edit {
            status: Some("inactive"),
            ..Edit::default()
        },
    )
    .await;

    // Each filter counts active patients only; a patient never seen or with no birth date
    // matches only what doesn't need that.
    for (filter, count) in [
        (everyone(), 3),
        (json!({ "kind": "last_visit", "before": "2026-06-01" }), 1),
        (json!({ "kind": "last_visit", "after": "2026-06-01" }), 1),
        (
            json!({ "kind": "last_visit", "after": "2026-01-01", "before": "2027-01-01" }),
            2,
        ),
        (json!({ "kind": "birthday_month", "month": 10 }), 1),
        (json!({ "kind": "age_band", "min": 0, "max": 120 }), 2),
        (json!({ "kind": "age_band", "min": 0, "max": 20 }), 1),
        (json!({ "kind": "sex", "sex": "female" }), 1),
        (json!({ "kind": "tag", "tag": "vip" }), 1),
        (json!({ "kind": "tag", "tag": "nobody" }), 0),
    ] {
        let body = json!({ "filter": filter });
        let (status, got) =
            owner(&app, Method::POST, "/api/v1/audiences/preview", Some(body)).await;
        assert_eq!(status, StatusCode::OK, "{filter}: {got}");
        assert_eq!(got["count"], count, "{filter}");
        // Only a count, a token and its expiry: never who.
        let mut keys: Vec<_> = got.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["count", "count_token", "expires_at"]);
    }

    // Purpose limitation: no balance, treatment or visit-kind filters, and no stray fields.
    for bad in [
        json!({ "kind": "has_balance" }),
        json!({ "kind": "treatment", "tag": "rct" }),
        json!({ "kind": "visit_kind" }),
        json!({ "kind": "all_active", "tag": "vip" }),
        json!({ "kind": "birthday_month", "month": 13 }),
        json!({ "kind": "age_band", "min": 50, "max": 40 }),
        json!({ "kind": "last_visit" }),
        json!({ "kind": "sex", "sex": "robot" }),
    ] {
        let body = json!({ "name": "Bad", "filter": bad });
        let (status, got) = owner(&app, Method::POST, "/api/v1/audiences", Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {got}");
    }

    // Create, read, rename, change the filter, delete.
    let filter = json!({ "kind": "tag", "tag": "vip" });
    let id = audience(&app, "VIPs", filter.clone()).await;
    let path = format!("/api/v1/audiences/{id}");
    let (status, got) = owner(&app, Method::GET, &path, None).await;
    assert_eq!(
        (status, got["filter"]["tag"].as_str()),
        (StatusCode::OK, Some("vip"))
    );
    let (status, got) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "name": "Regulars" })),
    )
    .await;
    assert_eq!(
        (status, got["name"].as_str()),
        (StatusCode::OK, Some("Regulars"))
    );
    let (status, got) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "filter": everyone() })),
    )
    .await;
    assert_eq!(
        (status, got["filter"]["kind"].as_str()),
        (StatusCode::OK, Some("all_active"))
    );
    let (_, listed) = owner(&app, Method::GET, "/api/v1/audiences", None).await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
    let (status, _) = owner(&app, Method::DELETE, &path, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = owner(&app, Method::GET, &path, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_stale_or_mismatched_count_token_is_refused() {
    let app = TestApp::start().await;
    for name in ["Ravi K", "Meera I"] {
        let id = patient(&app, name, None).await;
        edit(
            &app,
            &id,
            Edit {
                tag: Some("vip"),
                ..Edit::default()
            },
        )
        .await;
    }
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;

    // A patient joins after the preview: the count the owner saw no longer holds.
    let (count, stale) = preview(&app, everyone()).await;
    assert_eq!(count, 2);
    let late = patient(&app, "Late L", None).await;
    edit(
        &app,
        &late,
        Edit {
            tag: Some("vip"),
            ..Edit::default()
        },
    )
    .await;
    let (status, got) = schedule(&app, &id, &stale).await;
    assert_eq!(status, StatusCode::CONFLICT, "{got}");

    // Everyone has the vip tag, so the counts agree, but a token proves its own filter.
    let (count, other_filter) = preview(&app, json!({ "kind": "tag", "tag": "vip" })).await;
    assert_eq!(count, 3);
    let (status, got) = schedule(&app, &id, &other_filter).await;
    assert_eq!(status, StatusCode::CONFLICT, "{got}");

    // Expired (its expiry is a time in the past) or not a token at all.
    let expired = format!("1.{}", "0".repeat(64));
    let (status, _) = schedule(&app, &id, &expired).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = schedule(&app, &id, "not-a-token").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Nothing above scheduled it; a fresh preview does, once.
    let (_, got) = owner(&app, Method::GET, &format!("/api/v1/campaigns/{id}"), None).await;
    assert_eq!(got["status"], "draft");
    let (_, fresh) = preview(&app, everyone()).await;
    let (status, done) = schedule(&app, &id, &fresh).await;
    assert_eq!(
        (
            status,
            done["status"].as_str(),
            done["scheduled_count"].as_i64()
        ),
        (StatusCode::OK, Some("scheduled"), Some(3))
    );
    let (status, _) = schedule(&app, &id, &fresh).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "only a draft can be scheduled"
    );
    app.finish().await;
}

async fn bulk_patients(app: &TestApp, count: i32) {
    sqlx::query(
        "insert into aarogyam.patients (org_id, number, full_name, email)
         select o.id, 'BLK-' || n, 'Bulk ' || n, 'bulk' || n || '@example.test'
         from aarogyam.organizations o, generate_series(1, $1) n where o.slug = 'alpha'",
    )
    .bind(count)
    .execute(&app.owner)
    .await
    .unwrap();
}

async fn message_total(app: &TestApp) -> i64 {
    sqlx::query_scalar("select count(*) from aarogyam.messages where campaign_id is not null")
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn fan_out_goes_500_at_a_time_and_is_idempotent_across_runs() {
    let app = TestApp::start().await;
    bulk_patients(&app, 501).await;
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    schedule_everyone(&app, &id).await;

    // The batch boundary: 500, then the last one, then nothing.
    let first = fan_out(&app).await.unwrap();
    assert_eq!((first.queued, first.finished), (500, false));
    let (_, mid) = owner(&app, Method::GET, &format!("/api/v1/campaigns/{id}"), None).await;
    assert_eq!(mid["status"], "sending");
    let second = fan_out(&app).await.unwrap();
    assert_eq!((second.queued, second.finished), (1, true));
    assert!(
        fan_out(&app).await.is_none(),
        "a finished campaign is left alone"
    );
    assert_eq!(message_total(&app).await, 501);
    let (_, done) = owner(&app, Method::GET, &format!("/api/v1/campaigns/{id}"), None).await;
    assert_eq!(done["status"], "sent");
    assert!(done["fan_out_done_at"].is_string());

    // Dedupe keys are campaign:<id>:<patient>, promotional, and the clinic's own daily cap
    // (200 by default) spread them over days instead of dropping any.
    let (keys, wrong): (i64, i64) = sqlx::query_as(
        "select count(*) filter (where dedupe_key = 'campaign:' || campaign_id || ':' || patient_id),
                count(*) filter (where purpose <> 'promotional')
         from aarogyam.messages where campaign_id is not null",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((keys, wrong), (501, 0));
    let per_day: Vec<i64> = sqlx::query_scalar(
        "select count(*) from aarogyam.messages group by date_trunc('day', scheduled_for at time zone 'UTC')
         order by date_trunc('day', scheduled_for at time zone 'UTC')",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(per_day, [200, 200, 101]);

    // Two more runs from a lost cursor queue nothing twice.
    for _ in 0..2 {
        sqlx::query(
            "update aarogyam.campaigns set status = 'scheduled', fan_out_cursor = null, fan_out_done_at = null",
        )
        .execute(&app.owner)
        .await
        .unwrap();
        let mut queued = 0;
        while let Some(step) = fan_out(&app).await {
            queued += step.queued;
            if step.finished {
                break;
            }
        }
        assert_eq!(queued, 0);
        assert_eq!(message_total(&app).await, 501);
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_weekly_promotional_cap_skips_and_counts_a_patient() {
    let app = TestApp::start().await;
    let busy = patient(&app, "Busy B", Some("busy@example.test")).await;
    let calm = patient(&app, "Calm C", Some("calm@example.test")).await;
    // Two promotional messages in the last week for one, a single one for the other.
    for (who, times) in [(&busy, 2), (&calm, 1)] {
        for _ in 0..times {
            sqlx::query(
                "insert into aarogyam.messages (org_id, patient_id, channel, kind, purpose, template_key, variables, body, status, processed_at, sent_at)
                 select org_id, id, 'email', 'clinic.message', 'promotional', 'promo.offer', '{\"subject\":\"x\"}', 'x', 'sent', now(), now()
                 from aarogyam.patients where id = $1::uuid",
            )
            .bind(who)
            .execute(&app.owner)
            .await
            .unwrap();
        }
    }
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    schedule_everyone(&app, &id).await;
    let step = fan_out(&app).await.unwrap();
    assert_eq!((step.queued, step.capped), (1, 1));
    assert_eq!(
        counts(&app, &id).await,
        [
            ("queued".to_owned(), 1),
            ("skipped/frequency_cap".to_owned(), 1)
        ]
    );
    // The clinic's own setting changes the cap.
    set_notifications(&app, json!({ "promo_per_patient_per_week": 1 })).await;
    let second = audience(&app, "Again", everyone()).await;
    let again = campaign(&app, &second).await;
    schedule_everyone(&app, &again).await;
    fan_out(&app).await.unwrap();
    assert_eq!(
        counts(&app, &again).await,
        [("skipped/frequency_cap".to_owned(), 2)],
        "both already had one"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_daily_cap_defers_the_rest_to_later_days() {
    let app = TestApp::start().await;
    set_notifications(&app, json!({ "promo_daily_cap": 2 })).await;
    bulk_patients(&app, 5).await;
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    schedule_everyone(&app, &id).await;
    let step = fan_out(&app).await.unwrap();
    assert_eq!((step.queued, step.finished), (5, true));
    let per_day: Vec<i64> = sqlx::query_scalar(
        "select count(*) from aarogyam.messages group by date_trunc('day', scheduled_for at time zone 'UTC')
         order by date_trunc('day', scheduled_for at time zone 'UTC')",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(per_day, [2, 2, 1]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_kill_switch_pauses_every_fan_out_and_claim_of_campaign_messages() {
    let app = TestApp::start_custom(sakalya_http::HttpConfig::default(), |state| {
        state.with_notifier(Notifier::log(PortalLinks::default()).with_campaigns_enabled(false))
    })
    .await;
    never_quiet(&app).await;
    let ravi = patient(&app, "Ravi K", Some("ravi@example.test")).await;
    consent(&app, &ravi).await;
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    schedule_everyone(&app, &id).await;

    // Switched off: the job doesn't fan out.
    let report = drain(&app).await;
    assert_eq!(report["campaign_messages_queued"], 0, "{report}");
    assert_eq!(message_total(&app).await, 0);
    let (_, got) = owner(&app, Method::GET, &format!("/api/v1/campaigns/{id}"), None).await;
    assert_eq!(got["status"], "scheduled");

    // Messages that already exist aren't claimed, while other messages still go.
    assert_eq!(fan_out(&app).await.unwrap().queued, 1);
    let direct = json!({
        "patient_ids": [ravi], "channel": "email", "template_key": "care.note",
        "variables": { "subject": "About your visit" }, "body": "Hello"
    });
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_FRONT_DESK,
        Method::POST,
        "/api/v1/messages",
        Some(direct),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let report = drain(&app).await;
    assert_eq!(report["messages_sent"], 1, "only the care note: {report}");
    assert_eq!(counts(&app, &id).await, [("queued".to_owned(), 1)]);

    // The claim itself honours the switch; on, it takes the message.
    let pool = app.api_db();
    let held = aarogyam_dal::message_worker::claim(pool.pool(), "email", "log", 100, 10, 60, false)
        .await
        .unwrap();
    assert!(held.is_empty());
    let taken = aarogyam_dal::message_worker::claim(pool.pool(), "email", "log", 100, 10, 60, true)
        .await
        .unwrap();
    assert_eq!(taken.len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn counts_group_by_status_and_skip_reason_and_dispatch_enforces_consent() {
    let app = TestApp::start().await;
    never_quiet(&app).await;
    let sent = patient(&app, "Sent S", Some("sent@example.test")).await;
    let no_consent = patient(&app, "Never N", Some("never@example.test")).await;
    let withdrawn = patient(&app, "Withdrawn W", Some("w@example.test")).await;
    let opted_out = patient(&app, "Optout O", Some("o@example.test")).await;
    let no_address = patient(&app, "NoAddr A", None).await;
    consent(&app, &sent).await;
    let promo = consent(&app, &withdrawn).await;
    consent(&app, &opted_out).await;
    consent(&app, &no_address).await;
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    schedule_everyone(&app, &id).await;
    assert_eq!(fan_out(&app).await.unwrap().queued, 5);

    // Consent withdrawn and an opt-out recorded while the messages wait.
    let (status, _) = owner(
        &app,
        Method::POST,
        &format!("/api/v1/consents/{promo}/withdraw"),
        Some(json!({ "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let prefs = format!("/api/v1/patients/{opted_out}/contact-preferences");
    let optout = json!({ "channel": "email", "category": "promotional", "opted_out": true });
    owner(&app, Method::POST, &prefs, Some(optout)).await;

    // The existing dispatch settles the rest at send time: consent, address.
    let report = drain(&app).await;
    assert_eq!(
        (
            report["messages_sent"].as_i64(),
            report["messages_skipped"].as_i64()
        ),
        (Some(1), Some(2))
    );
    assert_eq!(
        counts(&app, &id).await,
        [
            ("sent".to_owned(), 1),
            ("skipped/consent_withdrawn".to_owned(), 1),
            ("skipped/no_address".to_owned(), 1),
            ("skipped/no_consent".to_owned(), 1),
            ("skipped/opted_out".to_owned(), 1),
        ]
    );
    let _ = no_consent;
    // The list carries the same counts.
    let (_, listed) = owner(&app, Method::GET, "/api/v1/campaigns", None).await;
    assert_eq!(listed["items"][0]["counts"].as_array().unwrap().len(), 5);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn test_send_goes_only_to_the_caller_and_is_not_counted() {
    let app = TestApp::start().await;
    let ravi = patient(&app, "Ravi K", Some("ravi@example.test")).await;
    consent(&app, &ravi).await;
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    let path = format!("/api/v1/campaigns/{id}/test-send");
    // A sign-in without a verified email has nowhere to send it.
    let (status, _) = owner(&app, Method::POST, &path, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let token = app
        .tokens
        .mint_with_email(ALPHA_OWNER, Some("asha@alpha.test"))
        .unwrap();
    let (status, _) = app
        .send(Method::POST, ALPHA, &path, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);

    // One staff email, to the owner's own address; no patient message, nothing counted.
    let queued: Vec<(String, Option<String>)> = sqlx::query_as(
        "select event_key, recipient from aarogyam.outbox_events where event_key = 'campaign.test'",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        queued,
        [(
            "campaign.test".to_owned(),
            Some("asha@alpha.test".to_owned())
        )]
    );
    assert_eq!(message_total(&app).await, 0);
    assert_eq!(counts(&app, &id).await.len(), 0);
    let report = drain(&app).await;
    assert_eq!(report["sent"], 1, "{report}");
    let (status, _) = call(&app, ALPHA, ALPHA_FRONT_DESK, Method::POST, &path, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(&app, BETA, BETA_OWNER, Method::POST, &path, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_draft_changes_a_scheduled_campaign_does_not_and_cancel_skips_the_queue() {
    let app = TestApp::start().await;
    for name in ["Ravi K", "Meera I"] {
        patient(&app, name, Some(&format!("{}@example.test", name.len()))).await;
    }
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    let path = format!("/api/v1/campaigns/{id}");

    // A draft: edit it; the template must be a promo.offer one for the channel.
    let (status, got) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "name": "Diwali offer" })),
    )
    .await;
    assert_eq!(
        (status, got["name"].as_str()),
        (StatusCode::OK, Some("Diwali offer"))
    );
    let (whatsapp, whatsapp_status) = template(&app, "whatsapp").await;
    assert_eq!(whatsapp_status, "draft");
    let (status, _) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "template_id": whatsapp })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "an email campaign can't take a WhatsApp template"
    );
    let (status, got) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "channel": "whatsapp", "template_id": whatsapp })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{got}");
    let (status, _) = schedule(&app, &id, &preview(&app, everyone()).await.1).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "the WhatsApp template isn't approved"
    );
    let (email, _) = template(&app, "email").await;
    owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "channel": "email", "template_id": email })),
    )
    .await;
    let (status, _) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "scheduled_at": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = schedule(&app, &id, &preview(&app, everyone()).await.1).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "no time set");
    owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "scheduled_at": minutes_ago(1) })),
    )
    .await;
    let (status, bad) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "offer_text": "two\nlines" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");

    // Scheduled: it and its audience's filter are fixed; the audience can't be deleted.
    schedule_everyone(&app, &id).await;
    let (status, _) = owner(
        &app,
        Method::PATCH,
        &path,
        Some(json!({ "name": "Changed" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let audience_path = format!("/api/v1/audiences/{all}");
    let (status, _) = owner(
        &app,
        Method::PATCH,
        &audience_path,
        Some(json!({ "filter": { "kind": "sex", "sex": "male" } })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = owner(&app, Method::DELETE, &audience_path, None).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Cancelled while sending: queued messages are skipped, and it stays cancelled.
    fan_out(&app).await.unwrap();
    // Part way through a bigger audience (the batch just made was the last).
    sqlx::query("update aarogyam.campaigns set status = 'sending', fan_out_done_at = null")
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, got) = owner(&app, Method::POST, &format!("{path}/cancel"), None).await;
    assert_eq!(
        (status, got["status"].as_str()),
        (StatusCode::OK, Some("cancelled")),
        "{got}"
    );
    assert_eq!(
        counts(&app, &id).await,
        [("skipped/campaign_cancelled".to_owned(), 2)]
    );
    assert!(fan_out(&app).await.is_none());
    let (status, _) = owner(&app, Method::POST, &format!("{path}/cancel"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = schedule(&app, &id, &preview(&app, everyone()).await.1).await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn every_endpoint_is_owner_only_and_other_clinics_find_nothing() {
    let app = TestApp::start().await;
    let ravi = patient(&app, "Ravi K", Some("ravi@example.test")).await;
    let all = audience(&app, "Everyone", everyone()).await;
    let id = campaign(&app, &all).await;
    let (template, _) = template(&app, "email").await;
    let filter = everyone();
    let (_, token) = preview(&app, filter.clone()).await;
    let create = json!({
        "name": "Other", "audience_id": all, "template_id": template, "channel": "email",
        "offer_text": "Hello"
    });
    let routes: Vec<(Method, String, Option<Value>)> = vec![
        (Method::GET, "/api/v1/audiences".into(), None),
        (
            Method::POST,
            "/api/v1/audiences".into(),
            Some(json!({ "name": "X", "filter": filter })),
        ),
        (
            Method::POST,
            "/api/v1/audiences/preview".into(),
            Some(json!({ "filter": filter })),
        ),
        (Method::GET, format!("/api/v1/audiences/{all}"), None),
        (
            Method::PATCH,
            format!("/api/v1/audiences/{all}"),
            Some(json!({ "name": "Y" })),
        ),
        (Method::DELETE, format!("/api/v1/audiences/{all}"), None),
        (Method::GET, "/api/v1/campaigns".into(), None),
        (Method::POST, "/api/v1/campaigns".into(), Some(create)),
        (Method::GET, format!("/api/v1/campaigns/{id}"), None),
        (
            Method::PATCH,
            format!("/api/v1/campaigns/{id}"),
            Some(json!({ "name": "Z" })),
        ),
        (
            Method::POST,
            format!("/api/v1/campaigns/{id}/schedule"),
            Some(json!({ "count_token": token })),
        ),
        (Method::POST, format!("/api/v1/campaigns/{id}/cancel"), None),
        (
            Method::POST,
            format!("/api/v1/campaigns/{id}/test-send"),
            None,
        ),
    ];
    // 404 in another clinic wherever the route names a record; the routes that don't (list,
    // create, preview) show nothing of Alpha's, or can't use Alpha's ids (404 too).
    let not_found_for_beta = [3, 4, 5, 8, 9, 10, 11, 12, 7];
    for (index, (method, path, body)) in routes.iter().enumerate() {
        for who in [ALPHA_FRONT_DESK, ALPHA_ASSISTANT, ALPHA_NOTHING] {
            let (status, _) = call(&app, ALPHA, who, method.clone(), path, body.clone()).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path} for {who}");
        }
        let (status, got) = call(&app, BETA, BETA_OWNER, method.clone(), path, body.clone()).await;
        if not_found_for_beta.contains(&index) {
            assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}: {got}");
        } else {
            assert!(status.is_success(), "{method} {path}: {status} {got}");
        }
        let (status, _) = app
            .send(method.clone(), ALPHA, path, None, body.clone())
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {path}");
    }
    // Beta saw none of Alpha's audiences or campaigns.
    let (_, theirs) = call(
        &app,
        BETA,
        BETA_OWNER,
        Method::GET,
        "/api/v1/campaigns",
        None,
    )
    .await;
    assert_eq!(theirs["items"].as_array().unwrap().len(), 0);
    let (_, theirs) = call(
        &app,
        BETA,
        BETA_OWNER,
        Method::GET,
        "/api/v1/audiences",
        None,
    )
    .await;
    assert_eq!(
        theirs["items"].as_array().unwrap().len(),
        1,
        "only the one Beta just made"
    );

    // Direct sends keep messages.send: front desk may send, but never run a campaign.
    let direct = json!({
        "patient_ids": [ravi], "channel": "email", "template_key": "care.note",
        "variables": { "subject": "Hi" }, "body": "Hello"
    });
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_FRONT_DESK,
        Method::POST,
        "/api/v1/messages",
        Some(direct),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    // Owners hold campaigns.manage, in the templates and in the clinics' own roles.
    let holders: Vec<String> = sqlx::query_scalar(
        "select distinct r.key from aarogyam.role_permissions p
         join aarogyam.roles r on r.org_id = p.org_id and r.id = p.role_id
         where p.permission = 'campaigns.manage' order by 1",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(holders, ["owner"]);
    app.finish().await;
}
