//! Email through Resend (`POST https://api.resend.com/emails`).

use std::time::Duration;

use reqwest::StatusCode;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

use crate::templates::Email;
use crate::{Failure, NotifyError};

const ENDPOINT: &str = "https://api.resend.com/emails";
const TIMEOUT: Duration = Duration::from_secs(10);

/// A Resend client with its API key and sender address.
pub struct Resend {
    client: reqwest::Client,
    api_key: SecretString,
    from: String,
}

impl std::fmt::Debug for Resend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Resend").finish_non_exhaustive()
    }
}

#[derive(Serialize)]
struct SendEmail<'a> {
    from: &'a str,
    to: [&'a str; 1],
    subject: &'a str,
    text: &'a str,
    html: &'a str,
}

#[derive(Deserialize)]
struct Sent {
    id: String,
}

/// Whether a failed response is worth retrying: rate limits and server errors are; other
/// client errors (a bad address, an unverified sender) won't change by themselves.
fn classify(status: StatusCode) -> Failure {
    let reason = format!("resend answered {}", status.as_u16());
    if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        Failure::retryable(reason)
    } else {
        Failure::permanent(reason)
    }
}

impl Resend {
    /// A client sending from `from`.
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] if `from` is empty or the HTTP client can't be built.
    pub fn new(api_key: SecretString, from: &str) -> Result<Self, NotifyError> {
        if from.trim().is_empty() {
            return Err(NotifyError::Configuration(
                "email.from is required for Resend",
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|_| NotifyError::Configuration("could not build the HTTP client"))?;
        Ok(Self {
            client,
            api_key,
            from: from.trim().to_owned(),
        })
    }

    /// Sends `email`; Resend's message id on success. `idempotency_key` (the outbox message
    /// id) makes a retry after a lost answer send nothing twice.
    pub(crate) async fn send(
        &self,
        idempotency_key: &str,
        email: &Email,
    ) -> Result<String, Failure> {
        let body = SendEmail {
            from: &self.from,
            to: [&email.to],
            subject: &email.subject,
            text: &email.text,
            html: &email.html,
        };
        let response = self
            .client
            .post(ENDPOINT)
            .bearer_auth(self.api_key.expose_secret())
            .header("Idempotency-Key", idempotency_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                Failure::retryable(if error.is_timeout() {
                    "resend timed out"
                } else {
                    "resend unreachable"
                })
            })?;
        let status = response.status();
        if !status.is_success() {
            return Err(classify(status));
        }
        let sent: Sent = response
            .json()
            .await
            .map_err(|_| Failure::permanent("resend answered without an id"))?;
        Ok(sent.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limits_and_outages_are_retried() {
        assert!(classify(StatusCode::TOO_MANY_REQUESTS).retryable);
        assert!(classify(StatusCode::BAD_GATEWAY).retryable);
        let refused = classify(StatusCode::UNPROCESSABLE_ENTITY);
        assert!(!refused.retryable);
        assert_eq!(refused.reason, "resend answered 422");
        assert!(Resend::new(SecretString::from("re_x"), " ").is_err());
    }
}
