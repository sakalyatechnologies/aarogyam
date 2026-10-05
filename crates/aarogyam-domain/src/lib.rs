//! Aarogyam's business types and rules.
//!
//! This is the innermost layer: `domain` ← `dal` ← `app` ← `api`. It holds pure code only, with
//! no I/O, no async and no database or HTTP types, so every rule is unit tested here without a
//! database. Value types such as `Id<T>`, `Paise` and `PhoneE164` come from `sakalya-types`;
//! this crate adds the clinic's concepts on top: who may act ([`access`]), the permission
//! catalogue ([`permission`]), typed identifiers ([`ids`]) and the ones a client chooses ([`client_id`]), patients ([`patient`]), patient
//! search ([`search`]), the clinic's own settings ([`clinic`]), staff ([`staff`]), queued
//! messages ([`outbox`]), appointments, chairs and the queue ([`schedule`]), patient imports
//! ([`import`]), business event names ([`event`]), the clinical record: visits and notes
//! ([`clinical`]), vital signs ([`vitals`]), the dental chart ([`dental`]) and patient files
//! ([`files`]), money ([`billing`]), prescriptions ([`prescription`]) and patient links
//! ([`share`]) and the clinic's public website ([`website`]).

/// A stored text value that is not one of the enum's values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{field} has an unknown value")]
pub struct UnknownValue {
    /// The field, as the API names it.
    pub field: &'static str,
}

/// An enum stored and sent as text: `as_str`, `parse`, `Display` and serde in `snake_case`.
macro_rules! text_value {
    ($(#[$doc:meta])* $name:ident ($field:literal) { $($(#[$vdoc:meta])* $variant:ident => $text:literal),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($(#[$vdoc])* $variant,)*
        }

        impl $name {
            /// Every value.
            pub const ALL: &'static [Self] = &[$(Self::$variant),*];

            /// The value stored in the database and sent over the API.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text,)* }
            }

            /// Parses the stored value.
            ///
            /// # Errors
            /// [`crate::UnknownValue`] for anything else.
            pub fn parse(text: &str) -> Result<Self, crate::UnknownValue> {
                match text.trim() {
                    $($text => Ok(Self::$variant),)*
                    _ => Err(crate::UnknownValue { field: $field }),
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

pub mod access;
pub mod billing;
pub mod booking;
pub mod client_id;
pub mod clinic;
pub mod clinical;
pub mod dental;
pub mod event;
pub mod files;
pub mod ids;
pub mod import;
pub mod inventory;
pub mod letterhead;
pub mod onboarding;
pub mod outbox;
pub mod patient;
pub mod permission;
pub mod prescription;
pub mod schedule;
pub mod search;
pub mod setup;
pub mod share;
pub mod staff;
pub mod vitals;
pub mod website;
