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

/// Salt and ester words that name the same medicine (dropped from medicine names only, never
/// from a recorded allergy): "Diclofenac sodium" is diclofenac,
/// "Ketorolac tromethamine" is ketorolac.
const SALTS: &[&str] = &[
    "sodium",
    "potassium",
    "calcium",
    "magnesium",
    "hydrochloride",
    "hcl",
    "hydrobromide",
    "tromethamine",
    "gluconate",
    "digluconate",
    "axetil",
    "proxetil",
    "maleate",
    "acetonide",
    "trihydrate",
    "monohydrate",
    "sulphate",
    "sulfate",
    "phosphate",
    "succinate",
    "citrate",
    "besylate",
    "mesylate",
    "acid",
];

/// Lower case, letters and digits only, words single-spaced, plurals made singular, and common
/// names and Indian spellings mapped to the catalogue's.
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
                "amoxycillin" => "amoxicillin",
                "frusemide" => "furosemide",
                "clavulanate" => "clavulanic",
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

/// One catalogue row as the allergy check needs it: names to match a typed line against, and
/// the row's classes.
#[derive(Debug, Clone, Copy)]
pub struct CatalogNames<'a> {
    /// Generic name, such as `Amoxicillin + Clavulanic acid`.
    pub generic_name: &'a str,
    /// Brand aliases, comma separated, such as `Augmentin 625 Duo, Clavam 625`.
    pub brand_name: Option<&'a str>,
    /// Its classes, such as `penicillin`.
    pub allergy_classes: &'a [String],
}

/// Words on a typed line or a brand alias that are not part of a medicine's name: forms,
/// units, release types and brand modifiers ("cap", "mg", "DT", "Duo", "CV", "Forte").
const NOT_NAME: &[&str] = &[
    "tab",
    "tablet",
    "cap",
    "capsule",
    "syp",
    "syrup",
    "susp",
    "suspension",
    "drop",
    "gel",
    "paste",
    "cream",
    "ointment",
    "mouthwash",
    "gargle",
    "lozenge",
    "troche",
    "spray",
    "jelly",
    "solution",
    "inj",
    "injection",
    "oral",
    "mouth",
    "paint",
    "dry",
    "mg",
    "ml",
    "mcg",
    "g",
    "gm",
    "iu",
    "au",
    "dt",
    "sr",
    "cr",
    "er",
    "xr",
    "od",
    "mr",
    "sp",
    "ds",
    "dds",
    "duo",
    "forte",
    "plus",
    "p",
    "cv",
    "kid",
    "kidtab",
    "ip",
    "bp",
    "usp",
    "dispersible",
    "chewable",
    "paediatric",
    "pediatric",
];

/// The name words of one ingredient or alias: normalised, without numbers or [`NOT_NAME`]
/// words. "Amoxycillin 500 mg cap" gives `amoxicillin`; "Augmentin 625 Duo" gives `augmentin`.
fn name_words(text: &str) -> Vec<String> {
    normalise(text)
        .split_whitespace()
        .filter(|word| {
            !NOT_NAME.contains(word)
                && !SALTS.contains(word)
                && !word.chars().any(|c| c.is_ascii_digit())
        })
        .map(str::to_owned)
        .collect()
}

/// The ingredients of a medicine name, sorted: "Amoxicillin + Clavulanic acid" gives
/// `["amoxicillin", "clavulanic"]`.
fn ingredients(name: &str) -> Vec<String> {
    let mut parts: Vec<String> = name
        .split('+')
        .map(|part| name_words(part).join(" "))
        .filter(|part| !part.is_empty())
        .collect();
    parts.sort();
    parts.dedup();
    parts
}

/// The allergy classes for a line that names no catalogue row (typed, or from a medicine set).
/// Precise both ways, because any alert stops issuing until the doctor gives a reason:
/// - rows with exactly the line's ingredients, at any strength, form or salt;
/// - single-ingredient rows equal to one of the line's ingredients (so "Amoxicillin +
///   Dicloxacillin" still meets a penicillin allergy), never a combination that merely
///   contains one (plain chlorhexidine does not take the classes of a chlorhexidine +
///   lignocaine gel);
/// - rows with a brand alias whose name words begin the line ("Augmentin 625" → Augmentin 625
///   Duo), compared as whole words.
#[must_use]
pub fn classes_for_name(name: &str, catalog: &[CatalogNames<'_>]) -> Vec<String> {
    let line = ingredients(name);
    if line.is_empty() {
        return Vec::new();
    }
    let line_words = name_words(name);
    let mut classes: Vec<String> = Vec::new();
    for row in catalog {
        let row_parts = ingredients(row.generic_name);
        let by_generic =
            row_parts == line || (row_parts.len() == 1 && line.contains(&row_parts[0]));
        let by_brand = row.brand_name.is_some_and(|brands| {
            brands.split(',').any(|alias| {
                let alias = name_words(alias);
                !alias.is_empty() && line_words.starts_with(&alias)
            })
        });
        if by_generic || by_brand {
            for class in row.allergy_classes {
                if !classes.contains(class) {
                    classes.push(class.clone());
                }
            }
        }
    }
    classes
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

    fn catalog_rows() -> Vec<(String, Option<String>, Vec<String>)> {
        vec![
            (
                "Amoxicillin".into(),
                Some("Mox 500, Novamox 500".into()),
                vec!["penicillin".into(), "beta_lactam".into()],
            ),
            (
                "Amoxicillin + Clavulanic acid".into(),
                Some("Augmentin 625 Duo, Moxikind-CV 625".into()),
                vec!["penicillin".into(), "beta_lactam".into()],
            ),
            (
                "Paracetamol".into(),
                Some("Dolo 650".into()),
                vec!["paracetamol".into()],
            ),
            (
                "Aceclofenac + Paracetamol".into(),
                Some("Zerodol-P".into()),
                vec!["nsaid".into(), "paracetamol".into()],
            ),
        ]
    }

    fn classes(name: &str) -> Vec<String> {
        let rows = catalog_rows();
        let catalog: Vec<CatalogNames<'_>> = rows
            .iter()
            .map(|(generic, brand, classes)| CatalogNames {
                generic_name: generic,
                brand_name: brand.as_deref(),
                allergy_classes: classes,
            })
            .collect();
        classes_for_name(name, &catalog)
    }

    #[test]
    fn a_typed_line_takes_its_generics_classes_at_any_strength_or_form() {
        assert_eq!(
            classes("Amoxycillin 500 mg cap"),
            ["penicillin", "beta_lactam"]
        );
        assert_eq!(
            classes("AMOXICILLIN + CLAVULANIC ACID"),
            ["penicillin", "beta_lactam"]
        );
        assert_eq!(
            classes("Amoxycillin + Potassium Clavulanate 625"),
            ["penicillin", "beta_lactam"]
        );
    }

    #[test]
    fn a_brand_resolves_to_its_rows_classes() {
        assert_eq!(classes("Augmentin 625"), ["penicillin", "beta_lactam"]);
        assert_eq!(classes("ZERODOL-P"), ["nsaid", "paracetamol"]);
    }

    #[test]
    fn salts_and_modifiers_do_not_hide_a_painkiller() {
        let rows: Vec<(String, Option<String>, Vec<String>)> = vec![
            (
                "Diclofenac sodium".into(),
                Some("Voveran 50".into()),
                vec!["nsaid".into()],
            ),
            (
                "Ketorolac tromethamine".into(),
                Some("Ketorol DT".into()),
                vec!["nsaid".into()],
            ),
            (
                "Chlorhexidine gluconate".into(),
                Some("Hexidine, Rexidin".into()),
                vec!["chlorhexidine".into()],
            ),
            (
                "Chlorhexidine + Metronidazole + Lignocaine".into(),
                None,
                vec![
                    "chlorhexidine".into(),
                    "nitroimidazole".into(),
                    "amide_anaesthetic".into(),
                ],
            ),
            (
                "Pantoprazole".into(),
                Some("Pan 40, Pantocid 40".into()),
                vec!["proton_pump_inhibitor".into()],
            ),
            (
                "Paracetamol".into(),
                Some("Dolo 650".into()),
                vec!["paracetamol".into()],
            ),
        ];
        let catalog: Vec<CatalogNames<'_>> = rows
            .iter()
            .map(|(generic, brand, classes)| CatalogNames {
                generic_name: generic,
                brand_name: brand.as_deref(),
                allergy_classes: classes,
            })
            .collect();
        let of = |name: &str| classes_for_name(name, &catalog);
        assert_eq!(of("Diclofenac 50"), ["nsaid"]);
        assert_eq!(of("Ketorolac DT"), ["nsaid"]);
        assert_eq!(of("KETOROL DT"), ["nsaid"]);
        assert_eq!(of("Chlorhexidine 0.2% mouthwash"), ["chlorhexidine"]);
        assert_eq!(of("Paracetamol 650"), ["paracetamol"]);
        assert_eq!(of("DT 625"), [""; 0]);

        let nsaid = RecordedAllergy {
            substance: "NSAID".into(),
            severe: false,
        };
        let lignocaine = RecordedAllergy {
            substance: "Lignocaine".into(),
            severe: false,
        };
        let line = |name: &'static str, classes: &'static [String]| CheckedDrug {
            line_no: 1,
            name,
            classes,
        };
        let diclo = of("Diclofenac 50");
        assert_eq!(
            allergy_alerts(
                &[line("Diclofenac 50", leak(diclo))],
                std::slice::from_ref(&nsaid)
            )
            .len(),
            1
        );
        let chx = of("Chlorhexidine 0.2% mouthwash");
        assert_eq!(
            allergy_alerts(
                &[line("Chlorhexidine 0.2% mouthwash", leak(chx))],
                &[lignocaine]
            ),
            []
        );
        let para = of("Paracetamol 650");
        assert_eq!(
            allergy_alerts(&[line("Paracetamol 650", leak(para))], &[nsaid]),
            []
        );
    }

    fn leak(classes: Vec<String>) -> &'static [String] {
        Box::leak(classes.into_boxed_slice())
    }

    #[test]
    fn one_ingredient_does_not_take_a_combinations_classes() {
        assert_eq!(classes("Paracetamol 650 mg tab"), ["paracetamol"]);
        assert_eq!(classes("Vitamin B complex"), [""; 0]);
        assert_eq!(classes("500 mg"), [""; 0]);
    }
}
