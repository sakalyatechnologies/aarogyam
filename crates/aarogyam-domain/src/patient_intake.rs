//! The case-paper fields clinics collect at registration: blood group, a second phone, an
//! emergency contact, how the patient heard of the clinic, the family doctor and so on. Pure
//! rules: every value is checked here, and the error names the field, never the value.

use sakalya_types::{CallingCode, PhoneE164};
use serde::{Deserialize, Serialize};
use time::Date;

use crate::clinical::clinical_text;

/// Why an intake field was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{field}: {message}")]
pub struct IntakeError {
    /// The field at fault.
    pub field: &'static str,
    /// What is wrong, without the value.
    pub message: String,
}

fn bad(field: &'static str, message: impl Into<String>) -> IntakeError {
    IntakeError {
        field,
        message: message.into(),
    }
}

macro_rules! code_enum {
    ($(#[$doc:meta])* $name:ident, $field:literal { $($variant:ident => $text:literal, $label:literal),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum $name {
            $(#[doc = $label] #[serde(rename = $text)] $variant,)*
        }

        impl $name {
            /// Every choice in the order the form lists them: code and label.
            pub const ALL: &'static [(&'static str, &'static str)] = &[$(($text, $label)),*];

            /// The stored and API value.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text,)* }
            }

            /// Parses a code.
            ///
            /// # Errors
            /// [`IntakeError`] naming the field for an unknown code.
            pub fn parse(text: &str) -> Result<Self, IntakeError> {
                match text.trim() { $($text => Ok(Self::$variant),)* _ => Err(bad($field, "unknown value")) }
            }
        }
    };
}

code_enum!(
    /// ABO and Rh blood group.
    BloodGroup, "blood_group" {
        APos => "A+", "A+",
        ANeg => "A-", "A-",
        BPos => "B+", "B+",
        BNeg => "B-", "B-",
        AbPos => "AB+", "AB+",
        AbNeg => "AB-", "AB-",
        OPos => "O+", "O+",
        ONeg => "O-", "O-",
    }
);

code_enum!(
    /// The best time to call the patient.
    CallTime, "call_time" {
        Morning => "morning", "Morning",
        Afternoon => "afternoon", "Afternoon",
        Evening => "evening", "Evening",
        Any => "any", "Any time",
    }
);

code_enum!(
    /// How the patient heard of the clinic.
    HeardVia, "heard_via" {
        FriendFamily => "friend_family", "Friend or family",
        Doctor => "doctor", "Doctor",
        Google => "google", "Google",
        SocialMedia => "social_media", "Social media",
        WalkBy => "walk_by", "Walked by",
        Other => "other", "Other",
    }
);

macro_rules! text_newtype {
    ($(#[$doc:meta])* $name:ident, $field:literal, $max:expr) => {
        $(#[$doc])*
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// Longest value, in characters.
            pub const MAX: usize = $max;

            /// Checks plain text of 1 to [`Self::MAX`] characters.
            ///
            /// # Errors
            /// [`IntakeError`] naming the field.
            pub fn parse(text: &str) -> Result<Self, IntakeError> {
                clinical_text(text, 1, Self::MAX)
                    .map(Self)
                    .map_err(|_| bad($field, format!("must be 1 to {} characters of text", Self::MAX)))
            }

            /// The text.
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

text_newtype!(
    /// The emergency contact's name, at most 120.
    EmergencyContactName, "emergency_contact_name", 120
);
text_newtype!(
    /// The family doctor's name, at most 120.
    FamilyDoctorName, "family_doctor_name", 120
);
text_newtype!(
    /// Who referred the patient, at most 120.
    ReferredBy, "referred_by", 120
);
text_newtype!(
    /// The patient's occupation, at most 80.
    Occupation, "occupation", 80
);
text_newtype!(
    /// The words after "Other" in how the patient heard of the clinic, at most 120.
    HeardViaText, "heard_via_text", 120
);
text_newtype!(
    /// The family doctor's address, at most 300.
    FamilyDoctorAddress, "family_doctor_address", 300
);
text_newtype!(
    /// The "Other ____" line of the health checklist, at most 300.
    HealthOther, "health_other", 300
);

/// The case-paper fields as received: every one optional, text as typed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawIntake {
    /// Blood group code.
    #[serde(default)]
    pub blood_group: Option<String>,
    /// Second phone ("Mobile 2").
    #[serde(default)]
    pub alt_phone: Option<String>,
    /// Emergency contact's name.
    #[serde(default)]
    pub emergency_contact_name: Option<String>,
    /// Emergency contact's phone.
    #[serde(default)]
    pub emergency_contact_phone: Option<String>,
    /// Who referred the patient.
    #[serde(default)]
    pub referred_by: Option<String>,
    /// Best time to call, a code.
    #[serde(default)]
    pub call_time: Option<String>,
    /// Occupation.
    #[serde(default)]
    pub occupation: Option<String>,
    /// How the patient heard of the clinic, a code.
    #[serde(default)]
    pub heard_via: Option<String>,
    /// The words for "Other".
    #[serde(default)]
    pub heard_via_text: Option<String>,
    /// Family doctor's name.
    #[serde(default)]
    pub family_doctor_name: Option<String>,
    /// Family doctor's phone.
    #[serde(default)]
    pub family_doctor_phone: Option<String>,
    /// Family doctor's address.
    #[serde(default)]
    pub family_doctor_address: Option<String>,
    /// The "Other ____" health line.
    #[serde(default)]
    pub health_other: Option<String>,
    /// Pregnant.
    #[serde(default)]
    pub pregnant: Option<bool>,
    /// Due date, `YYYY-MM-DD`.
    #[serde(default)]
    pub due_date: Option<String>,
    /// Nursing.
    #[serde(default)]
    pub nursing: Option<bool>,
}

/// The case-paper fields, checked. Every field is optional; an empty one is left out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatientIntake {
    /// Blood group.
    pub blood_group: Option<BloodGroup>,
    /// Second phone.
    pub alt_phone: Option<PhoneE164>,
    /// Emergency contact's name.
    pub emergency_contact_name: Option<EmergencyContactName>,
    /// Emergency contact's phone.
    pub emergency_contact_phone: Option<PhoneE164>,
    /// Who referred the patient.
    pub referred_by: Option<ReferredBy>,
    /// Best time to call.
    pub call_time: Option<CallTime>,
    /// Occupation.
    pub occupation: Option<Occupation>,
    /// How the patient heard of the clinic.
    pub heard_via: Option<HeardVia>,
    /// The words for "Other".
    pub heard_via_text: Option<HeardViaText>,
    /// Family doctor's name.
    pub family_doctor_name: Option<FamilyDoctorName>,
    /// Family doctor's phone.
    pub family_doctor_phone: Option<PhoneE164>,
    /// Family doctor's address.
    pub family_doctor_address: Option<FamilyDoctorAddress>,
    /// The "Other ____" health line.
    pub health_other: Option<HealthOther>,
    /// Pregnant.
    pub pregnant: Option<bool>,
    /// Due date.
    pub due_date: Option<Date>,
    /// Nursing.
    pub nursing: Option<bool>,
}

fn given(text: Option<&String>) -> Option<&str> {
    text.map(|t| t.trim()).filter(|t| !t.is_empty())
}

fn phone(text: Option<&String>, field: &'static str) -> Result<Option<PhoneE164>, IntakeError> {
    given(text)
        .map(|t| {
            PhoneE164::parse_with_default(t, CallingCode::INDIA)
                .map_err(|_| bad(field, "is not a valid phone number"))
        })
        .transpose()
}

fn e164(phone: Option<&PhoneE164>) -> Option<String> {
    phone.map(|p| p.as_e164().to_owned())
}

impl PatientIntake {
    /// Checks every field.
    ///
    /// # Errors
    /// [`IntakeError`] naming the first bad field.
    pub fn parse(raw: &RawIntake) -> Result<Self, IntakeError> {
        let due_date = given(raw.due_date.as_ref())
            .map(|t| {
                Date::parse(t, &time::format_description::well_known::Iso8601::DATE)
                    .map_err(|_| bad("due_date", "must be YYYY-MM-DD"))
            })
            .transpose()?;
        Ok(Self {
            blood_group: given(raw.blood_group.as_ref())
                .map(BloodGroup::parse)
                .transpose()?,
            alt_phone: phone(raw.alt_phone.as_ref(), "alt_phone")?,
            emergency_contact_name: given(raw.emergency_contact_name.as_ref())
                .map(EmergencyContactName::parse)
                .transpose()?,
            emergency_contact_phone: phone(
                raw.emergency_contact_phone.as_ref(),
                "emergency_contact_phone",
            )?,
            referred_by: given(raw.referred_by.as_ref())
                .map(ReferredBy::parse)
                .transpose()?,
            call_time: given(raw.call_time.as_ref())
                .map(CallTime::parse)
                .transpose()?,
            occupation: given(raw.occupation.as_ref())
                .map(Occupation::parse)
                .transpose()?,
            heard_via: given(raw.heard_via.as_ref())
                .map(HeardVia::parse)
                .transpose()?,
            heard_via_text: given(raw.heard_via_text.as_ref())
                .map(HeardViaText::parse)
                .transpose()?,
            family_doctor_name: given(raw.family_doctor_name.as_ref())
                .map(FamilyDoctorName::parse)
                .transpose()?,
            family_doctor_phone: phone(raw.family_doctor_phone.as_ref(), "family_doctor_phone")?,
            family_doctor_address: given(raw.family_doctor_address.as_ref())
                .map(FamilyDoctorAddress::parse)
                .transpose()?,
            health_other: given(raw.health_other.as_ref())
                .map(HealthOther::parse)
                .transpose()?,
            pregnant: raw.pregnant,
            due_date,
            nursing: raw.nursing,
        })
    }

    /// The fields as text again, the form the API sends.
    #[must_use]
    pub fn to_raw(&self) -> RawIntake {
        RawIntake {
            blood_group: self.blood_group.map(|v| v.as_str().to_owned()),
            alt_phone: e164(self.alt_phone.as_ref()),
            emergency_contact_name: self
                .emergency_contact_name
                .as_ref()
                .map(|v| v.as_str().to_owned()),
            emergency_contact_phone: e164(self.emergency_contact_phone.as_ref()),
            referred_by: self.referred_by.as_ref().map(|v| v.as_str().to_owned()),
            call_time: self.call_time.map(|v| v.as_str().to_owned()),
            occupation: self.occupation.as_ref().map(|v| v.as_str().to_owned()),
            heard_via: self.heard_via.map(|v| v.as_str().to_owned()),
            heard_via_text: self.heard_via_text.as_ref().map(|v| v.as_str().to_owned()),
            family_doctor_name: self
                .family_doctor_name
                .as_ref()
                .map(|v| v.as_str().to_owned()),
            family_doctor_phone: e164(self.family_doctor_phone.as_ref()),
            family_doctor_address: self
                .family_doctor_address
                .as_ref()
                .map(|v| v.as_str().to_owned()),
            health_other: self.health_other.as_ref().map(|v| v.as_str().to_owned()),
            pregnant: self.pregnant,
            due_date: self.due_date.map(|d| d.to_string()),
            nursing: self.nursing,
        }
    }

    /// Whether no field is given.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Fills this one's blank fields from `other`; never overwrites a given value.
    pub fn fill_from(&mut self, other: &Self) {
        macro_rules! fill {
            ($($f:ident),*) => { $(if self.$f.is_none() { self.$f.clone_from(&other.$f); })* };
        }
        fill!(
            blood_group,
            alt_phone,
            emergency_contact_name,
            emergency_contact_phone,
            referred_by,
            call_time,
            occupation,
            heard_via,
            heard_via_text,
            family_doctor_name,
            family_doctor_phone,
            family_doctor_address,
            health_other,
            pregnant,
            due_date,
            nursing
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_are_checked() {
        let ok = PatientIntake::parse(&RawIntake {
            blood_group: Some("AB-".into()),
            alt_phone: Some("98765 43210".into()),
            call_time: Some("evening".into()),
            ..RawIntake::default()
        })
        .unwrap_or_default();
        assert_eq!(ok.blood_group, Some(BloodGroup::AbNeg));
        assert_eq!(
            ok.alt_phone.as_ref().map(PhoneE164::as_e164),
            Some("+919876543210")
        );
        let bad_group = PatientIntake::parse(&RawIntake {
            blood_group: Some("C+".into()),
            ..RawIntake::default()
        });
        assert_eq!(bad_group.err().map(|e| e.field), Some("blood_group"));
        let long = PatientIntake::parse(&RawIntake {
            occupation: Some("x".repeat(81)),
            ..RawIntake::default()
        });
        assert_eq!(long.err().map(|e| e.field), Some("occupation"));
        assert!(PatientIntake::parse(&RawIntake::default()).is_ok_and(|i| i.is_empty()));
    }

    #[test]
    fn fill_keeps_given_values() {
        let mut a = PatientIntake {
            blood_group: Some(BloodGroup::APos),
            ..PatientIntake::default()
        };
        let b = PatientIntake {
            blood_group: Some(BloodGroup::ONeg),
            call_time: Some(CallTime::Any),
            ..PatientIntake::default()
        };
        a.fill_from(&b);
        assert_eq!(a.blood_group, Some(BloodGroup::APos));
        assert_eq!(a.call_time, Some(CallTime::Any));
    }
}
