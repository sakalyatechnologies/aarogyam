//! Today at the clinic: the day's schedule, chairs, counts, recent patients, who is working,
//! and what needs the front desk's attention, for today or any other clinic day: a past day
//! shows what was done, a future day what is booked. Money figures need `finance.view`.

use std::collections::BTreeMap;

use aarogyam_dal::schedule::{PractitionerRow, RoomRow, ShiftRow};
use aarogyam_dal::today::{self as dal_today, CompletedVisitRow, DayMoneyRow, TodayReads};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{
    AppointmentStatus, QueueStatus, is_late, minutes_between, waits_too_long,
};
use sakalya_db::Db;
use sakalya_types::Paise;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::appointments::AppointmentView;
use crate::clock::{clinic_offset, clinic_today, day_bounds};
use crate::error::AppError;
use crate::inventory::{self, StockItem};
use crate::queue::TokenView;
use crate::scope::staff_scope as scope;

/// How many recent patients Today lists.
pub const RECENT_PATIENTS: usize = 8;

/// The day's numbers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    /// Appointments today, not counting cancelled ones.
    pub total: usize,
    /// Booked or confirmed, not arrived yet.
    pub booked: usize,
    /// Arrived and waiting.
    pub arrived: usize,
    /// In the chair now.
    pub in_chair: usize,
    /// Completed.
    pub done: usize,
    /// Didn't come.
    pub no_shows: usize,
    /// Cancelled.
    pub cancelled: usize,
    /// Queue tokens waiting, walk-ins included.
    pub waiting: usize,
    /// Queue tokens the doctor sent in (called) and the patient hasn't been seated yet.
    pub called: usize,
    /// Queue tokens ready to bill: treatment done, payment not yet collected.
    pub ready_to_bill: usize,
}

/// Appointments starting in one local hour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HourCount {
    /// Local hour, 0 to 23.
    pub hour: u8,
    /// Appointments, not counting cancelled ones.
    pub booked: usize,
    /// Of those, completed.
    pub completed: usize,
}

/// A chair right now.
#[derive(Debug, Clone)]
pub struct Chair {
    /// The room.
    pub room: RoomRow,
    /// The appointment in it now (index into [`Today::appointments`]).
    pub current: Option<usize>,
    /// The next appointment due in it today (index into [`Today::appointments`]).
    pub next: Option<usize>,
}

/// A doctor working today.
#[derive(Debug, Clone)]
pub struct TeamMember {
    /// The doctor.
    pub practitioner: PractitionerRow,
    /// Today's shifts.
    pub shifts: Vec<ShiftRow>,
    /// Whether leave overlaps today.
    pub on_leave: bool,
    /// Appointments today, not counting cancelled ones.
    pub appointments: usize,
}

/// Why something needs attention.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttentionKind {
    /// A booked patient hasn't arrived 15 minutes after the start.
    LateArrival,
    /// A patient has waited more than 30 minutes.
    LongWait,
}

impl AttentionKind {
    /// Stable code for clients.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::LateArrival => "late_arrival",
            Self::LongWait => "long_wait",
        }
    }
}

/// Something the front desk should look at.
#[derive(Debug, Clone)]
pub struct Attention {
    /// Why.
    pub kind: AttentionKind,
    /// The appointment, if any.
    pub appointment_id: Option<Uuid>,
    /// The queue token, if any.
    pub token_id: Option<Uuid>,
    /// The patient.
    pub patient_id: Uuid,
    /// Their number.
    pub patient_number: String,
    /// Their name.
    pub patient_name: String,
    /// Minutes late, or minutes waited.
    pub minutes: i64,
}

/// What came in and went out on the day (`finance.view`).
#[derive(Debug, Clone, Copy)]
pub struct DayMoney {
    /// Received on the day.
    pub collected: Paise,
    /// Payments received.
    pub payments: i64,
    /// Billed on the day.
    pub invoiced: Paise,
    /// Bills issued.
    pub invoices: i64,
}

/// A visit closed on the day, without its clinical content.
#[derive(Debug, Clone)]
pub struct CompletedVisit {
    /// The stored visit with names.
    pub row: CompletedVisitRow,
    /// Billed for the visit; `None` without `finance.view`.
    pub billed: Option<Paise>,
    /// Received against it; `None` without `finance.view`.
    pub paid: Option<Paise>,
}

/// Today at the clinic.
#[derive(Debug, Clone)]
pub struct Today {
    /// The clinic's local date.
    pub date: Date,
    /// When this was built.
    pub as_of: OffsetDateTime,
    /// Today's appointments by start, cancelled ones included.
    pub appointments: Vec<AppointmentView>,
    /// The day's numbers.
    pub counts: Counts,
    /// Appointments per local hour, for the hours that have any.
    pub by_hour: Vec<HourCount>,
    /// Each active chair: who is in it and who is next.
    pub chairs: Vec<Chair>,
    /// The latest patients through the queue today, newest first.
    pub recent_patients: Vec<TokenView>,
    /// Doctors with working hours today.
    pub team: Vec<TeamMember>,
    /// Late arrivals and long waits, most minutes first.
    pub attention: Vec<Attention>,
    /// Items at or below their reorder level, worst first; `None` when the caller may not see
    /// stock (without `inventory.read`).
    pub low_stock: Option<Vec<StockItem>>,
    /// Visits closed on the day, by end.
    pub completed_visits: Vec<CompletedVisit>,
    /// The day's money; `None` without `finance.view`.
    pub money: Option<DayMoney>,
}

fn status_of(view: &AppointmentView) -> Option<AppointmentStatus> {
    AppointmentStatus::parse(&view.row.status).ok()
}

fn counts(appointments: &[AppointmentView], tokens: &[TokenView]) -> Counts {
    let mut counts = Counts::default();
    for status in appointments.iter().filter_map(status_of) {
        if status != AppointmentStatus::Cancelled {
            counts.total += 1;
        }
        match status {
            AppointmentStatus::Requested
            | AppointmentStatus::Booked
            | AppointmentStatus::Confirmed => counts.booked += 1,
            AppointmentStatus::Arrived => counts.arrived += 1,
            AppointmentStatus::InChair => counts.in_chair += 1,
            AppointmentStatus::Completed => counts.done += 1,
            AppointmentStatus::NoShow => counts.no_shows += 1,
            AppointmentStatus::Cancelled => counts.cancelled += 1,
        }
    }
    let in_status = |status: QueueStatus| {
        tokens
            .iter()
            .filter(|token| token.row.status == status.as_str())
            .count()
    };
    counts.waiting = in_status(QueueStatus::Waiting);
    counts.called = in_status(QueueStatus::Called);
    counts.ready_to_bill = in_status(QueueStatus::ReadyToBill);
    counts
}

fn by_hour(appointments: &[AppointmentView], timezone: &str) -> Vec<HourCount> {
    let offset = clinic_offset(timezone);
    let mut hours: BTreeMap<u8, HourCount> = BTreeMap::new();
    for view in appointments {
        let Some(status) = status_of(view) else {
            continue;
        };
        if status == AppointmentStatus::Cancelled {
            continue;
        }
        let hour = view.row.starts_at.to_offset(offset).hour();
        let entry = hours.entry(hour).or_insert(HourCount {
            hour,
            booked: 0,
            completed: 0,
        });
        entry.booked += 1;
        if status == AppointmentStatus::Completed {
            entry.completed += 1;
        }
    }
    hours.into_values().collect()
}

/// How a day relates to the clinic's today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Day {
    Past,
    Today,
    Future,
}

fn chairs(rooms: Vec<RoomRow>, appointments: &[AppointmentView], day: Day) -> Vec<Chair> {
    rooms
        .into_iter()
        .filter(|room| room.active)
        .map(|room| {
            let in_room = |index: &usize| appointments[*index].row.room_id == Some(room.id);
            let indexes: Vec<usize> = (0..appointments.len()).filter(in_room).collect();
            // Nobody is in a chair on another day, and a day gone by has no next patient.
            let current = indexes.iter().copied().find(|index| {
                day == Day::Today
                    && status_of(&appointments[*index]) == Some(AppointmentStatus::InChair)
            });
            let next = indexes.iter().copied().find(|index| {
                day != Day::Past
                    && status_of(&appointments[*index]).is_some_and(|status| {
                        status.is_upcoming() || status == AppointmentStatus::Arrived
                    })
            });
            Chair {
                room,
                current,
                next,
            }
        })
        .collect()
}

fn attention(
    appointments: &[AppointmentView],
    tokens: &[TokenView],
    now: OffsetDateTime,
) -> Vec<Attention> {
    let mut items: Vec<Attention> = appointments
        .iter()
        .filter(|view| {
            status_of(view).is_some_and(|status| is_late(status, view.row.starts_at, now))
        })
        .map(|view| Attention {
            kind: AttentionKind::LateArrival,
            appointment_id: Some(view.row.id),
            token_id: None,
            patient_id: view.row.patient_id,
            patient_number: view.row.patient_number.clone(),
            patient_name: view.row.patient_name.clone(),
            minutes: minutes_between(view.row.starts_at, now),
        })
        .collect();
    items.extend(
        tokens
            .iter()
            .filter(|token| {
                QueueStatus::parse(&token.row.status)
                    .is_ok_and(|status| waits_too_long(status, token.row.issued_at, now))
            })
            .map(|token| Attention {
                kind: AttentionKind::LongWait,
                appointment_id: token.row.appointment_id,
                token_id: Some(token.row.id),
                patient_id: token.row.patient_id,
                patient_number: token.row.patient_number.clone(),
                patient_name: token.row.patient_name.clone(),
                minutes: token.wait_minutes,
            }),
    );
    items.sort_by_key(|item| std::cmp::Reverse(item.minutes));
    items
}

/// Earliest and latest year a day may be asked for.
const YEARS: std::ops::RangeInclusive<i32> = 2000..=2100;

/// Builds Today for the caller's clinic: for `date`, or the clinic's today when `None`. Late
/// arrivals, long waits and the chair in use are about now, so they show for today only.
///
/// # Errors
/// [`AppError::Denied`] without `appointments.read`; [`AppError::Invalid`] for a day outside
/// 2000 to 2100; [`AppError::Db`] on failures.
#[expect(
    clippy::too_many_lines,
    reason = "one function assembles each of Today's slices in turn"
)]
pub async fn today(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
    date: Option<Date>,
) -> Result<Today, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let clinic_day = clinic_today(&actor.timezone, now);
    let date = date.unwrap_or(clinic_day);
    if !YEARS.contains(&date.year()) {
        return Err(AppError::invalid(
            "date",
            "must be a year from 2000 to 2100",
        ));
    }
    let day = match date.cmp(&clinic_day) {
        std::cmp::Ordering::Less => Day::Past,
        std::cmp::Ordering::Equal => Day::Today,
        std::cmp::Ordering::Greater => Day::Future,
    };
    let (start, end) = day_bounds(&actor.timezone, date);
    let weekday = i16::from(date.weekday().number_from_monday());
    let reads = TodayReads {
        stock: actor.permissions.allows(Permission::InventoryRead),
        money: actor.permissions.allows(Permission::FinanceView),
    };
    // Counts, chairs and the team follow from the appointments and tokens in reach.
    let reach = actor.reach(Permission::AppointmentsRead).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal_today::today(tx.conn(), start, end, date, weekday, reads, reach).await?;
        let appointments: Vec<AppointmentView> = rows
            .appointments
            .into_iter()
            .map(|row| AppointmentView::new(row, date))
            .collect();
        let tokens: Vec<TokenView> = rows
            .tokens
            .into_iter()
            .map(|row| TokenView::new(row, now, date))
            .collect();
        let rooms = rows.rooms;
        let shifts = rows.shifts;
        let leave = rows.leave;
        let team = rows
            .practitioners
            .into_iter()
            .filter(|practitioner| practitioner.active)
            .filter_map(|practitioner| {
                let mine: Vec<ShiftRow> = shifts
                    .iter()
                    .filter(|shift| shift.practitioner_id == practitioner.id)
                    .cloned()
                    .collect();
                if mine.is_empty() {
                    return None;
                }
                Some(TeamMember {
                    on_leave: leave
                        .iter()
                        .any(|block| block.practitioner_id == practitioner.id),
                    appointments: appointments
                        .iter()
                        .filter(|view| {
                            view.row.practitioner_id == practitioner.id
                                && view.row.status != AppointmentStatus::Cancelled.as_str()
                        })
                        .count(),
                    shifts: mine,
                    practitioner,
                })
            })
            .collect();
        let mut recent: Vec<TokenView> = tokens.clone();
        recent.sort_by_key(|token| std::cmp::Reverse(token.row.issued_at));
        recent.truncate(RECENT_PATIENTS);
        // Stock is what is on the shelf now, whatever day is shown.
        let low_stock = rows
            .stock
            .map(|stock| inventory::low_stock_of(stock, clinic_day));
        let completed_visits = rows
            .completed_visits
            .into_iter()
            .map(|row| CompletedVisit {
                billed: row.billed_paise.map(Paise::new),
                paid: row.paid_paise.map(Paise::new),
                row,
            })
            .collect();
        let money = rows.money.map(|money: DayMoneyRow| DayMoney {
            collected: Paise::new(money.collected_paise),
            payments: money.payments,
            invoiced: Paise::new(money.invoiced_paise),
            invoices: money.invoices,
        });
        Ok(Today {
            low_stock,
            date,
            as_of: now,
            counts: counts(&appointments, &tokens),
            by_hour: by_hour(&appointments, &actor.timezone),
            chairs: chairs(rooms, &appointments, day),
            attention: if day == Day::Today {
                attention(&appointments, &tokens, now)
            } else {
                Vec::new()
            },
            completed_visits,
            money,
            recent_patients: recent,
            team,
            appointments,
        })
    })
    .await
}

/// One clinic day's appointments by what became of them.
pub use dal_today::DayAppointments;

/// A month of appointments, a row for every day.
#[derive(Debug, Clone)]
pub struct MonthSummary {
    /// The first day of the month.
    pub month: Date,
    /// Every day of the month, in order, zeros when nothing is booked.
    pub days: Vec<DayAppointments>,
}

/// Appointments per day for the clinic month starting `month` (its first day), counted in the
/// clinic's time zone.
///
/// # Errors
/// [`AppError::Denied`] without `appointments.read`; [`AppError::Invalid`] for a month outside
/// 2000 to 2100.
pub async fn month_summary(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    month: Date,
) -> Result<MonthSummary, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let first = month.replace_day(1).unwrap_or(month);
    if !YEARS.contains(&first.year()) {
        return Err(AppError::invalid(
            "month",
            "must be a year from 2000 to 2100",
        ));
    }
    let length = i64::from(first.month().length(first.year()));
    let last = first + Duration::days(length - 1);
    let (start, _) = day_bounds(&actor.timezone, first);
    let (_, end) = day_bounds(&actor.timezone, last);
    let offset = clinic_offset(&actor.timezone).whole_seconds();
    let reach = actor.reach(Permission::AppointmentsRead).member();
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(dal_today::month_summary(tx.conn(), start, end, offset, reach).await?)
        })
        .await?;
    let days = (0..length)
        .map(|index| {
            let day = first + Duration::days(index);
            rows.iter()
                .find(|row| row.day == day)
                .copied()
                .unwrap_or(DayAppointments {
                    day,
                    booked: 0,
                    completed: 0,
                    cancelled: 0,
                    no_shows: 0,
                })
        })
        .collect();
    Ok(MonthSummary { month: first, days })
}
