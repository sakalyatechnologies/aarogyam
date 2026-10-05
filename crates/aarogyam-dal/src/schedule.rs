//! Chairs, doctors, their weekly hours and their leave. Every function takes the connection of
//! an open clinic transaction, so row-level security limits it to that clinic.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{OffsetDateTime, Time};
use uuid::Uuid;

/// A chair, room or lab as stored.
#[derive(Debug, Clone)]
pub struct RoomRow {
    /// Identifier.
    pub id: Uuid,
    /// Branch it belongs to.
    pub branch_id: Uuid,
    /// Name, such as `Chair 1`.
    pub name: String,
    /// `chair`, `room` or `lab`.
    pub kind: String,
    /// Whether it can be booked.
    pub active: bool,
    /// Position in lists.
    pub sort_order: i16,
}

/// A room's editable values, validated by the caller.
#[derive(Debug, Clone)]
pub struct RoomValues<'a> {
    /// Branch.
    pub branch_id: Uuid,
    /// Name.
    pub name: &'a str,
    /// Kind.
    pub kind: &'a str,
    /// Bookable.
    pub active: bool,
    /// Position.
    pub sort_order: i16,
}

/// The clinic's rooms, not deleted, in list order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn rooms(conn: &mut PgConnection) -> Result<Vec<RoomRow>, DbError> {
    let rows = sqlx::query_as!(
        RoomRow,
        r#"select id, branch_id, name, kind, active, sort_order
           from aarogyam.rooms
           where deleted_at is null
           order by sort_order, name"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One room, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn room(conn: &mut PgConnection, id: Uuid) -> Result<Option<RoomRow>, DbError> {
    let row = sqlx::query_as!(
        RoomRow,
        r#"select id, branch_id, name, kind, active, sort_order
           from aarogyam.rooms
           where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Adds a room.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the branch has a room of that name.
pub async fn insert_room(
    conn: &mut PgConnection,
    id: Uuid,
    values: &RoomValues<'_>,
) -> Result<RoomRow, DbError> {
    let row = sqlx::query_as!(
        RoomRow,
        r#"insert into aarogyam.rooms (id, branch_id, name, kind, active, sort_order)
           values ($1, $2, $3, $4, $5, $6)
           returning id, branch_id, name, kind, active, sort_order"#,
        id,
        values.branch_id,
        values.name,
        values.kind,
        values.active,
        values.sort_order
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves a room's values.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_room(
    conn: &mut PgConnection,
    id: Uuid,
    values: &RoomValues<'_>,
) -> Result<Option<RoomRow>, DbError> {
    let row = sqlx::query_as!(
        RoomRow,
        r#"update aarogyam.rooms
           set branch_id = $2, name = $3, kind = $4, active = $5, sort_order = $6
           where id = $1 and deleted_at is null
           returning id, branch_id, name, kind, active, sort_order"#,
        id,
        values.branch_id,
        values.name,
        values.kind,
        values.active,
        values.sort_order
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks a room deleted. Returns whether it existed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_room(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.rooms set deleted_at = now(), active = false
           where id = $1 and deleted_at is null"#,
        id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Whether the clinic has a branch with this id.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn branch_exists(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.branches where id = $1 and deleted_at is null) as "found!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// The clinic's default branch.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn default_branch(conn: &mut PgConnection) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        r#"select id from aarogyam.branches where is_default and deleted_at is null"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// A doctor as stored.
#[derive(Debug, Clone)]
pub struct PractitionerRow {
    /// Identifier.
    pub id: Uuid,
    /// Their membership, if they sign in.
    pub membership_id: Option<Uuid>,
    /// Name shown on the calendar.
    pub display_name: String,
    /// Council registration number.
    pub registration_number: Option<String>,
    /// Degrees printed on the letterhead, such as `BDS, MDS`.
    pub qualifications: Option<String>,
    /// Specialty, such as `Orthodontics`.
    pub specialty: Option<String>,
    /// `#RRGGBB`.
    pub calendar_color: String,
    /// Whether they can be booked.
    pub active: bool,
}

/// A doctor's editable values, validated by the caller.
#[derive(Debug, Clone)]
pub struct PractitionerValues<'a> {
    /// Membership.
    pub membership_id: Option<Uuid>,
    /// Name.
    pub display_name: &'a str,
    /// Registration number.
    pub registration_number: Option<&'a str>,
    /// Qualifications.
    pub qualifications: Option<&'a str>,
    /// Specialty.
    pub specialty: Option<&'a str>,
    /// Colour.
    pub calendar_color: &'a str,
    /// Bookable.
    pub active: bool,
}

/// The clinic's doctors, not deleted, by name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn practitioners(conn: &mut PgConnection) -> Result<Vec<PractitionerRow>, DbError> {
    let rows = sqlx::query_as!(
        PractitionerRow,
        r#"select id, membership_id, display_name, registration_number, qualifications, specialty, calendar_color, active
           from aarogyam.practitioners
           where deleted_at is null
           order by display_name"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One doctor, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn practitioner(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<PractitionerRow>, DbError> {
    let row = sqlx::query_as!(
        PractitionerRow,
        r#"select id, membership_id, display_name, registration_number, qualifications, specialty, calendar_color, active
           from aarogyam.practitioners
           where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The doctor linked to a membership, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn practitioner_of(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<Option<PractitionerRow>, DbError> {
    let row = sqlx::query_as!(
        PractitionerRow,
        r#"select id, membership_id, display_name, registration_number, qualifications, specialty, calendar_color, active
           from aarogyam.practitioners
           where membership_id = $1 and deleted_at is null"#,
        membership_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Whether the clinic has a membership with this id.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn membership_exists(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.memberships where id = $1) as "found!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// Adds a doctor.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the member is already a doctor.
pub async fn insert_practitioner(
    conn: &mut PgConnection,
    id: Uuid,
    values: &PractitionerValues<'_>,
) -> Result<PractitionerRow, DbError> {
    let row = sqlx::query_as!(
        PractitionerRow,
        r#"insert into aarogyam.practitioners
             (id, membership_id, display_name, registration_number, qualifications, specialty, calendar_color, active)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, membership_id, display_name, registration_number, qualifications, specialty, calendar_color, active"#,
        id,
        values.membership_id,
        values.display_name,
        values.registration_number,
        values.qualifications,
        values.specialty,
        values.calendar_color,
        values.active
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves a doctor's values.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_practitioner(
    conn: &mut PgConnection,
    id: Uuid,
    values: &PractitionerValues<'_>,
) -> Result<Option<PractitionerRow>, DbError> {
    let row = sqlx::query_as!(
        PractitionerRow,
        r#"update aarogyam.practitioners
           set membership_id = $2, display_name = $3, registration_number = $4, qualifications = $5, specialty = $6,
               calendar_color = $7, active = $8
           where id = $1 and deleted_at is null
           returning id, membership_id, display_name, registration_number, qualifications, specialty, calendar_color, active"#,
        id,
        values.membership_id,
        values.display_name,
        values.registration_number,
        values.qualifications,
        values.specialty,
        values.calendar_color,
        values.active
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks a doctor deleted and drops their weekly hours. Returns whether they existed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_practitioner(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.practitioners set deleted_at = now(), active = false
           where id = $1 and deleted_at is null"#,
        id
    )
    .execute(&mut *conn)
    .await?;
    if done.rows_affected() == 1 {
        sqlx::query!(
            r#"delete from aarogyam.working_hours where practitioner_id = $1"#,
            id
        )
        .execute(conn)
        .await?;
    }
    Ok(done.rows_affected() == 1)
}

/// Active appointments in a room or with a doctor from `from` on, to refuse deleting them.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn future_bookings(
    conn: &mut PgConnection,
    room_id: Option<Uuid>,
    practitioner_id: Option<Uuid>,
    from: OffsetDateTime,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(
        r#"select count(*) as "count!" from aarogyam.appointments
           where deleted_at is null and ends_at > $3
             and status not in ('cancelled', 'no_show', 'completed')
             and (room_id = $1 or practitioner_id = $2)"#,
        room_id,
        practitioner_id,
        from
    )
    .fetch_one(conn)
    .await?;
    Ok(count)
}

/// One shift as stored.
#[derive(Debug, Clone)]
pub struct ShiftRow {
    /// The doctor.
    pub practitioner_id: Uuid,
    /// Branch.
    pub branch_id: Uuid,
    /// 1 Monday to 7 Sunday.
    pub weekday: i16,
    /// Local start.
    pub starts: Time,
    /// Local end.
    pub ends: Time,
}

/// Shifts of one doctor, or every doctor when `practitioner_id` is `None`, optionally on one
/// weekday, by doctor, weekday and start.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn shifts(
    conn: &mut PgConnection,
    practitioner_id: Option<Uuid>,
    weekday: Option<i16>,
) -> Result<Vec<ShiftRow>, DbError> {
    let rows = sqlx::query_as!(
        ShiftRow,
        r#"select practitioner_id, branch_id, weekday, starts, ends
           from aarogyam.working_hours
           where ($1::uuid is null or practitioner_id = $1)
             and ($2::smallint is null or weekday = $2)
           order by practitioner_id, weekday, starts"#,
        practitioner_id,
        weekday
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Replaces a doctor's week with these shifts.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn replace_shifts(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
    shifts: &[ShiftRow],
) -> Result<(), DbError> {
    sqlx::query!(
        r#"delete from aarogyam.working_hours where practitioner_id = $1"#,
        practitioner_id
    )
    .execute(&mut *conn)
    .await?;
    let branches: Vec<Uuid> = shifts.iter().map(|shift| shift.branch_id).collect();
    let weekdays: Vec<i16> = shifts.iter().map(|shift| shift.weekday).collect();
    let starts: Vec<Time> = shifts.iter().map(|shift| shift.starts).collect();
    let ends: Vec<Time> = shifts.iter().map(|shift| shift.ends).collect();
    sqlx::query!(
        r#"insert into aarogyam.working_hours (practitioner_id, branch_id, weekday, starts, ends)
           select $1, b, w, s, e
           from unnest($2::uuid[], $3::smallint[], $4::time[], $5::time[]) as t(b, w, s, e)"#,
        practitioner_id,
        &branches,
        &weekdays,
        &starts,
        &ends
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A leave block as stored.
#[derive(Debug, Clone)]
pub struct LeaveRow {
    /// Identifier.
    pub id: Uuid,
    /// The doctor.
    pub practitioner_id: Uuid,
    /// Start.
    pub starts_at: OffsetDateTime,
    /// End.
    pub ends_at: OffsetDateTime,
    /// Why.
    pub reason: Option<String>,
}

/// Leave overlapping `[from, to)`, optionally for one doctor, by start.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn leave(
    conn: &mut PgConnection,
    practitioner_id: Option<Uuid>,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<LeaveRow>, DbError> {
    let rows = sqlx::query_as!(
        LeaveRow,
        r#"select id, practitioner_id, starts_at, ends_at, reason
           from aarogyam.leave_blocks
           where starts_at < $3 and ends_at > $2
             and ($1::uuid is null or practitioner_id = $1)
           order by starts_at"#,
        practitioner_id,
        from,
        to
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Adds leave.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_leave(conn: &mut PgConnection, row: &LeaveRow) -> Result<LeaveRow, DbError> {
    let row = sqlx::query_as!(
        LeaveRow,
        r#"insert into aarogyam.leave_blocks (id, practitioner_id, starts_at, ends_at, reason)
           values ($1, $2, $3, $4, $5)
           returning id, practitioner_id, starts_at, ends_at, reason"#,
        row.id,
        row.practitioner_id,
        row.starts_at,
        row.ends_at,
        row.reason
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Removes leave. Returns whether it existed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_leave(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(r#"delete from aarogyam.leave_blocks where id = $1"#, id)
        .execute(conn)
        .await?;
    Ok(done.rows_affected() == 1)
}
