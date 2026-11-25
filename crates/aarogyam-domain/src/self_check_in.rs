//! Patients checking themselves in by scanning the clinic's QR code: the choices the page
//! offers (data in `specialties/dental/self-check-in.json`), the postal address a patient
//! may give, and the request as it is kept until the front desk handles it. Pure rules: the
//! phone, name and text checks that need other types live in the app layer.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::clinic::Address;

/// Most arrival requests a clinic may have waiting; more are refused, none are dropped.
pub const MAX_PENDING: i64 = 200;
/// Most requests one clinic accepts per hour.
pub const CLINIC_PER_HOUR: i64 = 120;
/// Most requests one phone number may make per hour.
pub const PHONE_PER_HOUR: i64 = 6;
/// Longest address part, in characters.
pub const MAX_ADDRESS_PART: usize = 200;

const SOURCE: &str = include_str!("../../../specialties/dental/self-check-in.json");

/// A choice the page offers: a stable code and its words.
#[derive(Debug, Clone, Deserialize)]
pub struct Choice {
    /// What the API carries.
    pub code: String,
    /// What the patient reads.
    pub label: String,
    /// For a health flag: the condition recorded when the desk accepts.
    #[serde(default)]
    pub condition: Option<String>,
}

/// `specialties/dental/self-check-in.json`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Catalogue {
    /// Why the patient came.
    pub reasons: Vec<Choice>,
    /// "Any of these?" health chips.
    pub health_flags: Vec<Choice>,
    /// What the contact person is to the patient.
    pub relations: Vec<Choice>,
}

/// The choices, read once; empty if the data file were unreadable (a test prevents that).
#[must_use]
pub fn catalogue() -> &'static Catalogue {
    static CELL: OnceLock<Catalogue> = OnceLock::new();
    CELL.get_or_init(|| serde_json::from_str(SOURCE).unwrap_or_default())
}

impl Catalogue {
    /// Whether `code` is one of the reasons.
    #[must_use]
    pub fn has_reason(&self, code: &str) -> bool {
        self.reasons.iter().any(|c| c.code == code)
    }

    /// The label of a reason, for the token's reason line.
    #[must_use]
    pub fn reason_label(&self, code: &str) -> Option<&str> {
        self.reasons
            .iter()
            .find(|c| c.code == code)
            .map(|c| c.label.as_str())
    }

    /// The health flag with `code`.
    #[must_use]
    pub fn health_flag(&self, code: &str) -> Option<&Choice> {
        self.health_flags.iter().find(|c| c.code == code)
    }

    /// Whether `code` is a relation.
    #[must_use]
    pub fn has_relation(&self, code: &str) -> bool {
        self.relations.iter().any(|c| c.code == code)
    }
}

/// Why an address was refused. Messages never echo the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AddressError {
    /// A part is too long or has control characters.
    #[error("address parts must be at most {MAX_ADDRESS_PART} characters of plain text")]
    Text,
    /// The PIN code is not six digits.
    #[error("pincode must be six digits, not starting with 0")]
    Pincode,
}

/// A patient's postal address, every part optional; the PIN code, when given, is six digits.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatientAddress {
    /// House, building and street.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line1: Option<String>,
    /// Area or landmark.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locality: Option<String>,
    /// City or town.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    /// District.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub district: Option<String>,
    /// State or union territory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// Six-digit PIN code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pincode: Option<String>,
}

fn part(text: Option<&str>) -> Result<Option<String>, AddressError> {
    let Some(text) = text else { return Ok(None) };
    if text.chars().any(char::is_control) {
        return Err(AddressError::Text);
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > MAX_ADDRESS_PART {
        return Err(AddressError::Text);
    }
    Ok(Some(text))
}

/// The parts of an address as received, each optional.
#[derive(Debug, Clone, Copy, Default)]
pub struct AddressParts<'a> {
    /// House, building and street.
    pub line1: Option<&'a str>,
    /// Area or landmark.
    pub locality: Option<&'a str>,
    /// City or town.
    pub city: Option<&'a str>,
    /// District.
    pub district: Option<&'a str>,
    /// State or union territory.
    pub state: Option<&'a str>,
    /// Six-digit PIN code.
    pub pincode: Option<&'a str>,
}

impl PatientAddress {
    /// Validates each part; empty parts are left out.
    ///
    /// # Errors
    /// [`AddressError::Text`] for a long part; [`AddressError::Pincode`] for a bad PIN code.
    pub fn parse(parts: AddressParts<'_>) -> Result<Self, AddressError> {
        let pincode = match parts.pincode.map(str::trim).filter(|p| !p.is_empty()) {
            Some(pin) => {
                Address::parse("", "", "", "", pin)
                    .map_err(|_| AddressError::Pincode)?
                    .pincode
            }
            None => None,
        };
        Ok(Self {
            line1: part(parts.line1)?,
            locality: part(parts.locality)?,
            city: part(parts.city)?,
            district: part(parts.district)?,
            state: part(parts.state)?,
            pincode,
        })
    }

    /// Whether no part is given.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// An arrival request as kept until the desk handles it. Personal and health data: it is
/// cleared the moment the request is accepted or dismissed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arrival {
    /// The patient's first name.
    pub first_name: String,
    /// The patient's last name, when given.
    #[serde(default)]
    pub last_name: Option<String>,
    /// The phone, `E.164`.
    pub phone: String,
    /// Reason codes.
    pub reasons: Vec<String>,
    /// A line in the patient's words.
    #[serde(default)]
    pub reason_text: Option<String>,
    /// Whether the person filling the form is the patient.
    pub for_self: bool,
    /// The person filling it, when not the patient.
    #[serde(default)]
    pub contact_name: Option<String>,
    /// What that person is to the patient.
    #[serde(default)]
    pub relation: Option<String>,
    /// Email.
    #[serde(default)]
    pub email: Option<String>,
    /// `female`, `male` or `other`.
    #[serde(default)]
    pub sex: Option<String>,
    /// Age in years.
    #[serde(default)]
    pub age_years: Option<u16>,
    /// Date of birth, `YYYY-MM-DD`.
    #[serde(default)]
    pub date_of_birth: Option<String>,
    /// Address.
    #[serde(default)]
    pub address: Option<PatientAddress>,
    /// Health flag codes.
    #[serde(default)]
    pub health: Vec<String>,
    /// Allergies in the patient's words.
    #[serde(default)]
    pub allergies_text: Option<String>,
    /// Whether they ticked reminders.
    #[serde(default)]
    pub reminders: bool,
    /// The published notice shown, when the clinic has one.
    #[serde(default)]
    pub notice_id: Option<uuid::Uuid>,
    /// The notice version shown.
    pub notice_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_data_file_reads() {
        let all = catalogue();
        assert!(all.has_reason("tooth_pain"));
        assert!(
            all.health_flag("diabetes")
                .is_some_and(|c| c.condition.is_some())
        );
        assert!(all.has_relation("parent"));
        assert!(!all.has_reason("nonsense"));
    }

    #[test]
    fn address_parts_are_checked() {
        let ok = PatientAddress::parse(AddressParts {
            line1: Some(" 12  Main Rd "),
            pincode: Some("411001"),
            ..AddressParts::default()
        });
        assert_eq!(
            ok.as_ref().ok().and_then(|a| a.line1.as_deref()),
            Some("12 Main Rd")
        );
        let bad_pin = PatientAddress::parse(AddressParts {
            pincode: Some("011001"),
            ..AddressParts::default()
        });
        assert_eq!(bad_pin, Err(AddressError::Pincode));
        let bad_text = PatientAddress::parse(AddressParts {
            line1: Some("a\u{7}b"),
            ..AddressParts::default()
        });
        assert_eq!(bad_text, Err(AddressError::Text));
        let blank = PatientAddress::parse(AddressParts {
            line1: Some("  "),
            ..AddressParts::default()
        });
        assert!(blank.is_ok_and(|a| a.is_empty()));
    }
}
