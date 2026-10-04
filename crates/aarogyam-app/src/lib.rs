//! Aarogyam's use cases.
//!
//! Each use case loads what it needs through `aarogyam-dal`, decides with `aarogyam-domain`,
//! and saves, all inside one clinic transaction (`sakalya_db::Db::scoped`) so row-level
//! security limits every query to the caller's clinic. HTTP handlers in `aarogyam-api` call
//! these; nothing here knows about HTTP.

pub mod clock;
pub mod console;
pub mod error;
pub mod invitations;
pub mod patients;
mod scope;
pub mod sessions;
pub mod settings;
pub mod tokens;

pub use error::AppError;
