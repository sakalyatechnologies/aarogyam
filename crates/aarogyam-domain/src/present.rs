//! The studio layer of Show patient (docs/plans/present-studio-design.md, sections 5.1 and 8.3): the
//! usual options compared for the situations a patient's recorded snapshot shows. One pure builder.
//! Situations come from recorded snapshot fields only; options and outcome words come from the
//! specialty data in `specialties/dental/present/` (AGENTS.md rule 11). Slice 2a: no prices.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::mouth::{MouthSnapshot, MouthTooth};

const OPTIONS: &str = include_str!("../../../specialties/dental/present/options.json");
const OUTCOMES: &str = include_str!("../../../specialties/dental/present/outcomes.json");
const MATERIALS: &str = include_str!("../../../specialties/dental/present/materials.json");

const CASE_IMPLANT: &str = include_str!("../../../specialties/dental/present/cases/implant.json");
const CASE_WISDOM: &str = include_str!("../../../specialties/dental/present/cases/wisdom.json");

/// A range of whole numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    /// Fewest.
    pub min: u8,
    /// Most.
    pub max: u8,
}

/// How long an option takes to finish.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finish {
    /// Shortest.
    pub min: u8,
    /// Longest.
    pub max: u8,
    /// `days`, `weeks` or `months`.
    pub unit: String,
}

/// A procedure (and material) a price is later mapped from (slice 2b). Never served in 2a.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PricePart {
    /// A seeded `vocabulary.json` procedure id.
    pub procedure: String,
    /// A seeded material id.
    #[serde(default)]
    pub material: Option<String>,
}

/// One option as the data file writes it.
#[derive(Debug, Clone, Deserialize)]
pub struct OptionDef {
    /// Stable key.
    pub key: String,
    /// Short name.
    pub label: String,
    /// What is done.
    pub summary: String,
    /// How it looks afterwards, in words.
    pub looks_like: String,
    /// Usual visits.
    pub visits: Range,
    /// Usual time to finish; absent when nothing is done.
    #[serde(default)]
    pub finish: Option<Finish>,
    /// An art key from `art-map.json`.
    pub look: String,
    /// A key into `outcomes.json`.
    #[serde(default)]
    pub outcome: Option<String>,
    /// A key into the `comfort` words.
    pub comfort: String,
    /// Procedures to price (slice 2b).
    pub price_parts: Vec<PricePart>,
}

/// A situation's options as the data file writes them.
#[derive(Debug, Clone, Deserialize)]
pub struct SituationDef {
    /// Words for the situation.
    pub title: String,
    /// Its usual options.
    pub options: Vec<OptionDef>,
}

/// `specialties/dental/present/options.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct Options {
    /// Comfort key to words.
    pub comfort: BTreeMap<String, String>,
    /// Situation key to its options.
    pub situations: BTreeMap<String, SituationDef>,
}

/// One outcome as the data file writes it; an empty entry is hidden.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct OutcomeDef {
    /// What the patient reads.
    #[serde(default)]
    pub words: Option<String>,
    /// Why we say it.
    #[serde(default)]
    pub why: Option<String>,
    /// The longest follow-up the source reports, in years.
    #[serde(default)]
    pub follow_up_years: Option<u8>,
    /// The paper.
    #[serde(default)]
    pub source: Option<String>,
    /// The exact sentence the number comes from.
    #[serde(default)]
    pub source_quote: Option<String>,
}

/// `specialties/dental/present/outcomes.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct Outcomes {
    /// Outcome key to its words.
    pub outcomes: BTreeMap<String, OutcomeDef>,
}

/// One material as the data file writes it (slice 2c; the web reads the same file for the illustration).
#[derive(Debug, Clone, Deserialize)]
pub struct MaterialDef {
    /// A seeded `vocabulary.json` material id.
    pub key: String,
    /// Short name.
    pub label: String,
    /// What it is.
    pub summary: String,
    /// How it looks.
    pub looks_like: String,
    /// Illustration only: `paint` (a material look), `translucency`, `opacity`, `metal`, `margin_line`.
    pub look: BTreeMap<String, serde_json::Value>,
    /// A key into `outcomes.json`; none means no usual figure.
    #[serde(default)]
    pub outcome: Option<String>,
    /// Relative cost, 1 to 4 (a clinic may edit it); never a price.
    pub cost_tier: u8,
    /// Empty unless the clinic fills it.
    #[serde(default)]
    pub strength: String,
    /// Empty unless the clinic fills it.
    #[serde(default)]
    pub best_for: String,
}

/// A group of materials compared on one tooth.
#[derive(Debug, Clone, Deserialize)]
pub struct MaterialGroup {
    /// Heading, such as "Choose your cap".
    pub title: String,
    /// One plain sentence under the heading.
    pub intro: String,
    /// The overlay the illustration draws (`crown`, `implant`, `filled`).
    pub overlay: String,
    /// The materials compared.
    pub materials: Vec<MaterialDef>,
}

/// `specialties/dental/present/materials.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct Materials {
    /// Group key to its materials.
    pub groups: BTreeMap<String, MaterialGroup>,
}

fn parse<T: serde::de::DeserializeOwned>(source: &str) -> Option<T> {
    serde_json::from_str(source).ok()
}

/// The options data, compiled in. `None` only if the file is broken (a test fails first).
pub fn options() -> Option<&'static Options> {
    static CELL: OnceLock<Option<Options>> = OnceLock::new();
    CELL.get_or_init(|| parse(OPTIONS)).as_ref()
}

/// The outcome words, compiled in.
pub fn outcomes() -> Option<&'static Outcomes> {
    static CELL: OnceLock<Option<Outcomes>> = OnceLock::new();
    CELL.get_or_init(|| parse(OUTCOMES)).as_ref()
}

/// One step of a usual case.
#[derive(Debug, Clone, Deserialize)]
pub struct CaseStep {
    /// Stable key.
    pub key: String,
    /// Short name.
    pub label: String,
    /// What happens, in words.
    pub words: String,
    /// An art key from `art-map.json`.
    pub art: String,
    /// A typical time for the step.
    #[serde(default)]
    pub usual: Option<Finish>,
}

/// A usual case (`specialties/dental/present/cases/*.json`): general guidance, never about one patient.
#[derive(Debug, Clone, Deserialize)]
pub struct Case {
    /// Stable key.
    pub key: String,
    /// Heading.
    pub title: String,
    /// One line before the steps.
    pub lead: String,
    /// The steps in order.
    pub steps: Vec<CaseStep>,
}

/// A usual case by key (`implant`, `wisdom`), compiled in.
pub fn usual_case(key: &str) -> Option<&'static Case> {
    static IMPLANT: OnceLock<Option<Case>> = OnceLock::new();
    static WISDOM: OnceLock<Option<Case>> = OnceLock::new();
    match key {
        "implant" => IMPLANT.get_or_init(|| parse(CASE_IMPLANT)).as_ref(),
        "wisdom" => WISDOM.get_or_init(|| parse(CASE_WISDOM)).as_ref(),
        _ => None,
    }
}

/// The implant case, compiled in.
#[must_use]
pub fn implant_case() -> Option<&'static Case> {
    usual_case("implant")
}

/// The materials data, compiled in.
pub fn materials() -> Option<&'static Materials> {
    static CELL: OnceLock<Option<Materials>> = OnceLock::new();
    CELL.get_or_init(|| parse(MATERIALS)).as_ref()
}

/// How long an option usually lasts, in the words of `outcomes.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lifespan {
    /// What the patient reads.
    pub words: String,
    /// Why we say it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// The paper, when the words carry a number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// The exact sentence the number comes from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_quote: Option<String>,
}

/// One usual option, as served.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OptionCard {
    /// Stable key.
    pub key: String,
    /// Short name.
    pub label: String,
    /// What is done.
    pub summary: String,
    /// How it looks afterwards.
    pub looks_like: String,
    /// Usual visits.
    pub visits: Range,
    /// Usual time to finish.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish: Option<Finish>,
    /// An art key (an illustration).
    pub look: String,
    /// Typical lifespan words; absent unless `outcomes.json` has some.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifespan: Option<Lifespan>,
    /// How it feels, in words.
    pub comfort: String,
}

/// A recorded situation on one tooth with its usual options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Situation {
    /// `deep_decay`, `missing` or `impacted_wisdom`.
    pub key: String,
    /// FDI tooth.
    pub tooth: u8,
    /// Words for the situation.
    pub title: String,
    /// The usual options.
    pub options: Vec<OptionCard>,
}

/// The studio layer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentStudio {
    /// Recorded situations, by tooth.
    pub situations: Vec<Situation>,
}

fn is_permanent(tooth: u8) -> bool {
    (11..=48).contains(&tooth) && (1..=8).contains(&(tooth % 10))
}

/// The situation keys a tooth's recorded fields show.
fn situations_of(t: &MouthTooth) -> Vec<&'static str> {
    let mut keys = Vec::new();
    let details = t.details.as_ref();
    let caries = t.problems.iter().any(|p| p == "caries");
    let near_pulp = details.is_some_and(|d| d.caries_depth.as_deref() == Some("near_pulp"));
    let infection = details.is_some_and(|d| d.infection.is_some());
    if (caries && near_pulp) || infection {
        keys.push("deep_decay");
    }
    if is_permanent(t.tooth) && t.tooth % 10 != 8 && t.finding.as_deref() == Some("missing") {
        keys.push("missing");
    }
    let eruption = details.and_then(|d| d.eruption.as_deref());
    if is_permanent(t.tooth)
        && t.tooth % 10 == 8
        && matches!(eruption, Some("impacted" | "partial" | "unerupted"))
    {
        keys.push("impacted_wisdom");
    }
    keys
}

fn card(def: &OptionDef, options: &Options, outcomes: &Outcomes) -> OptionCard {
    let lifespan = def
        .outcome
        .as_ref()
        .and_then(|key| outcomes.outcomes.get(key))
        .and_then(|o| {
            let words = o.words.clone()?;
            let cited = o.source.is_some() && o.source_quote.is_some();
            Some(Lifespan {
                words,
                why: o.why.clone(),
                source: if cited { o.source.clone() } else { None },
                source_quote: if cited { o.source_quote.clone() } else { None },
            })
        });
    OptionCard {
        key: def.key.clone(),
        label: def.label.clone(),
        summary: def.summary.clone(),
        looks_like: def.looks_like.clone(),
        visits: def.visits,
        finish: def.finish.clone(),
        look: def.look.clone(),
        lifespan,
        comfort: options
            .comfort
            .get(&def.comfort)
            .cloned()
            .unwrap_or_default(),
    }
}

/// Builds the studio layer from the recorded snapshot. Pure: no fact is added or inferred.
#[must_use]
pub fn build(snapshot: &MouthSnapshot) -> PresentStudio {
    let (Some(options), Some(outcomes)) = (options(), outcomes()) else {
        return PresentStudio::default();
    };
    let mut teeth: Vec<&MouthTooth> = snapshot.teeth.iter().collect();
    teeth.sort_by_key(|t| t.tooth);
    let situations = teeth
        .into_iter()
        .flat_map(|t| {
            situations_of(t).into_iter().filter_map(move |key| {
                let def = options.situations.get(key)?;
                Some(Situation {
                    key: key.to_owned(),
                    tooth: t.tooth,
                    title: def.title.clone(),
                    options: def
                        .options
                        .iter()
                        .map(|o| card(o, options, outcomes))
                        .collect(),
                })
            })
        })
        .collect();
    PresentStudio { situations }
}

#[cfg(test)]
#[path = "present_tests.rs"]
mod tests;
