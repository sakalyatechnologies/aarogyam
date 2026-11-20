//! Links to a visit summary: the clinic makes one for a visit, and the patient opens it on the
//! clinic's host with the PIN (the same token and PIN as prescription links, limited the same
//! way). The summary shows only what the patient should take away: why they came, the treatments
//! done, the plan (with estimates unless the clinic hides them), the medicines, care at home, the
//! follow-up date, the clinic's phone and where to book. Never notes, findings, images, other
//! staff or other visits. Making a link and opening it are written to the access record.

use aarogyam_dal::visit_messages as extras_dal;
use aarogyam_dal::visit_plan_responses as answers;
use aarogyam_dal::visit_summaries as dal;
use aarogyam_dal::{access, patients, prescriptions as links, visits};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::dental::Tooth;
use aarogyam_domain::ids::{ClinicId, EncounterId, ShareLinkId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::share::{LinkState, MAX_PIN_ATTEMPTS, Pin};
use aarogyam_domain::visit_message::{Aftercare, PlanChoice, aftercare};
use sakalya_db::{Db, ScopedTx};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::patient_message::{self as plan_source, PlanItem};
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
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let visit = visits::get_encounter(
            tx.conn(),
            visit_id.uuid(),
            false,
            actor.reach(Permission::ClinicalWrite).member(),
        )
        .await?
        .ok_or(AppError::NotFound("visit"))?;
        create_in(
            tx,
            actor,
            request_id,
            visit.id,
            visit.patient_id,
            options,
            now,
        )
        .await
    })
    .await
}

/// Makes the link inside the caller's transaction, for a visit the caller already checked (the
/// automatic summary message when a visit closes, `crate::auto_messages`).
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn create_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: Uuid,
    patient_id: Uuid,
    options: ShareOptions,
    now: OffsetDateTime,
) -> Result<NewVisitLink, AppError> {
    let (token, token_hash) = new_token()?;
    let pin = new_pin()?;
    let id = ShareLinkId::new_v7();
    let expires_at = now + options.lifetime;
    dal::insert(
        tx.conn(),
        &dal::NewVisitLink {
            id: id.uuid(),
            token_hash: &token_hash,
            pin_hash: &pin_hash(&token, &pin),
            patient_id,
            encounter_id: visit_id,
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
            patient_id,
            share_link_id: Some(id.uuid()),
            resource: "visit",
            resource_id: visit_id,
            action: "share",
            purpose: actor.access_purpose(),
            request_id: request_text.as_deref(),
        },
    )
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

/// A medicine prescribed in the visit.
#[derive(Debug, Clone)]
pub struct Medicine {
    /// Generic name.
    pub generic: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// How often, such as `1-0-1`.
    pub frequency: String,
    /// When to take it, such as `after_food`.
    pub timing: Option<String>,
    /// For how many days.
    pub days: Option<u16>,
}

/// Care at home after one of today's treatments.
#[derive(Debug, Clone, Copy)]
pub struct Care {
    /// The aftercare key, such as `extraction`.
    pub key: &'static str,
    /// What to do.
    pub care: &'static Aftercare,
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
    /// Why the patient came.
    pub chief_complaint: Option<String>,
    /// What is still to be done; estimates left out when the clinic hides them
    /// (`billing.patient_estimates`).
    pub plan: Vec<PlanItem>,
    /// The medicines of the visit's issued prescriptions.
    pub medicines: Vec<Medicine>,
    /// Care at home after today's treatments, most important first.
    pub aftercare: Vec<Care>,
    /// The clinic's phone (the visit branch's, else the default branch's).
    pub clinic_phone: Option<String>,
    /// The visit doctor's practitioner record, for booking.
    pub practitioner_id: Option<Uuid>,
    /// The mouth snapshot (section 1.12 of the visit story v2 design): the same allowlisted
    /// shape the doctor's Present mode shows.
    pub chart: Option<aarogyam_domain::mouth::MouthSnapshot>,
}

/// What the page shows beyond the visit row: treatments, plan, medicines, care, contact.
struct Extras {
    treatments: Vec<Treatment>,
    plan: Vec<PlanItem>,
    medicines: Vec<Medicine>,
    aftercare: Vec<Care>,
    clinic_phone: Option<String>,
    practitioner_id: Option<Uuid>,
}

async fn extras_in(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
    patient_id: Uuid,
) -> Result<Extras, AppError> {
    let done = plan_source::done_in(tx, encounter_id).await?;
    let mut plan = plan_source::plan_in(tx, encounter_id, patient_id).await?;
    let aftercare = plan_source::care_keys(&done, &plan)
        .into_iter()
        .filter_map(|key| aftercare(key).map(|care| Care { key, care }))
        .collect();
    let context = extras_dal::page_context(tx.conn(), encounter_id)
        .await?
        .ok_or(AppError::NotFound("visit"))?;
    if !context.patient_estimates {
        for item in &mut plan {
            item.estimate = None;
        }
    }
    let medicines = extras_dal::medicines(tx.conn(), encounter_id)
        .await?
        .into_iter()
        .map(|row| Medicine {
            generic: row.generic,
            strength: row.strength,
            frequency: row.frequency,
            timing: row.timing,
            days: row.duration_days.and_then(|d| u16::try_from(d).ok()),
        })
        .collect();
    Ok(Extras {
        treatments: done
            .into_iter()
            .map(|work| Treatment {
                name: work.name,
                tooth: work.tooth,
            })
            .collect(),
        plan,
        medicines,
        aftercare,
        clinic_phone: context.clinic_phone,
        practitioner_id: context.practitioner_id,
    })
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

/// Why a link to a visit did not unlock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    /// The PIN was wrong; this many tries are left.
    WrongPin(i32),
    /// Too many wrong PINs.
    Locked,
    /// Past its expiry, or revoked.
    Expired,
}

impl From<Refused> for OpenOutcome {
    fn from(refused: Refused) -> Self {
        match refused {
            Refused::WrongPin(left) => Self::WrongPin(left),
            Refused::Locked => Self::Locked,
            Refused::Expired => Self::Expired,
        }
    }
}

/// Finds the link to a visit and checks the PIN, for every call the patient's page makes: a
/// wrong PIN counts and the fifth locks the link (committed with the caller's transaction, so
/// the caller returns `Ok` with the refusal). Does not count an open.
async fn unlock(
    tx: &mut ScopedTx,
    token: &str,
    pin: &str,
    now: OffsetDateTime,
) -> Result<Result<links::ShareLinkRow, Refused>, AppError> {
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
        LinkState::Locked => return Ok(Err(Refused::Locked)),
        LinkState::Expired => return Ok(Err(Refused::Expired)),
        LinkState::Usable => {}
    }
    let right = Pin::parse(pin).is_some_and(|pin| pin_hash(token, pin.as_str()) == link.pin_hash);
    if !right {
        let attempts = link.failed_attempts + 1;
        let locked = attempts >= MAX_PIN_ATTEMPTS;
        links::share_link_failed(tx.conn(), link.id, attempts, locked.then_some(now)).await?;
        return Ok(Err(if locked {
            Refused::Locked
        } else {
            Refused::WrongPin(MAX_PIN_ATTEMPTS - attempts)
        }));
    }
    Ok(Ok(link))
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
        let link = match unlock(tx, token, pin, now).await? {
            Ok(link) => link,
            Err(refused) => return Ok(refused.into()),
        };
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
        let extras = extras_in(tx, visit.id, visit.patient_id).await?;
        let chart = crate::mouth::of_visit(tx, &visit, now).await?;
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
            treatments: extras.treatments,
            follow_up_on,
            booking_host,
            expires_at: link.expires_at,
            chief_complaint: visit.chief_complaint,
            plan: extras.plan,
            medicines: extras.medicines,
            aftercare: extras.aftercare,
            clinic_phone: extras.clinic_phone,
            practitioner_id: extras.practitioner_id,
            chart: Some(chart),
        })))
    })
    .await
}

/// The patient's answer to their plan, as saved.
#[derive(Debug, Clone)]
pub struct Answer {
    /// What they chose.
    pub choice: PlanChoice,
    /// When.
    pub responded_at: OffsetDateTime,
    /// Whether the choice is new for this link (the first answer, or a different one): the
    /// clinic was told again.
    pub changed: bool,
    /// The visit.
    pub encounter_id: EncounterId,
    /// The link.
    pub share_link_id: ShareLinkId,
}

/// Saves the patient's answer to their plan through a link to a visit, with the PIN checked as
/// for [`open`] (same counter and lock). One answer per link: the latest wins, and `shown` keeps
/// the plan items the page shows now. A new or different choice writes or reopens the visit's
/// `plan_response` notification. Not an open: the open count is unchanged, and no access row is
/// written (the table's change history is the record).
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token or a link that is not to a visit.
pub async fn answer(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    pin: &str,
    choice: PlanChoice,
    now: OffsetDateTime,
) -> Result<Result<Answer, Refused>, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let link = match unlock(tx, token, pin, now).await? {
            Ok(link) => link,
            Err(refused) => return Ok(Err(refused)),
        };
        let encounter_id = link.encounter_id.ok_or(AppError::NotFound("visit"))?;
        let shown: Vec<serde_json::Value> = plan_source::plan_in(tx, encounter_id, link.patient_id)
            .await?
            .into_iter()
            .map(|item| serde_json::json!({ "source": item.source.as_str(), "id": item.id }))
            .collect();
        let saved = answers::save(
            tx.conn(),
            &answers::NewAnswer {
                encounter_id,
                patient_id: link.patient_id,
                share_link_id: link.id,
                choice: choice.as_str(),
                shown: &serde_json::Value::Array(shown),
                responded_at: now,
            },
        )
        .await?;
        let changed = saved.previous.as_deref() != Some(choice.as_str());
        if changed {
            answers::notify(
                tx.conn(),
                encounter_id,
                &format!("/patients/{}", link.patient_id),
            )
            .await?;
        }
        Ok(Ok(Answer {
            choice,
            responded_at: saved.responded_at,
            changed,
            encounter_id: EncounterId::from_uuid(encounter_id),
            share_link_id: ShareLinkId::from_uuid(link.id),
        }))
    })
    .await
}
