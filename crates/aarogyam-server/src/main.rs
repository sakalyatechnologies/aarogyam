//! The `aarogyam` binary: `serve` runs the HTTP API, `migrate` applies the database migrations,
//! `admin` and `outbox` are operator commands.

use std::path::PathBuf;
use std::sync::Arc;

use aarogyam_api::{AppState, DevTokens, Hosts, TokenCheck};
use aarogyam_app::accounts::{SignInAccounts as _, SupabaseAdmin};
use aarogyam_app::files::{Files, LinkSigner, LocalDisk};
use aarogyam_domain::access::PlatformRole;
use aarogyam_domain::patient::Email;
use aarogyam_notify::{Notifier, PortalLinks};
use aarogyam_server::config::{AuthMode, Config};
use anyhow::Context;
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
    /// The outgoing-message queue.
    Outbox {
        #[command(subcommand)]
        action: Outbox,
    },
}

#[derive(Debug, Clone, Subcommand)]
enum Outbox {
    /// Delivers due messages once, or every --every seconds until Ctrl-C. A scheduler (cron,
    /// a Cloud Run job) runs this where no HTTP scheduler calls the API.
    Drain {
        /// Repeat every this many seconds instead of once.
        #[arg(long, value_name = "SECONDS")]
        every: Option<u64>,
    },
}

#[derive(Debug, Clone, Subcommand)]
enum Admin {
    /// Make someone Sakalya staff who can use the console. Finds or creates their Supabase
    /// sign-in account (needs the Supabase URL and secret key) unless --auth-uid is given.
    GrantPlatform {
        /// Their sign-in email address.
        #[arg(long)]
        email: String,
        /// Console role: owner, support, onboarding or analyst.
        #[arg(long, default_value = "owner")]
        role: String,
        /// Their Supabase Auth user id, to skip the Supabase lookup.
        #[arg(long)]
        auth_uid: Option<uuid::Uuid>,
        /// Their name as the console shows it; defaults to the part of the email before the @.
        #[arg(long)]
        name: Option<String>,
    },
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
        Command::Outbox {
            action: Outbox::Drain { every },
        } => drain(config, every).await,
    }
}

/// Serves the API until a shutdown signal, then drains in-flight requests.
///
/// The pool connects on first use, so the server starts while the database is briefly down.
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
            http = http.with_edge(EdgeConfig::new(secret));
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
    let throttle = aarogyam_api::standard_throttle().context("invalid throttle rules")?;
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
    if !local {
        tracing::warn!("patient files are kept on local disk until object storage is set up");
    }
    let files = Files::new(Arc::new(LocalDisk::new(config.files.dir)), signer);
    let mut state = AppState::new(db, http, tokens, hosts).with_quality_dir(config.quality.dir);
    if let Some(admin) = accounts {
        state = state.with_accounts(Arc::new(admin));
    } else if !local {
        tracing::warn!("supabase.secret_key is not set: invited people get no sign-in account");
    }
    let state = state
        .with_throttle(throttle)
        .with_notifier(notifier)
        .with_files(files)
        .with_website(aarogyam_api::WebsiteLinks {
            sites_target: config.website.sites_target,
            address_template: config.website.address_template,
        });
    sakalya_http::serve(aarogyam_api::router(state), config.http.bind)
        .await
        .context("the server stopped with an error")
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

/// Delivers due outbox messages over the API connection, once or on a fixed interval.
async fn drain(config: Config, every: Option<u64>) -> anyhow::Result<()> {
    let local = config.environment == Environment::Local;
    let notifier = notifier(&config, local)?;
    let db = Db::connect_lazy(&config.db.api_config())
        .context("db.url is not a valid Postgres URL or the pool settings are invalid")?;
    let interval = every.map(|seconds| std::time::Duration::from_secs(seconds.max(1)));
    loop {
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
        Admin::GrantPlatform {
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
            .await
            .context("could not grant console access")?;
            tracing::info!(%user_id, auth_uid = %person.auth_uid, role = role.as_str(), "console access granted");
        }
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
    aarogyam_dal::migrate(db.pool())
        .await
        .context("could not migrate the database")?;
    tracing::info!("database migrated");
    Ok(())
}
