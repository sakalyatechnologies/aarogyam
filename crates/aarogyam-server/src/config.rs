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
    /// The host names the API answers on (`ARO_HOSTS__*`).
    pub hosts: HostSettings,
    /// Log format and filter (`ARO_TELEMETRY__FORMAT`, `ARO_TELEMETRY__FILTER`).
    #[serde(default)]
    pub telemetry: TelemetryConfig,
    /// Outgoing email (`ARO_EMAIL__*`).
    #[serde(default)]
    pub email: EmailSettings,
    /// Patient files (`ARO_FILES__*`).
    #[serde(default)]
    pub files: FileSettings,
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
    /// The secret the Cloudflare Worker sends (`ARO_HTTP__EDGE_SECRET`), at least 32 bytes.
    /// Required outside `local`: without it anyone could call the Cloud Run URL directly and
    /// claim any host or client IP.
    pub edge_secret: Option<SecretString>,
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
            edge_secret: None,
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

/// How sign-in tokens are checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    /// Local development only: the API mints and checks its own tokens for the seeded people.
    Dev,
    /// Supabase Auth tokens, checked against the project's published keys.
    Supabase,
}

/// Sign-in token checks.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthSettings {
    /// `dev` (only allowed in `local`) or `supabase` (`ARO_AUTH__MODE`).
    pub mode: AuthMode,
    /// Expected `iss` claim (`ARO_AUTH__ISSUER`), such as `https://<project>.supabase.co/auth/v1`.
    pub issuer: Box<str>,
    /// Expected `aud` claim (`ARO_AUTH__AUDIENCE`); Supabase uses `authenticated`.
    pub audience: Box<str>,
    /// Where Supabase publishes its signing keys (`ARO_AUTH__JWKS_URL`); `supabase` mode only.
    pub jwks_url: Option<Box<str>>,
    /// Secret for development tokens (`ARO_AUTH__DEV_SECRET`); `dev` mode only.
    pub dev_secret: Option<SecretString>,
}

/// The host names the API answers on.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostSettings {
    /// Clinic portals are `<slug>.<portal_domain>` (`ARO_HOSTS__PORTAL_DOMAIN`).
    pub portal_domain: String,
    /// The Sakalya console host (`ARO_HOSTS__CONSOLE`).
    pub console: String,
    /// The neutral host for the phone apps (`ARO_HOSTS__APP`).
    pub app: String,
}

/// Outgoing email, sent from the outbox.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EmailSettings {
    /// Resend API key (`ARO_EMAIL__RESEND_API_KEY`). Without it, email is recorded as
    /// delivered and logged by id only, which is what local development wants.
    pub resend_api_key: Option<SecretString>,
    /// Sender address on a domain verified with Resend (`ARO_EMAIL__FROM`).
    pub from: String,
    /// Where links in messages point, with `{host}` for the clinic's portal host
    /// (`ARO_EMAIL__PORTAL_LINK`). Default `https://{host}`; locally `http://{host}:5173`.
    pub portal_link: String,
}

impl Default for EmailSettings {
    fn default() -> Self {
        Self {
            resend_api_key: None,
            from: "Aarogyam <no-reply@aarogyam.example>".to_owned(),
            portal_link: "https://{host}".to_owned(),
        }
    }
}

/// Where patient files are kept and how their download links are signed.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct FileSettings {
    /// Directory for files on local disk (`ARO_FILES__DIR`). Default `var/attachments`.
    pub dir: std::path::PathBuf,
    /// Secret for download links, at least 32 bytes (`ARO_FILES__SIGNING_KEY`). Required
    /// outside the local environment, so links work across instances; locally a random key
    /// is made at startup.
    pub signing_key: Option<SecretString>,
}

impl Default for FileSettings {
    fn default() -> Self {
        Self {
            dir: "var/attachments".into(),
            signing_key: None,
        }
    }
}
