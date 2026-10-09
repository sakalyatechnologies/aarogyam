//! The `aarogyam` binary: `serve` runs the HTTP API, `migrate` applies the database migrations,
//! `admin` and `outbox` are operator commands.

mod erase;

use std::path::PathBuf;
use std::sync::Arc;

use aarogyam_api::{AppState, DevTokens, Hosts, TokenCheck};
use aarogyam_app::accounts::{SignInAccounts as _, SupabaseAdmin};
use aarogyam_app::files::{Files, LinkSigner, LocalDisk, Storage, SupabaseStorage};
use aarogyam_domain::access::PlatformRole;
use aarogyam_domain::client::ClientPolicy;
use aarogyam_domain::patient::Email;
use aarogyam_notify::cloudflare::{API_BASE, AccountId, WorkersApi};
use aarogyam_notify::{Notifier, PortalAddresses, PortalLinks, WorkersDev};
use aarogyam_server::config::{AuthMode, Config, EdgeHosts, FileBackend};
use anyhow::Context;
use axum::http::HeaderName;
use clap::{Parser, Subcommand};
use sakalya_auth::{JwtConfig, JwtVerifier};
use sakalya_config::Environment;
use sakalya_db::{Db, DbConfig};
use sakalya_http::{EdgeConfig, EdgeSecret};
use secrecy::ExposeSecret as _;

/// Aarogyam's API server.
#[derive(Debug, Parser)]
#[command(name = "aarogyam", version)]
struct Cli {
    /// TOML file with local defaults, skipped when missing. ARO_* environment variables win.
    #[arg(
        long,
        global = true,
        value_name = "FILE",
        default_value = "config/local.toml"
    )]
    config: PathBuf,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Clone, Default, Subcommand)]
enum Command {
    /// Serve the HTTP API until SIGTERM or Ctrl-C (the default).
    #[default]
    Serve,
    /// Apply pending database migrations over the schema owner's connection, then exit.
    Migrate,
    /// Administration over the schema owner's connection.
    Admin {
        #[command(subcommand)]
        action: Admin,
    },
    /// Sakalya super admins (platform staff), over the schema owner's connection. They can't
    /// also belong to a clinic; support goes through support grants.
    Platform {
        #[command(subcommand)]
        action: Platform,
    },
    /// Lists records past their retention period, per class and clinic (a dry run: nothing is
    /// deleted or changed), over the schema owner's connection. See docs/decisions.md.
    Retention {
        /// Identifiers to show per clinic and class (0 to 20).
        #[arg(long, default_value_t = 3, value_parser = clap::value_parser!(i32).range(0..=20))]
        sample: i32,
        /// Refused: erasure is `aarogyam erase`.
        #[arg(long)]
        apply: bool,
    },
    /// Erases patient records past their clinic's retention period and not on legal hold (a dry
    /// run unless --apply), over the schema owner's connection. See docs/decisions.md.
    Erase {
        /// The clinic's slug; required with --apply.
        #[arg(long)]
        clinic: Option<String>,
        /// Erase, instead of listing what would be erased.
        #[arg(long)]
        apply: bool,
        /// Where to append the erasure log (JSON lines of ids); required with --apply. Keep it
        /// outside the database: it is replayed after a restore.
        #[arg(long)]
        log_file: Option<PathBuf>,
        /// Erase again every patient an erasure log names (after a restore from backup).
        #[arg(long, value_name = "LOG_FILE")]
        replay: Option<PathBuf>,
    },
    /// The outgoing-message queue.
    Outbox {
        #[command(subcommand)]
        action: Outbox,
    },
}

#[derive(Debug, Clone, Subcommand)]
enum Platform {
    /// Make someone platform staff (or change their role). Finds or creates their Supabase
    /// sign-in account (needs the Supabase URL and secret key) unless --auth-uid is given, and
    /// their user record. Refused for anyone with an active clinic membership.
    Grant {
        /// Their sign-in email address.
        email: String,
        /// Console role: owner, support, onboarding or analyst.
        #[arg(long)]
        role: String,
        /// Their Supabase Auth user id, to skip the Supabase lookup.
        #[arg(long)]
        auth_uid: Option<uuid::Uuid>,
        /// Their name as the console shows it; defaults to the part of the email before the @.
        #[arg(long)]
        name: Option<String>,
    },
    /// End someone's platform access. Refused for the last active owner.
    Revoke {
        /// Their sign-in email address.
        email: String,
    },
    /// List platform staff.
    List,
}

#[derive(Debug, Clone, Subcommand)]
enum Outbox {
    /// Makes new clinics' portal addresses work, then delivers due messages, once or every
    /// --every seconds until Ctrl-C. A scheduler (cron, a Cloud Run job) runs this where no
    /// HTTP scheduler calls the API.
    Drain {
        /// Repeat every this many seconds instead of once.
        #[arg(long, value_name = "SECONDS")]
        every: Option<u64>,
    },
    /// Queues every clinic's portal address again (or one clinic's) and makes them work now:
    /// the backfill for clinics created before this job, or a retry after fixing a failure.
    Addresses {
        /// Only this clinic, by slug.
        #[arg(long)]
        clinic: Option<String>,
    },
}

#[derive(Debug, Clone, Subcommand)]
enum Admin {
    /// Make someone an active member of a clinic, such as its first owner when the clinic was
    /// not created from the console. Finds or creates their Supabase sign-in account unless
    /// --auth-uid is given.
    AddMember {
        /// The clinic's slug, such as `sunrise`.
        #[arg(long)]
        clinic: String,
        /// Their sign-in email address.
        #[arg(long)]
        email: String,
        /// Role key, such as `owner`, `doctor` or `front_desk`.
        #[arg(long, default_value = "owner")]
        role: String,
        /// Their Supabase Auth user id, to skip the Supabase lookup.
        #[arg(long)]
        auth_uid: Option<uuid::Uuid>,
        /// Their name as the clinic shows it; defaults to the part of the email before the @.
        #[arg(long)]
        name: Option<String>,
    },
    /// How long a clinic keeps patient records: 7 (the default) to 50 years, or --default.
    RetentionYears {
        /// The clinic's slug.
        #[arg(long)]
        clinic: String,
        /// Years after the last visit, appointment or bill.
        #[arg(long, value_parser = clap::value_parser!(u8).range(7..=50), conflicts_with = "default")]
        years: Option<u8>,
        /// Go back to the default.
        #[arg(long)]
        default: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let config = Config::load(&cli.config).context("could not load the configuration")?;
    sakalya_telemetry::init(&config.telemetry).context("could not start telemetry")?;
    match cli.command.unwrap_or_default() {
        Command::Serve => serve(config).await,
        Command::Migrate => migrate(config).await,
        Command::Admin { action } => admin(config, action).await,
        Command::Platform { action } => platform(config, action).await,
        Command::Retention { sample, apply } => retention(&config, sample, apply).await,
        Command::Erase {
            clinic,
            apply,
            log_file,
            replay,
        } => {
            let args = erase::EraseArgs {
                clinic,
                apply,
                log_file,
                replay,
            };
            erase::run(&owner_db(&config)?, args).await
        }
        Command::Outbox {
            action: Outbox::Drain { every },
        } => drain(config, every).await,
        Command::Outbox {
            action: Outbox::Addresses { clinic },
        } => addresses(config, clinic.as_deref()).await,
    }
}

/// Serves the API until a shutdown signal, then drains in-flight requests.
///
/// The pool connects on first use, so the server starts while the database is briefly down.
#[expect(
    clippy::too_many_lines,
    reason = "the one place every setting becomes a part of the server"
)]
async fn serve(config: Config) -> anyhow::Result<()> {
    tracing::info!(
        environment = %config.environment,
        version = env!("CARGO_PKG_VERSION"),
        "starting"
    );
    let local = config.environment == Environment::Local;
    let tokens = token_check(&config, local).await?;
    let accounts = accounts(&config)?;
    let notifier = notifier(&config, local)?;
    let db = Db::connect_lazy(&config.db.api_config())
        .context("db.url is not a valid Postgres URL or the pool settings are invalid")?;
    // Open the warm connections now, so the first requests don't each wait for one.
    let warming = db.clone();
    tokio::spawn(async move {
        if let Err(error) = warming.warm().await {
            tracing::warn!(kind = %error.kind(), "could not open the warm database connections");
        }
    });
    let mut http = config.http.limits();
    match config.http.edge_secret {
        Some(secret) => {
            let secret =
                EdgeSecret::new(secret).context("http.edge_secret must be at least 32 bytes")?;
            let mut edge = EdgeConfig::new(secret);
            if let Some(name) = &config.http.edge_host_header {
                let name = HeaderName::try_from(name.as_str())
                    .context("http.edge_host_header must be a valid header name")?;
                edge = edge.with_host_header(name);
            }
            http = http.with_edge(edge);
        }
        None => anyhow::ensure!(
            local,
            "http.edge_secret is required outside the local environment"
        ),
    }
    let hosts = Hosts {
        portal_host_template: config.hosts.portal_host_template,
        console: config.hosts.console,
        app: config.hosts.app,
    };
    config.throttle.ensure_allowed(config.environment)?;
    let throttle = aarogyam_api::standard_throttle_with(config.throttle.bypass_token)
        .context("invalid throttle settings (a bypass token needs at least 32 bytes)")?;
    let clients = ClientPolicy::parse(
        &config.clients.min_versions,
        &config.clients.latest_versions,
    )
    .context("clients.min_versions and clients.latest_versions look like aarogyam-staff=0.1.0")?;
    let signer = if let Some(key) = config.files.signing_key {
        LinkSigner::new(key.expose_secret().as_bytes())
    } else {
        anyhow::ensure!(
            local,
            "files.signing_key is required outside the local environment"
        );
        LinkSigner::random()
    }
    .map_err(|error| anyhow::anyhow!("files.signing_key: {error}"))?;
    let storage: Arc<dyn Storage> = match config.files.backend {
        FileBackend::Local => {
            if !local {
                tracing::warn!(
                    "patient files are on local disk, which is lost when the instance stops"
                );
            }
            Arc::new(LocalDisk::new(config.files.dir))
        }
        FileBackend::Supabase => {
            let (Some(url), Some(key)) = (&config.supabase.url, &config.supabase.secret_key) else {
                anyhow::bail!(
                    "files.backend = supabase needs supabase.url and supabase.secret_key"
                );
            };
            Arc::new(
                SupabaseStorage::new(url, &config.files.bucket, key.clone())
                    .map_err(|error| anyhow::anyhow!("files.bucket / supabase.*: {error}"))?,
            )
        }
    };
    let files = Files::new(storage, signer);
    let mut state = AppState::new(db, http, tokens, hosts).with_quality_dir(config.quality.dir);
    if let Some(admin) = accounts {
        state = state.with_accounts(Arc::new(admin));
    } else if !local {
        tracing::warn!("supabase.secret_key is not set: invited people get no sign-in account");
    }
    warn_on_local_site_addresses(&config.website.address_template, local);
    let state = state
        .with_client_policy(clients)
        .with_throttle(throttle)
        .with_notifier(notifier)
        .with_files(files)
        .with_staff_mfa(config.auth.staff_mfa)
        .with_website(website_links(config.website));
    sakalya_http::serve(
        aarogyam_api::router(with_error_reporting(state, local)),
        config.http.bind,
    )
    .await
    .context("the server stopped with an error")
}

/// Deployed servers report 5xx answers and panics to Cloud Error Reporting (docs/deploy.md
/// "Error tracking"); locally they only reach the ordinary log.
fn with_error_reporting(state: AppState, local: bool) -> AppState {
    if local {
        return state;
    }
    let reporting = Arc::new(aarogyam_api::ErrorReporting::stdout(
        "aarogyam-api",
        env!("CARGO_PKG_VERSION"),
    ));
    reporting.install_panic_hook();
    state.with_error_reporting(reporting)
}

/// How sign-in tokens are checked: development tokens only in `dev` mode (local only), Supabase
/// tokens in `supabase` mode, plus development tokens locally when `auth.dev_tokens` is on.
async fn token_check(config: &Config, local: bool) -> anyhow::Result<TokenCheck> {
    let auth = &config.auth;
    let dev = || -> anyhow::Result<DevTokens> {
        anyhow::ensure!(
            local,
            "development tokens (auth.mode = dev or auth.dev_tokens) are allowed only when environment = local"
        );
        let secret = auth
            .dev_secret
            .clone()
            .context("auth.dev_secret is required for development tokens")?;
        Ok(DevTokens::new(&auth.dev_issuer, &auth.audience, secret))
    };
    if auth.mode == AuthMode::Dev {
        return Ok(TokenCheck::Dev(dev()?));
    }
    let issuer = auth.supabase_issuer(&config.supabase).context(
        "auth.issuer or supabase.url (SUPABASE_URL) is required when auth.mode = supabase",
    )?;
    let jwks_url = auth
        .supabase_jwks_url(&config.supabase)
        .context("auth.jwks_url is required when auth.mode = supabase")?;
    let verifier = JwtVerifier::remote(JwtConfig::new(&issuer, &auth.audience, &jwks_url))
        .context("auth.jwks_url is not a valid URL")?;
    if let Err(error) = verifier.prefetch().await {
        // Not fatal: keys are fetched again on the first sign-in.
        tracing::warn!(error = %error, "could not fetch the token signing keys at startup");
    }
    tracing::info!(issuer = %issuer, dev_tokens = auth.dev_tokens, "checking Supabase tokens");
    Ok(if auth.dev_tokens {
        TokenCheck::SupabaseAndDev {
            supabase: verifier,
            dev: dev()?,
        }
    } else {
        TokenCheck::Supabase(verifier)
    })
}

/// Email through Resend when a key is set, otherwise to the log.
fn notifier(config: &Config, local: bool) -> anyhow::Result<Notifier> {
    let links = PortalLinks::new(&config.email.portal_link)
        .context("email.portal_link must look like https://{host}")?;
    Ok(if let Some(key) = config.email.resend_api_key.clone() {
        Notifier::resend(key, &config.email.from, links)
            .context("could not set up email through Resend")?
    } else {
        if !local {
            tracing::warn!("email.resend_api_key is not set: email goes to the log only");
        }
        Notifier::log(links)
    })
}

fn website_links(website: aarogyam_server::config::WebsiteSettings) -> aarogyam_api::WebsiteLinks {
    aarogyam_api::WebsiteLinks {
        sites_target: website.sites_target,
        address_template: website.address_template,
    }
}

/// A deployed service with the local default address template would queue site addresses
/// nobody can reach.
fn warn_on_local_site_addresses(address_template: &str, local: bool) {
    if !local && address_template.contains("localtest.me") {
        tracing::warn!(
            "website.address_template is a local default: published clinic sites get addresses nobody can reach"
        );
    }
}

/// How portal hosts are made to work, from `edge.*`. The Cloudflare token stays in this
/// process: it is only ever sent to Cloudflare's API.
fn portal_addresses(config: &Config) -> anyhow::Result<PortalAddresses> {
    let edge = &config.edge;
    Ok(match edge.hosts {
        EdgeHosts::Off => PortalAddresses::Off,
        EdgeHosts::Wildcard => PortalAddresses::Wildcard,
        EdgeHosts::WorkersDev => {
            let account = AccountId::parse(edge.cloudflare_account_id.as_deref().context(
                "edge.cloudflare_account_id (CLOUDFLARE_ACCOUNT_ID) is required for workers_dev",
            )?)
            .context("edge.cloudflare_account_id")?;
            let token = edge.cloudflare_api_token.clone().context(
                "edge.cloudflare_api_token (CLOUDFLARE_API_TOKEN) is required for workers_dev",
            )?;
            let subdomain = edge.workers_subdomain.as_deref().context(
                "edge.workers_subdomain (CLOUDFLARE_WORKERS_SUBDOMAIN) is required for workers_dev",
            )?;
            let api = WorkersApi::new(API_BASE, account, token)
                .context("could not set up the Cloudflare API client")?;
            PortalAddresses::WorkersDev(
                WorkersDev::new(
                    api,
                    subdomain,
                    &edge.worker_name_template,
                    &edge.portal_worker,
                )
                .and_then(|workers| {
                    workers.with_site(&edge.site_worker_name_template, &edge.site_worker)
                })
                .context("edge.* settings")?,
            )
        }
    })
}

/// Queues portal addresses again and provisions them once: the backfill.
async fn addresses(config: Config, clinic: Option<&str>) -> anyhow::Result<()> {
    let addresses = portal_addresses(&config)?;
    anyhow::ensure!(
        !matches!(addresses, PortalAddresses::Off),
        "edge.hosts is off: set ARO_EDGE__HOSTS=workers_dev (or wildcard)"
    );
    let slug = clinic
        .map(|text| sakalya_types::Slug::parse(text.trim()))
        .transpose()
        .map_err(|_| anyhow::anyhow!("--clinic is not a valid slug"))?;
    let db = Db::connect_lazy(&config.db.api_config())
        .context("db.url is not a valid Postgres URL or the pool settings are invalid")?;
    let queued =
        aarogyam_dal::edge::requeue(db.pool(), slug.as_ref().map(sakalya_types::Slug::as_str))
            .await
            .context("could not queue the portal addresses")?;
    tracing::info!(
        queued,
        provider = addresses.name(),
        "portal addresses queued"
    );
    let mut total = aarogyam_notify::AddressReport::default();
    // A run claims a batch at a time; keep going until nothing due is left.
    loop {
        let report = addresses
            .provision(&db, time::OffsetDateTime::now_utc())
            .await
            .context("could not provision portal addresses")?;
        total.ready += report.ready;
        total.retrying += report.retrying;
        total.failed += report.failed;
        if report.claimed == 0 {
            break;
        }
    }
    tracing::info!(
        ready = total.ready,
        retrying = total.retrying,
        failed = total.failed,
        "portal addresses provisioned"
    );
    anyhow::ensure!(
        total.retrying == 0 && total.failed == 0,
        "some addresses failed: the console shows why; the outbox job retries the retrying ones"
    );
    Ok(())
}

/// Makes new portal hosts work, then delivers due outbox messages, over the API connection,
/// once or on a fixed interval.
async fn drain(config: Config, every: Option<u64>) -> anyhow::Result<()> {
    let local = config.environment == Environment::Local;
    let notifier = notifier(&config, local)?;
    let addresses = portal_addresses(&config)?;
    if matches!(addresses, PortalAddresses::Off) && !local {
        tracing::warn!("edge.hosts is off: new clinics' portal addresses stay pending");
    }
    let db = Db::connect_lazy(&config.db.api_config())
        .context("db.url is not a valid Postgres URL or the pool settings are invalid")?;
    let interval = every.map(|seconds| std::time::Duration::from_secs(seconds.max(1)));
    loop {
        // Addresses first, so the invitation emails sent next link to hosts that work.
        match addresses
            .provision(&db, time::OffsetDateTime::now_utc())
            .await
        {
            Ok(report) if report.claimed > 0 => tracing::info!(
                provider = addresses.name(),
                claimed = report.claimed,
                ready = report.ready,
                retrying = report.retrying,
                failed = report.failed,
                "portal addresses provisioned"
            ),
            Ok(_) => {}
            Err(error) => tracing::warn!(error = %error, "could not provision portal addresses"),
        }
        match notifier.drain(&db, time::OffsetDateTime::now_utc()).await {
            Ok(report) => tracing::info!(
                provider = notifier.email_provider(),
                claimed = report.claimed,
                sent = report.sent,
                retrying = report.retrying,
                failed = report.failed,
                purged = report.purged,
                "outbox drained"
            ),
            Err(error) if interval.is_some() => {
                tracing::warn!(error = %error, "could not drain the outbox; trying again");
            }
            Err(error) => return Err(error).context("could not drain the outbox"),
        }
        let Some(interval) = interval else {
            return Ok(());
        };
        tokio::select! {
            () = tokio::time::sleep(interval) => {}
            _ = tokio::signal::ctrl_c() => return Ok(()),
        }
    }
}

/// Supabase's Admin API when the project URL and secret key are set.
fn accounts(config: &Config) -> anyhow::Result<Option<SupabaseAdmin>> {
    match (&config.supabase.url, &config.supabase.secret_key) {
        (Some(url), Some(key)) => Ok(Some(
            SupabaseAdmin::new(url, key.clone()).context("supabase.url / supabase.secret_key")?,
        )),
        _ => Ok(None),
    }
}

/// Runs an administration command over the owner connection.
async fn admin(config: Config, action: Admin) -> anyhow::Result<()> {
    match action {
        Admin::AddMember {
            clinic,
            email,
            role,
            auth_uid,
            name,
        } => {
            let person = Person::resolve(&config, &email, auth_uid, name).await?;
            let db = owner_db(&config)?;
            let membership_id = aarogyam_dal::console::add_member(
                db.pool(),
                clinic.trim(),
                role.trim(),
                person.auth_uid,
                person.email.as_str(),
                &person.display_name,
            )
            .await
            .context("could not add the member")?
            .context("no clinic with that --clinic slug, or it has no role with that --role key")?;
            tracing::info!(%membership_id, auth_uid = %person.auth_uid, role = role.trim(), "member added");
        }
        Admin::RetentionYears {
            clinic,
            years,
            default,
        } => {
            anyhow::ensure!(years.is_some() != default, "give --years N or --default");
            let years = years
                .map(aarogyam_domain::retention::PatientRetentionYears::new)
                .transpose()
                .map_err(|error| anyhow::anyhow!("--years {error}"))?;
            let db = owner_db(&config)?;
            let id = aarogyam_app::erasure::clinic(&db, clinic.trim())
                .await?
                .context("no clinic with that --clinic slug")?;
            aarogyam_app::erasure::set_patient_years(&db, id, years).await?;
            tracing::info!(
                clinic = clinic.trim(),
                years = years.map_or(0, aarogyam_domain::retention::PatientRetentionYears::get),
                "patient record retention set (0: the default)"
            );
        }
    }
    Ok(())
}

/// Manages platform staff over the owner connection.
async fn platform(config: Config, action: Platform) -> anyhow::Result<()> {
    match action {
        Platform::Grant {
            email,
            role,
            auth_uid,
            name,
        } => {
            let role = PlatformRole::parse(role.trim())
                .context("--role must be owner, support, onboarding or analyst")?;
            let person = Person::resolve(&config, &email, auth_uid, name).await?;
            let db = owner_db(&config)?;
            let user_id = aarogyam_dal::console::grant_platform(
                db.pool(),
                person.auth_uid,
                person.email.as_str(),
                &person.display_name,
                role.as_str(),
            )
            .await?;
            tracing::info!(%user_id, email = person.email.as_str(), role = role.as_str(), "platform access granted");
        }
        Platform::Revoke { email } => {
            let email = Email::parse(&email)
                .map_err(|_| anyhow::anyhow!("the email is not an email address"))?;
            let db = owner_db(&config)?;
            let user_id = aarogyam_dal::console::revoke_platform(db.pool(), email.as_str()).await?;
            tracing::info!(%user_id, email = email.as_str(), "platform access revoked");
        }
        Platform::List => {
            let db = owner_db(&config)?;
            for staff in aarogyam_dal::console::list_platform(db.pool()).await? {
                tracing::info!(
                    role = staff.role,
                    active = staff.active,
                    email = staff.email.as_deref().unwrap_or("-"),
                    name = staff.display_name,
                    "platform staff"
                );
            }
        }
    }
    Ok(())
}

/// Who an admin command is about.
struct Person {
    auth_uid: uuid::Uuid,
    email: Email,
    display_name: String,
}

impl Person {
    /// Their Supabase account (found or created unless `auth_uid` is given) and display name.
    async fn resolve(
        config: &Config,
        email: &str,
        auth_uid: Option<uuid::Uuid>,
        name: Option<String>,
    ) -> anyhow::Result<Self> {
        let email =
            Email::parse(email).map_err(|_| anyhow::anyhow!("--email is not an email address"))?;
        let auth_uid = match auth_uid {
            Some(id) => id,
            None => accounts(config)?
                .context("set SUPABASE_URL and SUPABASE_SECRET_KEY, or pass --auth-uid")?
                .ensure_user(&email)
                .await
                .context("could not find or create the Supabase sign-in account")?
                .uuid(),
        };
        let display_name = name
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| {
                email
                    .as_str()
                    .split('@')
                    .next()
                    .unwrap_or("staff")
                    .to_owned()
            });
        Ok(Self {
            auth_uid,
            email,
            display_name,
        })
    }
}

/// The retention dry run: one `retention.past` line per class and clinic with records past their
/// period (counts, the oldest date and a few ids, never names), then a total per class.
async fn retention(config: &Config, sample: i32, apply: bool) -> anyhow::Result<()> {
    anyhow::ensure!(
        !apply,
        "retention is a report only: erase patient records with `aarogyam erase` (a dry run unless --apply --clinic <slug>). Nothing was changed."
    );
    let db = owner_db(config)?;
    let now = time::OffsetDateTime::now_utc();
    for class in aarogyam_app::retention::report(&db, now, sample).await? {
        for group in &class.groups {
            let sample: Vec<String> = group.sample.iter().map(ToString::to_string).collect();
            tracing::info!(
                event = "retention.past",
                class = class.class.as_str(),
                clinic = group.org_id.map(|id| id.to_string()).unwrap_or_default(),
                records = group.count,
                oldest = group.oldest.map(|at| at.date().to_string()).unwrap_or_default(),
                sample = %sample.join(","),
                "records past retention"
            );
        }
        tracing::info!(
            event = "retention.class",
            class = class.class.as_str(),
            period = %class.period.describe(),
            cutoff = %class.cutoff.date(),
            records = class.total(),
            "dry run: nothing was deleted"
        );
    }
    Ok(())
}

/// The schema owner's connection, which admin commands need.
fn owner_db(config: &Config) -> anyhow::Result<Db> {
    let url = config
        .db
        .owner_url
        .clone()
        .context("db.owner_url (ARO_DB__OWNER_URL) is required for admin commands")?;
    Db::connect_lazy(&DbConfig::new(url)).context("db.owner_url is not a valid Postgres URL")
}

/// Applies pending migrations over the owner connection.
async fn migrate(config: Config) -> anyhow::Result<()> {
    let url = config
        .db
        .owner_url
        .context("db.owner_url (ARO_DB__OWNER_URL) is required to migrate")?;
    let db = Db::connect_lazy(&DbConfig::new(url))
        .context("db.owner_url is not a valid Postgres URL")?;
    let applied = aarogyam_dal::migrate(db.pool())
        .await
        .context("could not migrate the database")?;
    // The number is in the message text: scripts/cloud-run-deploy.sh reads it from the job log.
    tracing::info!("database migrated: {applied} applied");
    Ok(())
}
