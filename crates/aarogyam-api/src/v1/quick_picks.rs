//! Quick picks: the clinic's specialty one-tap entries (specialty data, the same for every
//! clinic of a specialty).

use aarogyam_domain::permission::require::{ClinicalRead, PatientsRead};
use aarogyam_domain::quick_picks::{self, MedicineSet, Pick, TextPick};
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::extract::RequireEither;
use crate::failure::ApiFailure;

/// A pick that is only a name: an allergy substance or a procedure.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuickPick {
    /// Stable id.
    pub id: String,
    /// What staff read and what is recorded.
    pub label: String,
}

/// A pick that writes a line: a complaint, a finding or an advice line.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuickTextPick {
    /// Stable id.
    pub id: String,
    /// The chip's label.
    pub label: String,
    /// The line it writes.
    pub text: String,
}

/// One medicine of a set, as a prescription line starts.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuickSetMedicine {
    /// Generic name; match it to the medicine list before adding.
    pub drug_name: String,
    /// Strength, such as `500 mg`.
    pub strength: String,
    /// Form, such as `tablet`.
    pub form: String,
    /// Dose, such as `1 tablet`.
    pub dose: String,
    /// Frequency, such as `1-0-1`.
    pub frequency: String,
    /// `before_food`, `after_food`, `empty_stomach`, `bedtime`, `sos` or `as_directed`.
    pub timing: Option<String>,
    /// For how many days.
    pub duration_days: Option<u16>,
    /// Extra instructions.
    pub instructions: Option<String>,
}

/// Several medicines added in one tap, each still editable; the allergy check still runs on issue.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuickMedicineSet {
    /// Stable id.
    pub id: String,
    /// The chip's label, such as `Post-extraction`.
    pub label: String,
    /// The medicines, in order.
    pub items: Vec<QuickSetMedicine>,
}

/// The clinic's quick picks.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuickPicks {
    /// Common allergy substances, offered at a walk-in.
    pub allergies: Vec<QuickPick>,
    /// Chief complaints: each writes the note's opening line.
    pub complaints: Vec<QuickTextPick>,
    /// Examination findings.
    pub findings: Vec<QuickTextPick>,
    /// Procedures done in a visit.
    pub procedures: Vec<QuickPick>,
    /// Advice lines for the prescription.
    pub advice: Vec<QuickTextPick>,
    /// Medicine sets.
    pub medicine_sets: Vec<QuickMedicineSet>,
}

fn pick(p: &Pick) -> QuickPick {
    QuickPick {
        id: p.id.clone(),
        label: p.label.clone(),
    }
}

fn text_pick(p: &TextPick) -> QuickTextPick {
    QuickTextPick {
        id: p.id.clone(),
        label: p.label.clone(),
        text: p.text.clone(),
    }
}

fn set(s: &MedicineSet) -> QuickMedicineSet {
    QuickMedicineSet {
        id: s.id.clone(),
        label: s.label.clone(),
        items: s
            .items
            .iter()
            .map(|m| QuickSetMedicine {
                drug_name: m.drug_name.clone(),
                strength: m.strength.clone(),
                form: m.form.clone(),
                dose: m.dose.clone(),
                frequency: m.frequency.clone(),
                timing: m.timing.clone(),
                duration_days: m.duration_days,
                instructions: m.instructions.clone(),
            })
            .collect(),
    }
}

/// The clinic's quick picks: allergies for the desk, complaints, findings, procedures, advice
/// lines and medicine sets for the doctor. Specialty data; dental for now.
#[utoipa::path(
    get,
    path = "/api/v1/quick-picks",
    operation_id = "getQuickPicks",
    tag = "clinical",
    security(("bearer" = [])),
    responses(
        (status = 200, body = QuickPicks),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks both patients.read and clinical.read")
    )
)]
pub(crate) async fn get(
    _: RequireEither<PatientsRead, ClinicalRead>,
) -> Result<Json<QuickPicks>, ApiFailure> {
    let picks = quick_picks::dental();
    Ok(Json(QuickPicks {
        allergies: picks.allergies.iter().map(pick).collect(),
        complaints: picks.complaints.iter().map(text_pick).collect(),
        findings: picks.findings.iter().map(text_pick).collect(),
        procedures: picks.procedures.iter().map(pick).collect(),
        advice: picks.advice.iter().map(text_pick).collect(),
        medicine_sets: picks.medicine_sets.iter().map(set).collect(),
    }))
}
