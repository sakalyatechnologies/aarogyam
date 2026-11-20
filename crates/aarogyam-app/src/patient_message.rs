//! The visit summary a doctor sends from their own `WhatsApp` (docs/plans/visit-story-design.md,
//! C2). The server builds the text and mints a visit link with its PIN; the phone opens
//! `WhatsApp` with it and the doctor presses Send. Nothing is queued or sent from here: this is
//! "prepared", not "sent", and the decision log records the exception to rule 10.
//!
//! It goes to the patient, or to a relative when the patient is a minor (a guardian or parent)
//! or an adult without a mobile who has a relative marked as primary contact. Consent and
//! `WhatsApp` opt-outs are checked as for any care message.

use aarogyam_dal::auto_messages as reach_dal;
use aarogyam_dal::chart::{self, ChartRow};
use aarogyam_dal::visit_messages as dal;
use aarogyam_dal::visit_summaries::next_follow_up;
use aarogyam_dal::{dental_terms, facts, patients, prescriptions as links, treatment, visits};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{EncounterStatus, NoteBody, ProcedureStatus};
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::dental::{ChartData, Tooth, ToothStatusData};
use aarogyam_domain::dental_terms::{TermKind, TermRef};
use aarogyam_domain::ids::{EncounterId, ShareLinkId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::quick_picks;
use aarogyam_domain::share::ShareChannel;
use aarogyam_domain::visit_message::{
    self as message, DoneDetail, FoundLine, MedicineLine, MessageInput, NextVisit, RecLine,
    Recipient, Refusal, Work,
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
    /// Started and not finished, such as a root canal between sittings.
    pub in_progress: bool,
    /// The name in patient words, without the sitting, for the message.
    pub label: String,
    /// The sitting recorded on the chart entry.
    pub sitting: Option<u8>,
    /// The material recorded on the chart entry.
    pub material: Option<String>,
}

impl DoneWork {
    fn work(&self) -> Work<'_> {
        Work {
            code: self.code.as_deref(),
            name: &self.name,
            tooth: self.tooth,
            in_progress: self.in_progress,
        }
    }
}

/// The treatments done in the visit: its done procedures, then the treatments recorded on the
/// dental chart that no done procedure already carries, each in the order recorded.
pub(crate) async fn done_in(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<DoneWork>, AppError> {
    let mut done: Vec<DoneWork> = treatment::procedures_of_encounter(tx.conn(), encounter_id)
        .await?
        .into_iter()
        .filter(|row| row.status == ProcedureStatus::Done.as_str())
        .map(|row| DoneWork {
            label: row.name.clone(),
            name: row.name,
            code: row.code,
            tooth: tooth_of(row.tooth),
            in_progress: false,
            sitting: None,
            material: None,
        })
        .collect();
    let entries = chart_work(&chart::of_encounter(tx.conn(), encounter_id).await?);
    let clinic_ids: Vec<Uuid> = entries
        .iter()
        .filter_map(|(_, data)| data.procedure.as_deref())
        .filter_map(|id| Some(TermRef::stored(TermKind::Procedure, id)?.clinic()?.uuid()))
        .collect();
    let terms = if clinic_ids.is_empty() {
        Vec::new()
    } else {
        dental_terms::some(tx.conn(), &clinic_ids).await?
    };
    let procedures = done.len();
    for (tooth, data) in entries {
        let Some(code) = data.procedure else { continue };
        let seeded = matches!(
            TermRef::stored(TermKind::Procedure, &code),
            Some(TermRef::Seeded(_))
        );
        let label = match TermRef::stored(TermKind::Procedure, &code) {
            Some(TermRef::Seeded(term)) => term.label.clone(),
            Some(TermRef::Clinic(id)) => terms
                .iter()
                .find(|t| t.id == id.uuid())
                .map_or_else(|| humanised(&data.finding), |t| t.label.clone()),
            None => humanised(&code),
        };
        let name = if data.in_progress {
            message::continuing_name(&label, data.sitting)
        } else {
            label.clone()
        };
        let words = seeded
            .then(|| message::procedure_words(&code))
            .flatten()
            .map_or(label, str::to_owned);
        let work = DoneWork {
            name,
            code: Some(code),
            tooth,
            in_progress: data.in_progress,
            label: words,
            sitting: data.sitting,
            material: data.material,
        };
        let duplicate = done[..procedures]
            .iter()
            .any(|d| message::same_treatment(&d.work(), &work.work()));
        if !duplicate {
            done.push(work);
        }
    }
    Ok(done)
}

/// The visit's chart entries that record a treatment done here, in order. Entries made in error
/// are left out, and so is one superseded by a later entry of the same visit on the same tooth;
/// one superseded by a later visit (the next root canal sitting) still counts for this one.
fn chart_work(rows: &[ChartRow]) -> Vec<(Option<Tooth>, ChartData)> {
    live_entries(rows)
        .into_iter()
        .filter(|(_, data)| data.procedure.is_some() && !data.elsewhere)
        .collect()
}

/// The visit's chart entries that still stand for it (see [`chart_work`]), in order.
fn live_entries(rows: &[ChartRow]) -> Vec<(Option<Tooth>, ChartData)> {
    rows.iter()
        .enumerate()
        .filter(|(i, row)| match row.status.as_str() {
            "current" => true,
            "superseded" => !rows[i + 1..]
                .iter()
                .any(|later| later.status != "entered_in_error" && later.tooth == row.tooth),
            _ => false,
        })
        .filter_map(|(_, row)| {
            let data: ChartData = serde_json::from_value(row.data.clone()).ok()?;
            Some((tooth_of(row.tooth), data))
        })
        .collect()
}

/// A stored id in words: `root_canal` becomes "Root canal".
fn humanised(id: &str) -> String {
    let words = id.replace('_', " ");
    let mut chars = words.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// The aftercare keys for the visit, most important first.
pub(crate) fn care_keys(done: &[DoneWork], plan: &[PlanItem]) -> Vec<&'static str> {
    let done: Vec<Work<'_>> = done.iter().map(DoneWork::work).collect();
    let planned: Vec<Work<'_>> = plan
        .iter()
        .map(|p| Work {
            code: p.code.as_deref(),
            name: &p.name,
            tooth: p.tooth,
            in_progress: false,
        })
        .collect();
    message::aftercare_keys(&done, &planned)
}

/// What the message says beyond the treatments' names, from recorded facts only: chip lines of
/// the visit's notes (never their other text), chart entries, tooth health levels and coded
/// conditions of the visit, and the plan.
struct Facts {
    complaints: Vec<String>,
    advice: Vec<String>,
    found: Vec<FoundLine>,
    charted_teeth: usize,
    details: Vec<DoneDetail>,
    recommend: Vec<RecLine>,
}

fn add_found(found: &mut Vec<FoundLine>, words: &str, tooth: Option<Tooth>, months: Option<u8>) {
    let index = found
        .iter()
        .position(|f| f.words == words && f.within_months == months)
        .unwrap_or_else(|| {
            found.push(FoundLine {
                words: words.to_owned(),
                teeth: Vec::new(),
                within_months: months,
            });
            found.len() - 1
        });
    if let Some(line) = found.get_mut(index)
        && let Some(tooth) = tooth.filter(|t| !line.teeth.contains(t))
    {
        line.teeth.push(tooth);
    }
}

/// Findings on a chart entry that the message reports when no procedure goes with them.
const FOUND_ON_CHART: [&str; 4] = ["caries", "fractured", "watch", "missing"];

#[expect(
    clippy::too_many_lines,
    reason = "one pass over the visit's recorded facts"
)]
async fn facts_in(
    tx: &mut ScopedTx,
    visit: &visits::EncounterRow,
    done: &[DoneWork],
    plan: &[PlanItem],
    estimates: bool,
    now: OffsetDateTime,
) -> Result<Facts, AppError> {
    let picks = quick_picks::dental();
    let (mut complaints, mut advice, mut chips) = (Vec::new(), Vec::new(), Vec::new());
    for note in visits::list_notes(tx.conn(), visit.id).await? {
        if note.status != "signed" && note.status != "draft" {
            continue;
        }
        let Ok(body) = serde_json::from_value::<NoteBody>(note.body) else {
            continue;
        };
        let section = |text: &Option<String>| text.clone().unwrap_or_default();
        for pick in message::chip_lines(&section(&body.subjective), &picks.complaints) {
            if !complaints.contains(&pick.label) {
                complaints.push(pick.label.clone());
            }
        }
        for pick in message::chip_lines(&section(&body.plan), &picks.advice) {
            if !advice.contains(&pick.text) {
                advice.push(pick.text.clone());
            }
        }
        for pick in message::chip_lines(&section(&body.objective), &picks.findings) {
            if !chips.iter().any(|(id, _)| *id == pick.id) {
                chips.push((pick.id.clone(), pick.patient_text.clone()));
            }
        }
    }

    // What was charted and found today.
    let mut found: Vec<FoundLine> = Vec::new();
    let mut touched: Vec<Tooth> = Vec::new();
    for (tooth, data) in live_entries(&chart::of_encounter(tx.conn(), visit.id).await?) {
        if let Some(tooth) = tooth.filter(|t| !touched.contains(t)) {
            touched.push(tooth);
        }
        if data.procedure.is_none()
            && FOUND_ON_CHART.contains(&data.finding.as_str())
            && let Some(words) = message::chart_finding_words(&data.finding)
        {
            add_found(&mut found, words, tooth, None);
        }
    }
    let mut months: Vec<(Tooth, u8)> = Vec::new();
    for row in chart::current_statuses(tx.conn(), visit.patient_id).await? {
        let Ok(status) = serde_json::from_value::<ToothStatusData>(row.data) else {
            continue;
        };
        let tooth = tooth_of(row.tooth);
        if let (Some(tooth), Some(within)) = (tooth, status.treat_within_months) {
            months.push((tooth, within));
        }
        if row.encounter_id != Some(visit.id) {
            continue;
        }
        if let Some(tooth) = tooth.filter(|t| !touched.contains(t)) {
            touched.push(tooth);
        }
        if status.health == "needs_treatment"
            && let Some(words) = message::needs_treatment_words()
        {
            add_found(&mut found, words, tooth, status.treat_within_months);
        }
    }
    // Teeth charted or given a health level today.
    let charted_teeth = touched.len();
    for condition in facts::list_conditions(tx.conn(), visit.patient_id).await? {
        if condition.encounter_id != Some(visit.id) || condition.status == "entered_in_error" {
            continue;
        }
        if let (Some(system), Some(code)) = (&condition.code_system, &condition.code)
            && let Some(words) = message::diagnosis_words(system, code)
        {
            add_found(&mut found, words, None, None);
        }
    }
    for (_, words) in &chips {
        if let Some(words) = words {
            add_found(&mut found, words, None, None);
        }
    }

    // Each treatment's details, only as recorded.
    for work in done {
        if let Some(tooth) = work.tooth.filter(|t| !touched.contains(t)) {
            touched.push(tooth);
        }
    }
    let until = visit.ended_at.unwrap_or(now);
    let chip_ids: Vec<&str> = chips.iter().map(|(id, _)| id.as_str()).collect();
    let mut details = Vec::with_capacity(done.len());
    for work in done {
        let mut recorded: Vec<String> = Vec::new();
        if let Some(tooth) = work.tooth {
            let number = i16::from(tooth.number());
            for row in chart::history(tx.conn(), visit.patient_id, number).await? {
                if row.status == "entered_in_error" || row.effective_at > until {
                    continue;
                }
                if let Ok(data) = serde_json::from_value::<ChartData>(row.data) {
                    recorded.push(data.finding);
                }
            }
        }
        let recorded: Vec<&str> = recorded.iter().map(String::as_str).collect();
        let why = work
            .tooth
            .and_then(|_| message::why_key(&recorded, &chip_ids, touched.len()));
        details.push(DoneDetail {
            name: work.label.clone(),
            tooth: work.tooth,
            sitting: work.sitting,
            continuing: work.in_progress,
            why: why.map(str::to_owned),
            material: work.material.clone(),
            next_planned: plan
                .iter()
                .find(|p| p.tooth.is_some() && p.tooth == work.tooth)
                .map(|p| p.name.clone()),
        });
    }

    let recommend = plan
        .iter()
        .map(|item| RecLine {
            name: item.name.clone(),
            tooth: item.tooth,
            within_months: item
                .tooth
                .and_then(|tooth| months.iter().find(|(t, _)| *t == tooth))
                .map(|(_, within)| *within),
            estimate: item.estimate.filter(|_| estimates),
        })
        .collect();
    Ok(Facts {
        complaints,
        advice,
        found,
        charted_teeth,
        details,
        recommend,
    })
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
    /// The message for desktop `whatsapp://` links: no emoji, short enough once URL-encoded;
    /// none when it can't fit (copy the message instead).
    pub desktop_text: Option<String>,
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
        let age_band = message::age_band(patient.date_of_birth, today);

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
        let context = dal::page_context(tx.conn(), visit.id)
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        let facts = facts_in(tx, &visit, &done, &plan, context.patient_estimates, now).await?;

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

        // The typed complaint stays on the visit page; it never goes into the text.
        let composed = message::compose(&MessageInput {
            clinic_name: &clinic_name,
            doctor_name: doctor_name.as_deref(),
            patient_name: &patient.full_name,
            minor,
            age_band,
            complaints: &facts.complaints,
            done: &facts.details,
            charted_teeth: facts.charted_teeth,
            found: &facts.found,
            recommend: &facts.recommend,
            next_visit,
            care_keys: &keys,
            advice: &facts.advice,
            medicines: &medicines,
            clinic_phone: context.clinic_phone.as_deref(),
            // The public learn page comes with the learn site (P9).
            learn_url: None,
            url: &link,
            pin: &made.pin,
        });
        Ok(Prepared {
            phone,
            text: composed.text,
            short_text: composed.short_text,
            desktop_text: composed.desktop_text,
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
