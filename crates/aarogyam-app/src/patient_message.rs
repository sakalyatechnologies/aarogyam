//! The visit summary a doctor sends from their own `WhatsApp` (docs/plans/visit-story-design.md,
//! C2). The server builds the text and mints a visit link with its PIN; the phone opens
//! `WhatsApp` with it and the doctor presses Send. Nothing is queued or sent from here: this is
//! "prepared", not "sent", and the decision log records the exception to rule 10.
//!
//! It goes to the patient, or to a relative when the patient is a minor (a guardian or parent)
//! or an adult without a mobile who has a relative marked as primary contact. Consent and
//! `WhatsApp` opt-outs are checked as for any care message.

use aarogyam_dal::auto_messages as reach_dal;
use aarogyam_dal::visit_messages as dal;
use aarogyam_dal::visit_summaries::next_follow_up;
use aarogyam_dal::{patients, prescriptions as links, treatment, visits};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{EncounterStatus, ProcedureStatus};
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::dental::Tooth;
use aarogyam_domain::ids::{EncounterId, ShareLinkId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::share::ShareChannel;
use aarogyam_domain::visit_message::{
    self as message, MedicineLine, MessageInput, NextVisit, Recipient, Refusal, Work, WorkLine,
};
use sakalya_db::{Db, ScopedTx};
use sakalya_types::{Paise, PhoneE164};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::scope::staff_scope;
use crate::share::ShareOptions;
use crate::visit_summary;

/// Most visit links live at once for one visit: minting another revokes the oldest.
pub const LIVE_VISIT_LINKS: i64 = 3;

/// Where a planned item comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanSource {
    /// A planned procedure of the visit.
    Procedure,
    /// An item of an accepted treatment plan.
    PlanItem,
}

impl PlanSource {
    /// The value clients see.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Procedure => "procedure",
            Self::PlanItem => "plan_item",
        }
    }
}

/// Something still to be done for the patient.
#[derive(Debug, Clone)]
pub struct PlanItem {
    /// The procedure's or plan item's id.
    pub id: Uuid,
    /// Where it comes from.
    pub source: PlanSource,
    /// What is to be done.
    pub name: String,
    /// The code, when coded.
    pub code: Option<String>,
    /// The tooth, when it concerns one.
    pub tooth: Option<Tooth>,
    /// The fee or estimate, when known.
    pub estimate: Option<Paise>,
}

fn tooth_of(number: Option<i16>) -> Option<Tooth> {
    number.and_then(|n| Tooth::new(i64::from(n)).ok())
}

/// The visit's plan: its planned procedures, then the patient's accepted plan items that no
/// planned procedure of the visit already carries.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn plan_in(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
    patient_id: Uuid,
) -> Result<Vec<PlanItem>, AppError> {
    let procedures = dal::planned_procedures(tx.conn(), encounter_id).await?;
    let items = dal::accepted_plan_items(tx.conn(), patient_id, encounter_id).await?;
    let as_item = |source: PlanSource| {
        move |row: dal::PlannedRow| PlanItem {
            id: row.id,
            source,
            name: row.name,
            code: row.code,
            tooth: tooth_of(row.tooth),
            estimate: row.estimate_paise.map(Paise::new),
        }
    };
    Ok(procedures
        .into_iter()
        .map(as_item(PlanSource::Procedure))
        .chain(items.into_iter().map(as_item(PlanSource::PlanItem)))
        .collect())
}

/// A treatment done in the visit, with its code for the aftercare.
#[derive(Debug, Clone)]
pub(crate) struct DoneWork {
    pub name: String,
    pub code: Option<String>,
    pub tooth: Option<Tooth>,
}

/// The treatments done in the visit, in the order they were recorded.
pub(crate) async fn done_in(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<DoneWork>, AppError> {
    Ok(treatment::procedures_of_encounter(tx.conn(), encounter_id)
        .await?
        .into_iter()
        .filter(|row| row.status == ProcedureStatus::Done.as_str())
        .map(|row| DoneWork {
            name: row.name,
            code: row.code,
            tooth: tooth_of(row.tooth),
        })
        .collect())
}

/// The aftercare keys for the visit, most important first.
pub(crate) fn care_keys(done: &[DoneWork], plan: &[PlanItem]) -> Vec<&'static str> {
    let done: Vec<Work<'_>> = done
        .iter()
        .map(|w| Work {
            code: w.code.as_deref(),
            name: &w.name,
            tooth: w.tooth,
        })
        .collect();
    let planned: Vec<Work<'_>> = plan
        .iter()
        .map(|p| Work {
            code: p.code.as_deref(),
            name: &p.name,
            tooth: p.tooth,
        })
        .collect();
    message::aftercare_keys(&done, &planned)
}

/// Who the summary goes to and their number, after the consent and opt-out checks.
async fn recipient_in(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    own_phone: Option<&str>,
    minor: bool,
) -> Result<(Recipient, PhoneE164), AppError> {
    let relative = if minor || own_phone.is_none() {
        dal::relative_contact(tx.conn(), patient_id, minor).await?
    } else {
        None
    };
    let (recipient, recipient_id, phone) = match relative {
        Some(contact) if contact.phone_e164.is_some() || own_phone.is_none() => {
            (Recipient::Guardian, contact.patient_id, contact.phone_e164)
        }
        _ => (Recipient::Patient, patient_id, own_phone.map(str::to_owned)),
    };
    let phone = phone
        .as_deref()
        .and_then(|raw| PhoneE164::parse(raw).ok())
        .ok_or(Refusal::NoPhone)?;
    let care = Purpose::Care.as_str();
    let reach = reach_dal::reach(tx.conn(), recipient_id, "whatsapp", care)
        .await?
        .ok_or(AppError::NotFound("patient"))?;
    if !reach.may_contact {
        return Err(Refusal::NoConsent.into());
    }
    if minor && recipient_id != patient_id {
        let own = reach_dal::reach(tx.conn(), patient_id, "whatsapp", care)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        if !own.may_contact {
            return Err(Refusal::NoConsent.into());
        }
    }
    if reach.opted_out {
        return Err(Refusal::OptedOut.into());
    }
    Ok((recipient, phone))
}

/// The visit's issued medicines as message lines.
async fn medicine_lines(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<MedicineLine>, AppError> {
    Ok(dal::medicines(tx.conn(), encounter_id)
        .await?
        .into_iter()
        .map(|row| MedicineLine {
            generic: row.generic,
            strength: row.strength,
            frequency: row.frequency,
            days: row.duration_days.and_then(|d| u16::try_from(d).ok()),
        })
        .collect())
}

/// A prepared summary for the doctor's `WhatsApp`. Kept in memory only: never logged, queued or
/// stored.
#[derive(Debug, Clone)]
pub struct Prepared {
    /// The number to open `WhatsApp` with.
    pub phone: PhoneE164,
    /// The full message.
    pub text: String,
    /// The message without clinical words, for web hand-offs.
    pub short_text: String,
    /// The visit page's address.
    pub url: String,
    /// The link's PIN.
    pub pin: String,
    /// The new link.
    pub link_id: ShareLinkId,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
    /// When the automatic summary was sent (or queued), if it was.
    pub auto_sent_at: Option<OffsetDateTime>,
    /// Who it goes to.
    pub recipient: Recipient,
}

/// Prepares the visit's summary for the doctor's `WhatsApp`: picks the recipient, checks consent
/// and opt-outs, mints a visit link (7 days; at most [`LIVE_VISIT_LINKS`] live per visit, the
/// oldest revoked) and builds the text. `url` turns the clinic's portal host and the token into
/// the link; `request_host` is the host used when the clinic has no verified portal address.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read` and `patients.contact`;
/// [`AppError::NotFound`] for a visit out of reach or an erased patient;
/// [`AppError::MessageRefused`] when the visit is open, nobody has a mobile, consent doesn't
/// allow care messages, or the recipient opted out of them on `WhatsApp`.
pub async fn prepare(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    request_host: &str,
    url: &(dyn Fn(&str, &str) -> String + Sync),
    now: OffsetDateTime,
) -> Result<Prepared, AppError> {
    actor.require(Permission::ClinicalRead)?;
    actor.require(Permission::PatientsContact)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let visit = visits::get_encounter(
            tx.conn(),
            visit_id.uuid(),
            false,
            actor.reach(Permission::ClinicalRead).member(),
        )
        .await?
        .ok_or(AppError::NotFound("visit"))?;
        let patient = patients::get(
            tx.conn(),
            visit.patient_id,
            actor.reach(Permission::PatientsContact).member(),
        )
        .await?
        .ok_or(AppError::NotFound("patient"))?;
        if visit.status != EncounterStatus::Closed.as_str() {
            return Err(Refusal::VisitOpen.into());
        }
        let (clinic_name, timezone) = links::clinic_name(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let today = clinic_today(&timezone, now);
        let minor = message::is_minor(patient.date_of_birth, today);

        let (recipient, phone) =
            recipient_in(tx, patient.id, patient.phone_e164.as_deref(), minor).await?;

        // What it says.
        let doctor_name = links::doctor(tx.conn(), visit.clinician_id)
            .await?
            .map(|(name, _)| name);
        let done = done_in(tx, visit.id).await?;
        let plan = plan_in(tx, visit.id, patient.id).await?;
        let keys = care_keys(&done, &plan);
        let medicines = medicine_lines(tx, visit.id).await?;
        let visited_on = clinic_today(&timezone, visit.started_at);
        let next_visit = match dal::next_booked(tx.conn(), patient.id, now).await? {
            Some(at) => Some(NextVisit::Booked(clinic_today(&timezone, at))),
            None => next_follow_up(tx.conn(), patient.id, visited_on)
                .await?
                .map(NextVisit::Due),
        };
        let auto_sent_at = dal::auto_summary_at(tx.conn(), visit.id).await?;

        // The link: earlier ones stay valid, but no more than three at once.
        dal::keep_newest_links(tx.conn(), visit.id, LIVE_VISIT_LINKS - 1).await?;
        let options = ShareOptions {
            channel: ShareChannel::Whatsapp,
            lifetime: ShareOptions::parse(None, None)?.lifetime,
        };
        let made =
            visit_summary::create_in(tx, actor, request_id, visit.id, patient.id, options, now)
                .await?
                .link;
        let host = aarogyam_dal::staff::portal_host(tx.conn())
            .await?
            .unwrap_or_else(|| request_host.to_owned());
        let link = url(&host, &made.token);

        let lines = |items: Vec<(String, Option<Tooth>)>| -> Vec<WorkLine> {
            items
                .into_iter()
                .map(|(name, tooth)| WorkLine { name, tooth })
                .collect()
        };
        let done_lines = lines(done.into_iter().map(|w| (w.name, w.tooth)).collect());
        let plan_lines = lines(plan.into_iter().map(|p| (p.name, p.tooth)).collect());
        let composed = message::compose(&MessageInput {
            clinic_name: &clinic_name,
            doctor_name: doctor_name.as_deref(),
            patient_name: &patient.full_name,
            minor,
            chief_complaint: visit.chief_complaint.as_deref(),
            done: &done_lines,
            plan: &plan_lines,
            next_visit,
            care_keys: &keys,
            medicines: &medicines,
            url: &link,
            pin: &made.pin,
        });
        Ok(Prepared {
            phone,
            text: composed.text,
            short_text: composed.short_text,
            url: link,
            pin: made.pin,
            link_id: made.id,
            expires_at: made.expires_at,
            auto_sent_at,
            recipient,
        })
    })
    .await
}
