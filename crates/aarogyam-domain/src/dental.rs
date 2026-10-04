//! The dental chart: FDI tooth numbers, surfaces, findings, and which current entries a new
//! entry replaces. Entries are stored as `specialty_records` rows (module `dental`, kind
//! `tooth`); each new entry supersedes the current one for the same tooth and surface.

use std::fmt;

use crate::clinical::{ClinicalError, optional_text, text_enum};

/// The specialty module the chart belongs to.
pub const MODULE: &str = "dental";
/// The record kind of a chart entry.
pub const KIND: &str = "tooth";
/// The version of [`ChartEntry`]'s JSON shape.
pub const SCHEMA_VERSION: i32 = 1;

/// A tooth by its FDI (ISO 3950) number: 11-18, 21-28, 31-38, 41-48 for permanent teeth and
/// 51-55, 61-65, 71-75, 81-85 for primary (milk) teeth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Tooth(u8);

/// Why a chart value was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ChartError {
    /// Not an FDI tooth number.
    #[error("tooth must be an FDI number: 11-48, or 51-85 for primary teeth")]
    Tooth,
    /// Not one of M, O, D, B, L.
    #[error("surface must be one of M, O, D, B, L")]
    Surface,
    /// Not a known finding.
    #[error("unknown finding")]
    Finding,
    /// A whole-tooth finding was given a surface.
    #[error("{0} applies to the whole tooth; leave the surface out")]
    WholeTooth(&'static str),
    /// The note is too long.
    #[error("note must be at most 500 characters")]
    Note,
}

impl Tooth {
    /// Validates an FDI number.
    ///
    /// # Errors
    /// [`ChartError::Tooth`] for anything else.
    pub fn new(number: i64) -> Result<Self, ChartError> {
        let number = u8::try_from(number).map_err(|_| ChartError::Tooth)?;
        let (quadrant, position) = (number / 10, number % 10);
        let valid = match quadrant {
            1..=4 => (1..=8).contains(&position),
            5..=8 => (1..=5).contains(&position),
            _ => false,
        };
        if valid {
            Ok(Self(number))
        } else {
            Err(ChartError::Tooth)
        }
    }

    /// The FDI number.
    #[must_use]
    pub const fn number(self) -> u8 {
        self.0
    }

    /// Whether this is a primary (milk) tooth.
    #[must_use]
    pub const fn is_primary(self) -> bool {
        self.0 >= 51
    }

    /// Every tooth, permanent then primary, in chart order.
    pub fn all() -> impl Iterator<Item = Self> {
        (11_u8..=85).filter_map(|n| Self::new(i64::from(n)).ok())
    }
}

impl fmt::Display for Tooth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

text_enum!(
    /// A tooth surface.
    Surface {
        /// Mesial.
        Mesial => "M",
        /// Occlusal (incisal on front teeth).
        Occlusal => "O",
        /// Distal.
        Distal => "D",
        /// Buccal (labial on front teeth).
        Buccal => "B",
        /// Lingual (palatal on upper teeth).
        Lingual => "L",
    }
);

/// Parses a list of surfaces (`["O", "D"]`), dropping duplicates and keeping chart order.
///
/// # Errors
/// [`ChartError::Surface`] for an unknown surface.
pub fn surfaces<'a>(texts: impl IntoIterator<Item = &'a str>) -> Result<Vec<Surface>, ChartError> {
    let mut parsed = Vec::new();
    for text in texts {
        let surface =
            Surface::parse(&text.trim().to_ascii_uppercase()).map_err(|_| ChartError::Surface)?;
        if !parsed.contains(&surface) {
            parsed.push(surface);
        }
    }
    parsed.sort_by_key(|s| Surface::ALL.iter().position(|x| x == s));
    Ok(parsed)
}

text_enum!(
    /// What the clinician found on a tooth or surface.
    Finding {
        /// Healthy; clears an earlier finding.
        Sound => "sound",
        /// Decay.
        Caries => "caries",
        /// A filling.
        Filled => "filled",
        /// A crown.
        Crown => "crown",
        /// Missing or extracted.
        Missing => "missing",
        /// An implant.
        Implant => "implant",
        /// Root canal treated.
        RootCanal => "root_canal",
        /// Part of a bridge.
        Bridge => "bridge",
        /// Fractured.
        Fractured => "fractured",
        /// To watch at the next visit.
        Watch => "watch",
    }
);

impl Finding {
    /// Whether the finding describes the whole tooth, never one surface.
    #[must_use]
    pub const fn whole_tooth_only(self) -> bool {
        matches!(
            self,
            Self::Crown | Self::Missing | Self::Implant | Self::RootCanal | Self::Bridge
        )
    }

    /// Whether recording it also replaces the tooth's surface findings: a crown covers every
    /// surface, and a missing tooth or implant has none left.
    #[must_use]
    pub const fn replaces_surfaces(self) -> bool {
        matches!(self, Self::Crown | Self::Missing | Self::Implant)
    }
}

/// One chart entry: a finding on a tooth, or on one of its surfaces. Stored as the
/// `specialty_records.data` JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChartEntry {
    tooth: Tooth,
    surface: Option<Surface>,
    finding: Finding,
    note: Option<String>,
}

/// The JSON shape stored in `specialty_records.data` (schema version 1).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChartData {
    /// FDI tooth number.
    pub tooth: u8,
    /// Surface letter, or none for the whole tooth.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    /// Finding value.
    pub finding: String,
    /// The clinician's remark.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl ChartEntry {
    /// Validates an entry.
    ///
    /// # Errors
    /// The [`ChartError`] that applies.
    pub fn new(
        tooth: i64,
        surface: Option<&str>,
        finding: &str,
        note: Option<&str>,
    ) -> Result<Self, ChartError> {
        let tooth = Tooth::new(tooth)?;
        let surface = match surface.map(str::trim) {
            None | Some("") => None,
            Some(text) => {
                Some(Surface::parse(&text.to_ascii_uppercase()).map_err(|_| ChartError::Surface)?)
            }
        };
        let finding = Finding::parse(finding.trim()).map_err(|_| ChartError::Finding)?;
        if surface.is_some() && finding.whole_tooth_only() {
            return Err(ChartError::WholeTooth(finding.as_str()));
        }
        let note = optional_text(note, 500).map_err(|_: ClinicalError| ChartError::Note)?;
        Ok(Self {
            tooth,
            surface,
            finding,
            note,
        })
    }

    /// The tooth.
    #[must_use]
    pub const fn tooth(&self) -> Tooth {
        self.tooth
    }

    /// The surface, or none for the whole tooth.
    #[must_use]
    pub const fn surface(&self) -> Option<Surface> {
        self.surface
    }

    /// The finding.
    #[must_use]
    pub const fn finding(&self) -> Finding {
        self.finding
    }

    /// The JSON stored for the entry.
    #[must_use]
    pub fn data(&self) -> ChartData {
        ChartData {
            tooth: self.tooth.number(),
            surface: self.surface.map(|s| s.as_str().to_owned()),
            finding: self.finding.as_str().to_owned(),
            note: self.note.clone(),
        }
    }

    /// Whether recording this entry replaces a current entry at `surface` of the same tooth:
    /// the same key always; every surface when the finding covers the whole tooth.
    #[must_use]
    pub fn replaces(&self, surface: Option<Surface>) -> bool {
        surface == self.surface || (self.surface.is_none() && self.finding.replaces_surfaces())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fdi_numbers() {
        for good in [11, 18, 28, 38, 48, 51, 55, 65, 75, 85] {
            assert!(Tooth::new(good).is_ok(), "{good}");
        }
        for bad in [0, 10, 19, 49, 56, 86, 91, -11, 300] {
            assert_eq!(Tooth::new(bad), Err(ChartError::Tooth), "{bad}");
        }
        assert_eq!(Tooth::all().count(), 32 + 20);
        assert!(Tooth::new(64).unwrap().is_primary());
    }

    #[test]
    fn entries_check_surfaces_and_findings() {
        let caries = ChartEntry::new(36, Some("o"), "caries", Some(" deep ")).unwrap();
        assert_eq!(caries.surface(), Some(Surface::Occlusal));
        assert_eq!(caries.data().note.as_deref(), Some("deep"));
        assert_eq!(
            ChartEntry::new(36, Some("O"), "crown", None),
            Err(ChartError::WholeTooth("crown"))
        );
        assert_eq!(
            ChartEntry::new(36, Some("X"), "caries", None),
            Err(ChartError::Surface)
        );
        assert_eq!(
            ChartEntry::new(36, None, "decay", None),
            Err(ChartError::Finding)
        );
        assert_eq!(
            surfaces(["d", "O", "D"]).unwrap(),
            [Surface::Occlusal, Surface::Distal]
        );
    }

    #[test]
    fn whole_tooth_findings_replace_surface_entries() {
        let crown = ChartEntry::new(36, None, "crown", None).unwrap();
        assert!(crown.replaces(None));
        assert!(crown.replaces(Some(Surface::Occlusal)));
        let root_canal = ChartEntry::new(36, None, "root_canal", None).unwrap();
        assert!(!root_canal.replaces(Some(Surface::Occlusal)));
        let filled = ChartEntry::new(36, Some("O"), "filled", None).unwrap();
        assert!(filled.replaces(Some(Surface::Occlusal)));
        assert!(!filled.replaces(Some(Surface::Distal)));
        assert!(!filled.replaces(None));
    }
}
