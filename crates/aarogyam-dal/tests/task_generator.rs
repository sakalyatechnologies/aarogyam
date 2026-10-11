//! Migrations 0661 and 0662, against a real Postgres: the task tables' rules, when a schedule
//! falls due (daylight saving, every N days, weekdays, once), what the generator makes and
//! skips, the standard tasks, and the clinic boundary.
//!
//! Run with `DATABASE_URL=postgres://localhost:5432/postgres cargo test -p aarogyam-dal -- --include-ignored`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

use aarogyam_dal::task_jobs::{materialize, seed_defaults, seed_missing_defaults};
use sqlx::PgPool;
use time::macros::{date, datetime, time};
use time::{Date, OffsetDateTime, Time};
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

async fn set_timezone(pool: &PgPool, org: Uuid, zone: &str) {
    sqlx::query("update aarogyam.organizations set timezone = $2 where id = $1")
        .bind(org)
        .bind(zone)
        .execute(pool)
        .await
        .unwrap();
}

/// A template under construction; the fields are the table's own.
#[derive(Clone, Copy)]
struct Spec {
    kind: &'static str,
    once_at: Option<OffsetDateTime>,
    interval_days: Option<i32>,
    weekdays: Option<i16>,
    due_time: Option<Time>,
    starts_on: Option<Date>,
    ends_on: Option<Date>,
}

const DAILY_0900: Spec = Spec {
    kind: "daily",
    once_at: None,
    interval_days: None,
    weekdays: None,
    due_time: Some(time!(09:00)),
    starts_on: Some(date!(2027 - 01 - 01)),
    ends_on: None,
};

/// Adds a template for the person (`Ok(member)`) or the role (`Err(role)`), counting from long
/// ago unless the test says otherwise.
async fn template(pool: &PgPool, org: Uuid, assignee: Result<Uuid, Uuid>, spec: Spec) -> Uuid {
    let (member, role) = match assignee {
        Ok(member) => (Some(member), None),
        Err(role) => (None, Some(role)),
    };
    sqlx::query_scalar(
        "insert into aarogyam.task_templates
           (org_id, title, assignee_membership_id, assignee_role_id, schedule_kind, once_at,
            interval_days, weekdays, due_time, starts_on, ends_on, activated_at)
         values ($1, 'Task', $2, $3, $4, $5, $6, $7, $8, $9, $10, '2020-01-01Z') returning id",
    )
    .bind(org)
    .bind(member)
    .bind(role)
    .bind(spec.kind)
    .bind(spec.once_at)
    .bind(spec.interval_days)
    .bind(spec.weekdays)
    .bind(spec.due_time)
    .bind(spec.starts_on)
    .bind(spec.ends_on)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn occurrences(pool: &PgPool, org: Uuid) -> Vec<(Date, OffsetDateTime)> {
    sqlx::query_as(
        "select local_date, due_at from aarogyam.task_occurrences where org_id = $1
         order by due_at",
    )
    .bind(org)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn count(pool: &PgPool, sql: &'static str, org: Uuid) -> i64 {
    sqlx::query_scalar(sql)
        .bind(org)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn task_due_notices(pool: &PgPool, org: Uuid) -> i64 {
    count(
        pool,
        "select count(*) from aarogyam.staff_notifications
         where org_id = $1 and kind = 'task_due' and step_no = 0 and href = '/today'",
        org,
    )
    .await
}

/// The slots `app.task_due_dates` gives for a schedule in a zone, in a window.
async fn due_dates(
    pool: &PgPool,
    spec: Spec,
    zone: &str,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Vec<(Date, OffsetDateTime)> {
    sqlx::query_as(
        "select local_date, due_at from app.task_due_dates($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         order by due_at",
    )
    .bind(spec.kind)
    .bind(spec.interval_days)
    .bind(spec.weekdays.map(i32::from))
    .bind(spec.starts_on)
    .bind(spec.ends_on)
    .bind(spec.due_time)
    .bind(spec.once_at)
    .bind(zone)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_generator_makes_each_slot_once_with_its_notice(pool: PgPool) {
    let c = clinics(&pool).await;
    let assistant = role(&pool, c.alpha, "assistant").await;
    member(&pool, c.alpha, "assistant", "active").await;
    let from_the_5th = Spec {
        starts_on: Some(date!(2027 - 01 - 05)),
        ..DAILY_0900
    };
    template(&pool, c.alpha, Err(assistant), from_the_5th).await;

    // 09:00 India is 03:30 UTC. A minute early makes nothing; on the minute it falls due.
    assert_eq!(
        materialize(&pool, datetime!(2027-01-05 03:29 UTC), 100)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        materialize(&pool, datetime!(2027-01-05 03:30 UTC), 100)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        occurrences(&pool, c.alpha).await,
        [(date!(2027 - 01 - 05), datetime!(2027-01-05 03:30 UTC))]
    );
    assert_eq!(task_due_notices(&pool, c.alpha).await, 1);

    // Running again, even later the same day, makes nothing new.
    assert_eq!(
        materialize(&pool, datetime!(2027-01-05 03:30 UTC), 100)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        materialize(&pool, datetime!(2027-01-05 08:00 UTC), 100)
            .await
            .unwrap(),
        0
    );
    assert_eq!(task_due_notices(&pool, c.alpha).await, 1);

    // The snapshot is of the template.
    let (title, action, status): (String, String, String) = sqlx::query_as(
        "select title, action, status from aarogyam.task_occurrences where org_id = $1",
    )
    .bind(c.alpha)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (title.as_str(), action.as_str(), status.as_str()),
        ("Task", "none", "open")
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn two_runs_at_once_make_one_occurrence_and_one_notice(pool: PgPool) {
    let c = clinics(&pool).await;
    let assistant = role(&pool, c.alpha, "assistant").await;
    member(&pool, c.alpha, "assistant", "active").await;
    for _ in 0..5 {
        template(&pool, c.alpha, Err(assistant), DAILY_0900).await;
    }
    let now = datetime!(2027-01-05 04:00 UTC);
    let (a, b, c2) = tokio::join!(
        materialize(&pool, now, 100),
        materialize(&pool, now, 100),
        materialize(&pool, now, 100)
    );
    let made = a.unwrap() + b.unwrap() + c2.unwrap();
    assert_eq!(made, 5);
    assert_eq!(occurrences(&pool, c.alpha).await.len(), 5);
    assert_eq!(task_due_notices(&pool, c.alpha).await, 5);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn an_outage_is_caught_up_but_not_beyond_24_hours(pool: PgPool) {
    let c = clinics(&pool).await;
    let owner = role(&pool, c.alpha, "owner").await;
    // One slot only, 2027-01-05 09:00 India (03:30 UTC).
    let one_day = Spec {
        starts_on: Some(date!(2027 - 01 - 05)),
        ends_on: Some(date!(2027 - 01 - 05)),
        ..DAILY_0900
    };
    template(&pool, c.alpha, Err(owner), one_day).await;

    // 25 hours late: too old, and it stays unmade.
    assert_eq!(
        materialize(&pool, datetime!(2027-01-06 04:31 UTC), 100)
            .await
            .unwrap(),
        0
    );
    // 23 hours late: caught up.
    assert_eq!(
        materialize(&pool, datetime!(2027-01-06 02:30 UTC), 100)
            .await
            .unwrap(),
        1
    );
    assert_eq!(occurrences(&pool, c.alpha).await.len(), 1);

    // A daily task after a three-day outage makes only the latest day.
    let other = template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    assert_eq!(
        materialize(&pool, datetime!(2027-01-10 03:30 UTC), 100)
            .await
            .unwrap(),
        1
    );
    let days: Vec<Date> = sqlx::query_scalar(
        "select local_date from aarogyam.task_occurrences where template_id = $1",
    )
    .bind(other)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(days, [date!(2027 - 01 - 10)]);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn nothing_falls_due_before_the_template_began_to_count(pool: PgPool) {
    let c = clinics(&pool).await;
    let owner = role(&pool, c.alpha, "owner").await;
    let id = template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    // Created at 11:00 India on the 5th: that morning's 09:00 is already past.
    sqlx::query("update aarogyam.task_templates set activated_at = $2 where id = $1")
        .bind(id)
        .bind(datetime!(2027-01-05 05:30 UTC))
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        materialize(&pool, datetime!(2027-01-05 06:00 UTC), 100)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        materialize(&pool, datetime!(2027-01-06 03:30 UTC), 100)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        occurrences(&pool, c.alpha).await,
        [(date!(2027 - 01 - 06), datetime!(2027-01-06 03:30 UTC))]
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn switching_back_on_or_changing_the_schedule_restarts_the_count(pool: PgPool) {
    let c = clinics(&pool).await;
    let owner = role(&pool, c.alpha, "owner").await;
    let id = template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    let activated = |pool: PgPool| async move {
        sqlx::query_scalar::<_, OffsetDateTime>(
            "select activated_at from aarogyam.task_templates where id = $1",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    let long_ago = activated(pool.clone()).await;
    assert_eq!(long_ago, datetime!(2020-01-01 0:00 UTC));

    // Other edits leave it alone.
    sqlx::query(
        "update aarogyam.task_templates set title = 'Renamed', escalate_after = 5 where id = $1",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(activated(pool.clone()).await, long_ago);

    // Switched off, it keeps its time; switched on, it starts again from now.
    sqlx::query("update aarogyam.task_templates set active = false where id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(activated(pool.clone()).await, long_ago);
    sqlx::query("update aarogyam.task_templates set active = true where id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let on = activated(pool.clone()).await;
    assert!(on > long_ago);

    // A new time of day starts again too.
    sqlx::query("update aarogyam.task_templates set activated_at = '2020-01-01Z' where id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("update aarogyam.task_templates set due_time = '08:00' where id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(activated(pool.clone()).await > long_ago);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn daylight_saving_keeps_one_occurrence_per_local_day(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    let zone = "America/New_York";
    let at = |time| Spec {
        due_time: Some(time),
        ..DAILY_0900
    };

    // Spring forward, 2027-03-14: 02:30 does not exist and is read forward, as 03:30 EDT.
    let slots = due_dates(
        &pool,
        at(time!(02:30)),
        zone,
        datetime!(2027-03-12 12:00 UTC),
        datetime!(2027-03-16 00:00 UTC),
    )
    .await;
    assert_eq!(
        slots,
        [
            (date!(2027 - 03 - 13), datetime!(2027-03-13 07:30 UTC)),
            (date!(2027 - 03 - 14), datetime!(2027-03-14 07:30 UTC)),
            (date!(2027 - 03 - 15), datetime!(2027-03-15 06:30 UTC)),
        ]
    );
    // An ordinary time that day is an hour earlier in UTC than the day before.
    let slots = due_dates(
        &pool,
        at(time!(09:00)),
        zone,
        datetime!(2027-03-13 00:00 UTC),
        datetime!(2027-03-15 23:00 UTC),
    )
    .await;
    assert_eq!(
        slots.iter().map(|(_, due)| *due).collect::<Vec<_>>(),
        [
            datetime!(2027-03-13 14:00 UTC),
            datetime!(2027-03-14 13:00 UTC),
            datetime!(2027-03-15 13:00 UTC)
        ]
    );

    // Fall back, 2027-11-07: 01:30 happens twice and resolves to one instant, once.
    let slots = due_dates(
        &pool,
        at(time!(01:30)),
        zone,
        datetime!(2027-11-05 12:00 UTC),
        datetime!(2027-11-09 00:00 UTC),
    )
    .await;
    let days: Vec<Date> = slots.iter().map(|(day, _)| *day).collect();
    assert_eq!(
        days,
        [
            date!(2027 - 11 - 06),
            date!(2027 - 11 - 07),
            date!(2027 - 11 - 08)
        ]
    );
    let ambiguous = slots[1].1;
    assert!(
        ambiguous == datetime!(2027-11-07 05:30 UTC)
            || ambiguous == datetime!(2027-11-07 06:30 UTC),
        "{ambiguous}"
    );
    // The day after is an hour later in UTC than before the change.
    assert_eq!(slots[2].1, datetime!(2027-11-08 06:30 UTC));

    // Through the generator: a New York clinic gets one occurrence on each of those days.
    let ny = clinic(&pool, "newyork", "NY").await;
    set_timezone(&pool, ny, zone).await;
    let owner = role(&pool, ny, "owner").await;
    template(&pool, ny, Err(owner), at(time!(02:30))).await;
    for now in [
        datetime!(2027-03-13 12:00 UTC),
        datetime!(2027-03-14 12:00 UTC),
        datetime!(2027-03-14 20:00 UTC),
        datetime!(2027-03-15 12:00 UTC),
    ] {
        materialize(&pool, now, 100).await.unwrap();
    }
    let days: Vec<Date> = occurrences(&pool, ny)
        .await
        .into_iter()
        .map(|(day, _)| day)
        .collect();
    assert_eq!(
        days,
        [
            date!(2027 - 03 - 13),
            date!(2027 - 03 - 14),
            date!(2027 - 03 - 15)
        ]
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn india_and_an_unknown_zone_both_read_as_india(pool: PgPool) {
    let c = clinics(&pool).await;
    // India has no daylight saving: the same UTC time all year.
    let slots = due_dates(
        &pool,
        DAILY_0900,
        "Asia/Kolkata",
        datetime!(2027-03-13 00:00 UTC),
        datetime!(2027-03-15 23:00 UTC),
    )
    .await;
    assert_eq!(
        slots.iter().map(|(_, due)| *due).collect::<Vec<_>>(),
        [
            datetime!(2027-03-13 03:30 UTC),
            datetime!(2027-03-14 03:30 UTC),
            datetime!(2027-03-15 03:30 UTC)
        ]
    );

    // A zone Postgres does not know, or none at all, is read as India's.
    for zone in ["Mars/Olympus_Mons", ""] {
        let unknown = due_dates(
            &pool,
            DAILY_0900,
            zone,
            datetime!(2027-03-13 00:00 UTC),
            datetime!(2027-03-15 23:00 UTC),
        )
        .await;
        assert_eq!(unknown, slots, "zone {zone:?}");
    }

    // The same through a clinic row, for the generator and the local-to-UTC helper.
    set_timezone(&pool, c.alpha, "Mars/Olympus_Mons").await;
    let owner = role(&pool, c.alpha, "owner").await;
    template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    assert_eq!(
        materialize(&pool, datetime!(2027-03-14 04:00 UTC), 100)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        occurrences(&pool, c.alpha).await,
        [(date!(2027 - 03 - 14), datetime!(2027-03-14 03:30 UTC))]
    );
    let instant: OffsetDateTime =
        sqlx::query_scalar("select app.clinic_local_to_utc($1, '2027-03-14 09:00')")
            .bind(c.alpha)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(instant, datetime!(2027-03-14 03:30 UTC));
    set_timezone(&pool, c.alpha, "America/New_York").await;
    let instant: OffsetDateTime =
        sqlx::query_scalar("select app.clinic_local_to_utc($1, '2027-03-14 09:00')")
            .bind(c.alpha)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(instant, datetime!(2027-03-14 13:00 UTC));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn every_n_days_counts_from_the_start_date(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    let every_3 = Spec {
        kind: "every_n_days",
        interval_days: Some(3),
        starts_on: Some(date!(2027 - 01 - 01)),
        ..DAILY_0900
    };
    let days = |slots: Vec<(Date, OffsetDateTime)>| -> Vec<u8> {
        slots.into_iter().map(|(day, _)| day.day()).collect()
    };
    let whole = days(
        due_dates(
            &pool,
            every_3,
            "UTC",
            datetime!(2026-12-30 00:00 UTC),
            datetime!(2027-01-13 00:00 UTC),
        )
        .await,
    );
    assert_eq!(whole, [1, 4, 7, 10]);
    // A window that starts in the middle keeps the same days: the count is from the start date.
    let later = days(
        due_dates(
            &pool,
            every_3,
            "UTC",
            datetime!(2027-01-05 00:00 UTC),
            datetime!(2027-01-13 00:00 UTC),
        )
        .await,
    );
    assert_eq!(later, [7, 10]);
    // The end date stops it.
    let ends = Spec {
        ends_on: Some(date!(2027 - 01 - 07)),
        ..every_3
    };
    assert_eq!(
        days(
            due_dates(
                &pool,
                ends,
                "UTC",
                datetime!(2026-12-30 00:00 UTC),
                datetime!(2027-01-13 00:00 UTC)
            )
            .await
        ),
        [1, 4, 7]
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn weekdays_fall_on_the_chosen_days_between_start_and_end(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    // Monday 1, Wednesday 4, Friday 16. 4 January 2027 is a Monday.
    let mwf = Spec {
        kind: "weekdays",
        weekdays: Some(1 + 4 + 16),
        starts_on: Some(date!(2027 - 01 - 01)),
        ..DAILY_0900
    };
    let slots = due_dates(
        &pool,
        mwf,
        "UTC",
        datetime!(2027-01-03 00:00 UTC),
        datetime!(2027-01-11 23:00 UTC),
    )
    .await;
    let days: Vec<u8> = slots.iter().map(|(day, _)| day.day()).collect();
    assert_eq!(days, [4, 6, 8, 11]);
    // Sunday is 64.
    let sunday = Spec {
        weekdays: Some(64),
        ..mwf
    };
    let slots = due_dates(
        &pool,
        sunday,
        "UTC",
        datetime!(2027-01-01 00:00 UTC),
        datetime!(2027-01-20 00:00 UTC),
    )
    .await;
    assert_eq!(
        slots.iter().map(|(day, _)| day.day()).collect::<Vec<_>>(),
        [3, 10, 17]
    );
    // Before the start date and after the end date, nothing.
    let bounded = Spec {
        starts_on: Some(date!(2027 - 01 - 06)),
        ends_on: Some(date!(2027 - 01 - 08)),
        ..mwf
    };
    let slots = due_dates(
        &pool,
        bounded,
        "UTC",
        datetime!(2027-01-01 00:00 UTC),
        datetime!(2027-01-20 00:00 UTC),
    )
    .await;
    assert_eq!(
        slots.iter().map(|(day, _)| day.day()).collect::<Vec<_>>(),
        [6, 8]
    );
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn a_one_off_task_fires_once_and_switches_itself_off(pool: PgPool) {
    let c = clinics(&pool).await;
    let owner = role(&pool, c.alpha, "owner").await;
    let once = Spec {
        kind: "once",
        once_at: Some(datetime!(2027-02-01 05:00 UTC)),
        due_time: None,
        starts_on: None,
        ..DAILY_0900
    };
    let id = template(&pool, c.alpha, Err(owner), once).await;
    assert_eq!(
        materialize(&pool, datetime!(2027-02-01 04:59 UTC), 100)
            .await
            .unwrap(),
        0
    );
    let active = |pool: PgPool| async move {
        sqlx::query_scalar::<_, bool>("select active from aarogyam.task_templates where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
    };
    assert!(active(pool.clone()).await);
    assert_eq!(
        materialize(&pool, datetime!(2027-02-01 05:10 UTC), 100)
            .await
            .unwrap(),
        1
    );
    assert!(!active(pool.clone()).await);
    assert_eq!(
        materialize(&pool, datetime!(2027-02-01 05:20 UTC), 100)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        occurrences(&pool, c.alpha).await,
        [(date!(2027 - 02 - 01), datetime!(2027-02-01 05:00 UTC))]
    );
    assert_eq!(task_due_notices(&pool, c.alpha).await, 1);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn clinics_not_in_use_and_assignees_who_cannot_act_are_skipped(pool: PgPool) {
    let c = clinics(&pool).await;
    let now = datetime!(2027-01-05 04:00 UTC);

    // A person who is not active.
    let away = member(&pool, c.alpha, "assistant", "suspended").await;
    let for_away = template(&pool, c.alpha, Ok(away), DAILY_0900).await;
    // A role nobody active holds.
    let front_desk = role(&pool, c.alpha, "front_desk").await;
    member(&pool, c.alpha, "front_desk", "left").await;
    let for_empty = template(&pool, c.alpha, Err(front_desk), DAILY_0900).await;
    // Templates that are switched off or deleted.
    let owner = role(&pool, c.alpha, "owner").await;
    let off = template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    sqlx::query("update aarogyam.task_templates set active = false where id = $1")
        .bind(off)
        .execute(&pool)
        .await
        .unwrap();
    // Reset the count that switching off and on would have, only to be sure the filter, not the
    // time, is what skips it.
    let gone = template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    sqlx::query("update aarogyam.task_templates set deleted_at = now() where id = $1")
        .bind(gone)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(materialize(&pool, now, 100).await.unwrap(), 0);

    // A clinic that is suspended or has churned.
    let ok = template(
        &pool,
        c.beta,
        Err(role(&pool, c.beta, "owner").await),
        DAILY_0900,
    )
    .await;
    for status in ["suspended", "churned"] {
        sqlx::query("update aarogyam.organizations set status = $2 where id = $1")
            .bind(c.beta)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(materialize(&pool, now, 100).await.unwrap(), 0, "{status}");
    }
    // Back on trial it runs; and now the active people count.
    sqlx::query("update aarogyam.organizations set status = 'trial' where id = $1")
        .bind(c.beta)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("update aarogyam.memberships set status = 'active' where org_id = $1 and status <> 'active' and role_id = $2")
        .bind(c.alpha)
        .bind(front_desk)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("update aarogyam.memberships set status = 'active' where id = $1")
        .bind(away)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(materialize(&pool, now, 100).await.unwrap(), 3);
    let made: Vec<Uuid> = sqlx::query_scalar(
        "select template_id from aarogyam.task_occurrences order by template_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let mut expected = [for_away, for_empty, ok];
    expected.sort();
    assert_eq!(made, expected);
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_standard_tasks_are_seeded_once_and_never_come_back(pool: PgPool) {
    let c = clinics(&pool).await;
    // Both clinics were made after the migration's backfill: the job adds the tasks.
    assert_eq!(seed_missing_defaults(&pool, 10).await.unwrap(), 6);
    assert_eq!(seed_missing_defaults(&pool, 10).await.unwrap(), 0);
    assert_eq!(seed_defaults(&pool, c.alpha).await.unwrap(), 0);

    let rows: Vec<(String, String, String, Time, String, bool)> = sqlx::query_as(
        "select t.default_key, r.key, t.schedule_kind, t.due_time, t.action, t.active
         from aarogyam.task_templates t join aarogyam.roles r on r.org_id = t.org_id and r.id = t.assignee_role_id
         where t.org_id = $1 order by t.default_key",
    )
    .bind(c.alpha)
    .fetch_all(&pool)
    .await
    .unwrap();
    let rows: Vec<_> = rows
        .iter()
        .map(|(k, r, s, t, a, on)| (k.as_str(), r.as_str(), s.as_str(), *t, a.as_str(), *on))
        .collect();
    assert_eq!(
        rows,
        [
            (
                "eod_check_photos",
                "front_desk",
                "daily",
                time!(19:30),
                "confirm_photos",
                true
            ),
            (
                "eod_record_materials",
                "front_desk",
                "daily",
                time!(19:45),
                "record_usage",
                true
            ),
            (
                "sterilise_instruments",
                "assistant",
                "daily",
                time!(08:30),
                "none",
                true
            ),
        ]
    );

    // Switched off stays off, and the other two are untouched.
    sqlx::query("update aarogyam.task_templates set active = false where org_id = $1 and default_key = 'eod_check_photos'")
        .bind(c.alpha)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(seed_missing_defaults(&pool, 10).await.unwrap(), 0);
    assert_eq!(seed_defaults(&pool, c.alpha).await.unwrap(), 0);
    let off: Vec<String> = sqlx::query_scalar(
        "select default_key from aarogyam.task_templates where org_id = $1 and not active",
    )
    .bind(c.alpha)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(off, ["eod_check_photos"]);

    // A standard task cannot be deleted, only switched off.
    let deleted = sqlx::query("update aarogyam.task_templates set deleted_at = now() where org_id = $1 and default_key = 'eod_check_photos'")
        .bind(c.alpha)
        .execute(&pool)
        .await;
    assert!(deleted.is_err());
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn a_standard_task_falls_back_to_the_owner_role(pool: PgPool) {
    let c = clinics(&pool).await;
    // A clinic with no assistant role at all.
    sqlx::query("delete from aarogyam.role_permissions where org_id = $1 and role_id = $2")
        .bind(c.beta)
        .bind(role(&pool, c.beta, "assistant").await)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("delete from aarogyam.roles where org_id = $1 and key = 'assistant'")
        .bind(c.beta)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(seed_defaults(&pool, c.beta).await.unwrap(), 3);
    let owner = role(&pool, c.beta, "owner").await;
    let front_desk = role(&pool, c.beta, "front_desk").await;
    let roles: Vec<(String, Uuid)> = sqlx::query_as(
        "select default_key, assignee_role_id from aarogyam.task_templates where org_id = $1 order by default_key",
    )
    .bind(c.beta)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        roles,
        [
            ("eod_check_photos".to_owned(), front_desk),
            ("eod_record_materials".to_owned(), front_desk),
            ("sterilise_instruments".to_owned(), owner),
        ]
    );
    // The standard tasks start counting when they are made: nothing is back-filled into the past.
    assert_eq!(
        materialize(&pool, datetime!(2020-06-01 00:00 UTC), 100)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        count(
            &pool,
            "select count(*) from aarogyam.task_occurrences where org_id = $1",
            c.beta
        )
        .await,
        0
    );
}

/// Inserts a template for a role with the given columns and values; whether the table took it.
async fn takes_template(pool: &PgPool, org: Uuid, role: Uuid, columns: &str, values: &str) -> bool {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "insert into aarogyam.task_templates (org_id, assignee_role_id, {columns}) values ($1, $2, {values})"
    )))
    .bind(org)
    .bind(role)
    .execute(pool)
    .await
    .is_ok()
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_tables_refuse_what_the_rules_forbid(pool: PgPool) {
    let c = clinics(&pool).await;
    let owner = role(&pool, c.alpha, "owner").await;
    let person = member(&pool, c.alpha, "assistant", "active").await;
    let cols = "title, schedule_kind, due_time, starts_on";
    let take = |columns: &'static str, values: &'static str| {
        let pool = pool.clone();
        async move { takes_template(&pool, c.alpha, owner, columns, values).await }
    };
    assert!(take(cols, "'T', 'daily', '09:00', '2027-01-01'").await);
    // Monthly is not a kind; every_n_days needs its interval and weekdays its mask.
    assert!(!take(cols, "'T', 'monthly', '09:00', '2027-01-01'").await);
    assert!(!take(cols, "'T', 'every_n_days', '09:00', '2027-01-01'").await);
    assert!(!take(cols, "'T', 'weekdays', '09:00', '2027-01-01'").await);
    // An interval of 1 is a daily task; 2 to 365 is allowed.
    let with_interval = "title, schedule_kind, due_time, starts_on, interval_days";
    assert!(
        !take(
            with_interval,
            "'T', 'every_n_days', '09:00', '2027-01-01', 1"
        )
        .await
    );
    assert!(
        !take(
            with_interval,
            "'T', 'every_n_days', '09:00', '2027-01-01', 366"
        )
        .await
    );
    assert!(
        take(
            with_interval,
            "'T', 'every_n_days', '09:00', '2027-01-01', 2"
        )
        .await
    );
    // A daily task has no interval or mask.
    assert!(!take(with_interval, "'T', 'daily', '09:00', '2027-01-01', 3").await);
    let with_mask = "title, schedule_kind, due_time, starts_on, weekdays";
    assert!(take(with_mask, "'T', 'weekdays', '09:00', '2027-01-01', 127").await);
    assert!(!take(with_mask, "'T', 'weekdays', '09:00', '2027-01-01', 0").await);
    assert!(!take(with_mask, "'T', 'weekdays', '09:00', '2027-01-01', 128").await);
    // A one-off task has a moment and no time of day or start date; the others the reverse.
    let once = "title, schedule_kind, once_at";
    assert!(take(once, "'T', 'once', '2027-02-01 05:00Z'").await);
    assert!(!take("title, schedule_kind", "'T', 'once'").await);
    assert!(
        !take(
            "title, schedule_kind, once_at, due_time",
            "'T', 'once', '2027-02-01 05:00Z', '09:00'"
        )
        .await
    );
    assert!(
        !take(
            "title, schedule_kind, starts_on",
            "'T', 'daily', '2027-01-01'"
        )
        .await
    );
    // The end cannot come before the start; titles are 1 to 120 characters; reminders 15 to 1440.
    assert!(
        !take(
            "title, schedule_kind, due_time, starts_on, ends_on",
            "'T', 'daily', '09:00', '2027-01-02', '2027-01-01'"
        )
        .await
    );
    assert!(!take(cols, "' ', 'daily', '09:00', '2027-01-01'").await);
    let long = "title, schedule_kind, due_time, starts_on";
    assert!(
        !takes_template(
            &pool,
            c.alpha,
            owner,
            long,
            &format!("'{}', 'daily', '09:00', '2027-01-01'", "x".repeat(121))
        )
        .await
    );
    let remind = "title, schedule_kind, due_time, starts_on, remind_every_minutes";
    assert!(!take(remind, "'T', 'daily', '09:00', '2027-01-01', 14").await);
    assert!(take(remind, "'T', 'daily', '09:00', '2027-01-01', 15").await);
    assert!(!take(remind, "'T', 'daily', '09:00', '2027-01-01', 1441").await);
    // Exactly one assignee: both is refused, and so is neither.
    let both = sqlx::query(
        "insert into aarogyam.task_templates
           (org_id, title, assignee_role_id, assignee_membership_id, schedule_kind, due_time, starts_on)
         values ($1, 'T', $2, $3, 'daily', '09:00', '2027-01-01')",
    )
    .bind(c.alpha)
    .bind(owner)
    .bind(person)
    .execute(&pool)
    .await;
    assert!(both.is_err());
    let neither = sqlx::query(
        "insert into aarogyam.task_templates (org_id, title, schedule_kind, due_time, starts_on)
         values ($1, 'T', 'daily', '09:00', '2027-01-01')",
    )
    .bind(c.alpha)
    .execute(&pool)
    .await;
    assert!(neither.is_err());
    // A role of another clinic is refused by the composite key.
    let other_role = role(&pool, c.beta, "owner").await;
    assert!(
        !takes_template(
            &pool,
            c.alpha,
            other_role,
            cols,
            "'T', 'daily', '09:00', '2027-01-01'"
        )
        .await
    );

    // An occurrence: one per template and day, and a finished one needs a time and a person.
    let id = template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    let occurrence = |day: &'static str,
                      status_columns: &'static str,
                      status_values: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "insert into aarogyam.task_occurrences
                   (org_id, template_id, title, action, assignee_role_id, local_date, due_at{status_columns})
                 values ($1, $2, 'T', 'none', $3, '{day}', '{day} 03:30Z'{status_values})"
            )))
            .bind(c.alpha)
            .bind(id)
            .bind(owner)
            .execute(&pool)
            .await
            .is_ok()
        }
    };
    assert!(occurrence("2027-01-05", "", "").await);
    assert!(!occurrence("2027-01-05", "", "").await);
    assert!(!occurrence("2027-01-06", ", status", ", 'done'").await);
    assert!(!occurrence("2027-01-06", ", status", ", 'finished'").await);
    assert!(
        !occurrence(
            "2027-01-06",
            ", note",
            format!(", '{}'", "n".repeat(301)).leak()
        )
        .await
    );
    assert!(occurrence("2027-01-06", ", note", ", 'ok'").await);
    // An occurrence of a template in another clinic is refused by the composite key.
    let foreign = sqlx::query(
        "insert into aarogyam.task_occurrences
           (org_id, template_id, title, action, assignee_role_id, local_date, due_at)
         values ($1, $2, 'T', 'none', $3, '2027-01-09', '2027-01-09 03:30Z')",
    )
    .bind(c.beta)
    .bind(id)
    .bind(other_role)
    .execute(&pool)
    .await;
    assert!(foreign.is_err());
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_change_history_leaves_out_notes_and_reminder_counters(pool: PgPool) {
    let c = clinics(&pool).await;
    let owner = role(&pool, c.alpha, "owner").await;
    let person = member(&pool, c.alpha, "owner", "active").await;
    template(&pool, c.alpha, Err(owner), DAILY_0900).await;
    materialize(&pool, datetime!(2027-01-05 04:00 UTC), 100)
        .await
        .unwrap();
    let events = |pool: PgPool| async move {
        sqlx::query_scalar::<_, i64>(
            "select count(*) from audit.audit_events where table_name = 'aarogyam.task_occurrences'",
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    let before = events(pool.clone()).await;
    // A reminder or a note alone is not worth an entry.
    sqlx::query("update aarogyam.task_occurrences set reminder_count = 1, last_reminded_at = now(), note = 'Marta in chair 2'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(events(pool.clone()).await, before);
    sqlx::query("update aarogyam.task_occurrences set status = 'done', completed_at = now(), completed_by = $1, note = 'Marta in chair 3'")
        .bind(person)
        .execute(&pool)
        .await
        .unwrap();
    let changes: serde_json::Value = sqlx::query_scalar(
        "select changes from audit.audit_events
         where table_name = 'aarogyam.task_occurrences' and action = 'update'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(changes.get("status").is_some(), "{changes}");
    assert!(
        changes.get("note").is_none() && changes.get("reminder_count").is_none(),
        "{changes}"
    );
    assert!(!changes.to_string().contains("Marta"));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn a_clinic_sees_only_its_own_tasks(pool: PgPool) {
    let c = clinics(&pool).await;
    for org in [c.alpha, c.beta] {
        let owner = role(&pool, org, "owner").await;
        template(&pool, org, Err(owner), DAILY_0900).await;
    }
    assert_eq!(
        materialize(&pool, datetime!(2027-01-05 04:00 UTC), 100)
            .await
            .unwrap(),
        2
    );

    let owner_beta = role(&pool, c.beta, "owner").await;
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("set local role app_user")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("select set_config('app.tenant_id', $1, true)")
        .bind(c.alpha.to_string())
        .execute(&mut *tx)
        .await
        .unwrap();
    for table in ["task_templates", "task_occurrences"] {
        let orgs: Vec<Uuid> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "select org_id from aarogyam.{table}"
        )))
        .fetch_all(&mut *tx)
        .await
        .unwrap();
        assert_eq!(orgs, [c.alpha], "{table}");
    }
    // Reading the other clinic's row by id finds nothing; writing one is refused.
    let beta_template: Option<Uuid> =
        sqlx::query_scalar("select id from aarogyam.task_templates where org_id = $1")
            .bind(c.beta)
            .fetch_optional(&mut *tx)
            .await
            .unwrap();
    assert_eq!(beta_template, None);
    let updated =
        sqlx::query("update aarogyam.task_occurrences set status = 'skipped' where org_id = $1")
            .bind(c.beta)
            .execute(&mut *tx)
            .await
            .unwrap();
    assert_eq!(updated.rows_affected(), 0);
    sqlx::query("savepoint try_insert")
        .execute(&mut *tx)
        .await
        .unwrap();
    let wrote = sqlx::query(
        "insert into aarogyam.task_templates
           (org_id, title, assignee_role_id, schedule_kind, due_time, starts_on)
         values ($1, 'X', $2, 'daily', '09:00', '2027-01-01')",
    )
    .bind(c.beta)
    .bind(owner_beta)
    .execute(&mut *tx)
    .await;
    assert!(wrote.is_err());
    sqlx::query("rollback to savepoint try_insert")
        .execute(&mut *tx)
        .await
        .unwrap();
    // The job functions are not for the clinic's own session.
    let called = sqlx::query("select app.materialize_task_occurrences(now(), 10)")
        .execute(&mut *tx)
        .await;
    assert!(called.is_err());
    tx.rollback().await.unwrap();
}
