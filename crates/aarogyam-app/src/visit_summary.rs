//! Links to a visit summary: the clinic makes one for a visit, and the patient opens it on the
//! clinic's host with the PIN (the same token and PIN as prescription links, limited the same
//! way). The summary shows only what the patient should take away: the treatments done, the
//! follow-up date and where to book. Never notes, findings, prices or other visits. Making a link
//! and opening it are written to the access record.

use aarogyam_dal::visit_summaries as dal;
use aarogyam_dal::{access, patients, prescriptions as links, treatment, visits};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::ProcedureStatus;
use aarogyam_domain::dental::Tooth;
use aarogyam_domain::ids::{ClinicId, EncounterId, ShareLinkId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::share::{LinkState, MAX_PIN_ATTEMPTS, Pin};
use sakalya_db::Db;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::scope::{PATIENT, public_scope, staff_scope};
use crate::share::{NewLink, ShareOptions, new_pin, pin_hash};
use crate::tokens::{hash_token, new_token};

/// A new link to a visit summary: the token for the URL and the PIN to tell the patient, shown
/// once.
#[derive(Debug, Clone)]
pub struct NewVisitLink {
    /// The link, token and PIN as for any share link.
    pub link: NewLink,
    /// How it was marked as handed over.
    pub channel: aarogyam_domain::share::ShareChannel,
}

/// Makes a link to a visit's summary. The visit may be open or closed. No message is queued:
/// the caller hands the link over (the thank-you message is a separate step).
///
/// # Errors
/// [`AppError::Denied`] without `clinical.write`; [`AppError::NotFound`] for a visit out of
/// reach; [`AppError::Invalid`] for a bad channel or lifetime.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    options: ShareOptions,
    now: OffsetDateTime,
) -> Result<NewVisitLink, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let (token, token_hash) = new_token()?;
    let pin = new_pin()?;
    let id = ShareLinkId::new_v7();
    let expires_at = now + options.lifetime;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let visit = visits::get_encounter(
            tx.conn(),
            visit_id.uuid(),
            false,
            actor.reach(Permission::ClinicalWrite).member(),
        )
        .await?
        .ok_or(AppError::NotFound("visit"))?;
        dal::insert(
            tx.conn(),
            &dal::NewVisitLink {
                id: id.uuid(),
                token_hash: &token_hash,
                pin_hash: &pin_hash(&token, &pin),
                patient_id: visit.patient_id,
                encounter_id: visit.id,
                channel: options.channel.as_str(),
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
                patient_id: visit.patient_id,
                share_link_id: Some(id.uuid()),
                resource: "visit",
                resource_id: visit.id,
                action: "share",
                purpose: actor.access_purpose(),
                request_id: request_text.as_deref(),
            },
        )
        .await?;
        Ok::<_, AppError>(())
    })
    .await?;
    Ok(NewVisitLink {
        link: NewLink {
            id,
            token,
            pin,
            expires_at,
        },
        channel: options.channel,
    })
}

/// A treatment done in the visit.
#[derive(Debug, Clone)]
pub struct Treatment {
    /// What was done, such as "Root canal treatment".
    pub name: String,
    /// The tooth, when it concerns one.
    pub tooth: Option<Tooth>,
}

/// What an opened visit link shows.
#[derive(Debug, Clone)]
pub struct Summary {
    /// The clinic's name.
    pub clinic_name: String,
    /// The patient's name.
    pub patient_name: String,
    /// The visit's readable number, such as `V-318`.
    pub visit_number: String,
    /// The clinic day of the visit.
    pub visited_on: Date,
    /// The doctor's name.
    pub doctor_name: Option<String>,
    /// The treatments done, in the order they were recorded.
    pub treatments: Vec<Treatment>,
    /// When the next follow-up falls due, if one is planned.
    pub follow_up_on: Option<Date>,
    /// The clinic's verified portal host, which serves the booking page at `/book`.
    pub booking_host: Option<String>,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
}

/// What opening a link to a visit summary did.
#[derive(Debug, Clone)]
pub enum OpenOutcome {
    /// The PIN was right.
    Opened(Box<Summary>),
    /// The PIN was wrong; this many tries are left.
    WrongPin(i32),
    /// Too many wrong PINs.
    Locked,
    /// Past its expiry, or revoked.
    Expired,
}

/// Opens a link to a visit summary with the PIN. A wrong PIN counts and the fifth locks the
/// link; a right one returns the summary and writes the access record.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token or a link that is not to a visit.
pub async fn open(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    pin: &str,
    now: OffsetDateTime,
) -> Result<OpenOutcome, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let link = links::share_link(tx.conn(), &hash_token(token))
            .await?
            .filter(|link| link.resource == "visit")
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
            links::share_link_failed(tx.conn(), link.id, attempts, locked.then_some(now)).await?;
            return Ok(if locked {
                OpenOutcome::Locked
            } else {
                OpenOutcome::WrongPin(MAX_PIN_ATTEMPTS - attempts)
            });
        }
        links::share_link_opened(tx.conn(), link.id, now).await?;
        let encounter_id = link.encounter_id.ok_or(AppError::NotFound("visit"))?;
        let visit = visits::get_encounter(tx.conn(), encounter_id, false, None)
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        let (clinic_name, timezone) = links::clinic_name(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let patient_name = patients::get(tx.conn(), link.patient_id, None)
            .await?
            .map(|patient| patient.full_name)
            .ok_or(AppError::NotFound("patient"))?;
        let doctor_name = links::doctor(tx.conn(), visit.clinician_id)
            .await?
            .map(|(name, _)| name);
        let treatments = treatment::procedures_of_encounter(tx.conn(), visit.id)
            .await?
            .into_iter()
            .filter(|row| row.status == ProcedureStatus::Done.as_str())
            .map(|row| Treatment {
                name: row.name,
                tooth: row.tooth.and_then(|n| Tooth::new(i64::from(n)).ok()),
            })
            .collect();
        let visited_on = clinic_today(&timezone, visit.started_at);
        let follow_up_on = dal::next_follow_up(tx.conn(), visit.patient_id, visited_on).await?;
        let booking_host = aarogyam_dal::staff::portal_host(tx.conn()).await?;
        let request_text = request_id.map(|id| id.to_string());
        access::record(
            tx.conn(),
            &access::DocumentAccess {
                actor_user_id: None,
                actor_kind: PATIENT.as_str(),
                patient_id: link.patient_id,
                share_link_id: Some(link.id),
                resource: "visit",
                resource_id: visit.id,
                action: "view",
                purpose: "patient_self",
                request_id: request_text.as_deref(),
            },
        )
        .await?;
        Ok(OpenOutcome::Opened(Box::new(Summary {
            clinic_name,
            patient_name,
            visit_number: visit.number,
            visited_on,
            doctor_name,
            treatments,
            follow_up_on,
            booking_host,
            expires_at: link.expires_at,
        })))
    })
    .await
}
