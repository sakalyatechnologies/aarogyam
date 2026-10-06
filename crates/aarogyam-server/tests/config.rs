//! Loading settings from the committed local defaults and `ARO_*` environment variables.
#![expect(
    clippy::unwrap_used,
    clippy::result_large_err,
    reason = "test helpers fail loudly; figment::Jail closures must return its large error type"
)]

use std::net::SocketAddr;
use std::path::Path;

use aarogyam_server::config::{AuthMode, Config};
use figment::Jail;
use sakalya_config::Environment;
use secrecy::ExposeSecret;

/// The committed local defaults.
const LOCAL_FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../config/local.toml");

/// A file name that does not exist inside the jail, as on a deployed service.
const NO_FILE: &str = "absent.toml";

/// Clears the environment, then sets only what a deployment must provide.
fn set_required(jail: &mut Jail) {
    jail.clear_env();
    jail.set_env("ARO_ENVIRONMENT", "staging");
    jail.set_env(
        "ARO_DB__URL",
        "postgres://aarogyam_api:hunter2@db.internal/aarogyam",
    );
    jail.set_env("ARO_AUTH__MODE", "supabase");
    jail.set_env("ARO_AUTH__ISSUER", "https://auth.example/auth/v1");
    jail.set_env("ARO_HOSTS__PORTAL_HOST_TEMPLATE", "{slug}.aarogyam.example");
    jail.set_env("ARO_HOSTS__CONSOLE", "console.aarogyam.example");
    jail.set_env("ARO_HOSTS__APP", "app.aarogyam.example");
    jail.set_env("ARO_AUTH__AUDIENCE", "authenticated");
    jail.set_env(
        "ARO_AUTH__JWKS_URL",
        "https://auth.example/auth/v1/.well-known/jwks.json",
    );
}

fn load(file: &str) -> Config {
    Config::load(Path::new(file)).unwrap()
}

#[test]
fn defaults_fill_in_what_the_environment_leaves_out() {
    Jail::expect_with(|jail| {
        set_required(jail);
        let config = load(NO_FILE);
        assert_eq!(
            config.http.bind,
            "0.0.0.0:8080".parse::<SocketAddr>().unwrap()
        );
        assert_eq!(config.http.request_timeout_secs, 30);
        assert_eq!(config.http.body_limit_bytes, 1024 * 1024);
        assert!(config.db.owner_url.is_none());
        Ok(())
    });
}

#[test]
fn environment_variables_override_the_local_file() {
    Jail::expect_with(|jail| {
        jail.clear_env();
        jail.set_env("ARO_HTTP__BIND", "0.0.0.0:9000");
        jail.set_env(
            "ARO_DB__OWNER_URL",
            "postgres://postgres@db.internal/aarogyam",
        );
        let config = load(LOCAL_FILE);
        assert_eq!(config.environment, Environment::Local);
        assert_eq!(
            config.http.bind,
            "0.0.0.0:9000".parse::<SocketAddr>().unwrap()
        );
        let owner_url = config.db.owner_url.unwrap();
        assert_eq!(
            owner_url.expose_secret(),
            "postgres://postgres@db.internal/aarogyam"
        );
        Ok(())
    });
}

#[test]
fn misspelt_variable_is_rejected() {
    Jail::expect_with(|jail| {
        set_required(jail);
        jail.set_env(
            "ARO_DB__OWNER_ULR",
            "postgres://postgres@db.internal/aarogyam",
        );
        let error = Config::load(Path::new(NO_FILE)).unwrap_err();
        assert!(error.to_string().contains("owner_ulr"), "{error}");
        Ok(())
    });
}

#[test]
fn database_password_stays_out_of_debug_output() {
    Jail::expect_with(|jail| {
        set_required(jail);
        let config = load(NO_FILE);
        assert!(!format!("{config:?}").contains("hunter2"));
        Ok(())
    });
}

#[test]
fn local_defaults_use_development_tokens_without_supabase() {
    Jail::expect_with(|jail| {
        jail.clear_env();
        let config = load(LOCAL_FILE);
        assert_eq!(config.auth.mode, AuthMode::Dev);
        assert!(config.auth.dev_tokens);
        assert_eq!(&*config.auth.dev_issuer, "aarogyam-dev");
        assert!(config.supabase.url.is_none());
        assert!(config.supabase.secret_key.is_none());
        Ok(())
    });
}

#[test]
fn supabase_issuer_and_keys_come_from_the_project_url() {
    Jail::expect_with(|jail| {
        jail.clear_env();
        jail.set_env("ARO_AUTH__MODE", "supabase");
        jail.set_env("SUPABASE_URL", "https://ref.supabase.co/");
        jail.set_env("SUPABASE_SECRET_KEY", "sb_secret_never_printed");
        let config = load(LOCAL_FILE);
        assert_eq!(config.auth.mode, AuthMode::Supabase);
        assert_eq!(
            config.auth.supabase_issuer(&config.supabase).unwrap(),
            "https://ref.supabase.co/auth/v1"
        );
        assert_eq!(
            config.auth.supabase_jwks_url(&config.supabase).unwrap(),
            "https://ref.supabase.co/auth/v1/.well-known/jwks.json"
        );
        assert!(!format!("{config:?}").contains("sb_secret_never_printed"));
        Ok(())
    });
}

#[test]
fn the_pool_keeps_two_warm_connections_unless_told_otherwise() {
    Jail::expect_with(|jail| {
        set_required(jail);
        let pool = load(NO_FILE).db;
        assert_eq!(
            (
                pool.max_connections,
                pool.min_connections,
                pool.idle_timeout_secs,
                pool.max_lifetime_secs,
                pool.ping_after_idle_secs,
                pool.statement_cache_capacity,
            ),
            (5, 2, 300, 1800, 60, 512)
        );
        jail.set_env("ARO_DB__MIN_CONNECTIONS", "1");
        jail.set_env("ARO_DB__MAX_CONNECTIONS", "3");
        jail.set_env("ARO_DB__IDLE_TIMEOUT_SECS", "120");
        let pool = load(NO_FILE).db;
        assert_eq!(
            (
                pool.min_connections,
                pool.max_connections,
                pool.idle_timeout_secs
            ),
            (1, 3, 120)
        );
        Ok(())
    });
}

#[test]
fn the_throttle_bypass_token_is_refused_outside_local() {
    Jail::expect_with(|jail| {
        set_required(jail);
        jail.set_env("ARO_THROTTLE__BYPASS_TOKEN", "x".repeat(32));
        let config = load(NO_FILE);
        assert!(config.throttle.bypass_token.is_some());
        for environment in [Environment::Staging, Environment::Production] {
            let error = config.throttle.ensure_allowed(environment).unwrap_err();
            assert!(error.to_string().contains("only when environment = local"));
        }
        config.throttle.ensure_allowed(Environment::Local).unwrap();
        Ok(())
    });
}

#[test]
fn without_a_bypass_token_every_environment_is_allowed() {
    Jail::expect_with(|jail| {
        set_required(jail);
        let config = load(NO_FILE);
        for environment in [
            Environment::Local,
            Environment::Staging,
            Environment::Production,
        ] {
            config.throttle.ensure_allowed(environment).unwrap();
        }
        Ok(())
    });
}
