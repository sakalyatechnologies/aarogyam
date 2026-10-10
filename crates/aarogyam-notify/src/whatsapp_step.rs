//! The `WhatsApp` half of the patient message step: claim due `WhatsApp` messages within the
//! number's daily budget, skip them all with `channel_disabled` when the channel is off, else
//! decide each at send time (consent, opt-outs, the `WhatsApp` opt-in, an approved template,
//! quiet hours) and send the approved template with its parameters. Logs carry ids only.

use aarogyam_dal::message_worker::{self as dal, ClaimedMessage, Dispatch};
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::messaging::{SkipReason, Verdict, decide, placeholders};
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::whatsapp::{MetaOutcome, TemplateCategory};
use sakalya_db::{Db, DbError};
use serde_json::Value;
use time::OffsetDateTime;

use crate::messages::{MessageReport, due_check, template_block};
use crate::patient_templates::{clinic_offset, when_text};
use crate::whatsapp::{Meta, TemplateSend};
use crate::{DEFAULT_WHATSAPP_DAILY_BUDGET, Failure, Notifier};

const BATCH: i32 = 50;
const LEASE_SECONDS: i32 = 300;

/// The template's parameters, in the order its body names them.
fn parameters(message: &Dispatch, booking: Option<&str>) -> Result<Vec<String>, Failure> {
    let body = message.template_body.as_deref().unwrap_or_default();
    let names = placeholders(&message.template_key, body)
        .map_err(|_| Failure::permanent("template names a variable it may not"))?;
    names
        .iter()
        .map(|name| {
            let value = match name.as_str() {
                "clinic_name" => Some(message.clinic_name.clone()),
                "booking_link" => booking.map(str::to_owned),
                "appointment_time" => message
                    .appointment_starts_at
                    .map(|at| when_text(at.to_offset(clinic_offset(&message.timezone)))),
                "doctor_name" if message.doctor_name.is_some() => message.doctor_name.clone(),
                other => message
                    .variables
                    .get(other)
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            };
            value
                .filter(|text| !text.trim().is_empty())
                .ok_or_else(|| Failure::permanent("a template variable has no value"))
        })
        .collect()
}

impl Notifier {
    /// Sends due `WhatsApp` messages, or skips them when the channel is off.
    pub(crate) async fn drain_whatsapp(
        &self,
        db: &Db,
        now: OffsetDateTime,
        report: &mut MessageReport,
    ) -> Result<(), DbError> {
        let budget = i32::try_from(self.whatsapp.daily_budget)
            .ok()
            .filter(|budget| *budget > 0)
            .unwrap_or(DEFAULT_WHATSAPP_DAILY_BUDGET);
        let claimed = dal::claim(
            db.pool(),
            "whatsapp",
            "meta",
            budget,
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
            match &self.whatsapp.sender {
                None => {
                    let reason = SkipReason::ChannelDisabled.as_str();
                    self.skip(db, &message, reason, report).await?;
                }
                Some(meta) => self.handle_whatsapp(db, meta, message, now, report).await?,
            }
        }
        Ok(())
    }

    async fn handle_whatsapp(
        &self,
        db: &Db,
        meta: &Meta,
        claimed: ClaimedMessage,
        now: OffsetDateTime,
        report: &mut MessageReport,
    ) -> Result<(), DbError> {
        let Some(message) = dal::dispatch(db.pool(), claimed.org_id, claimed.id).await? else {
            return Ok(());
        };
        let Ok(purpose) = Purpose::parse(&message.purpose) else {
            return self.skip(db, &claimed, "unsupported", report).await;
        };
        // Free text never goes on WhatsApp (the table refuses it too).
        let blocked = if message.body.is_some() {
            Some(SkipReason::Unsupported)
        } else if message.whatsapp_opted_in {
            template_block(&message)
        } else {
            Some(SkipReason::NoOptIn)
        };
        let kind = MessageKind::parse(&message.kind);
        match decide(&due_check(&message, purpose, kind, blocked), now) {
            Verdict::Skip(reason) => self.skip(db, &claimed, reason.as_str(), report).await,
            Verdict::Wait(at) => {
                dal::reschedule(db.pool(), claimed.org_id, claimed.id, at).await?;
                report.rescheduled += 1;
                Ok(())
            }
            Verdict::Send => {
                self.send_whatsapp(db, meta, &claimed, &message, now, report)
                    .await
            }
        }
    }

    async fn send_whatsapp(
        &self,
        db: &Db,
        meta: &Meta,
        claimed: &ClaimedMessage,
        message: &Dispatch,
        now: OffsetDateTime,
        report: &mut MessageReport,
    ) -> Result<(), DbError> {
        let booking = message
            .portal_host
            .as_deref()
            .map(|host| self.links.book(host));
        let (Some(to), Some(name), Some(language)) = (
            message.address.as_deref(),
            message.template_ref.as_deref(),
            message.template_language.as_deref(),
        ) else {
            return self.skip(db, claimed, "template_unavailable", report).await;
        };
        let outcome = match parameters(message, booking.as_deref()) {
            Err(failure) => Err(failure),
            Ok(parameters) => {
                let send = TemplateSend {
                    to,
                    name,
                    language,
                    parameters,
                };
                match meta.send(&send).await {
                    Ok(wamid) => {
                        let cost = message
                            .template_category
                            .as_deref()
                            .and_then(|text| TemplateCategory::parse(text).ok())
                            .map(|category| self.whatsapp.costs.of(category));
                        Ok(("meta", Some(wamid), cost))
                    }
                    Err(failure) => match failure.outcome {
                        MetaOutcome::Skip(reason) => {
                            return self.skip(db, claimed, reason.as_str(), report).await;
                        }
                        MetaOutcome::Retry => Err(Failure::retryable(failure.reason)),
                        MetaOutcome::Fail => Err(Failure::permanent(failure.reason)),
                    },
                }
            }
        };
        // The same settling as email: sent with its cost, retried with backoff, or abandoned.
        self.settle(db, claimed, &message.kind, outcome, now, report)
            .await
    }
}
