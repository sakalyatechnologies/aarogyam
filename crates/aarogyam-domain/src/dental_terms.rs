//! The dental vocabulary: what was done on a tooth or surface (a procedure) and with what (a
//! material). Seeded terms are specialty data in `specialties/dental/vocabulary.json` (AGENTS.md
//! rule 11); a clinic adds its own, stored in `dental_terms` with UUID ids. Chart entries store
//! term ids, never free text, so reports and exports stay consistent.

use std::fmt;
use std::sync::OnceLock;

use uuid::Uuid;

use crate::clinical::{ClinicalError, clinical_text, text_enum};
use crate::ids::DentalTermId;

/// The seeded vocabulary, compiled in.
const SOURCE: &str = include_str!("../../../specialties/dental/vocabulary.json");

/// Longest term label.
pub const LABEL_MAX: usize = 80;

text_enum!(
    /// Which list a term belongs to.
    TermKind {
        /// What was done: filling, crown, root canal.
        Procedure => "procedure",
        /// What it was done with: zirconia, composite.
        Material => "material",
    }
);

/// A term from the seeded vocabulary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedTerm {
    /// The list it belongs to.
    pub kind: TermKind,
    /// Stable id, such as `zirconia`.
    pub id: String,
    /// What the clinician reads.
    pub label: String,
    /// No longer offered for new entries; old entries still show it.
    pub retired: bool,
}

#[derive(serde::Deserialize)]
struct File {
    procedures: Vec<RawTerm>,
    materials: Vec<RawTerm>,
}

#[derive(serde::Deserialize)]
struct RawTerm {
    id: String,
    label: String,
    #[serde(default)]
    retired: bool,
}

fn parse(source: &str) -> Result<Vec<SeedTerm>, serde_json::Error> {
    let file: File = serde_json::from_str(source)?;
    let terms = |kind, raw: Vec<RawTerm>| {
        raw.into_iter().map(move |t| SeedTerm {
            kind,
            id: t.id,
            label: t.label,
            retired: t.retired,
        })
    };
    Ok(terms(TermKind::Procedure, file.procedures)
        .chain(terms(TermKind::Material, file.materials))
        .collect())
}

/// Every seeded term, procedures then materials, in the file's order. A unit test proves the
/// file parses, so the empty fallback never happens in a built binary.
pub fn seeded() -> &'static [SeedTerm] {
    static TERMS: OnceLock<Vec<SeedTerm>> = OnceLock::new();
    TERMS.get_or_init(|| parse(SOURCE).unwrap_or_default())
}

/// The seeded term of `kind` named by its id or (ignoring case) its label.
#[must_use]
pub fn seeded_match(kind: TermKind, text: &str) -> Option<&'static SeedTerm> {
    let text = text.trim();
    seeded()
        .iter()
        .find(|t| t.kind == kind && (t.id == text || t.label.eq_ignore_ascii_case(text)))
}

/// Why a term was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TermError {
    /// Neither a seeded id of the right list nor a clinic term id.
    #[error("unknown {0}")]
    Unknown(&'static str),
    /// The label is empty or too long.
    #[error("label must be 1 to 80 characters")]
    Label,
}

/// A reference to a term: seeded, or one of the clinic's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TermRef {
    /// A seeded term.
    Seeded(&'static SeedTerm),
    /// A clinic term; whether it exists in the clinic is checked against the database.
    Clinic(DentalTermId),
}

impl TermRef {
    /// Reads a term id for a new entry: a UUID names a clinic term; anything else must be a
    /// seeded id of `kind` that isn't retired.
    ///
    /// # Errors
    /// [`TermError::Unknown`] otherwise.
    pub fn parse(kind: TermKind, text: &str) -> Result<Self, TermError> {
        match Self::stored(kind, text) {
            Some(Self::Seeded(term)) if term.retired => Err(TermError::Unknown(kind.as_str())),
            Some(term) => Ok(term),
            None => Err(TermError::Unknown(kind.as_str())),
        }
    }

    /// Reads a stored term id, retired seeded terms included.
    #[must_use]
    pub fn stored(kind: TermKind, text: &str) -> Option<Self> {
        let text = text.trim();
        if let Ok(id) = Uuid::try_parse(text) {
            return Some(Self::Clinic(DentalTermId::from_uuid(id)));
        }
        seeded()
            .iter()
            .find(|t| t.kind == kind && t.id == text)
            .map(Self::Seeded)
    }

    /// The id as stored and sent: the seeded id or the UUID.
    #[must_use]
    pub fn id_text(self) -> String {
        match self {
            Self::Seeded(term) => term.id.clone(),
            Self::Clinic(id) => id.uuid().to_string(),
        }
    }

    /// The clinic term's id, if this is one.
    #[must_use]
    pub const fn clinic(self) -> Option<DentalTermId> {
        match self {
            Self::Clinic(id) => Some(id),
            Self::Seeded(_) => None,
        }
    }
}

/// A label for a new clinic term: trimmed, inner spaces collapsed, 1 to 80 characters.
///
/// # Errors
/// [`TermError::Label`] when empty, too long or not plain text.
pub fn term_label(text: &str) -> Result<String, TermError> {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    clinical_text(&collapsed, 1, LABEL_MAX).map_err(|_: ClinicalError| TermError::Label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seeded_vocabulary_parses_with_unique_ids() {
        let terms = parse(SOURCE).unwrap();
        assert_eq!(seeded(), terms.as_slice());
        for kind in TermKind::ALL {
            let ids: Vec<&str> = terms
                .iter()
                .filter(|t| t.kind == *kind)
                .map(|t| t.id.as_str())
                .collect();
            assert!(!ids.is_empty(), "{kind}");
            let mut unique = ids.clone();
            unique.sort_unstable();
            unique.dedup();
            assert_eq!(unique.len(), ids.len(), "{kind} ids repeat");
            for id in ids {
                assert!(
                    id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                    "{id}"
                );
            }
        }
        for material in [
            "zirconia",
            "pfm",
            "cast_metal",
            "composite",
            "amalgam",
            "glass_ionomer",
            "emax",
            "gold",
            "ceramic",
            "temporary",
        ] {
            assert!(
                TermRef::parse(TermKind::Material, material).is_ok(),
                "{material}"
            );
        }
    }

    #[test]
    fn term_ids_name_the_right_list() {
        let zirconia = TermRef::parse(TermKind::Material, " zirconia ").unwrap();
        assert_eq!(zirconia.id_text(), "zirconia");
        assert_eq!(zirconia.clinic(), None);
        assert_eq!(
            TermRef::parse(TermKind::Procedure, "zirconia"),
            Err(TermError::Unknown("procedure"))
        );
        let id = "0190a7c2-0000-7000-8000-000000000001";
        let clinic = TermRef::parse(TermKind::Material, id).unwrap();
        assert_eq!(clinic.id_text(), id);
        assert!(clinic.clinic().is_some());
        assert_eq!(
            seeded_match(TermKind::Material, "ZIRCONIA").map(|t| t.id.as_str()),
            Some("zirconia")
        );
        assert_eq!(seeded_match(TermKind::Procedure, "Zirconia"), None);
    }

    #[test]
    fn labels_are_tidied() {
        assert_eq!(
            term_label("  Lithium   silicate ").unwrap(),
            "Lithium silicate"
        );
        assert_eq!(term_label("   "), Err(TermError::Label));
        assert_eq!(term_label(&"x".repeat(81)), Err(TermError::Label));
    }
}
