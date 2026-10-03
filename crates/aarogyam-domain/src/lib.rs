//! Aarogyam's business types and rules.
//!
//! This is the innermost layer: `domain` ← `dal` ← `app` ← `api`. It holds pure code only, with
//! no I/O, no async and no database or HTTP types, so every rule is unit tested here without a
//! database. Value types such as `Id<T>`, `Paise` and `PhoneE164` come from `sakalya-types`;
//! this crate adds the clinic's concepts on top: who may act ([`access`]), the permission
//! catalogue ([`permission`]), typed identifiers ([`ids`]), patients ([`patient`]) and patient
//! search ([`search`]).

pub mod access;
pub mod ids;
pub mod patient;
pub mod permission;
pub mod search;
