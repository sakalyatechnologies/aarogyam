//! Consent drives messaging: the check a sender makes before each patient message, and what a
//! withdrawal does to messages already queued (docs/decisions.md, "Notice and consent
//! records"). The matrix of which message needs which purpose is
//! [`aarogyam_domain::contact::PatientMessage::purpose`].

use aarogyam_dal::contact as dal;
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::contact::PatientMessage;
use aarogyam_domain::ids::{ClinicId, PatientId};
use sakalya_db::ScopedTx;

use crate::error::AppError;

/// Whether the clinic may send the patient this message now, by the patient's consents. Call
/// it when sending, not only when queuing, so a withdrawal stops a message already queued and
/// consenting again restores it. Runs in a clinic transaction for that clinic (a worker without
/// one can call [`aarogyam_dal::contact::may_contact`] on its own connection). This signature
/// is kept stable for the messaging work.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn may_send(
    tx: &mut ScopedTx,
    clinic_id: ClinicId,
    patient_id: PatientId,
    message: PatientMessage,
) -> Result<bool, AppError> {
    Ok(dal::may_contact(
        tx.conn(),
        clinic_id.uuid(),
        patient_id.uuid(),
        message.purpose().as_str(),
    )
    .await?)
}

/// Cancels the patient's queued messages that need `purpose`, after a withdrawal, and returns
/// how many. Nothing is queued per patient and purpose yet: the `messages` table
/// (docs/database.md) doesn't exist and today's outbox holds only care messages, so this
/// cancels nothing; the send-time [`may_send`] check is what stops a withdrawn purpose.
///
/// TODO(messaging): when `messages` lands, mark this patient's pending rows for `purpose`
/// skipped (reason `consent_withdrawn`) here, in the withdrawal's transaction.
pub(crate) const fn cancel_queued(_patient_id: PatientId, _purpose: Purpose) -> u64 {
    0
}
