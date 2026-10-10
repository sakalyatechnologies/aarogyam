//! Quick picks: the clinic's specialty one-tap entries (specialty data, the same for every
//! clinic of a specialty).

use aarogyam_app::medicine_sets as app;
use aarogyam_domain::permission::require::{ClinicalRead, PatientsRead};
use aarogyam_domain::quick_picks::{self, MedicineSet, Pick, SetMedicine, TextPick};
use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use crate::AppState;
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

impl QuickSetMedicine {
    /// A set's medicine as the API shows it.
    pub(crate) fn from_set(m: &SetMedicine) -> Self {
        Self {
            drug_name: m.drug_name.clone(),
            strength: m.strength.clone(),
            form: m.form.clone(),
            dose: m.dose.clone(),
            frequency: m.frequency.clone(),
            timing: m.timing.clone(),
            duration_days: m.duration_days,
            instructions: m.instructions.clone(),
        }
    }
}

/// Several medicines added in one tap, each still editable; the allergy check still runs on issue.
#[derive(Debug, Serialize, ToSchema)]
pub struct QuickMedicineSet {
    /// Stable id: the specialty's own, or a clinic set's UUID.
    pub id: String,
    /// The chip's label, such as `Post-extraction`.
    pub label: String,
    /// The medicines, in order.
    pub items: Vec<QuickSetMedicine>,
    /// Made by this clinic (`/medicine-sets`) rather than the specialty's own.
    pub own: bool,
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
        items: s.items.iter().map(QuickSetMedicine::from_set).collect(),
        own: false,
    }
}

/// The clinic's quick picks: allergies for the desk, complaints, findings, procedures, advice
/// lines and medicine sets for the doctor. Specialty data, dental for now; the medicine sets
/// also include the clinic's own (`own: true`, managed at `/medicine-sets`).
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
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<PatientsRead, ClinicalRead>,
) -> Result<Json<QuickPicks>, ApiFailure> {
    let picks = quick_picks::dental();
    // The specialty's sets first, then the clinic's own (`own: true`).
    let own = app::list_any(state.db(), &request.actor, request.request_id).await?;
    let medicine_sets = picks
        .medicine_sets
        .iter()
        .map(set)
        .chain(own.into_iter().map(|view| QuickMedicineSet {
            id: view.id.uuid().to_string(),
            label: view.label,
            items: view.items.iter().map(QuickSetMedicine::from_set).collect(),
            own: true,
        }))
        .collect();
    Ok(Json(QuickPicks {
        allergies: picks.allergies.iter().map(pick).collect(),
        complaints: picks.complaints.iter().map(text_pick).collect(),
        findings: picks.findings.iter().map(text_pick).collect(),
        procedures: picks.procedures.iter().map(pick).collect(),
        advice: picks.advice.iter().map(text_pick).collect(),
        medicine_sets,
    }))
}
