//! Settings, read from an optional TOML file and then `ARO_*` environment variables.
//!
//! `config/local.toml` holds non-secret local defaults. Deployed services set environment
//! variables only. A double underscore nests: `ARO_DB__URL` sets `db.url`. Unknown keys are
//! rejected, so a misspelt variable fails at startup instead of being ignored.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::time::Duration;

use sakalya_config::{ConfigError, Environment, Loader};
use sakalya_http::HttpConfig;
use sakalya_telemetry::TelemetryConfig;
use secrecy::SecretString;
use serde::Deserialize;

/// Prefix of every environment variable the server reads.
pub const ENV_PREFIX: &str = "ARO_";

/// Everything the server reads at startup.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Where the server runs (`ARO_ENVIRONMENT`): `local`, `staging` or `production`.
    pub environment: Environment,
    /// The HTTP listener and its limits (`ARO_HTTP__*`).
    #[serde(default)]
    pub http: HttpSettings,
    /// Database connections (`ARO_DB__*`).
    pub db: DbSettings,
    /// Sign-in token checks (`ARO_AUTH__*`).
    pub auth: AuthSettings,
    /// Log format and filter (`ARO_TELEMETRY__FORMAT`, `ARO_TELEMETRY__FILTER`).
    #[serde(default)]
    pub telemetry: TelemetryConfig,
}

impl Config {
    /// Loads `file`, skipped when missing, then `ARO_*` environment variables, which win.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] naming the key that is missing, unknown or invalid.
    pub fn load(file: &Path) -> Result<Self, ConfigError> {
        Loader::new(ENV_PREFIX).file(file).load()
    }
}

/// The HTTP listener and its limits.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HttpSettings {
    /// Address to listen on (`ARO_HTTP__BIND`). Default `0.0.0.0:8080`, which Cloud Run expects.
    pub bind: SocketAddr,
    /// Longest a request may run before the client gets a 503, in seconds
    /// (`ARO_HTTP__REQUEST_TIMEOUT_SECS`). Default 30.
    pub request_timeout_secs: u64,
    /// Largest request body accepted, in bytes (`ARO_HTTP__BODY_LIMIT_BYTES`). Default 1 MiB.
    pub body_limit_bytes: usize,
}

impl HttpSettings {
    /// The limits for `sakalya_http::with_standard_layers`.
    #[must_use]
    pub fn limits(&self) -> HttpConfig {
        HttpConfig::new(
            Duration::from_secs(self.request_timeout_secs),
            self.body_limit_bytes,
        )
    }
}

impl Default for HttpSettings {
    fn default() -> Self {
        Self {
            bind: SocketAddr::from((Ipv4Addr::UNSPECIFIED, 8080)),
            request_timeout_secs: 30,
            body_limit_bytes: 1024 * 1024,
        }
    }
}

/// Database connections. Both URLs are secrets outside a developer's machine.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DbSettings {
    /// The API's login role (`ARO_DB__URL`), such as
    /// `postgres://aarogyam_api@localhost:5432/aarogyam_dev`. Row-level security applies to it.
    pub url: SecretString,
    /// The schema owner (`ARO_DB__OWNER_URL`), used only by `aarogyam migrate`: a local
    /// superuser, or Supabase's `postgres` user in the cloud.
    pub owner_url: Option<SecretString>,
}

/// Sign-in token checks for Supabase Auth. Placeholders until `sakalya-auth` is wired in.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthSettings {
    /// Expected `iss` claim (`ARO_AUTH__ISSUER`), such as `https://<project>.supabase.co/auth/v1`.
    pub issuer: Box<str>,
    /// Expected `aud` claim (`ARO_AUTH__AUDIENCE`); Supabase uses `authenticated`.
    pub audience: Box<str>,
    /// Where the token signing keys are published (`ARO_AUTH__JWKS_URL`).
    pub jwks_url: Box<str>,
}
