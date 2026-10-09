//! Messages to patients (docs/decisions.md, "Patient messaging core"): queuing them with the
//! change that causes them, staff sending to up to 50 patients, a patient's message list, contact
//! preferences and the unsubscribe link. Messages hold the patient's id, never an address; the
//! worker (`aarogyam-notify`) checks consent, opt-outs and quiet hours when each is due.

use aarogyam_dal::message_worker;
use aarogyam_dal::messages::{
    self as dal, Batch, MessageRow, NewMessage, PreferenceRow, SetPreference,
};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::contact::PatientMessage;
use aarogyam_domain::ids::{MessageId, PatientId};
use aarogyam_domain::messaging::{Category, Channel, MAX_RECIPIENTS, PreferenceSource, Template};
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::tokens::hash_token;

/// An email to a patient, queued in the transaction of the change that causes it. The payload
/// carries ids and non-patient values only: never the patient's name, medicines or diagnosis.
/// The address is read when it is sent.
#[derive(Debug, Clone)]
pub struct PatientEmail<'a> {
    /// What it is about; picks the template and the consent purpose.
    pub kind: MessageKind,
    /// The patient.
    pub patient_id: PatientId,
    /// Ids and the non-patient values the template needs.
    pub payload: Value,
    /// A one-time link secret it carries, kept only until it is processed.
    pub secret: Option<&'a str>,
    /// The appointment it is about, if any.
    pub appointment_id: Option<Uuid>,
}

/// Queues an email to a patient in the caller's clinic transaction.
///
/// # Errors
/// [`AppError::Internal`] for a kind that isn't a patient message; [`AppError::Db`] on database
/// failures.
pub async fn enqueue_patient_email(
    tx: &mut ScopedTx,
    email: &PatientEmail<'_>,
) -> Result<MessageId, AppError> {
    let purpose = PatientMessage::of(email.kind)
        .ok_or(AppError::Internal("not a patient message"))?
        .purpose();
    let id = MessageId::new_v7();
    dal::enqueue(
        tx.conn(),
        &NewMessage {
            id: id.uuid(),
            patient_id: email.patient_id.uuid(),
            channel: Channel::Email.as_str(),
            kind: email.kind.as_str(),
            purpose: purpose.as_str(),
            template_key: email.kind.as_str(),
            variables: &email.payload,
            body: None,
            secret: email.secret,
            appointment_id: email.appointment_id,
            dedupe_key: None,
        },
    )
    .await?;
    Ok(id)
}

/// A message staff send to patients.
#[derive(Debug, Clone)]
pub struct Send {
    /// 1 to 50 patients; repeats count once.
    pub patient_ids: Vec<PatientId>,
    /// The channel: email for now.
    pub channel: Channel,
    /// What to send.
    pub template: Template,
    /// The template's variables, checked against its allow-list.
    pub variables: Vec<(String, String)>,
    /// Free text, for templates that take it (email only).
    pub body: Option<String>,
    /// Sending the same batch again queues nothing twice; a new one when absent.
    pub batch_id: Option<Uuid>,
}

/// What sending did.
#[derive(Debug, Clone, Copy)]
pub struct Sent {
    /// The batch, to send again safely.
    pub batch_id: Uuid,
    /// Patients asked for, without repeats.
    pub requested: usize,
    /// Copies queued now.
    pub queued: i64,
    /// Copies an earlier try of this batch had queued.
    pub already_queued: i64,
}

/// Queues a message to each patient, all or none. Needs `messages.send`; the patients must be in
/// the clinic and in reach of the caller's `patients.read`.
///
/// # Errors
/// [`AppError::Invalid`] for a bad template, channel, text or patient count;
/// [`AppError::NotFound`] when a patient isn't in this clinic or in reach.
pub async fn send(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: Send,
) -> Result<Sent, AppError> {
    actor.require(Permission::MessagesSend)?;
    let mut patients: Vec<Uuid> = input.patient_ids.iter().map(|id| id.uuid()).collect();
    patients.sort_unstable();
    patients.dedup();
    if patients.is_empty() || patients.len() > MAX_RECIPIENTS {
        return Err(AppError::invalid("patient_ids", "give 1 to 50 patients"));
    }
    input
        .template
        .check(input.channel, input.body.as_deref(), &input.variables)
        .map_err(|error| AppError::invalid("template_key", error))?;
    let variables: Map<String, Value> = input
        .variables
        .into_iter()
        .map(|(name, value)| (name, Value::String(value.trim().to_owned())))
        .collect();
    let variables = Value::Object(variables);
    let batch_id = input.batch_id.unwrap_or_else(Uuid::now_v7);
    let body = input.body.as_deref().map(str::trim);
    let queued = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(
                dal::enqueue_batch(
                    tx.conn(),
                    &Batch {
                        patient_ids: &patients,
                        member: actor.reach(Permission::PatientsRead).member(),
                        channel: input.channel.as_str(),
                        purpose: input.template.purpose().as_str(),
                        template_key: input.template.as_str(),
                        variables: &variables,
                        body,
                        batch_id,
                    },
                )
                .await?,
            )
        })
        .await?;
    let requested = patients.len();
    if usize::try_from(queued.found).unwrap_or(0) != requested {
        return Err(AppError::NotFound("patient"));
    }
    Ok(Sent {
        batch_id,
        requested,
        queued: queued.queued,
        already_queued: queued.found - queued.queued,
    })
}

/// Most messages a patient's list returns.
pub const MAX_LISTED: i64 = 100;

/// The patient's newest messages, metadata only (no text, address or secret). Needs
/// `patients.read`.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or in reach.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<MessageRow>, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::list_for_patient(
            tx.conn(),
            patient_id.uuid(),
            actor.reach(Permission::PatientsRead).member(),
            MAX_LISTED,
        )
        .await?
        .ok_or(AppError::NotFound("patient"))
    })
    .await
}

/// A contact preference staff record on the patient's word.
#[derive(Debug, Clone, Copy)]
pub struct Preference {
    /// The channel.
    pub channel: Channel,
    /// Which messages it covers.
    pub category: Category,
    /// Opt out (true) or back in (false).
    pub opted_out: bool,
    /// For `WhatsApp`: whether the patient opted in; unchanged when absent.
    pub whatsapp_opt_in: Option<bool>,
}

/// Records a contact preference and returns all of the patient's. Opting out skips their queued
/// messages it covers. Needs `patients.write`.
///
/// # Errors
/// [`AppError::Invalid`] for a `WhatsApp` opt-in on another channel; [`AppError::NotFound`]
/// when the patient isn't in this clinic or in reach.
pub async fn set_preference(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    preference: Preference,
) -> Result<Vec<PreferenceRow>, AppError> {
    actor.require(Permission::PatientsWrite)?;
    if preference.whatsapp_opt_in.is_some() && preference.channel != Channel::Whatsapp {
        return Err(AppError::invalid(
            "whatsapp_opt_in",
            "only for the whatsapp channel",
        ));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::set_preference(
            tx.conn(),
            actor.reach(Permission::PatientsWrite).member(),
            &SetPreference {
                patient_id: patient_id.uuid(),
                channel: preference.channel.as_str(),
                category: preference.category.as_str(),
                opted_out: preference.opted_out,
                whatsapp_opt_in: preference.whatsapp_opt_in,
                source: PreferenceSource::Staff.as_str(),
            },
        )
        .await?
        .ok_or(AppError::NotFound("patient"))
    })
    .await
}

/// Applies an unsubscribe link's token: the patient opts out of email for that message's
/// purpose. False when the token names nothing. Reveals nothing about the patient.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn unsubscribe(db: &Db, token: &str) -> Result<bool, AppError> {
    let token = token.trim();
    if token.is_empty() || token.len() > 100 {
        return Ok(false);
    }
    Ok(message_worker::unsubscribe(db.pool(), &hash_token(token)).await?)
}

/// What a provider reported about a message, from its webhook.
pub use aarogyam_dal::message_worker::ProviderEvent;

/// Records a provider's report on a message (found by the provider's message id): each event
/// once, the latest by time kept on the message, and a bounce or complaint opting the patient out
/// of the channel. Returns `recorded`, `repeat` or `unknown`.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn provider_event(db: &Db, event: &ProviderEvent<'_>) -> Result<String, AppError> {
    Ok(message_worker::provider_event(db.pool(), event).await?)
}
