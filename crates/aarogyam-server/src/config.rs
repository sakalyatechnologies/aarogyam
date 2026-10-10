//! Settings, read from an optional TOML file and then `ARO_*` environment variables.
//!
//! `config/local.toml` holds non-secret local defaults. Deployed services set environment
//! variables only. A double underscore nests: `ARO_DB__URL` sets `db.url`. Unknown keys are
//! rejected, so a misspelt variable fails at startup instead of being ignored.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::time::Duration;

use sakalya_config::{ConfigError, Environment, Loader};
use sakalya_db::DbConfig;
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
    /// `WhatsApp` through Meta's Cloud API (`ARO_WHATSAPP__*`); off by default.
    #[serde(default)]
    pub whatsapp: WhatsappSettings,
    /// Patient files (`ARO_FILES__*`).
    #[serde(default)]
    pub files: FileSettings,
    /// Where clinic websites are served (`ARO_WEBSITE__*`).
    #[serde(default)]
    pub website: WebsiteSettings,
    /// The Supabase project (`ARO_SUPABASE__*`, or the `SUPABASE_*` names in `.env.supabase`).
    #[serde(default)]
    pub supabase: SupabaseSettings,
    /// Where `scripts/quality-run.sh` writes its run summaries (`ARO_QUALITY__DIR`).
    #[serde(default)]
    pub quality: QualitySettings,
    /// Request limits (`ARO_THROTTLE__*`).
    #[serde(default)]
    pub throttle: ThrottleSettings,
    /// How clinics' portal hosts are made to work at the edge (`ARO_EDGE__*`).
    #[serde(default)]
    pub edge: EdgeSettings,
    /// Which versions of the phone apps are served (`ARO_CLIENTS__*`).
    #[serde(default)]
    pub clients: ClientSettings,
}

impl Config {
    /// Loads `file`, skipped when missing, then `ARO_*` environment variables, which win.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] naming the key that is missing, unknown or invalid.
    pub fn load(file: &Path) -> Result<Self, ConfigError> {
        let mut config: Self = Loader::new(ENV_PREFIX).file(file).load()?;
        // The names Supabase's dashboard uses, as kept in `.env.supabase`, when the ARO_ ones
        // are not set.
        let plain = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
        if config.supabase.url.is_none() {
            config.supabase.url = plain("SUPABASE_URL").map(Into::into);
        }
        if config.supabase.secret_key.is_none() {
            config.supabase.secret_key = plain("SUPABASE_SECRET_KEY").map(SecretString::from);
        }
        // And the names `.env.cloudflare` uses, for the backfill script.
        let edge = &mut config.edge;
        if edge.cloudflare_api_token.is_none() {
            edge.cloudflare_api_token = plain("CLOUDFLARE_API_TOKEN").map(SecretString::from);
        }
        if edge.cloudflare_account_id.is_none() {
            edge.cloudflare_account_id = plain("CLOUDFLARE_ACCOUNT_ID");
        }
        if edge.workers_subdomain.is_none() {
            edge.workers_subdomain = plain("CLOUDFLARE_WORKERS_SUBDOMAIN");
        }
        Ok(config)
    }
}

/// Which versions of the phone apps the API serves. Both lists are comma-separated
/// `app=version` pairs, such as `aarogyam-staff=0.1.0`; apps that aren't listed are never refused.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ClientSettings {
    /// The oldest version of each app still served (`ARO_CLIENTS__MIN_VERSIONS`). Older ones
    /// get `426 client_upgrade_required`.
    pub min_versions: String,
    /// The newest released version of each app (`ARO_CLIENTS__LATEST_VERSIONS`), published at
    /// `GET /api/v1/meta` so apps can ask people to update before the minimum moves.
    pub latest_versions: String,
}

/// The HTTP listener and its limits.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HttpSettings {
    /// Address to listen on (`ARO_HTTP__BIND`). Default `0.0.0.0:$PORT` (`8080` if `PORT` is
    /// unset), since Cloud Run assigns the port through that variable rather than `ARO_*`.
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
    /// Header the Worker puts the clinic's host in (`ARO_HTTP__EDGE_HOST_HEADER`). Default
    /// `x-forwarded-host`. The laptop demo behind Tailscale Funnel sets `x-sakalya-host`,
    /// since Funnel overwrites `x-forwarded-host` with its own name.
    pub edge_host_header: Option<String>,
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
        let port = std::env::var("PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(8080);
        Self {
            bind: SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)),
            request_timeout_secs: 30,
            body_limit_bytes: 1024 * 1024,
            edge_secret: None,
            edge_host_header: None,
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
    /// Most connections (`ARO_DB__MAX_CONNECTIONS`). Default 10.
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    /// Connections kept open when idle (`ARO_DB__MIN_CONNECTIONS`). Default 2.
    #[serde(default = "default_min_connections")]
    pub min_connections: u32,
    /// Seconds before an idle connection is replaced (`ARO_DB__IDLE_TIMEOUT_SECS`); warm ones
    /// are reopened in the background. Default 300.
    #[serde(default = "default_idle_timeout_secs")]
    pub idle_timeout_secs: u64,
    /// Seconds before any connection is replaced (`ARO_DB__MAX_LIFETIME_SECS`). Default 1800.
    #[serde(default = "default_max_lifetime_secs")]
    pub max_lifetime_secs: u64,
    /// Seconds idle after which a connection is pinged before use
    /// (`ARO_DB__PING_AFTER_IDLE_SECS`). Default 60.
    #[serde(default = "default_ping_after_idle_secs")]
    pub ping_after_idle_secs: u64,
    /// Prepared statements cached per connection (`ARO_DB__STATEMENT_CACHE_CAPACITY`), above
    /// the number of distinct queries so none is prepared twice. Default 512.
    #[serde(default = "default_statement_cache_capacity")]
    pub statement_cache_capacity: usize,
}

impl DbSettings {
    /// The API's pool settings: these limits on `db.url`. Ten connections fit under the
    /// Supabase free plan session pooler alongside the outbox sender's own small pool,
    /// a couple kept warm because a new one costs several round trips, and none idle
    /// long enough for the pooler or a NAT gateway to drop it unnoticed.
    #[must_use]
    pub fn api_config(&self) -> DbConfig {
        DbConfig::new(self.url.clone())
            .with_max_connections(self.max_connections)
            .with_min_connections(self.min_connections)
            .with_idle_timeout(Duration::from_secs(self.idle_timeout_secs))
            .with_max_lifetime(Duration::from_secs(self.max_lifetime_secs))
            .with_ping_after_idle(Duration::from_secs(self.ping_after_idle_secs))
            .with_statement_cache_capacity(self.statement_cache_capacity)
    }
}

const fn default_max_connections() -> u32 {
    10
}

const fn default_min_connections() -> u32 {
    2
}

const fn default_idle_timeout_secs() -> u64 {
    300
}

const fn default_max_lifetime_secs() -> u64 {
    1800
}

const fn default_ping_after_idle_secs() -> u64 {
    60
}

const fn default_statement_cache_capacity() -> usize {
    512
}

/// How sign-in tokens are checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    /// Local development only: the API mints and checks its own tokens for the seeded people.
    Dev,
    /// Supabase Auth tokens, checked against the project's published keys; locally, development
    /// tokens as well when `dev_tokens` is on.
    Supabase,
}

/// Sign-in token checks.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthSettings {
    /// `dev` (only allowed in `local`) or `supabase` (`ARO_AUTH__MODE`).
    pub mode: AuthMode,
    /// Expected `iss` claim of Supabase tokens (`ARO_AUTH__ISSUER`). Default
    /// `<supabase.url>/auth/v1`.
    pub issuer: Option<Box<str>>,
    /// Expected `aud` claim (`ARO_AUTH__AUDIENCE`); Supabase uses `authenticated`.
    #[serde(default = "default_audience")]
    pub audience: Box<str>,
    /// Where Supabase publishes its signing keys (`ARO_AUTH__JWKS_URL`). Default
    /// `<issuer>/.well-known/jwks.json`.
    pub jwks_url: Option<Box<str>>,
    /// Also accept development tokens in `supabase` mode (`ARO_AUTH__DEV_TOKENS`); only allowed
    /// in `local`. `dev` mode always accepts them.
    #[serde(default)]
    pub dev_tokens: bool,
    /// The `iss` claim of development tokens (`ARO_AUTH__DEV_ISSUER`). Default `aarogyam-dev`.
    #[serde(default = "default_dev_issuer")]
    pub dev_issuer: Box<str>,
    /// Secret for development tokens (`ARO_AUTH__DEV_SECRET`).
    pub dev_secret: Option<SecretString>,
    /// Whether Sakalya staff need an authenticator code (`aal2`) for the console
    /// (`ARO_AUTH__STAFF_MFA`). Default `true`; off only for development and demos, and it must
    /// be on before real patient data.
    #[serde(default = "default_staff_mfa")]
    pub staff_mfa: bool,
}

fn default_staff_mfa() -> bool {
    true
}

fn default_audience() -> Box<str> {
    "authenticated".into()
}

fn default_dev_issuer() -> Box<str> {
    "aarogyam-dev".into()
}

impl AuthSettings {
    /// The Supabase issuer: `auth.issuer`, else `<supabase.url>/auth/v1`.
    #[must_use]
    pub fn supabase_issuer(&self, supabase: &SupabaseSettings) -> Option<String> {
        self.issuer.as_deref().map(str::to_owned).or_else(|| {
            supabase
                .url
                .as_deref()
                .map(|url| format!("{}/auth/v1", url.trim_end_matches('/')))
        })
    }

    /// Where Supabase's signing keys are: `auth.jwks_url`, else `<issuer>/.well-known/jwks.json`.
    #[must_use]
    pub fn supabase_jwks_url(&self, supabase: &SupabaseSettings) -> Option<String> {
        self.jwks_url.as_deref().map(str::to_owned).or_else(|| {
            self.supabase_issuer(supabase)
                .map(|issuer| format!("{issuer}/.well-known/jwks.json"))
        })
    }
}

/// The Supabase project, for token checks and for creating people's sign-in accounts.
#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SupabaseSettings {
    /// The project URL (`ARO_SUPABASE__URL`, or `SUPABASE_URL`), such as
    /// `https://<project-ref>.supabase.co`.
    pub url: Option<Box<str>>,
    /// The server-only secret key (`ARO_SUPABASE__SECRET_KEY`, or `SUPABASE_SECRET_KEY`). It
    /// creates sign-in accounts for invited people, since sign-ups are off. Never sent to a
    /// browser or app, never logged. Without it, invitations still work but the invited person
    /// can't sign in until their account exists in Supabase.
    pub secret_key: Option<SecretString>,
}

/// The host names the API answers on.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostSettings {
    /// Builds a clinic's portal host from its slug: `{slug}` is replaced with the slug
    /// (`ARO_HOSTS__PORTAL_HOST_TEMPLATE`), such as `{slug}.localtest.me` or, for a single flat
    /// staging host with no wildcard domain yet, a literal host with no `{slug}` in it at all.
    pub portal_host_template: String,
    /// The Sakalya console host (`ARO_HOSTS__CONSOLE`).
    pub console: String,
    /// The neutral host for the phone apps (`ARO_HOSTS__APP`).
    pub app: String,
}

/// How portal hosts are made to work (`ARO_EDGE__HOSTS`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeHosts {
    /// Not set up: new hosts stay pending (the default outside local).
    #[default]
    Off,
    /// A wildcard already serves every host (`*.localtest.me` locally, or a wildcard custom
    /// domain): hosts are marked ready at once.
    Wildcard,
    /// One small Worker per clinic on workers.dev, created through the Cloudflare API.
    WorkersDev,
}

/// How clinics' portal hosts are made to work at the edge, run by `aarogyam outbox drain`.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EdgeSettings {
    /// `off`, `wildcard` or `workers_dev` (`ARO_EDGE__HOSTS`).
    pub hosts: EdgeHosts,
    /// The Cloudflare account (`ARO_EDGE__CLOUDFLARE_ACCOUNT_ID`, or `CLOUDFLARE_ACCOUNT_ID`).
    pub cloudflare_account_id: Option<String>,
    /// A token with only "Workers Scripts: Edit" on that account
    /// (`ARO_EDGE__CLOUDFLARE_API_TOKEN`, or `CLOUDFLARE_API_TOKEN`). Only the outbox job needs it.
    pub cloudflare_api_token: Option<SecretString>,
    /// The account's workers.dev subdomain, such as `spring-snow-130f`
    /// (`ARO_EDGE__WORKERS_SUBDOMAIN`, or `CLOUDFLARE_WORKERS_SUBDOMAIN`).
    pub workers_subdomain: Option<String>,
    /// A clinic Worker's name, with `{slug}` replaced (`ARO_EDGE__WORKER_NAME_TEMPLATE`).
    /// Default `{slug}-aarogyam`; it must match `hosts.portal_host_template`.
    pub worker_name_template: String,
    /// The portal Worker every clinic Worker hands requests to (`ARO_EDGE__PORTAL_WORKER`).
    /// Default `aarogyam-portal`.
    pub portal_worker: String,
    /// A clinic's website Worker name, with `{slug}` replaced
    /// (`ARO_EDGE__SITE_WORKER_NAME_TEMPLATE`). Default `{slug}-site`; it must match
    /// `website.address_template`.
    pub site_worker_name_template: String,
    /// The site Worker every clinic website Worker hands requests to (`ARO_EDGE__SITE_WORKER`).
    /// Default `aarogyam-site`.
    pub site_worker: String,
}

impl Default for EdgeSettings {
    fn default() -> Self {
        Self {
            hosts: EdgeHosts::Off,
            cloudflare_account_id: None,
            cloudflare_api_token: None,
            workers_subdomain: None,
            worker_name_template: "{slug}-aarogyam".to_owned(),
            portal_worker: "aarogyam-portal".to_owned(),
            site_worker_name_template: "{slug}-site".to_owned(),
            site_worker: "aarogyam-site".to_owned(),
        }
    }
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
    /// Patient emails sent a day across the platform before the rest wait for the next day
    /// (`ARO_EMAIL__DAILY_BUDGET`). Default 100, Resend's free tier.
    pub daily_budget: u32,
    /// The Resend webhook's signing secret, `whsec_...` (`ARO_EMAIL__RESEND_WEBHOOK_SECRET`).
    /// Without it `POST /api/v1/webhooks/resend` refuses every request.
    pub resend_webhook_secret: Option<SecretString>,
}

impl Default for EmailSettings {
    fn default() -> Self {
        Self {
            resend_api_key: None,
            from: "Aarogyam <no-reply@aarogyam.example>".to_owned(),
            portal_link: "https://{host}".to_owned(),
            daily_budget: 100,
            resend_webhook_secret: None,
        }
    }
}

/// `WhatsApp` through Meta's Cloud API (docs/whatsapp.md). Secrets live in Secret Manager.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WhatsappSettings {
    /// Send `WhatsApp` messages (`ARO_WHATSAPP__ENABLED`). Default false: they are skipped with
    /// `channel_disabled`. True needs the access token and phone number id.
    pub enabled: bool,
    /// A system user's permanent access token (`ARO_WHATSAPP__ACCESS_TOKEN`).
    pub access_token: Option<SecretString>,
    /// The sending number's id in Meta (`ARO_WHATSAPP__PHONE_NUMBER_ID`), not the number.
    pub phone_number_id: Option<String>,
    /// The Meta app secret, which signs webhooks (`ARO_WHATSAPP__APP_SECRET`). Without it
    /// `POST /api/v1/webhooks/whatsapp` refuses every request.
    pub app_secret: Option<SecretString>,
    /// The token Meta echoes when subscribing the webhook (`ARO_WHATSAPP__VERIFY_TOKEN`).
    pub verify_token: Option<SecretString>,
    /// Messages a day across the platform (`ARO_WHATSAPP__DAILY_BUDGET`). Default 250, Meta's
    /// first tier.
    pub daily_budget: u32,
    /// Paise per marketing message (`ARO_WHATSAPP__COST_MARKETING_PAISE`). Default 88.
    pub cost_marketing_paise: i64,
    /// Paise per utility message (`ARO_WHATSAPP__COST_UTILITY_PAISE`). Default 13.
    pub cost_utility_paise: i64,
    /// Paise per authentication message (`ARO_WHATSAPP__COST_AUTHENTICATION_PAISE`). Default 13.
    pub cost_authentication_paise: i64,
    /// Meta's Graph API base (`ARO_WHATSAPP__GRAPH_URL`); only tests change it.
    pub graph_url: String,
}

impl Default for WhatsappSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            access_token: None,
            phone_number_id: None,
            app_secret: None,
            verify_token: None,
            daily_budget: 250,
            cost_marketing_paise: 88,
            cost_utility_paise: 13,
            cost_authentication_paise: 13,
            graph_url: "https://graph.facebook.com/v21.0".to_owned(),
        }
    }
}

/// Which store keeps file bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileBackend {
    /// A directory on local disk: development and tests.
    Local,
    /// A private Supabase Storage bucket.
    Supabase,
}

/// Where patient files are kept and how their download links are signed.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct FileSettings {
    /// Where bytes live (`ARO_FILES__BACKEND`): `local` disk (default) or `supabase` Storage.
    /// Cloud Run's disk is wiped when an instance stops, so deployed environments use
    /// `supabase`, which needs `supabase.url` and `supabase.secret_key`.
    pub backend: FileBackend,
    /// The private Supabase Storage bucket (`ARO_FILES__BUCKET`). Default `aarogyam-files`.
    pub bucket: String,
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
            backend: FileBackend::Local,
            bucket: "aarogyam-files".to_owned(),
            dir: "var/attachments".into(),
            signing_key: None,
        }
    }
}

/// Where clinic websites are served; shown to owners in Settings -> Website -> Domain.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WebsiteSettings {
    /// What a clinic's `www` CNAME record points to (`ARO_WEBSITE__SITES_TARGET`), such as
    /// `aarogyam-site.spring-snow-130f.workers.dev`. The default is for local development;
    /// deployed environments set it (`scripts/cloud-run-deploy.sh` does).
    pub sites_target: String,
    /// The free address, with `{slug}` replaced by the clinic's slug
    /// (`ARO_WEBSITE__ADDRESS_TEMPLATE`), such as `{slug}-site.spring-snow-130f.workers.dev`
    /// now or `{slug}-site.sakalyatechnologies.com` later. Publishing queues this host for the
    /// outbox job, so it must match `edge.site_worker_name_template`.
    pub address_template: String,
}

impl Default for WebsiteSettings {
    fn default() -> Self {
        Self {
            sites_target: "sites.localtest.me".into(),
            address_template: "{slug}-site.localtest.me".into(),
        }
    }
}

/// Where the Quality dashboard reads recorded test runs from. This store sits outside the
/// patient database on purpose (a GCS bucket or `BigQuery` dataset once deployed); it never holds
/// patient data, only test names and failure messages.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct QualitySettings {
    /// Directory of run summaries, one JSON file per run (`ARO_QUALITY__DIR`). Default
    /// `var/quality`.
    pub dir: std::path::PathBuf,
}

impl Default for QualitySettings {
    fn default() -> Self {
        Self {
            dir: "var/quality".into(),
        }
    }
}

/// Request limits. The rules themselves are code (`aarogyam_api::standard_throttle`); only the
/// bypass is configured.
#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ThrottleSettings {
    /// Requests carrying this token in `x-sakalya-throttle-bypass` skip the limits
    /// (`ARO_THROTTLE__BYPASS_TOKEN`, at least 32 bytes): the local end-to-end stack sets it,
    /// because a suite signs in far more often than a person. Refused outside `local`.
    pub bypass_token: Option<SecretString>,
}

impl ThrottleSettings {
    /// Refuses a bypass token anywhere but the local environment: a deployed service must never
    /// have a way around its limits that a leaked header could use.
    ///
    /// # Errors
    ///
    /// Returns an error when a token is set and `environment` is not [`Environment::Local`].
    pub fn ensure_allowed(&self, environment: Environment) -> anyhow::Result<()> {
        anyhow::ensure!(
            environment == Environment::Local || self.bypass_token.is_none(),
            "throttle.bypass_token is allowed only when environment = local"
        );
        Ok(())
    }
}
