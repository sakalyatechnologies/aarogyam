//! "What we discussed" in Show patient (docs/plans/present-studio-design.md, sections 10 and
//! 12.4): the usual options the doctor and patient went through for one situation, with the one
//! the patient prefers. Pure validation against the compiled-in data files; the rows are written
//! by the app layer.

use serde::{Deserialize, Serialize};

use crate::dental::Tooth;
use crate::dental_terms::{TermKind, seeded_match};
use crate::present::{materials, options, usual_case};

/// Most options one row may hold.
pub const MAX_OPTIONS: usize = 12;

/// Option keys that need a seeded procedure before they may be recorded (F8): braces and
/// aligners are an example-arch case only until `orthodontic_fixed` and `aligners` exist in
/// `vocabulary.json`. Pairs of (option key, vocabulary procedure id).
const NEEDS_SEEDED: [(&str, &str); 3] = [
    ("braces", "orthodontic_fixed"),
    ("orthodontic_fixed", "orthodontic_fixed"),
    ("aligners", "aligners"),
];

/// One option the doctor and patient discussed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscussedOption {
    /// A key from `options.json`, such as `rct_crown`.
    pub key: String,
    /// A material key from `materials.json`, when one was compared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// The option the patient prefers; at most one per row.
    #[serde(default)]
    pub preferred: bool,
    /// Frozen "from" price in paise, set when the row is saved to be sent with prices on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_paise: Option<i64>,
}

/// Why a discussion was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DiscussionError {
    /// Not an FDI tooth.
    #[error("not a valid tooth number")]
    Tooth,
    /// A situation the data files don't know.
    #[error("unknown situation")]
    Situation,
    /// No options, or too many.
    #[error("record between 1 and 12 options")]
    Count,
    /// An option key the data files don't know.
    #[error("unknown option")]
    Option,
    /// An option that waits for its procedure to be seeded.
    #[error("this option is not available yet")]
    NotSeeded,
    /// A material the data files don't know.
    #[error("unknown material")]
    Material,
    /// The same option twice, or more than one preferred.
    #[error("each option once, and at most one preferred")]
    Repeated,
    /// A price below zero.
    #[error("a price can't be negative")]
    Price,
    /// A reason outside 3 to 500 characters.
    #[error("reason must be 3 to 500 characters")]
    Reason,
}

/// A trimmed error reason of 3 to 500 characters.
///
/// # Errors
/// [`DiscussionError::Reason`].
pub fn error_reason(reason: &str) -> Result<String, DiscussionError> {
    let reason = reason.trim();
    if (3..=500).contains(&reason.chars().count()) {
        Ok(reason.to_owned())
    } else {
        Err(DiscussionError::Reason)
    }
}

fn seeded_procedure(id: &str) -> bool {
    seeded_match(TermKind::Procedure, id).is_some_and(|t| t.id == id)
}

fn known_situation(situation: &str) -> bool {
    options().is_some_and(|o| o.situations.contains_key(situation))
        || usual_case(situation).is_some()
}

fn known_option(key: &str) -> bool {
    options().is_some_and(|o| {
        o.situations
            .values()
            .any(|s| s.options.iter().any(|option| option.key == key))
    })
}

fn known_material(key: &str) -> bool {
    materials().is_some_and(|m| {
        m.groups
            .values()
            .any(|g| g.materials.iter().any(|material| material.key == key))
    })
}

/// Checks a discussion against the data files. `tooth` is `None` for an example-arch topic.
///
/// # Errors
/// The first problem, as a [`DiscussionError`].
pub fn validate(
    tooth: Option<i64>,
    situation: &str,
    discussed: &[DiscussedOption],
) -> Result<Option<Tooth>, DiscussionError> {
    let tooth = tooth
        .map(|t| Tooth::new(t).map_err(|_| DiscussionError::Tooth))
        .transpose()?;
    if !known_situation(situation) {
        return Err(DiscussionError::Situation);
    }
    if discussed.is_empty() || discussed.len() > MAX_OPTIONS {
        return Err(DiscussionError::Count);
    }
    for (index, option) in discussed.iter().enumerate() {
        if let Some((_, procedure)) = NEEDS_SEEDED.iter().find(|(key, _)| *key == option.key)
            && !seeded_procedure(procedure)
        {
            return Err(DiscussionError::NotSeeded);
        }
        if !known_option(&option.key) {
            return Err(DiscussionError::Option);
        }
        if option
            .material
            .as_deref()
            .is_some_and(|m| !known_material(m))
        {
            return Err(DiscussionError::Material);
        }
        if option.from_paise.is_some_and(|p| p < 0) {
            return Err(DiscussionError::Price);
        }
        if discussed[..index].iter().any(|o| o.key == option.key) {
            return Err(DiscussionError::Repeated);
        }
    }
    if discussed.iter().filter(|o| o.preferred).count() > 1 {
        return Err(DiscussionError::Repeated);
    }
    Ok(tooth)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opt(key: &str) -> DiscussedOption {
        DiscussedOption {
            key: key.to_owned(),
            material: None,
            preferred: false,
            from_paise: None,
        }
    }

    #[test]
    fn a_recorded_situation_with_known_options_passes() {
        let mut crown = opt("rct_crown");
        crown.material = Some("zirconia".to_owned());
        crown.preferred = true;
        let tooth = validate(Some(36), "deep_decay", &[crown, opt("extract")]).unwrap();
        assert_eq!(tooth.map(Tooth::number), Some(36));
    }

    #[test]
    fn a_topic_has_no_tooth() {
        assert_eq!(validate(None, "implant", &[opt("implant")]).unwrap(), None);
    }

    #[test]
    fn bad_input_is_named() {
        let one = [opt("extract")];
        assert_eq!(
            validate(Some(99), "deep_decay", &one),
            Err(DiscussionError::Tooth)
        );
        assert_eq!(
            validate(Some(36), "nope", &one),
            Err(DiscussionError::Situation)
        );
        assert_eq!(
            validate(Some(36), "deep_decay", &[]),
            Err(DiscussionError::Count)
        );
        assert_eq!(
            validate(Some(36), "deep_decay", &[opt("magic")]),
            Err(DiscussionError::Option)
        );
        let mut bad = opt("extract");
        bad.material = Some("gold_leaf".to_owned());
        assert_eq!(
            validate(Some(36), "deep_decay", &[bad]),
            Err(DiscussionError::Material)
        );
        assert_eq!(
            validate(Some(36), "deep_decay", &[opt("extract"), opt("extract")]),
            Err(DiscussionError::Repeated)
        );
        let (mut a, mut b) = (opt("extract"), opt("wait"));
        a.preferred = true;
        b.preferred = true;
        assert_eq!(
            validate(Some(36), "deep_decay", &[a, b]),
            Err(DiscussionError::Repeated)
        );
    }

    #[test]
    fn braces_and_aligners_wait_for_their_procedures() {
        assert!(
            !seeded_procedure("orthodontic_fixed"),
            "seed them, then lift the block (F8)"
        );
        for key in ["braces", "aligners", "orthodontic_fixed"] {
            assert_eq!(
                validate(None, "implant", &[opt(key)]),
                Err(DiscussionError::NotSeeded)
            );
        }
    }

    #[test]
    fn reasons_are_trimmed_and_bounded() {
        assert_eq!(error_reason("  wrong tooth ").unwrap(), "wrong tooth");
        assert_eq!(error_reason("no"), Err(DiscussionError::Reason));
    }
}
