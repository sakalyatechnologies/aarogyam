//! Appointments and their history. Every function takes the connection of an open clinic
//! transaction, so row-level security limits it to that clinic.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// An appointment with the names the calendar shows.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AppointmentRow {
    /// Identifier.
    pub id: Uuid,
    /// Branch.
    pub branch_id: Uuid,
    /// Room, if booked into one.
    pub room_id: Option<Uuid>,
    /// Room name.
    pub room_name: Option<String>,
    /// Start (UTC).
    #[serde(with = "crate::json::timestamp")]
    pub starts_at: OffsetDateTime,
    /// End (UTC).
    #[serde(with = "crate::json::timestamp")]
    pub ends_at: OffsetDateTime,
    /// Status.
    pub status: String,
    /// Kind.
    pub kind: String,
    /// Reason for the visit.
    pub reason: Option<String>,
    /// Front-desk note.
    pub notes: Option<String>,
    /// How it was booked.
    pub source: String,
    /// Why it was cancelled.
    pub cancel_reason: Option<String>,
    /// When the patient arrived.
    #[serde(with = "crate::json::timestamp::option")]
    pub arrived_at: Option<OffsetDateTime>,
    /// When they sat in the chair.
    #[serde(with = "crate::json::timestamp::option")]
    pub seated_at: Option<OffsetDateTime>,
    /// When the visit ended.
    #[serde(with = "crate::json::timestamp::option")]
    pub completed_at: Option<OffsetDateTime>,
    /// The patient.
    pub patient_id: Uuid,
    /// Their number.
    pub patient_number: String,
    /// Their name.
    pub patient_name: String,
    /// Their sex.
    pub patient_sex: String,
    /// Their date of birth.
    #[serde(with = "crate::json::date::option")]
    pub patient_date_of_birth: Option<Date>,
    /// Whether it was estimated.
    pub patient_birth_date_estimated: bool,
    /// The doctor.
    pub practitioner_id: Uuid,
    /// Their name.
    pub practitioner_name: String,
    /// Their colour.
    pub practitioner_color: String,
    /// Today's queue token, once arrived.
    pub token_number: Option<i32>,
    /// That token's identifier.
    pub token_id: Option<Uuid>,
    /// Goes up when the appointment changes; edits send it back to detect a stale copy.
    pub row_version: i64,
}

/// Active and finished appointments starting in `[from, to)`, optionally in one room or with
/// one doctor, by start.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    from: OffsetDateTime,
    to: OffsetDateTime,
    room_id: Option<Uuid>,
    practitioner_id: Option<Uuid>,
) -> Result<Vec<AppointmentRow>, DbError> {
    let rows = sqlx::query_as!(
        AppointmentRow,
        r#"select a.id, a.branch_id, a.room_id, r.name as "room_name?", a.starts_at, a.ends_at,
                  a.status, a.kind, a.reason, a.notes, a.source, a.cancel_reason, a.arrived_at,
                  a.seated_at, a.completed_at, a.row_version,
                  a.patient_id, p.number as patient_number, p.full_name as patient_name,
                  p.sex as patient_sex, p.date_of_birth as patient_date_of_birth,
                  p.birth_date_estimated as patient_birth_date_estimated,
                  a.practitioner_id, d.display_name as practitioner_name,
                  d.calendar_color as practitioner_color, q.token_number as "token_number?", q.id as "token_id?"
           from aarogyam.appointments a
           join aarogyam.patients p on p.org_id = a.org_id and p.id = a.patient_id
           join aarogyam.practitioners d on d.org_id = a.org_id and d.id = a.practitioner_id
           left join aarogyam.rooms r on r.org_id = a.org_id and r.id = a.room_id
           left join aarogyam.queue_tokens q on q.org_id = a.org_id and q.appointment_id = a.id
           where a.deleted_at is null and a.starts_at >= $1 and a.starts_at < $2
             and ($3::uuid is null or a.room_id = $3)
             and ($4::uuid is null or a.practitioner_id = $4)
           order by a.starts_at, r.name, a.id"#,
        from,
        to,
        room_id,
        practitioner_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One appointment, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<AppointmentRow>, DbError> {
    let row = sqlx::query_as!(
        AppointmentRow,
        r#"select a.id, a.branch_id, a.room_id, r.name as "room_name?", a.starts_at, a.ends_at,
                  a.status, a.kind, a.reason, a.notes, a.source, a.cancel_reason, a.arrived_at,
                  a.seated_at, a.completed_at, a.row_version,
                  a.patient_id, p.number as patient_number, p.full_name as patient_name,
                  p.sex as patient_sex, p.date_of_birth as patient_date_of_birth,
                  p.birth_date_estimated as patient_birth_date_estimated,
                  a.practitioner_id, d.display_name as practitioner_name,
                  d.calendar_color as practitioner_color, q.token_number as "token_number?", q.id as "token_id?"
           from aarogyam.appointments a
           join aarogyam.patients p on p.org_id = a.org_id and p.id = a.patient_id
           join aarogyam.practitioners d on d.org_id = a.org_id and d.id = a.practitioner_id
           left join aarogyam.rooms r on r.org_id = a.org_id and r.id = a.room_id
           left join aarogyam.queue_tokens q on q.org_id = a.org_id and q.appointment_id = a.id
           where a.id = $1 and a.deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Locks an appointment until the transaction ends, so concurrent changes apply one after the
/// other. Returns whether it exists.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select id from aarogyam.appointments where id = $1 and deleted_at is null for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(found.is_some())
}

/// Where and when an appointment is, and what it is for, validated by the caller.
#[derive(Debug, Clone)]
pub struct Booking<'a> {
    /// The doctor.
    pub practitioner_id: Uuid,
    /// Branch.
    pub branch_id: Uuid,
    /// Room.
    pub room_id: Option<Uuid>,
    /// Start.
    pub starts_at: OffsetDateTime,
    /// End.
    pub ends_at: OffsetDateTime,
    /// Kind.
    pub kind: &'a str,
    /// Reason.
    pub reason: Option<&'a str>,
    /// Front-desk note.
    pub notes: Option<&'a str>,
}

/// Books an appointment.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict (constraint `appointments_room_overlap`)
/// when the room is taken.
pub async fn insert(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    source: &str,
    booking: &Booking<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.appointments
             (id, patient_id, practitioner_id, branch_id, room_id, starts_at, ends_at, kind, reason, notes, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
        id,
        patient_id,
        booking.practitioner_id,
        booking.branch_id,
        booking.room_id,
        booking.starts_at,
        booking.ends_at,
        booking.kind,
        booking.reason,
        booking.notes,
        source
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Moves, reassigns or edits an appointment.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the room is taken.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    booking: &Booking<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.appointments
           set practitioner_id = $2, branch_id = $3, room_id = $4, starts_at = $5, ends_at = $6,
               kind = $7, reason = $8, notes = $9
           where id = $1 and deleted_at is null"#,
        id,
        booking.practitioner_id,
        booking.branch_id,
        booking.room_id,
        booking.starts_at,
        booking.ends_at,
        booking.kind,
        booking.reason,
        booking.notes
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Sets the status, stamping the arrival, seating or completion time at `now` the first time
/// the matching status is reached.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when an undone cancellation would overlap.
pub async fn set_status(
    conn: &mut PgConnection,
    id: Uuid,
    status: &str,
    cancel_reason: Option<&str>,
    now: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.appointments
           set status = $2,
               cancel_reason = coalesce($3, cancel_reason),
               arrived_at = case when $2 = 'arrived' then coalesce(arrived_at, $4) else arrived_at end,
               seated_at = case when $2 = 'in_chair' then coalesce(seated_at, $4) else seated_at end,
               completed_at = case when $2 = 'completed' then coalesce(completed_at, $4) else completed_at end
           where id = $1 and deleted_at is null"#,
        id,
        status,
        cancel_reason,
        now
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// An entry in an appointment's history.
#[derive(Debug, Clone)]
pub struct NewEvent<'a> {
    /// The appointment.
    pub appointment_id: Uuid,
    /// `booked`, `changed` or `status`.
    pub kind: &'a str,
    /// Status before a status change.
    pub from_status: Option<&'a str>,
    /// Status after a status change.
    pub to_status: Option<&'a str>,
    /// `{"column": [old, new]}` for a change; ids and times only.
    pub changes: Option<Value>,
    /// A cancel reason or similar note.
    pub note: Option<&'a str>,
    /// When it happened.
    pub at: OffsetDateTime,
}

/// Appends to an appointment's history.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_event(conn: &mut PgConnection, event: &NewEvent<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.appointment_events
             (appointment_id, kind, from_status, to_status, changes, note, at)
           values ($1, $2, $3, $4, $5, $6, $7)"#,
        event.appointment_id,
        event.kind,
        event.from_status,
        event.to_status,
        event.changes,
        event.note,
        event.at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Whether the doctor has another active appointment overlapping `[starts_at, ends_at)`. In
/// the same room the exclusion constraint refuses it first, so this finds other rooms.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn practitioner_busy(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
    starts_at: OffsetDateTime,
    ends_at: OffsetDateTime,
    except: Uuid,
) -> Result<bool, DbError> {
    let busy = sqlx::query_scalar!(
        r#"select exists (
             select 1 from aarogyam.appointments
             where practitioner_id = $1 and id <> $4 and deleted_at is null
               and status not in ('cancelled', 'no_show')
               and starts_at < $3 and ends_at > $2
           ) as "busy!""#,
        practitioner_id,
        starts_at,
        ends_at,
        except
    )
    .fetch_one(conn)
    .await?;
    Ok(busy)
}

/// Whether the doctor is on leave during any of `[starts_at, ends_at)`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn on_leave(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
    starts_at: OffsetDateTime,
    ends_at: OffsetDateTime,
) -> Result<bool, DbError> {
    let away = sqlx::query_scalar!(
        r#"select exists (
             select 1 from aarogyam.leave_blocks
             where practitioner_id = $1 and starts_at < $3 and ends_at > $2
           ) as "away!""#,
        practitioner_id,
        starts_at,
        ends_at
    )
    .fetch_one(conn)
    .await?;
    Ok(away)
}

/// Books an appointment a patient asked for online, with the status the clinic's setting says
/// (`requested` or `confirmed`) and the verified account that made it.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict (constraint `appointments_self_booking_slot`)
/// when another self-booking has the same doctor and start.
pub async fn insert_self_booked(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    account: Uuid,
    status: &str,
    booking: &Booking<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.appointments
             (id, patient_id, practitioner_id, branch_id, room_id, starts_at, ends_at, kind, reason,
              notes, source, status, booked_by_account)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'website', $11, $12)"#,
        id,
        patient_id,
        booking.practitioner_id,
        booking.branch_id,
        booking.room_id,
        booking.starts_at,
        booking.ends_at,
        booking.kind,
        booking.reason,
        booking.notes,
        status,
        account
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Serialises self-bookings for one doctor until the transaction ends, so the check that a slot
/// is free and the insert that takes it can't interleave with another booking.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_doctor_bookings(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"select pg_advisory_xact_lock(hashtextextended($1::text, 0)) as "locked!: bool""#,
        practitioner_id.to_string()
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// A person's future self-bookings that are still open (requested, booked or confirmed).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn open_self_bookings(
    conn: &mut PgConnection,
    account: Uuid,
    now: OffsetDateTime,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(
        r#"select count(*) as "count!" from aarogyam.appointments
           where booked_by_account = $1 and deleted_at is null and ends_at > $2
             and status in ('requested', 'booked', 'confirmed')"#,
        account,
        now
    )
    .fetch_one(conn)
    .await?;
    Ok(count)
}

/// Start and end of the doctor's active appointments overlapping `[from, to)`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn busy_spans(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<(OffsetDateTime, OffsetDateTime)>, DbError> {
    let rows = sqlx::query!(
        r#"select starts_at, ends_at from aarogyam.appointments
           where practitioner_id = $1 and deleted_at is null
             and status not in ('cancelled', 'no_show')
             and starts_at < $3 and ends_at > $2
           order by starts_at"#,
        practitioner_id,
        from,
        to
    )
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(|r| (r.starts_at, r.ends_at)).collect())
}

/// Start and end of the doctor's leave overlapping `[from, to)`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn leave_spans(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<(OffsetDateTime, OffsetDateTime)>, DbError> {
    let rows = sqlx::query!(
        r#"select starts_at, ends_at from aarogyam.leave_blocks
           where practitioner_id = $1 and starts_at < $3 and ends_at > $2
           order by starts_at"#,
        practitioner_id,
        from,
        to
    )
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(|r| (r.starts_at, r.ends_at)).collect())
}
