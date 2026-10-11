//! The patient message step of the outbox job: queue appointment reminders that are due, claim
//! due messages within the provider's daily budget, decide each one at send time
//! ([`aarogyam_domain::messaging::decide`] on what `app.message_dispatch` reports), then send,
//! skip, or put it back, and record the outcome. Logs carry ids, kinds and reasons only.

use std::fmt::Write as _;

use aarogyam_dal::campaigns;
use aarogyam_dal::message_worker::{self as dal, ClaimedMessage, Dispatch};
use aarogyam_domain::campaign::FAN_OUT_BATCH;
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::event::Event;
use aarogyam_domain::messaging::{
    About, AppointmentNow, DueCheck, PatientState, SkipReason, Verdict, decide,
};
use aarogyam_domain::outbox::{MessageKind, retry_at};
use aws_lc_rs::digest;
use base64::Engine as _;
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

use crate::patient_templates::{self, PatientMail};
use crate::{EmailChannel, Failure, Notifier};

/// Most patient messages one run handles.
const BATCH: i32 = 50;
/// How long a claimed message is held before another worker may retry it, in seconds.
const LEASE_SECONDS: i32 = 300;
/// Most reminders one run queues.
const REMINDER_BATCH: i32 = 200;
/// Most campaign batches one run expands.
const FAN_OUT_CALLS: usize = 20;

/// What one run of the patient message step did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MessageReport {
    /// Appointment reminders queued.
    pub reminders_queued: i32,
    /// Messages claimed to send now.
    pub claimed: usize,
    /// Sent.
    pub sent: usize,
    /// Not sent, for a reason (consent, an opt-out, no address...).
    pub skipped: usize,
    /// Put back until later: quiet hours, or a reminder whose appointment moved.
    pub rescheduled: usize,
    /// Moved to tomorrow: the provider's daily budget was spent.
    pub deferred: usize,
    /// Failed, to be tried again.
    pub retrying: usize,
    /// Failed for the last time.
    pub failed: usize,
    /// Campaign messages queued by this run's fan-out.
    pub campaign_queued: i64,
    /// Campaign recipients skipped by the weekly promotional cap.
    pub campaign_capped: i64,
}

/// A new unsubscribe token and the SHA-256 (hex) it is stored under, as
/// `aarogyam_app::tokens::hash_token` computes it.
fn unsubscribe_token() -> Result<(String, String), Failure> {
    let mut bytes = [0_u8; 24];
    aws_lc_rs::rand::fill(&mut bytes).map_err(|_| Failure::retryable("no randomness"))?;
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let hash = hash_token(&token);
    Ok((token, hash))
}

/// The SHA-256 (hex) a token is stored and looked up under.
fn hash_token(token: &str) -> String {
    digest::digest(&digest::SHA256, token.as_bytes())
        .as_ref()
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            // Writing to a String can't fail.
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

/// Why the clinic's template stops a message on its channel: none for email without a row (the
/// wording is in code), else anything but `approved`.
pub(crate) fn template_block(message: &Dispatch) -> Option<SkipReason> {
    match (message.channel.as_str(), message.template_status.as_deref()) {
        (_, Some("approved")) | ("email", None) => None,
        (_, Some("paused")) => Some(SkipReason::TemplatePaused),
        _ => Some(SkipReason::TemplateUnavailable),
    }
}

pub(crate) fn due_check(
    message: &Dispatch,
    purpose: Purpose,
    kind: Option<MessageKind>,
    blocked: Option<SkipReason>,
) -> DueCheck {
    let appointment = match (&message.appointment_status, message.appointment_starts_at) {
        (Some(status), Some(starts_at)) => Some(AppointmentNow {
            active: matches!(status.as_str(), "booked" | "confirmed"),
            starts_at,
        }),
        _ => None,
    };
    DueCheck {
        purpose,
        patient: PatientState::parse(&message.patient_state),
        may_contact: message.may_contact,
        opted_out: message.opted_out,
        has_address: message
            .address
            .as_deref()
            .is_some_and(|text| !text.is_empty()),
        quiet_until: message.quiet_until,
        blocked,
        about: if kind == Some(MessageKind::AppointmentReminder) {
            About::Reminder(appointment)
        } else {
            About::Nothing
        },
    }
}

impl Notifier {
    /// Queues due appointment reminders, then sends due patient messages within the email
    /// provider's daily budget.
    ///
    /// # Errors
    /// [`DbError`] when the database fails; messages already settled stay settled, and a claimed
    /// one whose outcome wasn't recorded is retried after its lease.
    pub async fn drain_messages(
        &self,
        db: &Db,
        now: OffsetDateTime,
    ) -> Result<MessageReport, DbError> {
        let mut report = MessageReport {
            reminders_queued: dal::queue_reminders(db.pool(), now, REMINDER_BATCH).await?,
            ..MessageReport::default()
        };
        self.fan_out_campaigns(db, &mut report).await?;
        let claimed = dal::claim(
            db.pool(),
            "email",
            self.email_provider(),
            self.daily_budget,
            BATCH,
            LEASE_SECONDS,
            self.campaigns_enabled,
        )
        .await?;
        for message in claimed {
            if message.deferred {
                report.deferred += 1;
                continue;
            }
            report.claimed += 1;
            self.handle(db, message, now, &mut report).await?;
        }
        if report.deferred > 0 {
            tracing::warn!(
                provider = self.email_provider(),
                deferred = report.deferred,
                "daily email budget spent; messages moved to tomorrow"
            );
        }
        self.drain_whatsapp(db, now, &mut report).await?;
        Ok(report)
    }

    /// Expands due campaigns into messages, a batch of 500 recipients at a time, up to
    /// [`FAN_OUT_CALLS`] batches a run. Nothing happens while the platform kill switch is off
    /// (`ARO_CAMPAIGNS__ENABLED=false`): campaigns stay as they are and resume when it is on.
    async fn fan_out_campaigns(&self, db: &Db, report: &mut MessageReport) -> Result<(), DbError> {
        if !self.campaigns_enabled {
            return Ok(());
        }
        for _ in 0..FAN_OUT_CALLS {
            let Some(step) = campaigns::fan_out_next(db.pool(), FAN_OUT_BATCH).await? else {
                break;
            };
            report.campaign_queued += i64::from(step.queued);
            report.campaign_capped += i64::from(step.capped);
            tracing::info!(
                event = Event::CampaignFanOut.as_str(),
                org_id = %step.org_id,
                campaign_id = %step.campaign_id,
                queued = step.queued,
                capped = step.capped,
                finished = step.finished,
                "campaign recipients queued"
            );
        }
        Ok(())
    }

    async fn handle(
        &self,
        db: &Db,
        claimed: ClaimedMessage,
        now: OffsetDateTime,
        report: &mut MessageReport,
    ) -> Result<(), DbError> {
        let (org_id, id) = (claimed.org_id, claimed.id);
        let Some(message) = dal::dispatch(db.pool(), org_id, id).await? else {
            return Ok(());
        };
        let kind = MessageKind::parse(&message.kind);
        let Ok(purpose) = Purpose::parse(&message.purpose) else {
            return self.skip(db, &claimed, "unsupported", report).await;
        };
        let blocked = template_block(&message);
        match decide(&due_check(&message, purpose, kind, blocked), now) {
            Verdict::Skip(reason) => self.skip(db, &claimed, reason.as_str(), report).await,
            Verdict::Wait(at) => {
                dal::reschedule(db.pool(), org_id, id, at).await?;
                report.rescheduled += 1;
                Ok(())
            }
            Verdict::Send => {
                let Some(kind) = kind else {
                    return self.skip(db, &claimed, "unsupported", report).await;
                };
                let outcome = self
                    .send(db, &claimed, &message, kind, purpose)
                    .await
                    .map(|(provider, provider_id)| (provider, provider_id, None));
                self.settle(db, &claimed, &message.kind, outcome, now, report)
                    .await
            }
        }
    }

    pub(crate) async fn skip(
        &self,
        db: &Db,
        claimed: &ClaimedMessage,
        reason: &str,
        report: &mut MessageReport,
    ) -> Result<(), DbError> {
        dal::mark_skipped(db.pool(), claimed.org_id, claimed.id, reason).await?;
        report.skipped += 1;
        tracing::info!(
            event = Event::MessageSkipped.as_str(),
            org_id = %claimed.org_id,
            message_id = %claimed.id,
            reason,
            "patient message skipped"
        );
        Ok(())
    }
}

impl Notifier {
    /// Renders and sends one message: the provider and its message id on success. Reminders and
    /// promotional email get an unsubscribe token first, stored hashed.
    async fn send(
        &self,
        db: &Db,
        claimed: &ClaimedMessage,
        message: &Dispatch,
        kind: MessageKind,
        purpose: Purpose,
    ) -> Result<(&'static str, Option<String>), Failure> {
        let to = message
            .address
            .as_deref()
            .ok_or_else(|| Failure::permanent("no address"))?;
        let unsubscribe = match (purpose, message.portal_host.as_deref()) {
            (Purpose::Reminders | Purpose::Promotional, Some(host)) => {
                let (token, hash) = unsubscribe_token()?;
                dal::set_unsubscribe_hash(db.pool(), claimed.org_id, claimed.id, &hash)
                    .await
                    .map_err(|_| Failure::retryable("could not store the unsubscribe token"))?;
                Some(self.links.unsubscribe(host, &token))
            }
            _ => None,
        };
        let appointment = message
            .appointment_starts_at
            .map(|at| (at, message.doctor_name.as_deref().unwrap_or("the doctor")));
        let email = patient_templates::render(
            &PatientMail {
                kind,
                template_key: &message.template_key,
                to,
                variables: &message.variables,
                body: message.body.as_deref(),
                secret: message.secret.as_deref(),
                clinic_name: &message.clinic_name,
                timezone: &message.timezone,
                portal_host: message.portal_host.as_deref(),
                appointment,
                unsubscribe,
            },
            &self.links,
        )?;
        match &self.email {
            EmailChannel::Log => Ok(("log", None)),
            EmailChannel::Resend(resend) => {
                let id = resend.send(&claimed.id.to_string(), &email).await?;
                Ok(("resend", Some(id)))
            }
        }
    }

    /// Records a send's outcome: sent, retried with backoff, or abandoned.
    pub(crate) async fn settle(
        &self,
        db: &Db,
        claimed: &ClaimedMessage,
        kind: &str,
        outcome: Result<(&'static str, Option<String>, Option<i64>), Failure>,
        now: OffsetDateTime,
        report: &mut MessageReport,
    ) -> Result<(), DbError> {
        let (org_id, id) = (claimed.org_id, claimed.id);
        match outcome {
            Ok((provider, provider_id, cost_paise)) => {
                dal::mark_sent(
                    db.pool(),
                    org_id,
                    id,
                    provider,
                    provider_id.as_deref(),
                    cost_paise,
                )
                .await?;
                report.sent += 1;
                tracing::info!(
                    event = Event::MessageSent.as_str(),
                    org_id = %org_id,
                    message_id = %id,
                    kind,
                    provider,
                    "patient message sent"
                );
            }
            Err(failure) => {
                let attempts = u32::try_from(claimed.attempts).unwrap_or(u32::MAX);
                let retry = failure.retryable.then(|| retry_at(attempts, now)).flatten();
                dal::mark_failed(db.pool(), org_id, id, &failure.reason, retry).await?;
                if retry.is_some() {
                    report.retrying += 1;
                    tracing::warn!(
                        event = Event::MessageRetried.as_str(),
                        org_id = %org_id,
                        message_id = %id,
                        attempts,
                        reason = %failure.reason,
                        "patient message failed; will retry"
                    );
                } else {
                    report.failed += 1;
                    tracing::error!(
                        event = Event::MessageFailed.as_str(),
                        org_id = %org_id,
                        message_id = %id,
                        attempts,
                        reason = %failure.reason,
                        "patient message abandoned"
                    );
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_stored_as_their_sha256() {
        // The SHA-256 of "abc", as `aarogyam_app::tokens::hash_token` stores it.
        assert_eq!(
            hash_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let (first, hash) = unsubscribe_token().unwrap();
        let (second, _) = unsubscribe_token().unwrap();
        assert_ne!(first, second);
        assert_eq!(first.len(), 32);
        assert_eq!(hash, hash_token(&first));
    }
}
