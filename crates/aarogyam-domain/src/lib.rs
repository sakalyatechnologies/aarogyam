//! Aarogyam's business types and rules.
//!
//! This is the innermost layer: `domain` ← `dal` ← `app` ← `api`. It holds pure code only, with
//! no I/O, no async and no database or HTTP types, so every rule is unit tested here without a
//! database. Value types such as `Id<T>`, `Paise` and `PhoneE164` come from `sakalya-types`;
//! this crate adds the clinic's concepts on top: who may act ([`access`]), the permission
//! catalogue ([`permission`]), typed identifiers ([`ids`]), patients ([`patient`]), patient
//! search ([`search`]), the clinic's own settings ([`clinic`]), staff ([`staff`]), queued
//! messages ([`outbox`]), appointments, chairs and the queue ([`schedule`]), patient imports
//! ([`import`]) and business event names ([`event`]).
//! messages ([`outbox`]), business event names ([`event`]), and the clinical record: visits and
//! notes ([`clinical`]), vital signs ([`vitals`]), the dental chart ([`dental`]) and patient
//! files ([`files`]).

pub mod access;
pub mod clinic;
pub mod clinical;
pub mod dental;
pub mod event;
pub mod files;
pub mod ids;
pub mod import;
pub mod outbox;
pub mod patient;
pub mod permission;
pub mod schedule;
pub mod search;
pub mod staff;
pub mod vitals;
