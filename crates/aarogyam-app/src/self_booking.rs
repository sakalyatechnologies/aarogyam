//! Patients booking for themselves on the clinic's public page: the doctors they may pick, the
//! free slots, and the booking itself. The clinic comes from the host name and the person from
//! a verified email sign-in; neither has clinic access. Bookings go through the same checks as
//! staff booking (doctor active, slot inside working hours, no leave, no other appointment) in
//! one transaction, serialised per doctor, and the confirmation goes through the outbox.

use aarogyam_dal::appointments::{self as dal, Booking};
use aarogyam_dal::clinic::ClinicProfile;
use aarogyam_dal::{booking, clinic, patients, schedule, settings};
use aarogyam_domain::access::ClinicPlace;
use aarogyam_domain::booking::{
    Asked, BookingSettings, Commitments, MAX_OPEN_SELF_BOOKINGS, free_slots,
};
use aarogyam_domain::ids::{AppointmentId, ClinicId, PatientId, PractitionerId};
use aarogyam_domain::notification::NotificationKind;
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::patient::{Email, Language, NumberPrefix, PatientNumber, PersonName};
use aarogyam_domain::schedule::{AppointmentStatus, Shift};
use sakalya_db::{Db, ScopedTx};
use sakalya_types::PhoneE164;
use serde_json::{Value, json};
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::appointments::parse_reason;
use crate::clock::{clinic_offset, clinic_today, day_bounds};
use crate::error::AppError;
use crate::messaging::{PatientEmail, enqueue_patient_email};
use crate::patients::parse_phone;
use crate::schedule::resolve_branch;
use crate::scope::public_scope;

/// The message when a slot is gone.
pub const SLOT_TAKEN: &str = "that time is no longer available; choose another";

/// The message when a person already holds the most open bookings.
pub const TOO_MANY_OPEN: &str = "you already have the most upcoming booking requests this clinic allows; wait for one to be answered";

/// Reads the stored settings object, using the default for anything missing or invalid.
#[must_use]
pub fn read_settings(stored: &Value) -> BookingSettings {
    BookingSettings::from_stored(stored)
}

/// The settings as the stored object.
#[must_use]
pub fn settings_value(settings: &BookingSettings) -> Value {
    settings.to_stored()
}

/// A doctor patients may pick.
#[derive(Debug, Clone)]
pub struct BookableDoctor {
    /// The doctor.
    pub id: PractitionerId,
    /// Name as shown on the calendar.
    pub name: String,
    /// What they practise, if recorded.
    pub specialty: Option<String>,
}

/// What the public booking page needs to start.
#[derive(Debug, Clone)]
pub struct BookingOptions {
    /// The clinic's name.
    pub clinic_name: String,
    /// The clinic's time zone.
    pub timezone: String,
    /// Today in the clinic.
    pub today: Date,
    /// The booking settings.
    pub settings: BookingSettings,
    /// Active doctors with working hours (none when booking is off).
    pub doctors: Vec<BookableDoctor>,
}

/// The clinic's name, settings and bookable doctors. Public: no patient data.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn options(
    db: &Db,
    clinic: &ClinicPlace,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<BookingOptions, AppError> {
    db.scoped(&public_scope(clinic.id, request_id), async |tx| {
        let page = booking::page(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let settings = read_settings(&page.booking);
        let doctors = if settings.enabled {
            page.doctors
                .into_iter()
                .map(|row| BookableDoctor {
                    id: PractitionerId::from_uuid(row.id),
                    name: row.display_name,
                    specialty: row.specialty,
                })
                .collect()
        } else {
            Vec::new()
        };
        Ok(BookingOptions {
            today: clinic_today(&clinic.timezone, now),
            clinic_name: page.clinic_name,
            timezone: clinic.timezone.clone(),
            settings,
            doctors,
        })
    })
    .await
}

/// Free slots for one doctor on one local day, computed inside the caller's transaction.
async fn slots_on(
    tx: &mut ScopedTx,
    profile: &ClinicProfile,
    settings: &BookingSettings,
    practitioner_id: Uuid,
    day: Date,
    now: OffsetDateTime,
) -> Result<Vec<OffsetDateTime>, AppError> {
    let offset = clinic_offset(&profile.timezone);
    let shifts: Vec<Shift> = schedule::shifts(tx.conn(), Some(practitioner_id), None)
        .await?
        .iter()
        .filter_map(shift_of)
        .collect();
    let (start, end) = day_bounds(&profile.timezone, day);
    // A day either side, so a buffer or an appointment across midnight is seen.
    let (from, to) = (start - Duration::DAY, end + Duration::DAY);
    let busy = dal::busy_spans(tx.conn(), practitioner_id, from, to).await?;
    let leave = dal::leave_spans(tx.conn(), practitioner_id, from, to).await?;
    Ok(free_slots(
        Asked {
            day,
            today: clinic_today(&profile.timezone, now),
            offset,
            now,
        },
        Commitments {
            shifts: &shifts,
            busy: &busy,
            leave: &leave,
        },
        settings,
    ))
}

/// A bookable doctor, or the same error for an unknown, inactive or hourless one.
async fn bookable(
    tx: &mut ScopedTx,
    id: PractitionerId,
) -> Result<schedule::PractitionerRow, AppError> {
    schedule::practitioner(tx.conn(), id.uuid())
        .await?
        .filter(|doctor| doctor.active)
        .ok_or(AppError::invalid("practitioner_id", "no such doctor"))
}

/// A doctor's free slots on a local day.
#[derive(Debug, Clone)]
pub struct Availability {
    /// The clinic's slot length.
    pub slot_minutes: u16,
    /// Slot starts, in the clinic's offset.
    pub slots: Vec<OffsetDateTime>,
}

/// The free slots of a doctor on a local day, in the clinic's offset.
///
/// # Errors
/// [`AppError::NotFound`] when online booking is off; [`AppError::Invalid`] for an unknown
/// doctor; [`AppError::Db`] on database failures.
pub async fn availability(
    db: &Db,
    clinic: &ClinicPlace,
    request_id: Option<Uuid>,
    practitioner_id: PractitionerId,
    day: Date,
    now: OffsetDateTime,
) -> Result<Availability, AppError> {
    let (start, end) = day_bounds(&clinic.timezone, day);
    // A day either side, so a buffer or an appointment across midnight is seen.
    let (from, to) = (start - Duration::DAY, end + Duration::DAY);
    let found = db
        .scoped(&public_scope(clinic.id, request_id), async |tx| {
            Ok::<_, AppError>(
                booking::doctor_day(tx.conn(), practitioner_id.uuid(), from, to).await?,
            )
        })
        .await?;
    let settings = read_settings(&found.booking);
    if !settings.enabled {
        return Err(AppError::NotFound("online booking"));
    }
    if found.doctor_active != Some(true) {
        return Err(AppError::invalid("practitioner_id", "no such doctor"));
    }
    let shifts: Vec<Shift> = found.shifts.iter().filter_map(shift_of).collect();
    let spans = |spans: Vec<booking::Span>| -> Vec<(OffsetDateTime, OffsetDateTime)> {
        spans
            .into_iter()
            .map(|span| (span.starts_at, span.ends_at))
            .collect()
    };
    let (busy, leave) = (spans(found.busy), spans(found.leave));
    let slots = free_slots(
        Asked {
            day,
            today: clinic_today(&clinic.timezone, now),
            offset: clinic_offset(&clinic.timezone),
            now,
        },
        Commitments {
            shifts: &shifts,
            busy: &busy,
            leave: &leave,
        },
        &settings,
    );
    Ok(Availability {
        slot_minutes: settings.slot_minutes,
        slots,
    })
}

fn shift_of(row: &schedule::ShiftRow) -> Option<Shift> {
    Some(Shift {
        weekday: u8::try_from(row.weekday).ok()?,
        starts: row.starts,
        ends: row.ends,
    })
}

/// A booking asked for online, by a person whose email was verified.
#[derive(Debug, Clone)]
pub struct OnlineBooking {
    /// The Supabase auth id of the verified person.
    pub account: Uuid,
    /// The verified email address.
    pub email: String,
    /// The doctor.
    pub practitioner_id: PractitionerId,
    /// The slot's start, one of the offered slots.
    pub starts_at: OffsetDateTime,
    /// The patient's name.
    pub full_name: String,
    /// The patient's phone; +91 is assumed without a country code.
    pub phone: String,
    /// Why they are coming, in a few words.
    pub reason: Option<String>,
}

/// What the patient is told after booking. It never says whether a record existed.
#[derive(Debug, Clone)]
pub struct BookedOnline {
    /// The appointment.
    pub id: AppointmentId,
    /// `requested` or `confirmed`.
    pub status: AppointmentStatus,
    /// Start, in the clinic's offset.
    pub starts_at: OffsetDateTime,
    /// End, in the clinic's offset.
    pub ends_at: OffsetDateTime,
    /// The doctor's name.
    pub doctor_name: String,
    /// The clinic's name.
    pub clinic_name: String,
}

fn when_text(at: OffsetDateTime) -> String {
    format!(
        "{} {} {}, {:02}:{:02}",
        at.day(),
        at.month(),
        at.year(),
        at.hour(),
        at.minute()
    )
}

/// Queues the patient's email about an online booking. Skipped when the clinic has no portal
/// host yet. The payload holds the clinic, doctor and time: no reason, no clinical data.
async fn email_patient(
    tx: &mut ScopedTx,
    kind: MessageKind,
    patient_id: Uuid,
    appointment_id: Uuid,
    clinic_name: &str,
    doctor_name: &str,
    starts_at: OffsetDateTime,
) -> Result<(), AppError> {
    let Some(host) = aarogyam_dal::staff::portal_host(tx.conn()).await? else {
        return Ok(());
    };
    enqueue_patient_email(
        tx,
        &PatientEmail {
            kind,
            patient_id: PatientId::from_uuid(patient_id),
            payload: json!({
                "appointment_id": appointment_id,
                "clinic_name": clinic_name,
                "doctor_name": doctor_name,
                "portal_host": host,
                "when": when_text(starts_at),
            }),
            secret: None,
            appointment_id: Some(appointment_id),
        },
    )
    .await?;
    Ok(())
}

/// The clinic's patient with this verified email (kind `follow_up`), or a new self-registered
/// one (kind `new`).
async fn patient_for(
    tx: &mut ScopedTx,
    profile: &ClinicProfile,
    email: &Email,
    name: &PersonName,
    phone: &PhoneE164,
) -> Result<(Uuid, &'static str), AppError> {
    if let Some(existing) = patients::find_by_email(tx.conn(), email.as_str()).await? {
        return Ok((existing.id, "follow_up"));
    }
    let prefix = NumberPrefix::parse(&profile.number_prefix).map_err(AppError::patient)?;
    let value = patients::next_number(tx.conn(), "patient").await?;
    let value = u64::try_from(value).map_err(|_| AppError::Internal("negative patient number"))?;
    let number = PatientNumber::new(&prefix, value);
    let row = patients::insert_self_registered(
        tx.conn(),
        &patients::NewPatientRow {
            id: PatientId::new_v7().uuid(),
            number: number.as_str(),
            full_name: name.as_str(),
            sex: "unknown",
            date_of_birth: None,
            birth_date_estimated: false,
            phone_e164: Some(phone.as_e164()),
            email: Some(email.as_str()),
            preferred_language: Language::english_india().as_str(),
        },
    )
    .await?;
    // Same phone, no email match: never merged here; the front desk resolves the flag.
    crate::duplicates::flag_by_phone(tx, row.id, phone).await?;
    Ok((row.id, "new"))
}

/// Books the slot for a verified person. The patient is the clinic's record with this verified
/// email, or a new one tagged self-registered; nothing else about an existing record is used or
/// changed, and nothing about it is returned.
///
/// # Errors
/// [`AppError::NotFound`] when online booking is off; [`AppError::Invalid`] for bad input or an
/// unknown doctor; [`AppError::Conflict`] when the slot is gone or the person holds too many
/// open bookings; [`AppError::Db`] on database failures.
pub async fn book(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    input: OnlineBooking,
    now: OffsetDateTime,
) -> Result<BookedOnline, AppError> {
    let email = Email::parse(&input.email).map_err(AppError::patient)?;
    let name = PersonName::parse(&input.full_name).map_err(AppError::patient)?;
    let phone = parse_phone(&input.phone)?.ok_or(AppError::invalid("phone", "is required"))?;
    let slot = Slot {
        account: input.account,
        practitioner_id: input.practitioner_id,
        starts_at: input.starts_at,
        reason: parse_reason(input.reason.as_deref())?,
    };
    book_slot(
        db,
        clinic_id,
        request_id,
        &slot,
        Who::Verified { email, name, phone },
        now,
    )
    .await
}

/// A slot asked for by a signed-in patient.
#[derive(Debug, Clone)]
pub struct Slot {
    /// The Supabase auth id of the person booking.
    pub account: Uuid,
    /// The doctor.
    pub practitioner_id: PractitionerId,
    /// The slot's start, one of the offered slots.
    pub starts_at: OffsetDateTime,
    /// Why they are coming, checked.
    pub reason: Option<String>,
}

/// Whose appointment it is.
enum Who {
    /// A verified email, matched to a record or registered.
    Verified {
        email: Email,
        name: PersonName,
        phone: PhoneE164,
    },
    /// The record a patient-app account is linked to.
    Linked(PatientId),
}

/// Books the slot for the record a patient-app account is linked to, through the same rules as
/// the public page (booking on, doctor bookable, slot free and offered, open bookings capped).
/// `slot.reason` is checked here. The confirmation goes to the email on the record, if any.
///
/// # Errors
/// As [`book`].
pub async fn book_linked(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    slot: Slot,
    now: OffsetDateTime,
) -> Result<BookedOnline, AppError> {
    let slot = Slot {
        reason: parse_reason(slot.reason.as_deref())?,
        ..slot
    };
    book_slot(
        db,
        clinic_id,
        request_id,
        &slot,
        Who::Linked(patient_id),
        now,
    )
    .await
}

/// The patient record a booking is for, the appointment kind, and where to email.
async fn whose(
    tx: &mut ScopedTx,
    profile: &ClinicProfile,
    who: Who,
) -> Result<(Uuid, &'static str, Option<Email>), AppError> {
    match who {
        Who::Verified { email, name, phone } => {
            let (id, kind) = patient_for(tx, profile, &email, &name, &phone).await?;
            Ok((id, kind, Some(email)))
        }
        Who::Linked(patient_id) => {
            let email = patients::get(tx.conn(), patient_id.uuid(), None)
                .await?
                .ok_or(AppError::NotFound("patient"))?
                .email
                .and_then(|text| Email::parse(&text).ok());
            Ok((patient_id.uuid(), "follow_up", email))
        }
    }
}

/// The booking's history entry, and the notification every member who handles this doctor's
/// appointments sees, in the booking's transaction.
async fn record_booked(
    tx: &mut ScopedTx,
    id: AppointmentId,
    auto_confirmed: bool,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    dal::insert_event(
        tx.conn(),
        &dal::NewEvent {
            appointment_id: id.uuid(),
            kind: "booked",
            from_status: None,
            to_status: None,
            changes: None,
            note: Some("online"),
            at: now,
        },
    )
    .await?;
    let kind = if auto_confirmed {
        NotificationKind::BookingConfirmedAuto
    } else {
        NotificationKind::BookingRequested
    };
    crate::notifications::notify(tx, kind, id).await?;
    Ok(())
}

async fn book_slot(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    input: &Slot,
    who: Who,
    now: OffsetDateTime,
) -> Result<BookedOnline, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let settings = read_settings(&settings::booking(tx.conn()).await?);
        if !settings.enabled {
            return Err(AppError::NotFound("online booking"));
        }
        let doctor = bookable(tx, input.practitioner_id).await?;
        // One booking at a time per doctor: the free-slot check and the insert can't interleave.
        dal::lock_doctor_bookings(tx.conn(), doctor.id).await?;
        if dal::open_self_bookings(tx.conn(), input.account, now).await? >= MAX_OPEN_SELF_BOOKINGS {
            return Err(AppError::Conflict(TOO_MANY_OPEN));
        }
        let offset = clinic_offset(&profile.timezone);
        let day = input.starts_at.to_offset(offset).date();
        let slots = slots_on(tx, &profile, &settings, doctor.id, day, now).await?;
        if !slots.contains(&input.starts_at) {
            return Err(AppError::Conflict(SLOT_TAKEN));
        }
        let starts_at = input.starts_at.to_offset(offset);
        let ends_at = starts_at + Duration::minutes(i64::from(settings.slot_minutes));

        let source = if matches!(who, Who::Linked(_)) {
            "app"
        } else {
            "website"
        };
        let (patient_id, kind, email) = whose(tx, &profile, who).await?;
        let status = if settings.auto_confirm {
            AppointmentStatus::Confirmed
        } else {
            AppointmentStatus::Requested
        };
        let id = AppointmentId::new_v7();
        let branch_id = resolve_branch(tx, None).await?;
        dal::insert_self_booked(
            tx.conn(),
            id.uuid(),
            patient_id,
            input.account,
            status.as_str(),
            source,
            &Booking {
                practitioner_id: doctor.id,
                branch_id,
                room_id: None,
                starts_at,
                ends_at,
                kind,
                reason: input.reason.as_deref(),
                notes: None,
            },
        )
        .await
        .map_err(|error| {
            AppError::on_constraint(error, "appointments_self_booking_slot", SLOT_TAKEN)
        })?;
        record_booked(tx, id, settings.auto_confirm, now).await?;
        let message = if settings.auto_confirm {
            MessageKind::BookingConfirmed
        } else {
            MessageKind::BookingRequested
        };
        if email.is_some() {
            email_patient(
                tx,
                message,
                patient_id,
                id.uuid(),
                &profile.name,
                &doctor.display_name,
                starts_at,
            )
            .await?;
        }
        Ok(BookedOnline {
            id,
            status,
            starts_at,
            ends_at,
            doctor_name: doctor.display_name,
            clinic_name: profile.name,
        })
    })
    .await
}

/// Tells a self-booking patient the front desk's answer: confirmed, or declined. Called in the
/// status-change transaction; skipped for other bookings and for patients without an email.
pub(crate) async fn notify_decision(
    tx: &mut ScopedTx,
    profile: &ClinicProfile,
    row: &dal::AppointmentRow,
    to: AppointmentStatus,
) -> Result<(), AppError> {
    let kind = match to {
        AppointmentStatus::Confirmed => MessageKind::BookingConfirmed,
        AppointmentStatus::Cancelled => MessageKind::BookingDeclined,
        _ => return Ok(()),
    };
    let has_email = patients::get(tx.conn(), row.patient_id, None)
        .await?
        .and_then(|patient| patient.email)
        .and_then(|text| Email::parse(&text).ok())
        .is_some();
    if !has_email {
        return Ok(());
    }
    email_patient(
        tx,
        kind,
        row.patient_id,
        row.id,
        &profile.name,
        &row.practitioner_name,
        row.starts_at.to_offset(clinic_offset(&profile.timezone)),
    )
    .await
}
