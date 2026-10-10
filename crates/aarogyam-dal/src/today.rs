//! Everything the Today screen reads, in one statement: each list comes back as a JSON array
//! of the same rows the separate queries return, so the screen costs one round trip instead of
//! nine. Runs inside a clinic transaction, so row-level security limits it to that clinic.

use sakalya_db::DbError;
use serde::Deserialize;
use sqlx::PgConnection;
use sqlx::types::Json;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::appointments::AppointmentRow;
use crate::inventory::StockRow;
use crate::queue::TokenRow;
use crate::schedule::{LeaveRow, PractitionerRow, RoomRow, ShiftRow};

/// A visit closed on the day, without its clinical content.
#[derive(Debug, Clone, Deserialize)]
pub struct CompletedVisitRow {
    /// The visit.
    pub id: Uuid,
    /// Readable number, such as `V-318`.
    pub number: String,
    /// The appointment it was started from.
    pub appointment_id: Option<Uuid>,
    /// The patient.
    pub patient_id: Uuid,
    /// Their clinic number.
    pub patient_number: String,
    /// Their name.
    pub patient_name: String,
    /// The member responsible.
    pub clinician_id: Uuid,
    /// Their name.
    pub clinician_name: Option<String>,
    /// When the visit started.
    #[serde(with = "crate::json::timestamp")]
    pub started_at: OffsetDateTime,
    /// When it was closed.
    #[serde(with = "crate::json::timestamp")]
    pub ended_at: OffsetDateTime,
    /// Issued bills for the visit, in paise; read only with `finance.view`.
    pub billed_paise: Option<i64>,
    /// Received against those bills, in paise; read only with `finance.view`.
    pub paid_paise: Option<i64>,
}

/// What came in and went out on the day, read only with `finance.view`.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct DayMoneyRow {
    /// Received on the day, in paise.
    pub collected_paise: i64,
    /// Payments received.
    pub payments: i64,
    /// Billed on the day, in paise.
    pub invoiced_paise: i64,
    /// Bills issued.
    pub invoices: i64,
}

/// What the caller may read besides the clinic's schedule.
#[derive(Debug, Clone, Copy)]
pub struct TodayReads {
    /// Stock levels (`inventory.read`).
    pub stock: bool,
    /// Money figures (`finance.view`).
    pub money: bool,
}

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
    /// Visits closed in the day, by end.
    pub completed_visits: Vec<CompletedVisitRow>,
    /// The day's money, when asked for.
    pub money: Option<DayMoneyRow>,
}

/// What Today shows for the local day `day`, which runs from `start` to `end`. Reads stock
/// levels only when `reads.stock` and money only when `reads.money`.
///
/// # Errors
/// [`DbError`] on a database failure.
#[expect(
    clippy::too_many_lines,
    reason = "one function reads each of Today's independent slices in turn"
)]
pub async fn today(
    conn: &mut PgConnection,
    start: OffsetDateTime,
    end: OffsetDateTime,
    day: Date,
    weekday: i16,
    reads: TodayReads,
    member: Option<Uuid>,
) -> Result<TodayRows, DbError> {
    let with_stock = reads.stock;
    let with_money = reads.money;
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
                           ('self_registered' = any(p.tags)
                            and (p.sex = 'unknown' or p.date_of_birth is null))
                             as patient_registration_incomplete,
                           a.practitioner_id, d.display_name as practitioner_name,
                           d.calendar_color as practitioner_color, q.token_number
                    from aarogyam.appointments a
                    join aarogyam.patients p on p.org_id = a.org_id and p.id = a.patient_id
                    join aarogyam.practitioners d on d.org_id = a.org_id and d.id = a.practitioner_id
                    left join aarogyam.rooms r on r.org_id = a.org_id and r.id = a.room_id
                    left join aarogyam.queue_tokens q on q.org_id = a.org_id and q.appointment_id = a.id
                    where a.deleted_at is null and a.starts_at >= $1 and a.starts_at < $2
                      and app.practitioner_in_reach(a.practitioner_id, $6)) a
             ) as "appointments!: Json<Vec<AppointmentRow>>",
             (select coalesce(json_agg(q order by q.branch_id, q.token_number), '[]'::json)
              from (select q.id, q.branch_id, q.day, q.token_number, q.status, q.issued_at,
                           q.called_at, q.done_at, q.patient_id, p.number as patient_number,
                           p.full_name as patient_name, p.sex as patient_sex,
                           p.date_of_birth as patient_date_of_birth,
                           p.birth_date_estimated as patient_birth_date_estimated,
                           ('self_registered' = any(p.tags)
                            and (p.sex = 'unknown' or p.date_of_birth is null))
                             as patient_registration_incomplete,
                           q.appointment_id, q.practitioner_id, d.display_name as practitioner_name,
                           q.room_id
                    from aarogyam.queue_tokens q
                    join aarogyam.patients p on p.org_id = q.org_id and p.id = q.patient_id
                    left join aarogyam.practitioners d on d.org_id = q.org_id and d.id = q.practitioner_id
                    where q.day = $3 and app.practitioner_in_reach(q.practitioner_id, $6)) q
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
             ) as "stock!: Json<Vec<StockRow>>",
             (select coalesce(json_agg(v order by v.ended_at, v.id), '[]'::json)
              from (select e.id, e.number, e.appointment_id, e.patient_id, p.number as patient_number,
                           p.full_name as patient_name, e.clinician_id, u.display_name as clinician_name,
                           e.started_at, e.ended_at,
                           case when $7 then b.billed end as billed_paise,
                           case when $7 then b.paid end as paid_paise
                    from aarogyam.encounters e
                    join aarogyam.patients p on p.org_id = e.org_id and p.id = e.patient_id
                    left join aarogyam.memberships m on m.org_id = e.org_id and m.id = e.clinician_id
                    left join aarogyam.users u on u.id = m.user_id
                    left join lateral (
                      select coalesce(sum(i.total_paise), 0)::bigint as billed,
                             coalesce(sum((select sum(a.amount_paise)
                                           from aarogyam.payment_allocations a
                                           join aarogyam.payments y
                                             on y.org_id = a.org_id and y.id = a.payment_id
                                           where a.org_id = i.org_id and a.invoice_id = i.id
                                             and y.status = 'received')), 0)::bigint as paid
                      from aarogyam.invoices i
                      where $7 and i.org_id = e.org_id and i.encounter_id = e.id and i.status = 'issued'
                    ) b on true
                    where e.status = 'closed' and e.ended_at >= $1 and e.ended_at < $2
                      and app.clinical_in_reach(e.clinician_id, e.created_by, null, $6)) v
             ) as "completed_visits!: Json<Vec<CompletedVisitRow>>",
             case when $7 then (
               select json_build_object(
                        'collected_paise',
                        coalesce((select sum(y.amount_paise) from aarogyam.payments y
                                  where y.status = 'received' and y.received_at >= $1
                                    and y.received_at < $2), 0)::bigint,
                        'payments',
                        (select count(*) from aarogyam.payments y
                         where y.status = 'received' and y.received_at >= $1
                           and y.received_at < $2)::bigint,
                        'invoiced_paise',
                        coalesce((select sum(i.total_paise) from aarogyam.invoices i
                                  where i.status = 'issued' and i.issued_at >= $1
                                    and i.issued_at < $2), 0)::bigint,
                        'invoices',
                        (select count(*) from aarogyam.invoices i
                         where i.status = 'issued' and i.issued_at >= $1
                           and i.issued_at < $2)::bigint)
             ) end as "money?: Json<DayMoneyRow>""#,
        start,
        end,
        day,
        weekday,
        with_stock,
        member,
        with_money
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
        completed_visits: row.completed_visits.0,
        money: row.money.map(|money| money.0),
    })
}

/// Appointments on one local day, by what became of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DayAppointments {
    /// The local day.
    pub day: Date,
    /// Requested, booked, confirmed, arrived or in the chair.
    pub booked: i64,
    /// Completed.
    pub completed: i64,
    /// Cancelled.
    pub cancelled: i64,
    /// Didn't come.
    pub no_shows: i64,
}

/// Appointments starting in `[start, end)` counted per local day at a fixed UTC offset
/// (`offset_seconds`), only for days that have any; `member` narrows to that member's
/// appointments (`app.practitioner_in_reach`), `None` reaches all. One statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn month_summary(
    conn: &mut PgConnection,
    start: OffsetDateTime,
    end: OffsetDateTime,
    offset_seconds: i32,
    member: Option<Uuid>,
) -> Result<Vec<DayAppointments>, DbError> {
    let rows = sqlx::query!(
        r#"select (a.starts_at at time zone make_interval(secs => $3))::date as "day!",
                  count(*) filter (where a.status in ('requested', 'booked', 'confirmed', 'arrived', 'in_chair'))::bigint as "booked!",
                  count(*) filter (where a.status = 'completed')::bigint as "completed!",
                  count(*) filter (where a.status = 'cancelled')::bigint as "cancelled!",
                  count(*) filter (where a.status = 'no_show')::bigint as "no_shows!"
           from aarogyam.appointments a
           where a.deleted_at is null and a.starts_at >= $1 and a.starts_at < $2
             and app.practitioner_in_reach(a.practitioner_id, $4)
           group by 1
           order by 1"#,
        start,
        end,
        f64::from(offset_seconds),
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| DayAppointments {
            day: row.day,
            booked: row.booked,
            completed: row.completed,
            cancelled: row.cancelled,
            no_shows: row.no_shows,
        })
        .collect())
}
