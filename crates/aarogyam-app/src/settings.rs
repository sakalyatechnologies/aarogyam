//! The clinic's own settings: names, GSTIN, time zone, branding, prescription footer, the
//! default branch's address and phone, and the UPI ID shown on bills.

use aarogyam_dal::settings::{self as dal, SettingsRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::booking::{BookingError, BookingSettings};
use aarogyam_domain::clinic::{
    Address, BrandColor, ClinicName, ClinicTimezone, Gstin, SettingsError, ThemeMode, UpiId,
    legal_name, prescription_footer,
};
use aarogyam_domain::letterhead::{Letterhead, LetterheadChanges};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use sakalya_types::{CallingCode, PhoneE164};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;
use crate::self_booking::{read_settings, settings_value};

/// The clinic's settings as the API shows them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicSettings {
    /// Display name.
    pub name: String,
    /// Registered legal name.
    pub legal_name: Option<String>,
    /// GST identification number.
    pub gstin: Option<String>,
    /// IANA time zone.
    pub timezone: String,
    /// Brand colour, `#RRGGBB`.
    pub brand: Option<String>,
    /// `light` or `dark`.
    pub mode: Option<String>,
    /// Footer printed on prescriptions.
    pub prescription_footer: Option<String>,
    /// The default branch's address.
    pub address: Address,
    /// The default branch's phone in `E.164`.
    pub phone: Option<String>,
    /// UPI ID for payments, such as `clinic@okicici`.
    pub upi_id: Option<String>,
    /// Online booking settings.
    pub booking: BookingSettings,
    /// The letterhead printed on the clinic's documents.
    pub letterhead: Letterhead,
}

/// Address parts as received; each replaces the stored part, and empty clears it.
#[derive(Debug, Clone, Default)]
pub struct AddressInput {
    /// House, building and street.
    pub line1: String,
    /// Area or landmark.
    pub line2: String,
    /// City or town.
    pub city: String,
    /// State or union territory.
    pub state: String,
    /// Six-digit PIN code.
    pub pincode: String,
}

/// Changes to the settings, as received. `None` leaves a setting as it is; an empty string
/// clears an optional one. A given address replaces the whole address.
#[derive(Debug, Clone, Default)]
pub struct SettingsChanges {
    /// Display name.
    pub name: Option<String>,
    /// Registered legal name.
    pub legal_name: Option<String>,
    /// GST identification number.
    pub gstin: Option<String>,
    /// IANA time zone.
    pub timezone: Option<String>,
    /// Brand colour, `#RRGGBB`.
    pub brand: Option<String>,
    /// `light` or `dark`.
    pub mode: Option<String>,
    /// Footer printed on prescriptions.
    pub prescription_footer: Option<String>,
    /// The default branch's address.
    pub address: Option<AddressInput>,
    /// The default branch's phone; +91 is assumed without a country code.
    pub phone: Option<String>,
    /// UPI ID for payments.
    pub upi_id: Option<String>,
    /// Online booking changes.
    pub booking: BookingChanges,
    /// Letterhead changes.
    pub letterhead: Option<LetterheadChanges>,
}

/// Changes to the online booking settings; `None` leaves a value as it is.
#[derive(Debug, Clone, Copy, Default)]
pub struct BookingChanges {
    /// Whether the public booking page works.
    pub enabled: Option<bool>,
    /// Slot length in minutes.
    pub slot_minutes: Option<u16>,
    /// Buffer around other appointments in minutes.
    pub buffer_minutes: Option<u16>,
    /// Whether bookings are confirmed at once.
    pub auto_confirm: Option<bool>,
    /// How many days ahead patients may book.
    pub horizon_days: Option<u16>,
    /// Minimum notice in minutes.
    pub min_notice_minutes: Option<u16>,
}

fn text(object: &Value, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Sets or removes `key` in a settings object, keeping every other key.
fn put(object: &mut Value, key: &str, value: Option<&str>) {
    if !object.is_object() {
        *object = Value::Object(Map::new());
    }
    if let Value::Object(map) = object {
        match value {
            Some(value) => {
                map.insert(key.to_owned(), Value::String(value.to_owned()));
            }
            None => {
                map.remove(key);
            }
        }
    }
}

/// Sets `key` in a settings object to a JSON value, keeping every other key.
pub(crate) fn put_value(object: &mut Value, key: &str, value: Value) {
    if !object.is_object() {
        *object = Value::Object(Map::new());
    }
    if let Value::Object(map) = object {
        map.insert(key.to_owned(), value);
    }
}

fn view(row: &SettingsRow) -> ClinicSettings {
    let address = row.address.clone().unwrap_or(Value::Null);
    ClinicSettings {
        name: row.name.clone(),
        legal_name: row.legal_name.clone(),
        gstin: row.gstin.clone(),
        timezone: row.timezone.clone(),
        brand: text(&row.branding, "brand"),
        mode: text(&row.branding, "mode"),
        prescription_footer: text(&row.prescription, "footer"),
        address: Address {
            line1: text(&address, "line1"),
            line2: text(&address, "line2"),
            city: text(&address, "city"),
            state: text(&address, "state"),
            pincode: text(&address, "pincode"),
        },
        phone: row.phone_e164.clone(),
        upi_id: text(&row.billing, "upi_id"),
        booking: read_settings(&row.booking),
        letterhead: Letterhead::from_value(row.branding.get("letterhead").unwrap_or(&Value::Null)),
    }
}

/// Empty means none; otherwise `parse` decides.
fn optional<T>(
    input: &str,
    parse: impl FnOnce(&str) -> Result<T, SettingsError>,
) -> Result<Option<T>, AppError> {
    if input.trim().is_empty() {
        Ok(None)
    } else {
        parse(input).map(Some).map_err(AppError::settings)
    }
}

/// Applies letterhead changes to the branding object, keeping its other keys.
fn apply_letterhead(
    branding: &mut Value,
    changes: Option<&LetterheadChanges>,
) -> Result<(), AppError> {
    let Some(changes) = changes else {
        return Ok(());
    };
    let mut letterhead = Letterhead::from_value(branding.get("letterhead").unwrap_or(&Value::Null));
    letterhead
        .apply(changes)
        .map_err(|error| AppError::invalid(error.field(), error))?;
    put_value(branding, "letterhead", letterhead.to_value());
    Ok(())
}

/// Applies `changes` to the stored row, validating each given setting.
fn apply(mut row: SettingsRow, changes: &SettingsChanges) -> Result<SettingsRow, AppError> {
    if let Some(name) = &changes.name {
        ClinicName::parse(name)
            .map_err(AppError::settings)?
            .as_str()
            .clone_into(&mut row.name);
    }
    if let Some(name) = &changes.legal_name {
        row.legal_name = legal_name(name).map_err(AppError::settings)?;
    }
    if let Some(gstin) = &changes.gstin {
        row.gstin = optional(gstin, Gstin::parse)?.map(|gstin| gstin.as_str().to_owned());
    }
    if let Some(zone) = &changes.timezone {
        ClinicTimezone::parse(zone)
            .map_err(AppError::settings)?
            .as_str()
            .clone_into(&mut row.timezone);
    }
    if let Some(brand) = &changes.brand {
        let brand = optional(brand, BrandColor::parse)?;
        put(
            &mut row.branding,
            "brand",
            brand.as_ref().map(BrandColor::as_str),
        );
    }
    if let Some(mode) = &changes.mode {
        let mode = optional(mode, ThemeMode::parse)?;
        put(&mut row.branding, "mode", mode.map(ThemeMode::as_str));
    }
    if let Some(footer) = &changes.prescription_footer {
        let footer = prescription_footer(footer).map_err(AppError::settings)?;
        put(&mut row.prescription, "footer", footer.as_deref());
    }
    if let Some(upi_id) = &changes.upi_id {
        let upi_id = optional(upi_id, UpiId::parse)?;
        put(
            &mut row.billing,
            "upi_id",
            upi_id.as_ref().map(UpiId::as_str),
        );
    }
    apply_letterhead(&mut row.branding, changes.letterhead.as_ref())?;
    let booking = &changes.booking;
    let mut settings = read_settings(&row.booking);
    settings.enabled = booking.enabled.unwrap_or(settings.enabled);
    settings.slot_minutes = booking.slot_minutes.unwrap_or(settings.slot_minutes);
    settings.buffer_minutes = booking.buffer_minutes.unwrap_or(settings.buffer_minutes);
    settings.auto_confirm = booking.auto_confirm.unwrap_or(settings.auto_confirm);
    settings.horizon_days = booking.horizon_days.unwrap_or(settings.horizon_days);
    settings.min_notice_minutes = booking
        .min_notice_minutes
        .unwrap_or(settings.min_notice_minutes);
    row.booking = settings_value(&settings.validate().map_err(|error| {
        let field = match error {
            BookingError::SlotMinutes => "booking.slot_minutes",
            BookingError::BufferMinutes => "booking.buffer_minutes",
            BookingError::HorizonDays => "booking.horizon_days",
            BookingError::MinNotice => "booking.min_notice_minutes",
        };
        AppError::invalid(field, error)
    })?);
    if changes.address.is_some() || changes.phone.is_some() {
        if row.branch_id.is_none() {
            return Err(AppError::Conflict("the clinic has no main branch"));
        }
        if let Some(input) = &changes.address {
            let address = Address::parse(
                &input.line1,
                &input.line2,
                &input.city,
                &input.state,
                &input.pincode,
            )
            .map_err(AppError::settings)?;
            let mut stored = row.address.take().unwrap_or(Value::Null);
            for (key, value) in [
                ("line1", &address.line1),
                ("line2", &address.line2),
                ("city", &address.city),
                ("state", &address.state),
                ("pincode", &address.pincode),
            ] {
                put(&mut stored, key, value.as_deref());
            }
            row.address = Some(stored);
        }
        if let Some(phone) = &changes.phone {
            row.phone_e164 = optional(phone, |text| {
                PhoneE164::parse_with_default(text, CallingCode::INDIA)
                    .map_err(|_| SettingsError::Phone)
            })?
            .map(|phone| phone.as_e164().to_owned());
        }
    }
    Ok(row)
}

/// The clinic's settings.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Db`] on database failures.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<ClinicSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let row = dal::get(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        Ok(view(&row))
    })
    .await
}

/// Changes the clinic's settings. The change history records what changed.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] naming the first bad
/// setting; [`AppError::Db`] on database failures.
pub async fn update(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    changes: SettingsChanges,
) -> Result<ClinicSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let row = dal::get_for_update(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let row = apply(row, &changes)?;
        if let Some(ids) = changes
            .letterhead
            .as_ref()
            .and_then(|c| c.doctor_ids.as_ref())
        {
            for id in ids {
                if aarogyam_dal::schedule::practitioner(tx.conn(), *id)
                    .await?
                    .is_none()
                {
                    return Err(AppError::invalid(
                        "letterhead.doctor_ids",
                        "no such doctor in this clinic",
                    ));
                }
            }
        }
        dal::save(tx.conn(), &row).await?;
        Ok(view(&row))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stored() -> SettingsRow {
        SettingsRow {
            name: "Alpha Dental".into(),
            legal_name: None,
            gstin: None,
            timezone: "Asia/Kolkata".into(),
            branding: json!({ "logo": "kept" }),
            billing: json!({}),
            prescription: json!({ "footer": "Old footer" }),
            booking: json!({}),
            branch_id: Some(Uuid::nil()),
            address: Some(json!({})),
            phone_e164: None,
        }
    }

    #[test]
    fn changes_merge_into_the_stored_settings() {
        let changes = SettingsChanges {
            name: Some(" Alpha  Dental Care ".into()),
            gstin: Some("27aapfu0939f1zv".into()),
            brand: Some("#0f766e".into()),
            mode: Some("dark".into()),
            prescription_footer: Some(String::new()),
            address: Some(AddressInput {
                line1: "12 MG Road".into(),
                city: "Pune".into(),
                pincode: "411001".into(),
                ..AddressInput::default()
            }),
            phone: Some("020 2612 3456".into()),
            upi_id: Some("alpha@okicici".into()),
            ..SettingsChanges::default()
        };
        let row = apply(stored(), &changes).unwrap();
        assert_eq!(
            row.branding,
            json!({ "logo": "kept", "brand": "#0F766E", "mode": "dark" })
        );
        assert_eq!(row.prescription, json!({}));
        assert_eq!(row.billing, json!({ "upi_id": "alpha@okicici" }));
        assert_eq!(row.phone_e164.as_deref(), Some("+912026123456"));
        let settings = view(&row);
        assert_eq!(settings.name, "Alpha Dental Care");
        assert_eq!(settings.gstin.as_deref(), Some("27AAPFU0939F1ZV"));
        assert_eq!(settings.address.city.as_deref(), Some("Pune"));
        assert_eq!(settings.address.line2, None);
        assert_eq!(settings.prescription_footer, None);
    }

    #[test]
    fn bad_settings_name_the_field() {
        let cases = [
            (
                SettingsChanges {
                    gstin: Some("27AAPFU0939F1ZW".into()),
                    ..SettingsChanges::default()
                },
                "gstin",
            ),
            (
                SettingsChanges {
                    timezone: Some("UTC".into()),
                    ..SettingsChanges::default()
                },
                "timezone",
            ),
            (
                SettingsChanges {
                    brand: Some("teal".into()),
                    ..SettingsChanges::default()
                },
                "branding.brand",
            ),
            (
                SettingsChanges {
                    upi_id: Some("alpha".into()),
                    ..SettingsChanges::default()
                },
                "upi_id",
            ),
            (
                SettingsChanges {
                    phone: Some("12".into()),
                    ..SettingsChanges::default()
                },
                "phone",
            ),
            (
                SettingsChanges {
                    address: Some(AddressInput {
                        pincode: "12".into(),
                        ..AddressInput::default()
                    }),
                    ..SettingsChanges::default()
                },
                "address.pincode",
            ),
        ];
        for (changes, field) in cases {
            match apply(stored(), &changes) {
                Err(AppError::Invalid { field: got, .. }) => assert_eq!(got, field),
                other => panic!("{field}: {other:?}"),
            }
        }
    }
}
