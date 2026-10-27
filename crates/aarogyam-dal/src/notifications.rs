//! Staff notifications, their per-member read state, and the clinic inbox (migration 0320).
//! Who sees a row is decided here, by the caller's reach: a booking notification by
//! `appointments.read` and `app.practitioner_in_reach`, a lab one (0395) by `labs.read` and
//! `app.clinical_in_reach`, each narrowed to a member (`own` scope) or not; the visit ones (0678,
//! `app.visit_notification_visible`) by who is assigned or on duty, and by `billing.write` or
//! `payments.collect`. The reminder job
//! works across clinics through the definer functions, since it acts for no one clinic.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::{OffsetDateTime, Time};
use uuid::Uuid;

/// Writes a notification in the current clinic transaction.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    id: Uuid,
    kind: &str,
    appointment_id: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        "insert into aarogyam.staff_notifications (id, kind, appointment_id) values ($1, $2, $3)",
        id,
        kind,
        appointment_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Marks an appointment's open notifications handled by `by` (a membership); returns how many.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn handle(
    conn: &mut PgConnection,
    appointment_id: Uuid,
    by: Option<Uuid>,
    at: OffsetDateTime,
) -> Result<u64, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.staff_notifications set handled_at = $3, handled_by = $2
           where appointment_id = $1 and handled_at is null"#,
        appointment_id,
        by,
        at
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected())
}

/// Writes `collect_payment` for the draft or issued bills of a visit that still have a balance,
/// once per bill, and handles the bill's `payment_due` row (`app.write_collect_payment`). For a
/// visit sent for payment without a queue token; the token's own move does this in a trigger.
/// Returns how many were written.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn write_collect_payment(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<i32, DbError> {
    let written = sqlx::query_scalar!(
        r#"select app.write_collect_payment(app.tenant_id(), $1) as "written!""#,
        encounter_id
    )
    .fetch_one(conn)
    .await?;
    Ok(written)
}

/// Tells the clinic a patient cancelled in the app, and marks the appointment's open
/// notifications handled; for a patient-account transaction (`app.notify_patient_cancelled`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn patient_cancelled(
    conn: &mut PgConnection,
    appointment_id: Uuid,
) -> Result<(), DbError> {
    sqlx::query!("select app.notify_patient_cancelled($1)", appointment_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// One notification in a member's feed.
#[derive(Debug, Clone)]
pub struct FeedRow {
    /// The notification.
    pub id: Uuid,
    /// `booking_requested`, `lab_overdue`, `arrival`, `payment_due`...
    pub kind: String,
    /// When it was written.
    pub created_at: OffsetDateTime,
    /// When this member read it.
    pub read_at: Option<OffsetDateTime>,
    /// When it was handled.
    pub handled_at: Option<OffsetDateTime>,
    /// Who handled it (a membership).
    pub handled_by: Option<Uuid>,
    /// Their display name.
    pub handled_by_name: Option<String>,
    /// When everyone was reminded.
    pub reminded_at: Option<OffsetDateTime>,
    /// When the owners were told.
    pub escalated_at: Option<OffsetDateTime>,
    /// The appointment, for a booking notification.
    pub appointment_id: Option<Uuid>,
    /// Its start.
    pub starts_at: Option<OffsetDateTime>,
    /// Its end.
    pub ends_at: Option<OffsetDateTime>,
    /// Its status now.
    pub appointment_status: Option<String>,
    /// Its doctor.
    pub practitioner_id: Option<Uuid>,
    /// The doctor's name as shown on the calendar.
    pub practitioner_name: Option<String>,
    /// The lab order, for a lab notification.
    pub lab_order_id: Option<Uuid>,
    /// Its number, such as `LAB-12`.
    pub lab_order_number: Option<String>,
    /// Its lab's name.
    pub lab_vendor_name: Option<String>,
    /// Its due date now.
    pub lab_due_on: Option<time::Date>,
    /// A path inside the portal that opens what it is about.
    pub href: Option<String>,
    /// The queue token, for `patient_waiting` and `send_in`.
    pub queue_token_id: Option<Uuid>,
    /// Its number for the day.
    pub queue_token_number: Option<i32>,
    /// The bill, for `payment_due` and `collect_payment`.
    pub invoice_id: Option<Uuid>,
    /// Its number, once issued; `None` for a draft.
    pub invoice_number: Option<String>,
    /// The follow-up, for `recall_due`.
    pub recall_id: Option<Uuid>,
    /// Its kind, such as `cleaning`.
    pub recall_kind: Option<String>,
    /// When it falls due.
    pub recall_due_on: Option<time::Date>,
    /// The task occurrence, for `task_*`.
    pub task_occurrence_id: Option<Uuid>,
    /// Its title, as snapshotted when the occurrence was made.
    pub task_title: Option<String>,
    /// When it falls due.
    pub task_due_at: Option<OffsetDateTime>,
    /// The stock item, for `stock_alert`.
    pub item_id: Option<Uuid>,
    /// Its name (a stock item, not patient data).
    pub item_name: Option<String>,
    /// Days of stock left at the recent rate, when the alert was written.
    pub days_cover: Option<f64>,
    /// The time-off request, for `time_off_*`; ids only, no names or reason.
    pub time_off_request_id: Option<Uuid>,
    /// Who the row was written for: `doctor` or `front_desk`; `None` for older rows.
    pub audience: Option<String>,
    /// What the bill is worth, for `payment_due` and `collect_payment` (read now, never stored;
    /// a draft's is a preview).
    pub invoice_total_paise: Option<i64>,
    /// What is left to pay on it, read now.
    pub invoice_balance_paise: Option<i64>,
}

/// Whether a member sees one kind of notification, and how far.
#[derive(Debug, Clone, Copy)]
pub struct Sees {
    /// The member's role has the permission.
    pub shown: bool,
    /// The member to narrow to (`own` scope), or `None` for every record.
    pub reach: Option<Uuid>,
}

impl Sees {
    /// Nothing of this kind.
    pub const NONE: Self = Self {
        shown: false,
        reach: None,
    };
}

/// What a feed or count query asks for.
#[derive(Debug, Clone, Copy)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one flag per permission the staff-operations audiences read"
)]
pub struct Viewer {
    /// The member reading (their read state).
    pub member: Uuid,
    /// Booking notifications (`appointments.read`).
    pub bookings: Sees,
    /// Lab notifications (`labs.read`).
    pub labs: Sees,
    /// Bill notifications (`billing.read`).
    pub billing: Sees,
    /// Recall notifications (`patients.read`, within the patient's reach).
    pub patients: Sees,
    /// Notifications older than this many days count as read.
    pub unread_days: i32,
    /// The member holds the owner role (`task_escalated`).
    pub owner: bool,
    /// The member holds `tasks.use` (`task_due`, `task_reminder`, `task_escalated`).
    pub tasks: bool,
    /// The member holds `inventory.read` (`stock_alert`).
    pub inventory: bool,
    /// The member holds `time_off.manage` (`time_off_requested`).
    pub time_off: bool,
    /// The member holds `clinical.write`: a doctor who may be told of an unassigned patient
    /// (`patient_waiting`, `send_in`). Their own assigned patients are theirs whatever they
    /// hold; the member's practitioner is looked up inside the statement.
    pub clinical_write: bool,
    /// The member holds `billing.write` or `payments.collect` (`collect_payment`).
    pub collect: bool,
}

/// The member's notifications within reach, newest first, before the notification `before`
/// (ids sort by time); only unread ones (within `unread_days`) when `unread_only`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn feed(
    conn: &mut PgConnection,
    viewer: Viewer,
    unread_only: bool,
    before: Option<Uuid>,
    limit: i64,
) -> Result<Vec<FeedRow>, DbError> {
    let rows = sqlx::query_as!(
        FeedRow,
        r#"select n.id, n.kind, n.created_at, r.read_at as "read_at?", n.handled_at, n.handled_by,
                  u.display_name as "handled_by_name?", n.reminded_at, n.escalated_at,
                  a.id as "appointment_id?", a.starts_at as "starts_at?", a.ends_at as "ends_at?",
                  a.status as "appointment_status?", p.id as "practitioner_id?",
                  p.display_name as "practitioner_name?", o.id as "lab_order_id?",
                  o.number as "lab_order_number?", v.name as "lab_vendor_name?",
                  o.due_on as "lab_due_on?", n.href, q.id as "queue_token_id?",
                  q.token_number as "queue_token_number?", i.id as "invoice_id?",
                  i.number as "invoice_number?", rc.id as "recall_id?",
                  rc.kind as "recall_kind?", rc.due_on as "recall_due_on?",
                  n.task_occurrence_id as "task_occurrence_id?", tk.title as "task_title?",
                  tk.due_at as "task_due_at?", n.inventory_item_id as "item_id?",
                  it.name as "item_name?", n.stock_days_cover::float8 as "days_cover?",
                  n.time_off_request_id as "time_off_request_id?", n.audience,
                  case when i.id is not null then app.invoice_total_paise(i) end as "invoice_total_paise?",
                  case when i.id is not null then app.invoice_balance_paise(i) end as "invoice_balance_paise?"
           from aarogyam.staff_notifications n
           left join aarogyam.appointments a on a.org_id = n.org_id and a.id = n.appointment_id
           left join aarogyam.lab_orders o on o.org_id = n.org_id and o.id = n.lab_order_id
           left join aarogyam.queue_tokens q on q.org_id = n.org_id and q.id = n.queue_token_id
           left join aarogyam.invoices i on i.org_id = n.org_id and i.id = n.invoice_id
           left join aarogyam.recalls rc on rc.org_id = n.org_id and rc.id = n.recall_id
           left join aarogyam.task_occurrences tk
             on tk.org_id = n.org_id and tk.id = n.task_occurrence_id
           left join aarogyam.inventory_items it
             on it.org_id = n.org_id and it.id = n.inventory_item_id
           left join aarogyam.practitioners p on p.org_id = a.org_id and p.id = a.practitioner_id
           left join aarogyam.lab_vendors v on v.org_id = o.org_id and v.id = o.vendor_id
           left join aarogyam.staff_notification_reads r
             on r.org_id = n.org_id and r.notification_id = n.id and r.membership_id = $1
           left join aarogyam.memberships m on m.org_id = n.org_id and m.id = n.handled_by
           left join aarogyam.users u on u.id = m.user_id
           where (($7 and a.id is not null and app.practitioner_in_reach(a.practitioner_id, $2) and app.booking_conflict_visible(n, a.practitioner_id, $1))
                  or ($8 and o.id is not null
                      and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $9))
                  or ($10 and i.id is not null and n.kind <> 'collect_payment')
                  or ($11 and rc.id is not null and app.patient_in_reach(rc.patient_id, $12))
                  or app.staff_ops_notification_visible(n, $1, $13, $14, $15, $16)
                  or app.visit_notification_visible(n, $1, $17, $18))
             and app.staff_ops_notification_newest(n, $1, $13, $14)
             and ($4::uuid is null or n.id < $4)
             and (not $3 or (r.read_at is null and app.notification_counts_unread(n)
                             and n.created_at > now() - make_interval(days => $6::int)))
           order by n.id desc
           limit $5"#,
        viewer.member,
        viewer.bookings.reach,
        unread_only,
        before,
        limit,
        viewer.unread_days,
        viewer.bookings.shown,
        viewer.labs.shown,
        viewer.labs.reach,
        viewer.billing.shown,
        viewer.patients.shown,
        viewer.patients.reach,
        viewer.owner,
        viewer.tasks,
        viewer.inventory,
        viewer.time_off,
        viewer.clinical_write,
        viewer.collect,
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// How many notifications within reach the member hasn't read, from the last `unread_days`,
/// counting at most `cap`. One statement over the primary key and the member's reads.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn unread_count(
    conn: &mut PgConnection,
    viewer: Viewer,
    cap: i64,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(
        r#"select count(*) as "count!" from (
             select 1 from aarogyam.staff_notifications n
             left join aarogyam.appointments a on a.org_id = n.org_id and a.id = n.appointment_id
           left join aarogyam.lab_orders o on o.org_id = n.org_id and o.id = n.lab_order_id
           left join aarogyam.invoices i on i.org_id = n.org_id and i.id = n.invoice_id
           left join aarogyam.recalls rc on rc.org_id = n.org_id and rc.id = n.recall_id
             where n.created_at > now() - make_interval(days => $3::int)
               and (($5 and a.id is not null and app.practitioner_in_reach(a.practitioner_id, $2) and app.booking_conflict_visible(n, a.practitioner_id, $1))
                  or ($6 and o.id is not null
                      and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $7))
                  or ($8 and i.id is not null and n.kind <> 'collect_payment')
                  or ($9 and rc.id is not null and app.patient_in_reach(rc.patient_id, $10))
                  or app.staff_ops_notification_visible(n, $1, $11, $12, $13, $14)
                  or app.visit_notification_visible(n, $1, $15, $16))
               and app.staff_ops_notification_newest(n, $1, $11, $12)
               and app.notification_counts_unread(n)
               and not exists (select 1 from aarogyam.staff_notification_reads r
                               where r.org_id = n.org_id and r.notification_id = n.id
                                 and r.membership_id = $1)
             limit $4
           ) unread"#,
        viewer.member,
        viewer.bookings.reach,
        viewer.unread_days,
        cap,
        viewer.bookings.shown,
        viewer.labs.shown,
        viewer.labs.reach,
        viewer.billing.shown,
        viewer.patients.shown,
        viewer.patients.reach,
        viewer.owner,
        viewer.tasks,
        viewer.inventory,
        viewer.time_off,
        viewer.clinical_write,
        viewer.collect,
    )
    .fetch_one(conn)
    .await?;
    Ok(count)
}

/// Records that the member read one notification within reach. `false` when there is no such
/// notification in reach; reading it again changes nothing.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_read(conn: &mut PgConnection, id: Uuid, viewer: Viewer) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"with target as (
             select n.id from aarogyam.staff_notifications n
             left join aarogyam.appointments a on a.org_id = n.org_id and a.id = n.appointment_id
           left join aarogyam.lab_orders o on o.org_id = n.org_id and o.id = n.lab_order_id
           left join aarogyam.invoices i on i.org_id = n.org_id and i.id = n.invoice_id
           left join aarogyam.recalls rc on rc.org_id = n.org_id and rc.id = n.recall_id
             where n.id = $1 and (($4 and a.id is not null and app.practitioner_in_reach(a.practitioner_id, $3) and app.booking_conflict_visible(n, a.practitioner_id, $2))
                  or ($5 and o.id is not null
                      and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $6))
                  or ($7 and i.id is not null and n.kind <> 'collect_payment')
                  or ($8 and rc.id is not null and app.patient_in_reach(rc.patient_id, $9))
                  or app.staff_ops_notification_visible(n, $2, $10, $11, $12, $13)
                  or app.visit_notification_visible(n, $2, $14, $15))
           ), saved as (
             insert into aarogyam.staff_notification_reads (notification_id, membership_id)
             select id, $2 from target
             on conflict do nothing
           )
           select exists (select 1 from target) as "found!""#,
        id,
        viewer.member,
        viewer.bookings.reach,
        viewer.bookings.shown,
        viewer.labs.shown,
        viewer.labs.reach,
        viewer.billing.shown,
        viewer.patients.shown,
        viewer.patients.reach,
        viewer.owner,
        viewer.tasks,
        viewer.inventory,
        viewer.time_off,
        viewer.clinical_write,
        viewer.collect,
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// Records that the member read every notification within reach; returns how many were new.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_all_read(conn: &mut PgConnection, viewer: Viewer) -> Result<u64, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.staff_notification_reads (notification_id, membership_id)
           select n.id, $1 from aarogyam.staff_notifications n
           left join aarogyam.appointments a on a.org_id = n.org_id and a.id = n.appointment_id
           left join aarogyam.lab_orders o on o.org_id = n.org_id and o.id = n.lab_order_id
           left join aarogyam.invoices i on i.org_id = n.org_id and i.id = n.invoice_id
           left join aarogyam.recalls rc on rc.org_id = n.org_id and rc.id = n.recall_id
           where (($3 and a.id is not null and app.practitioner_in_reach(a.practitioner_id, $2) and app.booking_conflict_visible(n, a.practitioner_id, $1))
                  or ($4 and o.id is not null
                      and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $5))
                  or ($6 and i.id is not null and n.kind <> 'collect_payment')
                  or ($7 and rc.id is not null and app.patient_in_reach(rc.patient_id, $8))
                  or app.staff_ops_notification_visible(n, $1, $9, $10, $11, $12)
                  or app.visit_notification_visible(n, $1, $13, $14))
           on conflict do nothing"#,
        viewer.member,
        viewer.bookings.reach,
        viewer.bookings.shown,
        viewer.labs.shown,
        viewer.labs.reach,
        viewer.billing.shown,
        viewer.patients.shown,
        viewer.patients.reach,
        viewer.owner,
        viewer.tasks,
        viewer.inventory,
        viewer.time_off,
        viewer.clinical_write,
        viewer.collect,
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected())
}

/// One message in the clinic inbox.
#[derive(Debug, Clone)]
pub struct InboxRow {
    /// The message.
    pub id: Uuid,
    /// `booking_reminder` or `booking_escalation`.
    pub kind: String,
    /// `clinic` or `owners`.
    pub audience: String,
    /// When it was written.
    pub created_at: OffsetDateTime,
    /// The notification it is about.
    pub notification_id: Uuid,
    /// When that notification was handled; the message is open until then.
    pub handled_at: Option<OffsetDateTime>,
    /// The appointment.
    pub appointment_id: Uuid,
    /// Its start.
    pub starts_at: OffsetDateTime,
    /// Its doctor.
    pub practitioner_id: Uuid,
    /// The doctor's name.
    pub practitioner_name: String,
}

/// The inbox messages within reach, newest first, before the message `before`: messages for
/// the clinic, and for the owners too when `owner`; only unhandled ones when `open_only`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn inbox(
    conn: &mut PgConnection,
    reach: Option<Uuid>,
    owner: bool,
    open_only: bool,
    before: Option<Uuid>,
    limit: i64,
) -> Result<Vec<InboxRow>, DbError> {
    let rows = sqlx::query_as!(
        InboxRow,
        r#"select i.id, i.kind, i.audience, i.created_at, i.notification_id, n.handled_at,
                  a.id as appointment_id, a.starts_at, p.id as practitioner_id,
                  p.display_name as practitioner_name
           from aarogyam.staff_inbox_messages i
           join aarogyam.staff_notifications n on n.org_id = i.org_id and n.id = i.notification_id
           join aarogyam.appointments a on a.org_id = i.org_id and a.id = i.appointment_id
           join aarogyam.practitioners p on p.org_id = a.org_id and p.id = a.practitioner_id
           where (i.audience = 'clinic' or $2)
             and app.practitioner_in_reach(a.practitioner_id, $1)
             and (not $3 or n.handled_at is null)
             and ($4::uuid is null or i.id < $4)
           order by i.id desc
           limit $5"#,
        reach,
        owner,
        open_only,
        before,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A booking request nobody has answered, as the reminder job sees it.
#[derive(Debug, Clone)]
pub struct OpenRequestRow {
    /// Its clinic.
    pub org_id: Uuid,
    /// The notification.
    pub id: Uuid,
    /// When it was written.
    pub created_at: OffsetDateTime,
    /// When everyone was reminded.
    pub reminded_at: Option<OffsetDateTime>,
    /// The clinic's wall-clock time now.
    pub local_now: Time,
    /// The clinic's online booking settings object.
    pub booking: Value,
}

/// Open booking requests across clinics at `now`, at least `min_minutes` old, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn open_requests(
    pool: &PgPool,
    now: OffsetDateTime,
    min_minutes: i32,
    limit: i32,
) -> Result<Vec<OpenRequestRow>, DbError> {
    let rows = sqlx::query_as!(
        OpenRequestRow,
        r#"select org_id as "org_id!", id as "id!", created_at as "created_at!", reminded_at,
                  local_now as "local_now!", booking as "booking!"
           from app.open_booking_requests($1, $2, $3)"#,
        now,
        min_minutes,
        limit
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Records a reminder (`remind`) or escalation (`escalate`) at `now` and its inbox message; the message
/// id, or `None` when the step was taken already or the request was handled meanwhile.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_step(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    step: &str,
    now: OffsetDateTime,
) -> Result<Option<Uuid>, DbError> {
    let message = sqlx::query_scalar!(
        r#"select app.record_booking_request_step($1, $2, $3, $4) as "id?""#,
        org_id,
        id,
        step,
        now
    )
    .fetch_one(pool)
    .await?;
    Ok(message)
}

/// Writes a `recall_due` alert for every open recall due today or earlier, at clinics in use
/// that have not switched `recall` off (`app.flag_due_recalls`); once per recall. Returns how
/// many were written.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn flag_due_recalls(
    pool: &PgPool,
    now: OffsetDateTime,
    limit: i32,
) -> Result<i32, DbError> {
    let written = sqlx::query_scalar!(
        r#"select app.flag_due_recalls($1, $2) as "written!""#,
        now,
        limit
    )
    .fetch_one(pool)
    .await?;
    Ok(written)
}

/// Marks appointments nobody came to as no-shows (`app.auto_no_show`), with a history row and a
/// `missed_visit` follow-up each. Returns how many were marked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn auto_no_show(pool: &PgPool, now: OffsetDateTime, limit: i32) -> Result<i32, DbError> {
    let marked = sqlx::query_scalar!(
        r#"select app.auto_no_show($1, $2) as "marked!""#,
        now,
        limit
    )
    .fetch_one(pool)
    .await?;
    Ok(marked)
}

/// Closes tokens left open on an earlier clinic day (`app.close_stale_tokens`). Returns how many.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn close_stale_tokens(
    pool: &PgPool,
    now: OffsetDateTime,
    limit: i32,
) -> Result<i32, DbError> {
    let closed = sqlx::query_scalar!(
        r#"select app.close_stale_tokens($1, $2) as "closed!""#,
        now,
        limit
    )
    .fetch_one(pool)
    .await?;
    Ok(closed)
}

/// Writes a `patient_waiting` alert for every token still waiting after `min_minutes`
/// (`app.flag_waiting_tokens`); once per token. Returns how many were written.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn flag_waiting_tokens(
    pool: &PgPool,
    now: OffsetDateTime,
    min_minutes: i32,
    limit: i32,
) -> Result<i32, DbError> {
    let written = sqlx::query_scalar!(
        r#"select app.flag_waiting_tokens($1, $2, $3) as "written!""#,
        now,
        min_minutes,
        limit
    )
    .fetch_one(pool)
    .await?;
    Ok(written)
}
