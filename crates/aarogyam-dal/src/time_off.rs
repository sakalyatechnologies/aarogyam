//! Queries for staff time-off requests. Every function takes the connection of an open clinic
//! transaction, so row-level security limits it to that clinic.
//!
//! `leave_blocks` stays the only table availability reads. Approving a request adds a block for
//! someone with a practitioner row (reason "Time off", never the request's own reason);
//! cancelling deletes it. Each change is one statement, so the request and its block never
//! disagree.

use aarogyam_domain::time_off::{Kind, LEAVE_BLOCK_REASON, Window};
use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A time-off request as stored. `kind`, `reason`, `decision_note`, `decided_by` and
/// `decided_at` are `None` when the viewer may not see them (see [`list`]).
#[derive(Debug, Clone)]
pub struct TimeOffRow {
    /// Identifier.
    pub id: Uuid,
    /// Who is away.
    pub membership_id: Uuid,
    /// `vacation`, `sick`, `personal` or `other`; private.
    pub kind: Option<String>,
    /// Start.
    pub starts_at: OffsetDateTime,
    /// End.
    pub ends_at: OffsetDateTime,
    /// Whether the window is whole local days.
    pub all_day: bool,
    /// `pending`, `approved`, `declined` or `cancelled`.
    pub status: String,
    /// Why; private.
    pub reason: Option<String>,
    /// Who decided; private.
    pub decided_by: Option<Uuid>,
    /// When it was decided; private.
    pub decided_at: Option<OffsetDateTime>,
    /// The decider's note; private.
    pub decision_note: Option<String>,
    /// The leave block an approval made, for someone with a practitioner row.
    pub leave_block_id: Option<Uuid>,
}

/// The values of a new request, checked by the caller.
#[derive(Debug, Clone)]
pub struct NewTimeOff<'a> {
    /// Who is away.
    pub membership_id: Uuid,
    /// Why.
    pub kind: Kind,
    /// When. Whole days are turned into local midnights by Postgres.
    pub window: Window,
    /// A private reason, at most 200 characters.
    pub reason: Option<&'a str>,
}

/// Who is asking, for the privacy split of [`list`].
#[derive(Debug, Clone, Copy)]
pub struct Viewer {
    /// The viewer's membership.
    pub membership_id: Uuid,
    /// Whether the viewer holds `time_off.manage`.
    pub manages: bool,
}

/// Adds a pending request. Approve it in the same transaction when it is approved at once.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the member is not in this clinic or the
/// window breaks the table's checks.
pub async fn create(conn: &mut PgConnection, new: &NewTimeOff<'_>) -> Result<TimeOffRow, DbError> {
    let (all_day, starts_at, ends_at, first_day, last_day) = match new.window {
        Window::Timed { starts_at, ends_at } => (false, Some(starts_at), Some(ends_at), None, None),
        Window::AllDay {
            first_day,
            last_day,
        } => (true, None, None, Some(first_day), Some(last_day)),
    };
    let row = sqlx::query_as!(
        TimeOffRow,
        r#"insert into aarogyam.time_off_requests
             (membership_id, kind, starts_at, ends_at, all_day, reason)
           values ($1, $2,
                   case when $3 then app.time_off_day_start_utc($6::date) else $4::timestamptz end,
                   case when $3 then app.time_off_day_start_utc($7::date + 1) else $5::timestamptz end,
                   $3, $8)
           returning id, membership_id, kind as "kind?", starts_at, ends_at, all_day, status,
                     reason, decided_by, decided_at, decision_note, leave_block_id"#,
        new.membership_id,
        new.kind.as_str(),
        all_day,
        starts_at,
        ends_at,
        first_day as Option<Date>,
        last_day as Option<Date>,
        new.reason
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// One request, in full; the caller decides who may see it. `None` when it is not in this
/// clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<TimeOffRow>, DbError> {
    let row = sqlx::query_as!(
        TimeOffRow,
        r#"select id, membership_id, kind as "kind?", starts_at, ends_at, all_day, status, reason,
                  decided_by, decided_at, decision_note, leave_block_id
           from aarogyam.time_off_requests where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Requests overlapping `[from, to)`, by start, as the viewer may see them.
///
/// Everyone sees approved requests, but only the person away, with when. The kind, reason and
/// decision, and requests that are pending or declined, are for the requester and holders of
/// `time_off.manage`; cancelled requests are for nobody.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    viewer: Viewer,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<TimeOffRow>, DbError> {
    let rows = sqlx::query_as!(
        TimeOffRow,
        r#"select id, membership_id,
                  case when $1 or membership_id = $2 then kind end as "kind?",
                  starts_at, ends_at, all_day, status,
                  case when $1 or membership_id = $2 then reason end as "reason?",
                  case when $1 or membership_id = $2 then decided_by end as "decided_by?",
                  case when $1 or membership_id = $2 then decided_at end as "decided_at?",
                  case when $1 or membership_id = $2 then decision_note end as "decision_note?",
                  leave_block_id
           from aarogyam.time_off_requests
           where starts_at < $4 and ends_at > $3
             and (status = 'approved'
                  or (status <> 'cancelled' and ($1 or membership_id = $2)))
           order by starts_at, id"#,
        viewer.manages,
        viewer.membership_id,
        from,
        to
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Approves a pending request. When the person has an active practitioner row it also adds the
/// leave block, with the generic reason, and links it; an assistant gets none. One statement.
/// `None` when the request is not pending.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn approve(
    conn: &mut PgConnection,
    id: Uuid,
    decided_by: Uuid,
    note: Option<&str>,
) -> Result<Option<TimeOffRow>, DbError> {
    let row = sqlx::query_as!(
        TimeOffRow,
        r#"with req as (
             select id, membership_id, starts_at, ends_at
             from aarogyam.time_off_requests
             where id = $1 and status = 'pending' for update
           ),
           block as (
             insert into aarogyam.leave_blocks (practitioner_id, starts_at, ends_at, reason)
             select p.id, req.starts_at, req.ends_at, $4
             from req join aarogyam.practitioners p
               on p.membership_id = req.membership_id and p.deleted_at is null
             returning id
           )
           update aarogyam.time_off_requests r
           set status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3,
               leave_block_id = (select id from block)
           from req where r.id = req.id
           returning r.id, r.membership_id, r.kind as "kind?", r.starts_at, r.ends_at, r.all_day,
                     r.status, r.reason, r.decided_by, r.decided_at, r.decision_note,
                     r.leave_block_id"#,
        id,
        decided_by,
        note,
        LEAVE_BLOCK_REASON
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Declines a pending request. `None` when it is not pending.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn decline(
    conn: &mut PgConnection,
    id: Uuid,
    decided_by: Uuid,
    note: Option<&str>,
) -> Result<Option<TimeOffRow>, DbError> {
    let row = sqlx::query_as!(
        TimeOffRow,
        r#"update aarogyam.time_off_requests
           set status = 'declined', decided_by = $2, decided_at = now(), decision_note = $3
           where id = $1 and status = 'pending'
           returning id, membership_id, kind as "kind?", starts_at, ends_at, all_day, status,
                     reason, decided_by, decided_at, decision_note, leave_block_id"#,
        id,
        decided_by,
        note
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Cancels a pending or approved request and deletes its leave block. One statement. `None`
/// when it is neither.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn cancel(conn: &mut PgConnection, id: Uuid) -> Result<Option<TimeOffRow>, DbError> {
    let row = sqlx::query_as!(
        TimeOffRow,
        r#"with req as (
             select id, leave_block_id from aarogyam.time_off_requests
             where id = $1 and status in ('pending', 'approved') for update
           ),
           gone as (
             delete from aarogyam.leave_blocks b using req where b.id = req.leave_block_id
           )
           update aarogyam.time_off_requests r
           set status = 'cancelled', leave_block_id = null
           from req where r.id = req.id
           returning r.id, r.membership_id, r.kind as "kind?", r.starts_at, r.ends_at, r.all_day,
                     r.status, r.reason, r.decided_by, r.decided_at, r.decision_note,
                     r.leave_block_id"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Display names of members, for listing who is away. A member not in this clinic is left out.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn member_names(
    conn: &mut PgConnection,
    ids: &[Uuid],
) -> Result<Vec<(Uuid, String)>, DbError> {
    let rows = sqlx::query!(
        r#"select m.id, u.display_name
           from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
           where m.id = any($1)"#,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.id, row.display_name))
        .collect())
}

/// Tells staff about a request: `time_off_requested` (for `time_off.manage` holders) or
/// `time_off_decided` (for the requester). One row per request and kind; a repeat does nothing.
/// Who sees it is decided where the feed is read, from the request.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn notify(conn: &mut PgConnection, request_id: Uuid, kind: &str) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.staff_notifications (kind, time_off_request_id)
           values ($1, $2)
           on conflict (org_id, time_off_request_id, kind) where time_off_request_id is not null
           do nothing"#,
        kind,
        request_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A live appointment the leave of a person with a practitioner row would clash with.
#[derive(Debug, Clone)]
pub struct AffectedRow {
    /// The appointment.
    pub id: Uuid,
    /// The doctor who is away.
    pub practitioner_id: Uuid,
    /// Start.
    pub starts_at: OffsetDateTime,
    /// End.
    pub ends_at: OffsetDateTime,
    /// Status: requested, booked, confirmed, arrived or `in_chair`.
    pub status: String,
    /// The patient's name.
    pub patient_name: String,
    /// Sent back as `If-Match` when the appointment is changed.
    pub row_version: i64,
}

/// Appointments not yet finished that overlap `[starts_at, ends_at)` with a doctor who is
/// the member `membership_id`, by start. At most `limit`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn affected(
    conn: &mut PgConnection,
    membership_id: Uuid,
    starts_at: OffsetDateTime,
    ends_at: OffsetDateTime,
    limit: i64,
) -> Result<Vec<AffectedRow>, DbError> {
    let rows = sqlx::query_as!(
        AffectedRow,
        r#"select a.id, a.practitioner_id, a.starts_at, a.ends_at, a.status,
                  p.full_name as patient_name, a.row_version
           from aarogyam.appointments a
           join aarogyam.practitioners d on d.org_id = a.org_id and d.id = a.practitioner_id
           join aarogyam.patients p on p.org_id = a.org_id and p.id = a.patient_id
           where d.membership_id = $1 and a.deleted_at is null
             and a.status not in ('completed', 'cancelled', 'no_show')
             and a.starts_at < $3 and a.ends_at > $2
           order by a.starts_at, a.id
           limit $4"#,
        membership_id,
        starts_at,
        ends_at,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
