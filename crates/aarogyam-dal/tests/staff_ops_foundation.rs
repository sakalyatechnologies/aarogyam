//! Migration 0660, against a real Postgres: who gets the new permissions, what the widened
//! `staff_notifications` accepts and refuses, and the new clinic setting.
//!
//! Run with `DATABASE_URL=postgres://localhost:5432/postgres cargo test -p aarogyam-dal -- --include-ignored`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

use sqlx::PgPool;
use uuid::Uuid;

async fn holders(pool: &PgPool, permission: &str) -> Vec<String> {
    sqlx::query_scalar(
        "select t.key from aarogyam.role_template_permissions p
         join aarogyam.role_templates t on t.id = p.role_template_id
         where p.permission = $1 and p.scope = 'all' order by t.key",
    )
    .bind(permission)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_new_permissions_go_to_the_right_roles(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    let everyone = [
        "assistant",
        "consultant",
        "doctor",
        "finance",
        "front_desk",
        "owner",
    ];
    assert_eq!(holders(&pool, "tasks.use").await, everyone);
    assert_eq!(holders(&pool, "time_off.request").await, everyone);
    assert_eq!(holders(&pool, "tasks.manage").await, ["doctor", "owner"]);
    assert_eq!(holders(&pool, "time_off.manage").await, ["owner"]);
    let catalogued: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.permissions
         where key in ('tasks.use', 'tasks.manage', 'time_off.request', 'time_off.manage')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(catalogued, 4);
}

/// Inserts one notification with the given subject column and kind; foreign keys are off for
/// the session (the subject tables arrive in later migrations).
async fn notify(pool: &PgPool, sql_columns: &str, sql_values: &str) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("set session_replication_role = replica")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "insert into aarogyam.staff_notifications (org_id, {sql_columns}) values ($1, {sql_values})"
    )))
    .bind(ORG)
    .execute(&mut *conn)
    .await
    .map(|_| ())
}

const ORG: Uuid = Uuid::from_u128(1);
const SUBJECT: &str = "'00000000-0000-0000-0000-000000000042'";

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn old_notifications_still_pass_and_new_kinds_are_checked(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();

    // The kinds that exist already keep working.
    for (columns, values) in [
        (
            "kind, appointment_id",
            format!("'booking_requested', {SUBJECT}"),
        ),
        ("kind, appointment_id", format!("'arrival', {SUBJECT}")),
        (
            "kind, lab_order_id, lab_due_on",
            format!("'lab_overdue', {SUBJECT}, '2026-01-01'"),
        ),
        ("kind, invoice_id", format!("'payment_due', {SUBJECT}")),
        ("kind, recall_id", format!("'recall_due', {SUBJECT}")),
        ("kind, queue_token_id", format!("'send_in', {SUBJECT}")),
    ] {
        notify(&pool, columns, &values).await.unwrap();
    }

    // The new kinds, each about its own subject.
    let task = format!("'task_due', {SUBJECT}, 0");
    notify(&pool, "kind, task_occurrence_id, step_no", &task)
        .await
        .unwrap();
    notify(
        &pool,
        "kind, task_occurrence_id, step_no",
        &format!("'task_reminder', {SUBJECT}, 1"),
    )
    .await
    .unwrap();
    notify(
        &pool,
        "kind, time_off_request_id",
        &format!("'time_off_requested', {SUBJECT}"),
    )
    .await
    .unwrap();
    notify(
        &pool,
        "kind, time_off_request_id",
        &format!("'time_off_decided', {SUBJECT}"),
    )
    .await
    .unwrap();
    let stock = format!("'stock_alert', {SUBJECT}, '2026-01-01', 'low', 3, 1.5");
    let stock_columns =
        "kind, inventory_item_id, alert_on, stock_reason, stock_on_hand, stock_days_cover";
    notify(&pool, stock_columns, &stock).await.unwrap();

    // One notice per occurrence, kind and step; one alert per item and day.
    assert!(
        notify(&pool, "kind, task_occurrence_id, step_no", &task)
            .await
            .is_err()
    );
    assert!(notify(&pool, stock_columns, &stock).await.is_err());

    // Refused: a kind without its subject, a subject under the wrong kind, two subjects at
    // once, no subject, and a stock alert without its day or reason.
    for (columns, values) in [
        ("kind, task_occurrence_id", format!("'task_due', {SUBJECT}")),
        (
            "kind, appointment_id",
            "'task_due', '00000000-0000-0000-0000-000000000043'".to_owned(),
        ),
        (
            "kind, time_off_request_id",
            format!("'task_due', {SUBJECT}"),
        ),
        (
            "kind, appointment_id, time_off_request_id",
            format!("'time_off_requested', {SUBJECT}, {SUBJECT}"),
        ),
        ("kind", "'stock_alert'".to_owned()),
        (
            "kind, inventory_item_id",
            format!("'stock_alert', {SUBJECT}"),
        ),
        (
            "kind, inventory_item_id, alert_on, stock_reason",
            format!("'stock_alert', {SUBJECT}, '2026-01-02', 'soon'"),
        ),
        (
            "kind, appointment_id",
            format!("'tasks_overdue', {SUBJECT}"),
        ),
    ] {
        assert!(
            notify(&pool, columns, &values).await.is_err(),
            "{columns}: {values}"
        );
    }
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn staff_ops_settings_default_to_an_empty_object(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    let default: String = sqlx::query_scalar(
        "select column_default from information_schema.columns
         where table_schema = 'aarogyam' and table_name = 'org_settings' and column_name = 'staff_ops'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(default.starts_with("'{}'"), "{default}");
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("set session_replication_role = replica")
        .execute(&mut *conn)
        .await
        .unwrap();
    let err =
        sqlx::query("insert into aarogyam.org_settings (org_id, staff_ops) values ($1, '[]')")
            .bind(ORG)
            .execute(&mut *conn)
            .await;
    assert!(err.is_err());
}
