//! Queries for recurring staff tasks and their occurrences: the templates the manager keeps, the
//! occurrences the generator makes (`task_jobs`), and what a person does with them.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime, Time};
use uuid::Uuid;

use crate::inventory::MovementRow;

/// A task template with the names of who it is for.
#[derive(Debug, Clone)]
pub struct TemplateRow {
    /// Identifier.
    pub id: Uuid,
    /// What is to be done.
    pub title: String,
    /// More detail.
    pub description: Option<String>,
    /// The person it is for, when it is for one.
    pub assignee_membership_id: Option<Uuid>,
    /// That person's name.
    pub assignee_name: Option<String>,
    /// The role it is for, when it is for one.
    pub assignee_role_id: Option<Uuid>,
    /// That role's name.
    pub assignee_role_name: Option<String>,
    /// `once`, `daily`, `every_n_days` or `weekdays`.
    pub schedule_kind: String,
    /// `once`: when it falls due.
    pub once_at: Option<OffsetDateTime>,
    /// `every_n_days`: the gap.
    pub interval_days: Option<i32>,
    /// `weekdays`: the ISO bitmask.
    pub weekdays: Option<i16>,
    /// The clinic-local time it falls due.
    pub due_time: Option<Time>,
    /// The first day.
    pub starts_on: Option<Date>,
    /// The last day.
    pub ends_on: Option<Date>,
    /// Minutes between reminders; none means the clinic's default.
    pub remind_every_minutes: Option<i32>,
    /// Reminders before the owner is told once more.
    pub escalate_after: i32,
    /// `none`, `record_usage` or `confirm_photos`.
    pub action: String,
    /// Whether the generator makes occurrences from it.
    pub active: bool,
    /// When it last started to count.
    pub activated_at: OffsetDateTime,
    /// One of the standard tasks.
    pub is_default: bool,
    /// The standard task's key.
    pub default_key: Option<String>,
    /// When it was made.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// The values of a template as written by `insert_template` and `update_template`.
#[derive(Debug, Clone)]
pub struct TemplateValues<'a> {
    /// Title.
    pub title: &'a str,
    /// Description.
    pub description: Option<&'a str>,
    /// The person.
    pub assignee_membership_id: Option<Uuid>,
    /// Or the role.
    pub assignee_role_id: Option<Uuid>,
    /// Schedule kind.
    pub schedule_kind: &'a str,
    /// `once_at`.
    pub once_at: Option<OffsetDateTime>,
    /// `interval_days`.
    pub interval_days: Option<i32>,
    /// `weekdays`.
    pub weekdays: Option<i16>,
    /// `due_time`.
    pub due_time: Option<Time>,
    /// `starts_on`.
    pub starts_on: Option<Date>,
    /// `ends_on`.
    pub ends_on: Option<Date>,
    /// Reminder gap.
    pub remind_every_minutes: Option<i32>,
    /// Reminders before escalating.
    pub escalate_after: i32,
    /// Action.
    pub action: &'a str,
    /// Active.
    pub active: bool,
}

/// The clinic's tasks that are not deleted, switched-on first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn templates(conn: &mut PgConnection) -> Result<Vec<TemplateRow>, DbError> {
    let rows = sqlx::query_as!(
        TemplateRow,
        r#"select t.id, t.title, t.description,
                  t.assignee_membership_id, u.display_name as "assignee_name?",
                  t.assignee_role_id, r.name as "assignee_role_name?",
                  t.schedule_kind, t.once_at, t.interval_days, t.weekdays, t.due_time,
                  t.starts_on, t.ends_on, t.remind_every_minutes, t.escalate_after, t.action,
                  t.active, t.activated_at, t.is_default, t.default_key, t.created_at, t.updated_at
           from aarogyam.task_templates t
           left join aarogyam.memberships m on m.org_id = t.org_id and m.id = t.assignee_membership_id
           left join aarogyam.users u on u.id = m.user_id
           left join aarogyam.roles r on r.org_id = t.org_id and r.id = t.assignee_role_id
           where t.deleted_at is null
           order by t.active desc, t.title, t.id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One task that is not deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn template(conn: &mut PgConnection, id: Uuid) -> Result<Option<TemplateRow>, DbError> {
    let row = sqlx::query_as!(
        TemplateRow,
        r#"select t.id, t.title, t.description,
                  t.assignee_membership_id, u.display_name as "assignee_name?",
                  t.assignee_role_id, r.name as "assignee_role_name?",
                  t.schedule_kind, t.once_at, t.interval_days, t.weekdays, t.due_time,
                  t.starts_on, t.ends_on, t.remind_every_minutes, t.escalate_after, t.action,
                  t.active, t.activated_at, t.is_default, t.default_key, t.created_at, t.updated_at
           from aarogyam.task_templates t
           left join aarogyam.memberships m on m.org_id = t.org_id and m.id = t.assignee_membership_id
           left join aarogyam.users u on u.id = m.user_id
           left join aarogyam.roles r on r.org_id = t.org_id and r.id = t.assignee_role_id
           where t.id = $1 and t.deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Whether an active member of this clinic has this membership id.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn active_member_exists(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.memberships where id = $1 and status = 'active') as "found!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// Whether this clinic has this role.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn role_exists(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.roles where id = $1) as "found!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// The role a member holds.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn role_of(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<Option<Uuid>, DbError> {
    let role = sqlx::query_scalar!(
        "select role_id from aarogyam.memberships where id = $1",
        membership_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(role)
}

/// Makes a task.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_template(
    conn: &mut PgConnection,
    id: Uuid,
    values: &TemplateValues<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.task_templates
             (id, title, description, assignee_membership_id, assignee_role_id, schedule_kind,
              once_at, interval_days, weekdays, due_time, starts_on, ends_on,
              remind_every_minutes, escalate_after, action, active)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)"#,
        id,
        values.title,
        values.description,
        values.assignee_membership_id,
        values.assignee_role_id,
        values.schedule_kind,
        values.once_at,
        values.interval_days,
        values.weekdays,
        values.due_time,
        values.starts_on,
        values.ends_on,
        values.remind_every_minutes,
        values.escalate_after,
        values.action,
        values.active,
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Saves a task's values. Switching it back on, or changing when it falls due, makes the
/// database restart its `activated_at`. False when there is no such task.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_template(
    conn: &mut PgConnection,
    id: Uuid,
    values: &TemplateValues<'_>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.task_templates
           set title = $2, description = $3, assignee_membership_id = $4, assignee_role_id = $5,
               schedule_kind = $6, once_at = $7, interval_days = $8, weekdays = $9,
               due_time = $10, starts_on = $11, ends_on = $12, remind_every_minutes = $13,
               escalate_after = $14, action = $15, active = $16
           where id = $1 and deleted_at is null"#,
        id,
        values.title,
        values.description,
        values.assignee_membership_id,
        values.assignee_role_id,
        values.schedule_kind,
        values.once_at,
        values.interval_days,
        values.weekdays,
        values.due_time,
        values.starts_on,
        values.ends_on,
        values.remind_every_minutes,
        values.escalate_after,
        values.action,
        values.active,
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Deletes a task that is not one of the standard ones; its occurrences stay. False when there
/// is no such task, or it is a standard one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_template(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.task_templates set deleted_at = now(), active = false
           where id = $1 and deleted_at is null and not is_default"#,
        id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// The next `count` times a task falls due after `after`, from the same SQL function the
/// generator uses (`app.task_due_dates`), looking at most about two years ahead. Nothing for a
/// task that is switched off.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn preview(
    conn: &mut PgConnection,
    id: Uuid,
    after: OffsetDateTime,
    count: i64,
) -> Result<Vec<(Date, OffsetDateTime)>, DbError> {
    let rows = sqlx::query!(
        r#"select s.local_date as "local_date!", s.due_at as "due_at!"
           from aarogyam.task_templates t
           join aarogyam.organizations o on o.id = t.org_id
           cross join lateral app.task_due_dates(
             t.schedule_kind, t.interval_days, t.weekdays::int, t.starts_on, t.ends_on, t.due_time,
             t.once_at, o.timezone, $2::timestamptz, $2::timestamptz + interval '800 days') s
           where t.id = $1 and t.deleted_at is null and t.active
           order by s.due_at
           limit $3"#,
        id,
        after,
        count
    )
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(|r| (r.local_date, r.due_at)).collect())
}

/// One day's run of a task.
#[derive(Debug, Clone)]
pub struct OccurrenceRow {
    /// Identifier.
    pub id: Uuid,
    /// The task it came from.
    pub template_id: Uuid,
    /// The title when it was made.
    pub title: String,
    /// The action when it was made.
    pub action: String,
    /// The person it was for.
    pub assignee_membership_id: Option<Uuid>,
    /// Or the role.
    pub assignee_role_id: Option<Uuid>,
    /// The clinic's calendar day.
    pub local_date: Date,
    /// When it fell due.
    pub due_at: OffsetDateTime,
    /// `open`, `done`, `skipped` or `missed`.
    pub status: String,
    /// When it was finished.
    pub completed_at: Option<OffsetDateTime>,
    /// Who finished it.
    pub completed_by: Option<Uuid>,
    /// That person's name.
    pub completed_by_name: Option<String>,
    /// What they wrote.
    pub note: Option<String>,
}

/// One occurrence.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn occurrence(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<OccurrenceRow>, DbError> {
    let row = sqlx::query_as!(
        OccurrenceRow,
        r#"select o.id, o.template_id, o.title, o.action, o.assignee_membership_id,
                  o.assignee_role_id, o.local_date, o.due_at, o.status, o.completed_at,
                  o.completed_by, u.display_name as "completed_by_name?", o.note
           from aarogyam.task_occurrences o
           left join aarogyam.memberships m on m.org_id = o.org_id and m.id = o.completed_by
           left join aarogyam.users u on u.id = m.user_id
           where o.id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The clinic's calendar day at `now`, in its own time zone (India's when Postgres does not know
/// the zone; the same rule as `app.clinic_local_date`, which the API's role may not call).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_day(conn: &mut PgConnection, now: OffsetDateTime) -> Result<Date, DbError> {
    let day = sqlx::query_scalar!(
        r#"select (case when exists (select 1 from pg_catalog.pg_timezone_names z
                                     where z.name = o.timezone)
                        then $1 at time zone o.timezone
                        else $1 at time zone 'Asia/Kolkata' end)::date as "day!"
           from aarogyam.organizations o where o.id = app.tenant_id()"#,
        now
    )
    .fetch_one(conn)
    .await?;
    Ok(day)
}

/// What a person has to do on `day`: their own tasks and their role's, plus anything still open
/// from an earlier day.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mine(
    conn: &mut PgConnection,
    membership_id: Uuid,
    role_id: Option<Uuid>,
    day: Date,
) -> Result<Vec<OccurrenceRow>, DbError> {
    let rows = sqlx::query_as!(
        OccurrenceRow,
        r#"select o.id, o.template_id, o.title, o.action, o.assignee_membership_id,
                  o.assignee_role_id, o.local_date, o.due_at, o.status, o.completed_at,
                  o.completed_by, u.display_name as "completed_by_name?", o.note
           from aarogyam.task_occurrences o
           left join aarogyam.memberships m on m.org_id = o.org_id and m.id = o.completed_by
           left join aarogyam.users u on u.id = m.user_id
           where (o.assignee_membership_id = $1 or o.assignee_role_id = $2)
             and (o.local_date = $3 or (o.status = 'open' and o.local_date < $3))
           order by o.due_at, o.id"#,
        membership_id,
        role_id,
        day
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Occurrences by clinic day, newest first, for the manager's history. `assignee` matches tasks
/// given to that member or to their role, and tasks they finished.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn history(
    conn: &mut PgConnection,
    from: Date,
    to: Date,
    assignee: Option<Uuid>,
    status: Option<&str>,
    template_id: Option<Uuid>,
    limit: i64,
) -> Result<Vec<OccurrenceRow>, DbError> {
    let rows = sqlx::query_as!(
        OccurrenceRow,
        r#"select o.id, o.template_id, o.title, o.action, o.assignee_membership_id,
                  o.assignee_role_id, o.local_date, o.due_at, o.status, o.completed_at,
                  o.completed_by, u.display_name as "completed_by_name?", o.note
           from aarogyam.task_occurrences o
           left join aarogyam.memberships m on m.org_id = o.org_id and m.id = o.completed_by
           left join aarogyam.users u on u.id = m.user_id
           where o.local_date between $1 and $2
             and ($3::uuid is null
                  or o.assignee_membership_id = $3 or o.completed_by = $3
                  or o.assignee_role_id = (select x.role_id from aarogyam.memberships x
                                           where x.id = $3))
             and ($4::text is null or o.status = $4)
             and ($5::uuid is null or o.template_id = $5)
           order by o.due_at desc, o.id
           limit $6"#,
        from,
        to,
        assignee,
        status,
        template_id,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Closes an occurrence for `by`, only if it is still open. False when it is not (someone got
/// there first, or it was missed).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn complete(
    conn: &mut PgConnection,
    id: Uuid,
    by: Uuid,
    note: Option<&str>,
    now: OffsetDateTime,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.task_occurrences
           set status = 'done', completed_at = $2, completed_by = $3, note = $4
           where id = $1 and status = 'open'"#,
        id,
        now,
        by,
        note
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Opens a finished (done or skipped) occurrence again. False when it was not finished.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn reopen(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.task_occurrences
           set status = 'open', completed_at = null, completed_by = null, note = null
           where id = $1 and status in ('done', 'skipped')"#,
        id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Marks the occurrence's notices handled, so the bell stops showing them.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn handle_notices(
    conn: &mut PgConnection,
    occurrence_id: Uuid,
    by: Uuid,
    now: OffsetDateTime,
) -> Result<u64, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.staff_notifications set handled_at = $2, handled_by = $3
           where task_occurrence_id = $1 and handled_at is null"#,
        occurrence_id,
        now,
        by
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected())
}

/// How many patients seen on `day` have a visit with no photo attached.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn patients_without_photos(conn: &mut PgConnection, day: Date) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(
        r#"select count(distinct e.patient_id) as "count!"
           from aarogyam.encounters e
           where e.started_at >= app.clinic_local_to_utc(e.org_id, $1::date::timestamp)
             and e.started_at < app.clinic_local_to_utc(e.org_id, ($1::date + 1)::timestamp)
             and not exists (select 1 from aarogyam.attachments a
                             where a.org_id = e.org_id and a.encounter_id = e.id
                               and a.kind = 'photo' and a.deleted_at is null)"#,
        day
    )
    .fetch_one(conn)
    .await?;
    Ok(count)
}

/// Records a use of stock that came from a task's completion (like `inventory::insert_movement`,
/// plus the occurrence).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_task_movement(
    conn: &mut PgConnection,
    id: Uuid,
    item_id: Uuid,
    batch_id: Uuid,
    quantity: i64,
    reason: Option<&str>,
    occurrence_id: Uuid,
) -> Result<MovementRow, DbError> {
    let row = sqlx::query_as!(
        MovementRow,
        r#"insert into aarogyam.stock_movements
             (id, item_id, batch_id, kind, quantity, reason, task_occurrence_id)
           values ($1, $2, $3, 'use', $4, $5, $6)
           returning id, item_id, batch_id, kind, quantity, reason, created_at as "at!", created_by as by_user_id"#,
        id,
        item_id,
        batch_id,
        quantity,
        reason,
        occurrence_id
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}
