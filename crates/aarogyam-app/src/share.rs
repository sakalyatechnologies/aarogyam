//! Patient links to a prescription, opened with the PIN printed on the paper, and the QR code's
//! verification page. The public parts run in a clinic transaction with no user: the clinic
//! comes from the host name, the link from its token.

use aarogyam_dal::access;
use aarogyam_dal::prescriptions as dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{ClinicId, PrescriptionId, ShareLinkId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::prescription::RxStatus;
use aarogyam_domain::share::{LINK_LIFETIME, LinkState, MAX_PIN_ATTEMPTS, Pin};
use aws_lc_rs::rand;
use sakalya_db::{Db, ScopedTx};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::prescriptions::{RxView, load};
use crate::scope::{PATIENT, public_scope, staff_scope};
use crate::tokens::{hash_token, new_token};

/// A new link: the token for the URL and the PIN for the paper. Shown once; only hashes are
/// kept.
#[derive(Debug, Clone)]
pub struct NewLink {
    /// The link.
    pub id: ShareLinkId,
    /// 256-bit token for the URL.
    pub token: String,
    /// Six-digit PIN to print.
    pub pin: String,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

pub(crate) fn pin_hash(token: &str, pin: &str) -> String {
    hash_token(&format!("{}:{pin}", token.trim()))
}

/// A uniformly random six-digit PIN.
pub(crate) fn new_pin() -> Result<String, AppError> {
    loop {
        let mut bytes = [0_u8; 4];
        rand::fill(&mut bytes).map_err(|_| AppError::Internal("random number generator failed"))?;
        let value = u32::from_le_bytes(bytes);
        // Rejecting the top sliver keeps every PIN equally likely.
        if value < 4_294_000_000 {
            return Ok(format!("{:06}", value % 1_000_000));
        }
    }
}

/// Makes a link for an issued prescription, valid for seven days.
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue`; [`AppError::NotFound`];
/// [`AppError::Conflict`] unless issued.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    prescription_id: PrescriptionId,
    now: OffsetDateTime,
) -> Result<NewLink, AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let (status, patient_id) = dal::lock(
            tx.conn(),
            prescription_id.uuid(),
            actor.reach(Permission::PrescriptionsIssue).member(),
        )
        .await?
        .ok_or(AppError::NotFound("prescription"))?;
        if status != RxStatus::Issued.as_str() {
            return Err(AppError::Conflict(
                "only an issued prescription can be shared",
            ));
        }
        create_in(tx, actor, request_id, prescription_id, patient_id, now).await
    })
    .await
}

/// Makes the link inside the caller's transaction, for an issued prescription of `patient_id`.
pub(crate) async fn create_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    prescription_id: PrescriptionId,
    patient_id: Uuid,
    now: OffsetDateTime,
) -> Result<NewLink, AppError> {
    let (token, token_hash) = new_token()?;
    let pin = new_pin()?;
    let id = ShareLinkId::new_v7();
    let expires_at = now + LINK_LIFETIME;
    dal::insert_share_link(
        tx.conn(),
        &dal::NewShareLink {
            id: id.uuid(),
            token_hash: &token_hash,
            pin_hash: &pin_hash(&token, &pin),
            prescription_id: prescription_id.uuid(),
            patient_id,
            expires_at,
        },
    )
    .await?;
    let request_text = request_id.map(|id| id.to_string());
    access::record(
        tx.conn(),
        &access::DocumentAccess {
            actor_user_id: Some(actor.user_id.uuid()),
            actor_kind: crate::scope::actor_kind(actor).as_str(),
            patient_id,
            share_link_id: Some(id.uuid()),
            resource: "prescription",
            resource_id: prescription_id.uuid(),
            action: "share",
            purpose: actor.access_purpose(),
            request_id: request_text.as_deref(),
        },
    )
    .await?;
    Ok(NewLink {
        id,
        token,
        pin,
        expires_at,
    })
}

/// What anyone holding the link may learn before the PIN: that a document exists and whose
/// clinic it is from. Nothing about the patient.
#[derive(Debug, Clone)]
pub struct LinkPreview {
    /// The clinic's name.
    pub clinic_name: String,
    /// `prescription` or `records`.
    pub resource: String,
    /// What a link to records shows (`chart`, `xrays`, `bills`); none for other links.
    pub record_types: Option<Vec<String>>,
    /// Whether it can be opened.
    pub state: LinkState,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// Looks up a link by its token.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token.
pub async fn preview(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    now: OffsetDateTime,
) -> Result<LinkPreview, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let link = dal::share_link(tx.conn(), &hash_token(token))
            .await?
            .ok_or(AppError::NotFound("link"))?;
        let (clinic_name, _) = dal::clinic_name(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        Ok(LinkPreview {
            clinic_name,
            resource: link.resource,
            record_types: link.record_types,
            state: LinkState::of(
                now,
                link.expires_at,
                link.revoked_at.is_some(),
                link.locked_at.is_some(),
            ),
            expires_at: link.expires_at,
        })
    })
    .await
}

/// What opening a link did.
#[derive(Debug, Clone)]
pub enum OpenOutcome {
    /// The PIN was right: the prescription.
    Opened(Box<RxView>),
    /// The PIN was wrong; this many tries are left.
    WrongPin(i32),
    /// Too many wrong PINs; the clinic must send a new link.
    Locked,
    /// Past its expiry, or revoked.
    Expired,
}

/// Opens a link with the PIN. A wrong PIN counts; the fifth locks the link for good. A right
/// one returns the prescription and writes the access record (the patient, through this link).
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token.
pub async fn open(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    pin: &str,
    now: OffsetDateTime,
) -> Result<OpenOutcome, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let link = dal::share_link(tx.conn(), &hash_token(token))
            .await?
            .ok_or(AppError::NotFound("link"))?;
        match LinkState::of(
            now,
            link.expires_at,
            link.revoked_at.is_some(),
            link.locked_at.is_some(),
        ) {
            LinkState::Locked => return Ok(OpenOutcome::Locked),
            LinkState::Expired => return Ok(OpenOutcome::Expired),
            LinkState::Usable => {}
        }
        let right =
            Pin::parse(pin).is_some_and(|pin| pin_hash(token, pin.as_str()) == link.pin_hash);
        if !right {
            let attempts = link.failed_attempts + 1;
            let locked = attempts >= MAX_PIN_ATTEMPTS;
            dal::share_link_failed(tx.conn(), link.id, attempts, locked.then_some(now)).await?;
            return Ok(if locked {
                OpenOutcome::Locked
            } else {
                OpenOutcome::WrongPin(MAX_PIN_ATTEMPTS - attempts)
            });
        }
        let prescription_id = link
            .prescription_id
            .ok_or(AppError::NotFound("prescription"))?;
        dal::share_link_opened(tx.conn(), link.id, now).await?;
        let request_text = request_id.map(|id| id.to_string());
        access::record(
            tx.conn(),
            &access::DocumentAccess {
                actor_user_id: None,
                actor_kind: PATIENT.as_str(),
                patient_id: link.patient_id,
                share_link_id: Some(link.id),
                resource: "prescription",
                resource_id: prescription_id,
                action: "view",
                purpose: "patient_self",
                request_id: request_text.as_deref(),
            },
        )
        .await?;
        Ok(OpenOutcome::Opened(Box::new(
            load(tx, prescription_id, None).await?,
        )))
    })
    .await
}

/// What the QR code's page shows: never anything about the patient.
#[derive(Debug, Clone)]
pub struct Verification {
    /// Issued (valid) or cancelled.
    pub status: RxStatus,
    /// The prescription number.
    pub number: Option<String>,
    /// The clinic day it was issued.
    pub issued_on: Option<Date>,
    /// The clinic's name.
    pub clinic_name: String,
}

/// Checks a prescription by its QR token.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token.
pub async fn verify(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
) -> Result<Verification, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let row = dal::verify(tx.conn(), token.trim())
            .await?
            .ok_or(AppError::NotFound("prescription"))?;
        let (clinic_name, timezone) = dal::clinic_name(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        Ok(Verification {
            status: RxStatus::parse(&row.status).unwrap_or(RxStatus::Cancelled),
            number: row.number,
            issued_on: row.issued_at.map(|at| clinic_today(&timezone, at)),
            clinic_name,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_are_six_digits_and_bound_to_the_token() {
        let pin = new_pin().unwrap();
        assert_eq!(pin.len(), 6);
        assert!(pin.bytes().all(|b| b.is_ascii_digit()));
        assert_ne!(pin_hash("a", "123456"), pin_hash("b", "123456"));
        assert_eq!(pin_hash(" a ", "123456"), pin_hash("a", "123456"));
    }
}
