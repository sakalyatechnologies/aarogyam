//! Everything the Today screen reads, in one statement: each list comes back as a JSON array
//! of the same rows the separate queries return, so the screen costs one round trip instead of
//! seven. Runs inside a clinic transaction, so row-level security limits it to that clinic.

use sakalya_db::DbError;
use sqlx::PgConnection;
use sqlx::types::Json;
use time::{Date, OffsetDateTime};

use crate::appointments::AppointmentRow;
use crate::inventory::StockRow;
use crate::queue::TokenRow;
use crate::schedule::{LeaveRow, PractitionerRow, RoomRow, ShiftRow};

/// The rows behind Today, each list in the order its own query gives.
#[derive(Debug, Clone)]
pub struct TodayRows {
    /// Appointments starting in the day, cancelled ones included, by start.
    pub appointments: Vec<AppointmentRow>,
    /// The day's queue tokens, by branch and number.
    pub tokens: Vec<TokenRow>,
    /// Rooms, by sort order and name.
    pub rooms: Vec<RoomRow>,
    /// Working hours on the day's weekday.
    pub shifts: Vec<ShiftRow>,
    /// Leave overlapping the day.
    pub leave: Vec<LeaveRow>,
    /// Doctors, by name.
    pub practitioners: Vec<PractitionerRow>,
    /// Stock levels by item name, when asked for.
    pub stock: Option<Vec<StockRow>>,
}

/// What Today shows for the local day `day`, which runs from `start` to `end`. Reads stock
/// levels only when `with_stock`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn today(
    conn: &mut PgConnection,
    start: OffsetDateTime,
    end: OffsetDateTime,
    day: Date,
    weekday: i16,
    with_stock: bool,
) -> Result<TodayRows, DbError> {
    // Each subquery is the query its module runs for one list (appointments::list,
    // queue::list, schedule::rooms, shifts, leave and practitioners, inventory::stock).
    let row = sqlx::query!(
        r#"select
             (select coalesce(json_agg(a order by a.starts_at, a.room_name, a.id), '[]'::json)
              from (select a.id, a.branch_id, a.room_id, r.name as room_name, a.starts_at, a.ends_at,
                           a.status, a.kind, a.reason, a.notes, a.source, a.cancel_reason,
                           a.arrived_at, a.seated_at, a.completed_at, a.row_version,
                           a.patient_id, p.number as patient_number, p.full_name as patient_name,
                           p.sex as patient_sex, p.date_of_birth as patient_date_of_birth,
                           p.birth_date_estimated as patient_birth_date_estimated,
                           a.practitioner_id, d.display_name as practitioner_name,
                           d.calendar_color as practitioner_color, q.token_number
                    from aarogyam.appointments a
                    join aarogyam.patients p on p.org_id = a.org_id and p.id = a.patient_id
                    join aarogyam.practitioners d on d.org_id = a.org_id and d.id = a.practitioner_id
                    left join aarogyam.rooms r on r.org_id = a.org_id and r.id = a.room_id
                    left join aarogyam.queue_tokens q on q.org_id = a.org_id and q.appointment_id = a.id
                    where a.deleted_at is null and a.starts_at >= $1 and a.starts_at < $2) a
             ) as "appointments!: Json<Vec<AppointmentRow>>",
             (select coalesce(json_agg(q order by q.branch_id, q.token_number), '[]'::json)
              from (select q.id, q.branch_id, q.day, q.token_number, q.status, q.issued_at,
                           q.called_at, q.done_at, q.patient_id, p.number as patient_number,
                           p.full_name as patient_name, p.sex as patient_sex,
                           p.date_of_birth as patient_date_of_birth,
                           p.birth_date_estimated as patient_birth_date_estimated,
                           q.appointment_id, q.practitioner_id, d.display_name as practitioner_name
                    from aarogyam.queue_tokens q
                    join aarogyam.patients p on p.org_id = q.org_id and p.id = q.patient_id
                    left join aarogyam.practitioners d on d.org_id = q.org_id and d.id = q.practitioner_id
                    where q.day = $3) q
             ) as "tokens!: Json<Vec<TokenRow>>",
             (select coalesce(json_agg(r order by r.sort_order, r.name), '[]'::json)
              from (select id, branch_id, name, kind, active, sort_order
                    from aarogyam.rooms where deleted_at is null) r
             ) as "rooms!: Json<Vec<RoomRow>>",
             (select coalesce(json_agg(h order by h.practitioner_id, h.weekday, h.starts), '[]'::json)
              from (select practitioner_id, branch_id, weekday, starts, ends
                    from aarogyam.working_hours where weekday = $4) h
             ) as "shifts!: Json<Vec<ShiftRow>>",
             (select coalesce(json_agg(l order by l.starts_at), '[]'::json)
              from (select id, practitioner_id, starts_at, ends_at, reason
                    from aarogyam.leave_blocks where starts_at < $2 and ends_at > $1) l
             ) as "leave!: Json<Vec<LeaveRow>>",
             (select coalesce(json_agg(d order by d.display_name), '[]'::json)
              from (select id, membership_id, display_name, registration_number, qualifications,
                           specialty, calendar_color, active
                    from aarogyam.practitioners where deleted_at is null) d
             ) as "practitioners!: Json<Vec<PractitionerRow>>",
             (select coalesce(json_agg(s order by lower(s.name), s.id), '[]'::json)
              from (select i.id, i.name, i.category, i.unit, i.reorder_level, i.active,
                           coalesce(sum(b.quantity), 0)::bigint as on_hand,
                           min(b.expiry) filter (where b.quantity > 0) as next_expiry
                    from aarogyam.inventory_items i
                    left join aarogyam.stock_batches b on b.org_id = i.org_id and b.item_id = i.id
                    where i.deleted_at is null and $5
                    group by i.org_id, i.id) s
             ) as "stock!: Json<Vec<StockRow>>""#,
        start,
        end,
        day,
        weekday,
        with_stock
    )
    .fetch_one(conn)
    .await?;
    Ok(TodayRows {
        appointments: row.appointments.0,
        tokens: row.tokens.0,
        rooms: row.rooms.0,
        shifts: row.shifts.0,
        leave: row.leave.0,
        practitioners: row.practitioners.0,
        stock: with_stock.then_some(row.stock.0),
    })
}
