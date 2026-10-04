//! Today at the clinic: the day's schedule, chairs, counts, recent patients, who is working,
//! and what needs the front desk's attention. Money arrives with billing.

use std::collections::BTreeMap;

use aarogyam_dal::schedule::{PractitionerRow, RoomRow, ShiftRow};
use aarogyam_dal::{appointments, clinic, queue, schedule};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{
    AppointmentStatus, QueueStatus, is_late, minutes_between, waits_too_long,
};
use sakalya_db::Db;
use time::{Date, OffsetDateTime};
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
            AppointmentStatus::Booked | AppointmentStatus::Confirmed => counts.booked += 1,
            AppointmentStatus::Arrived => counts.arrived += 1,
            AppointmentStatus::InChair => counts.in_chair += 1,
            AppointmentStatus::Completed => counts.done += 1,
            AppointmentStatus::NoShow => counts.no_shows += 1,
            AppointmentStatus::Cancelled => counts.cancelled += 1,
        }
    }
    counts.waiting = tokens
        .iter()
        .filter(|token| token.row.status == QueueStatus::Waiting.as_str())
        .count();
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

fn chairs(rooms: Vec<RoomRow>, appointments: &[AppointmentView]) -> Vec<Chair> {
    rooms
        .into_iter()
        .filter(|room| room.active)
        .map(|room| {
            let in_room = |index: &usize| appointments[*index].row.room_id == Some(room.id);
            let indexes: Vec<usize> = (0..appointments.len()).filter(in_room).collect();
            let current = indexes
                .iter()
                .copied()
                .find(|index| status_of(&appointments[*index]) == Some(AppointmentStatus::InChair));
            let next = indexes.iter().copied().find(|index| {
                status_of(&appointments[*index]).is_some_and(|status| {
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

/// Builds Today for the caller's clinic.
///
/// # Errors
/// [`AppError::Denied`] without `appointments.read`; [`AppError::Db`] on failures.
pub async fn today(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Today, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let date = clinic_today(&profile.timezone, now);
        let (start, end) = day_bounds(&profile.timezone, date);
        let appointments: Vec<AppointmentView> =
            appointments::list(tx.conn(), start, end, None, None)
                .await?
                .into_iter()
                .map(|row| AppointmentView::new(row, date))
                .collect();
        let tokens: Vec<TokenView> = queue::list(tx.conn(), date, None)
            .await?
            .into_iter()
            .map(|row| TokenView::new(row, now, date))
            .collect();
        let rooms = schedule::rooms(tx.conn()).await?;
        let weekday = i16::from(date.weekday().number_from_monday());
        let shifts = schedule::shifts(tx.conn(), None, Some(weekday)).await?;
        let leave = schedule::leave(tx.conn(), None, start, end).await?;
        let team = schedule::practitioners(tx.conn())
            .await?
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
        let low_stock = if actor.permissions.allows(Permission::InventoryRead) {
            Some(inventory::low_stock_in(tx, date).await?)
        } else {
            None
        };
        Ok(Today {
            low_stock,
            date,
            as_of: now,
            counts: counts(&appointments, &tokens),
            by_hour: by_hour(&appointments, &profile.timezone),
            chairs: chairs(rooms, &appointments),
            attention: attention(&appointments, &tokens, now),
            recent_patients: recent,
            team,
            appointments,
        })
    })
    .await
}
