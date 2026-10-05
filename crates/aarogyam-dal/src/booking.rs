//! What the public booking page reads, one statement per screen. Runs inside a clinic
//! transaction (the public scope), so row-level security limits it to the clinic of the host.

use sakalya_db::DbError;
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgConnection;
use sqlx::types::Json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::schedule::ShiftRow;

/// A doctor patients may pick: active, with working hours.
#[derive(Debug, Clone, Deserialize)]
pub struct BookableDoctorRow {
    /// The doctor.
    pub id: Uuid,
    /// Name as shown on the calendar.
    pub display_name: String,
    /// What they practise, if recorded.
    pub specialty: Option<String>,
}

/// The booking page's opening data.
#[derive(Debug, Clone)]
pub struct BookingPage {
    /// The clinic's name.
    pub clinic_name: String,
    /// The stored booking settings (`{}` when none).
    pub booking: Value,
    /// Active doctors with working hours, by name.
    pub doctors: Vec<BookableDoctorRow>,
}

/// The clinic's name, booking settings and bookable doctors; `None` only if the transaction
/// has no clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn page(conn: &mut PgConnection) -> Result<Option<BookingPage>, DbError> {
    let row = sqlx::query!(
        r#"select o.name,
                  coalesce((select s.booking from aarogyam.org_settings s where s.org_id = o.id),
                           '{}'::jsonb) as "booking!",
                  (select coalesce(json_agg(d order by d.display_name), '[]'::json)
                   from (select p.id, p.display_name, p.specialty
                         from aarogyam.practitioners p
                         where p.deleted_at is null and p.active
                           and exists (select 1 from aarogyam.working_hours h
                                       where h.practitioner_id = p.id)) d
                  ) as "doctors!: Json<Vec<BookableDoctorRow>>"
           from aarogyam.organizations o
           where o.id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| BookingPage {
        clinic_name: row.name,
        booking: row.booking,
        doctors: row.doctors.0,
    }))
}

/// A busy or leave span.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Span {
    /// Start.
    #[serde(with = "crate::json::timestamp")]
    pub starts_at: OffsetDateTime,
    /// End.
    #[serde(with = "crate::json::timestamp")]
    pub ends_at: OffsetDateTime,
}

/// What a doctor's free slots are computed from.
#[derive(Debug, Clone)]
pub struct DoctorDay {
    /// The stored booking settings (`{}` when none).
    pub booking: Value,
    /// Whether the doctor is active; `None` when there is no such doctor.
    pub doctor_active: Option<bool>,
    /// Their weekly hours, by weekday and start.
    pub shifts: Vec<ShiftRow>,
    /// Their appointments that hold time (not cancelled or missed) between `from` and `to`.
    pub busy: Vec<Span>,
    /// Their leave between `from` and `to`.
    pub leave: Vec<Span>,
}

/// The booking settings, and a doctor's hours, appointments and leave between `from` and `to`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn doctor_day(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<DoctorDay, DbError> {
    // The lists are the queries schedule::shifts, appointments::busy_spans and
    // appointments::leave_spans run for one doctor.
    let row = sqlx::query!(
        r#"select
             coalesce((select booking from aarogyam.org_settings where org_id = app.tenant_id()),
                      '{}'::jsonb) as "booking!",
             (select active from aarogyam.practitioners where id = $1 and deleted_at is null)
               as doctor_active,
             (select coalesce(json_agg(h order by h.weekday, h.starts), '[]'::json)
              from (select practitioner_id, branch_id, weekday, starts, ends
                    from aarogyam.working_hours where practitioner_id = $1) h
             ) as "shifts!: Json<Vec<ShiftRow>>",
             (select coalesce(json_agg(a order by a.starts_at), '[]'::json)
              from (select starts_at, ends_at from aarogyam.appointments
                    where practitioner_id = $1 and deleted_at is null
                      and status not in ('cancelled', 'no_show')
                      and starts_at < $3 and ends_at > $2) a
             ) as "busy!: Json<Vec<Span>>",
             (select coalesce(json_agg(l order by l.starts_at), '[]'::json)
              from (select starts_at, ends_at from aarogyam.leave_blocks
                    where practitioner_id = $1 and starts_at < $3 and ends_at > $2) l
             ) as "leave!: Json<Vec<Span>>""#,
        practitioner_id,
        from,
        to
    )
    .fetch_one(conn)
    .await?;
    Ok(DoctorDay {
        booking: row.booking,
        doctor_active: row.doctor_active,
        shifts: row.shifts.0,
        busy: row.busy.0,
        leave: row.leave.0,
    })
}
