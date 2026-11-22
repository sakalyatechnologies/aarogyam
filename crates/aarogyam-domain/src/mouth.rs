//! The mouth snapshot (docs/plans/visit-story-v2-offers-design.md, sections 1.3, 1.12 and 1.13):
//! every tooth position of the patient's dentition, each listed tooth's history, problems,
//! recorded details and treatments with their steps, built from recorded facts only. Clients
//! render it; they never build it. The patient's page, the doctor's Present mode and the video
//! all show this one shape.
//!
//! It is an allowlist: no notes, no clinic-typed term labels, no names, and no clinic or dentist
//! for work done elsewhere (only `origin`). Step states come from records done here
//! (`treatment-stages.json` `record_map`); every other step is `usual`.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use time::Date;

use crate::dental::{CariesDepth, ChartData, Finding, Surface, Tooth, ToothStatusData};
use crate::dental_details::{ToothConditionData, ToothEruptionData};
use crate::dental_terms::{TermKind, TermRef};
use crate::visit_message::model_of_name;

/// The story contract the snapshot follows; bumped when the page or video must switch scenes.
pub const STORY_VERSION: u32 = 1;
/// Most key teeth the story focuses on.
pub const MAX_FOCUS: usize = 3;

const SOURCE: &str = include_str!("../../../specialties/dental/treatment-stages.json");

time::serde::format_description!(day, Date, "[year]-[month]-[day]");

mod day_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use time::Date;

    #[derive(Serialize, Deserialize)]
    struct Day(#[serde(with = "super::day")] Date);

    #[expect(
        clippy::ref_option,
        clippy::trivially_copy_pass_by_ref,
        reason = "serde's `with` passes a reference"
    )]
    pub fn serialize<S: Serializer>(
        value: &Option<Date>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.map(Day).serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Date>, D::Error> {
        Ok(Option::<Day>::deserialize(deserializer)?.map(|d| d.0))
    }
}

mod day_list {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use time::Date;

    #[derive(Serialize, Deserialize)]
    struct Day(#[serde(with = "super::day")] Date);

    pub fn serialize<S: Serializer>(value: &[Date], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(value.iter().map(|d| Day(*d)))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Date>, D::Error> {
        Ok(Vec::<Day>::deserialize(deserializer)?
            .into_iter()
            .map(|d| d.0)
            .collect())
    }
}

// ---------------------------------------------------------------------------------------------
// Treatment stages (data)

/// One step of a treatment model.
#[derive(Debug, Clone, Deserialize)]
pub struct StageStep {
    /// Stable key, such as `dressing`.
    pub key: String,
    /// The art scene key.
    pub scene: String,
    /// What happens, in patient words.
    pub words: String,
    /// What usually follows (always shown under "Usually").
    pub after_words: String,
}

/// Which records back which steps.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RecordMap {
    /// The step an in-progress record reaches with no material, or a plain one.
    #[serde(default)]
    pub in_progress_step: Option<String>,
    /// Materials that leave the in-progress step as it is; `None` accepts any material.
    #[serde(default)]
    pub plain_materials: Option<Vec<String>>,
    /// Seeded medicament ids that reach `medicament_step` (DF5).
    #[serde(default)]
    pub medicaments: Vec<String>,
    /// The step a medicament reaches.
    #[serde(default)]
    pub medicament_step: Option<String>,
    /// The steps a finished record backs.
    pub done_steps: Vec<String>,
}

/// A treatment model.
#[derive(Debug, Clone, Deserialize)]
pub struct StageModel {
    /// Visits it usually takes.
    pub typical_visits: u8,
    /// Its steps, in order.
    pub steps: Vec<StageStep>,
    /// What to expect afterwards.
    pub recovery: Vec<String>,
    /// Which records back which steps.
    pub record_map: RecordMap,
}

/// `specialties/dental/treatment-stages.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct Stages {
    /// Seeded procedure id or procedure code → model.
    pub terms: BTreeMap<String, String>,
    /// Work finding → model, for an in-progress entry without a procedure.
    pub work_findings: BTreeMap<String, String>,
    /// The models by key.
    pub models: BTreeMap<String, StageModel>,
    /// Seeded material id → appearance key.
    pub material_appearance: BTreeMap<String, String>,
    /// Finding → appearance of a clinic's own material.
    pub custom_default: BTreeMap<String, String>,
}

/// The treatment stages file; none when it doesn't parse (a test guards it).
#[must_use]
pub fn stages() -> Option<&'static Stages> {
    static FILE: OnceLock<Option<Stages>> = OnceLock::new();
    FILE.get_or_init(|| serde_json::from_str(SOURCE).ok())
        .as_ref()
}

fn with_wisdom(model: &str, tooth: Tooth) -> String {
    if model == "extraction" && tooth.number() % 10 == 8 {
        "wisdom_extraction".to_owned()
    } else {
        model.to_owned()
    }
}

/// The model of a procedure code or seeded procedure id; never from a typed name.
#[must_use]
pub fn model_of_code(code: &str, tooth: Tooth) -> Option<String> {
    let model = stages()?.terms.get(&code.trim().to_ascii_lowercase())?;
    Some(with_wisdom(model, tooth))
}

/// The model of a planned or done procedure: its code, or for an uncoded one its name through
/// the message's keyword matcher. Only the model key comes back, never the name.
fn model_of_record(record: &ProcedureRecord, tooth: Tooth) -> Option<String> {
    match record.code.as_deref() {
        Some(code) => model_of_code(code, tooth),
        None => model_of_name(&record.name, Some(tooth)).map(str::to_owned),
    }
}

/// How a stored material looks: a seeded id's appearance, or the finding's default for a
/// clinic's own material.
fn appearance(material: Option<&str>, finding: &str) -> Option<String> {
    let file = stages()?;
    match TermRef::stored(TermKind::Material, material?)? {
        TermRef::Seeded(term) => file.material_appearance.get(&term.id).cloned(),
        TermRef::Clinic(_) => file.custom_default.get(finding).cloned(),
    }
}

// ---------------------------------------------------------------------------------------------
// Input

/// A chart entry with where and when it was recorded. Entries made in error are left out.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryRecord {
    /// The stored entry.
    pub data: ChartData,
    /// Still current (else superseded).
    pub current: bool,
    /// The day it was recorded, in the clinic's time zone.
    #[serde(with = "day")]
    pub on: Date,
    /// Recorded in a visit here (it has an encounter).
    pub in_visit: bool,
    /// Recorded in this visit.
    #[serde(default)]
    pub today: bool,
}

/// A tooth's current health status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusRecord {
    /// The stored status.
    pub data: ToothStatusData,
    /// Set in this visit.
    #[serde(default)]
    pub today: bool,
}

/// A current detail row (condition or eruption).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailRecord<T> {
    /// The stored detail.
    pub data: T,
    /// The day it was recorded.
    #[serde(with = "day")]
    pub on: Date,
    /// Recorded in this visit.
    #[serde(default)]
    pub today: bool,
}

/// A planned, recommended or done procedure: its tooth, code and name. The name is only read to
/// pick a model for an uncoded record; it never reaches the snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcedureRecord {
    /// FDI tooth, when it concerns one.
    pub tooth: Option<u8>,
    /// The code or seeded id, when coded.
    pub code: Option<String>,
    /// The name as typed.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// The day it was planned or proposed, when known.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub on: Option<Date>,
}

/// Everything the snapshot is built from, already in this clinic's reach.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouthInput {
    /// The visit's day.
    #[serde(with = "day")]
    pub visit_on: Date,
    /// The patient's age in years, when known.
    pub age: Option<u8>,
    /// Chart entries (current and superseded), oldest first.
    pub entries: Vec<EntryRecord>,
    /// Current tooth statuses.
    #[serde(default)]
    pub statuses: Vec<StatusRecord>,
    /// Current tooth conditions.
    #[serde(default)]
    pub conditions: Vec<DetailRecord<ToothConditionData>>,
    /// Current tooth eruptions.
    #[serde(default)]
    pub eruptions: Vec<DetailRecord<ToothEruptionData>>,
    /// Procedures done in the visit.
    #[serde(default)]
    pub done_today: Vec<ProcedureRecord>,
    /// The plan: planned procedures and accepted plan items, de-duplicated.
    #[serde(default)]
    pub planned: Vec<ProcedureRecord>,
    /// Proposed plan items not yet accepted: shown as recommended (decisions.md, 20 Nov 2026).
    #[serde(default)]
    pub recommended: Vec<ProcedureRecord>,
    /// The patient's next booked visit.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub next_visit: Option<Date>,
}

// ---------------------------------------------------------------------------------------------
// Output

/// The mouth snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouthSnapshot {
    /// The story contract ([`STORY_VERSION`]).
    pub story_version: u32,
    /// `adult`, `child` or `mixed`.
    pub dentition: String,
    /// Every position to draw, in quadrant order (1 to 4, or 5 to 8 for a child).
    pub positions: Vec<Position>,
    /// The teeth with anything to show; sound teeth are implied.
    pub teeth: Vec<MouthTooth>,
    /// Up to three key teeth for the story.
    pub focus: Vec<u8>,
    /// The patient's next booked visit.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub next_visit: Option<Date>,
}

/// One drawn tooth position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    /// FDI quadrant of the drawn tooth.
    pub quadrant: u8,
    /// Position 1 to 8 from the midline.
    pub index: u8,
    /// The tooth drawn there.
    pub tooth: u8,
    /// `tooth` (listed in `teeth`), `sound`, or `not_recorded` (mixed dentition, nothing
    /// charted there: a neutral outline, never sound).
    pub shown: String,
    /// The other tooth charted at this position (mixed dentition), for tooth detail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other: Option<OtherTooth>,
}

/// The tooth not drawn at a mixed position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OtherTooth {
    /// FDI tooth.
    pub tooth: u8,
    /// Its headline finding, or `sound`.
    pub finding: String,
}

/// One listed tooth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouthTooth {
    /// FDI tooth.
    pub tooth: u8,
    /// The headline finding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finding: Option<String>,
    /// The day the headline finding was recorded.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub finding_on: Option<Date>,
    /// Surfaces of a caries or filled headline, as stored.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub surfaces: Vec<String>,
    /// The headline's appearance key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// From the tooth status only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<String>,
    /// From the tooth status only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub treat_within_months: Option<u8>,
    /// `treated`, `in_progress` or `found` in this visit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub today: Option<String>,
    /// Something is planned on it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub planned: bool,
    /// Something is proposed on it and not yet accepted ("Recommended").
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub recommended: bool,
    /// The day the latest recommendation on it was proposed.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub recommended_on: Option<Date>,
    /// The sitting of a treatment in progress.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sitting: Option<u8>,
    /// Finished work on it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub work: Vec<MouthWork>,
    /// Recorded problem findings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    /// The day each problem was last recorded, one per entry of `problems`.
    #[serde(default, with = "day_list", skip_serializing_if = "Vec::is_empty")]
    pub problems_on: Vec<Date>,
    /// Recorded detail taps only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<MouthDetails>,
    /// Treatments in progress, done here, or planned.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub treatments: Vec<MouthTreatment>,
}

/// Finished work on a tooth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouthWork {
    /// The work finding.
    pub finding: String,
    /// Its appearance key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// `here`, `elsewhere` or `before`.
    pub origin: String,
    /// The visit day, only for `here`.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub done_on: Option<Date>,
    /// Recorded in this visit ("Done here · today" in Present mode).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub today: bool,
}

/// Detail taps recorded on a tooth's current rows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouthDetails {
    /// `enamel`, `dentin` or `near_pulp`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caries_depth: Option<String>,
    /// `infection` or `abscess`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub infection: Option<String>,
    /// Gums bleed on probing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bleeding: Option<bool>,
    /// Deepest pocket in mm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pocket_mm: Option<u8>,
    /// Mobility grade.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mobility: Option<u8>,
    /// When the condition was recorded.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub condition_on: Option<Date>,
    /// `erupted`, `partial`, `impacted` or `unerupted`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eruption: Option<String>,
    /// The angle of a tooth not fully through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angulation: Option<String>,
}

impl MouthDetails {
    fn is_empty(&self) -> bool {
        self.caries_depth.is_none()
            && self.infection.is_none()
            && self.bleeding.is_none()
            && self.pocket_mm.is_none()
            && self.mobility.is_none()
            && self.eruption.is_none()
    }
}

/// A treatment on a tooth with its steps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouthTreatment {
    /// The model key, such as `root_canal`.
    pub model: String,
    /// `in_progress`, `done` or `planned`.
    pub state: String,
    /// A planned treatment that is only proposed, not yet accepted ("Recommended").
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub recommended: bool,
    /// Visits it usually takes.
    pub typical_visits: u8,
    /// Its steps with their resolved state.
    pub steps: Vec<MouthStep>,
    /// What to expect (always shown under "What to expect").
    pub recovery: Vec<String>,
}

/// One step with its state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouthStep {
    /// Step key.
    pub key: String,
    /// Art scene key.
    pub scene: String,
    /// What happens.
    pub words: String,
    /// What usually follows (shown under "Usually").
    pub after_words: String,
    /// `done`, `current` (both backed by a record here), `next` (the booked visit) or `usual`.
    pub state: String,
    /// "Visit {sitting}" for a recorded step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sitting: Option<u8>,
    /// The visit day: of a recorded step without a sitting, or of the booked `next` visit.
    #[serde(default, with = "day_option", skip_serializing_if = "Option::is_none")]
    pub on: Option<Date>,
}

// ---------------------------------------------------------------------------------------------
// Builder

const PROBLEMS: [Finding; 4] = [
    Finding::Caries,
    Finding::Fractured,
    Finding::Watch,
    Finding::Missing,
];
const SURFACE_HEADLINE: [Finding; 4] = [
    Finding::Caries,
    Finding::Fractured,
    Finding::Watch,
    Finding::Filled,
];
const FOUND_TODAY: [Finding; 4] = [
    Finding::Caries,
    Finding::Fractured,
    Finding::Watch,
    Finding::Missing,
];

struct Entry<'a> {
    record: &'a EntryRecord,
    tooth: Tooth,
    finding: Finding,
    surface: Option<Surface>,
}

impl Entry<'_> {
    fn here(&self) -> bool {
        self.record.in_visit && !self.record.data.elsewhere
    }

    fn origin(&self) -> &'static str {
        if self.record.data.elsewhere {
            "elsewhere"
        } else if !self.record.in_visit || self.record.data.procedure.is_none() {
            "before"
        } else {
            "here"
        }
    }

    /// The model it records: its seeded procedure's, else (in progress, here) its finding's.
    fn model(&self) -> Option<String> {
        let file = stages()?;
        match self.record.data.procedure.as_deref() {
            Some(id) => match TermRef::stored(TermKind::Procedure, id)? {
                TermRef::Seeded(term) => model_of_code(&term.id, self.tooth),
                TermRef::Clinic(_) => None,
            },
            None if self.record.data.in_progress && self.record.in_visit => file
                .work_findings
                .get(self.finding.as_str())
                .map(|m| with_wisdom(m, self.tooth)),
            None => None,
        }
    }

    /// Whether it backs steps of a treatment done here.
    fn done_here(&self) -> bool {
        self.here() && (self.record.data.procedure.is_some() || self.record.data.in_progress)
    }
}

fn entries(input: &MouthInput) -> Vec<Entry<'_>> {
    input
        .entries
        .iter()
        .filter_map(|record| {
            Some(Entry {
                record,
                tooth: Tooth::new(i64::from(record.data.tooth)).ok()?,
                finding: Finding::parse(&record.data.finding).ok()?,
                surface: record
                    .data
                    .surface
                    .as_deref()
                    .and_then(|s| Surface::parse(s).ok()),
            })
        })
        .collect()
}

/// The step an entry backs, by the model's `record_map`; none for an in-progress entry whose
/// material the map doesn't know (DF5).
fn steps_backed(entry: &Entry<'_>, model: &StageModel) -> Vec<String> {
    let map = &model.record_map;
    if !entry.record.data.in_progress {
        return map.done_steps.clone();
    }
    let material = entry.record.data.material.as_deref();
    let step = match material {
        None => map.in_progress_step.clone(),
        Some(id) if map.medicaments.iter().any(|m| m == id) => map.medicament_step.clone(),
        Some(id) => match &map.plain_materials {
            None => map.in_progress_step.clone(),
            Some(plain) if plain.iter().any(|m| m == id) => map.in_progress_step.clone(),
            Some(_) => None,
        },
    };
    step.into_iter().collect()
}

fn usual_steps(model: &StageModel) -> Vec<MouthStep> {
    model
        .steps
        .iter()
        .map(|step| MouthStep {
            key: step.key.clone(),
            scene: step.scene.clone(),
            words: step.words.clone(),
            after_words: step.after_words.clone(),
            state: "usual".to_owned(),
            sitting: None,
            on: None,
        })
        .collect()
}

fn treatment(model_key: &str, state: &str, steps: Vec<MouthStep>) -> Option<MouthTreatment> {
    let model = stages()?.models.get(model_key)?;
    Some(MouthTreatment {
        model: model_key.to_owned(),
        state: state.to_owned(),
        recommended: false,
        typical_visits: model.typical_visits,
        steps,
        recovery: model.recovery.clone(),
    })
}

/// The steps of a treatment ending at `last` (current, here): the run of this tooth's entries
/// of the same model leading to it backs `done` steps, `last` backs `current` when in progress.
fn resolved_steps(history: &[&Entry<'_>], last: &Entry<'_>, model_key: &str) -> Vec<MouthStep> {
    let Some(model) = stages().and_then(|s| s.models.get(model_key)) else {
        return Vec::new();
    };
    let mut steps = usual_steps(model);
    let current_backed = steps_backed(last, model);
    if last.record.data.in_progress && current_backed.is_empty() {
        // An unknown material: no step is claimed.
        return steps;
    }
    // The run: earlier in-progress entries of this model, here, back to the last finished one.
    let mut run: Vec<&Entry<'_>> = Vec::new();
    for entry in history.iter().rev() {
        if std::ptr::eq(entry.record, last.record) {
            continue;
        }
        if !entry.done_here() || entry.model().as_deref() != Some(model_key) {
            continue;
        }
        if !entry.record.data.in_progress {
            break;
        }
        run.push(entry);
    }
    run.reverse();
    run.push(last);
    for entry in run {
        let is_last = std::ptr::eq(entry.record, last.record);
        for key in steps_backed(entry, model) {
            if let Some(step) = steps.iter_mut().find(|s| s.key == key) {
                let state = if is_last && entry.record.data.in_progress {
                    "current"
                } else {
                    "done"
                };
                state.clone_into(&mut step.state);
                step.sitting = entry.record.data.sitting;
                step.on = entry
                    .record
                    .data
                    .sitting
                    .is_none()
                    .then_some(entry.record.on);
            }
        }
    }
    steps
}

fn headline<'a>(current: &[&'a Entry<'a>]) -> Option<&'a Entry<'a>> {
    current
        .iter()
        .find(|e| e.surface.is_none() && e.finding != Finding::Sound)
        .or_else(|| {
            SURFACE_HEADLINE
                .iter()
                .find_map(|f| current.iter().find(|e| e.finding == *f))
        })
        .copied()
}

fn depth_rank(depth: &str) -> usize {
    CariesDepth::ALL
        .iter()
        .position(|d| d.as_str() == depth)
        .unwrap_or(0)
}

struct Built {
    tooth: MouthTooth,
    charted: bool,
    active: bool,
}

#[expect(
    clippy::too_many_lines,
    reason = "one pass per tooth over its recorded facts"
)]
fn build_tooth(input: &MouthInput, all: &[Entry<'_>], tooth: Tooth) -> Built {
    let number = tooth.number();
    let history: Vec<&Entry<'_>> = all.iter().filter(|e| e.tooth == tooth).collect();
    let mut current: Vec<&Entry<'_>> = history
        .iter()
        .copied()
        .filter(|e| e.record.current)
        .collect();
    current.sort_by_key(|e| {
        e.surface.map_or(0, |s| {
            1 + Surface::ALL.iter().position(|x| *x == s).unwrap_or(0)
        })
    });
    let status = input.statuses.iter().find(|s| s.data.tooth == number);
    let condition = input.conditions.iter().find(|c| c.data.tooth == number);
    let eruption = input.eruptions.iter().find(|e| e.data.tooth == number);

    let head = headline(&current);
    let finding = head.map(|e| e.finding);
    let missing = finding == Some(Finding::Missing);
    let surfaces = match finding {
        Some(f @ (Finding::Caries | Finding::Filled)) => current
            .iter()
            .filter(|e| e.finding == f)
            .filter_map(|e| e.surface.map(|s| s.as_str().to_owned()))
            .collect(),
        _ => Vec::new(),
    };
    let material = head.and_then(|e| {
        appearance(e.record.data.material.as_deref(), e.finding.as_str())
            .filter(|_| e.finding.is_work())
    });

    let mut work: Vec<MouthWork> = Vec::new();
    for entry in current
        .iter()
        .filter(|e| e.finding.is_work() && !e.record.data.in_progress)
    {
        let origin = entry.origin();
        let item = MouthWork {
            finding: entry.finding.as_str().to_owned(),
            material: appearance(
                entry.record.data.material.as_deref(),
                entry.finding.as_str(),
            ),
            origin: origin.to_owned(),
            done_on: (origin == "here").then_some(entry.record.on),
            today: origin == "here" && entry.record.today,
        };
        if !work.contains(&item) {
            work.push(item);
        }
    }
    let last_on = |f: Finding| {
        current
            .iter()
            .filter(|e| e.finding == f)
            .map(|e| e.record.on)
            .max()
    };
    let (problems, problems_on): (Vec<String>, Vec<Date>) = PROBLEMS
        .iter()
        .filter_map(|f| Some((f.as_str().to_owned(), last_on(*f)?)))
        .unzip();

    let mut details = MouthDetails {
        caries_depth: current
            .iter()
            .filter(|e| e.finding == Finding::Caries)
            .filter_map(|e| e.record.data.caries_depth.clone())
            .max_by_key(|d| depth_rank(d)),
        ..MouthDetails::default()
    };
    if let Some(condition) = condition {
        // DT3: infection, mobility and pocket are hidden on a missing tooth.
        let shown = !missing;
        details.infection = condition.data.infection.clone().filter(|_| shown);
        details.bleeding = condition.data.bleeding;
        details.pocket_mm = condition.data.pocket_mm.filter(|_| shown);
        details.mobility = condition.data.mobility.filter(|_| shown);
        let any = details.infection.is_some()
            || details.bleeding.is_some()
            || details.pocket_mm.is_some()
            || details.mobility.is_some();
        details.condition_on = any.then_some(condition.on);
    }
    if let Some(eruption) = eruption {
        details.eruption = Some(eruption.data.eruption.clone());
        details.angulation.clone_from(&eruption.data.angulation);
    }

    // Treatments: in progress or done here (current entries), done today (procedures), planned.
    let mut treatments: Vec<MouthTreatment> = Vec::new();
    let mut sitting = None;
    for entry in current.iter().filter(|e| e.done_here()) {
        let Some(model) = entry.model() else { continue };
        let state = if entry.record.data.in_progress {
            sitting = sitting.or(entry.record.data.sitting);
            "in_progress"
        } else {
            "done"
        };
        if treatments.iter().any(|t| t.model == model) {
            continue;
        }
        let steps = resolved_steps(&history, entry, &model);
        treatments.extend(treatment(&model, state, steps));
    }
    let on_tooth = |p: &&ProcedureRecord| p.tooth == Some(number);
    for done in input.done_today.iter().filter(on_tooth) {
        let Some(model) = model_of_record(done, tooth) else {
            continue;
        };
        if treatments.iter().any(|t| t.model == model) {
            continue;
        }
        let Some(stage) = stages().and_then(|s| s.models.get(&model)) else {
            continue;
        };
        let mut steps = usual_steps(stage);
        for step in &mut steps {
            if stage.record_map.done_steps.contains(&step.key) {
                "done".clone_into(&mut step.state);
                step.on = Some(input.visit_on);
            }
        }
        treatments.extend(treatment(&model, "done", steps));
    }
    let planned_here: Vec<&ProcedureRecord> = input.planned.iter().filter(on_tooth).collect();
    let recommended_here: Vec<&ProcedureRecord> =
        input.recommended.iter().filter(on_tooth).collect();
    let plans = planned_here
        .iter()
        .map(|p| (*p, false))
        .chain(recommended_here.iter().map(|p| (*p, true)));
    for (plan, recommended) in plans {
        let Some(model) = model_of_record(plan, tooth) else {
            continue;
        };
        let duplicate = treatments
            .iter()
            .any(|t| t.model == model && t.state != "done");
        if duplicate {
            continue;
        }
        if let Some(stage) = stages().and_then(|s| s.models.get(&model)) {
            treatments.extend(
                treatment(&model, "planned", usual_steps(stage))
                    .map(|t| MouthTreatment { recommended, ..t }),
            );
        }
    }

    let in_progress_today = current
        .iter()
        .any(|e| e.record.today && e.record.data.in_progress);
    let treated_today = history.iter().any(|e| {
        e.record.today
            && e.here()
            && e.record.data.procedure.is_some()
            && !e.record.data.in_progress
    }) || input.done_today.iter().any(|p| p.tooth == Some(number));
    let found_today = history.iter().any(|e| {
        e.record.today && e.record.data.procedure.is_none() && FOUND_TODAY.contains(&e.finding)
    }) || status.is_some_and(|s| s.today)
        || condition.is_some_and(|c| c.today)
        || eruption.is_some_and(|e| e.today);
    let today = if in_progress_today {
        Some("in_progress")
    } else if treated_today {
        Some("treated")
    } else if found_today {
        Some("found")
    } else {
        None
    };

    let health = status.map(|s| s.data.health.clone());
    let active = problems.iter().any(|p| p != "missing")
        || health.as_deref().is_some_and(|h| h != "healthy")
        || treatments.iter().any(|t| t.state == "in_progress");
    let present_by_eruption =
        eruption.is_some_and(|e| e.data.eruption == "erupted" || e.data.eruption == "partial");
    let charted =
        !current.is_empty() || status.is_some() || condition.is_some() || present_by_eruption;
    Built {
        tooth: MouthTooth {
            tooth: number,
            finding: finding
                .filter(|f| *f != Finding::Sound)
                .map(|f| f.as_str().to_owned()),
            finding_on: finding.filter(|f| *f != Finding::Sound).and_then(last_on),
            surfaces,
            material,
            health,
            treat_within_months: status.and_then(|s| s.data.treat_within_months),
            today: today.map(str::to_owned),
            planned: !planned_here.is_empty(),
            recommended: !recommended_here.is_empty(),
            recommended_on: recommended_here.iter().filter_map(|p| p.on).max(),
            sitting,
            work,
            problems,
            problems_on,
            details: (!details.is_empty()).then_some(details),
            treatments,
        },
        charted,
        active,
    }
}

impl MouthTooth {
    fn listed(&self) -> bool {
        self.finding.is_some()
            || self.health.is_some()
            || self.today.is_some()
            || self.planned
            || self.recommended
            || self.details.is_some()
            || !self.work.is_empty()
            || !self.treatments.is_empty()
    }
}

/// `adult`, `child` or `mixed`, from the charted teeth and the age (section 1.3, DF3: any
/// charted permanent tooth rules out `child`).
#[must_use]
pub fn dentition(charted: &BTreeSet<u8>, age: Option<u8>) -> &'static str {
    let permanent = charted.iter().any(|t| *t < 50);
    let primary = charted.iter().any(|t| *t > 50);
    let school = age.is_some_and(|a| (6..=12).contains(&a));
    let young = age.is_some_and(|a| a < 13);
    let toddler = age.is_some_and(|a| a < 6);
    if permanent {
        if primary || young { "mixed" } else { "adult" }
    } else if school {
        "mixed"
    } else if primary || toddler {
        "child"
    } else {
        "adult"
    }
}

fn position(quadrant: u8, index: u8, built: &BTreeMap<u8, Built>) -> Position {
    let tooth = quadrant * 10 + index;
    let shown = match built.get(&tooth) {
        Some(b) if b.tooth.listed() => "tooth",
        _ => "sound",
    };
    Position {
        quadrant,
        index,
        tooth,
        shown: shown.to_owned(),
        other: None,
    }
}

fn headline_of(built: &Built) -> String {
    built
        .tooth
        .finding
        .clone()
        .unwrap_or_else(|| "sound".to_owned())
}

/// A mixed position 1 to 5: the permanent tooth when charted, else its primary predecessor;
/// both charted → the present one, or the one with an active problem (DF1); neither →
/// `not_recorded` (DF2). For an adult (age 13 or over, or not known) a position with neither
/// charted is the permanent tooth, as in the adult layout: an adult never shows a milk-tooth
/// number that nobody charted.
fn mixed_front(quadrant: u8, index: u8, built: &BTreeMap<u8, Built>, adult: bool) -> Position {
    let permanent = quadrant * 10 + index;
    let primary = (quadrant + 4) * 10 + index;
    let charted = |t: u8| built.get(&t).filter(|b| b.charted);
    let (drawn, other) = match (charted(permanent), charted(primary)) {
        (Some(p), Some(m)) => {
            let missing = |b: &Built| b.tooth.finding.as_deref() == Some("missing");
            let primary_first = missing(p) && !missing(m) || (!missing(m) && m.active && !p.active);
            if primary_first {
                (primary, Some((permanent, p)))
            } else {
                (permanent, Some((primary, m)))
            }
        }
        (Some(_), None) => (permanent, None),
        (None, Some(_)) => (primary, None),
        (None, None) if adult => return position(quadrant, index, built),
        (None, None) => {
            return Position {
                quadrant: quadrant + 4,
                index,
                tooth: primary,
                shown: "not_recorded".to_owned(),
                other: None,
            };
        }
    };
    let mut drawn_position = position(drawn / 10, index, built);
    drawn_position.other = other.map(|(tooth, b)| OtherTooth {
        tooth,
        finding: headline_of(b),
    });
    drawn_position
}

fn positions(dentition: &str, built: &BTreeMap<u8, Built>, adult: bool) -> Vec<Position> {
    let mut out = Vec::new();
    match dentition {
        "child" => {
            for quadrant in 5..=8 {
                for index in 1..=5 {
                    out.push(position(quadrant, index, built));
                }
            }
        }
        "mixed" => {
            for quadrant in 1..=4 {
                for index in 1..=5 {
                    out.push(mixed_front(quadrant, index, built, adult));
                }
                for index in 6..=8 {
                    let tooth = quadrant * 10 + index;
                    let charted = adult || built.get(&tooth).is_some_and(|b| b.charted);
                    if index == 8 && !charted {
                        continue;
                    }
                    let mut drawn = position(quadrant, index, built);
                    if !charted {
                        "not_recorded".clone_into(&mut drawn.shown);
                    }
                    out.push(drawn);
                }
            }
        }
        _ => {
            for quadrant in 1..=4 {
                for index in 1..=8 {
                    out.push(position(quadrant, index, built));
                }
            }
        }
    }
    out
}

/// Builds the snapshot from recorded facts.
#[must_use]
pub fn snapshot(input: &MouthInput) -> MouthSnapshot {
    let all = entries(input);
    let mut numbers: BTreeSet<u8> = all.iter().map(|e| e.tooth.number()).collect();
    numbers.extend(input.statuses.iter().map(|s| s.data.tooth));
    numbers.extend(input.conditions.iter().map(|c| c.data.tooth));
    numbers.extend(input.eruptions.iter().map(|e| e.data.tooth));
    numbers.extend(
        input
            .planned
            .iter()
            .chain(&input.recommended)
            .chain(&input.done_today)
            .filter_map(|p| p.tooth),
    );
    let built: BTreeMap<u8, Built> = numbers
        .into_iter()
        .filter_map(|n| Tooth::new(i64::from(n)).ok())
        .map(|tooth| (tooth.number(), build_tooth(input, &all, tooth)))
        .collect();
    let charted: BTreeSet<u8> = built
        .iter()
        .filter(|(_, b)| b.charted)
        .map(|(n, _)| *n)
        .collect();
    let dentition = dentition(&charted, input.age);
    // A retained milk tooth makes an adult's layout mixed; the rest of the mouth stays adult.
    let adult = input.age.is_none_or(|a| a >= 13);
    let positions = positions(dentition, &built, adult);
    let mut teeth: Vec<MouthTooth> = built
        .into_values()
        .map(|b| b.tooth)
        .filter(MouthTooth::listed)
        .collect();

    // `next` only when exactly one treatment is in progress across the mouth (M-C).
    let in_progress: Vec<(usize, usize)> = teeth
        .iter()
        .enumerate()
        .flat_map(|(i, t)| {
            t.treatments
                .iter()
                .enumerate()
                .filter(|(_, tr)| tr.state == "in_progress")
                .map(move |(j, _)| (i, j))
        })
        .collect();
    if let (Some(next), [(i, j)]) = (input.next_visit, in_progress.as_slice())
        && let Some(treatment) = teeth.get_mut(*i).and_then(|t| t.treatments.get_mut(*j))
        && let Some(current) = treatment.steps.iter().position(|s| s.state == "current")
        && let Some(step) = treatment.steps[current + 1..]
            .iter_mut()
            .find(|s| s.state == "usual")
    {
        "next".clone_into(&mut step.state);
        step.on = Some(next);
    }

    let mut focus: Vec<u8> = Vec::new();
    let mut add = |pick: &dyn Fn(&MouthTooth) -> bool| {
        for tooth in teeth.iter().filter(|t| pick(t)) {
            if focus.len() < MAX_FOCUS && !focus.contains(&tooth.tooth) {
                focus.push(tooth.tooth);
            }
        }
    };
    add(&|t| matches!(t.today.as_deref(), Some("treated" | "in_progress")));
    add(&|t| t.planned && t.health.as_deref() == Some("needs_treatment"));
    add(&|t| t.today.as_deref() == Some("found"));

    MouthSnapshot {
        story_version: STORY_VERSION,
        dentition: dentition.to_owned(),
        positions,
        teeth: std::mem::take(&mut teeth),
        focus,
        next_visit: input.next_visit,
    }
}

#[cfg(test)]
#[path = "mouth_tests.rs"]
mod tests;
