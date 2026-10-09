//! Queuing an email to staff (or another non-patient) with the change that causes it. The
//! caller passes its clinic transaction, so the message commits or rolls back with the change;
//! the notification worker (`aarogyam-notify`) delivers it later. Messages to patients go to
//! their own queue instead ([`crate::messaging`]), so no patient address sits in the outbox.

use aarogyam_dal::outbox::{self as dal, NewMessage};
use aarogyam_domain::ids::MessageId;
use aarogyam_domain::outbox::{Channel, MessageKind};
use aarogyam_domain::patient::Email;
use sakalya_db::ScopedTx;
use serde_json::Value;

use crate::error::AppError;

/// An email to a member of staff (never a patient: patient messages are
/// [`crate::messaging::PatientEmail`], addressed when sent).
#[derive(Debug, Clone)]
pub struct StaffEmail<'a> {
    /// What it is about; picks the template.
    pub kind: MessageKind,
    /// Where it goes.
    pub to: &'a Email,
    /// Ids and the non-patient values the template needs.
    pub payload: Value,
    /// A one-time link secret it carries, kept only until it is sent or abandoned.
    pub secret: Option<&'a str>,
}

/// Queues an email in the caller's clinic transaction.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn enqueue_staff_email(
    tx: &mut ScopedTx,
    email: &StaffEmail<'_>,
) -> Result<MessageId, AppError> {
    let id = MessageId::new_v7();
    dal::enqueue(
        tx.conn(),
        &NewMessage {
            id: id.uuid(),
            event_key: email.kind.as_str(),
            channel: Channel::Email.as_str(),
            recipient: Some(email.to.as_str()),
            payload: &email.payload,
            secret: email.secret,
        },
    )
    .await?;
    Ok(id)
}
