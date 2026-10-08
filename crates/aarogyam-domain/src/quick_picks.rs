//! Quick picks: one-tap entries for the desk and the doctor (allergies at a walk-in, complaints
//! and findings for the note, procedures, advice lines and medicine sets). They are specialty
//! data in `specialties/dental/quick-picks.json` (AGENTS.md rule 11), compiled in like the dental
//! vocabulary and checked by the tests below.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// The dental quick picks, compiled in.
const SOURCE: &str = include_str!("../../../specialties/dental/quick-picks.json");

/// Longest label.
pub const LABEL_MAX: usize = 80;
/// Longest text a pick writes.
pub const TEXT_MAX: usize = 300;

/// A pick that is only a name (an allergy, a procedure).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pick {
    /// Stable id, `lower_snake_case`.
    pub id: String,
    /// What staff read and what is recorded.
    pub label: String,
}

/// A pick that writes a line of text (a complaint, a finding, an advice line).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextPick {
    /// Stable id, `lower_snake_case`.
    pub id: String,
    /// The chip's label.
    pub label: String,
    /// The line it writes.
    pub text: String,
}

/// One medicine of a set, as a prescription line starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetMedicine {
    /// Generic name, matched to the medicine list when the set is added.
    pub drug_name: String,
    /// Strength, such as `500 mg`.
    pub strength: String,
    /// Form, such as `tablet`.
    pub form: String,
    /// Dose, such as `1 tablet`.
    pub dose: String,
    /// Frequency, such as `1-0-1`.
    pub frequency: String,
    /// When to take it: a dose timing such as `after_food`.
    #[serde(default)]
    pub timing: Option<String>,
    /// For how many days.
    #[serde(default)]
    pub duration_days: Option<u16>,
    /// Extra instructions.
    #[serde(default)]
    pub instructions: Option<String>,
}

/// Several medicines added to a prescription in one tap, each still editable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MedicineSet {
    /// Stable id, `lower_snake_case`.
    pub id: String,
    /// The chip's label, such as `Post-extraction`.
    pub label: String,
    /// The medicines, in prescription order.
    pub items: Vec<SetMedicine>,
}

/// A specialty's quick picks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuickPicks {
    /// Common allergy substances.
    pub allergies: Vec<Pick>,
    /// Chief complaints: each writes the note's opening line.
    pub complaints: Vec<TextPick>,
    /// Examination findings.
    pub findings: Vec<TextPick>,
    /// Procedures done in a visit.
    pub procedures: Vec<Pick>,
    /// Advice lines for the prescription.
    pub advice: Vec<TextPick>,
    /// Medicine sets.
    pub medicine_sets: Vec<MedicineSet>,
}

fn parse(source: &str) -> Result<QuickPicks, serde_json::Error> {
    serde_json::from_str(source)
}

/// The dental quick picks. A unit test proves the file parses and is valid, so the empty
/// fallback never happens in a built binary.
pub fn dental() -> &'static QuickPicks {
    static PICKS: OnceLock<QuickPicks> = OnceLock::new();
    PICKS.get_or_init(|| {
        parse(SOURCE).unwrap_or(QuickPicks {
            allergies: Vec::new(),
            complaints: Vec::new(),
            findings: Vec::new(),
            procedures: Vec::new(),
            advice: Vec::new(),
            medicine_sets: Vec::new(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical::clinical_text;
    use crate::prescription::DoseTiming;

    fn check_ids<'a>(list: &str, ids: impl Iterator<Item = &'a str>) {
        let ids: Vec<&str> = ids.collect();
        assert!(!ids.is_empty(), "{list} is empty");
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), ids.len(), "{list} ids repeat");
        for id in ids {
            assert!(
                !id.is_empty()
                    && id.len() <= 40
                    && id.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                "{list}: {id}"
            );
        }
    }

    fn check_text(what: &str, text: &str, max: usize) {
        assert!(clinical_text(text, 1, max).is_ok(), "{what}: {text}");
        assert_eq!(text, text.trim(), "{what}: {text}");
    }

    #[test]
    fn the_dental_quick_picks_parse_and_are_valid() {
        let picks = parse(SOURCE).unwrap();
        assert_eq!(dental(), &picks);
        for (list, items) in [
            ("allergies", &picks.allergies),
            ("procedures", &picks.procedures),
        ] {
            check_ids(list, items.iter().map(|p| p.id.as_str()));
            for pick in items {
                check_text(list, &pick.label, LABEL_MAX);
            }
        }
        for (list, items) in [
            ("complaints", &picks.complaints),
            ("findings", &picks.findings),
            ("advice", &picks.advice),
        ] {
            check_ids(list, items.iter().map(|p| p.id.as_str()));
            for pick in items {
                check_text(list, &pick.label, LABEL_MAX);
                check_text(list, &pick.text, TEXT_MAX);
            }
        }
        check_ids(
            "medicine_sets",
            picks.medicine_sets.iter().map(|s| s.id.as_str()),
        );
        for set in &picks.medicine_sets {
            check_text("medicine set", &set.label, LABEL_MAX);
            assert!(!set.items.is_empty(), "{} has no medicines", set.id);
            for item in &set.items {
                for (field, text) in [
                    ("drug_name", &item.drug_name),
                    ("strength", &item.strength),
                    ("form", &item.form),
                    ("dose", &item.dose),
                    ("frequency", &item.frequency),
                ] {
                    check_text(field, text, LABEL_MAX);
                }
                if let Some(timing) = &item.timing {
                    assert!(DoseTiming::parse(timing).is_ok(), "{}: {timing}", set.id);
                }
                assert!(
                    item.duration_days
                        .is_none_or(|days| (1..=365).contains(&days)),
                    "{}",
                    set.id
                );
                if let Some(text) = &item.instructions {
                    check_text("instructions", text, TEXT_MAX);
                }
            }
        }
    }

    #[test]
    fn allergy_names_are_ones_the_prescription_check_understands() {
        // "NSAID" and "Local anaesthetic" imply whole classes; the rest match by name or class.
        let labels: Vec<&str> = dental()
            .allergies
            .iter()
            .map(|p| p.label.as_str())
            .collect();
        for expected in ["Penicillin", "NSAID", "Local anaesthetic", "Aspirin"] {
            assert!(labels.contains(&expected), "{expected}");
        }
    }
}
