//! Loading settings from the committed local defaults and `ARO_*` environment variables.
#![expect(
    clippy::unwrap_used,
    clippy::result_large_err,
    reason = "test helpers fail loudly; figment::Jail closures must return its large error type"
)]

use std::net::SocketAddr;
use std::path::Path;

use aarogyam_server::config::Config;
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
    jail.set_env("ARO_AUTH__ISSUER", "https://auth.example/auth/v1");
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
