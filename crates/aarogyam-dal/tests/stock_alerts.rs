//! Migrations 0670 and 0671, against a real Postgres: the stock columns and their foreign key,
//! the usage snapshot (switches, local days, what counts as use, expired batches), and the alert
//! recorder (once a day, older alerts handled, another clinic's item refused, recovery).
//!
//! Run with `DATABASE_URL=postgres://localhost:5432/postgres cargo test -p aarogyam-dal -- --include-ignored`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

use sqlx::PgPool;
use time::macros::{date, datetime};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// Two clinics, `alpha` (India) and `beta`, each with an owner.
struct Clinics {
    alpha: Uuid,
    beta: Uuid,
}

async fn clinic(pool: &PgPool, slug: &str, prefix: &str) -> Uuid {
    let user = Uuid::now_v7();
    sqlx::query(
        "insert into aarogyam.users (id, auth_uid, email, display_name) values ($1, $2, $3, 'Owner')",
    )
    .bind(user)
    .bind(Uuid::now_v7())
    .bind(format!("owner@{slug}.test"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query_scalar("select app.create_clinic($1, $1, $2, 'dental', $3, $4)")
        .bind(slug)
        .bind(prefix)
        .bind(format!("{slug}.localtest.me"))
        .bind(user)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn clinics(pool: &PgPool) -> Clinics {
    aarogyam_dal::migrate(pool).await.unwrap();
    Clinics {
        alpha: clinic(pool, "alpha", "AL").await,
        beta: clinic(pool, "beta", "BT").await,
    }
}

async fn role(pool: &PgPool, org: Uuid, key: &str) -> Uuid {
    sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = $2")
        .bind(org)
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn item(pool: &PgPool, org: Uuid, name: &str, reorder_level: i64) -> Uuid {
    sqlx::query_scalar(
        "insert into aarogyam.inventory_items (org_id, name, reorder_level) values ($1, $2, $3)
         returning id",
    )
    .bind(org)
    .bind(name)
    .bind(reorder_level)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn batch(pool: &PgPool, org: Uuid, item: Uuid, expiry: Option<Date>, quantity: i64) -> Uuid {
    sqlx::query_scalar(
        "insert into aarogyam.stock_batches (org_id, item_id, expiry, received_quantity, quantity)
         values ($1, $2, $3, $4, $4) returning id",
    )
    .bind(org)
    .bind(item)
    .bind(expiry)
    .bind(quantity)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A movement at a given instant; `use` and `expire` quantities are given as positive units.
async fn movement(
    pool: &PgPool,
    org: Uuid,
    item: Uuid,
    batch: Uuid,
    kind: &str,
    quantity: i64,
    at: OffsetDateTime,
) {
    let signed = if matches!(kind, "use" | "expire") {
        -quantity
    } else {
        quantity
    };
    // A row's creation time is stamped by a trigger; switch triggers off on this connection so
    // the test can place a movement on a chosen day.
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("set session_replication_role = replica")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query(
        "insert into aarogyam.stock_movements
           (org_id, item_id, batch_id, kind, quantity, reason, created_at)
         values ($1, $2, $3, $4, $5, case when $4 in ('adjust', 'expire') then 'count' end, $6)",
    )
    .bind(org)
    .bind(item)
    .bind(batch)
    .bind(kind)
    .bind(signed)
    .bind(at)
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query("set session_replication_role = default")
        .execute(&mut *conn)
        .await
        .unwrap();
}

#[derive(Debug, sqlx::FromRow)]
struct Snapshot {
    org_id: Uuid,
    item_id: Uuid,
    local_today: Date,
    reorder_level: i64,
    lead_time_days: i16,
    on_hand: i64,
    batch_expiries: Vec<Option<Date>>,
    batch_quantities: Vec<i64>,
    use_days: Vec<Date>,
    use_quantities: Vec<i64>,
    first_use_on: Option<Date>,
}

/// 11:30 in India on 15 October 2026.
const NOW: OffsetDateTime = datetime!(2026-10-15 06:00 UTC);

async fn snapshot(pool: &PgPool) -> Vec<Snapshot> {
    sqlx::query_as("select * from app.stock_usage_snapshot($1, 1000)")
        .bind(NOW)
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn set_notifications(pool: &PgPool, org: Uuid, json: &str) {
    sqlx::query(
        "insert into aarogyam.org_settings (org_id, notifications) values ($1, $2::jsonb)
         on conflict (org_id) do update set notifications = excluded.notifications",
    )
    .bind(org)
    .bind(json)
    .execute(pool)
    .await
    .unwrap();
}

async fn alerts(pool: &PgPool, org: Uuid, item: Uuid) -> Vec<(Date, bool)> {
    sqlx::query_as(
        "select alert_on, handled_at is not null from aarogyam.staff_notifications
         where org_id = $1 and inventory_item_id = $2 and kind = 'stock_alert' order by alert_on",
    )
    .bind(org)
    .bind(item)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn record(
    pool: &PgPool,
    org: Uuid,
    item: Uuid,
    on: Date,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select app.record_stock_alert($1, $2, $3, 12, 3.5, $4)")
        .bind(org)
        .bind(item)
        .bind(on)
        .bind(reason)
        .fetch_one(pool)
        .await
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn new_columns_default_and_are_range_checked(pool: PgPool) {
    let c = clinics(&pool).await;
    let id = item(&pool, c.alpha, "Gloves", 10).await;
    let (lead, enabled): (i16, bool) = sqlx::query_as(
        "select lead_time_days, alerts_enabled from aarogyam.inventory_items where id = $1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((lead, enabled), (7, true));
    for (value, ok) in [(0, true), (120, true), (-1, false), (121, false)] {
        let done =
            sqlx::query("update aarogyam.inventory_items set lead_time_days = $2 where id = $1")
                .bind(id)
                .bind(value)
                .execute(&pool)
                .await;
        assert_eq!(done.is_ok(), ok, "lead time {value}");
    }
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn a_movement_may_name_a_task_occurrence_of_its_own_clinic_only(pool: PgPool) {
    let c = clinics(&pool).await;
    let mut occurrences = Vec::new();
    for org in [c.alpha, c.beta] {
        let role = role(&pool, org, "owner").await;
        let template: Uuid = sqlx::query_scalar(
            "insert into aarogyam.task_templates
               (org_id, title, assignee_role_id, schedule_kind, due_time, starts_on, activated_at)
             values ($1, 'Count gloves', $2, 'daily', '09:00', '2026-01-01', '2026-01-01Z')
             returning id",
        )
        .bind(org)
        .bind(role)
        .fetch_one(&pool)
        .await
        .unwrap();
        occurrences.push(
            sqlx::query_scalar::<_, Uuid>(
                "insert into aarogyam.task_occurrences
                   (org_id, template_id, title, action, assignee_role_id, local_date, due_at)
                 values ($1, $2, 'Count gloves', 'record_usage', $3, '2026-10-15', '2026-10-15 03:30Z')
                 returning id",
            )
            .bind(org)
            .bind(template)
            .bind(role)
            .fetch_one(&pool)
            .await
            .unwrap(),
        );
    }
    let gloves = item(&pool, c.alpha, "Gloves", 10).await;
    let lot = batch(&pool, c.alpha, gloves, None, 50).await;
    let insert = |occurrence: Option<Uuid>| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "insert into aarogyam.stock_movements
                   (org_id, item_id, batch_id, kind, quantity, task_occurrence_id)
                 values ($1, $2, $3, 'use', -1, $4)",
            )
            .bind(c.alpha)
            .bind(gloves)
            .bind(lot)
            .bind(occurrence)
            .execute(&pool)
            .await
        }
    };
    insert(None).await.unwrap();
    insert(Some(occurrences[0])).await.unwrap();
    assert!(
        insert(Some(occurrences[1])).await.is_err(),
        "another clinic's occurrence"
    );
    assert!(
        insert(Some(Uuid::now_v7())).await.is_err(),
        "an occurrence that does not exist"
    );
    let linked: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.stock_movements where task_occurrence_id = $1",
    )
    .bind(occurrences[0])
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(linked, 1);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn a_stock_notice_may_name_an_item_of_its_own_clinic_only(pool: PgPool) {
    let c = clinics(&pool).await;
    let gloves = item(&pool, c.alpha, "Gloves", 10).await;
    let insert = |org: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "insert into aarogyam.staff_notifications
                   (org_id, kind, inventory_item_id, alert_on, stock_reason)
                 values ($1, 'stock_alert', $2, '2026-10-15', 'low')",
            )
            .bind(org)
            .bind(gloves)
            .execute(&pool)
            .await
        }
    };
    assert!(insert(c.beta).await.is_err());
    insert(c.alpha).await.unwrap();
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_recorder_writes_one_alert_a_day_and_hands_older_ones_on(pool: PgPool) {
    let c = clinics(&pool).await;
    let gloves = item(&pool, c.alpha, "Gloves", 10).await;
    let (d1, d2) = (date!(2026 - 10 - 14), date!(2026 - 10 - 15));
    assert!(
        record(&pool, c.alpha, gloves, d1, "projected")
            .await
            .unwrap()
    );
    assert!(
        !record(&pool, c.alpha, gloves, d1, "low").await.unwrap(),
        "same day again"
    );
    assert_eq!(alerts(&pool, c.alpha, gloves).await, [(d1, false)]);
    let kept: (f64, f64, String) = sqlx::query_as(
        "select stock_on_hand::float8, stock_days_cover::float8, stock_reason
         from aarogyam.staff_notifications where inventory_item_id = $1",
    )
    .bind(gloves)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kept, (12.0, 3.5, "projected".into()));

    assert!(record(&pool, c.alpha, gloves, d2, "low").await.unwrap());
    assert_eq!(
        alerts(&pool, c.alpha, gloves).await,
        [(d1, true), (d2, false)]
    );
    // A late retry of the old day changes nothing and does not reopen or handle anything else.
    assert!(!record(&pool, c.alpha, gloves, d1, "low").await.unwrap());
    assert_eq!(
        alerts(&pool, c.alpha, gloves).await,
        [(d1, true), (d2, false)]
    );
    assert!(
        record(&pool, c.alpha, gloves, d2, "nonsense")
            .await
            .is_err()
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_recorder_refuses_another_clinics_item_and_a_missing_one(pool: PgPool) {
    let c = clinics(&pool).await;
    let mine = item(&pool, c.alpha, "Gloves", 10).await;
    let day = date!(2026 - 10 - 15);
    let err = record(&pool, c.beta, mine, day, "low").await.unwrap_err();
    assert_eq!(
        err.as_database_error()
            .and_then(sqlx::error::DatabaseError::code)
            .as_deref(),
        Some("P0002")
    );
    assert!(
        record(&pool, c.beta, Uuid::now_v7(), day, "low")
            .await
            .is_err()
    );
    let rows: i64 = sqlx::query_scalar("select count(*) from aarogyam.staff_notifications")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 0);
    // Clearing from the wrong clinic touches nothing.
    record(&pool, c.alpha, mine, day, "low").await.unwrap();
    let cleared: i32 = sqlx::query_scalar("select app.clear_stock_alerts($1, $2)")
        .bind(c.beta)
        .bind(mine)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cleared, 0);
    assert_eq!(alerts(&pool, c.alpha, mine).await, [(day, false)]);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn recovery_handles_every_open_alert_and_a_new_one_can_follow(pool: PgPool) {
    let c = clinics(&pool).await;
    let gloves = item(&pool, c.alpha, "Gloves", 10).await;
    let other = item(&pool, c.alpha, "Masks", 10).await;
    let (d1, d2) = (date!(2026 - 10 - 14), date!(2026 - 10 - 15));
    record(&pool, c.alpha, gloves, d1, "low").await.unwrap();
    record(&pool, c.alpha, other, d1, "low").await.unwrap();
    let cleared = |item: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i32>("select app.clear_stock_alerts($1, $2)")
                .bind(c.alpha)
                .bind(item)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(cleared(gloves).await, 1);
    assert_eq!(cleared(gloves).await, 0);
    assert_eq!(alerts(&pool, c.alpha, gloves).await, [(d1, true)]);
    assert_eq!(
        alerts(&pool, c.alpha, other).await,
        [(d1, false)],
        "other items stay open"
    );
    assert!(
        record(&pool, c.alpha, gloves, d2, "projected")
            .await
            .unwrap()
    );
    assert_eq!(
        alerts(&pool, c.alpha, gloves).await,
        [(d1, true), (d2, false)]
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_snapshot_reports_use_by_local_day_and_the_unexpired_shelf(pool: PgPool) {
    let c = clinics(&pool).await;
    let gloves = item(&pool, c.alpha, "Gloves", 25).await;
    sqlx::query("update aarogyam.inventory_items set lead_time_days = 5 where id = $1")
        .bind(gloves)
        .execute(&pool)
        .await
        .unwrap();
    let fresh = batch(&pool, c.alpha, gloves, Some(date!(2027 - 01 - 01)), 40).await;
    let open_ended = batch(&pool, c.alpha, gloves, None, 10).await;
    // Already expired on 15 October: on the shelf, but not usable.
    batch(&pool, c.alpha, gloves, Some(date!(2026 - 10 - 14)), 99).await;
    // Used up: no longer on the shelf.
    let empty = batch(&pool, c.alpha, gloves, None, 5).await;
    sqlx::query("update aarogyam.stock_batches set quantity = 0 where id = $1")
        .bind(empty)
        .execute(&pool)
        .await
        .unwrap();

    // 14 October in India is 13 October 18:30 UTC to 14 October 18:30 UTC.
    movement(
        &pool,
        c.alpha,
        gloves,
        fresh,
        "use",
        3,
        datetime!(2026-10-13 19:00 UTC),
    )
    .await;
    movement(
        &pool,
        c.alpha,
        gloves,
        open_ended,
        "use",
        4,
        datetime!(2026-10-14 05:00 UTC),
    )
    .await;
    // 15 October 01:30 in India: already the next local day.
    movement(
        &pool,
        c.alpha,
        gloves,
        fresh,
        "use",
        2,
        datetime!(2026-10-14 20:00 UTC),
    )
    .await;
    // Not use: a receipt, a positive and a negative correction, a write-off.
    movement(
        &pool,
        c.alpha,
        gloves,
        fresh,
        "receive",
        50,
        datetime!(2026-10-10 05:00 UTC),
    )
    .await;
    movement(
        &pool,
        c.alpha,
        gloves,
        fresh,
        "adjust",
        7,
        datetime!(2026-10-11 05:00 UTC),
    )
    .await;
    movement(
        &pool,
        c.alpha,
        gloves,
        fresh,
        "adjust",
        -9,
        datetime!(2026-10-11 06:00 UTC),
    )
    .await;
    movement(
        &pool,
        c.alpha,
        gloves,
        fresh,
        "expire",
        6,
        datetime!(2026-10-12 05:00 UTC),
    )
    .await;
    // More than 28 days ago.
    movement(
        &pool,
        c.alpha,
        gloves,
        fresh,
        "use",
        8,
        datetime!(2026-09-10 05:00 UTC),
    )
    .await;

    let rows = snapshot(&pool).await;
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!((row.org_id, row.item_id), (c.alpha, gloves));
    assert_eq!(row.local_today, date!(2026 - 10 - 15));
    assert_eq!(
        (row.reorder_level, row.lead_time_days, row.on_hand),
        (25, 5, 50)
    );
    assert_eq!(
        row.batch_expiries,
        [Some(date!(2027 - 01 - 01)), None],
        "unexpired and non-empty only, soonest expiry first"
    );
    assert_eq!(row.batch_quantities, [40, 10]);
    assert_eq!(row.use_days, [date!(2026 - 10 - 14), date!(2026 - 10 - 15)]);
    assert_eq!(row.use_quantities, [7, 2]);
    assert_eq!(row.first_use_on, Some(date!(2026 - 10 - 14)));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn an_item_without_use_or_stock_still_appears(pool: PgPool) {
    let c = clinics(&pool).await;
    let gloves = item(&pool, c.alpha, "Gloves", 10).await;
    let rows = snapshot(&pool).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].item_id, gloves);
    assert_eq!(rows[0].on_hand, 0);
    assert!(rows[0].batch_expiries.is_empty() && rows[0].use_days.is_empty());
    assert_eq!(rows[0].first_use_on, None);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_snapshot_follows_the_low_stock_switch_alerts_enabled_and_the_clinic_state(
    pool: PgPool,
) {
    let c = clinics(&pool).await;
    let a = item(&pool, c.alpha, "Gloves", 10).await;
    let a_off = item(&pool, c.alpha, "Masks", 10).await;
    let b = item(&pool, c.beta, "Gloves", 10).await;
    let deleted = item(&pool, c.alpha, "Old", 10).await;
    sqlx::query("update aarogyam.inventory_items set alerts_enabled = false where id = $1")
        .bind(a_off)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("update aarogyam.inventory_items set deleted_at = now() where id = $1")
        .bind(deleted)
        .execute(&pool)
        .await
        .unwrap();
    let ids = |rows: Vec<Snapshot>| {
        let mut ids: Vec<Uuid> = rows.into_iter().map(|r| r.item_id).collect();
        ids.sort();
        ids
    };
    let mut both = vec![a, b];
    both.sort();
    // No settings row, or a switch that is missing or not a boolean: the default is on.
    assert_eq!(ids(snapshot(&pool).await), both);
    set_notifications(&pool, c.alpha, r#"{"low_stock": "no"}"#).await;
    assert_eq!(ids(snapshot(&pool).await), both);
    // Off for one clinic leaves the other alone.
    set_notifications(&pool, c.alpha, r#"{"low_stock": false}"#).await;
    assert_eq!(ids(snapshot(&pool).await), [b]);
    set_notifications(&pool, c.alpha, r#"{"low_stock": true}"#).await;
    assert_eq!(ids(snapshot(&pool).await), both);
    // A clinic that is not in use is skipped.
    sqlx::query("update aarogyam.organizations set status = 'suspended' where id = $1")
        .bind(c.beta)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(ids(snapshot(&pool).await), [a]);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_snapshot_uses_each_clinics_own_calendar_and_honours_the_limit(pool: PgPool) {
    let c = clinics(&pool).await;
    sqlx::query("update aarogyam.organizations set timezone = 'Pacific/Auckland' where id = $1")
        .bind(c.beta)
        .execute(&pool)
        .await
        .unwrap();
    item(&pool, c.alpha, "Gloves", 10).await;
    item(&pool, c.beta, "Gloves", 10).await;
    let late: Vec<Snapshot> = sqlx::query_as("select * from app.stock_usage_snapshot($1, 1)")
        .bind(datetime!(2026-10-15 12:00 UTC))
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(late.len(), 1, "the limit caps the rows");
    let both: Vec<Snapshot> = sqlx::query_as("select * from app.stock_usage_snapshot($1, 10)")
        .bind(datetime!(2026-10-15 12:00 UTC))
        .fetch_all(&pool)
        .await
        .unwrap();
    let day_of = |org| both.iter().find(|r| r.org_id == org).unwrap().local_today;
    assert_eq!(day_of(c.alpha), date!(2026 - 10 - 15));
    assert_eq!(day_of(c.beta), date!(2026 - 10 - 16));
}
