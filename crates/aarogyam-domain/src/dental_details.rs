//! Optional exact details a doctor taps while charting (docs/plans/visit-story-v2-offers-design.md,
//! section 1.13): a tooth's condition (infection, gum bleeding, pocket depth, mobility) and a
//! permanent tooth's eruption. Each is its own `specialty_records` kind with one current row per
//! tooth, superseded by the next, so a client that never sends them never drops them. The values
//! are also declared in `specialties/dental/chart-details.json`, with the patient's words.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::clinical::{ClinicalError, text_enum};
use crate::dental::{CariesDepth, ChartError, Tooth};

/// The record kind of a tooth's condition: whole tooth, no surface.
pub const CONDITION_KIND: &str = "tooth_condition";
/// The version of [`ToothConditionData`]'s JSON shape.
pub const CONDITION_SCHEMA_VERSION: i32 = 1;
/// The record kind of a permanent tooth's eruption.
pub const ERUPTION_KIND: &str = "tooth_eruption";
/// The version of [`ToothEruptionData`]'s JSON shape.
pub const ERUPTION_SCHEMA_VERSION: i32 = 1;
/// The deepest gum pocket recorded, in millimetres.
pub const POCKET_MAX_MM: u8 = 15;
/// The highest mobility grade.
pub const MOBILITY_MAX: u8 = 3;

const SOURCE: &str = include_str!("../../../specialties/dental/chart-details.json");

text_enum!(
    /// An infection recorded on a tooth.
    Infection {
        /// Infection at the root.
        Infection => "infection",
        /// An abscess (swelling with pus).
        Abscess => "abscess",
    }
);

text_enum!(
    /// How far a permanent tooth has come through the gum.
    Eruption {
        /// Fully through.
        Erupted => "erupted",
        /// Partly through.
        Partial => "partial",
        /// Stuck under the gum or bone.
        Impacted => "impacted",
        /// Not yet through.
        Unerupted => "unerupted",
    }
);

text_enum!(
    /// The angle of a tooth that isn't fully through (mostly wisdom teeth).
    Angulation {
        /// Upright.
        Vertical => "vertical",
        /// Tilted forward.
        Mesioangular => "mesioangular",
        /// Tilted backward.
        Distoangular => "distoangular",
        /// Lying on its side.
        Horizontal => "horizontal",
    }
);

/// Why a detail was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DetailError {
    /// Not an FDI tooth number.
    #[error("tooth must be an FDI number: 11-48, or 51-85 for primary teeth")]
    Tooth,
    /// Not `infection` or `abscess`.
    #[error("infection must be infection or abscess")]
    Infection,
    /// A pocket outside 1 to 15 mm.
    #[error("pocket_mm must be 1 to 15")]
    Pocket,
    /// A mobility grade outside 0 to 3.
    #[error("mobility must be 0 to 3")]
    Mobility,
    /// Nothing to record: no current condition and nothing set.
    #[error("set at least one of infection, bleeding, pocket_mm or mobility")]
    Empty,
    /// Infection, pocket or mobility on a missing tooth.
    #[error("infection, pocket_mm and mobility don't apply to a missing tooth")]
    MissingTooth,
    /// Not a known eruption.
    #[error("eruption must be erupted, partial, impacted or unerupted")]
    Eruption,
    /// Not a known angle.
    #[error("angulation must be vertical, mesioangular, distoangular or horizontal")]
    Angulation,
    /// An angle on a tooth that is fully through.
    #[error("angulation goes with partial, impacted or unerupted")]
    AngulationErupted,
    /// Eruption on a primary tooth.
    #[error("eruption is recorded on permanent teeth only")]
    PrimaryTooth,
    /// The reason for marking an entry in error is missing or too long.
    #[error("reason must be 3 to 500 characters")]
    Reason,
}

impl From<ChartError> for DetailError {
    fn from(_: ChartError) -> Self {
        Self::Tooth
    }
}

/// The JSON shape of a tooth's condition in `specialty_records.data`.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ToothConditionData {
    /// FDI tooth number.
    pub tooth: u8,
    /// `infection` or `abscess`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub infection: Option<String>,
    /// The gum bleeds on probing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bleeding: Option<bool>,
    /// The deepest pocket, in millimetres (1 to 15).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pocket_mm: Option<u8>,
    /// Mobility grade, 0 to 3.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mobility: Option<u8>,
}

/// A change to one field of a condition: left as it is, cleared, or set.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Change<T> {
    /// Omitted: keep the current value.
    #[default]
    Keep,
    /// `null`: clear it.
    Clear,
    /// A new value.
    Set(T),
}

impl<T> Change<T> {
    /// From the JSON's absent (outer `None`), `null` (inner `None`) or value.
    pub fn from_json(value: Option<Option<T>>) -> Self {
        match value {
            None => Self::Keep,
            Some(None) => Self::Clear,
            Some(Some(value)) => Self::Set(value),
        }
    }

    fn apply(self, current: Option<T>) -> Option<T> {
        match self {
            Self::Keep => current,
            Self::Clear => None,
            Self::Set(value) => Some(value),
        }
    }
}

/// A condition PUT as received: each field kept, cleared or set.
#[derive(Debug, Clone, Default)]
pub struct ConditionChange<'a> {
    /// `infection` or `abscess`.
    pub infection: Change<&'a str>,
    /// Bleeding on probing.
    pub bleeding: Change<bool>,
    /// Pocket depth in mm.
    pub pocket_mm: Change<i64>,
    /// Mobility grade.
    pub mobility: Change<i64>,
}

/// Merges a change onto the tooth's current condition (none for the first) and validates the
/// result: values in range, and no infection, pocket or mobility on a tooth whose current
/// finding is `missing`. Mobility is allowed on primary teeth (DT5). A merge that clears every
/// field of the current condition ("Infection resolved" on its only field, or untapping the
/// last chip) gives `None`: the current row is to be superseded with nothing after it.
///
/// # Errors
/// The [`DetailError`] that applies; [`DetailError::Empty`] when there is no current condition
/// and nothing is set.
pub fn merge_condition(
    tooth: i64,
    current: Option<&ToothConditionData>,
    change: &ConditionChange<'_>,
    missing: bool,
) -> Result<Option<ToothConditionData>, DetailError> {
    let tooth = Tooth::new(tooth)?;
    let infection = match change.infection {
        Change::Set(text) => Change::Set(
            Infection::parse(text.trim())
                .map_err(|_: ClinicalError| DetailError::Infection)?
                .as_str()
                .to_owned(),
        ),
        Change::Clear => Change::Clear,
        Change::Keep => Change::Keep,
    };
    let bounded = |change: Change<i64>, min: u8, max: u8, error| match change {
        Change::Set(n) => u8::try_from(n)
            .ok()
            .filter(|n| (min..=max).contains(n))
            .map(Change::Set)
            .ok_or(error),
        Change::Clear => Ok(Change::Clear),
        Change::Keep => Ok(Change::Keep),
    };
    let pocket = bounded(change.pocket_mm, 1, POCKET_MAX_MM, DetailError::Pocket)?;
    let mobility = bounded(change.mobility, 0, MOBILITY_MAX, DetailError::Mobility)?;
    let base = current.cloned().unwrap_or_default();
    let merged = ToothConditionData {
        tooth: tooth.number(),
        infection: infection.apply(base.infection),
        bleeding: change.bleeding.apply(base.bleeding),
        pocket_mm: pocket.apply(base.pocket_mm),
        mobility: mobility.apply(base.mobility),
    };
    if merged.infection.is_none()
        && merged.bleeding.is_none()
        && merged.pocket_mm.is_none()
        && merged.mobility.is_none()
    {
        return match current {
            Some(_) => Ok(None),
            None => Err(DetailError::Empty),
        };
    }
    let touches_missing = matches!(change.infection, Change::Set(_))
        || matches!(pocket, Change::Set(_))
        || matches!(mobility, Change::Set(_));
    if missing && touches_missing {
        return Err(DetailError::MissingTooth);
    }
    Ok(Some(merged))
}

/// The JSON shape of a tooth's eruption in `specialty_records.data`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ToothEruptionData {
    /// FDI tooth number (permanent only).
    pub tooth: u8,
    /// `erupted`, `partial`, `impacted` or `unerupted`.
    pub eruption: String,
    /// The angle, only when not fully through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angulation: Option<String>,
}

/// Validates an eruption: a permanent tooth, a known eruption, and an angle only when the tooth
/// isn't fully through.
///
/// # Errors
/// The [`DetailError`] that applies.
pub fn eruption(
    tooth: i64,
    eruption: &str,
    angulation: Option<&str>,
) -> Result<ToothEruptionData, DetailError> {
    let tooth = Tooth::new(tooth)?;
    if tooth.is_primary() {
        return Err(DetailError::PrimaryTooth);
    }
    let eruption = Eruption::parse(eruption.trim()).map_err(|_| DetailError::Eruption)?;
    let angulation = match angulation.map(str::trim) {
        None | Some("") => None,
        Some(text) => {
            if eruption == Eruption::Erupted {
                return Err(DetailError::AngulationErupted);
            }
            Some(Angulation::parse(text).map_err(|_| DetailError::Angulation)?)
        }
    };
    Ok(ToothEruptionData {
        tooth: tooth.number(),
        eruption: eruption.as_str().to_owned(),
        angulation: angulation.map(|a| a.as_str().to_owned()),
    })
}

/// Checks the reason for marking a detail entered in error: 3 to 500 characters, trimmed.
///
/// # Errors
/// [`DetailError::Reason`].
pub fn error_reason(reason: &str) -> Result<String, DetailError> {
    let reason = reason.trim();
    if (3..=500).contains(&reason.chars().count()) {
        Ok(reason.to_owned())
    } else {
        Err(DetailError::Reason)
    }
}

/// One field of `chart-details.json`: its values and their words.
#[derive(Debug, Deserialize)]
pub struct DetailField {
    /// The stored values, in chip order.
    pub values: Vec<String>,
    /// Chip labels by value.
    pub chips: BTreeMap<String, String>,
    /// Patient words by value, for "What we found"; absent for values the message doesn't say.
    #[serde(default)]
    pub words: BTreeMap<String, String>,
}

/// `specialties/dental/chart-details.json`.
#[derive(Debug, Deserialize)]
pub struct ChartDetails {
    /// `caries_depth`, `infection`, `eruption` and `angulation`.
    pub fields: BTreeMap<String, DetailField>,
    /// "Tooth is loose (grade {grade})".
    pub mobility_words: String,
    /// "Loose milk tooth (grade {grade})".
    pub mobility_primary_words: String,
    /// "Gums bleed around {count} teeth".
    pub bleeding_words: String,
    /// "Gums bleed around 1 tooth".
    pub bleeding_one_words: String,
    /// The subject of an eruption line for a wisdom tooth.
    pub wisdom_subject: String,
    /// The subject of an eruption line for any other tooth.
    pub tooth_subject: String,
}

/// The chart details file; none when it doesn't parse (a test guards it).
#[must_use]
pub fn chart_details() -> Option<&'static ChartDetails> {
    static FILE: OnceLock<Option<ChartDetails>> = OnceLock::new();
    FILE.get_or_init(|| serde_json::from_str(SOURCE).ok())
        .as_ref()
}

fn words(field: &str, value: &str) -> Option<&'static str> {
    chart_details()?
        .fields
        .get(field)?
        .words
        .get(value)
        .map(String::as_str)
}

/// The "What we found" words for decay of a recorded depth, such as "Decay close to the nerve";
/// none without a depth (the plain chart words apply).
#[must_use]
pub fn caries_words(depth: Option<CariesDepth>) -> Option<&'static str> {
    words("caries_depth", depth?.as_str())
}

/// The words for a recorded infection, such as "An infection (abscess) at the root".
#[must_use]
pub fn infection_words(infection: &str) -> Option<&'static str> {
    words("infection", infection)
}

/// The words for an eruption, such as "Wisdom tooth is impacted (tilted forward)": the subject
/// ("Wisdom tooth" for an 8), the eruption's words, then the angle's when recorded. None for a
/// tooth that is through.
#[must_use]
pub fn eruption_words(tooth: Tooth, eruption: &str, angulation: Option<&str>) -> Option<String> {
    let file = chart_details()?;
    let said = words("eruption", eruption)?;
    let subject = if tooth.number() % 10 == 8 {
        &file.wisdom_subject
    } else {
        &file.tooth_subject
    };
    Some(match angulation.and_then(|a| words("angulation", a)) {
        Some(angle) => format!("{subject} {said} ({angle})"),
        None => format!("{subject} {said}"),
    })
}

/// The words for a loose tooth of a grade (1 to 3), such as "Tooth is loose (grade 2)".
#[must_use]
pub fn mobility_words(tooth: Tooth, grade: u8) -> Option<String> {
    if grade == 0 {
        return None;
    }
    let file = chart_details()?;
    let template = if tooth.is_primary() {
        &file.mobility_primary_words
    } else {
        &file.mobility_words
    };
    Some(template.replace("{grade}", &grade.to_string()))
}

/// The aggregated bleeding line, such as "Gums bleed around 3 teeth".
#[must_use]
pub fn bleeding_words(count: usize) -> Option<String> {
    let file = chart_details()?;
    match count {
        0 => None,
        1 => Some(file.bleeding_one_words.clone()),
        n => Some(file.bleeding_words.replace("{count}", &n.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set<T>(value: T) -> Change<T> {
        Change::Set(value)
    }

    #[test]
    fn the_enums_equal_chart_details_json() {
        let file = chart_details().expect("chart-details.json parses");
        let texts = |all: &[&str]| all.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let cases = [
            (
                "caries_depth",
                texts(
                    &CariesDepth::ALL
                        .iter()
                        .map(|v| v.as_str())
                        .collect::<Vec<_>>(),
                ),
            ),
            (
                "infection",
                texts(
                    &Infection::ALL
                        .iter()
                        .map(|v| v.as_str())
                        .collect::<Vec<_>>(),
                ),
            ),
            (
                "eruption",
                texts(&Eruption::ALL.iter().map(|v| v.as_str()).collect::<Vec<_>>()),
            ),
            (
                "angulation",
                texts(
                    &Angulation::ALL
                        .iter()
                        .map(|v| v.as_str())
                        .collect::<Vec<_>>(),
                ),
            ),
        ];
        assert_eq!(file.fields.len(), cases.len());
        for (field, values) in cases {
            let declared = &file.fields[field];
            assert_eq!(declared.values, values, "{field}");
            for value in &values {
                assert!(declared.chips.contains_key(value), "{field}.{value} chip");
            }
        }
        for depth in CariesDepth::ALL {
            assert!(caries_words(Some(*depth)).is_some(), "{depth} words");
        }
        for infection in Infection::ALL {
            assert!(infection_words(infection.as_str()).is_some());
        }
    }

    #[test]
    fn a_condition_merges_onto_the_current_one() {
        let first = merge_condition(
            36,
            None,
            &ConditionChange {
                bleeding: set(true),
                ..ConditionChange::default()
            },
            false,
        )
        .unwrap()
        .unwrap();
        let second = merge_condition(
            36,
            Some(&first),
            &ConditionChange {
                mobility: set(2),
                ..ConditionChange::default()
            },
            false,
        )
        .unwrap()
        .unwrap();
        assert_eq!(second.bleeding, Some(true));
        assert_eq!(second.mobility, Some(2));
        let cleared = merge_condition(
            36,
            Some(&second),
            &ConditionChange {
                bleeding: Change::Clear,
                ..ConditionChange::default()
            },
            false,
        )
        .unwrap()
        .unwrap();
        assert_eq!((cleared.bleeding, cleared.mobility), (None, Some(2)));
        let empty = merge_condition(
            36,
            Some(&cleared),
            &ConditionChange {
                mobility: Change::Clear,
                ..ConditionChange::default()
            },
            false,
        );
        assert_eq!(
            empty,
            Ok(None),
            "untapping the last chip leaves no condition"
        );
        let resolved = merge_condition(
            36,
            Some(&ToothConditionData {
                tooth: 36,
                infection: Some("infection".to_owned()),
                ..ToothConditionData::default()
            }),
            &ConditionChange {
                infection: Change::Clear,
                ..ConditionChange::default()
            },
            true,
        );
        assert_eq!(
            resolved,
            Ok(None),
            "infection resolved, even on a missing tooth"
        );
        assert_eq!(
            merge_condition(36, None, &ConditionChange::default(), false),
            Err(DetailError::Empty)
        );
        assert_eq!(
            merge_condition(
                36,
                None,
                &ConditionChange {
                    mobility: Change::Clear,
                    ..ConditionChange::default()
                },
                false
            ),
            Err(DetailError::Empty),
            "nothing to clear"
        );
    }

    #[test]
    fn condition_values_are_bounded_and_kept_off_missing_teeth() {
        let change = |pocket, mobility| ConditionChange {
            pocket_mm: pocket,
            mobility,
            ..ConditionChange::default()
        };
        assert_eq!(
            merge_condition(36, None, &change(set(16), Change::Keep), false),
            Err(DetailError::Pocket)
        );
        assert_eq!(
            merge_condition(36, None, &change(Change::Keep, set(4)), false),
            Err(DetailError::Mobility)
        );
        assert_eq!(
            merge_condition(36, None, &change(Change::Keep, set(2)), true),
            Err(DetailError::MissingTooth)
        );
        let infection = ConditionChange {
            infection: set("pus"),
            ..ConditionChange::default()
        };
        assert_eq!(
            merge_condition(36, None, &infection, false),
            Err(DetailError::Infection)
        );
        // DT5: a loose milk tooth.
        let loose = merge_condition(75, None, &change(Change::Keep, set(2)), false)
            .unwrap()
            .unwrap();
        assert_eq!(loose.mobility, Some(2));
        assert_eq!(
            merge_condition(19, None, &change(Change::Keep, set(1)), false),
            Err(DetailError::Tooth)
        );
    }

    #[test]
    fn eruption_is_for_permanent_teeth_with_an_angle_only_when_not_through() {
        let impacted = eruption(48, "impacted", Some("mesioangular")).unwrap();
        assert_eq!(impacted.angulation.as_deref(), Some("mesioangular"));
        assert_eq!(
            eruption(48, "erupted", Some("vertical")),
            Err(DetailError::AngulationErupted)
        );
        assert_eq!(
            eruption(55, "erupted", None),
            Err(DetailError::PrimaryTooth)
        );
        assert_eq!(eruption(48, "stuck", None), Err(DetailError::Eruption));
        assert_eq!(
            eruption(48, "partial", Some("sideways")),
            Err(DetailError::Angulation)
        );
        assert_eq!(error_reason("  x "), Err(DetailError::Reason));
        assert_eq!(error_reason("Wrong tooth").unwrap(), "Wrong tooth");
    }

    #[test]
    fn detail_words_say_only_what_was_recorded() {
        assert_eq!(
            caries_words(Some(CariesDepth::NearPulp)),
            Some("Decay close to the nerve")
        );
        assert_eq!(caries_words(Some(CariesDepth::Enamel)), Some("Early decay"));
        assert_eq!(caries_words(None), None);
        let wisdom = Tooth::new(48).unwrap();
        assert_eq!(
            eruption_words(wisdom, "impacted", Some("mesioangular")).as_deref(),
            Some("Wisdom tooth is impacted (tilted forward)")
        );
        assert_eq!(eruption_words(wisdom, "erupted", None), None);
        let molar = Tooth::new(31).unwrap();
        assert_eq!(
            mobility_words(molar, 2).as_deref(),
            Some("Tooth is loose (grade 2)")
        );
        assert_eq!(mobility_words(molar, 0), None);
        assert_eq!(
            mobility_words(Tooth::new(75).unwrap(), 1).as_deref(),
            Some("Loose milk tooth (grade 1)")
        );
        assert_eq!(
            bleeding_words(3).as_deref(),
            Some("Gums bleed around 3 teeth")
        );
        assert_eq!(bleeding_words(0), None);
    }
}
