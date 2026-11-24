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
use aarogyam_dal::member_message_prefs as prefs_dal;
use aarogyam_dal::visit_messages as dal;
use aarogyam_dal::visit_summaries::next_follow_up;
use aarogyam_dal::{dental_terms, facts, patients, prescriptions as links, treatment, visits};
use aarogyam_domain::access::{ActorKind, ClinicActor, Denied};
use aarogyam_domain::clinical::{EncounterStatus, NoteBody, ProcedureStatus};
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::dental::{CariesDepth, ChartData, Tooth, ToothStatusData};
use aarogyam_domain::dental_details::{
    self as details, CONDITION_KIND, ERUPTION_KIND, ToothConditionData, ToothEruptionData,
};
use aarogyam_domain::dental_terms::{TermKind, TermRef};
use aarogyam_domain::ids::{EncounterId, ShareLinkId};
use aarogyam_domain::mouth::MouthSnapshot;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::quick_picks;
use aarogyam_domain::share::ShareChannel;
use aarogyam_domain::visit_message::{
    self as message, DoneDetail, FoundLine, LearnLink, MedicineLine, MessageInput, MessageSection,
    NextVisit, RecLine, Recipient, Refusal, SectionSet, Work,
};
use sakalya_db::{Db, ScopedTx};
use sakalya_types::{Paise, PhoneE164};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::promo::{self, IssuedCode};
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
    /// When it was planned or proposed.
    pub created_at: OffsetDateTime,
}

fn tooth_of(number: Option<i16>) -> Option<Tooth> {
    number.and_then(|n| Tooth::new(i64::from(n)).ok())
}

fn plan_item(source: PlanSource) -> impl Fn(dal::PlannedRow) -> PlanItem {
    move |row| PlanItem {
        id: row.id,
        source,
        name: row.name,
        code: row.code,
        tooth: tooth_of(row.tooth),
        estimate: row.estimate_paise.map(Paise::new),
        created_at: row.created_at,
    }
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
    Ok(procedures
        .into_iter()
        .map(plan_item(PlanSource::Procedure))
        .chain(items.into_iter().map(plan_item(PlanSource::PlanItem)))
        .collect())
}

/// The patient's proposed plan items, not yet accepted, that no planned procedure of the visit
/// or done procedure carries. Only the mouth view shows them, as recommended; the message's
/// "Your plan" and the visit page's plan keep to [`plan_in`] (decisions.md, 20 Nov 2026).
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn proposed_in(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
    patient_id: Uuid,
) -> Result<Vec<PlanItem>, AppError> {
    Ok(
        dal::proposed_plan_items(tx.conn(), patient_id, encounter_id)
            .await?
            .into_iter()
            .map(plan_item(PlanSource::PlanItem))
            .collect(),
    )
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
            // A recorded depth says more ("Decay close to the nerve"); none says nothing more.
            let depth = data
                .caries_depth
                .as_deref()
                .and_then(|d| CariesDepth::parse(d).ok());
            let words = details::caries_words(depth)
                .filter(|_| data.finding == "caries")
                .unwrap_or(words);
            add_found(&mut found, words, tooth, None);
        }
    }
    let abscesses = detail_found(tx, visit, &mut found, &mut touched).await?;
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
                    if data.caries_depth.as_deref() == Some(CariesDepth::NearPulp.as_str()) {
                        recorded.push(CariesDepth::NearPulp.as_str().to_owned());
                    }
                    recorded.push(data.finding);
                }
            }
            if abscesses.contains(&tooth) {
                recorded.push("abscess".to_owned());
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

/// The "What we found" lines from detail taps recorded in the visit (section 1.13), only as
/// recorded: an infection, a loose tooth, a tooth not through, and gums that bleed (one line,
/// counted). Infection and mobility are left out on a missing tooth (DT3); pocket depths stay on
/// the page. Returns the teeth with a recorded abscess, a valid "why" for their treatment.
async fn detail_found(
    tx: &mut ScopedTx,
    visit: &visits::EncounterRow,
    found: &mut Vec<FoundLine>,
    touched: &mut Vec<Tooth>,
) -> Result<Vec<Tooth>, AppError> {
    let missing: Vec<Option<i16>> = chart::current(tx.conn(), visit.patient_id)
        .await?
        .into_iter()
        .filter(|row| {
            row.data.get("finding").and_then(serde_json::Value::as_str) == Some("missing")
        })
        .map(|row| row.tooth)
        .collect();
    let mut abscesses = Vec::new();
    let mut bleeding = 0;
    for row in chart::current_of_kind(tx.conn(), visit.patient_id, CONDITION_KIND).await? {
        let Ok(data) = serde_json::from_value::<ToothConditionData>(row.data) else {
            continue;
        };
        let Some(tooth) = tooth_of(row.tooth) else {
            continue;
        };
        if data.infection.as_deref() == Some("abscess") {
            abscesses.push(tooth);
        }
        if row.encounter_id != Some(visit.id) {
            continue;
        }
        if !touched.contains(&tooth) {
            touched.push(tooth);
        }
        if data.bleeding == Some(true) {
            bleeding += 1;
        }
        if missing.contains(&row.tooth) {
            continue;
        }
        if let Some(words) = data.infection.as_deref().and_then(details::infection_words) {
            add_found(found, words, Some(tooth), None);
        }
        if let Some(words) = data
            .mobility
            .and_then(|grade| details::mobility_words(tooth, grade))
        {
            add_found(found, &words, Some(tooth), None);
        }
    }
    if let Some(words) = details::bleeding_words(bleeding) {
        add_found(found, &words, None, None);
    }
    for row in chart::current_of_kind(tx.conn(), visit.patient_id, ERUPTION_KIND).await? {
        if row.encounter_id != Some(visit.id) {
            continue;
        }
        let (Ok(data), Some(tooth)) = (
            serde_json::from_value::<ToothEruptionData>(row.data),
            tooth_of(row.tooth),
        ) else {
            continue;
        };
        if !touched.contains(&tooth) {
            touched.push(tooth);
        }
        if let Some(words) =
            details::eruption_words(tooth, &data.eruption, data.angulation.as_deref())
        {
            add_found(found, &words, Some(tooth), None);
        }
    }
    Ok(abscesses)
}

/// Who the summary goes to and their number, after the consent and opt-out checks.
async fn recipient_in(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    own_phone: Option<&str>,
    minor: bool,
) -> Result<(Recipient, PhoneE164, Uuid), AppError> {
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
    Ok((recipient, phone, recipient_id))
}

/// Whether the recipient allows promotional messages (D3): without a consent row they do not.
async fn promotional_ok(tx: &mut ScopedTx, recipient_id: Uuid) -> Result<bool, AppError> {
    let promotional = Purpose::Promotional.as_str();
    Ok(
        reach_dal::reach(tx.conn(), recipient_id, "whatsapp", promotional)
            .await?
            .is_some_and(|reach| reach.may_contact && !reach.opted_out),
    )
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

/// Everything the summary says, gathered after the refusals: the recipient, the visit's facts and
/// the clinic's names. The link and PIN come last, from Send or the preview.
struct Draft {
    visit_id: Uuid,
    patient_id: Uuid,
    phone: PhoneE164,
    recipient: Recipient,
    auto_sent_at: Option<OffsetDateTime>,
    clinic_name: String,
    clinic_phone: Option<String>,
    doctor_name: Option<String>,
    patient_name: String,
    minor: bool,
    age_band: message::AgeBand,
    facts: Facts,
    next_visit: Option<NextVisit>,
    keys: Vec<&'static str>,
    medicines: Vec<MedicineLine>,
    /// The public learn page for today's treatment (design §1.9).
    learn: Option<message::LearnTopic>,
    /// The patient's own offers and rewards (a fee fact about their account).
    offers: Vec<IssuedCode>,
    /// The referral to point to: only with the recipient's promotional consent (D3).
    referral: Option<IssuedCode>,
}

impl Draft {
    /// The offers as message lines, borrowing the codes.
    fn offer_lines(&self) -> Vec<message::OfferLine<'_>> {
        self.offers
            .iter()
            .map(|code| message::OfferLine {
                reward: code.purpose == aarogyam_domain::promo::Purpose::ReferrerReward,
                discount: code.discount(),
                code: &code.code,
                valid_to: code.valid_to,
                target: code.target(),
            })
            .collect()
    }

    /// The learn page's address on the learn host, when there is a topic and a host.
    fn learn_url(&self, learn_origin: Option<&str>) -> Option<String> {
        Some(message::learn_url(learn_origin?, self.learn?))
    }

    /// The message's input with this link, PIN, ticks and learn page address. The typed
    /// complaint stays on the visit page; it never goes into the text.
    fn input<'a>(
        &'a self,
        url: &'a str,
        pin: &'a str,
        sections: SectionSet,
        learn_url: Option<&'a str>,
        offers: &'a [message::OfferLine<'a>],
    ) -> MessageInput<'a> {
        MessageInput {
            clinic_name: &self.clinic_name,
            doctor_name: self.doctor_name.as_deref(),
            patient_name: &self.patient_name,
            minor: self.minor,
            age_band: self.age_band,
            complaints: &self.facts.complaints,
            done: &self.facts.details,
            charted_teeth: self.facts.charted_teeth,
            found: &self.facts.found,
            recommend: &self.facts.recommend,
            next_visit: self.next_visit,
            care_keys: &self.keys,
            advice: &self.facts.advice,
            medicines: &self.medicines,
            clinic_phone: self.clinic_phone.as_deref(),
            learn: self.learn.zip(learn_url).map(|(topic, url)| LearnLink {
                title: topic.title,
                url,
            }),
            url,
            pin,
            sections,
            offers,
            referral: self.referral.as_ref().map(IssuedCode::discount),
        }
    }
}

/// The visit, its patient and recipient after the refusals, and the clinic's name and zone.
struct Checked {
    visit: visits::EncounterRow,
    patient: patients::PatientRow,
    recipient: Recipient,
    phone: PhoneE164,
    recipient_id: Uuid,
    clinic_name: String,
    timezone: String,
    minor: bool,
}

/// Reads the visit and checks the refusals: open visit, no mobile, no consent, opted out. The
/// summary, its preview and the video story all start here, so none is made for a patient the
/// text could not go to. Writes nothing.
async fn checked_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    visit_id: EncounterId,
    now: OffsetDateTime,
) -> Result<Checked, AppError> {
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
    let minor = message::is_minor(patient.date_of_birth, clinic_today(&timezone, now));
    let (recipient, phone, recipient_id) =
        recipient_in(tx, patient.id, patient.phone_e164.as_deref(), minor).await?;
    Ok(Checked {
        visit,
        patient,
        recipient,
        phone,
        recipient_id,
        clinic_name,
        timezone,
        minor,
    })
}

/// Reads the visit and checks the refusals ([`checked_in`]), then gathers what the summary says.
/// Writes nothing.
async fn draft_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    visit_id: EncounterId,
    now: OffsetDateTime,
) -> Result<Draft, AppError> {
    let Checked {
        visit,
        patient,
        recipient,
        phone,
        recipient_id,
        clinic_name,
        timezone,
        minor,
    } = checked_in(tx, actor, visit_id, now).await?;
    let age_band = message::age_band(patient.date_of_birth, clinic_today(&timezone, now));

    // What it says.
    let doctor_name = links::doctor(tx.conn(), visit.clinician_id)
        .await?
        .map(|(name, _)| name);
    let done = done_in(tx, visit.id).await?;
    let plan = plan_in(tx, visit.id, patient.id).await?;
    let keys = care_keys(&done, &plan);
    let learn = message::learn_topic(&done.iter().map(DoneWork::work).collect::<Vec<_>>());
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
    let today = clinic_today(&timezone, now);
    let codes = promo::message_codes(tx, visit.id, patient.id, today).await?;
    let referral = if promotional_ok(tx, recipient_id).await? {
        codes.referral
    } else {
        None
    };
    Ok(Draft {
        visit_id: visit.id,
        patient_id: patient.id,
        phone,
        recipient,
        auto_sent_at,
        clinic_name,
        clinic_phone: context.clinic_phone,
        doctor_name,
        patient_name: patient.full_name,
        minor,
        age_band,
        facts,
        next_visit,
        keys,
        medicines,
        learn,
        offers: codes.offers,
        referral,
    })
}

/// The ticks from a request: every name must be a section.
///
/// # Errors
/// [`AppError::Invalid`] on `sections` for an unknown name (not echoed).
pub fn parse_sections(names: &[String]) -> Result<SectionSet, AppError> {
    SectionSet::parse(names).map_err(|_| AppError::invalid("sections", "unknown section"))
}

/// Prepares the visit's summary for the doctor's `WhatsApp`: picks the recipient, checks consent
/// and opt-outs, mints a visit link (7 days; at most [`LIVE_VISIT_LINKS`] live per visit, the
/// oldest revoked) and builds the text. `url` turns the clinic's portal host and the token into
/// the link; `request_host` is the host used when the clinic has no verified portal address.
/// `learn_origin` is the public learn host's origin; without it the text has no learn link.
/// With `sections` the text has only the ticked ones and they become the doctor's defaults;
/// without, it has every section (older clients).
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read` and `patients.contact`;
/// [`AppError::NotFound`] for a visit out of reach or an erased patient;
/// [`AppError::MessageRefused`] when the visit is open, nobody has a mobile, consent doesn't
/// allow care messages, or the recipient opted out of them on `WhatsApp`.
#[expect(
    clippy::too_many_arguments,
    reason = "the request's parts, passed through"
)]
pub async fn prepare(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    request_host: &str,
    url: &(dyn Fn(&str, &str) -> String + Sync),
    learn_origin: Option<&str>,
    sections: Option<SectionSet>,
    now: OffsetDateTime,
) -> Result<Prepared, AppError> {
    actor.require(Permission::ClinicalRead)?;
    actor.require(Permission::PatientsContact)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let draft = draft_in(tx, actor, visit_id, now).await?;

        // The link: earlier ones stay valid, but no more than three at once. Only Send gets
        // here; the preview never revokes or mints (B1).
        dal::keep_newest_links(tx.conn(), draft.visit_id, LIVE_VISIT_LINKS - 1).await?;
        let options = ShareOptions {
            channel: ShareChannel::Whatsapp,
            lifetime: ShareOptions::parse(None, None)?.lifetime,
        };
        let made = visit_summary::create_in(
            tx,
            actor,
            request_id,
            draft.visit_id,
            draft.patient_id,
            options,
            now,
        )
        .await?
        .link;
        let host = aarogyam_dal::staff::portal_host(tx.conn())
            .await?
            .unwrap_or_else(|| request_host.to_owned());
        let link = url(&host, &made.token);

        if let Some(ticked) = sections
            && let Some(member) = own_member(actor)
        {
            prefs_dal::save_sections(tx.conn(), member, &owned_names(ticked)).await?;
        }
        let learn = draft.learn_url(learn_origin);
        let offers = draft.offer_lines();
        let composed = message::compose(&draft.input(
            &link,
            &made.pin,
            sections.unwrap_or_default(),
            learn.as_deref(),
            &offers,
        ));
        Ok(Prepared {
            phone: draft.phone,
            text: composed.text,
            short_text: composed.short_text,
            desktop_text: composed.desktop_text,
            url: link,
            pin: made.pin,
            link_id: made.id,
            expires_at: made.expires_at,
            auto_sent_at: draft.auto_sent_at,
            recipient: draft.recipient,
        })
    })
    .await
}

/// The summary as Send would build it with these ticks, with a stand-in link and PIN of the same
/// length (N5). Runs the same refusals as [`prepare`] but mints, revokes and saves nothing (B1).
///
/// # Errors
/// As [`prepare`].
#[expect(
    clippy::too_many_arguments,
    reason = "the request's parts, passed through"
)]
pub async fn preview(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    request_host: &str,
    url: &(dyn Fn(&str, &str) -> String + Sync),
    learn_origin: Option<&str>,
    sections: SectionSet,
    now: OffsetDateTime,
) -> Result<String, AppError> {
    actor.require(Permission::ClinicalRead)?;
    actor.require(Permission::PatientsContact)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let draft = draft_in(tx, actor, visit_id, now).await?;
        let host = aarogyam_dal::staff::portal_host(tx.conn())
            .await?
            .unwrap_or_else(|| request_host.to_owned());
        let link = url(&host, message::PREVIEW_TOKEN);
        let learn = draft.learn_url(learn_origin);
        let offers = draft.offer_lines();
        Ok(message::compose(&draft.input(
            &link,
            message::PREVIEW_PIN,
            sections,
            learn.as_deref(),
            &offers,
        ))
        .text)
    })
    .await
}

/// What the doctor's device needs to render the patient's video (design section 1.7): the mouth
/// snapshot, the visit number for the file name and end card, the visit day and the clinic's
/// name. No patient name, phone, link or PIN.
#[derive(Debug, Clone)]
pub struct VisitStory {
    /// The clinic's visit number, such as `V-318`.
    pub visit_number: String,
    /// The visit's day in the clinic's time zone.
    pub visited_on: Date,
    /// The clinic's name for the title and end cards.
    pub clinic_name: String,
    /// The same snapshot as `GET /visits/{id}/mouth`, with `story_version` and `next_visit`.
    pub mouth: MouthSnapshot,
    /// The ticked "Options we discussed" rows, as the shared visit page shows them.
    pub discussed: Vec<aarogyam_domain::present_discussion::SharedDiscussion>,
}

/// The video story of a closed visit. Runs the same refusals as [`prepare`], so a video is made
/// only when the text could be; mints, revokes and saves nothing.
///
/// # Errors
/// As [`prepare`].
pub async fn story(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    now: OffsetDateTime,
) -> Result<VisitStory, AppError> {
    actor.require(Permission::ClinicalRead)?;
    actor.require(Permission::PatientsContact)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let checked = checked_in(tx, actor, visit_id, now).await?;
        let mouth = crate::mouth::of_visit(tx, &checked.visit, now).await?;
        let discussed = visit_summary::shared_discussed(tx, checked.visit.id).await?;
        Ok(VisitStory {
            discussed,
            visited_on: clinic_today(&checked.timezone, checked.visit.started_at),
            visit_number: checked.visit.number,
            clinic_name: checked.clinic_name,
            mouth,
        })
    })
    .await
}

/// The caller's own membership; none for Sakalya support, who keep no preferences.
fn own_member(actor: &ClinicActor) -> Option<Uuid> {
    (actor.kind() == ActorKind::Staff).then(|| actor.membership_id.uuid())
}

fn owned_names(sections: SectionSet) -> Vec<String> {
    sections.names().into_iter().map(str::to_owned).collect()
}

/// A member's message defaults and hand-off count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessagePrefs {
    /// The ticked sections (every one until saved).
    pub sections: SectionSet,
    /// Summaries handed to `WhatsApp` (not "sent").
    pub handoffs: u32,
    /// Clinic days with at least one hand-off.
    pub handoff_days: u32,
    /// The clinic day of the last hand-off.
    pub last_handoff_on: Option<Date>,
}

impl From<prefs_dal::PrefsRow> for MessagePrefs {
    fn from(row: prefs_dal::PrefsRow) -> Self {
        Self {
            // Names the database holds are checked there; an unknown one counts as unticked.
            sections: row.sections.map_or(SectionSet::ALL, |names| {
                names
                    .iter()
                    .filter_map(|n| MessageSection::parse(n))
                    .fold(SectionSet::NONE, |set, s| set.with(s, true))
            }),
            handoffs: u32::try_from(row.handoffs).unwrap_or(0),
            handoff_days: u32::try_from(row.handoff_days).unwrap_or(0),
            last_handoff_on: row.last_handoff_on,
        }
    }
}

/// The caller's message defaults.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`.
pub async fn prefs(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<MessagePrefs, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let Some(member) = own_member(actor) else {
        return Ok(prefs_dal::PrefsRow::default().into());
    };
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(prefs_dal::get(tx.conn(), member)
            .await?
            .unwrap_or_default()
            .into())
    })
    .await
}

/// Saves the caller's ticked sections as their defaults.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`, or for Sakalya support.
pub async fn save_prefs(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    sections: SectionSet,
) -> Result<MessagePrefs, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let member = own_member(actor).ok_or(AppError::Denied(Denied::NotAMember))?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(
            prefs_dal::save_sections(tx.conn(), member, &owned_names(sections))
                .await?
                .into(),
        )
    })
    .await
}

/// Counts that the caller handed the visit's summary to `WhatsApp` (never "sent"):
/// `handoff_days` goes up once per clinic day. Support hand-offs are not counted.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read` and `patients.contact`;
/// [`AppError::NotFound`] for a visit out of reach;
/// [`AppError::Invalid`] on `template_version` longer than 40 characters or blank.
pub async fn handed_off(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    template_version: Option<&str>,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    actor.require(Permission::ClinicalRead)?;
    actor.require(Permission::PatientsContact)?;
    let template_version = template_version.map(str::trim);
    if template_version.is_some_and(|v| v.is_empty() || v.chars().count() > 40) {
        return Err(AppError::invalid("template_version", "1 to 40 characters"));
    }
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        visits::get_encounter(
            tx.conn(),
            visit_id.uuid(),
            false,
            actor.reach(Permission::ClinicalRead).member(),
        )
        .await?
        .ok_or(AppError::NotFound("visit"))?;
        let Some(member) = own_member(actor) else {
            return Ok(());
        };
        let (_, timezone) = links::clinic_name(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        prefs_dal::hand_off(
            tx.conn(),
            member,
            clinic_today(&timezone, now),
            template_version,
        )
        .await?;
        Ok(())
    })
    .await
}
