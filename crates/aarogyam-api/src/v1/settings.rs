//! The clinic's own settings.

use aarogyam_app::settings::{self as app, AddressInput, BookingChanges, SettingsChanges};
use aarogyam_domain::event::Event;
use aarogyam_domain::letterhead::{
    Letterhead as DomainLetterhead, LetterheadChanges as DomainChanges, ShownChanges,
};
use aarogyam_domain::notification_prefs::{
    NotificationChanges, NotificationPrefs, QuietHoursChanges, hhmm,
};
use aarogyam_domain::permission::require::SettingsManage;
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartRejection};
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::letterhead::{ImageForm, read_image};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The portal's look.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Branding {
    /// Brand colour, `#RRGGBB`.
    pub brand: Option<String>,
    /// `light`, `dark` or `auto` (follow the device).
    pub mode: Option<String>,
}

/// Which clinic details a generated letterhead prints.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch per printed detail"
)]
pub struct LetterheadShown {
    /// The logo image.
    pub logo: bool,
    /// The doctors, with qualifications.
    pub doctors: bool,
    /// Their registration numbers.
    pub registration: bool,
    /// The address.
    pub address: bool,
    /// The phone number.
    pub phone: bool,
    /// The email address.
    pub email: bool,
    /// The opening hours.
    pub timings: bool,
    /// The GSTIN.
    pub gstin: bool,
}

/// The letterhead printed on prescriptions, bills and receipts.
#[derive(Debug, Serialize, ToSchema)]
pub struct Letterhead {
    /// `upload` (the clinic's own image) or `template` (a generated design).
    pub mode: String,
    /// `logo_left`, `classic`, `modern_band`, `minimal_line`, `two_doctor` or `bilingual`.
    pub template: String,
    /// Accent colour of the design, `#RRGGBB`; the brand colour when none.
    pub accent: Option<String>,
    /// Which details the design prints.
    pub show: LetterheadShown,
    /// The clinic name in another script, such as Hindi, for the bilingual design.
    pub local_name: Option<String>,
    /// A line printed at the foot.
    pub footer: Option<String>,
    /// Clinic email printed on the letterhead.
    pub email: Option<String>,
    /// Opening hours printed on the letterhead.
    pub timings: Option<String>,
    /// The doctors printed, in order; empty means the first active doctors by name.
    #[schema(value_type = Vec<String>)]
    pub doctor_ids: Vec<Uuid>,
    /// Whether a letterhead image is uploaded.
    pub has_image: bool,
    /// Whether a logo is uploaded.
    pub has_logo: bool,
}

impl From<DomainLetterhead> for Letterhead {
    fn from(letterhead: DomainLetterhead) -> Self {
        let s = letterhead.shown;
        Self {
            mode: letterhead.mode.as_str().to_owned(),
            template: letterhead.template.as_str().to_owned(),
            accent: letterhead.accent.map(|accent| accent.as_str().to_owned()),
            show: LetterheadShown {
                logo: s.logo,
                doctors: s.doctors,
                registration: s.registration,
                address: s.address,
                phone: s.phone,
                email: s.email,
                timings: s.timings,
                gstin: s.gstin,
            },
            local_name: letterhead.local_name,
            footer: letterhead.footer,
            email: letterhead.email,
            timings: letterhead.timings,
            doctor_ids: letterhead.doctor_ids,
            has_image: letterhead.image.is_some(),
            has_logo: letterhead.logo.is_some(),
        }
    }
}

/// Changes to which details a design prints; flags left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LetterheadShownChanges {
    /// The logo image.
    pub logo: Option<bool>,
    /// The doctors.
    pub doctors: Option<bool>,
    /// Registration numbers.
    pub registration: Option<bool>,
    /// The address.
    pub address: Option<bool>,
    /// The phone number.
    pub phone: Option<bool>,
    /// The email address.
    pub email: Option<bool>,
    /// The opening hours.
    pub timings: Option<bool>,
    /// The GSTIN.
    pub gstin: Option<bool>,
}

/// Changes to the letterhead; settings left out stay as they are, and an empty string clears
/// `accent`, `footer`, `email` or `timings`. Images are uploaded separately.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LetterheadChanges {
    /// `upload` (needs an uploaded image) or `template`.
    pub mode: Option<String>,
    /// A design id.
    pub template: Option<String>,
    /// Accent colour, `#RRGGBB`.
    pub accent: Option<String>,
    /// Which details the design prints.
    pub show: Option<LetterheadShownChanges>,
    /// The clinic name in another script, up to 120 characters.
    pub local_name: Option<String>,
    /// Footer line, up to 200 characters.
    pub footer: Option<String>,
    /// Clinic email, valid when given.
    pub email: Option<String>,
    /// Opening hours, up to 200 characters.
    pub timings: Option<String>,
    /// Up to four of the clinic's doctors, in print order.
    #[schema(value_type = Option<Vec<String>>)]
    pub doctor_ids: Option<Vec<Uuid>>,
}

impl From<LetterheadChanges> for DomainChanges {
    fn from(changes: LetterheadChanges) -> Self {
        let s = changes.show;
        Self {
            mode: changes.mode,
            template: changes.template,
            accent: changes.accent,
            shown: s.map_or_else(ShownChanges::default, |s| ShownChanges {
                logo: s.logo,
                doctors: s.doctors,
                registration: s.registration,
                address: s.address,
                phone: s.phone,
                email: s.email,
                timings: s.timings,
                gstin: s.gstin,
            }),
            local_name: changes.local_name,
            footer: changes.footer,
            email: changes.email,
            timings: changes.timings,
            doctor_ids: changes.doctor_ids,
        }
    }
}

/// A postal address. Every part is optional.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Address {
    /// House, building and street.
    pub line1: Option<String>,
    /// Area or landmark.
    pub line2: Option<String>,
    /// City or town.
    pub city: Option<String>,
    /// State or union territory.
    pub state: Option<String>,
    /// Six-digit PIN code.
    pub pincode: Option<String>,
}

/// Online booking: what patients may book on the clinic's public page.
#[derive(Debug, Serialize, ToSchema)]
pub struct OnlineBooking {
    /// Whether the public booking page works.
    pub enabled: bool,
    /// Slot length in minutes (5 to 240, steps of 5).
    pub slot_minutes: u16,
    /// Gap kept free around other appointments, in minutes (0 to 120).
    pub buffer_minutes: u16,
    /// Whether a booking is confirmed at once; otherwise the front desk confirms.
    pub auto_confirm: bool,
    /// How many days ahead patients may book (1 to 180).
    pub horizon_days: u16,
    /// How soon before a slot it stops being offered, in minutes (0 to 10080).
    pub min_notice_minutes: u16,
    /// Minutes a booking request may wait, in opening hours, before everyone who handles
    /// appointments is reminded (5 to 240, default 15); owners are told after as long again.
    pub reminder_minutes: u16,
    /// How long an appointment booked by staff lasts when no end is given: 15, 30, 45 or 60
    /// minutes.
    pub default_visit_minutes: u16,
}

/// Changes to online booking; settings left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct OnlineBookingChanges {
    /// Whether the public booking page works.
    pub enabled: Option<bool>,
    /// Slot length in minutes.
    pub slot_minutes: Option<u16>,
    /// Buffer in minutes.
    pub buffer_minutes: Option<u16>,
    /// Whether a booking is confirmed at once.
    pub auto_confirm: Option<bool>,
    /// Days ahead.
    pub horizon_days: Option<u16>,
    /// Minimum notice in minutes.
    pub min_notice_minutes: Option<u16>,
    /// Reminder wait in minutes.
    pub reminder_minutes: Option<u16>,
    /// Default visit length in minutes: 15, 30, 45 or 60.
    pub default_visit_minutes: Option<u16>,
}

/// The clinic's settings.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicSettings {
    /// Display name.
    pub name: String,
    /// `dental` or `general`; fixed when the clinic is created.
    pub specialty: String,
    /// Registered legal name, for bills.
    pub legal_name: Option<String>,
    /// GST identification number.
    pub gstin: Option<String>,
    /// IANA time zone; `Asia/Kolkata` is the only one supported.
    pub timezone: String,
    /// The portal's look.
    pub branding: Branding,
    /// Footer printed on prescriptions.
    pub prescription_footer: Option<String>,
    /// The main branch's address.
    pub address: Address,
    /// The main branch's phone.
    pub phone: Option<String>,
    /// UPI ID shown on bills, such as `clinic@okicici`.
    pub upi_id: Option<String>,
    /// Online booking.
    pub online_booking: OnlineBooking,
    /// The letterhead printed on the clinic's documents.
    pub letterhead: Letterhead,
}

impl From<app::ClinicSettings> for ClinicSettings {
    fn from(settings: app::ClinicSettings) -> Self {
        Self {
            name: settings.name,
            specialty: settings.specialty,
            legal_name: settings.legal_name,
            gstin: settings.gstin,
            timezone: settings.timezone,
            branding: Branding {
                brand: settings.brand,
                mode: settings.mode,
            },
            prescription_footer: settings.prescription_footer,
            address: Address {
                line1: settings.address.line1,
                line2: settings.address.line2,
                city: settings.address.city,
                state: settings.address.state,
                pincode: settings.address.pincode,
            },
            phone: settings.phone,
            upi_id: settings.upi_id,
            online_booking: OnlineBooking {
                enabled: settings.booking.enabled,
                slot_minutes: settings.booking.slot_minutes,
                buffer_minutes: settings.booking.buffer_minutes,
                auto_confirm: settings.booking.auto_confirm,
                horizon_days: settings.booking.horizon_days,
                min_notice_minutes: settings.booking.min_notice_minutes,
                reminder_minutes: settings.booking.reminder_minutes,
                default_visit_minutes: settings.booking.default_visit_minutes,
            },
            letterhead: settings.letterhead.into(),
        }
    }
}

/// Changes to the settings. Settings left out stay as they are; an empty string clears an
/// optional one. Branding changes only the keys given; a given address replaces the whole
/// address.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ClinicSettingsChanges {
    /// Display name, 1 to 200 characters.
    pub name: Option<String>,
    /// Registered legal name.
    pub legal_name: Option<String>,
    /// GSTIN, checked including its check character.
    pub gstin: Option<String>,
    /// IANA time zone: `Asia/Kolkata`.
    pub timezone: Option<String>,
    /// Brand colour and theme mode.
    pub branding: Option<Branding>,
    /// Footer printed on prescriptions, up to 500 characters.
    pub prescription_footer: Option<String>,
    /// The main branch's address.
    pub address: Option<Address>,
    /// The main branch's phone; +91 is assumed without a country code.
    pub phone: Option<String>,
    /// UPI ID, like `name@bank`.
    pub upi_id: Option<String>,
    /// Online booking: slot length, buffer, auto-confirm, window and notice.
    pub online_booking: Option<OnlineBookingChanges>,
    /// The letterhead: design, accent, details shown, footer and doctors.
    pub letterhead: Option<LetterheadChanges>,
}

/// The clinic's settings: profile, GSTIN, time zone, branding, prescription footer, address,
/// phone and UPI ID.
#[utoipa::path(
    get,
    path = "/api/v1/settings/clinic",
    operation_id = "getClinicSettings",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ClinicSettings),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn get_clinic(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<ClinicSettings>, ApiFailure> {
    let settings = app::get(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(settings.into()))
}

/// Changes the clinic's settings. The change history records each change.
#[utoipa::path(
    patch,
    path = "/api/v1/settings/clinic",
    operation_id = "updateClinicSettings",
    tag = "settings",
    request_body = ClinicSettingsChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = ClinicSettings),
        (status = 400, description = "Invalid input; the message names the setting"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn update_clinic(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<ClinicSettingsChanges>,
) -> Result<Json<ClinicSettings>, ApiFailure> {
    let (brand, mode) = body
        .branding
        .map_or((None, None), |branding| (branding.brand, branding.mode));
    let changes = SettingsChanges {
        name: body.name,
        legal_name: body.legal_name,
        gstin: body.gstin,
        timezone: body.timezone,
        brand,
        mode,
        prescription_footer: body.prescription_footer,
        address: body.address.map(|address| AddressInput {
            line1: address.line1.unwrap_or_default(),
            line2: address.line2.unwrap_or_default(),
            city: address.city.unwrap_or_default(),
            state: address.state.unwrap_or_default(),
            pincode: address.pincode.unwrap_or_default(),
        }),
        phone: body.phone,
        upi_id: body.upi_id,
        booking: body
            .online_booking
            .map_or_else(BookingChanges::default, |b| BookingChanges {
                enabled: b.enabled,
                slot_minutes: b.slot_minutes,
                buffer_minutes: b.buffer_minutes,
                auto_confirm: b.auto_confirm,
                horizon_days: b.horizon_days,
                min_notice_minutes: b.min_notice_minutes,
                reminder_minutes: b.reminder_minutes,
                default_visit_minutes: b.default_visit_minutes,
            }),
        letterhead: body.letterhead.map(Into::into),
    };
    let settings = app::update(state.db(), &request.actor, request.request_id, changes).await?;
    // The host lookup carries the time zone; a change applies to this instance's next request.
    state.forget_clinic(request.actor.clinic_id);
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        "clinic settings changed"
    );
    Ok(Json(settings.into()))
}

/// Uploads the clinic logo as `multipart/form-data` field `file`: PNG or JPEG, up to 2 MB,
/// checked by content. Replaces the previous one. The same image the letterhead prints as its
/// logo; returns the clinic's settings.
#[utoipa::path(
    post,
    path = "/api/v1/settings/clinic/logo",
    operation_id = "uploadClinicLogo",
    tag = "settings",
    request_body(content = ImageForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ClinicSettings),
        (status = 400, description = "Not a PNG or JPEG, or empty"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 413, description = "Larger than 2 MB")
    )
)]
pub(crate) async fn upload_logo(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<Json<ClinicSettings>, ApiFailure> {
    let form = form.map_err(|_| super::files::bad_form("send the image as multipart/form-data"))?;
    let bytes = read_image(form).await?;
    aarogyam_app::letterhead::upload_image(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        aarogyam_app::letterhead::Slot::Logo,
        bytes,
    )
    .await?;
    let settings = app::get(state.db(), &request.actor, request.request_id).await?;
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        "clinic logo changed"
    );
    Ok(Json(settings.into()))
}

/// Quiet hours: when patient reminders and offers wait.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuietHoursView {
    /// Whether they apply.
    pub enabled: bool,
    /// When they begin, `HH:MM` in the clinic's time zone.
    pub start: String,
    /// When they end, `HH:MM`; earlier than `start` means they run overnight.
    pub end: String,
}

/// The clinic's notification switches.
#[derive(Debug, Serialize, ToSchema)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch per notification the clinic can turn off"
)]
pub struct NotificationSettings {
    /// Remind patients a day before their appointment (default on).
    pub reminder_24h: bool,
    /// Remind patients two hours before (default off).
    pub reminder_2h: bool,
    /// Email patients a receipt when a payment is recorded (default off).
    pub receipts: bool,
    /// Tell staff when a patient's follow-up falls due (default on).
    pub recall: bool,
    /// Show low stock on Today (default on).
    pub low_stock: bool,
    /// Tell staff when lab work is overdue (default on).
    pub lab_due: bool,
    /// Quiet hours for reminders and offers.
    pub quiet_hours: QuietHoursView,
}

impl From<NotificationPrefs> for NotificationSettings {
    fn from(prefs: NotificationPrefs) -> Self {
        Self {
            reminder_24h: prefs.reminder_24h,
            reminder_2h: prefs.reminder_2h,
            receipts: prefs.receipts,
            recall: prefs.recall,
            low_stock: prefs.low_stock,
            lab_due: prefs.lab_due,
            quiet_hours: QuietHoursView {
                enabled: prefs.quiet_hours.enabled,
                start: hhmm(prefs.quiet_hours.start),
                end: hhmm(prefs.quiet_hours.end),
            },
        }
    }
}

/// Changes to quiet hours; what is left out stays.
#[derive(Debug, Deserialize, ToSchema)]
pub struct QuietHoursChangesBody {
    /// Switch them on or off.
    pub enabled: Option<bool>,
    /// New start, `HH:MM`.
    pub start: Option<String>,
    /// New end, `HH:MM`.
    pub end: Option<String>,
}

/// Changes to the notification switches; what is left out stays.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NotificationSettingsChanges {
    /// The day-before reminder.
    pub reminder_24h: Option<bool>,
    /// The two-hour reminder.
    pub reminder_2h: Option<bool>,
    /// Receipts by email.
    pub receipts: Option<bool>,
    /// Follow-up alerts to staff.
    pub recall: Option<bool>,
    /// Low stock on Today.
    pub low_stock: Option<bool>,
    /// Overdue lab alerts.
    pub lab_due: Option<bool>,
    /// Quiet hours.
    pub quiet_hours: Option<QuietHoursChangesBody>,
}

/// The clinic's notification switches and quiet hours.
#[utoipa::path(
    get,
    path = "/api/v1/settings/notifications",
    operation_id = "getNotificationSettings",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = NotificationSettings),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn get_notifications(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<NotificationSettings>, ApiFailure> {
    let prefs = app::notification_prefs(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(prefs.into()))
}

/// Changes the notification switches and quiet hours. The change history records each change.
#[utoipa::path(
    patch,
    path = "/api/v1/settings/notifications",
    operation_id = "updateNotificationSettings",
    tag = "settings",
    request_body = NotificationSettingsChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = NotificationSettings),
        (status = 400, description = "Invalid input; the message names the setting"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn update_notifications(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<NotificationSettingsChanges>,
) -> Result<Json<NotificationSettings>, ApiFailure> {
    let changes = NotificationChanges {
        reminder_24h: body.reminder_24h,
        reminder_2h: body.reminder_2h,
        receipts: body.receipts,
        recall: body.recall,
        low_stock: body.low_stock,
        lab_due: body.lab_due,
        quiet_hours: body.quiet_hours.map(|quiet| QuietHoursChanges {
            enabled: quiet.enabled,
            start: quiet.start,
            end: quiet.end,
        }),
    };
    let prefs =
        app::update_notification_prefs(state.db(), &request.actor, request.request_id, changes)
            .await?;
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        "notification settings changed"
    );
    Ok(Json(prefs.into()))
}
