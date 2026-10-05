//! Today at the clinic, for the dashboard.

use aarogyam_app::today::{self as app, Attention, AttentionKind, TeamMember};
use aarogyam_domain::permission::require::AppointmentsRead;
use axum::Json;
use axum::extract::State;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::appointments::{Appointment, PatientBrief, PractitionerBrief};
use super::queue::QueueToken;
use super::{clock, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The day's numbers.
#[derive(Debug, Serialize, ToSchema)]
pub struct TodayCounts {
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
#[derive(Debug, Serialize, ToSchema)]
pub struct HourBar {
    /// Local hour, 0 to 23.
    pub hour: u8,
    /// Appointments, not counting cancelled ones.
    pub booked: usize,
    /// Of those, completed.
    pub completed: usize,
}

/// An appointment as a chair tile shows it.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChairAppointment {
    /// The appointment.
    #[schema(value_type = String)]
    pub appointment_id: Uuid,
    /// Start (RFC 3339).
    pub starts_at: String,
    /// End (RFC 3339).
    pub ends_at: String,
    /// Its status.
    pub status: String,
    /// The patient.
    pub patient: PatientBrief,
    /// The doctor.
    pub practitioner: PractitionerBrief,
}

/// A chair right now.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChairStatus {
    /// The room.
    #[schema(value_type = String)]
    pub room_id: Uuid,
    /// Its name.
    pub name: String,
    /// `chair`, `room` or `lab`.
    pub kind: String,
    /// `in_use` while a patient is in it, otherwise `free`.
    pub status: String,
    /// Who is in it.
    pub current: Option<ChairAppointment>,
    /// Who is next today.
    pub next: Option<ChairAppointment>,
}

/// A shift today, local time.
#[derive(Debug, Serialize, ToSchema)]
pub struct TodayShift {
    /// Start, `HH:MM`.
    pub starts: String,
    /// End, `HH:MM`.
    pub ends: String,
}

/// A doctor working today.
#[derive(Debug, Serialize, ToSchema)]
pub struct TeamMemberToday {
    /// The doctor.
    pub practitioner: PractitionerBrief,
    /// Specialty.
    pub specialty: Option<String>,
    /// Today's shifts.
    pub shifts: Vec<TodayShift>,
    /// Whether they have leave today.
    pub on_leave: bool,
    /// Appointments today, not counting cancelled ones.
    pub appointments: usize,
}

/// Something the front desk should look at.
#[derive(Debug, Serialize, ToSchema)]
pub struct AttentionItem {
    /// `late_arrival` (not arrived 15 minutes after the start) or `long_wait` (waiting over 30
    /// minutes).
    pub kind: String,
    /// What to show, without patient details.
    pub message: String,
    /// Minutes late, or minutes waited.
    pub minutes: i64,
    /// The appointment, if any.
    #[schema(value_type = Option<String>)]
    pub appointment_id: Option<Uuid>,
    /// The queue token, if any.
    #[schema(value_type = Option<String>)]
    pub queue_token_id: Option<Uuid>,
    /// The patient.
    pub patient: AttentionPatient,
}

/// The patient an attention item is about.
#[derive(Debug, Serialize, ToSchema)]
pub struct AttentionPatient {
    /// The patient.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Readable number.
    pub number: String,
    /// Full name.
    pub full_name: String,
}

/// An item at or below its reorder level, for the front desk's attention list.
#[derive(Debug, Serialize, ToSchema)]
pub struct LowStockAlert {
    /// The item.
    #[schema(value_type = String)]
    pub item_id: Uuid,
    /// Its name.
    pub name: String,
    /// Its unit.
    pub unit: String,
    /// Units on hand.
    pub on_hand: i64,
    /// The reorder level.
    pub reorder_level: i64,
    /// `low`, or `critical` when out or at a fifth of the reorder level or less.
    pub status: String,
}

/// Today at the clinic. Money tiles arrive with billing.
#[derive(Debug, Serialize, ToSchema)]
pub struct TodayResponse {
    /// The clinic's local date, `YYYY-MM-DD`.
    pub date: String,
    /// When this was built (RFC 3339); waits are measured from here.
    pub as_of: String,
    /// Today's appointments by start, cancelled ones included.
    pub appointments: Vec<Appointment>,
    /// The day's numbers.
    pub counts: TodayCounts,
    /// Appointments per local hour, for hours that have any.
    pub by_hour: Vec<HourBar>,
    /// Each active chair: who is in it and who is next.
    pub chairs: Vec<ChairStatus>,
    /// The latest patients through the queue today, newest first.
    pub recent_patients: Vec<QueueToken>,
    /// Doctors with working hours today.
    pub team: Vec<TeamMemberToday>,
    /// Late arrivals and long waits, longest first.
    pub attention: Vec<AttentionItem>,
    /// Stock at or below its reorder level, worst first. Present only for roles with
    /// `inventory.read`.
    pub low_stock: Option<Vec<LowStockAlert>>,
}

impl From<TeamMember> for TeamMemberToday {
    fn from(member: TeamMember) -> Self {
        Self {
            practitioner: PractitionerBrief {
                id: member.practitioner.id,
                display_name: member.practitioner.display_name,
                calendar_color: Some(member.practitioner.calendar_color),
            },
            specialty: member.practitioner.specialty,
            shifts: member
                .shifts
                .into_iter()
                .map(|shift| TodayShift {
                    starts: clock(shift.starts),
                    ends: clock(shift.ends),
                })
                .collect(),
            on_leave: member.on_leave,
            appointments: member.appointments,
        }
    }
}

impl From<Attention> for AttentionItem {
    fn from(item: Attention) -> Self {
        Self {
            kind: item.kind.code().to_owned(),
            message: match item.kind {
                AttentionKind::LateArrival => {
                    format!("Not arrived {} minutes after the start", item.minutes)
                }
                AttentionKind::LongWait => format!("Waiting for {} minutes", item.minutes),
            },
            minutes: item.minutes,
            appointment_id: item.appointment_id,
            queue_token_id: item.token_id,
            patient: AttentionPatient {
                id: item.patient_id,
                number: item.patient_number,
                full_name: item.patient_name,
            },
        }
    }
}

fn chair_appointment(appointment: &Appointment) -> ChairAppointment {
    ChairAppointment {
        appointment_id: appointment.id,
        starts_at: appointment.starts_at.clone(),
        ends_at: appointment.ends_at.clone(),
        status: appointment.status.clone(),
        patient: PatientBrief {
            id: appointment.patient.id,
            number: appointment.patient.number.clone(),
            full_name: appointment.patient.full_name.clone(),
            sex: appointment.patient.sex.clone(),
            age_years: appointment.patient.age_years,
        },
        practitioner: PractitionerBrief {
            id: appointment.practitioner.id,
            display_name: appointment.practitioner.display_name.clone(),
            calendar_color: appointment.practitioner.calendar_color.clone(),
        },
    }
}

/// Today's schedule, chairs, counts, appointments by hour, recent patients, the team on duty
/// and the attention list, in the clinic's time zone.
#[utoipa::path(
    get,
    path = "/api/v1/today",
    operation_id = "getToday",
    tag = "appointments",
    security(("bearer" = [])),
    responses(
        (status = 200, body = TodayResponse),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn today(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
) -> Result<Json<TodayResponse>, ApiFailure> {
    let today = app::today(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    let appointments: Vec<Appointment> = today
        .appointments
        .into_iter()
        .map(Appointment::from)
        .collect();
    let chairs = today
        .chairs
        .into_iter()
        .map(|chair| ChairStatus {
            room_id: chair.room.id,
            name: chair.room.name,
            kind: chair.room.kind,
            status: if chair.current.is_some() {
                "in_use"
            } else {
                "free"
            }
            .to_owned(),
            current: chair
                .current
                .map(|index| chair_appointment(&appointments[index])),
            next: chair
                .next
                .map(|index| chair_appointment(&appointments[index])),
        })
        .collect();
    let counts = today.counts;
    Ok(Json(TodayResponse {
        date: today.date.to_string(),
        as_of: rfc3339(today.as_of),
        counts: TodayCounts {
            total: counts.total,
            booked: counts.booked,
            arrived: counts.arrived,
            in_chair: counts.in_chair,
            done: counts.done,
            no_shows: counts.no_shows,
            cancelled: counts.cancelled,
            waiting: counts.waiting,
        },
        by_hour: today
            .by_hour
            .into_iter()
            .map(|bar| HourBar {
                hour: bar.hour,
                booked: bar.booked,
                completed: bar.completed,
            })
            .collect(),
        chairs,
        recent_patients: today
            .recent_patients
            .into_iter()
            .map(QueueToken::from)
            .collect(),
        team: today.team.into_iter().map(TeamMemberToday::from).collect(),
        low_stock: today.low_stock.map(|items| {
            items
                .into_iter()
                .map(|stock| LowStockAlert {
                    item_id: stock.item.id.uuid(),
                    name: stock.item.name,
                    unit: stock.item.unit.as_str().to_owned(),
                    on_hand: stock.on_hand,
                    reorder_level: stock.item.reorder_level,
                    status: stock.status.as_str().to_owned(),
                })
                .collect()
        }),
        attention: today
            .attention
            .into_iter()
            .map(AttentionItem::from)
            .collect(),
        appointments,
    }))
}
