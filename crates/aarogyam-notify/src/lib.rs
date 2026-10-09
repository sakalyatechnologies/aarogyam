//! Aarogyam's notification worker: delivers the outbox.
//!
//! Use cases queue messages with `aarogyam_app::outbox` in the same transaction as the change
//! that causes them. [`Notifier::drain`] claims due messages across clinics (`FOR UPDATE SKIP
//! LOCKED`, so workers never deliver the same message twice at once), renders each from its
//! template, sends it, and records the outcome: sent, retried later with backoff
//! (`aarogyam_domain::outbox::retry_at`), or abandoned after the last attempt.
//!
//! Email goes through Resend when an API key is configured; otherwise the log channel records
//! the message as delivered and logs its ids only, which is what local development uses.
//! Logs never carry addresses, names or link secrets.
//!
//! The same job makes new clinics' portal addresses work at the edge first ([`PortalAddresses`],
//! in `addresses.rs`), so an invitation link works by the time its email arrives, and reminds
//! staff of booking requests nobody has answered, then tells the owners ([`remind`], in
//! `staff.rs`, which also holds the delivery seam for push), and reminds labs of work due
//! ([`remind_labs`], in `lab.rs`).

mod addresses;
pub mod cloudflare;
mod lab;
mod resend;
mod staff;
mod templates;

use aarogyam_dal::outbox::{self, Claimed};
use aarogyam_domain::event::Event;
use aarogyam_domain::outbox::{Channel, retry_at};
use sakalya_db::{Db, DbError};
use secrecy::SecretString;
use time::OffsetDateTime;

pub use addresses::{AddressReport, PortalAddresses, WorkersDev};
pub use lab::{LabReminderReport, remind_labs};
pub use resend::Resend;
pub use staff::{ReminderReport, StaffAlert, StaffChannel, remind};
pub use templates::{Email, PortalLinks};

/// Most messages one drain delivers.
const BATCH: i32 = 50;
/// How long a claimed message is held before another worker may retry it, in seconds.
const LEASE_SECONDS: i32 = 300;
/// Days a processed message is kept before it is deleted.
const KEEP_DAYS: i32 = 30;

/// The notification service could not be set up.
#[derive(Debug, thiserror::Error)]
pub enum NotifyError {
    /// A setting is invalid; the message says which.
    #[error("invalid notification setting: {0}")]
    Configuration(&'static str),
}

/// How email leaves.
#[derive(Debug)]
enum EmailChannel {
    /// Recorded as delivered and logged by id: local development.
    Log,
    /// Sent through Resend.
    Resend(Resend),
}

/// Why a delivery failed, without the message's content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Failure {
    /// A short reason, stored with the message.
    pub(crate) reason: String,
    /// Whether trying again could help (an outage, a rate limit) or not (a bad template).
    pub(crate) retryable: bool,
}

impl Failure {
    pub(crate) fn permanent(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            retryable: false,
        }
    }

    pub(crate) fn retryable(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            retryable: true,
        }
    }
}

/// What one drain did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DrainReport {
    /// Messages claimed.
    pub claimed: usize,
    /// Delivered.
    pub sent: usize,
    /// Failed, to be tried again.
    pub retrying: usize,
    /// Failed for the last time.
    pub failed: usize,
    /// Old processed messages deleted.
    pub purged: i64,
}

/// Delivers queued messages.
#[derive(Debug)]
pub struct Notifier {
    email: EmailChannel,
    links: PortalLinks,
}

impl Notifier {
    /// Email to the log only: nothing leaves the machine.
    #[must_use]
    pub const fn log(links: PortalLinks) -> Self {
        Self {
            email: EmailChannel::Log,
            links,
        }
    }

    /// Email through Resend, from `from` (an address on a domain verified with Resend).
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] if the HTTP client can't be built or `from` is empty.
    pub fn resend(
        api_key: SecretString,
        from: &str,
        links: PortalLinks,
    ) -> Result<Self, NotifyError> {
        Ok(Self {
            email: EmailChannel::Resend(Resend::new(api_key, from)?),
            links,
        })
    }

    /// Where links in messages point.
    #[must_use]
    pub const fn links(&self) -> &PortalLinks {
        &self.links
    }

    /// The channel email goes through: `resend` or `log`.
    #[must_use]
    pub const fn email_provider(&self) -> &'static str {
        match self.email {
            EmailChannel::Log => "log",
            EmailChannel::Resend(_) => "resend",
        }
    }

    /// Claims due messages, delivers them, records each outcome, and deletes messages
    /// processed long ago.
    ///
    /// # Errors
    /// [`DbError`] when the database fails; messages already settled stay settled, and a
    /// claimed one whose outcome wasn't recorded is retried after its lease.
    pub async fn drain(&self, db: &Db, now: OffsetDateTime) -> Result<DrainReport, DbError> {
        let pool = db.pool();
        let claimed = outbox::claim(pool, BATCH, LEASE_SECONDS).await?;
        let mut report = DrainReport {
            claimed: claimed.len(),
            ..DrainReport::default()
        };
        for message in &claimed {
            match self.deliver(message).await {
                Ok((provider, provider_id)) => {
                    outbox::mark_sent(
                        pool,
                        message.org_id,
                        message.id,
                        provider,
                        provider_id.as_deref(),
                    )
                    .await?;
                    report.sent += 1;
                    tracing::info!(
                        event = Event::MessageSent.as_str(),
                        org_id = %message.org_id,
                        message_id = %message.id,
                        kind = %message.event_key,
                        provider,
                        "message sent"
                    );
                }
                Err(failure) => {
                    let attempts = u32::try_from(message.attempts).unwrap_or(u32::MAX);
                    let retry = if failure.retryable {
                        retry_at(attempts, now)
                    } else {
                        None
                    };
                    outbox::mark_failed(pool, message.org_id, message.id, &failure.reason, retry)
                        .await?;
                    if retry.is_some() {
                        report.retrying += 1;
                        tracing::warn!(
                            event = Event::MessageRetried.as_str(),
                            org_id = %message.org_id,
                            message_id = %message.id,
                            attempts,
                            reason = %failure.reason,
                            "message failed; will retry"
                        );
                    } else {
                        report.failed += 1;
                        tracing::error!(
                            event = Event::MessageFailed.as_str(),
                            org_id = %message.org_id,
                            message_id = %message.id,
                            attempts,
                            reason = %failure.reason,
                            "message abandoned"
                        );
                    }
                }
            }
        }
        report.purged = outbox::purge(pool, KEEP_DAYS).await?;
        Ok(report)
    }

    /// Renders and sends one message; the provider and its message id on success.
    async fn deliver(&self, message: &Claimed) -> Result<(&'static str, Option<String>), Failure> {
        match Channel::parse(&message.channel) {
            Some(Channel::Email) => {
                let email = templates::render(message, &self.links)?;
                match &self.email {
                    EmailChannel::Log => Ok(("log", None)),
                    EmailChannel::Resend(resend) => {
                        let id = resend.send(&message.id.to_string(), &email).await?;
                        Ok(("resend", Some(id)))
                    }
                }
            }
            None => Err(Failure::permanent("unknown channel")),
        }
    }
}
