//! Settings for the `aarogyam` binary.
//!
//! The binary (`src/main.rs`) wires the crates together: it loads [`config::Config`], starts
//! telemetry, then serves the API or applies the database migrations. The settings live in
//! this library so tests can load them.

pub mod config;
