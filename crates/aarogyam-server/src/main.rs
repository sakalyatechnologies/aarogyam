//! The `aarogyam` binary: `serve` runs the HTTP API, `migrate` applies the database migrations.

use std::path::PathBuf;

use aarogyam_api::{AppState, DevTokens, Hosts, TokenCheck};
use aarogyam_server::config::{AuthMode, Config};
use anyhow::Context;
use clap::{Parser, Subcommand};
use sakalya_auth::{JwtConfig, JwtVerifier};
use sakalya_config::Environment;
use sakalya_db::{Db, DbConfig};
use sakalya_http::{EdgeConfig, EdgeSecret};

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
    let db = Db::connect_lazy(&DbConfig::new(config.db.url))
        .context("db.url is not a valid Postgres URL")?;
    let tokens = match config.auth.mode {
        AuthMode::Dev => {
            anyhow::ensure!(
                local,
                "auth.mode = dev is allowed only when environment = local"
            );
            let secret = config
                .auth
                .dev_secret
                .context("auth.dev_secret is required when auth.mode = dev")?;
            TokenCheck::Dev(DevTokens::new(
                &config.auth.issuer,
                &config.auth.audience,
                secret,
            ))
        }
        AuthMode::Supabase => {
            let jwks_url = config
                .auth
                .jwks_url
                .context("auth.jwks_url is required when auth.mode = supabase")?;
            let verifier = JwtVerifier::remote(JwtConfig::new(
                &config.auth.issuer,
                &config.auth.audience,
                &jwks_url,
            ))
            .context("auth.jwks_url is not a valid URL")?;
            if let Err(error) = verifier.prefetch().await {
                // Not fatal: keys are fetched again on the first sign-in.
                tracing::warn!(error = %error, "could not fetch the token signing keys at startup");
            }
            TokenCheck::Supabase(verifier)
        }
    };
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
    let state = AppState::new(db, http, tokens, hosts);
    sakalya_http::serve(aarogyam_api::router(state), config.http.bind)
        .await
        .context("the server stopped with an error")
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
