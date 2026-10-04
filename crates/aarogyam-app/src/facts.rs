//! Conditions and allergies: the patient-level facts behind the clinical flags banner.

use aarogyam_dal::facts::{self, AllergyRow, AllergyValues, ConditionRow, ConditionValues};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{
    CodeSystem, FactStatus, RecordSource, Severity, clinical_text, optional_text,
};
use aarogyam_domain::ids::{AllergyId, ConditionId, EncounterId, MembershipId, PatientId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, DbErrorKind, ScopedTx};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::{invalid, require_patient};
use crate::vitals::staff_source;

/// An optional clinical code as received: both parts, or neither.
#[derive(Debug, Clone, Default)]
pub struct CodeInput {
    /// `icd10`, `icd11`, `snomed`, `loinc` or `custom`.
    pub system: Option<String>,
    /// The code.
    pub code: Option<String>,
}

fn parse_code(input: &CodeInput) -> Result<Option<(CodeSystem, String)>, AppError> {
    let code = optional_text(input.code.as_deref(), 40).map_err(invalid("code"))?;
    match (input.system.as_deref().map(str::trim), code) {
        (None | Some(""), None) => Ok(None),
        (Some(system), Some(code)) if !system.is_empty() => Ok(Some((
            CodeSystem::parse(system).map_err(invalid("code_system"))?,
            code,
        ))),
        _ => Err(AppError::invalid(
            "code",
            "give code_system and code together",
        )),
    }
}

/// A condition on the problem list.
#[derive(Debug, Clone)]
pub struct ConditionView {
    /// Identifier.
    pub id: ConditionId,
    /// The visit it was found in.
    pub visit_id: Option<EncounterId>,
    /// What the doctor wrote.
    pub display_text: String,
    /// Code system and code, when coded.
    pub code: Option<(CodeSystem, String)>,
    /// Whether it applies now.
    pub status: FactStatus,
    /// Shown in the clinical flags banner while active.
    pub flagged: bool,
    /// When it began.
    pub onset: Option<Date>,
    /// A remark.
    pub note: Option<String>,
    /// Who or what it came from.
    pub source: RecordSource,
    /// The member who recorded or last confirmed it.
    pub verified_by: Option<MembershipId>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

fn stored_code(system: Option<&str>, code: Option<String>) -> Option<(CodeSystem, String)> {
    match (system.map(CodeSystem::parse), code) {
        (Some(Ok(system)), Some(code)) => Some((system, code)),
        _ => None,
    }
}

fn condition_view(row: ConditionRow) -> Result<ConditionView, AppError> {
    Ok(ConditionView {
        id: ConditionId::from_uuid(row.id),
        visit_id: row.encounter_id.map(EncounterId::from_uuid),
        display_text: row.display_text,
        code: stored_code(row.code_system.as_deref(), row.code),
        status: FactStatus::parse(&row.status).map_err(invalid("status"))?,
        flagged: row.flagged,
        onset: row.onset,
        note: row.note,
        source: RecordSource::parse(&row.source).map_err(invalid("source"))?,
        verified_by: row.verified_by.map(MembershipId::from_uuid),
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// A condition as received. On an edit, absent fields stay as they are.
#[derive(Debug, Clone, Default)]
pub struct ConditionInput {
    /// What the doctor wrote; required for a new condition.
    pub display_text: Option<String>,
    /// Optional code; an empty code clears it.
    pub code: Option<CodeInput>,
    /// `active` (default), `resolved` or `entered_in_error`.
    pub status: Option<String>,
    /// Show in the flags banner while active.
    pub flagged: Option<bool>,
    /// When it began; `Some(None)` clears it.
    pub onset: Option<Option<Date>>,
    /// A remark; empty clears it.
    pub note: Option<String>,
    /// `clinician` (default), `assistant`, `patient` or `import`.
    pub source: Option<String>,
    /// The visit it was found in (new conditions only).
    pub visit_id: Option<Uuid>,
}

struct Condition {
    display_text: String,
    code: Option<(CodeSystem, String)>,
    status: FactStatus,
    flagged: bool,
    onset: Option<Date>,
    note: Option<String>,
    source: RecordSource,
}

fn merge_condition(
    current: Option<&ConditionRow>,
    input: &ConditionInput,
    today: Date,
) -> Result<Condition, AppError> {
    let display_text = match (&input.display_text, current) {
        (Some(text), _) => clinical_text(text, 1, 300).map_err(invalid("display_text"))?,
        (None, Some(row)) => row.display_text.clone(),
        (None, None) => return Err(AppError::invalid("display_text", "is required")),
    };
    let code = match (&input.code, current) {
        (Some(code), _) => parse_code(code)?,
        (None, Some(row)) => stored_code(row.code_system.as_deref(), row.code.clone()),
        (None, None) => None,
    };
    let status = match (&input.status, current) {
        (Some(text), _) => FactStatus::parse(text.trim()).map_err(invalid("status"))?,
        (None, Some(row)) => FactStatus::parse(&row.status).map_err(invalid("status"))?,
        (None, None) => FactStatus::Active,
    };
    let onset = match (input.onset, current) {
        (Some(onset), _) => onset,
        (None, Some(row)) => row.onset,
        (None, None) => None,
    };
    if onset.is_some_and(|date| date > today || date.year() < 1900) {
        return Err(AppError::invalid("onset", "must be between 1900 and today"));
    }
    let note = match (&input.note, current) {
        (Some(text), _) => optional_text(Some(text), 1000).map_err(invalid("note"))?,
        (None, Some(row)) => row.note.clone(),
        (None, None) => None,
    };
    let source = match (&input.source, current) {
        (Some(text), _) => staff_source(Some(text))?,
        (None, Some(row)) => RecordSource::parse(&row.source).map_err(invalid("source"))?,
        (None, None) => RecordSource::Clinician,
    };
    Ok(Condition {
        display_text,
        code,
        status,
        flagged: input
            .flagged
            .or(current.map(|row| row.flagged))
            .unwrap_or(false),
        onset,
        note,
        source,
    })
}

impl Condition {
    fn values(&self, verified_by: Uuid) -> ConditionValues<'_> {
        ConditionValues {
            display_text: &self.display_text,
            code: self
                .code
                .as_ref()
                .map(|(system, code)| (system.as_str(), code.as_str())),
            status: self.status.as_str(),
            flagged: self.flagged,
            onset: self.onset,
            note: self.note.as_deref(),
            source: self.source.as_str(),
            verified_by,
        }
    }
}

/// Today in the clinic's time zone.
async fn clinic_today_in(tx: &mut ScopedTx, now: OffsetDateTime) -> Result<Date, AppError> {
    let profile = aarogyam_dal::clinic::profile(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    Ok(clinic_today(&profile.timezone, now))
}

/// Maps the composite-key failure of a visit link to a validation error.
fn visit_link(error: sakalya_db::DbError) -> AppError {
    match error.kind() {
        DbErrorKind::Conflict => AppError::invalid("visit_id", "not a visit of this patient"),
        _ => AppError::Db(error),
    }
}

/// Adds a condition to a patient's problem list.
///
/// # Errors
/// [`AppError::Invalid`] for bad input or a visit of another patient; [`AppError::NotFound`]
/// when the patient isn't in this clinic.
pub async fn add_condition(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: ConditionInput,
    now: OffsetDateTime,
) -> Result<ConditionView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let condition = merge_condition(None, &input, clinic_today_in(tx, now).await?)?;
        let patient = require_patient(tx, patient_id).await?;
        let row = facts::insert_condition(
            tx.conn(),
            ConditionId::new_v7().uuid(),
            patient.id,
            input.visit_id,
            &condition.values(actor.membership_id.uuid()),
        )
        .await
        .map_err(visit_link)?;
        condition_view(row)
    })
    .await
}

/// Edits a condition: resolve it, flag it, correct its text, or mark it entered in error.
///
/// # Errors
/// [`AppError::NotFound`] when the condition isn't this patient's in this clinic;
/// [`AppError::Invalid`] for bad input.
pub async fn edit_condition(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    condition_id: ConditionId,
    input: ConditionInput,
    now: OffsetDateTime,
) -> Result<ConditionView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today_in(tx, now).await?;
        let current =
            facts::get_condition_for_update(tx.conn(), patient_id.uuid(), condition_id.uuid())
                .await?
                .ok_or(AppError::NotFound("condition"))?;
        let condition = merge_condition(Some(&current), &input, today)?;
        let row = facts::update_condition(
            tx.conn(),
            current.id,
            &condition.values(actor.membership_id.uuid()),
        )
        .await?;
        condition_view(row)
    })
    .await
}

/// A patient's conditions, active first.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn conditions(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<ConditionView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient = require_patient(tx, patient_id).await?;
        facts::list_conditions(tx.conn(), patient.id)
            .await?
            .into_iter()
            .map(condition_view)
            .collect()
    })
    .await
}

/// An allergy.
#[derive(Debug, Clone)]
pub struct AllergyView {
    /// Identifier.
    pub id: AllergyId,
    /// The substance.
    pub substance: String,
    /// Code system and code, when coded.
    pub code: Option<(CodeSystem, String)>,
    /// What happens.
    pub reaction: Option<String>,
    /// How bad.
    pub severity: Severity,
    /// Whether it applies now.
    pub status: FactStatus,
    /// Who or what it came from.
    pub source: RecordSource,
    /// The member who recorded or last confirmed it.
    pub verified_by: Option<MembershipId>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

fn allergy_view(row: AllergyRow) -> Result<AllergyView, AppError> {
    Ok(AllergyView {
        id: AllergyId::from_uuid(row.id),
        substance: row.substance,
        code: stored_code(row.code_system.as_deref(), row.code),
        reaction: row.reaction,
        severity: Severity::parse(&row.severity).map_err(invalid("severity"))?,
        status: FactStatus::parse(&row.status).map_err(invalid("status"))?,
        source: RecordSource::parse(&row.source).map_err(invalid("source"))?,
        verified_by: row.verified_by.map(MembershipId::from_uuid),
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// An allergy as received. On an edit, absent fields stay as they are.
#[derive(Debug, Clone, Default)]
pub struct AllergyInput {
    /// The substance; required for a new allergy.
    pub substance: Option<String>,
    /// Optional code; an empty code clears it.
    pub code: Option<CodeInput>,
    /// What happens; empty clears it.
    pub reaction: Option<String>,
    /// `mild`, `moderate` (default) or `severe`.
    pub severity: Option<String>,
    /// `active` (default), `resolved` or `entered_in_error`.
    pub status: Option<String>,
    /// `clinician` (default), `assistant`, `patient` or `import`.
    pub source: Option<String>,
}

struct Allergy {
    substance: String,
    code: Option<(CodeSystem, String)>,
    reaction: Option<String>,
    severity: Severity,
    status: FactStatus,
    source: RecordSource,
}

fn merge_allergy(current: Option<&AllergyRow>, input: &AllergyInput) -> Result<Allergy, AppError> {
    let substance = match (&input.substance, current) {
        (Some(text), _) => clinical_text(text, 1, 200).map_err(invalid("substance"))?,
        (None, Some(row)) => row.substance.clone(),
        (None, None) => return Err(AppError::invalid("substance", "is required")),
    };
    let code = match (&input.code, current) {
        (Some(code), _) => parse_code(code)?,
        (None, Some(row)) => stored_code(row.code_system.as_deref(), row.code.clone()),
        (None, None) => None,
    };
    let reaction = match (&input.reaction, current) {
        (Some(text), _) => optional_text(Some(text), 500).map_err(invalid("reaction"))?,
        (None, Some(row)) => row.reaction.clone(),
        (None, None) => None,
    };
    let severity = match (&input.severity, current) {
        (Some(text), _) => Severity::parse(text.trim()).map_err(invalid("severity"))?,
        (None, Some(row)) => Severity::parse(&row.severity).map_err(invalid("severity"))?,
        (None, None) => Severity::Moderate,
    };
    let status = match (&input.status, current) {
        (Some(text), _) => FactStatus::parse(text.trim()).map_err(invalid("status"))?,
        (None, Some(row)) => FactStatus::parse(&row.status).map_err(invalid("status"))?,
        (None, None) => FactStatus::Active,
    };
    let source = match (&input.source, current) {
        (Some(text), _) => staff_source(Some(text))?,
        (None, Some(row)) => RecordSource::parse(&row.source).map_err(invalid("source"))?,
        (None, None) => RecordSource::Clinician,
    };
    Ok(Allergy {
        substance,
        code,
        reaction,
        severity,
        status,
        source,
    })
}

impl Allergy {
    fn values(&self, verified_by: Uuid) -> AllergyValues<'_> {
        AllergyValues {
            substance: &self.substance,
            code: self
                .code
                .as_ref()
                .map(|(system, code)| (system.as_str(), code.as_str())),
            reaction: self.reaction.as_deref(),
            severity: self.severity.as_str(),
            status: self.status.as_str(),
            source: self.source.as_str(),
            verified_by,
        }
    }
}

/// Records an allergy.
///
/// # Errors
/// [`AppError::Invalid`] for bad input; [`AppError::NotFound`] when the patient isn't in this
/// clinic.
pub async fn add_allergy(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: AllergyInput,
) -> Result<AllergyView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let allergy = merge_allergy(None, &input)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient = require_patient(tx, patient_id).await?;
        let row = facts::insert_allergy(
            tx.conn(),
            AllergyId::new_v7().uuid(),
            patient.id,
            &allergy.values(actor.membership_id.uuid()),
        )
        .await?;
        allergy_view(row)
    })
    .await
}

/// Edits an allergy: resolve it, change its severity, or mark it entered in error.
///
/// # Errors
/// [`AppError::NotFound`] when the allergy isn't this patient's in this clinic;
/// [`AppError::Invalid`] for bad input.
pub async fn edit_allergy(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    allergy_id: AllergyId,
    input: AllergyInput,
) -> Result<AllergyView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current =
            facts::get_allergy_for_update(tx.conn(), patient_id.uuid(), allergy_id.uuid())
                .await?
                .ok_or(AppError::NotFound("allergy"))?;
        let allergy = merge_allergy(Some(&current), &input)?;
        let row = facts::update_allergy(
            tx.conn(),
            current.id,
            &allergy.values(actor.membership_id.uuid()),
        )
        .await?;
        allergy_view(row)
    })
    .await
}

/// A patient's allergies, active and severe first.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn allergies(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<AllergyView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient = require_patient(tx, patient_id).await?;
        facts::list_allergies(tx.conn(), patient.id)
            .await?
            .into_iter()
            .map(allergy_view)
            .collect()
    })
    .await
}

/// What Patient 360's banner shows: active allergies and flagged active conditions. Everyone
/// who can see the patient learns that flags exist; the details need `clinical.read`.
#[derive(Debug, Clone)]
pub struct ClinicalFlags {
    /// How many active allergies.
    pub allergy_count: usize,
    /// Whether any active allergy is severe.
    pub severe_allergy: bool,
    /// How many flagged active conditions.
    pub condition_count: usize,
    /// Whether the details below were left out for lack of `clinical.read`.
    pub details_hidden: bool,
    /// Active allergies, severe first.
    pub allergies: Vec<AllergyView>,
    /// Flagged active conditions.
    pub conditions: Vec<ConditionView>,
}

/// The patient's clinical flags.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn flags(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<ClinicalFlags, AppError> {
    actor.require(Permission::PatientsRead)?;
    let details = actor.permissions.allows(Permission::ClinicalRead);
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient = require_patient(tx, patient_id).await?;
        let allergies: Vec<AllergyView> = facts::list_allergies(tx.conn(), patient.id)
            .await?
            .into_iter()
            .filter(|row| row.status == FactStatus::Active.as_str())
            .map(allergy_view)
            .collect::<Result<_, _>>()?;
        let conditions: Vec<ConditionView> = facts::list_conditions(tx.conn(), patient.id)
            .await?
            .into_iter()
            .filter(|row| row.flagged && row.status == FactStatus::Active.as_str())
            .map(condition_view)
            .collect::<Result<_, _>>()?;
        Ok(ClinicalFlags {
            allergy_count: allergies.len(),
            severe_allergy: allergies.iter().any(|a| a.severity == Severity::Severe),
            condition_count: conditions.len(),
            details_hidden: !details,
            allergies: if details { allergies } else { Vec::new() },
            conditions: if details { conditions } else { Vec::new() },
        })
    })
    .await
}
