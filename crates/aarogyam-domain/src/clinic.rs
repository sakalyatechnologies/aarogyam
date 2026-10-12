//! A clinic's own settings: its names, tax number, time zone, address, payment ID and look.

use std::fmt;

/// Why a clinic setting was rejected. Messages name the field, never the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    /// The clinic's name is empty or too long.
    #[error("name must be 1 to 200 characters")]
    Name,
    /// The legal name is too long.
    #[error("legal_name must be at most 200 characters")]
    LegalName,
    /// The GSTIN is malformed or its check character is wrong.
    #[error("gstin must be a valid 15-character GSTIN")]
    Gstin,
    /// A time zone this build doesn't support.
    #[error("timezone must be Asia/Kolkata")]
    Timezone,
    /// The brand colour is not `#RRGGBB`.
    #[error("brand must be a colour like #0F766E")]
    BrandColor,
    /// The theme mode is not `light` or `dark`.
    #[error("mode must be light, dark or auto")]
    ThemeMode,
    /// The prescription footer is too long.
    #[error("prescription_footer must be at most 500 characters")]
    Footer,
    /// An address line, city or state is too long.
    #[error("address lines, city and state must be at most 200 characters")]
    AddressLine,
    /// The PIN code is not six digits.
    #[error("pincode must be six digits, not starting with 0")]
    Pincode,
    /// The phone number is not a valid number.
    #[error("phone is not a valid phone number")]
    Phone,
    /// The UPI ID is not like `name@bank`.
    #[error("upi_id must look like name@bank")]
    UpiId,
}

/// Trims, collapses inner whitespace, and refuses control characters.
fn clean_text(text: &str) -> Option<String> {
    if text.chars().any(char::is_control) {
        return None;
    }
    Some(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// A clinic's display name: 1 to 200 characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicName(String);

impl ClinicName {
    /// Parses a name, collapsing whitespace.
    ///
    /// # Errors
    /// [`SettingsError::Name`] when it is empty, too long or has control characters.
    pub fn parse(text: &str) -> Result<Self, SettingsError> {
        let name = clean_text(text).ok_or(SettingsError::Name)?;
        if name.is_empty() || name.chars().count() > 200 {
            return Err(SettingsError::Name);
        }
        Ok(Self(name))
    }

    /// The name.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Optional free text up to `max` characters; empty means none.
fn optional_text(
    text: &str,
    max: usize,
    error: SettingsError,
) -> Result<Option<String>, SettingsError> {
    let text = clean_text(text).ok_or(error)?;
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > max {
        return Err(error);
    }
    Ok(Some(text))
}

/// The registered legal name; empty means none.
///
/// # Errors
/// [`SettingsError::LegalName`] when it is too long.
pub fn legal_name(text: &str) -> Result<Option<String>, SettingsError> {
    optional_text(text, 200, SettingsError::LegalName)
}

/// The footer printed on prescriptions; empty means none. Line breaks are kept.
///
/// # Errors
/// [`SettingsError::Footer`] when it is too long or has other control characters.
pub fn prescription_footer(text: &str) -> Result<Option<String>, SettingsError> {
    let lines: Option<Vec<String>> = text.trim().lines().map(clean_text).collect();
    let footer = lines.ok_or(SettingsError::Footer)?.join("\n");
    if footer.trim().is_empty() {
        return Ok(None);
    }
    if footer.chars().count() > 500 {
        return Err(SettingsError::Footer);
    }
    Ok(Some(footer))
}

const GSTIN_CHARS: &[u8; 36] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// An Indian GST identification number, such as `27AAPFU0939F1ZV`: a state code, the PAN, an
/// entity number, `Z`, and a check character.
#[derive(Clone, PartialEq, Eq)]
pub struct Gstin(String);

impl Gstin {
    /// Parses a GSTIN, ignoring case and surrounding space, and checks its check character.
    ///
    /// # Errors
    /// [`SettingsError::Gstin`] when the shape, state code or check character is wrong.
    pub fn parse(text: &str) -> Result<Self, SettingsError> {
        let gstin = text.trim().to_ascii_uppercase();
        let bytes = gstin.as_bytes();
        let shape = bytes.len() == 15
            && bytes[..2].iter().all(u8::is_ascii_digit)
            && bytes[2..7].iter().all(u8::is_ascii_uppercase)
            && bytes[7..11].iter().all(u8::is_ascii_digit)
            && bytes[11].is_ascii_uppercase()
            && (bytes[12].is_ascii_uppercase() || matches!(bytes[12], b'1'..=b'9'))
            && bytes[13] == b'Z'
            && bytes[14].is_ascii_alphanumeric();
        if !shape {
            return Err(SettingsError::Gstin);
        }
        let state: u8 = gstin[..2].parse().map_err(|_| SettingsError::Gstin)?;
        if !matches!(state, 1..=38 | 97 | 99) {
            return Err(SettingsError::Gstin);
        }
        if Self::check_char(&bytes[..14]) != Some(bytes[14]) {
            return Err(SettingsError::Gstin);
        }
        Ok(Self(gstin))
    }

    /// The GSTN check character: a weighted sum of the first 14 characters in base 36.
    fn check_char(body: &[u8]) -> Option<u8> {
        let mut sum = 0_usize;
        for (index, byte) in body.iter().enumerate() {
            let value = GSTIN_CHARS.iter().position(|c| c == byte)?;
            let product = value * if index % 2 == 0 { 1 } else { 2 };
            sum += product / 36 + product % 36;
        }
        GSTIN_CHARS.get((36 - sum % 36) % 36).copied()
    }

    /// The GSTIN in capitals.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Gstin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Gstin(..)")
    }
}

/// The time zones a clinic may use. Only India for now: dates, financial years and reminders
/// are computed for it (`aarogyam_app::clock`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClinicTimezone {
    /// India Standard Time.
    Kolkata,
}

impl ClinicTimezone {
    /// Every supported zone, for pickers.
    pub const ALL: [Self; 1] = [Self::Kolkata];

    /// The IANA name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Kolkata => "Asia/Kolkata",
        }
    }

    /// Parses an IANA name.
    ///
    /// # Errors
    /// [`SettingsError::Timezone`] for any zone not supported.
    pub fn parse(text: &str) -> Result<Self, SettingsError> {
        Self::ALL
            .into_iter()
            .find(|zone| zone.as_str() == text.trim())
            .ok_or(SettingsError::Timezone)
    }
}

/// A brand colour as `#RRGGBB`, stored in capitals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrandColor(String);

impl BrandColor {
    /// Parses `#RRGGBB`.
    ///
    /// # Errors
    /// [`SettingsError::BrandColor`] for anything else.
    pub fn parse(text: &str) -> Result<Self, SettingsError> {
        let text = text.trim();
        let hex = text.strip_prefix('#').ok_or(SettingsError::BrandColor)?;
        if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SettingsError::BrandColor);
        }
        Ok(Self(format!("#{}", hex.to_ascii_uppercase())))
    }

    /// The colour, such as `#0F766E`.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The portal's light or dark look.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    /// Light backgrounds.
    Light,
    /// Dark backgrounds.
    Dark,
    /// Follow the device's setting.
    Auto,
}

impl ThemeMode {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
            Self::Auto => "auto",
        }
    }

    /// Parses `light`, `dark` or `auto`.
    ///
    /// # Errors
    /// [`SettingsError::ThemeMode`] for anything else.
    pub fn parse(text: &str) -> Result<Self, SettingsError> {
        match text.trim() {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            "auto" => Ok(Self::Auto),
            _ => Err(SettingsError::ThemeMode),
        }
    }
}

/// A postal address in India. Every part is optional; a PIN code, when given, is six digits.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
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

impl Address {
    /// Validates each part; empty parts are left out.
    ///
    /// # Errors
    /// [`SettingsError::AddressLine`] for a part over 200 characters; [`SettingsError::Pincode`]
    /// for a PIN code that isn't six digits starting 1 to 9.
    pub fn parse(
        line1: &str,
        line2: &str,
        city: &str,
        state: &str,
        pincode: &str,
    ) -> Result<Self, SettingsError> {
        let part = |text: &str| optional_text(text, 200, SettingsError::AddressLine);
        let pincode = pincode.trim().replace(' ', "");
        let pincode = if pincode.is_empty() {
            None
        } else if pincode.len() == 6
            && pincode.bytes().all(|byte| byte.is_ascii_digit())
            && !pincode.starts_with('0')
        {
            Some(pincode)
        } else {
            return Err(SettingsError::Pincode);
        };
        Ok(Self {
            line1: part(line1)?,
            line2: part(line2)?,
            city: part(city)?,
            state: part(state)?,
            pincode,
        })
    }
}

/// A UPI payment address (VPA), such as `sunrisedental@okicici`, stored in lower case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpiId(String);

impl UpiId {
    /// Parses `name@bank`: a name of 2 to 256 letters, digits, dots, hyphens or underscores,
    /// and a handle of 2 to 64 letters or digits starting with a letter.
    ///
    /// # Errors
    /// [`SettingsError::UpiId`] for anything else.
    pub fn parse(text: &str) -> Result<Self, SettingsError> {
        let text = text.trim().to_ascii_lowercase();
        let (name, handle) = text.split_once('@').ok_or(SettingsError::UpiId)?;
        let name_ok = (2..=256).contains(&name.len())
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
        let handle_ok = (2..=64).contains(&handle.len())
            && handle.bytes().all(|byte| byte.is_ascii_alphanumeric())
            && handle
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_alphabetic());
        if name_ok && handle_ok {
            Ok(Self(text))
        } else {
            Err(SettingsError::UpiId)
        }
    }

    /// The UPI ID.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gstins_are_checked() {
        let gstin = Gstin::parse(" 27aapfu0939f1zv ").unwrap();
        assert_eq!(gstin.as_str(), "27AAPFU0939F1ZV");
        assert!(Gstin::parse("29AAGCB7383J1Z4").is_ok());
        assert_eq!(format!("{gstin:?}"), "Gstin(..)");
        for bad in [
            "27AAPFU0939F1ZW", // wrong check character
            "27AAPFU0939F1Z",  // short
            "27AAPFU0939F1XV", // no Z
            "00AAPFU0939F1ZV", // no such state
            "2AAAPFU0939F1ZV",
            "",
        ] {
            assert_eq!(Gstin::parse(bad), Err(SettingsError::Gstin), "{bad}");
        }
    }

    #[test]
    fn names_footers_and_zones() {
        assert_eq!(
            ClinicName::parse("  Sunrise   Dental ").unwrap().as_str(),
            "Sunrise Dental"
        );
        assert_eq!(ClinicName::parse(" "), Err(SettingsError::Name));
        assert_eq!(
            ClinicName::parse(&"x".repeat(201)),
            Err(SettingsError::Name)
        );
        assert_eq!(legal_name("").unwrap(), None);
        assert_eq!(
            prescription_footer(" Dr Rao, BDS \n  Reg. 1234 ")
                .unwrap()
                .as_deref(),
            Some("Dr Rao, BDS\nReg. 1234")
        );
        assert_eq!(prescription_footer("  ").unwrap(), None);
        assert_eq!(
            prescription_footer(&"x".repeat(501)),
            Err(SettingsError::Footer)
        );
        assert_eq!(
            ClinicTimezone::parse("Asia/Kolkata"),
            Ok(ClinicTimezone::Kolkata)
        );
        assert_eq!(
            ClinicTimezone::parse("Europe/London"),
            Err(SettingsError::Timezone)
        );
    }

    #[test]
    fn colours_modes_addresses_and_upi() {
        assert_eq!(BrandColor::parse("#0f766e").unwrap().as_str(), "#0F766E");
        for bad in ["0F766E", "#0F766", "#GGGGGG", "teal"] {
            assert_eq!(BrandColor::parse(bad), Err(SettingsError::BrandColor));
        }
        assert_eq!(ThemeMode::parse("dark"), Ok(ThemeMode::Dark));
        assert_eq!(ThemeMode::parse(" auto "), Ok(ThemeMode::Auto));
        assert_eq!(ThemeMode::Auto.as_str(), "auto");
        assert_eq!(ThemeMode::parse("dim"), Err(SettingsError::ThemeMode));

        let address = Address::parse("12 MG Road", "", " Pune ", "Maharashtra", "411 001").unwrap();
        assert_eq!(address.city.as_deref(), Some("Pune"));
        assert_eq!(address.line2, None);
        assert_eq!(address.pincode.as_deref(), Some("411001"));
        assert_eq!(
            Address::parse("", "", "", "", "011001"),
            Err(SettingsError::Pincode)
        );
        assert_eq!(
            Address::parse(&"x".repeat(201), "", "", "", ""),
            Err(SettingsError::AddressLine)
        );

        assert_eq!(
            UpiId::parse(" SunriseDental@OkICICI ").unwrap().as_str(),
            "sunrisedental@okicici"
        );
        for bad in [
            "sunrise",
            "s@okicici",
            "sunrise@1bank",
            "sun rise@ybl",
            "a@b@c",
        ] {
            assert_eq!(UpiId::parse(bad), Err(SettingsError::UpiId), "{bad}");
        }
    }
}
