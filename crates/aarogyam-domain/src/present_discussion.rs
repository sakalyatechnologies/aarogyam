//! "What we discussed" in Show patient (docs/plans/present-studio-design.md, sections 10 and
//! 12.4): the usual options the doctor and patient went through for one situation, with the one
//! the patient prefers. Pure validation against the compiled-in data files; the rows are written
//! by the app layer.

use serde::{Deserialize, Serialize};

use crate::dental::Tooth;
use crate::present::{materials, options, usual_case};

/// Most options one row may hold.
pub const MAX_OPTIONS: usize = 12;

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

fn known_situation(situation: &str) -> bool {
    options().is_some_and(|o| o.situations.contains_key(situation))
        || usual_case(situation).is_some()
}

/// Options of the example-arch "Straighter teeth" cases (F8); they have no card in `options.json`.
const ORTHODONTIC_KEYS: [&str; 3] = ["braces", "orthodontic_fixed", "aligners"];

fn known_option(key: &str) -> bool {
    ORTHODONTIC_KEYS.contains(&key)
        || options().is_some_and(|o| {
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

/// One discussed option as the patient sees it: words resolved from the data files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedOption {
    /// Short name.
    pub label: String,
    /// What is done.
    pub summary: String,
    /// How it looks afterwards.
    pub looks_like: String,
    /// How it feels, in words.
    pub comfort: String,
    /// The compared material's name, when one was.
    pub material: Option<String>,
    /// The option the patient prefers.
    pub preferred: bool,
    /// The frozen "from" price in paise; only when the clinic shows prices.
    pub from_paise: Option<i64>,
}

/// A ticked discussion as the patient sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedDiscussion {
    /// FDI tooth; none for an example-arch topic.
    pub tooth: Option<u8>,
    /// Words for the situation.
    pub title: String,
    /// The options.
    pub options: Vec<SharedOption>,
}

/// Resolves a ticked row into the patient's words. A price is kept only when `show_prices`.
/// Options the data files no longer know are left out; a row with none left is `None`.
#[must_use]
pub fn shared_view(
    tooth: Option<u8>,
    situation: &str,
    discussed: &[DiscussedOption],
    show_prices: bool,
) -> Option<SharedDiscussion> {
    let data = options()?;
    let title = data
        .situations
        .get(situation)
        .map(|s| s.title.clone())
        .or_else(|| usual_case(situation).map(|c| c.title.clone()))?;
    let options: Vec<SharedOption> = discussed
        .iter()
        .filter_map(|d| {
            let o = data
                .situations
                .values()
                .flat_map(|s| s.options.iter())
                .find(|o| o.key == d.key)?;
            let material = d.material.as_deref().and_then(|key| {
                materials()?
                    .groups
                    .values()
                    .flat_map(|g| g.materials.iter())
                    .find(|m| m.key == key)
                    .map(|m| m.label.clone())
            });
            Some(SharedOption {
                label: o.label.clone(),
                summary: o.summary.clone(),
                looks_like: o.looks_like.clone(),
                comfort: data.comfort.get(&o.comfort).cloned().unwrap_or_default(),
                material,
                preferred: d.preferred,
                from_paise: if show_prices { d.from_paise } else { None },
            })
        })
        .collect();
    (!options.is_empty()).then_some(SharedDiscussion {
        tooth,
        title,
        options,
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
    use crate::dental_terms::{TermKind, seeded_match};

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
    fn a_shared_price_needs_show_prices() {
        let mut crown = opt("rct_crown");
        crown.from_paise = Some(900_000);
        let off = shared_view(Some(36), "deep_decay", &[crown.clone()], false).unwrap();
        assert_eq!(off.options[0].from_paise, None);
        let on = shared_view(Some(36), "deep_decay", &[crown], true).unwrap();
        assert_eq!(on.options[0].from_paise, Some(900_000));
        assert!(on.options[0].looks_like.len() > 2);
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
    fn braces_and_aligners_are_seeded_and_no_longer_refused() {
        for key in ["orthodontic_fixed", "aligners"] {
            assert!(seeded_match(TermKind::Procedure, key).is_some_and(|t| t.id == key));
        }
        for key in ["orthodontic_fixed", "aligners"] {
            assert_ne!(
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
