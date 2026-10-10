//! Quick picks: one-tap entries for the desk and the doctor (allergies at a walk-in, complaints
//! and findings for the note, procedures, advice lines and medicine sets). They are specialty
//! data in `specialties/dental/quick-picks.json` (AGENTS.md rule 11), compiled in like the dental
//! vocabulary and checked by the tests below.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::clinical::clinical_text;
use crate::prescription::DoseTiming;

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

/// Most medicines in one set.
pub const MAX_SET_MEDICINES: usize = 20;

/// Why a clinic's medicine set was refused. Names the field, never the value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{field}: {message}")]
pub struct SetError {
    /// The field at fault, as the API names it.
    pub field: &'static str,
    /// What is wrong.
    pub message: String,
}

/// Checks and trims a clinic's medicine set: a label of 1 to 80 characters and 1 to 20 medicines
/// whose values meet the same rules as the specialty's own sets.
///
/// # Errors
/// [`SetError`] naming the first field that fails.
pub fn check_set(
    label: &str,
    items: &[SetMedicine],
) -> Result<(String, Vec<SetMedicine>), SetError> {
    let fail = |field: &'static str, error: &dyn std::fmt::Display| SetError {
        field,
        message: error.to_string(),
    };
    let label = clinical_text(label, 1, LABEL_MAX).map_err(|e| fail("label", &e))?;
    if label.contains('\n') {
        return Err(fail("label", &"must be one line"));
    }
    if items.is_empty() || items.len() > MAX_SET_MEDICINES {
        return Err(fail(
            "items",
            &format!("list 1 to {MAX_SET_MEDICINES} medicines"),
        ));
    }
    let line = |text: &str, field: &'static str| {
        clinical_text(text, 1, LABEL_MAX).map_err(|e| fail(field, &e))
    };
    let mut checked = Vec::with_capacity(items.len());
    for item in items {
        let timing = match item.timing.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(text) => Some(
                DoseTiming::parse(text)
                    .map_err(|e| fail("items.timing", &e))?
                    .as_str()
                    .to_owned(),
            ),
        };
        if item
            .duration_days
            .is_some_and(|days| !(1..=365).contains(&days))
        {
            return Err(fail("items.duration_days", &"must be 1 to 365"));
        }
        checked.push(SetMedicine {
            drug_name: line(&item.drug_name, "items.drug_name")?,
            strength: line(&item.strength, "items.strength")?,
            form: line(&item.form, "items.form")?,
            dose: line(&item.dose, "items.dose")?,
            frequency: line(&item.frequency, "items.frequency")?,
            timing,
            duration_days: item.duration_days,
            instructions: match item.instructions.as_deref().map(str::trim) {
                None | Some("") => None,
                Some(text) => Some(
                    clinical_text(text, 1, TEXT_MAX).map_err(|e| fail("items.instructions", &e))?,
                ),
            },
        });
    }
    Ok((label, checked))
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

    fn medicine(name: &str) -> SetMedicine {
        SetMedicine {
            drug_name: name.to_owned(),
            strength: "500 mg".to_owned(),
            form: "tablet".to_owned(),
            dose: "1 tablet".to_owned(),
            frequency: "1-0-1".to_owned(),
            timing: Some("after_food".to_owned()),
            duration_days: Some(3),
            instructions: None,
        }
    }

    #[test]
    fn a_clinic_set_is_checked_and_trimmed() {
        let (label, items) = check_set("  Post-op  ", &[medicine(" Amoxicillin ")]).unwrap();
        assert_eq!(label, "Post-op");
        assert_eq!(items[0].drug_name, "Amoxicillin");
        let bad = |label: &str, items: &[SetMedicine]| check_set(label, items).unwrap_err().field;
        assert_eq!(bad("", &[medicine("A")]), "label");
        assert_eq!(bad(&"x".repeat(81), &[medicine("A")]), "label");
        assert_eq!(bad("Set", &[]), "items");
        assert_eq!(
            bad("Set", &vec![medicine("A"); MAX_SET_MEDICINES + 1]),
            "items"
        );
        let mut item = medicine("A");
        item.timing = Some("whenever".to_owned());
        assert_eq!(bad("Set", &[item]), "items.timing");
        let mut item = medicine("A");
        item.duration_days = Some(400);
        assert_eq!(bad("Set", &[item]), "items.duration_days");
        let mut item = medicine("A");
        item.dose = " ".to_owned();
        assert_eq!(bad("Set", &[item]), "items.dose");
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
