//! The patient app's routes, under `/api/v1/me/patient`. Their permission model is the
//! patient's own: a signed-in patient account ([`PatientRequest`] on the app host) reads only
//! its linked records, at the clinics that linked it, across all of them at once; a booking,
//! a cancellation or a file goes to the clinic's own host ([`PatientAtClinic`]), which must
//! have linked the account. Row-level security enforces the same (migration 0261), and every
//! read is written to the access record. `tests/patient_app.rs` covers other patients and
//! other clinics.

use aarogyam_app::patient_app::{self as app, LinkedClinic, PatientAccess};
use aarogyam_app::self_booking::{self as booking, Slot};
use aarogyam_dal::patient_app as rows;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AppointmentId, AttachmentId, PatientLinkId, PractitionerId};
use aarogyam_domain::patient_app::RedeemOutcome;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, UtcOffset};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_id, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::{PatientAtClinic, PatientRequest};
use crate::failure::ApiFailure;

fn offset(clinic: &LinkedClinic) -> UtcOffset {
    aarogyam_app::clock::clinic_offset(&clinic.place.timezone)
}

fn at(clinic: &LinkedClinic, when: OffsetDateTime) -> String {
    rfc3339(when.to_offset(offset(clinic)))
}

/// A clinic that linked the patient.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientClinic {
    /// The link.
    #[schema(value_type = String)]
    pub link_id: Uuid,
    /// The clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// Its portal host: bookings, cancellations and files go there.
    pub host: Option<String>,
    /// IANA time zone; times from this clinic are in it.
    pub timezone: String,
    /// Branding (brand colour, theme mode).
    #[schema(value_type = Object)]
    pub branding: serde_json::Value,
    /// The patient's number at this clinic, such as `SD-1042`.
    pub patient_number: String,
    /// When the clinic linked the patient (RFC 3339).
    pub linked_at: String,
}

fn clinic_view(clinic: &LinkedClinic) -> PatientClinic {
    PatientClinic {
        link_id: clinic.link_id.uuid(),
        clinic_id: clinic.place.id.uuid(),
        slug: clinic.slug.clone(),
        name: clinic.name.clone(),
        host: clinic.host.clone(),
        timezone: clinic.place.timezone.clone(),
        branding: clinic.branding.clone(),
        patient_number: clinic.patient_number.clone(),
        linked_at: at(clinic, clinic.linked_at),
    }
}

/// The signed-in patient and the clinics that linked them.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientMe {
    /// The verified email they signed in with.
    pub email: String,
    /// Linked clinics, by name.
    pub clinics: Vec<PatientClinic>,
}

/// The signed-in patient's account and linked clinics. The account is made on the first call.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient",
    operation_id = "getMyPatientAccount",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientMe),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The sign-in has no verified email"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn me(request: PatientRequest) -> Json<PatientMe> {
    Json(PatientMe {
        email: request.access.email.clone(),
        clinics: request.access.clinics.iter().map(clinic_view).collect(),
    })
}

/// One of the patient's appointments.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientAppointment {
    /// The appointment.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// Start, RFC 3339 in the clinic's time zone.
    pub starts_at: String,
    /// End, RFC 3339 in the clinic's time zone.
    pub ends_at: String,
    /// `requested`, `booked`, `confirmed`, `arrived`, `in_chair`, `completed`, `cancelled` or
    /// `no_show`.
    pub status: String,
    /// Why they are coming.
    pub reason: Option<String>,
    /// The doctor.
    #[schema(value_type = String)]
    pub practitioner_id: Uuid,
    /// The doctor's name.
    pub doctor_name: String,
    /// What the doctor practises.
    pub specialty: Option<String>,
    /// Whether the app offers Cancel (the clinic's notice still applies when it is sent).
    pub can_cancel: bool,
}

fn appointment_view(
    clinic: &LinkedClinic,
    row: rows::AppointmentRow,
    now: OffsetDateTime,
) -> PatientAppointment {
    let can_cancel =
        matches!(row.status.as_str(), "requested" | "booked" | "confirmed") && row.starts_at > now;
    PatientAppointment {
        id: row.id,
        clinic_id: clinic.place.id.uuid(),
        starts_at: at(clinic, row.starts_at),
        ends_at: at(clinic, row.ends_at),
        status: row.status,
        reason: row.reason,
        practitioner_id: row.practitioner_id,
        doctor_name: row.doctor_name,
        specialty: row.specialty,
        can_cancel,
    }
}

/// The home screen for one clinic.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientClinicSummary {
    /// The clinic.
    pub clinic: PatientClinic,
    /// The next appointment that isn't cancelled or over.
    pub next_appointment: Option<PatientAppointment>,
    /// Owed on issued bills, in paise.
    pub balance_paise: i64,
    /// Issued prescriptions.
    pub prescriptions: i64,
    /// The newest prescription's date (RFC 3339).
    pub last_prescription_at: Option<String>,
}

/// Everything the home screen needs, in one request.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientHome {
    /// The verified email they signed in with.
    pub email: String,
    /// The soonest upcoming appointment at any clinic.
    pub next_appointment: Option<PatientAppointment>,
    /// Owed across clinics, in paise.
    pub balance_paise: i64,
    /// Each linked clinic, by name.
    pub clinics: Vec<PatientClinicSummary>,
}

#[derive(Deserialize)]
struct SummaryAppointment {
    id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    ends_at: OffsetDateTime,
    status: String,
    reason: Option<String>,
    practitioner_id: Uuid,
    doctor_name: String,
    specialty: Option<String>,
}

/// The home screen: the next appointment, balances and prescriptions at every linked clinic.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/home",
    operation_id = "getMyPatientHome",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientHome),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn home(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<PatientHome>, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    let access = &request.access;
    let summaries = app::home(state.db(), access, request.request_id, now).await?;
    let mut clinics = Vec::with_capacity(summaries.len());
    for (clinic, summary) in access.clinics.iter().zip(summaries) {
        let next = summary
            .next_appointment
            .map(serde_json::from_value::<SummaryAppointment>)
            .transpose()
            .map_err(|_| ApiError::internal("unreadable appointment summary"))?
            .map(|next| {
                appointment_view(
                    clinic,
                    rows::AppointmentRow {
                        id: next.id,
                        starts_at: next.starts_at,
                        ends_at: next.ends_at,
                        status: next.status,
                        reason: next.reason,
                        practitioner_id: next.practitioner_id,
                        doctor_name: next.doctor_name,
                        specialty: next.specialty,
                    },
                    now,
                )
            });
        clinics.push((
            next.as_ref().map(|next| next.starts_at.clone()),
            PatientClinicSummary {
                clinic: clinic_view(clinic),
                next_appointment: next,
                balance_paise: summary.balance_paise,
                prescriptions: summary.prescriptions,
                last_prescription_at: summary.last_prescription_at.map(|when| at(clinic, when)),
            },
        ));
    }
    // The soonest across clinics; RFC 3339 with offsets compares by parsing, not text.
    let next_appointment = clinics
        .iter()
        .filter_map(|(starts, summary)| {
            let starts = OffsetDateTime::parse(
                starts.as_deref()?,
                &time::format_description::well_known::Rfc3339,
            )
            .ok()?;
            Some((starts, summary.next_appointment.as_ref()?))
        })
        .min_by_key(|(starts, _)| *starts)
        .map(|(_, next)| PatientAppointment {
            id: next.id,
            clinic_id: next.clinic_id,
            starts_at: next.starts_at.clone(),
            ends_at: next.ends_at.clone(),
            status: next.status.clone(),
            reason: next.reason.clone(),
            practitioner_id: next.practitioner_id,
            doctor_name: next.doctor_name.clone(),
            specialty: next.specialty.clone(),
            can_cancel: next.can_cancel,
        });
    let clinics: Vec<PatientClinicSummary> =
        clinics.into_iter().map(|(_, summary)| summary).collect();
    Ok(Json(PatientHome {
        email: access.email.clone(),
        next_appointment,
        balance_paise: clinics.iter().map(|clinic| clinic.balance_paise).sum(),
        clinics,
    }))
}

/// The patient's appointments.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientAppointments {
    /// Not over yet, soonest first.
    pub upcoming: Vec<PatientAppointment>,
    /// Over, newest first.
    pub past: Vec<PatientAppointment>,
}

/// The patient's upcoming and past appointments at every linked clinic.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/appointments",
    operation_id = "listMyAppointments",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientAppointments),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn appointments(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<PatientAppointments>, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    let access = &request.access;
    let found = app::appointments(state.db(), access, request.request_id).await?;
    let (mut upcoming, mut past): (Vec<_>, Vec<_>) = found
        .into_iter()
        .map(|(index, row)| {
            (
                row.starts_at,
                row.ends_at > now && row.status != "cancelled",
                index,
                row,
            )
        })
        .partition(|(_, open, _, _)| *open);
    upcoming.sort_by_key(|(starts, ..)| *starts);
    past.sort_by_key(|(starts, ..)| std::cmp::Reverse(*starts));
    let view = |items: Vec<(OffsetDateTime, bool, usize, rows::AppointmentRow)>| {
        items
            .into_iter()
            .map(|(_, _, index, row)| appointment_view(&access.clinics[index], row, now))
            .collect()
    };
    Ok(Json(PatientAppointments {
        upcoming: view(upcoming),
        past: view(past),
    }))
}

/// A medicine on a prescription.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PatientRxItem {
    /// The medicine as printed.
    pub drug_name: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// Form, such as `tablet`.
    pub form: Option<String>,
    /// How much at a time.
    pub dose: String,
    /// How often, such as `1-0-1`.
    pub frequency: String,
    /// `before_food`, `after_food`, `empty_stomach`, `bedtime`, `sos` or `as_directed`.
    pub timing: Option<String>,
    /// For how many days.
    pub duration_days: Option<i32>,
    /// Anything else the doctor wrote.
    pub instructions: Option<String>,
}

/// One of the patient's issued prescriptions.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientPrescription {
    /// The prescription.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// `RX-…`.
    pub number: String,
    /// When it was issued (RFC 3339, the clinic's time zone).
    pub issued_at: String,
    /// The doctor's name as printed.
    pub doctor_name: Option<String>,
    /// The diagnosis as printed.
    pub diagnosis: Option<String>,
    /// Advice as printed.
    pub advice: Option<String>,
    /// The follow-up date, `YYYY-MM-DD`.
    pub follow_up_on: Option<String>,
    /// The public page that verifies it (its QR code), on the clinic's host.
    pub verify_url: Option<String>,
    /// The medicines, in order.
    pub items: Vec<PatientRxItem>,
}

/// The patient's issued prescriptions.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientPrescriptions {
    /// Newest first.
    pub items: Vec<PatientPrescription>,
}

/// The patient's issued prescriptions at every linked clinic (drafts and cancelled ones are
/// never shown), each with the link to its public verify page.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/prescriptions",
    operation_id = "listMyPrescriptions",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientPrescriptions),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn prescriptions(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<PatientPrescriptions>, ApiFailure> {
    let access = &request.access;
    let found = app::prescriptions(state.db(), access, request.request_id).await?;
    let portal = state.notifier().links();
    let mut items = found
        .into_iter()
        .map(|(index, row)| {
            let clinic = &access.clinics[index];
            let medicines: Vec<PatientRxItem> = serde_json::from_value(row.items)
                .map_err(|_| ApiError::internal("unreadable prescription lines"))?;
            Ok::<_, ApiError>((
                row.issued_at,
                PatientPrescription {
                    id: row.id,
                    clinic_id: clinic.place.id.uuid(),
                    number: row.number,
                    issued_at: at(clinic, row.issued_at),
                    doctor_name: row
                        .doctor
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned),
                    diagnosis: row.diagnosis_text,
                    advice: row.advice,
                    follow_up_on: row.follow_up_on.map(|day| day.to_string()),
                    verify_url: clinic
                        .host
                        .as_deref()
                        .map(|host| portal.verify(host, &row.verify_token)),
                    items: medicines,
                },
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    items.sort_by_key(|(issued, _)| std::cmp::Reverse(*issued));
    Ok(Json(PatientPrescriptions {
        items: items.into_iter().map(|(_, item)| item).collect(),
    }))
}

/// A line on a bill.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PatientBillLine {
    /// What it was for.
    pub description: String,
    /// How many.
    pub quantity: i32,
    /// The line's total, in paise.
    pub total_paise: i64,
}

/// One of the patient's issued bills.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientBill {
    /// The bill.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// The bill number.
    pub number: String,
    /// When it was issued (RFC 3339, the clinic's time zone).
    pub issued_at: String,
    /// Total, in paise.
    pub total_paise: i64,
    /// Paid against it, in paise.
    pub paid_paise: i64,
    /// Still owed, in paise.
    pub balance_paise: i64,
    /// The lines, in order.
    pub items: Vec<PatientBillLine>,
}

/// What the patient owes one clinic.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientBalance {
    /// The clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// Owed on issued bills, in paise.
    pub balance_paise: i64,
}

/// The patient's bills and balances.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientBills {
    /// Issued bills, newest first.
    pub items: Vec<PatientBill>,
    /// What is owed to each linked clinic.
    pub balances: Vec<PatientBalance>,
    /// Owed across clinics, in paise.
    pub balance_paise: i64,
}

/// The patient's issued bills and what they owe each linked clinic (read only).
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/bills",
    operation_id = "listMyBills",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientBills),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn bills(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<PatientBills>, ApiFailure> {
    let access = &request.access;
    let found = app::bills(state.db(), access, request.request_id).await?;
    let mut balances: Vec<PatientBalance> = access
        .clinics
        .iter()
        .map(|clinic| PatientBalance {
            clinic_id: clinic.place.id.uuid(),
            balance_paise: 0,
        })
        .collect();
    let mut items = found
        .into_iter()
        .map(|(index, row)| {
            let clinic = &access.clinics[index];
            let balance = (row.total_paise - row.paid_paise).max(0);
            balances[index].balance_paise += balance;
            let lines: Vec<PatientBillLine> = serde_json::from_value(row.items)
                .map_err(|_| ApiError::internal("unreadable bill lines"))?;
            Ok::<_, ApiError>((
                row.issued_at,
                PatientBill {
                    id: row.id,
                    clinic_id: clinic.place.id.uuid(),
                    number: row.number,
                    issued_at: at(clinic, row.issued_at),
                    total_paise: row.total_paise,
                    paid_paise: row.paid_paise,
                    balance_paise: balance,
                    items: lines,
                },
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    items.sort_by_key(|(issued, _)| std::cmp::Reverse(*issued));
    Ok(Json(PatientBills {
        balance_paise: balances.iter().map(|balance| balance.balance_paise).sum(),
        items: items.into_iter().map(|(_, item)| item).collect(),
        balances,
    }))
}

/// A file a clinic shared with the patient.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientFile {
    /// The file.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic: fetch it from that clinic's host.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// `photo`, `xray`, `report`, `document` or `consent`.
    pub kind: String,
    /// Media type.
    pub mime_type: String,
    /// Size in bytes.
    pub size_bytes: i64,
    /// Its label, such as `OPG`.
    pub label: Option<String>,
    /// A caption.
    pub caption: Option<String>,
    /// When it was taken (RFC 3339).
    pub taken_at: Option<String>,
    /// When it was added (RFC 3339).
    pub created_at: String,
}

/// Files the clinics shared with the patient.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientFiles {
    /// Newest first.
    pub items: Vec<PatientFile>,
}

/// The files every linked clinic marked "Share with patient".
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/files",
    operation_id = "listMyFiles",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientFiles),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn files(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<PatientFiles>, ApiFailure> {
    let access = &request.access;
    let mut found = app::files(state.db(), access, request.request_id).await?;
    found.sort_by_key(|(_, row)| std::cmp::Reverse(row.created_at));
    Ok(Json(PatientFiles {
        items: found
            .into_iter()
            .map(|(index, row)| {
                let clinic = &access.clinics[index];
                PatientFile {
                    id: row.id,
                    clinic_id: clinic.place.id.uuid(),
                    kind: row.kind,
                    mime_type: row.mime_type,
                    size_bytes: row.size_bytes,
                    label: row.label,
                    caption: row.caption,
                    taken_at: row.taken_at.map(|when| at(clinic, when)),
                    created_at: at(clinic, row.created_at),
                }
            })
            .collect(),
    }))
}

/// A link code from the clinic.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RedeemLinkCode {
    /// The code, such as `7KQ2M-X9D4T` (case, spaces and dashes don't matter).
    pub code: String,
}

/// The clinic a code linked.
#[derive(Debug, Serialize, ToSchema)]
pub struct LinkedByCode {
    /// The clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// `linked`, or `already_linked` for a repeat.
    pub outcome: String,
}

/// Links the patient's account to their record at a clinic with the code the clinic issued.
/// The patient's consent is recorded with the link.
#[utoipa::path(
    post,
    path = "/api/v1/me/patient/links",
    operation_id = "redeemPatientLinkCode",
    tag = "patient",
    request_body = RedeemLinkCode,
    security(("bearer" = [])),
    responses(
        (status = 201, body = LinkedByCode, description = "Linked"),
        (status = 200, body = LinkedByCode, description = "Already linked: nothing changed"),
        (status = 400, description = "Not a code"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "No such code, used, or expired"),
        (status = 409, description = "Linked to another record there, or the record to another account"),
        (status = 429, description = "Too many attempts")
    )
)]
pub(crate) async fn redeem(
    State(state): State<AppState>,
    request: PatientRequest,
    ApiJson(body): ApiJson<RedeemLinkCode>,
) -> Response {
    if let Some(throttle) = state.throttle() {
        let account = request.access.account_id.uuid().to_string();
        if let Err(error) = throttle.check("patient-link-account", &account).await {
            return error.into_response();
        }
    }
    match redeem_code(&state, &request.access, &body.code).await {
        Ok(response) => response,
        Err(failure) => failure.into_response(),
    }
}

async fn redeem_code(
    state: &AppState,
    access: &PatientAccess,
    code: &str,
) -> Result<Response, ApiFailure> {
    let redeemed = app::redeem(state.db(), access, code)
        .await?
        .ok_or_else(|| {
            ApiError::not_found(
                "code_not_found",
                "That code doesn't work. Check it, or ask the clinic for a new one.",
            )
        })?;
    let body = |outcome: RedeemOutcome| {
        Json(LinkedByCode {
            clinic_id: redeemed.clinic_id.uuid(),
            outcome: outcome.as_str().to_owned(),
        })
    };
    match redeemed.outcome {
        RedeemOutcome::Linked => {
            tracing::info!(
                event = Event::PatientLinked.as_str(),
                clinic_id = %redeemed.clinic_id.uuid(),
                account_id = %access.account_id.uuid(),
                via = "code",
                "patient linked"
            );
            Ok((StatusCode::CREATED, body(RedeemOutcome::Linked)).into_response())
        }
        RedeemOutcome::AlreadyLinked => {
            Ok((StatusCode::OK, body(RedeemOutcome::AlreadyLinked)).into_response())
        }
        RedeemOutcome::OtherRecord => Err(ApiError::conflict(
            "other_record",
            "Your account is already linked to another record at this clinic.",
        )
        .into()),
        RedeemOutcome::Taken => Err(ApiError::conflict(
            "record_linked",
            "This record is already linked to another account. Ask the clinic.",
        )
        .into()),
    }
}

/// Which clinic to ask.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewLinkRequest {
    /// The clinic's address name, such as `sunrise` (from `sunrise.aarogyam.example`).
    pub clinic: String,
}

/// Asks a clinic to connect the record that has the patient's verified email. The clinic
/// confirms it on Patient 360; nothing is linked until then. Always `202`, whether or not the
/// clinic has such a record.
#[utoipa::path(
    post,
    path = "/api/v1/me/patient/link-requests",
    operation_id = "requestPatientLink",
    tag = "patient",
    request_body = NewLinkRequest,
    security(("bearer" = [])),
    responses(
        (status = 202, description = "Asked; the clinic will confirm"),
        (status = 400, description = "No clinic named"),
        (status = 401, description = "Not signed in"),
        (status = 429, description = "Too many requests")
    )
)]
pub(crate) async fn request_link(
    State(state): State<AppState>,
    request: PatientRequest,
    ApiJson(body): ApiJson<NewLinkRequest>,
) -> Response {
    if let Some(throttle) = state.throttle() {
        let account = request.access.account_id.uuid().to_string();
        if let Err(error) = throttle.check("patient-link-account", &account).await {
            return error.into_response();
        }
    }
    match app::request_link(state.db(), &request.access, &body.clinic).await {
        Ok(()) => {
            tracing::info!(
                event = Event::PatientLinkRequested.as_str(),
                account_id = %request.access.account_id.uuid(),
                "patient link requested"
            );
            StatusCode::ACCEPTED.into_response()
        }
        Err(error) => ApiFailure::from(error).into_response(),
    }
}

/// Ends one of the patient's own links: that clinic's records leave the app.
#[utoipa::path(
    post,
    path = "/api/v1/me/patient/links/{id}/revoke",
    operation_id = "revokePatientLink",
    tag = "patient",
    params(("id" = String, Path, description = "The link")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Ended"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not one of the patient's open links")
    )
)]
pub(crate) async fn revoke(
    State(state): State<AppState>,
    request: PatientRequest,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::revoke_own(state.db(), &request.access, PatientLinkId::from_uuid(id)).await?;
    tracing::info!(
        event = Event::PatientLinkEnded.as_str(),
        link_id = %id,
        by = "patient",
        "patient link ended"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// A booking from the app.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PatientBooking {
    /// The doctor, from `GET /public/booking` on this host.
    pub practitioner_id: String,
    /// The slot's start, exactly as `GET /public/availability` offered it (RFC 3339).
    pub starts_at: String,
    /// Why they are coming, in a few words.
    pub reason: Option<String>,
}

/// Books a slot at this clinic (the host) for the patient's linked record, through the same
/// rules as the public booking page. `requested`, or `confirmed` when the clinic auto-confirms.
#[utoipa::path(
    post,
    path = "/api/v1/me/patient/bookings",
    operation_id = "bookAsPatient",
    tag = "patient",
    request_body = PatientBooking,
    security(("bearer" = [])),
    responses(
        (status = 201, body = PatientAppointment),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic that linked the patient, or online booking is off"),
        (status = 409, description = "The slot is gone, or too many open bookings"),
        (status = 429, description = "Too many requests")
    )
)]
pub(crate) async fn book(
    State(state): State<AppState>,
    request: PatientAtClinic,
    ApiJson(body): ApiJson<PatientBooking>,
) -> Response {
    if let Some(throttle) = state.throttle() {
        let person = request.auth_uid.to_string();
        if let Err(error) = throttle.check("public-booking-identity", &person).await {
            return error.into_response();
        }
    }
    match book_slot(&state, &request, body).await {
        Ok(booked) => (StatusCode::CREATED, Json(booked)).into_response(),
        Err(failure) => failure.into_response(),
    }
}

async fn book_slot(
    state: &AppState,
    request: &PatientAtClinic,
    body: PatientBooking,
) -> Result<PatientAppointment, ApiFailure> {
    let starts_at = parse_instant("starts_at", &body.starts_at)?;
    let practitioner =
        PractitionerId::from_uuid(parse_id("practitioner_id", &body.practitioner_id)?);
    let now = OffsetDateTime::now_utc();
    let booked = booking::book_linked(
        state.db(),
        request.clinic.place.id,
        request.request_id,
        request.clinic.patient_id,
        Slot {
            account: request.auth_uid,
            practitioner_id: practitioner,
            starts_at,
            reason: body.reason,
        },
        now,
    )
    .await?;
    tracing::info!(
        event = Event::AppointmentBooked.as_str(),
        appointment_id = %booked.id.uuid(),
        source = "app",
        "appointment booked in the patient app"
    );
    Ok(appointment_view(
        &request.clinic,
        rows::AppointmentRow {
            id: booked.id.uuid(),
            starts_at: booked.starts_at,
            ends_at: booked.ends_at,
            status: booked.status.as_str().to_owned(),
            reason: None,
            practitioner_id: practitioner.uuid(),
            doctor_name: booked.doctor_name,
            specialty: None,
        },
        now,
    ))
}

/// The appointment's status after a cancellation.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientCancelled {
    /// The appointment.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `cancelled`.
    pub status: String,
}

/// Cancels one of the patient's own appointments at this clinic (the host), when it is still
/// open and starts at least the clinic's booking notice from now. Repeating it succeeds.
#[utoipa::path(
    post,
    path = "/api/v1/me/patient/appointments/{id}/cancel",
    operation_id = "cancelMyAppointment",
    tag = "patient",
    params(("id" = String, Path, description = "The appointment")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientCancelled),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the patient's appointment at this clinic"),
        (status = 409, description = "Too late to cancel in the app")
    )
)]
pub(crate) async fn cancel(
    State(state): State<AppState>,
    request: PatientAtClinic,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientCancelled>, ApiFailure> {
    let status = app::cancel(
        state.db(),
        &request.access,
        &request.clinic,
        request.request_id,
        AppointmentId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::AppointmentCancelledByPatient.as_str(),
        appointment_id = %id,
        "appointment cancelled by the patient"
    );
    Ok(Json(PatientCancelled {
        id,
        status: status.as_str().to_owned(),
    }))
}

/// Streams a file this clinic (the host) shared with the patient. Each download is in the
/// access record.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/files/{id}/content",
    operation_id = "getMyFileContent",
    tag = "patient",
    params(("id" = String, Path, description = "The file")),
    security(("bearer" = [])),
    responses(
        (status = 200, description = "The file, with its media type"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a file this clinic shared with the patient")
    )
)]
pub(crate) async fn file_content(
    State(state): State<AppState>,
    request: PatientAtClinic,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiFailure> {
    let file = app::shared_file(
        state.db(),
        state.files()?,
        &request.access,
        &request.clinic,
        request.request_id,
        AttachmentId::from_uuid(id),
    )
    .await?;
    tracing::info!(event = Event::AttachmentDownloaded.as_str(), attachment_id = %id, by = "patient", "file downloaded");
    let mut response = file.bytes.into_response();
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&file.mime_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    Ok(response)
}
