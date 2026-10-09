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

/// Marks the patient's queued messages that need `purpose` skipped (reason
/// `consent_withdrawn`), in the withdrawal's transaction, and returns how many. A message already
/// claimed by the worker is stopped by the send-time check ([`may_send`] in
/// `app.message_dispatch`).
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn cancel_queued(
    tx: &mut ScopedTx,
    patient_id: PatientId,
    purpose: Purpose,
) -> Result<u64, AppError> {
    Ok(aarogyam_dal::messages::skip_queued(
        tx.conn(),
        patient_id.uuid(),
        purpose.as_str(),
        aarogyam_domain::messaging::SkipReason::ConsentWithdrawn.as_str(),
    )
    .await?)
}
