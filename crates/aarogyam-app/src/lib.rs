//! Aarogyam's use cases.
//!
//! Each use case loads what it needs through `aarogyam-dal`, decides with `aarogyam-domain`,
//! saves, and emits events, all inside one `ClinicTx` so row-level security limits every query
//! to the caller's clinic. HTTP handlers in `aarogyam-api` call these; nothing here knows about
//! HTTP.
//!
//! Empty until the first module lands. Add `aarogyam-domain` and `aarogyam-dal` as dependencies
//! with it; `cargo machete` rejects dependencies that are declared but unused.
