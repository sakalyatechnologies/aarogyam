//! Stock analytics and alerts on a real database: the alert step (one a day, a new one the next
//! day while still low, recovery, the `low_stock` switch, the 08:00 gate), the analytics maths
//! against `domain::inventory::project`, the alert settings, permissions and clinic isolation.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_domain::inventory::{ProjectionInput, project};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, UtcOffset};

fn ist() -> UtcOffset {
    UtcOffset::from_hms(5, 30, 0).unwrap()
}

fn today() -> Date {
    OffsetDateTime::now_utc().to_offset(ist()).date()
}

/// `hh:00` India time on `day`.
fn at(day: Date, hour: u8) -> OffsetDateTime {
    day.with_time(time::Time::from_hms(hour, 0, 0).unwrap())
        .assume_offset(ist())
}

async fn call(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

/// An item with `on_hand` units in one batch. Returns the item and the batch.
async fn stocked(
    app: &TestApp,
    token: &str,
    name: &str,
    reorder: i64,
    on_hand: i64,
) -> (String, String) {
    let body =
        json!({ "name": name, "category": "restorative", "unit": "box", "reorder_level": reorder });
    let (status, item) = call(
        app,
        Method::POST,
        ALPHA,
        "/api/v1/inventory-items",
        token,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{item}");
    let item = item["id"].as_str().unwrap().to_owned();
    let batch = receive(app, token, &item, on_hand).await;
    (item, batch)
}

async fn receive(app: &TestApp, token: &str, item: &str, quantity: i64) -> String {
    let body = json!({ "item_id": item, "quantity": quantity, "unit_cost_paise": 4500, "batch_no": "B-1" });
    let (status, body) = call(
        app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/receive",
        token,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let batch: String = sqlx::query_scalar(
        "select id::text from aarogyam.stock_batches where item_id = $1::uuid order by created_at desc limit 1",
    )
    .bind(item)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    batch
}

/// A `use` movement of `quantity` units at noon India time `days_ago` days before `base`. The
/// shelf is not touched: the tests set the batch quantities they want.
async fn use_on(app: &TestApp, item: &str, batch: &str, base: Date, days_ago: i64, quantity: i64) {
    let when = at(base - Duration::days(days_ago), 12);
    let mut tx = app.owner.begin().await.unwrap();
    sqlx::query("alter table aarogyam.stock_movements disable trigger set_row_meta")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "insert into aarogyam.stock_movements (org_id, item_id, batch_id, kind, quantity, created_at)
         select i.org_id, i.id, $2::uuid, 'use', -$3, $4 from aarogyam.inventory_items i
         where i.id = $1::uuid",
    )
    .bind(item)
    .bind(batch)
    .bind(quantity)
    .bind(when)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("alter table aarogyam.stock_movements enable trigger set_row_meta")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

/// Ten units a day for each of the 14 days before `base`.
async fn steady_use(app: &TestApp, item: &str, batch: &str, base: Date) {
    for back in 1..=14 {
        use_on(app, item, batch, base, back, 10).await;
    }
}

async fn alerts(app: &TestApp, item: &str) -> Vec<(Date, bool)> {
    sqlx::query_as(
        "select alert_on, handled_at is not null from aarogyam.staff_notifications
         where inventory_item_id = $1::uuid and kind = 'stock_alert' order by alert_on",
    )
    .bind(item)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

async fn set_low_stock_switch(app: &TestApp, on: bool) {
    sqlx::query(
        "insert into aarogyam.org_settings (org_id, notifications)
         select id, jsonb_build_object('low_stock', $1::boolean) from aarogyam.organizations
         where slug = 'alpha'
         on conflict (org_id) do update set notifications = excluded.notifications",
    )
    .bind(on)
    .execute(&app.owner)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn one_alert_a_day_even_when_runs_overlap() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today();
    let (item, batch) = stocked(&app, &owner, "Composite A2", 5, 60).await;
    steady_use(&app, &item, &batch, day).await;

    let now = at(day, 10);
    let db = app.api_db();
    let (a, b) = tokio::join!(
        aarogyam_notify::run_stock_alerts(&db, now),
        aarogyam_notify::run_stock_alerts(&db, now)
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.alerted + b.alerted, 1, "{a:?} {b:?}");
    assert_eq!(alerts(&app, &item).await, vec![(day, false)]);

    // Again an hour later: nothing new.
    let again = aarogyam_notify::run_stock_alerts(&db, at(day, 11))
        .await
        .unwrap();
    assert_eq!(again.alerted, 0);
    assert_eq!(alerts(&app, &item).await.len(), 1);

    // The notice carries the numbers the projection gave: 60 on hand, 6 days of cover.
    let (on_hand, cover, reason): (Option<i64>, Option<i64>, Option<String>) = sqlx::query_as(
        "select stock_on_hand::bigint, stock_days_cover::bigint, stock_reason
         from aarogyam.staff_notifications where inventory_item_id = $1::uuid",
    )
    .bind(&item)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        (on_hand, cover, reason.as_deref()),
        (Some(60), Some(6), Some("projected"))
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_next_day_alerts_again_while_still_low_and_waits_for_eight() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today();
    let (item, batch) = stocked(&app, &owner, "Composite A2", 5, 60).await;
    steady_use(&app, &item, &batch, day).await;
    let db = app.api_db();

    // Before 08:00 in India nothing is looked at.
    let early = aarogyam_notify::run_stock_alerts(&db, at(day, 7))
        .await
        .unwrap();
    assert_eq!((early.checked, early.alerted), (0, 0));
    assert_eq!(alerts(&app, &item).await, vec![]);

    let first = aarogyam_notify::run_stock_alerts(&db, at(day, 9))
        .await
        .unwrap();
    assert_eq!(first.alerted, 1);
    let next = day + Duration::days(1);
    let second = aarogyam_notify::run_stock_alerts(&db, at(next, 9))
        .await
        .unwrap();
    assert_eq!(second.alerted, 1);
    // The new day's alert marks the old one handled.
    assert_eq!(alerts(&app, &item).await, vec![(day, true), (next, false)]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn recovery_clears_the_alert() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today();
    let (item, batch) = stocked(&app, &owner, "Composite A2", 5, 60).await;
    steady_use(&app, &item, &batch, day).await;
    let db = app.api_db();
    assert_eq!(
        aarogyam_notify::run_stock_alerts(&db, at(day, 9))
            .await
            .unwrap()
            .alerted,
        1
    );

    receive(&app, &owner, &item, 500).await;
    let report = aarogyam_notify::run_stock_alerts(&db, at(day, 10))
        .await
        .unwrap();
    assert_eq!((report.alerted, report.cleared), (0, 1));
    assert_eq!(alerts(&app, &item).await, vec![(day, true)]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn switches_stop_the_alerts() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today();
    let (item, batch) = stocked(&app, &owner, "Composite A2", 5, 60).await;
    steady_use(&app, &item, &batch, day).await;
    let db = app.api_db();

    set_low_stock_switch(&app, false).await;
    let off = aarogyam_notify::run_stock_alerts(&db, at(day, 9))
        .await
        .unwrap();
    assert_eq!(off.alerted, 0);
    assert_eq!(alerts(&app, &item).await, vec![]);

    set_low_stock_switch(&app, true).await;
    let path = format!("/api/v1/inventory-items/{item}/alerts");
    let (status, body) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &path,
        &owner,
        Some(json!({ "alerts_enabled": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["alerts_enabled"], false);
    let item_off = aarogyam_notify::run_stock_alerts(&db, at(day, 9))
        .await
        .unwrap();
    assert_eq!(item_off.alerted, 0);

    call(
        &app,
        Method::PATCH,
        ALPHA,
        &path,
        &owner,
        Some(json!({ "alerts_enabled": true })),
    )
    .await;
    assert_eq!(
        aarogyam_notify::run_stock_alerts(&db, at(day, 9))
            .await
            .unwrap()
            .alerted,
        1
    );
    app.finish().await;
}

#[tokio::test]
#[expect(clippy::too_many_lines, reason = "one scenario, step by step")]
#[ignore = "needs DATABASE_URL"]
async fn analytics_match_the_projection() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today();
    let (item, batch) = stocked(&app, &owner, "Composite A2", 5, 60).await;
    steady_use(&app, &item, &batch, day).await;

    let path = format!("/api/v1/stock/analytics?item_id={item}");
    let (status, body) = call(&app, Method::GET, ALPHA, &path, &owner, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let row = &body["items"][0];

    // The same inputs through project().
    let daily: Vec<(Date, i64)> = (1..=14)
        .map(|back| (day - Duration::days(back), 10))
        .collect();
    let expected = project(&ProjectionInput {
        today: day,
        reorder_level: 5,
        lead_time_days: 7,
        max_level: None,
        batches: &[(None, 60)],
        daily_use: &daily,
        first_use_on: Some(day - Duration::days(14)),
    });
    assert_eq!(row["on_hand"], expected.on_hand);
    assert_eq!(row["days_cover"], expected.days_cover.unwrap());
    assert_eq!(
        row["runs_out_on"],
        expected.runs_out_on.unwrap().to_string()
    );
    assert_eq!(
        row["suggested_reorder_qty"],
        expected.suggested_reorder_qty.unwrap()
    );
    assert!((row["daily_usage"].as_f64().unwrap() - expected.daily_usage.unwrap()).abs() < 1e-9);
    assert_eq!(row["lead_time_days"], 7);
    assert_eq!(row["usage_7d"], 60);
    assert_eq!(row["usage_28d"], 140);
    assert_eq!(row["needs_reorder"], true);
    assert_eq!(row["reorder_reason"], "projected");
    let series = row["series"].as_array().unwrap();
    assert_eq!(series.len(), 28);
    assert_eq!(series[27]["day"], day.to_string());
    assert_eq!(series[27]["quantity"], 0);
    assert_eq!(series[26]["quantity"], 10);
    assert_eq!(body["reorder_list"][0]["item_id"], item.as_str());

    // A short lead time takes it off the reorder list; the maths follows the setting.
    let alerts_path = format!("/api/v1/inventory-items/{item}/alerts");
    let (status, set) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &alerts_path,
        &owner,
        Some(json!({ "lead_time_days": 0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{set}");
    assert_eq!(set["lead_time_days"], 0);
    let (_, body) = call(&app, Method::GET, ALPHA, &path, &owner, None).await;
    assert_eq!(body["items"][0]["needs_reorder"], false);
    assert_eq!(body["items"][0]["suggested_reorder_qty"], 80);
    assert_eq!(body["reorder_list"], json!([]));
    for bad in [-1, 121] {
        let (status, _) = call(
            &app,
            Method::PATCH,
            ALPHA,
            &alerts_path,
            &owner,
            Some(json!({ "lead_time_days": bad })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "lead time {bad}");
    }

    // The low-stock list gains the cover when the item is low.
    let level = format!("/api/v1/inventory-items/{item}");
    call(
        &app,
        Method::PATCH,
        ALPHA,
        &level,
        &owner,
        Some(json!({ "reorder_level": 100 })),
    )
    .await;
    let (status, low) = call(&app, Method::GET, ALPHA, "/api/v1/stock/low", &owner, None).await;
    assert_eq!(status, StatusCode::OK, "{low}");
    assert_eq!(low["items"][0]["days_cover"], 6);
    assert_eq!(
        low["items"][0]["runs_out_on"],
        (day + Duration::days(6)).to_string()
    );
    // Items with no use history carry no projection.
    let (quiet, _) = stocked(&app, &owner, "Gauze", 5, 50).await;
    let (_, all) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/stock/analytics?item_id={quiet}"),
        &owner,
        None,
    )
    .await;
    assert_eq!(all["items"][0]["days_cover"], Value::Null);
    assert_eq!(all["items"][0]["runs_out_on"], Value::Null);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn permissions_and_clinics() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let beta = app.token(BETA_OWNER);
    let (item, _) = stocked(&app, &owner, "Composite A2", 5, 60).await;
    let analytics = format!("/api/v1/stock/analytics?item_id={item}");
    let alerts_path = format!("/api/v1/inventory-items/{item}/alerts");

    let (status, _) = call(&app, Method::GET, ALPHA, &analytics, &assistant, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(&app, Method::GET, ALPHA, &analytics, &nothing, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let change = Some(json!({ "alerts_enabled": false }));
    let (status, _) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &alerts_path,
        &assistant,
        change.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic cannot see or change the item.
    let (status, _) = call(&app, Method::GET, BETA, &analytics, &beta, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&app, Method::PATCH, BETA, &alerts_path, &beta, change).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, all) = call(
        &app,
        Method::GET,
        BETA,
        "/api/v1/stock/analytics",
        &beta,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        all["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["item_id"] != item.as_str())
    );
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/stock/analytics?item_id=nope",
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.finish().await;
}
