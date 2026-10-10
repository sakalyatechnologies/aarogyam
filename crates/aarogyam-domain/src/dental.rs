//! The dental chart: FDI tooth numbers, surfaces, findings, and which current entries a new
//! entry replaces. Entries are stored as `specialty_records` rows (module `dental`, kind
//! `tooth`); each new entry supersedes the current one for the same tooth and surface.

use std::fmt;

use crate::clinical::{ClinicalError, optional_text, text_enum};
use crate::dental_terms::{TermKind, TermRef};

/// The specialty module the chart belongs to.
pub const MODULE: &str = "dental";
/// The record kind of a chart entry.
pub const KIND: &str = "tooth";
/// The version of [`ChartEntry`]'s JSON shape. Version 2 added the procedure and material;
/// version 3 added a root canal's canals and sitting. Older entries read as having none.
pub const SCHEMA_VERSION: i32 = 3;

/// Most canals one root canal entry lists (an upper molar has four or five).
pub const MAX_CANALS: usize = 8;
/// Longest canal name, such as `MB2`.
pub const CANAL_NAME_MAX: usize = 20;
/// Longest working length recorded, in millimetres.
pub const WORKING_LENGTH_MAX_MM: f64 = 40.0;
/// Most sittings (visits) a root canal treatment is recorded over.
pub const MAX_SITTING: u8 = 20;

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
    /// Not a procedure of the vocabulary.
    #[error("unknown procedure")]
    Procedure,
    /// Not a material of the vocabulary.
    #[error("unknown material")]
    Material,
    /// A sound tooth was given a procedure or material.
    #[error("sound clears the tooth; leave the procedure and material out")]
    SoundWithDetail,
    /// Canals or a sitting on a finding that isn't a root canal.
    #[error("canals and sitting belong to a root_canal finding")]
    RootCanalOnly,
    /// Too many canals, or one repeated.
    #[error("list 1 to 8 canals, each name once")]
    Canals,
    /// A canal's name is empty or too long.
    #[error("a canal name must be 1 to 20 characters")]
    CanalName,
    /// A working length that isn't a length.
    #[error("working_length_mm must be more than 0 and at most 40")]
    WorkingLength,
    /// A sitting outside 1 to 20.
    #[error("sitting must be 1 to 20")]
    Sitting,
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

/// One canal of a root canal treatment: its name and, once measured, its working length.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Canal {
    /// What the clinician calls it: `MB`, `MB2`, `DB`, `P`, `Distal`.
    pub name: String,
    /// The working length in millimetres, when measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_length_mm: Option<f64>,
}

impl Canal {
    /// Validates the canals of a root canal entry: 1 to 8, each name (ignoring case) once, each
    /// working length above 0 and at most 40 mm, kept to two decimals.
    ///
    /// # Errors
    /// The [`ChartError`] that applies.
    pub fn check_all(canals: &[Self]) -> Result<Vec<Self>, ChartError> {
        if canals.is_empty() || canals.len() > MAX_CANALS {
            return Err(ChartError::Canals);
        }
        let mut checked: Vec<Self> = Vec::with_capacity(canals.len());
        for canal in canals {
            let name = canal.name.trim();
            if name.is_empty() || name.chars().count() > CANAL_NAME_MAX || name.contains('\n') {
                return Err(ChartError::CanalName);
            }
            if checked.iter().any(|c| c.name.eq_ignore_ascii_case(name)) {
                return Err(ChartError::Canals);
            }
            let working_length_mm = match canal.working_length_mm {
                None => None,
                Some(mm) if mm.is_finite() && mm > 0.0 && mm <= WORKING_LENGTH_MAX_MM => {
                    Some((mm * 100.0).round() / 100.0)
                }
                Some(_) => return Err(ChartError::WorkingLength),
            };
            checked.push(Self {
                name: name.to_owned(),
                working_length_mm,
            });
        }
        Ok(checked)
    }
}

/// One chart entry: a finding on a tooth, or on one of its surfaces. Stored as the
/// `specialty_records.data` JSON.
#[derive(Debug, Clone, PartialEq)]
pub struct ChartEntry {
    tooth: Tooth,
    surface: Option<Surface>,
    finding: Finding,
    procedure: Option<TermRef>,
    material: Option<TermRef>,
    note: Option<String>,
    canals: Vec<Canal>,
    sitting: Option<u8>,
}

/// What else an entry says besides tooth, surface and finding: procedure and material ids
/// (seeded ids or clinic term UUIDs) and a remark.
#[derive(Debug, Clone, Copy, Default)]
pub struct Detail<'a> {
    /// Procedure id.
    pub procedure: Option<&'a str>,
    /// Material id.
    pub material: Option<&'a str>,
    /// The clinician's remark.
    pub note: Option<&'a str>,
    /// A root canal's canals; empty for none.
    pub canals: &'a [Canal],
    /// A root canal's sitting (which visit of the treatment this is).
    pub sitting: Option<i64>,
}

/// The JSON shape stored in `specialty_records.data` (schema version 3).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartData {
    /// FDI tooth number.
    pub tooth: u8,
    /// Surface letter, or none for the whole tooth.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    /// Finding value.
    pub finding: String,
    /// What was done: a seeded procedure id or a clinic term's UUID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub procedure: Option<String>,
    /// What it was done with: a seeded material id or a clinic term's UUID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// The clinician's remark.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// A root canal's canals (version 3).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub canals: Vec<Canal>,
    /// A root canal's sitting (version 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sitting: Option<u8>,
}

impl ChartEntry {
    /// Validates an entry. A clinic term (a UUID) is only checked for shape here; the caller
    /// checks that the clinic has it.
    ///
    /// # Errors
    /// The [`ChartError`] that applies.
    pub fn new(
        tooth: i64,
        surface: Option<&str>,
        finding: &str,
        detail: Detail<'_>,
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
        let term = |kind, text: Option<&str>, error| match text.map(str::trim) {
            None | Some("") => Ok(None),
            Some(text) => TermRef::parse(kind, text).map(Some).map_err(|_| error),
        };
        let procedure = term(TermKind::Procedure, detail.procedure, ChartError::Procedure)?;
        let material = term(TermKind::Material, detail.material, ChartError::Material)?;
        if finding == Finding::Sound && (procedure.is_some() || material.is_some()) {
            return Err(ChartError::SoundWithDetail);
        }
        let note = optional_text(detail.note, 500).map_err(|_: ClinicalError| ChartError::Note)?;
        if finding != Finding::RootCanal && (!detail.canals.is_empty() || detail.sitting.is_some())
        {
            return Err(ChartError::RootCanalOnly);
        }
        let canals = if detail.canals.is_empty() {
            Vec::new()
        } else {
            Canal::check_all(detail.canals)?
        };
        let sitting = detail
            .sitting
            .map(|n| {
                u8::try_from(n)
                    .ok()
                    .filter(|n| (1..=MAX_SITTING).contains(n))
            })
            .map(|n| n.ok_or(ChartError::Sitting))
            .transpose()?;
        Ok(Self {
            tooth,
            surface,
            finding,
            procedure,
            material,
            note,
            canals,
            sitting,
        })
    }

    /// The procedure, if recorded.
    #[must_use]
    pub const fn procedure(&self) -> Option<TermRef> {
        self.procedure
    }

    /// The material, if recorded.
    #[must_use]
    pub const fn material(&self) -> Option<TermRef> {
        self.material
    }

    /// A root canal's canals; empty for any other entry.
    #[must_use]
    pub fn canals(&self) -> &[Canal] {
        &self.canals
    }

    /// A root canal's sitting.
    #[must_use]
    pub const fn sitting(&self) -> Option<u8> {
        self.sitting
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
            procedure: self.procedure.map(TermRef::id_text),
            material: self.material.map(TermRef::id_text),
            note: self.note.clone(),
            canals: self.canals.clone(),
            sitting: self.sitting,
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

    fn note(text: &str) -> Detail<'_> {
        Detail {
            note: Some(text),
            ..Detail::default()
        }
    }

    #[test]
    fn entries_name_procedure_and_material_from_the_vocabulary() {
        let detail = |procedure, material| Detail {
            procedure,
            material,
            ..Detail::default()
        };
        let crown =
            ChartEntry::new(16, None, "crown", detail(Some("crown"), Some("zirconia"))).unwrap();
        assert_eq!(crown.data().procedure.as_deref(), Some("crown"));
        assert_eq!(crown.data().material.as_deref(), Some("zirconia"));
        assert_eq!(
            ChartEntry::new(16, None, "crown", detail(Some("zirconia"), None)),
            Err(ChartError::Procedure)
        );
        assert_eq!(
            ChartEntry::new(16, None, "crown", detail(None, Some("unobtainium"))),
            Err(ChartError::Material)
        );
        assert_eq!(
            ChartEntry::new(16, None, "sound", detail(None, Some("gold"))),
            Err(ChartError::SoundWithDetail)
        );
        let clinic = "0190a7c2-0000-7000-8000-000000000001";
        let own = ChartEntry::new(16, Some("O"), "filled", detail(None, Some(clinic))).unwrap();
        assert!(own.material().and_then(TermRef::clinic).is_some());
        // Version 1 entries read without procedure or material.
        let old: ChartData =
            serde_json::from_str(r#"{"tooth":36,"surface":"O","finding":"caries"}"#).unwrap();
        assert_eq!(old.material, None);
    }

    fn canal(name: &str, mm: Option<f64>) -> Canal {
        Canal {
            name: name.to_owned(),
            working_length_mm: mm,
        }
    }

    #[test]
    fn root_canal_entries_carry_canals_and_a_sitting() {
        let canals = [
            canal("MB", Some(20.5)),
            canal(" DB ", Some(19.126)),
            canal("P", None),
        ];
        let entry = ChartEntry::new(
            16,
            None,
            "root_canal",
            Detail {
                canals: &canals,
                sitting: Some(2),
                ..Detail::default()
            },
        )
        .unwrap();
        assert_eq!(entry.sitting(), Some(2));
        let data = entry.data();
        assert_eq!(data.canals[1], canal("DB", Some(19.13)));
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["canals"][0]["working_length_mm"], 20.5);
        assert_eq!(json["canals"][2], serde_json::json!({ "name": "P" }));
        // Entries without them read and write as before.
        let plain = ChartEntry::new(16, None, "root_canal", Detail::default()).unwrap();
        let json = serde_json::to_value(plain.data()).unwrap();
        assert!(json.get("canals").is_none() && json.get("sitting").is_none());
        let old: ChartData =
            serde_json::from_str(r#"{"tooth":16,"finding":"root_canal"}"#).unwrap();
        assert!(old.canals.is_empty() && old.sitting.is_none());
    }

    #[test]
    fn canals_and_sitting_are_checked() {
        let with = |finding, canals: &[Canal], sitting| {
            ChartEntry::new(
                16,
                None,
                finding,
                Detail {
                    canals,
                    sitting,
                    ..Detail::default()
                },
            )
        };
        let one = [canal("MB", Some(20.0))];
        assert_eq!(with("filled", &one, None), Err(ChartError::RootCanalOnly));
        assert_eq!(with("crown", &[], Some(1)), Err(ChartError::RootCanalOnly));
        assert_eq!(with("root_canal", &[], Some(0)), Err(ChartError::Sitting));
        assert_eq!(with("root_canal", &[], Some(21)), Err(ChartError::Sitting));
        assert_eq!(with("root_canal", &[], Some(-1)), Err(ChartError::Sitting));
        for bad in [0.0, -1.0, 40.5, f64::NAN, f64::INFINITY] {
            assert_eq!(
                with("root_canal", &[canal("MB", Some(bad))], None),
                Err(ChartError::WorkingLength),
                "{bad}"
            );
        }
        assert_eq!(
            with("root_canal", &[canal("MB", None), canal("mb", None)], None),
            Err(ChartError::Canals)
        );
        assert_eq!(
            with("root_canal", &[canal("  ", None)], None),
            Err(ChartError::CanalName)
        );
        assert_eq!(
            with("root_canal", &[canal(&"x".repeat(21), None)], None),
            Err(ChartError::CanalName)
        );
        let nine: Vec<Canal> = (0..9).map(|n| canal(&format!("C{n}"), None)).collect();
        assert_eq!(with("root_canal", &nine, None), Err(ChartError::Canals));
        assert!(with("root_canal", &one, Some(1)).is_ok());
    }

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
        let caries = ChartEntry::new(36, Some("o"), "caries", note(" deep ")).unwrap();
        assert_eq!(caries.surface(), Some(Surface::Occlusal));
        assert_eq!(caries.data().note.as_deref(), Some("deep"));
        assert_eq!(
            ChartEntry::new(36, Some("O"), "crown", Detail::default()),
            Err(ChartError::WholeTooth("crown"))
        );
        assert_eq!(
            ChartEntry::new(36, Some("X"), "caries", Detail::default()),
            Err(ChartError::Surface)
        );
        assert_eq!(
            ChartEntry::new(36, None, "decay", Detail::default()),
            Err(ChartError::Finding)
        );
        assert_eq!(
            surfaces(["d", "O", "D"]).unwrap(),
            [Surface::Occlusal, Surface::Distal]
        );
    }

    #[test]
    fn whole_tooth_findings_replace_surface_entries() {
        let crown = ChartEntry::new(36, None, "crown", Detail::default()).unwrap();
        assert!(crown.replaces(None));
        assert!(crown.replaces(Some(Surface::Occlusal)));
        let root_canal = ChartEntry::new(36, None, "root_canal", Detail::default()).unwrap();
        assert!(!root_canal.replaces(Some(Surface::Occlusal)));
        let filled = ChartEntry::new(36, Some("O"), "filled", Detail::default()).unwrap();
        assert!(filled.replaces(Some(Surface::Occlusal)));
        assert!(!filled.replaces(Some(Surface::Distal)));
        assert!(!filled.replaces(None));
    }
}
