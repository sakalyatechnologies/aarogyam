//! Migration 0663, against a real Postgres: task reminders at due + k x interval, escalation, quiet
//! hours, exactly-once under overlapping runs, and the missed sweep. The clock is the `now`
//! argument, so every test sets it.
//!
//! Run with `DATABASE_URL=postgres://localhost:5432/postgres cargo test -p aarogyam-dal -- --include-ignored`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

use aarogyam_dal::task_jobs::{ReminderCounts, materialize, run_reminders};
use sqlx::PgPool;
use time::macros::datetime;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

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

async fn role(pool: &PgPool, org: Uuid, key: &str) -> Uuid {
    sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = $2")
        .bind(org)
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// A new member of the clinic with the role and status.
async fn member(pool: &PgPool, org: Uuid, role_key: &str, status: &str) -> Uuid {
    let user = Uuid::now_v7();
    sqlx::query(
        "insert into aarogyam.users (id, auth_uid, email, display_name) values ($1, $2, $3, 'Staff')",
    )
    .bind(user)
    .bind(Uuid::now_v7())
    .bind(format!("{user}@staff.test"))
    .execute(pool)
    .await
    .unwrap();
    let role = role(pool, org, role_key).await;
    sqlx::query_scalar(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status) values ($1, $2, $3, $4)
         returning id",
    )
    .bind(org)
    .bind(user)
    .bind(role)
    .bind(status)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// 09:00 in India on 2027-01-05, when the test task falls due.
const DUE: OffsetDateTime = datetime!(2027-01-05 03:30 UTC);

fn after(minutes: i64) -> OffsetDateTime {
    DUE + Duration::minutes(minutes)
}

#[derive(Clone, Copy)]
enum Who {
    FrontDesk,
    OwnerMember,
    OwnerRole,
}

#[derive(Clone, Copy)]
struct Opts {
    interval_days: Option<i32>,
    remind: Option<i32>,
    escalate_after: i32,
    who: Who,
}

const DEFAULT: Opts = Opts {
    interval_days: None,
    remind: None,
    escalate_after: 3,
    who: Who::FrontDesk,
};

/// A clinic with a task due at 09:00 (daily, or every N days) for the assignee, made at `DUE`.
async fn setup(pool: &PgPool, opts: Opts) -> Uuid {
    aarogyam_dal::migrate(pool).await.unwrap();
    let org = clinic(pool, "alpha", "AL").await;
    let (member, role): (Option<Uuid>, Option<Uuid>) = match opts.who {
        Who::FrontDesk => (Some(member(pool, org, "front_desk", "active").await), None),
        Who::OwnerMember => (
            sqlx::query_scalar(
                "select m.id from aarogyam.memberships m join aarogyam.roles r
                   on r.org_id = m.org_id and r.id = m.role_id
                 where m.org_id = $1 and r.key = 'owner'",
            )
            .bind(org)
            .fetch_one(pool)
            .await
            .unwrap(),
            None,
        ),
        Who::OwnerRole => (None, Some(role(pool, org, "owner").await)),
    };
    sqlx::query(
        "insert into aarogyam.task_templates
           (org_id, title, assignee_membership_id, assignee_role_id, schedule_kind, interval_days,
            due_time, starts_on, remind_every_minutes, escalate_after, activated_at)
         values ($1, 'Task', $2, $3, $4, $5, '09:00', '2027-01-02', $6, $7, '2020-01-01Z')",
    )
    .bind(org)
    .bind(member)
    .bind(role)
    .bind(if opts.interval_days.is_some() {
        "every_n_days"
    } else {
        "daily"
    })
    .bind(opts.interval_days)
    .bind(opts.remind)
    .bind(opts.escalate_after)
    .execute(pool)
    .await
    .unwrap();
    // The standard tasks are not under test.
    sqlx::query(
        "update aarogyam.task_templates set active = false where org_id = $1 and is_default",
    )
    .bind(org)
    .execute(pool)
    .await
    .unwrap();
    assert_eq!(materialize(pool, DUE, 100).await.unwrap(), 1);
    org
}

async fn run(pool: &PgPool, at: OffsetDateTime) -> ReminderCounts {
    run_reminders(pool, at, 100).await.unwrap()
}

fn counts(reminded: i32, escalated: i32, missed: i32) -> ReminderCounts {
    ReminderCounts {
        reminded,
        escalated,
        missed,
    }
}

/// The step numbers of a clinic's notices of one kind, in order.
async fn steps(pool: &PgPool, org: Uuid, kind: &'static str) -> Vec<i32> {
    sqlx::query_scalar(
        "select step_no from aarogyam.staff_notifications
         where org_id = $1 and kind = $2 order by step_no, created_at",
    )
    .bind(org)
    .bind(kind)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// The first occurrence's reminder count and status.
async fn first(pool: &PgPool, org: Uuid) -> (i32, String) {
    sqlx::query_as(
        "select reminder_count, status from aarogyam.task_occurrences where org_id = $1
         order by due_at limit 1",
    )
    .bind(org)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn set_staff_ops(pool: &PgPool, org: Uuid, json: &str) {
    sqlx::query("update aarogyam.org_settings set staff_ops = $2::jsonb where org_id = $1")
        .bind(org)
        .bind(json)
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn reminders_come_hourly_then_escalate_once_and_go_on(pool: PgPool) {
    let org = setup(&pool, DEFAULT).await;
    // Nothing before the first interval has passed.
    assert_eq!(run(&pool, after(59)).await, counts(0, 0, 0));
    assert_eq!(run(&pool, after(60)).await, counts(1, 0, 0));
    // The same minute again, and halfway to the next one: nothing.
    assert_eq!(run(&pool, after(60)).await, counts(0, 0, 0));
    assert_eq!(run(&pool, after(90)).await, counts(0, 0, 0));
    assert_eq!(run(&pool, after(120)).await, counts(1, 0, 0));
    assert_eq!(steps(&pool, org, "task_escalated").await.len(), 0);
    // The third reminder uses up escalate_after (3): the owners are told, once.
    assert_eq!(run(&pool, after(180)).await, counts(1, 1, 0));
    // Reminders go on every hour after it, and it is not escalated again.
    assert_eq!(run(&pool, after(240)).await, counts(1, 0, 0));
    assert_eq!(run(&pool, after(300)).await, counts(1, 0, 0));
    assert_eq!(
        steps(&pool, org, "task_reminder").await,
        vec![1, 2, 3, 4, 5]
    );
    assert_eq!(steps(&pool, org, "task_escalated").await, vec![3]);
    assert_eq!(steps(&pool, org, "task_due").await, vec![0]);
    // Every notice is about the occurrence and points at Today; none carries another subject.
    let stray: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.staff_notifications
         where org_id = $1 and (task_occurrence_id is null or href is distinct from '/today'
               or num_nonnulls(appointment_id, lab_order_id, invoice_id, recall_id, queue_token_id,
                               time_off_request_id, inventory_item_id) <> 0)",
    )
    .bind(org)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stray, 0);
    assert_eq!(first(&pool, org).await, (5, "open".to_owned()));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn the_interval_is_the_tasks_then_the_clinics_then_sixty(pool: PgPool) {
    // The task's own interval beats the clinic's.
    let org = setup(
        &pool,
        Opts {
            remind: Some(30),
            ..DEFAULT
        },
    )
    .await;
    set_staff_ops(&pool, org, r#"{"tasks": {"remind_every_minutes": 45}}"#).await;
    assert_eq!(run(&pool, after(29)).await, counts(0, 0, 0));
    assert_eq!(run(&pool, after(30)).await, counts(1, 0, 0));
    assert_eq!(run(&pool, after(60)).await, counts(1, 0, 0));
    assert_eq!(steps(&pool, org, "task_reminder").await, vec![1, 2]);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn the_clinics_interval_applies_when_the_task_has_none(pool: PgPool) {
    let org = setup(&pool, DEFAULT).await;
    set_staff_ops(&pool, org, r#"{"tasks": {"remind_every_minutes": 45}}"#).await;
    assert_eq!(run(&pool, after(44)).await, counts(0, 0, 0));
    assert_eq!(run(&pool, after(45)).await, counts(1, 0, 0));
    assert_eq!(run(&pool, after(90)).await, counts(1, 0, 0));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn quiet_hours_hold_reminders_without_advancing_the_count(pool: PgPool) {
    let org = setup(&pool, DEFAULT).await;
    // Quiet from 10:00 to 11:30 clinic time, which is +60 to +150 minutes after the task fell due.
    sqlx::query(
        "update aarogyam.org_settings
         set notifications = jsonb_set(coalesce(notifications, '{}'), '{quiet_hours}',
                                       '{\"start\": \"10:00\", \"end\": \"11:30\"}')
         where org_id = $1",
    )
    .bind(org)
    .execute(&pool)
    .await
    .unwrap();
    for minutes in [60, 90, 149] {
        assert_eq!(run(&pool, after(minutes)).await, counts(0, 0, 0));
        assert_eq!(first(&pool, org).await, (0, "open".to_owned()));
    }
    // The first run after the quiet hours sends the one reminder that was due; the next is not
    // sent in a burst but at its own time.
    assert_eq!(run(&pool, after(150)).await, counts(1, 0, 0));
    assert_eq!(run(&pool, after(151)).await, counts(0, 0, 0));
    assert_eq!(run(&pool, after(180)).await, counts(1, 0, 0));
    assert_eq!(steps(&pool, org, "task_reminder").await, vec![1, 2]);
    // Switched off, they hold nothing (and the third reminder escalates).
    sqlx::query(
        "update aarogyam.org_settings
         set notifications = jsonb_set(notifications, '{quiet_hours,enabled}', 'false')
         where org_id = $1",
    )
    .bind(org)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(run(&pool, after(210)).await, counts(1, 1, 0));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn overlapping_runs_send_each_reminder_once(pool: PgPool) {
    let org = setup(
        &pool,
        Opts {
            escalate_after: 1,
            ..DEFAULT
        },
    )
    .await;
    for minutes in [60, 120] {
        let (a, b, c) = tokio::join!(
            run_reminders(&pool, after(minutes), 100),
            run_reminders(&pool, after(minutes), 100),
            run_reminders(&pool, after(minutes), 100)
        );
        let total: i32 = [a, b, c].into_iter().map(|r| r.unwrap().reminded).sum();
        assert_eq!(total, 1, "minute {minutes}");
    }
    assert_eq!(steps(&pool, org, "task_reminder").await, vec![1, 2]);
    assert_eq!(steps(&pool, org, "task_escalated").await.len(), 1);
    assert_eq!(first(&pool, org).await.0, 2);
}

/// Runs the first four hours of reminders for a task held by `who`, and returns how many
/// `task_escalated` notices there are.
async fn escalations(pool: &PgPool, who: Who) -> usize {
    let org = setup(pool, Opts { who, ..DEFAULT }).await;
    for minutes in [60, 120, 180, 240] {
        run(pool, after(minutes)).await;
    }
    // The reminders themselves come regardless, before and after any escalation.
    assert_eq!(steps(pool, org, "task_reminder").await, vec![1, 2, 3, 4]);
    steps(pool, org, "task_escalated").await.len()
}

// Escalation is a notice for the owner role (the feed shows it to them alone); a task the owner
// already holds, by name or through the role, has nobody above to tell.
#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn a_front_desk_task_escalates_to_the_owner(pool: PgPool) {
    assert_eq!(escalations(&pool, Who::FrontDesk).await, 1);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn a_task_held_by_the_owner_by_name_is_not_escalated(pool: PgPool) {
    assert_eq!(escalations(&pool, Who::OwnerMember).await, 0);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn a_task_held_by_the_owner_role_is_not_escalated(pool: PgPool) {
    assert_eq!(escalations(&pool, Who::OwnerRole).await, 0);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn escalate_after_zero_never_escalates(pool: PgPool) {
    let org = setup(
        &pool,
        Opts {
            escalate_after: 0,
            ..DEFAULT
        },
    )
    .await;
    for minutes in [60, 120, 180, 240] {
        run(&pool, after(minutes)).await;
    }
    assert_eq!(steps(&pool, org, "task_escalated").await.len(), 0);
    assert_eq!(steps(&pool, org, "task_reminder").await.len(), 4);
}

/// How many of the occurrence's notices are still unhandled, for the first and the last one.
async fn unhandled(pool: &PgPool, org: Uuid) -> (i64, i64) {
    let rows: Vec<i64> = sqlx::query_scalar(
        "select count(*) filter (where n.handled_at is null)
         from aarogyam.task_occurrences o
         join aarogyam.staff_notifications n
           on n.org_id = o.org_id and n.task_occurrence_id = o.id
         where o.org_id = $1 group by o.id, o.due_at order by o.due_at",
    )
    .bind(org)
    .fetch_all(pool)
    .await
    .unwrap();
    (rows[0], rows[rows.len() - 1])
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn a_task_is_missed_when_the_next_one_falls_due(pool: PgPool) {
    let org = setup(&pool, DEFAULT).await;
    for minutes in [60, 120, 180] {
        run(&pool, after(minutes)).await;
    }
    assert_eq!(unhandled(&pool, org).await, (5, 5));
    // Just before tomorrow's occurrence falls due, today's is still being reminded.
    assert_eq!(run(&pool, after(24 * 60 - 1)).await.missed, 0);
    // When it falls due, the old one is missed and its notices are handled; the new one starts.
    assert_eq!(materialize(&pool, after(24 * 60), 100).await.unwrap(), 1);
    assert_eq!(run(&pool, after(24 * 60)).await, counts(0, 0, 1));
    assert_eq!(first(&pool, org).await.1, "missed");
    assert_eq!(unhandled(&pool, org).await, (0, 1));
    // A missed task is not reminded or escalated any more, and the sweep is not repeated.
    assert_eq!(run(&pool, after(24 * 60 + 60)).await, counts(1, 0, 0));
    assert_eq!(
        first(&pool, org).await.0,
        3,
        "the missed one got no more reminders"
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn a_task_with_no_next_day_is_missed_after_25_hours(pool: PgPool) {
    // Every third day: nothing else falls due soon, so the 25 hours decide.
    let org = setup(
        &pool,
        Opts {
            interval_days: Some(3),
            ..DEFAULT
        },
    )
    .await;
    assert_eq!(run(&pool, after(25 * 60 - 1)).await.missed, 0);
    assert_eq!(first(&pool, org).await.1, "open");
    assert_eq!(run(&pool, after(25 * 60)).await, counts(0, 0, 1));
    assert_eq!(first(&pool, org).await.1, "missed");
    assert_eq!(unhandled(&pool, org).await, (0, 0));
    // Nothing more happens to it.
    assert_eq!(run(&pool, after(26 * 60)).await, counts(0, 0, 0));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs Postgres (DATABASE_URL)"]
async fn finished_tasks_are_left_alone_and_other_clinics_are_not_mixed_up(pool: PgPool) {
    let org = setup(
        &pool,
        Opts {
            interval_days: Some(3),
            ..DEFAULT
        },
    )
    .await;
    let done_by: Uuid = sqlx::query_scalar(
        "select assignee_membership_id from aarogyam.task_occurrences where org_id = $1",
    )
    .bind(org)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "update aarogyam.task_occurrences set status = 'done', completed_at = $2, completed_by = $3
         where org_id = $1",
    )
    .bind(org)
    .bind(after(30))
    .bind(done_by)
    .execute(&pool)
    .await
    .unwrap();
    // A done task is neither reminded nor escalated nor missed, however late the run is.
    for minutes in [60, 180, 25 * 60, 48 * 60] {
        assert_eq!(run(&pool, after(minutes)).await, counts(0, 0, 0));
    }
    assert_eq!(first(&pool, org).await, (0, "done".to_owned()));
}
