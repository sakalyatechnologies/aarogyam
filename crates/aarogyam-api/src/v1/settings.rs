//! The clinic's own settings.

use aarogyam_app::settings::{self as app, AddressInput, BookingChanges, SettingsChanges};
use aarogyam_domain::event::Event;
use aarogyam_domain::permission::require::SettingsManage;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The portal's look.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Branding {
    /// Brand colour, `#RRGGBB`.
    pub brand: Option<String>,
    /// `light` or `dark`.
    pub mode: Option<String>,
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
}

/// The clinic's settings.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicSettings {
    /// Display name.
    pub name: String,
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
}

impl From<app::ClinicSettings> for ClinicSettings {
    fn from(settings: app::ClinicSettings) -> Self {
        Self {
            name: settings.name,
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
            },
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
}

/// The clinic's settings: profile, GSTIN, time zone, branding, prescription footer, address,
/// phone and UPI ID.
#[utoipa::path(
    get,
    path = "/api/v1/settings/clinic",
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
            }),
    };
    let settings = app::update(state.db(), &request.actor, request.request_id, changes).await?;
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        "clinic settings changed"
    );
    Ok(Json(settings.into()))
}
