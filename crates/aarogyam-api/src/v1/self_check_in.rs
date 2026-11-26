//! Patients checking themselves in by scanning the clinic's QR code. The public side (on the
//! clinic's host, behind the QR's key) creates arrival requests and never patients, and never
//! says whether a phone or name is known. The front desk lists, accepts or dismisses requests;
//! settings (`settings.manage`) switch the QR on and replace its key.

use aarogyam_app::self_check_in::{self as app, Accept, NewArrival, PendingArrival, QrSettings};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{PatientId, PractitionerId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::permission::require::{
    IntakeWrite, PatientsRead, PatientsWrite, SettingsManage,
};
use aarogyam_domain::self_check_in::{Choice, catalogue};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use sakalya_types::PhoneE164;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::patient_intakes::{PatientIntake, blood_groups, call_times, heard_via};
use super::patients::{PatientAddress, PhoneMatches, parse_date};
use super::walk_ins::WalkIn;
use super::{parse_id, rfc3339};
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::ApiFailure;

// ---------------------------------------------------------------------------------------------
// Settings (staff)
// ---------------------------------------------------------------------------------------------

/// The clinic's QR check-in settings.
#[derive(Debug, Serialize, ToSchema)]
pub struct SelfCheckInSettings {
    /// Whether scanning the QR code works.
    pub enabled: bool,
    /// The address the QR code opens, with its key; left out until a QR code is made. Anyone
    /// with it can send arrival requests, so show it only to staff who print or display it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub url: Option<String>,
}

fn settings_body(settings: QrSettings, host: &str) -> SelfCheckInSettings {
    SelfCheckInSettings {
        enabled: settings.enabled,
        url: settings
            .key
            .map(|key| format!("https://{host}/arrive?k={key}")),
    }
}

/// The QR check-in settings and the address the QR code opens.
#[utoipa::path(
    get,
    path = "/api/v1/settings/self-check-in",
    operation_id = "getSelfCheckInSettings",
    tag = "self-check-in",
    security(("bearer" = [])),
    responses(
        (status = 200, body = SelfCheckInSettings),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    host: ClinicHost,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<SelfCheckInSettings>, ApiFailure> {
    let settings = app::get_settings(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(settings_body(settings, &host.host)))
}

/// Switch the QR on or off.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SelfCheckInSwitch {
    /// Whether scanning the QR code works. Switching on makes the first QR code.
    pub enabled: bool,
}

/// Switches the QR on or off. Switching on for the first time makes the clinic's QR key.
#[utoipa::path(
    put,
    path = "/api/v1/settings/self-check-in",
    operation_id = "setSelfCheckIn",
    tag = "self-check-in",
    request_body = SelfCheckInSwitch,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SelfCheckInSettings),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn put_settings(
    State(state): State<AppState>,
    host: ClinicHost,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<SelfCheckInSwitch>,
) -> Result<Json<SelfCheckInSettings>, ApiFailure> {
    let settings =
        app::set_enabled(state.db(), &request.actor, request.request_id, body.enabled).await?;
    Ok(Json(settings_body(settings, &host.host)))
}

/// Makes a new QR key, which voids every printed QR code, and returns the new address.
#[utoipa::path(
    post,
    path = "/api/v1/settings/self-check-in/key",
    operation_id = "newSelfCheckInKey",
    tag = "self-check-in",
    security(("bearer" = [])),
    responses(
        (status = 200, body = SelfCheckInSettings),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn new_key(
    State(state): State<AppState>,
    host: ClinicHost,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<SelfCheckInSettings>, ApiFailure> {
    let settings = app::rotate_key(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(settings_body(settings, &host.host)))
}

// ---------------------------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------------------------

/// A choice on the check-in form.
#[derive(Debug, Serialize, ToSchema)]
pub struct CheckInChoice {
    /// What the API carries.
    pub code: String,
    /// What the patient reads.
    pub label: String,
}

impl From<&Choice> for CheckInChoice {
    fn from(choice: &Choice) -> Self {
        Self {
            code: choice.code.clone(),
            label: choice.label.clone(),
        }
    }
}

/// What the check-in page needs to start.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArrivePage {
    /// The clinic's name.
    pub clinic_name: String,
    /// "What brings you in?" choices.
    pub reasons: Vec<CheckInChoice>,
    /// "Any of these?" health choices.
    pub health_flags: Vec<CheckInChoice>,
    /// What the person filling the form is to the patient, for "my child / family member".
    pub relations: Vec<CheckInChoice>,
    /// Blood groups, for the optional case-paper questions.
    pub blood_groups: Vec<CheckInChoice>,
    /// Best times to call.
    pub call_times: Vec<CheckInChoice>,
    /// How patients heard of the clinic.
    pub heard_via: Vec<CheckInChoice>,
    /// The notice version the patient agrees to.
    pub notice_version: String,
    /// The clinic's published privacy notice; empty when it has none, and the page then links
    /// `notice_url`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub notice_text: Option<String>,
    /// The standard privacy page, on the site that serves this one.
    pub notice_url: String,
}

/// The key the QR code carries.
#[derive(Debug, Deserialize)]
pub struct ArriveQuery {
    /// The QR key.
    pub k: Option<String>,
}

/// Public, no sign-in: the clinic's name, the form's choices and the notice. A wrong or missing
/// key, or a QR that is switched off, is a plain `404`.
#[utoipa::path(
    get,
    path = "/api/v1/public/arrive",
    operation_id = "getArrivePage",
    tag = "public",
    params(("k" = String, Query, description = "The QR key")),
    responses(
        (status = 200, body = ArrivePage),
        (status = 404, description = "Not a clinic, wrong key, or the QR is off"),
        (status = 429, description = "Too many requests from this address")
    )
)]
pub(crate) async fn arrive(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiQuery(query): ApiQuery<ArriveQuery>,
) -> Result<Json<ArrivePage>, ApiFailure> {
    let page = app::page(
        state.db(),
        &public.place,
        public.request_id,
        query.k.as_deref().unwrap_or_default(),
    )
    .await?;
    let lists = catalogue();
    Ok(Json(ArrivePage {
        clinic_name: page.clinic_name,
        reasons: lists.reasons.iter().map(Into::into).collect(),
        health_flags: lists.health_flags.iter().map(Into::into).collect(),
        relations: lists.relations.iter().map(Into::into).collect(),
        blood_groups: blood_groups(),
        call_times: call_times(),
        heard_via: heard_via(),
        notice_version: page.notice_version,
        notice_text: page.notice_text,
        notice_url: "/privacy".to_owned(),
    }))
}

/// A patient's arrival.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewArrivalBody {
    /// The QR key.
    pub k: String,
    /// The patient's first name.
    pub first_name: String,
    /// The patient's last name; optional.
    pub last_name: Option<String>,
    /// The phone; +91 is assumed without a country code.
    pub phone: String,
    /// Reason codes from the form's list; give at least one, or `reason_text`.
    #[serde(default)]
    pub reasons: Vec<String>,
    /// A line in the patient's words, at most 200 characters.
    pub reason_text: Option<String>,
    /// The patient agrees to the clinic keeping their health record to treat them. Must be
    /// `true`.
    pub consent_care: bool,
    /// Whether the person filling the form is the patient.
    pub for_self: bool,
    /// The person filling the form, when not the patient.
    pub contact_name: Option<String>,
    /// What that person is to the patient, a code from `relations`.
    pub relation: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// `female`, `male` or `other`.
    pub sex: Option<String>,
    /// Age in years; not together with `date_of_birth`.
    pub age_years: Option<u16>,
    /// Date of birth, `YYYY-MM-DD`.
    pub date_of_birth: Option<String>,
    /// Address, with the PIN code checked.
    pub address: Option<PatientAddress>,
    /// Health codes from the form's list.
    #[serde(default)]
    pub health: Vec<String>,
    /// Allergies in the patient's words.
    pub allergies_text: Option<String>,
    /// Appointment reminders by message.
    #[serde(default)]
    pub reminders: bool,
    /// The case-paper fields; checked now and kept with the request.
    pub intake: Option<PatientIntake>,
    /// A hidden field real people leave empty; when it is filled nothing is stored.
    pub website: Option<String>,
}

/// An empty answer: the same whatever happened to the request.
#[derive(Debug, Serialize, ToSchema)]
pub struct Received {}

/// Public, no sign-in: sends the clinic an arrival request (not a patient). The front desk
/// accepts it. The answer never says whether the clinic knows the phone or name.
#[utoipa::path(
    post,
    path = "/api/v1/public/arrivals",
    operation_id = "sendArrival",
    tag = "public",
    request_body = NewArrivalBody,
    responses(
        (status = 201, body = Received),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 404, description = "Not a clinic, wrong key, or the QR is off"),
        (status = 429, description = "`list_full` (the desk has 200 requests waiting) or `rate_limited`")
    )
)]
pub(crate) async fn send_arrival(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiJson(body): ApiJson<NewArrivalBody>,
) -> Result<(StatusCode, Json<Received>), ApiFailure> {
    if body
        .website
        .as_deref()
        .is_some_and(|text| !text.trim().is_empty())
    {
        return Ok((StatusCode::CREATED, Json(Received {})));
    }
    let date_of_birth = body
        .date_of_birth
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let input = NewArrival {
        first_name: body.first_name,
        last_name: body.last_name,
        phone: body.phone,
        reasons: body.reasons,
        reason_text: body.reason_text,
        consent_care: body.consent_care,
        for_self: body.for_self,
        contact_name: body.contact_name,
        relation: body.relation,
        email: body.email,
        sex: body.sex,
        age_years: body.age_years,
        date_of_birth: date_of_birth.map(parse_date).transpose()?,
        address: body
            .address
            .as_ref()
            .map(PatientAddress::parse)
            .transpose()?,
        health: body.health,
        allergies_text: body.allergies_text,
        reminders: body.reminders,
        intake: body.intake.map(Into::into),
    };
    let id = app::submit(
        state.db(),
        &public.place,
        public.request_id,
        &body.k,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::SelfCheckInSubmitted.as_str(),
        self_check_in_id = %id,
        "arrival request received"
    );
    Ok((StatusCode::CREATED, Json(Received {})))
}

// ---------------------------------------------------------------------------------------------
// The front desk
// ---------------------------------------------------------------------------------------------

/// A request waiting for the desk. Phone and email are masked without `patients.contact`.
#[derive(Debug, Serialize, ToSchema)]
pub struct Arrival {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// When the patient sent it (RFC 3339).
    pub created_at: String,
    /// The patient's first name.
    pub first_name: String,
    /// The patient's last name, when given.
    pub last_name: Option<String>,
    /// The phone, masked without `patients.contact`.
    pub phone: String,
    /// Whether the person who filled the form is the patient.
    pub for_self: bool,
    /// The person who filled the form, when not the patient.
    pub contact_name: Option<String>,
    /// What that person is to the patient.
    pub relation: Option<String>,
    /// Reason codes.
    pub reasons: Vec<String>,
    /// The reasons in words.
    pub reason_labels: Vec<String>,
    /// A line in the patient's words.
    pub reason_text: Option<String>,
    /// Health codes the patient ticked.
    pub health: Vec<String>,
    /// The health flags in words.
    pub health_labels: Vec<String>,
    /// Allergies in the patient's words.
    pub allergies_text: Option<String>,
    /// Email, masked without `patients.contact`.
    pub email: Option<String>,
    /// `female`, `male` or `other`.
    pub sex: Option<String>,
    /// Age in years.
    pub age_years: Option<u16>,
    /// Date of birth, `YYYY-MM-DD`.
    pub date_of_birth: Option<String>,
    /// Address.
    pub address: Option<PatientAddress>,
    /// The patient ticked appointment reminders.
    pub reminders: bool,
    /// The case-paper fields the patient gave; phones are masked without `patients.contact`.
    pub intake: Option<PatientIntake>,
    /// Patients already registered with the phone, and their relatives. The desk picks one or
    /// "new patient"; the default is a new patient.
    pub matches: PhoneMatches,
}

/// The requests waiting for the desk.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArrivalList {
    /// Oldest first.
    pub items: Vec<Arrival>,
}

fn arrival_body(row: PendingArrival, contact: bool) -> Arrival {
    let a = row.arrival;
    let phone = if contact {
        a.phone
    } else {
        PhoneE164::parse(&a.phone).map_or_else(|_| "***".to_owned(), |phone| phone.masked())
    };
    Arrival {
        id: row.id,
        created_at: rfc3339(row.created_at),
        first_name: a.first_name,
        last_name: a.last_name,
        phone,
        for_self: a.for_self,
        contact_name: a.contact_name,
        relation: a.relation,
        reasons: a.reasons,
        reason_labels: row.reason_labels,
        reason_text: a.reason_text,
        health: a.health,
        health_labels: row.health_labels,
        allergies_text: a.allergies_text,
        email: a.email.map(|email| {
            if contact {
                email
            } else {
                aarogyam_app::patients::mask_email(&email)
            }
        }),
        sex: a.sex,
        age_years: a.age_years,
        date_of_birth: a.date_of_birth,
        address: a.address.map(Into::into),
        reminders: a.reminders,
        intake: a.intake.map(|raw| {
            let mut body = PatientIntake::from(raw);
            if !contact {
                body.mask_phones();
            }
            body
        }),
        matches: row.matches.into(),
    }
}

/// The QR arrival requests waiting for the desk, oldest first, each with the patients who
/// share its phone.
#[utoipa::path(
    get,
    path = "/api/v1/arrivals",
    operation_id = "listArrivals",
    tag = "self-check-in",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ArrivalList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
) -> Result<Json<ArrivalList>, ApiFailure> {
    let contact = request
        .actor
        .permissions
        .allows(Permission::PatientsContact);
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(ArrivalList {
        items: rows
            .into_iter()
            .map(|row| arrival_body(row, contact))
            .collect(),
    }))
}

/// What the desk decides when it accepts.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AcceptBody {
    /// A registered patient picked from the matches; a new patient is registered when absent.
    pub patient_id: Option<String>,
    /// Issue a queue token (the default).
    #[serde(default = "yes")]
    pub check_in: bool,
    /// The doctor; "any" when absent.
    pub practitioner_id: Option<String>,
}

fn yes() -> bool {
    true
}

/// Accepts a request: registers the patient (or takes the one picked and fills only their blank
/// details), records the allergies, health flags and consents they gave, and issues a token, all
/// in one transaction. The answer is the walk-in's.
#[utoipa::path(
    post,
    path = "/api/v1/arrivals/{id}/accept",
    operation_id = "acceptArrival",
    tag = "self-check-in",
    params(("id" = String, Path, description = "The arrival request")),
    request_body = AcceptBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = WalkIn),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks intake.write, patients.write or appointments.write"),
        (status = 404, description = "No such request (or patient) in this clinic"),
        (status = 409, description = "`already_handled`: someone else accepted or dismissed it")
    )
)]
pub(crate) async fn accept(
    State(state): State<AppState>,
    Require { request, .. }: Require<IntakeWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<AcceptBody>,
) -> Result<(StatusCode, Json<WalkIn>), ApiFailure> {
    let input = Accept {
        patient_id: body
            .patient_id
            .as_deref()
            .map(|text| parse_id("patient_id", text).map(PatientId::from_uuid))
            .transpose()?,
        check_in: body.check_in,
        practitioner_id: body
            .practitioner_id
            .as_deref()
            .map(|text| parse_id("practitioner_id", text).map(PractitionerId::from_uuid))
            .transpose()?,
    };
    let view = app::accept(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::SelfCheckInAccepted.as_str(),
        self_check_in_id = %id,
        patient_id = %view.patient.id.uuid(),
        registered = view.registered,
        "arrival accepted"
    );
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Dismisses a request (spam or a duplicate); what the patient typed is cleared at once.
#[utoipa::path(
    post,
    path = "/api/v1/arrivals/{id}/dismiss",
    operation_id = "dismissArrival",
    tag = "self-check-in",
    params(("id" = String, Path, description = "The arrival request")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Dismissed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such request in this clinic"),
        (status = 409, description = "`already_handled`: someone else accepted or dismissed it")
    )
)]
pub(crate) async fn dismiss(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::dismiss(state.db(), &request.actor, request.request_id, id).await?;
    tracing::info!(
        event = Event::SelfCheckInDismissed.as_str(),
        self_check_in_id = %id,
        "arrival dismissed"
    );
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// PIN codes
// ---------------------------------------------------------------------------------------------

/// Where a PIN code is.
#[derive(Debug, Serialize, ToSchema)]
pub struct Pincode {
    /// The six-digit PIN code.
    pub pin: String,
    /// The district.
    pub district: String,
    /// The state or union territory.
    pub state: String,
}

/// Public, no sign-in: the district and state of a PIN code, from the offline directory. The
/// answer never changes within a release, so it is cached for 30 days.
#[utoipa::path(
    get,
    path = "/api/v1/public/pincodes/{pin}",
    operation_id = "lookupPincode",
    tag = "public",
    params(("pin" = String, Path, description = "A six-digit PIN code")),
    responses(
        (status = 200, body = Pincode),
        (status = 400, description = "Not a PIN code"),
        (status = 404, description = "Not a clinic, or a PIN code not in the directory"),
        (status = 429, description = "Too many requests from this address")
    )
)]
pub(crate) async fn pincode(
    _public: ClinicHost,
    ApiPath(pin): ApiPath<String>,
) -> Result<axum::response::Response, ApiFailure> {
    use axum::http::{HeaderValue, header};
    use axum::response::IntoResponse;
    let found = aarogyam_domain::pincode::lookup(&pin)
        .map_err(|error| super::bad("pin", &error.to_string()))?
        .ok_or_else(|| ApiFailure::Error(crate::failure::not_found()))?;
    let mut response = Json(Pincode {
        pin: found.pin,
        district: found.district,
        state: found.state,
    })
    .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=2592000"),
    );
    Ok(response)
}
