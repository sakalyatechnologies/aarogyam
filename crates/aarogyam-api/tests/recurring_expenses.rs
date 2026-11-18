//! Recurring expenses on a real database: setting one up, editing, pausing, resuming and
//! stopping it, who may do what, that none of it crosses clinics, and the outbox job's pass
//! that records each due expense once.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_app::recurring_expenses::generate;
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::macros::datetime;
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

const PATH: &str = "/api/v1/recurring-expenses";

fn today() -> Date {
    OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date()
}

async fn create(app: &TestApp, host: &str, token: &str, body: Value) -> (StatusCode, Value) {
    app.send(Method::POST, host, PATH, Some(token), Some(body))
        .await
}

/// Rent of ₹30,000 on day `day` of every month from today.
async fn rent(app: &TestApp, owner: &str, day: u8) -> Value {
    let (status, rule) = create(
        app,
        ALPHA,
        owner,
        json!({ "category": "rent", "amount_paise": 3_000_000, "method": "upi",
                "note": "Shop rent", "cadence": "monthly", "day_of_month": day,
                "starts_on": today().to_string() }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{rule}");
    rule
}

async fn act(
    app: &TestApp,
    host: &str,
    token: &str,
    id: &str,
    action: &str,
) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        &format!("{PATH}/{id}/{action}"),
        Some(token),
        None,
    )
    .await
}

async fn patch(
    app: &TestApp,
    host: &str,
    token: &str,
    id: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(
        Method::PATCH,
        host,
        &format!("{PATH}/{id}"),
        Some(token),
        Some(body),
    )
    .await
}

/// Sets a rule's days directly, as if it had been set up earlier.
async fn set_days(
    app: &TestApp,
    id: &str,
    starts_on: &str,
    next_due_on: &str,
    ends_on: Option<&str>,
) {
    sqlx::query(
        "update aarogyam.recurring_expenses
         set starts_on = $2::date, next_due_on = $3::date, ends_on = $4::date where id = $1",
    )
    .bind(Uuid::parse_str(id).unwrap())
    .bind(starts_on)
    .bind(next_due_on)
    .bind(ends_on)
    .execute(&app.owner)
    .await
    .unwrap();
}

/// The days of the expenses a rule recorded, oldest first.
async fn recorded_days(app: &TestApp, id: &str) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        "select spent_on::text from aarogyam.expenses
         where recurring_expense_id = $1 order by spent_on",
    )
    .bind(Uuid::parse_str(id).unwrap())
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

async fn next_due(app: &TestApp, id: &str) -> String {
    sqlx::query_scalar::<_, String>(
        "select next_due_on::text from aarogyam.recurring_expenses where id = $1",
    )
    .bind(Uuid::parse_str(id).unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn owners_set_up_and_list_recurring_expenses() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let rule = rent(&app, &owner, 1).await;
    assert_eq!(rule["category"], "rent");
    assert_eq!(rule["category_name"], "Rent");
    assert_eq!(rule["amount_paise"], 3_000_000);
    assert_eq!(rule["method"], "upi");
    assert_eq!(rule["note"], "Shop rent");
    assert_eq!(rule["cadence"], "monthly");
    assert_eq!(rule["day_of_month"], 1);
    assert!(rule.get("weekday").is_none());
    assert_eq!(rule["status"], "active");
    assert_eq!(rule["ends_on"], Value::Null);
    let first = today().replace_day(1).unwrap();
    let expected = if today().day() == 1 {
        today()
    } else {
        first
            .checked_add(Duration::days(32))
            .unwrap()
            .replace_day(1)
            .unwrap()
    };
    assert_eq!(rule["next_due_on"], expected.to_string());

    // Weekly, on Mondays: the first Monday on or after today.
    let (status, weekly) = create(
        &app,
        ALPHA,
        &owner,
        json!({ "category": "salary", "amount_paise": 500_000, "cadence": "weekly",
                "weekday": 1, "starts_on": today().to_string() }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{weekly}");
    let monday = (0..7)
        .map(|n| today() + Duration::days(n))
        .find(|d| d.weekday() == time::Weekday::Monday)
        .unwrap();
    assert_eq!(weekly["next_due_on"], monday.to_string());
    assert!(weekly.get("method").is_none());
    assert!(weekly.get("day_of_month").is_none());

    // A start up to a year ahead is allowed.
    let (status, short) = create(
        &app,
        ALPHA,
        &owner,
        json!({ "category": "electricity", "amount_paise": 100_000, "cadence": "monthly",
                "day_of_month": 31, "starts_on": (today() + Duration::days(366)).to_string() }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{short}");

    let (status, list) = app.send(Method::GET, ALPHA, PATH, Some(&owner), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 3);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn recurring_expenses_are_checked() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today().to_string();
    let good = json!({ "category": "rent", "amount_paise": 100, "cadence": "monthly",
                       "day_of_month": 5, "starts_on": day });
    let with = |key: &str, value: Value| {
        let mut body = good.clone();
        body[key] = value;
        body
    };
    for bad in [
        with("amount_paise", json!(0)),
        with("amount_paise", json!(-5)),
        with("amount_paise", json!(1_000_000_001_i64)),
        with("day_of_month", json!(0)),
        with("day_of_month", json!(32)),
        with("day_of_month", Value::Null),
        with("weekday", json!(2)),
        with("method", json!("cheque")),
        with("note", json!("x".repeat(301))),
        with(
            "starts_on",
            json!((today() - Duration::days(91)).to_string()),
        ),
        with(
            "starts_on",
            json!((today() + Duration::days(367)).to_string()),
        ),
        with("starts_on", json!("01/12/2026")),
        json!({ "category": "rent", "amount_paise": 100, "cadence": "weekly", "weekday": 8,
                "starts_on": day }),
        json!({ "category": "rent", "amount_paise": 100, "cadence": "weekly", "starts_on": day }),
    ] {
        let (status, body) = create(&app, ALPHA, &owner, bad.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    let (status, body) = create(&app, ALPHA, &owner, with("cadence", json!("yearly"))).await;
    assert!(status.is_client_error(), "{body}");
    let (status, rule) = create(&app, ALPHA, &owner, good.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{rule}");
    let id = rule["id"].as_str().unwrap();
    for bad in [
        json!({ "amount_paise": 0 }),
        json!({ "day_of_month": 40 }),
        json!({ "weekday": 3 }),
        json!({ "method": "cheque" }),
        json!({ "ends_on": (today() - Duration::days(1)).to_string() }),
    ] {
        let (status, body) = patch(&app, ALPHA, &owner, id, bad.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn recurring_expenses_pause_resume_edit_and_stop() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let rule = rent(&app, &owner, 1).await;
    let id = rule["id"].as_str().unwrap();

    let (status, paused) = act(&app, ALPHA, &owner, id, "pause").await;
    assert_eq!(status, StatusCode::OK, "{paused}");
    assert_eq!(paused["status"], "paused");
    let (status, _) = act(&app, ALPHA, &owner, id, "pause").await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, resumed) = act(&app, ALPHA, &owner, id, "resume").await;
    assert_eq!(status, StatusCode::OK, "{resumed}");
    assert_eq!(resumed["status"], "active");
    assert_eq!(resumed["next_due_on"], rule["next_due_on"]);
    let (status, _) = act(&app, ALPHA, &owner, id, "resume").await;
    assert_eq!(status, StatusCode::CONFLICT);

    let end = (today() + Duration::days(200)).to_string();
    let (status, edited) = patch(
        &app,
        ALPHA,
        &owner,
        id,
        json!({ "amount_paise": 3_200_000, "method": null, "note": "New rent",
                "ends_on": end }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["amount_paise"], 3_200_000);
    assert!(edited.get("method").is_none());
    assert_eq!(edited["note"], "New rent");
    assert_eq!(edited["ends_on"], end);
    assert_eq!(edited["day_of_month"], 1);
    // A new day moves the next due day to the first one on or after today.
    let (status, moved) = patch(
        &app,
        ALPHA,
        &owner,
        id,
        json!({ "day_of_month": today().day() }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{moved}");
    assert_eq!(moved["next_due_on"], today().to_string());
    let (status, cleared) = patch(
        &app,
        ALPHA,
        &owner,
        id,
        json!({ "ends_on": null, "note": null }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert_eq!(cleared["ends_on"], Value::Null);
    assert_eq!(cleared["note"], Value::Null);

    let (status, stopped) = act(&app, ALPHA, &owner, id, "stop").await;
    assert_eq!(status, StatusCode::OK, "{stopped}");
    assert_eq!(stopped["status"], "stopped");
    for action in ["stop", "pause", "resume"] {
        let (status, _) = act(&app, ALPHA, &owner, id, action).await;
        assert_eq!(status, StatusCode::CONFLICT, "{action}");
    }
    let (status, _) = patch(&app, ALPHA, &owner, id, json!({ "amount_paise": 5 })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn recurring_expenses_need_their_permissions() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let rule = rent(&app, &owner, 1).await;
    let id = rule["id"].as_str().unwrap();
    let body = json!({ "category": "rent", "amount_paise": 100, "cadence": "monthly",
                       "day_of_month": 1, "starts_on": today().to_string() });
    for person in [ALPHA_FRONT_DESK, ALPHA_ASSISTANT, ALPHA_NOTHING] {
        let token = app.token(person);
        let (status, _) = app.send(Method::GET, ALPHA, PATH, Some(&token), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = create(&app, ALPHA, &token, body.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = patch(&app, ALPHA, &token, id, json!({ "amount_paise": 5 })).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        for action in ["pause", "resume", "stop"] {
            let (status, _) = act(&app, ALPHA, &token, id, action).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{action}");
        }
    }
    let (status, _) = app.send(Method::GET, ALPHA, PATH, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

/// Beta's owner can't see or change Alpha's recurring expenses; row-level security hides the
/// rows directly too.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn recurring_expenses_stay_in_their_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let rule = rent(&app, &owner, 1).await;
    let id = rule["id"].as_str().unwrap();
    let (status, list) = app.send(Method::GET, BETA, PATH, Some(&beta), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"], json!([]));
    let (status, _) = patch(&app, BETA, &beta, id, json!({ "amount_paise": 5 })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for action in ["pause", "resume", "stop"] {
        let (status, _) = act(&app, BETA, &beta, id, action).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{action}");
    }
    let (status, _) = act(&app, ALPHA, &owner, id, "pause").await;
    assert_eq!(status, StatusCode::OK);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_due_rule_records_one_expense_once() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let db = app.api_db();
    let id = rent(&app, &owner, 15).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    set_days(&app, &id, "2026-09-01", "2026-09-15", None).await;
    let now = datetime!(2026-09-15 06:00 UTC);

    let report = generate(&db, now).await.unwrap();
    assert_eq!((report.rules, report.recorded), (1, 1));
    assert_eq!(recorded_days(&app, &id).await, ["2026-09-15"]);
    assert_eq!(next_due(&app, &id).await, "2026-10-15");
    let report = generate(&db, now).await.unwrap();
    assert_eq!((report.rules, report.recorded), (0, 0));
    // Moved back by hand, the day already recorded is skipped.
    set_days(&app, &id, "2026-09-01", "2026-09-15", None).await;
    let report = generate(&db, now).await.unwrap();
    assert_eq!((report.rules, report.recorded), (1, 0));
    assert_eq!(recorded_days(&app, &id).await, ["2026-09-15"]);

    // The expense carries the rule's amount, method, note and id.
    let (status, list) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/expenses?from=2026-09-15&to=2026-09-15",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let expense = &list["items"][0];
    assert_eq!(expense["recurring_expense_id"], id.as_str());
    assert_eq!(expense["amount_paise"], 3_000_000);
    assert_eq!(expense["method"], "upi");
    assert_eq!(expense["note"], "Shop rent");
    assert_eq!(expense["category"], "rent");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn missed_months_catch_up_twelve_at_a_time() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let db = app.api_db();
    let id = rent(&app, &owner, 1).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    set_days(&app, &id, "2025-01-01", "2025-01-01", None).await;
    let now = datetime!(2026-03-10 06:00 UTC);
    let report = generate(&db, now).await.unwrap();
    assert_eq!(report.recorded, 12);
    assert_eq!(next_due(&app, &id).await, "2026-01-01");
    let report = generate(&db, now).await.unwrap();
    assert_eq!(report.recorded, 3);
    assert_eq!(next_due(&app, &id).await, "2026-04-01");
    let days = recorded_days(&app, &id).await;
    assert_eq!(days.len(), 15);
    assert_eq!(days.last().unwrap(), "2026-03-01");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn day_31_falls_on_a_short_months_last_day() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let db = app.api_db();
    let id = rent(&app, &owner, 31).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    set_days(&app, &id, "2026-09-01", "2026-09-30", None).await;
    generate(&db, datetime!(2026-09-30 06:00 UTC))
        .await
        .unwrap();
    assert_eq!(next_due(&app, &id).await, "2026-10-31");
    generate(&db, datetime!(2027-03-01 06:00 UTC))
        .await
        .unwrap();
    assert_eq!(
        recorded_days(&app, &id).await,
        [
            "2026-09-30",
            "2026-10-31",
            "2026-11-30",
            "2026-12-31",
            "2027-01-31",
            "2027-02-28"
        ]
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn paused_and_ended_rules_record_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let db = app.api_db();
    let paused = rent(&app, &owner, 1).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    set_days(&app, &paused, "2026-09-01", "2026-09-01", None).await;
    let (status, _) = act(&app, ALPHA, &owner, &paused, "pause").await;
    assert_eq!(status, StatusCode::OK);
    let ended = rent(&app, &owner, 1).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    set_days(&app, &ended, "2026-09-01", "2026-09-01", Some("2026-10-15")).await;
    let stopped = rent(&app, &owner, 1).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    set_days(&app, &stopped, "2026-09-01", "2026-09-01", None).await;
    let (status, _) = act(&app, ALPHA, &owner, &stopped, "stop").await;
    assert_eq!(status, StatusCode::OK);

    let now = datetime!(2026-12-10 06:00 UTC);
    let report = generate(&db, now).await.unwrap();
    assert_eq!((report.rules, report.recorded), (1, 2));
    assert_eq!(recorded_days(&app, &paused).await, Vec::<String>::new());
    assert_eq!(recorded_days(&app, &stopped).await, Vec::<String>::new());
    assert_eq!(
        recorded_days(&app, &ended).await,
        ["2026-09-01", "2026-10-01"]
    );
    let (_, list) = app.send(Method::GET, ALPHA, PATH, Some(&owner), None).await;
    let status_of = |id: &str| {
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == id)
            .unwrap()["status"]
            .clone()
    };
    assert_eq!(status_of(&ended), "ended");
    assert_eq!(status_of(&paused), "paused");
    assert_eq!(status_of(&stopped), "stopped");
    let report = generate(&db, now).await.unwrap();
    assert_eq!(
        report,
        aarogyam_app::recurring_expenses::RecurringReport::default()
    );
    app.finish().await;
}
