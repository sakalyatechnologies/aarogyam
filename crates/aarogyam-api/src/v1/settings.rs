//! The clinic's own settings.

use aarogyam_app::settings::{self as app, AddressInput, SettingsChanges};
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
    };
    let settings = app::update(state.db(), &request.actor, request.request_id, changes).await?;
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        "clinic settings changed"
    );
    Ok(Json(settings.into()))
}
