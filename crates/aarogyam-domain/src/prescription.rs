//! Prescription rules: statuses, line values, and the phase 1A safety check that warns when a
//! medicine matches one of the patient's recorded allergies. The doctor always decides; an
//! alert only asks for a reason to go ahead.

text_value!(
    /// A prescription's state.
    RxStatus("status") {
        /// Being written.
        Draft => "draft",
        /// Numbered, printed and final.
        Issued => "issued",
        /// Withdrawn with a reason; a corrected copy may supersede it.
        Cancelled => "cancelled",
    }
);

text_value!(
    /// When to take a medicine.
    DoseTiming("timing") {
        /// Before food.
        BeforeFood => "before_food",
        /// After food.
        AfterFood => "after_food",
        /// On an empty stomach.
        EmptyStomach => "empty_stomach",
        /// At bedtime.
        Bedtime => "bedtime",
        /// Only when needed.
        Sos => "sos",
        /// As the doctor explains.
        AsDirected => "as_directed",
    }
);

text_value!(
    /// How serious an alert is.
    AlertSeverity("severity") {
        /// For information.
        Info => "info",
        /// Worth a second look.
        Caution => "caution",
        /// Likely harm.
        Serious => "serious",
    }
);

/// Why a prescription value was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum RxError {
    /// A required text is empty or too long.
    #[error("must be 1 to {0} characters")]
    Text(usize),
    /// The duration is outside 1 to 365 days.
    #[error("must be between 1 and 365 days")]
    Duration,
    /// Too many lines.
    #[error("at most 50 medicines")]
    TooManyLines,
    /// Nothing to issue.
    #[error("add at least one medicine")]
    NoLines,
    /// An override or cancel reason is missing or too short.
    #[error("give a reason of 3 to 500 characters")]
    Reason,
}

/// Most medicines on one prescription.
pub const MAX_LINES: usize = 50;

/// Trims `text` and checks its length in characters.
///
/// # Errors
/// [`RxError::Text`] when empty or longer than `max`.
pub fn required_text(text: &str, max: usize) -> Result<String, RxError> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > max {
        return Err(RxError::Text(max));
    }
    Ok(text.to_owned())
}

/// Trims optional text; empty means none.
///
/// # Errors
/// [`RxError::Text`] when longer than `max`.
pub fn optional_text(text: Option<&str>, max: usize) -> Result<Option<String>, RxError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) if text.chars().count() > max => Err(RxError::Text(max)),
        Some(text) => Ok(Some(text.to_owned())),
    }
}

/// A reason for an override or a cancellation, 3 to 500 characters.
///
/// # Errors
/// [`RxError::Reason`] otherwise.
pub fn reason(text: &str) -> Result<String, RxError> {
    let text = text.trim();
    let length = text.chars().count();
    if (3..=500).contains(&length) {
        Ok(text.to_owned())
    } else {
        Err(RxError::Reason)
    }
}

/// The name as printed: generic names in capitals.
#[must_use]
pub fn printed_name(name: &str) -> String {
    name.trim().to_uppercase()
}

/// An allergy recorded for the patient, as the allergy check sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedAllergy {
    /// What the patient reacts to: a medicine ("amoxicillin") or a class ("penicillin").
    pub substance: String,
    /// Whether the recorded reaction was severe.
    pub severe: bool,
}

/// A medicine on the prescription, as the allergy check sees it.
#[derive(Debug, Clone, Copy)]
pub struct CheckedDrug<'a> {
    /// The line number.
    pub line_no: u16,
    /// The medicine's (generic) name.
    pub name: &'a str,
    /// Its classes from the catalogue, such as `penicillin` and `beta_lactam`.
    pub classes: &'a [String],
}

/// A warning that a medicine matches a recorded allergy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllergyAlert {
    /// The line it concerns.
    pub line_no: u16,
    /// How serious.
    pub severity: AlertSeverity,
    /// What to tell the doctor.
    pub message: String,
}

/// Lower case, letters and digits only, words single-spaced, plurals made singular, and a
/// few common names mapped to the catalogue's.
fn normalise(text: &str) -> String {
    let cleaned: String = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    cleaned
        .split_whitespace()
        .map(|word| {
            let word = match word {
                "sulfa" | "sulpha" | "sulphonamide" => "sulfonamide",
                "lidocaine" => "lignocaine",
                "acetaminophen" => "paracetamol",
                "cephalosporins" => "cephalosporin",
                other => other,
            };
            if word.len() > 4 && word.ends_with('s') && !word.ends_with("ss") {
                &word[..word.len() - 1]
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether `phrase` appears in `text` as whole words.
fn contains_words(text: &str, phrase: &str) -> bool {
    !phrase.is_empty() && format!(" {text} ").contains(&format!(" {phrase} "))
}

/// The classes an allergy implies beyond its own name: aspirin reactions often extend to the
/// other painkillers of its kind.
fn implied_classes(substance: &str) -> &'static [&'static str] {
    match substance {
        "aspirin" => &["salicylate", "nsaid"],
        "nsaid" | "painkiller" => &["nsaid"],
        "local anaesthetic" | "local anesthetic" => &["amide anaesthetic", "ester anaesthetic"],
        _ => &[],
    }
}

/// Checks each medicine against each recorded allergy: by name ("amoxicillin" in
/// "Amoxicillin + Clavulanic acid") and by class ("penicillin" for amoxicillin).
#[must_use]
pub fn allergy_alerts(
    drugs: &[CheckedDrug<'_>],
    allergies: &[RecordedAllergy],
) -> Vec<AllergyAlert> {
    let mut alerts = Vec::new();
    for drug in drugs {
        let name = normalise(drug.name);
        let classes: Vec<String> = drug.classes.iter().map(|class| normalise(class)).collect();
        for allergy in allergies {
            let substance = normalise(&allergy.substance);
            if substance.is_empty() {
                continue;
            }
            let by_name = contains_words(&name, &substance) || contains_words(&substance, &name);
            let by_class = classes.iter().any(|class| {
                *class == substance || implied_classes(&substance).contains(&class.as_str())
            });
            if by_name || by_class {
                let severity = if allergy.severe {
                    AlertSeverity::Serious
                } else {
                    AlertSeverity::Caution
                };
                alerts.push(AllergyAlert {
                    line_no: drug.line_no,
                    severity,
                    message: format!(
                        "{} may cause a reaction: recorded allergy to {}",
                        printed_name(drug.name),
                        allergy.substance.trim()
                    ),
                });
            }
        }
    }
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allergy(substance: &str, severe: bool) -> RecordedAllergy {
        RecordedAllergy {
            substance: substance.into(),
            severe,
        }
    }

    #[test]
    fn allergies_match_by_name_and_by_class() {
        let penicillins = vec!["penicillin".to_owned(), "beta_lactam".to_owned()];
        let nsaid = vec!["nsaid".to_owned()];
        let none: Vec<String> = Vec::new();
        let drugs = [
            CheckedDrug {
                line_no: 1,
                name: "Amoxicillin + Clavulanic acid",
                classes: &penicillins,
            },
            CheckedDrug {
                line_no: 2,
                name: "Ibuprofen",
                classes: &nsaid,
            },
            CheckedDrug {
                line_no: 3,
                name: "Chlorhexidine gluconate",
                classes: &none,
            },
        ];
        let alerts = allergy_alerts(&drugs, &[allergy("Penicillins", true)]);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].line_no, 1);
        assert_eq!(alerts[0].severity, AlertSeverity::Serious);
        assert!(
            alerts[0]
                .message
                .starts_with("AMOXICILLIN + CLAVULANIC ACID")
        );

        let alerts = allergy_alerts(&drugs, &[allergy("aspirin", false)]);
        assert_eq!(alerts.iter().map(|a| a.line_no).collect::<Vec<_>>(), [2]);
        assert_eq!(alerts[0].severity, AlertSeverity::Caution);

        // A free-text line with no catalogue classes still matches by name.
        let free = [CheckedDrug {
            line_no: 4,
            name: "amoxicillin 500",
            classes: &none,
        }];
        assert_eq!(
            allergy_alerts(&free, &[allergy("Amoxicillin", false)]).len(),
            1
        );
        assert_eq!(
            allergy_alerts(&drugs, &[allergy("latex", true), allergy(" ", true)]),
            []
        );
        assert_eq!(allergy_alerts(&drugs, &[]), []);
    }

    #[test]
    fn values_are_checked() {
        assert_eq!(required_text("  1-0-1 ", 40).unwrap(), "1-0-1");
        assert_eq!(required_text(" ", 40), Err(RxError::Text(40)));
        assert_eq!(optional_text(Some(" "), 10), Ok(None));
        assert_eq!(reason("ok"), Err(RxError::Reason));
        assert_eq!(reason(" wrong dose ").unwrap(), "wrong dose");
        assert_eq!(printed_name(" Amoxicillin "), "AMOXICILLIN");
        assert_eq!(DoseTiming::parse("after_food"), Ok(DoseTiming::AfterFood));
        assert!(RxStatus::parse("void").is_err());
    }
}
