//! Automatic patient messages for the visit flow (docs/plans/v9/be-msg.md): a welcome when a
//! walk-in registers, the visit summary link and its PIN when a visit closes, and the booking
//! link for a follow-up planned at close.
//!
//! Each one is written to the messages queue in the transaction of the business event, so it
//! commits or rolls back with it; the worker (`aarogyam-notify`) sends it later and checks
//! consent, opt-outs, quiet hours and the channel again. Variables carry links and a date only;
//! the patient's name, diagnoses, teeth and drugs never go into a message. A message the patient
//! can't receive is recorded as skipped with its reason (`messages.skip_reason`), not dropped.

use aarogyam_dal::auto_messages as dal;
use aarogyam_dal::messages::{self, NewMessage};
use aarogyam_dal::staff;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::contact::PatientMessage;
use aarogyam_domain::ids::MessageId;
use aarogyam_domain::messaging::{
    AutoMessage, AutoMessages, Channel, FOLLOW_UP_LEAD_DAYS, SkipReason,
};
use aarogyam_domain::outbox::MessageKind;
use sakalya_db::ScopedTx;
use serde_json::{Value, json};
use time::{Date, Duration, OffsetDateTime, Time};
use uuid::Uuid;

use crate::clock::clinic_offset;
use crate::error::AppError;
use crate::visit_share;

/// The hour of the clinic day a follow-up message goes out.
const FOLLOW_UP_HOUR: u8 = 9;

async fn enabled(tx: &mut ScopedTx, message: AutoMessage) -> Result<bool, AppError> {
    let stored = dal::switches(tx.conn()).await?;
    Ok(AutoMessages::from_value(&stored).is_on(message))
}

/// `12 November 2026`, as the other patient messages write a date.
fn day_text(day: Date) -> String {
    format!("{} {} {}", day.day(), day.month(), day.year())
}

/// What one message to queue is.
struct Auto<'a> {
    kind: MessageKind,
    patient_id: Uuid,
    variables: Value,
    secret: Option<&'a str>,
    dedupe_key: String,
    scheduled_for: Option<OffsetDateTime>,
}

fn purpose_of(kind: MessageKind) -> Result<&'static str, AppError> {
    PatientMessage::of(kind)
        .map(|message| message.purpose().as_str())
        .ok_or(AppError::Internal("not a patient message"))
}

/// Why the patient can't be sent this on the channel now, in the order the worker decides.
fn blocked(reach: dal::Reach) -> Option<SkipReason> {
    if !reach.may_contact {
        Some(SkipReason::NoConsent)
    } else if reach.opted_out {
        Some(SkipReason::OptedOut)
    } else if !reach.has_address {
        Some(SkipReason::NoAddress)
    } else {
        None
    }
}

/// `WhatsApp` when the patient opted in, hasn't opted out of it, and the clinic has an approved
/// template for every key; otherwise email (the existing behaviour of system messages).
async fn channel_for(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    kinds: &[MessageKind],
) -> Result<Channel, AppError> {
    for kind in kinds {
        let purpose = purpose_of(*kind)?;
        let ready = dal::whatsapp_ready(tx.conn(), patient_id, kind.as_str(), purpose).await?;
        if !ready {
            return Ok(Channel::Email);
        }
    }
    Ok(Channel::Whatsapp)
}

/// Queues the message, or records why the patient gets none. True when a message was queued.
async fn queue(tx: &mut ScopedTx, channel: Channel, auto: Auto<'_>) -> Result<bool, AppError> {
    let purpose = purpose_of(auto.kind)?;
    let reach = dal::reach(tx.conn(), auto.patient_id, channel.as_str(), purpose)
        .await?
        .ok_or(AppError::NotFound("patient"))?;
    let id = MessageId::new_v7().uuid();
    if let Some(reason) = blocked(reach) {
        dal::record_skipped(
            tx.conn(),
            &dal::SkippedMessage {
                id,
                patient_id: auto.patient_id,
                channel: channel.as_str(),
                kind: auto.kind.as_str(),
                purpose,
                reason: reason.as_str(),
                dedupe_key: &auto.dedupe_key,
            },
        )
        .await?;
        return Ok(false);
    }
    Ok(messages::enqueue(
        tx.conn(),
        &NewMessage {
            id,
            patient_id: auto.patient_id,
            channel: channel.as_str(),
            kind: auto.kind.as_str(),
            purpose,
            template_key: auto.kind.as_str(),
            variables: &auto.variables,
            body: None,
            secret: auto.secret,
            appointment_id: None,
            dedupe_key: Some(&auto.dedupe_key),
            scheduled_for: auto.scheduled_for,
        },
    )
    .await?)
}

/// Queues the welcome for a patient a walk-in just registered: the thank-you with the app and
/// website links. Nothing when the clinic switched it off or has no verified portal address.
///
/// # Errors
/// [`AppError::Db`] on database failures; [`AppError::NotFound`] for an unknown patient.
pub(crate) async fn welcome(tx: &mut ScopedTx, patient_id: Uuid) -> Result<(), AppError> {
    if !enabled(tx, AutoMessage::Welcome).await? || staff::portal_host(tx.conn()).await?.is_none() {
        return Ok(());
    }
    let mut variables = serde_json::Map::new();
    if let Some(domain) = dal::website_domain(tx.conn()).await? {
        variables.insert(
            "website_link".to_owned(),
            json!(format!("https://{domain}")),
        );
    }
    let channel = channel_for(tx, patient_id, &[MessageKind::Welcome]).await?;
    queue(
        tx,
        channel,
        Auto {
            kind: MessageKind::Welcome,
            patient_id,
            variables: Value::Object(variables),
            secret: None,
            dedupe_key: format!("auto:welcome:{patient_id}"),
            scheduled_for: None,
        },
    )
    .await?;
    Ok(())
}

/// What closing a visit needs to queue its messages.
pub(crate) struct ClosedVisit {
    pub(crate) visit_id: Uuid,
    pub(crate) patient_id: Uuid,
    /// The follow-up planned at close.
    pub(crate) follow_up_on: Option<Date>,
}

/// Queues what closing a visit sends. The summary goes right away: a new link to the visit (made
/// here, unless the visit already has a live one, whose token can't be recovered) and then its
/// PIN in a message of its own. The follow-up booking message waits until
/// [`FOLLOW_UP_LEAD_DAYS`] days before the follow-up (now, if that is closer), and only when the
/// clinic switched it on.
///
/// Call it once, in the transaction that closes the visit; the dedupe keys also make a repeat
/// harmless.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn visit_closed(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit: &ClosedVisit,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let Some(_host) = staff::portal_host(tx.conn()).await? else {
        return Ok(());
    };
    let patient_id = visit.patient_id;
    if enabled(tx, AutoMessage::VisitSummary).await?
        && !dal::has_live_visit_link(tx.conn(), visit.visit_id).await?
    {
        let channel = channel_for(
            tx,
            patient_id,
            &[MessageKind::VisitSummary, MessageKind::VisitSummaryPin],
        )
        .await?;
        let purpose = purpose_of(MessageKind::VisitSummary)?;
        let reach = dal::reach(tx.conn(), patient_id, channel.as_str(), purpose)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let summary_key = format!("auto:visit_summary:{}", visit.visit_id);
        if let Some(reason) = blocked(reach) {
            // No link is made for someone who can't be sent it.
            dal::record_skipped(
                tx.conn(),
                &dal::SkippedMessage {
                    id: MessageId::new_v7().uuid(),
                    patient_id,
                    channel: channel.as_str(),
                    kind: MessageKind::VisitSummary.as_str(),
                    purpose,
                    reason: reason.as_str(),
                    dedupe_key: &summary_key,
                },
            )
            .await?;
        } else {
            let link =
                visit_share::create_in(tx, actor, request_id, visit.visit_id, patient_id, now)
                    .await?;
            queue(
                tx,
                channel,
                Auto {
                    kind: MessageKind::VisitSummary,
                    patient_id,
                    variables: json!({}),
                    secret: Some(&link.token),
                    dedupe_key: summary_key,
                    scheduled_for: None,
                },
            )
            .await?;
            queue(
                tx,
                channel,
                Auto {
                    kind: MessageKind::VisitSummaryPin,
                    patient_id,
                    variables: json!({}),
                    secret: Some(&link.pin),
                    dedupe_key: format!("auto:visit_pin:{}", visit.visit_id),
                    // A moment after the link, so the two arrive in that order.
                    scheduled_for: Some(now + Duration::seconds(30)),
                },
            )
            .await?;
        }
    }
    if let Some(due) = visit.follow_up_on
        && enabled(tx, AutoMessage::FollowUpBooking).await?
    {
        let channel = channel_for(tx, patient_id, &[MessageKind::FollowUpBooking]).await?;
        let at = due - Duration::days(FOLLOW_UP_LEAD_DAYS);
        let goes_at = at
            .with_time(Time::from_hms(FOLLOW_UP_HOUR, 0, 0).unwrap_or(Time::MIDNIGHT))
            .assume_offset(clinic_offset(&actor.timezone));
        queue(
            tx,
            channel,
            Auto {
                kind: MessageKind::FollowUpBooking,
                patient_id,
                variables: json!({ "due_on": day_text(due) }),
                secret: None,
                dedupe_key: format!("auto:follow_up:{}", visit.visit_id),
                scheduled_for: Some(goes_at.max(now)),
            },
        )
        .await?;
    }
    Ok(())
}

/// The patient booked an appointment: the follow-up booking message still queued is no longer
/// needed. Call it in the booking's transaction.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn follow_up_booked(tx: &mut ScopedTx, patient_id: Uuid) -> Result<(), AppError> {
    dal::cancel_follow_ups_of_patient(tx.conn(), patient_id).await?;
    Ok(())
}

/// A recall was marked done or dismissed: its follow-up booking message, if not yet sent, is
/// skipped. Call it in the transaction that closes the recall.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn follow_up_closed(tx: &mut ScopedTx, recall_id: Uuid) -> Result<(), AppError> {
    dal::cancel_follow_up_of_recall(tx.conn(), recall_id).await?;
    Ok(())
}
