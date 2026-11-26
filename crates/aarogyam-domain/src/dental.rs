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
/// version 3 added a root canal's canals and sitting; version 4 added a caries entry's depth.
/// Older entries read as having none.
pub const SCHEMA_VERSION: i32 = 4;
/// The record kind of a tooth's health status: one current per tooth, superseded by the next.
pub const STATUS_KIND: &str = "tooth_status";
/// The version of [`ToothStatus`]'s JSON shape.
pub const STATUS_SCHEMA_VERSION: i32 = 1;
/// The months a doctor may advise treating a tooth within.
pub const TREAT_WITHIN_MONTHS: [u8; 4] = [1, 3, 6, 12];

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
    /// Done elsewhere on a finding that isn't work (sound, caries, watch, fractured).
    #[error(
        "elsewhere applies only to work: filled, crown, implant, root_canal, bridge or missing"
    )]
    Elsewhere,
    /// Done elsewhere together with in progress: work from elsewhere arrives finished.
    #[error("elsewhere can't be in progress; record finished work from elsewhere")]
    ElsewhereInProgress,
    /// Not a tooth health.
    #[error("health must be healthy, watch or needs_treatment")]
    Health,
    /// Advice outside 1, 3, 6 or 12 months.
    #[error("treat_within_months must be 1, 3, 6 or 12")]
    TreatWithin,
    /// Advice on a healthy tooth.
    #[error("treat_within_months goes with watch or needs_treatment, not healthy")]
    TreatWithinHealthy,
    /// Not a decay depth.
    #[error("caries_depth must be enamel, dentin or near_pulp")]
    CariesDepth,
    /// A decay depth on a finding that isn't caries.
    #[error("caries_depth belongs to a caries finding")]
    CariesDepthOnly,
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

    /// Whether the finding is work a dentist did (a missing tooth counts as extracted), so it
    /// may have been done elsewhere.
    #[must_use]
    pub const fn is_work(self) -> bool {
        matches!(
            self,
            Self::Filled
                | Self::Crown
                | Self::Implant
                | Self::RootCanal
                | Self::Bridge
                | Self::Missing
        )
    }
}

text_enum!(
    /// How deep a cavity reaches, recorded on a `caries` entry (schema version 4).
    CariesDepth {
        /// Only the outer enamel.
        Enamel => "enamel",
        /// Into the dentin.
        Dentin => "dentin",
        /// Close to the nerve (pulp).
        NearPulp => "near_pulp",
    }
);

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
    in_progress: bool,
    elsewhere: bool,
    caries_depth: Option<CariesDepth>,
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
    /// The treatment is started but not finished (a root canal between sittings, a crown in the lab).
    pub in_progress: bool,
    /// The work was done by another dentist, before or outside this clinic.
    pub elsewhere: bool,
    /// How deep the decay reaches (only with `caries`).
    pub caries_depth: Option<&'a str>,
}

/// The JSON shape stored in `specialty_records.data` (schema version 4).
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
    /// Treatment started, not finished (additive, no version bump: absent reads as finished).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub in_progress: bool,
    /// Work done by another dentist (additive, no version bump: absent reads as done here).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub elsewhere: bool,
    /// How deep a cavity reaches: `enamel`, `dentin` or `near_pulp` (version 4, caries only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caries_depth: Option<String>,
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
        if detail.elsewhere && !finding.is_work() {
            return Err(ChartError::Elsewhere);
        }
        if detail.elsewhere && detail.in_progress {
            return Err(ChartError::ElsewhereInProgress);
        }
        if finding != Finding::RootCanal && (!detail.canals.is_empty() || detail.sitting.is_some())
        {
            return Err(ChartError::RootCanalOnly);
        }
        let caries_depth = match detail.caries_depth.map(str::trim) {
            None | Some("") => None,
            Some(text) => {
                if finding != Finding::Caries {
                    return Err(ChartError::CariesDepthOnly);
                }
                Some(CariesDepth::parse(text).map_err(|_| ChartError::CariesDepth)?)
            }
        };
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
            in_progress: detail.in_progress && finding != Finding::Sound,
            elsewhere: detail.elsewhere,
            caries_depth,
        })
    }

    /// How deep the decay reaches, when recorded.
    #[must_use]
    pub const fn caries_depth(&self) -> Option<CariesDepth> {
        self.caries_depth
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

    /// Whether the treatment is started but not finished.
    #[must_use]
    pub const fn in_progress(&self) -> bool {
        self.in_progress
    }

    /// Whether the work was done by another dentist.
    #[must_use]
    pub const fn elsewhere(&self) -> bool {
        self.elsewhere
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
            in_progress: self.in_progress,
            elsewhere: self.elsewhere,
            caries_depth: self.caries_depth.map(|d| d.as_str().to_owned()),
        }
    }

    /// Whether recording this entry replaces a current entry at `surface` of the same tooth:
    /// the same key always; every surface when the finding covers the whole tooth.
    #[must_use]
    pub fn replaces(&self, surface: Option<Surface>) -> bool {
        surface == self.surface || (self.surface.is_none() && self.finding.replaces_surfaces())
    }
}

text_enum!(
    /// How a tooth is, as the doctor judges it. Without a status the portal derives it from the
    /// chart's findings; a status overrides that.
    ToothHealth {
        /// Nothing to do.
        Healthy => "healthy",
        /// Look again at the next visit (the same meaning as the `watch` finding).
        Watch => "watch",
        /// Needs treatment.
        NeedsTreatment => "needs_treatment",
    }
);

/// A doctor's judgement of one tooth: its health, a one-line note, and optional advice on how
/// soon to treat it. Stored as a `specialty_records` row of kind [`STATUS_KIND`], no surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToothStatus {
    tooth: Tooth,
    health: ToothHealth,
    note: Option<String>,
    treat_within_months: Option<u8>,
}

/// The JSON shape of a [`ToothStatus`] in `specialty_records.data`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ToothStatusData {
    /// FDI tooth number.
    pub tooth: u8,
    /// `healthy`, `watch` or `needs_treatment`.
    pub health: String,
    /// The doctor's note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Advice: treat within this many months.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub treat_within_months: Option<u8>,
}

impl ToothStatus {
    /// Validates a status: an FDI tooth, a known health, a note of at most 500 characters
    /// (trimmed; empty is none), and advice of 1, 3, 6 or 12 months only on a tooth to watch or
    /// treat.
    ///
    /// # Errors
    /// [`ChartError::Tooth`], [`ChartError::Health`], [`ChartError::Note`],
    /// [`ChartError::TreatWithin`] or [`ChartError::TreatWithinHealthy`].
    pub fn new(
        tooth: i64,
        health: &str,
        note: Option<&str>,
        treat_within_months: Option<i64>,
    ) -> Result<Self, ChartError> {
        let tooth = Tooth::new(tooth)?;
        let health = ToothHealth::parse(health.trim()).map_err(|_| ChartError::Health)?;
        let note = optional_text(note, 500).map_err(|_: ClinicalError| ChartError::Note)?;
        let treat_within_months = match treat_within_months {
            None => None,
            Some(months) => {
                let months = u8::try_from(months)
                    .ok()
                    .filter(|m| TREAT_WITHIN_MONTHS.contains(m))
                    .ok_or(ChartError::TreatWithin)?;
                if health == ToothHealth::Healthy {
                    return Err(ChartError::TreatWithinHealthy);
                }
                Some(months)
            }
        };
        Ok(Self {
            tooth,
            health,
            note,
            treat_within_months,
        })
    }

    /// The tooth.
    #[must_use]
    pub const fn tooth(&self) -> Tooth {
        self.tooth
    }

    /// The health.
    #[must_use]
    pub const fn health(&self) -> ToothHealth {
        self.health
    }

    /// The JSON stored for the status.
    #[must_use]
    pub fn data(&self) -> ToothStatusData {
        ToothStatusData {
            tooth: self.tooth.number(),
            health: self.health.as_str().to_owned(),
            note: self.note.clone(),
            treat_within_months: self.treat_within_months,
        }
    }
}

/// The longest free-text note on a tooth, in characters.
pub const TOOTH_NOTE_MAX: usize = 2000;

/// A free-text note on a tooth: trimmed, 1 to 2000 characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToothNoteBody(String);

impl ToothNoteBody {
    /// Trims `text` and checks its length.
    ///
    /// # Errors
    /// [`ToothNoteError`] when it is empty after trimming or over 2000 characters.
    pub fn new(text: &str) -> Result<Self, ToothNoteError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(ToothNoteError::Empty);
        }
        if text.chars().count() > TOOTH_NOTE_MAX {
            return Err(ToothNoteError::TooLong);
        }
        Ok(Self(text.to_owned()))
    }

    /// The text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Why a tooth note was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ToothNoteError {
    /// Nothing to save.
    #[error("the note is empty")]
    Empty,
    /// Over the limit.
    #[error("the note must be at most 2000 characters")]
    TooLong,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tooth_note_is_trimmed_and_bounded() {
        assert_eq!(
            ToothNoteBody::new("  sensitive  ").map(|n| n.as_str().to_owned()),
            Ok("sensitive".to_owned())
        );
        assert_eq!(ToothNoteBody::new("   "), Err(ToothNoteError::Empty));
        assert!(ToothNoteBody::new(&"x".repeat(2000)).is_ok());
        assert_eq!(
            ToothNoteBody::new(&"x".repeat(2001)),
            Err(ToothNoteError::TooLong)
        );
    }

    fn note(text: &str) -> Detail<'_> {
        Detail {
            note: Some(text),
            ..Detail::default()
        }
    }

    #[test]
    fn caries_depth_goes_only_with_caries() {
        let depth = |text| Detail {
            caries_depth: Some(text),
            ..Detail::default()
        };
        let deep = ChartEntry::new(36, Some("O"), "caries", depth("near_pulp")).unwrap();
        assert_eq!(deep.caries_depth(), Some(CariesDepth::NearPulp));
        assert_eq!(deep.data().caries_depth.as_deref(), Some("near_pulp"));
        assert_eq!(
            ChartEntry::new(36, Some("O"), "filled", depth("enamel")),
            Err(ChartError::CariesDepthOnly)
        );
        assert_eq!(
            ChartEntry::new(36, Some("O"), "caries", depth("deep")),
            Err(ChartError::CariesDepth)
        );
        // Older entries read as having no depth.
        let old: ChartData =
            serde_json::from_str(r#"{"tooth":36,"surface":"O","finding":"caries"}"#).unwrap();
        assert_eq!(old.caries_depth, None);
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
    fn in_progress_is_stored_only_when_set_and_never_on_sound() {
        let tooth = |finding, in_progress| {
            ChartEntry::new(
                46,
                None,
                finding,
                Detail {
                    in_progress,
                    ..Detail::default()
                },
            )
            .unwrap()
        };
        let json = serde_json::to_value(tooth("crown", true).data()).unwrap();
        assert_eq!(json["in_progress"], true);
        assert!(tooth("crown", true).in_progress());
        let json = serde_json::to_value(tooth("crown", false).data()).unwrap();
        assert!(json.get("in_progress").is_none());
        assert!(!tooth("sound", true).in_progress());
        let old: ChartData =
            serde_json::from_value(serde_json::json!({ "tooth": 46, "finding": "crown" })).unwrap();
        assert!(!old.in_progress);
    }

    #[test]
    fn elsewhere_is_only_finished_work() {
        let tooth = |finding, elsewhere, in_progress| {
            ChartEntry::new(
                46,
                None,
                finding,
                Detail {
                    in_progress,
                    elsewhere,
                    ..Detail::default()
                },
            )
        };
        for work in [
            "filled",
            "crown",
            "implant",
            "root_canal",
            "bridge",
            "missing",
        ] {
            let entry = tooth(work, true, false).unwrap();
            assert!(entry.elsewhere());
            assert_eq!(
                serde_json::to_value(entry.data()).unwrap()["elsewhere"],
                true
            );
        }
        for other in ["sound", "caries", "watch", "fractured"] {
            assert_eq!(tooth(other, true, false), Err(ChartError::Elsewhere));
        }
        assert_eq!(
            tooth("crown", true, true),
            Err(ChartError::ElsewhereInProgress)
        );
        let here = serde_json::to_value(tooth("crown", false, false).unwrap().data()).unwrap();
        assert!(here.get("elsewhere").is_none());
        let old: ChartData =
            serde_json::from_value(serde_json::json!({ "tooth": 46, "finding": "crown" })).unwrap();
        assert!(!old.elsewhere);
    }

    #[test]
    fn a_tooth_status_is_checked() {
        let status =
            ToothStatus::new(36, "needs_treatment", Some("  deep caries  "), Some(3)).unwrap();
        assert_eq!(status.health(), ToothHealth::NeedsTreatment);
        let data = status.data();
        assert_eq!(data.note.as_deref(), Some("deep caries"));
        assert_eq!(data.treat_within_months, Some(3));
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["health"], "needs_treatment");
        assert!(json.get("surface").is_none());
        let plain = ToothStatus::new(11, "healthy", Some("  "), None)
            .unwrap()
            .data();
        assert_eq!(plain.note, None);
        assert!(ToothStatus::new(21, "watch", None, Some(12)).is_ok());
        assert_eq!(
            ToothStatus::new(19, "healthy", None, None),
            Err(ChartError::Tooth)
        );
        assert_eq!(
            ToothStatus::new(11, "critical", None, None),
            Err(ChartError::Health)
        );
        assert_eq!(
            ToothStatus::new(11, "watch", Some(&"x".repeat(501)), None),
            Err(ChartError::Note)
        );
        assert_eq!(
            ToothStatus::new(11, "watch", None, Some(2)),
            Err(ChartError::TreatWithin)
        );
        assert_eq!(
            ToothStatus::new(11, "watch", None, Some(300)),
            Err(ChartError::TreatWithin)
        );
        assert_eq!(
            ToothStatus::new(11, "healthy", None, Some(3)),
            Err(ChartError::TreatWithinHealthy)
        );
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
