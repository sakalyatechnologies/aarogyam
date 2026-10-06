//! The two Cloudflare Workers API calls a per-host Worker needs: upload a module Worker
//! (`PUT /accounts/{account}/workers/scripts/{name}`) and turn on its workers.dev address
//! (`POST .../scripts/{name}/subdomain`). Both are idempotent, so a retry after a lost answer
//! changes nothing. The API token needs only "Workers Scripts: Edit" on the account.
//!
//! No product concepts here: this moves to `sakalya-backend` with the next product that needs
//! it (AGENTS.md rule 13). Names reach a URL only as a [`WorkerName`], and the token only
//! leaves in the `Authorization` header: it is never logged, stored or put in an error.

use std::time::Duration;

use reqwest::StatusCode;
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use serde_json::json;

use crate::{Failure, NotifyError};

/// Cloudflare's API.
pub const API_BASE: &str = "https://api.cloudflare.com/client/v4";
const TIMEOUT: Duration = Duration::from_secs(20);
/// Separates the multipart upload's parts; neither part may contain it.
const BOUNDARY: &str = "sakalya-worker-upload-4f7c2a9e";

/// A Worker script name, which is also its workers.dev label: 1 to 63 lower-case letters,
/// digits and hyphens, not starting or ending with a hyphen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerName(String);

impl WorkerName {
    /// Checks `text` is a valid Worker name.
    ///
    /// # Errors
    /// A short reason when it isn't.
    pub fn parse(text: &str) -> Result<Self, &'static str> {
        let valid_chars = text
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if text.is_empty() || text.len() > 63 {
            Err("a Worker name has 1 to 63 characters")
        } else if !valid_chars || text.starts_with('-') || text.ends_with('-') {
            Err("a Worker name has lower-case letters, digits and inner hyphens only")
        } else {
            Ok(Self(text.to_owned()))
        }
    }

    /// The name.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A Cloudflare account id: 32 lower-case hex digits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountId(String);

impl AccountId {
    /// Checks `text` looks like an account id.
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] when it doesn't.
    pub fn parse(text: &str) -> Result<Self, NotifyError> {
        let text = text.trim();
        if text.len() == 32
            && text
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            Ok(Self(text.to_owned()))
        } else {
            Err(NotifyError::Configuration(
                "the Cloudflare account id must be 32 lower-case hex digits",
            ))
        }
    }
}

/// A service binding: the uploaded Worker calls `service` as `env.<name>`.
#[derive(Debug, Clone, Copy)]
pub struct ServiceBinding<'a> {
    /// The variable name in the Worker's `env`, such as `PORTAL`.
    pub name: &'a str,
    /// The Worker it calls.
    pub service: &'a WorkerName,
}

/// A client for one account's Workers.
pub struct WorkersApi {
    client: reqwest::Client,
    base: String,
    account: AccountId,
    token: SecretString,
}

impl std::fmt::Debug for WorkersApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkersApi")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

/// Cloudflare's answer envelope; only the first error's code is kept.
#[derive(Deserialize)]
struct Envelope {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    errors: Vec<ApiError>,
}

#[derive(Deserialize)]
struct ApiError {
    code: i64,
}

/// Whether a failed answer is worth retrying: rate limits, conflicts and outages are; a bad
/// token or a refused upload won't change by itself (fix it, then queue the host again).
fn classify(status: StatusCode, code: Option<i64>) -> Failure {
    let reason = match code {
        Some(code) => format!("cloudflare answered {} (code {code})", status.as_u16()),
        None => format!("cloudflare answered {}", status.as_u16()),
    };
    if status == StatusCode::TOO_MANY_REQUESTS
        || status == StatusCode::CONFLICT
        || status.is_server_error()
    {
        Failure::retryable(reason)
    } else {
        Failure::permanent(reason)
    }
}

impl WorkersApi {
    /// A client for `account` at `base` ([`API_BASE`], or a stand-in in tests).
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] if the token is empty or the HTTP client can't be built.
    pub fn new(base: &str, account: AccountId, token: SecretString) -> Result<Self, NotifyError> {
        if token.expose_secret().trim().is_empty() {
            return Err(NotifyError::Configuration(
                "the Cloudflare API token is empty",
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|_| NotifyError::Configuration("could not build the HTTP client"))?;
        Ok(Self {
            client,
            base: base.trim_end_matches('/').to_owned(),
            account,
            token,
        })
    }

    fn script_url(&self, name: &WorkerName) -> String {
        format!(
            "{}/accounts/{}/workers/scripts/{}",
            self.base,
            self.account.0,
            name.as_str()
        )
    }

    /// Uploads (or replaces) `name` as a single-module Worker running `source`, with one
    /// service binding and no other bindings.
    pub(crate) async fn put_module(
        &self,
        name: &WorkerName,
        source: &str,
        compatibility_date: &str,
        binding: ServiceBinding<'_>,
    ) -> Result<(), Failure> {
        let metadata = json!({
            "main_module": "worker.js",
            "compatibility_date": compatibility_date,
            "bindings": [{ "type": "service", "name": binding.name, "service": binding.service.as_str() }],
        })
        .to_string();
        if metadata.contains(BOUNDARY) || source.contains(BOUNDARY) {
            return Err(Failure::permanent("the upload contains its own boundary"));
        }
        let body = format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\
             Content-Type: application/json\r\n\r\n{metadata}\r\n\
             --{BOUNDARY}\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\n\
             Content-Type: application/javascript+module\r\n\r\n{source}\r\n--{BOUNDARY}--\r\n"
        );
        let request = self
            .client
            .put(self.script_url(name))
            .header(
                reqwest::header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(body);
        self.send(request).await
    }

    /// Serves `name` at `<name>.<account subdomain>.workers.dev`, without preview addresses.
    pub(crate) async fn enable_workers_dev(&self, name: &WorkerName) -> Result<(), Failure> {
        let request = self
            .client
            .post(format!("{}/subdomain", self.script_url(name)))
            .json(&json!({ "enabled": true, "previews_enabled": false }));
        self.send(request).await
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<(), Failure> {
        let response = request
            .bearer_auth(self.token.expose_secret())
            .send()
            .await
            .map_err(|error| {
                Failure::retryable(if error.is_timeout() {
                    "cloudflare timed out"
                } else {
                    "cloudflare unreachable"
                })
            })?;
        let status = response.status();
        let envelope: Option<Envelope> = response.json().await.ok();
        let code = envelope
            .as_ref()
            .and_then(|e| e.errors.first())
            .map(|e| e.code);
        if status.is_success() && envelope.as_ref().is_some_and(|e| e.success) {
            Ok(())
        } else if status.is_success() {
            Err(Failure::retryable(match code {
                Some(code) => format!("cloudflare refused (code {code})"),
                None => "cloudflare answered without success".to_owned(),
            }))
        } else {
            Err(classify(status, code))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_names_are_dns_labels() {
        assert!(WorkerName::parse("sunrise-aarogyam").is_ok());
        assert!(WorkerName::parse("").is_err());
        assert!(WorkerName::parse("-sunrise").is_err());
        assert!(WorkerName::parse("sunrise-").is_err());
        assert!(WorkerName::parse("Sunrise").is_err());
        assert!(WorkerName::parse("sun/rise").is_err());
        assert!(WorkerName::parse("sun.rise").is_err());
        assert!(WorkerName::parse(&"a".repeat(64)).is_err());
        assert!(WorkerName::parse(&"a".repeat(63)).is_ok());
    }

    #[test]
    fn account_ids_are_hex() {
        assert!(AccountId::parse("0123456789abcdef0123456789abcdef").is_ok());
        assert!(AccountId::parse("0123456789ABCDEF0123456789ABCDEF").is_err());
        assert!(AccountId::parse("../../zones").is_err());
    }

    #[test]
    fn outages_are_retried_and_refusals_are_not() {
        assert!(classify(StatusCode::TOO_MANY_REQUESTS, None).retryable);
        assert!(classify(StatusCode::BAD_GATEWAY, None).retryable);
        let refused = classify(StatusCode::FORBIDDEN, Some(10_000));
        assert!(!refused.retryable);
        assert_eq!(refused.reason, "cloudflare answered 403 (code 10000)");
    }

    #[test]
    fn an_empty_token_is_refused() {
        let account = AccountId::parse("0123456789abcdef0123456789abcdef").unwrap();
        assert!(WorkersApi::new(API_BASE, account, SecretString::from(" ")).is_err());
    }
}
