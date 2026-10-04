//! The `aarogyam` binary: `serve` runs the HTTP API, `migrate` applies the database migrations.

use std::path::PathBuf;
use std::sync::Arc;

use aarogyam_api::{AppState, DevTokens, Hosts, TokenCheck};
use aarogyam_app::files::{Files, LinkSigner, LocalDisk};
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

#[derive(Debug, Clone, Copy, Default, Subcommand)]
enum Command {
    /// Serve the HTTP API until SIGTERM or Ctrl-C (the default).
    #[default]
    Serve,
    /// Apply pending database migrations over the schema owner's connection, then exit.
    Migrate,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let config = Config::load(&cli.config).context("could not load the configuration")?;
    sakalya_telemetry::init(&config.telemetry).context("could not start telemetry")?;
    match cli.command.unwrap_or_default() {
        Command::Serve => serve(config).await,
        Command::Migrate => migrate(config).await,
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
    let db = Db::connect_lazy(&DbConfig::new(config.db.url))
        .context("db.url is not a valid Postgres URL")?;
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
        portal_domain: config.hosts.portal_domain,
        console: config.hosts.console,
        app: config.hosts.app,
    };
    let throttle = aarogyam_api::standard_throttle().context("invalid throttle rules")?;
    let links = PortalLinks::new(&config.email.portal_link)
        .context("email.portal_link must look like https://{host}")?;
    let notifier = if let Some(key) = config.email.resend_api_key {
        Notifier::resend(key, &config.email.from, links)
            .context("could not set up email through Resend")?
    } else {
        if !local {
            tracing::warn!("email.resend_api_key is not set: email goes to the log only");
        }
        Notifier::log(links)
    };
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
    let state = AppState::new(db, http, tokens, hosts)
        .with_throttle(throttle)
        .with_notifier(notifier)
        .with_files(files);
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
