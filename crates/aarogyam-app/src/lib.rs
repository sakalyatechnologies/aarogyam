//! Aarogyam's use cases.
//!
//! Each use case loads what it needs through `aarogyam-dal`, decides with `aarogyam-domain`,
//! and saves, all inside one clinic transaction (`sakalya_db::Db::scoped`) so row-level
//! security limits every query to the caller's clinic. HTTP handlers in `aarogyam-api` call
//! these; nothing here knows about HTTP.

pub mod accounts;
pub mod appointments;
pub mod billing;
pub mod chart;
pub mod clock;
pub mod console;
pub mod error;
pub mod facts;
pub mod files;
pub mod identifiers;
pub mod imports;
pub mod inventory;
pub mod invitations;
pub mod letterhead;
pub mod onboarding;
pub mod outbox;
pub mod patients;
pub mod payments;
pub mod prescriptions;
pub mod quality;
pub mod queue;
pub mod recalls;
pub mod record;
pub mod reports;
pub mod schedule;
mod scope;
pub mod self_booking;
pub mod sessions;
pub mod settings;
pub mod setup;
pub mod share;
pub mod staff;
pub mod today;
pub mod tokens;
pub mod treatment;
pub mod visits;
pub mod vitals;
pub mod website;

pub use error::AppError;
