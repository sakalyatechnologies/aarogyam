//! Patients booking for themselves. Public: the clinic comes from the host name only, and
//! nothing here returns patient data. Reading the doctors and free slots needs no sign-in;
//! booking needs a sign-in whose email was verified with a code (Supabase), which is a person
//! with no clinic membership and no staff access. Throttled per IP, and per verified person.

use aarogyam_app::self_booking::{self as app, OnlineBooking};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PractitionerId;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_day, parse_id, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::{ClinicHost, SignedIn};
use crate::failure::ApiFailure;

/// A doctor patients may pick.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookableDoctor {
    /// The doctor.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name shown to patients.
    pub name: String,
    /// What they practise.
    pub specialty: Option<String>,
}

/// What the booking page needs to start.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingOptions {
    /// The clinic's name.
    pub clinic_name: String,
    /// The clinic's time zone.
    pub timezone: String,
    /// Today in the clinic, `YYYY-MM-DD`.
    pub today: String,
    /// Whether online booking is on; when off there are no doctors.
    pub enabled: bool,
    /// Slot length in minutes.
    pub slot_minutes: u16,
    /// Whether a booking is confirmed at once; otherwise the front desk confirms.
    pub auto_confirm: bool,
    /// How many days ahead patients may book, counting today.
    pub horizon_days: u16,
    /// Doctors with working hours.
    pub doctors: Vec<BookableDoctor>,
}

/// Public, no sign-in: the clinic's name, booking settings and bookable doctors.
#[utoipa::path(
    get,
    path = "/api/v1/public/booking",
    tag = "public",
    responses(
        (status = 200, body = BookingOptions),
        (status = 404, description = "Not a clinic"),
        (status = 429, description = "Too many requests from this address")
    )
)]
pub(crate) async fn booking_options(
    State(state): State<AppState>,
    public: ClinicHost,
) -> Result<Json<BookingOptions>, ApiFailure> {
    let found = app::options(
        state.db(),
        public.clinic_id,
        public.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(BookingOptions {
        clinic_name: found.clinic_name,
        timezone: found.timezone,
        today: found.today.to_string(),
        enabled: found.settings.enabled,
        slot_minutes: found.settings.slot_minutes,
        auto_confirm: found.settings.auto_confirm,
        horizon_days: found.settings.horizon_days,
        doctors: found
            .doctors
            .into_iter()
            .map(|doctor| BookableDoctor {
                id: doctor.id.uuid(),
                name: doctor.name,
                specialty: doctor.specialty,
            })
            .collect(),
    }))
}

/// Which day and doctor.
#[derive(Debug, Deserialize)]
pub struct AvailabilityQuery {
    /// The local day, `YYYY-MM-DD`.
    pub date: String,
    /// The doctor.
    pub practitioner_id: String,
}

/// Free slots.
#[derive(Debug, Serialize, ToSchema)]
pub struct Availability {
    /// The local day, `YYYY-MM-DD`.
    pub date: String,
    /// The doctor.
    #[schema(value_type = String)]
    pub practitioner_id: Uuid,
    /// Slot length in minutes.
    pub slot_minutes: u16,
    /// Start of each free slot, RFC 3339 in the clinic's time zone.
    pub slots: Vec<String>,
}

/// Public, no sign-in: a doctor's free slots on a local day, from working hours minus leave
/// minus active appointments, in the clinic's time zone. No patient data.
#[utoipa::path(
    get,
    path = "/api/v1/public/availability",
    tag = "public",
    params(
        ("date" = String, Query, description = "The local day, `YYYY-MM-DD`"),
        ("practitioner_id" = String, Query, description = "The doctor")
    ),
    responses(
        (status = 200, body = Availability),
        (status = 400, description = "Bad date, or no such doctor"),
        (status = 404, description = "Not a clinic, or online booking is off"),
        (status = 429, description = "Too many requests from this address")
    )
)]
pub(crate) async fn free_slots(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiQuery(query): ApiQuery<AvailabilityQuery>,
) -> Result<Json<Availability>, ApiFailure> {
    let day = parse_day("date", &query.date)?;
    let doctor = parse_id("practitioner_id", &query.practitioner_id)?;
    let now = OffsetDateTime::now_utc();
    let slots = app::availability(
        state.db(),
        public.clinic_id,
        public.request_id,
        PractitionerId::from_uuid(doctor),
        day,
        now,
    )
    .await?;
    // The slot length is the clinic's setting; the options call already tells the page, but a
    // caller of this one alone shouldn't have to guess.
    let slot_minutes = app::options(state.db(), public.clinic_id, public.request_id, now)
        .await?
        .settings
        .slot_minutes;
    Ok(Json(Availability {
        date: day.to_string(),
        practitioner_id: doctor,
        slot_minutes,
        slots: slots.into_iter().map(rfc3339).collect(),
    }))
}

/// A booking.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewBooking {
    /// The slot's start, exactly as offered (RFC 3339).
    pub starts_at: String,
    /// The doctor.
    pub practitioner_id: String,
    /// The patient's full name.
    pub full_name: String,
    /// The patient's phone; +91 is assumed without a country code.
    pub phone: String,
    /// Why they are coming, in a few words.
    pub reason: Option<String>,
}

/// The same answer whether or not the clinic knew the person.
#[derive(Debug, Serialize, ToSchema)]
pub struct Booked {
    /// The appointment.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `requested` (the front desk will confirm) or `confirmed`.
    pub status: String,
    /// Start, RFC 3339 in the clinic's time zone.
    pub starts_at: String,
    /// End, RFC 3339 in the clinic's time zone.
    pub ends_at: String,
    /// The doctor's name.
    pub doctor_name: String,
    /// The clinic's name.
    pub clinic_name: String,
}

/// Books a slot. The caller is signed in with a verified email (a one-time code from
/// Supabase) and need not belong to the clinic. The appointment is `requested`, or `confirmed`
/// when the clinic auto-confirms. Never says whether a patient record already existed.
#[utoipa::path(
    post,
    path = "/api/v1/public/bookings",
    tag = "public",
    request_body = NewBooking,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Booked),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The sign-in has no verified email address"),
        (status = 404, description = "Not a clinic, or online booking is off"),
        (status = 409, description = "The slot is gone, or the person has too many open bookings"),
        (status = 429, description = "Too many requests")
    )
)]
pub(crate) async fn book_online(
    State(state): State<AppState>,
    public: ClinicHost,
    signed_in: SignedIn,
    ApiJson(body): ApiJson<NewBooking>,
) -> Response {
    // Per verified person, before any database work; the answer keeps its Retry-After.
    if let Some(throttle) = state.throttle() {
        let person = signed_in.claims.subject().uuid().to_string();
        if let Err(error) = throttle.check("public-booking-identity", &person).await {
            return error.into_response();
        }
    }
    match book(&state, &public, &signed_in, body).await {
        Ok(booked) => (StatusCode::CREATED, Json(booked)).into_response(),
        Err(failure) => failure.into_response(),
    }
}

async fn book(
    state: &AppState,
    public: &ClinicHost,
    signed_in: &SignedIn,
    body: NewBooking,
) -> Result<Booked, ApiFailure> {
    let email = signed_in.claims.email().ok_or_else(|| {
        ApiFailure(ApiError::forbidden(
            "email_required",
            "Verify your email address to book.",
        ))
    })?;
    let starts_at = parse_instant("starts_at", &body.starts_at)?;
    let practitioner = parse_id("practitioner_id", &body.practitioner_id)?;
    let booked = app::book(
        state.db(),
        public.clinic_id,
        public.request_id,
        OnlineBooking {
            account: signed_in.claims.subject().uuid(),
            email: email.to_owned(),
            practitioner_id: PractitionerId::from_uuid(practitioner),
            starts_at,
            full_name: body.full_name,
            phone: body.phone,
            reason: body.reason,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::AppointmentBooked.as_str(),
        appointment_id = %booked.id.uuid(),
        source = "website",
        "appointment booked online"
    );
    Ok(Booked {
        id: booked.id.uuid(),
        status: booked.status.as_str().to_owned(),
        starts_at: rfc3339(booked.starts_at),
        ends_at: rfc3339(booked.ends_at),
        doctor_name: booked.doctor_name,
        clinic_name: booked.clinic_name,
    })
}
