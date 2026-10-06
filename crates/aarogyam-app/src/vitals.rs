//! Recording vital signs in a visit, correcting them by superseding, and marking them entered
//! in error.

use aarogyam_dal::vitals;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{EncounterStatus, NoteRefusal, RecordSource, error_reason};
use aarogyam_domain::ids::{EncounterId, ObservationId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::vitals::{Reading, Unit, VitalKind, check_together};
use sakalya_db::{Db, DbErrorKind, ScopedTx};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::invalid;

/// Most readings recorded at once.
pub const MAX_READINGS: usize = 20;

/// A recorded measurement.
#[derive(Debug, Clone)]
pub struct ObservationView {
    /// Identifier.
    pub id: ObservationId,
    /// The visit it was taken in.
    pub visit_id: Option<EncounterId>,
    /// What was measured.
    pub kind: VitalKind,
    /// The value.
    pub value: f64,
    /// The unit.
    pub unit: Unit,
    /// LOINC code.
    pub code: Option<String>,
    /// When it was measured.
    pub recorded_at: OffsetDateTime,
    /// `final`, `corrected` or `entered_in_error`.
    pub status: String,
    /// The value this one corrects.
    pub supersedes_id: Option<ObservationId>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// Who or what it came from.
    pub source: String,
}

fn view(row: vitals::ObservationRow) -> Result<ObservationView, AppError> {
    Ok(ObservationView {
        id: ObservationId::from_uuid(row.id),
        visit_id: row.encounter_id.map(EncounterId::from_uuid),
        kind: VitalKind::parse(&row.kind).map_err(invalid("kind"))?,
        value: row.value,
        unit: Unit::parse(&row.unit).map_err(invalid("unit"))?,
        code: row.code,
        recorded_at: row.recorded_at,
        status: row.status,
        supersedes_id: row.supersedes_id.map(ObservationId::from_uuid),
        error_reason: row.error_reason,
        source: row.source,
    })
}

/// A visit's observations, oldest first, corrected ones included.
pub(crate) async fn of_visit(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<ObservationView>, AppError> {
    vitals::list_for_encounter(tx.conn(), encounter_id)
        .await?
        .into_iter()
        .map(view)
        .collect()
}

/// One reading as received.
#[derive(Debug, Clone)]
pub struct ReadingInput {
    /// An identifier the client made (version 7), so a retry returns this reading instead of
    /// recording another; the server makes one when absent.
    pub id: Option<ObservationId>,
    /// `bp_systolic`, `bp_diastolic`, `pulse`, `temperature`, `spo2`, `weight`, `height` or
    /// `blood_sugar`.
    pub kind: String,
    /// The value.
    pub value: f64,
    /// The unit; the kind's usual unit when absent.
    pub unit: Option<String>,
    /// The earlier reading this one corrects.
    pub supersedes_id: Option<Uuid>,
}

/// Readings taken together, as received.
#[derive(Debug, Clone, Default)]
pub struct RecordVitals {
    /// The readings.
    pub readings: Vec<ReadingInput>,
    /// When they were taken; now when absent. Not in the future.
    pub recorded_at: Option<OffsetDateTime>,
    /// `clinician` (default), `assistant`, `patient` or `import`.
    pub source: Option<String>,
}

fn readings_invalid(message: String) -> AppError {
    AppError::Invalid {
        field: "readings",
        message,
    }
}

/// A reading that passed the checks, with the ids it carries.
struct Checked {
    reading: Reading,
    supersedes_id: Option<Uuid>,
    id: Option<ObservationId>,
}

fn validate(input: &RecordVitals) -> Result<Vec<Checked>, AppError> {
    if input.readings.is_empty() || input.readings.len() > MAX_READINGS {
        return Err(readings_invalid(format!(
            "give 1 to {MAX_READINGS} readings"
        )));
    }
    let mut readings = Vec::with_capacity(input.readings.len());
    for item in &input.readings {
        let kind = VitalKind::parse(item.kind.trim()).map_err(invalid("readings.kind"))?;
        let unit = item
            .unit
            .as_deref()
            .map(Unit::parse_loose)
            .transpose()
            .map_err(invalid("readings.unit"))?;
        let reading = Reading::new(kind, item.value, unit)
            .map_err(|error| readings_invalid(format!("{kind}: {error}")))?;
        readings.push(Checked {
            reading,
            supersedes_id: item.supersedes_id,
            id: item.id,
        });
    }
    let plain: Vec<Reading> = readings.iter().map(|item| item.reading).collect();
    check_together(&plain).map_err(|error| readings_invalid(error.to_string()))?;
    Ok(readings)
}

/// The source a member names; clinician when absent.
pub(crate) fn staff_source(text: Option<&str>) -> Result<RecordSource, AppError> {
    let source = match text {
        Some(text) => RecordSource::parse(text.trim()).map_err(invalid("source"))?,
        None => RecordSource::Clinician,
    };
    if source.recordable_by_staff() {
        Ok(source)
    } else {
        Err(AppError::invalid(
            "source",
            "must be clinician, assistant, patient or import",
        ))
    }
}

/// Whether a stored reading is the one `item` describes: a retry of the request that made it.
fn is_same_reading(
    row: &vitals::ObservationRow,
    visit: &aarogyam_dal::visits::EncounterRow,
    actor: &ClinicActor,
    item: &Checked,
    source: RecordSource,
    recorded_at: Option<OffsetDateTime>,
) -> bool {
    row.encounter_id == Some(visit.id)
        && row.patient_id == visit.patient_id
        && row.kind == item.reading.kind().as_str()
        && row.unit == item.reading.unit().as_str()
        && (row.value - item.reading.value()).abs() < 0.005
        && row.supersedes_id == item.supersedes_id
        && row.source == source.as_str()
        && row.verified_by == Some(actor.membership_id.uuid())
        // The database keeps microseconds; a time the client left out is the server's to choose.
        && recorded_at.is_none_or(|at| (row.recorded_at - at).abs() < Duration::microseconds(1))
}

/// Records readings in a visit. A reading with `supersedes_id` corrects an earlier one of the
/// same patient and kind, which stays visible as `corrected`. A closed visit takes corrections
/// only. A reading whose client-chosen `id` already exists with the same content is a retry: the
/// stored reading comes back and nothing is written, even if the visit has closed since.
///
/// # Errors
/// [`AppError::Invalid`] for implausible values or units; [`AppError::NotFound`] when the
/// visit isn't in this clinic; [`AppError::Conflict`] when correcting a value that is no
/// longer final, or adding new values to a closed visit; [`AppError::IdConflict`] when an id
/// belongs to a different reading.
pub async fn record(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    input: RecordVitals,
    now: OffsetDateTime,
) -> Result<Vec<ObservationView>, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let readings = validate(&input)?;
    let source = staff_source(input.source.as_deref())?;
    let recorded_at = input.recorded_at.unwrap_or(now);
    if recorded_at > now + Duration::minutes(5) {
        return Err(AppError::invalid("recorded_at", "can't be in the future"));
    }
    let reach = actor.reach(Permission::ClinicalWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let visit = aarogyam_dal::visits::get_encounter(tx.conn(), visit_id.uuid(), true, reach)
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        let mut known = Vec::with_capacity(readings.len());
        for item in &readings {
            let existing = match item.id {
                Some(id) => {
                    aarogyam_dal::visits::lock_client_id(tx.conn(), id.uuid()).await?;
                    vitals::get_for_update(tx.conn(), id.uuid(), reach).await?
                }
                None => None,
            };
            if let Some(row) = &existing
                && !is_same_reading(row, &visit, actor, item, source, input.recorded_at)
            {
                return Err(AppError::IdConflict);
            }
            known.push(existing);
        }
        let corrections_only = readings
            .iter()
            .zip(&known)
            .filter(|(_, existing)| existing.is_none())
            .all(|(item, _)| item.supersedes_id.is_some());
        if visit.status != EncounterStatus::Open.as_str() && !corrections_only {
            return Err(AppError::Conflict(NoteRefusal::VisitClosed.message()));
        }
        let mut saved = Vec::with_capacity(readings.len());
        for (item, existing) in readings.iter().zip(known) {
            if let Some(row) = existing {
                saved.push(view(row)?);
                continue;
            }
            let (reading, supersedes_id) = (&item.reading, &item.supersedes_id);
            if let Some(old_id) = supersedes_id {
                let old = vitals::get_for_update(tx.conn(), *old_id, reach)
                    .await?
                    .filter(|old| old.patient_id == visit.patient_id)
                    .ok_or_else(|| {
                        AppError::invalid("readings.supersedes_id", "not a reading of this patient")
                    })?;
                if old.kind != reading.kind().as_str() {
                    return Err(AppError::invalid(
                        "readings.supersedes_id",
                        "a correction must be of the same kind",
                    ));
                }
                if old.status != "final" {
                    return Err(AppError::Conflict(
                        "that reading was already corrected or marked entered in error",
                    ));
                }
                vitals::retire(tx.conn(), old.id, "corrected", None).await?;
            }
            let row = vitals::insert(
                tx.conn(),
                &vitals::NewObservation {
                    id: item.id.unwrap_or_else(ObservationId::new_v7).uuid(),
                    patient_id: visit.patient_id,
                    encounter_id: Some(visit.id),
                    kind: reading.kind().as_str(),
                    value: reading.value(),
                    unit: reading.unit().as_str(),
                    loinc: reading.kind().loinc(),
                    recorded_at,
                    supersedes_id: *supersedes_id,
                    source: source.as_str(),
                    verified_by: actor.membership_id.uuid(),
                },
            )
            .await
            .map_err(|error| match error.kind() {
                DbErrorKind::Conflict => AppError::Conflict("that reading was already corrected"),
                _ => AppError::Db(error),
            })?;
            saved.push(view(row)?);
        }
        Ok(saved)
    })
    .await
}

/// Marks a final reading entered in error with a reason. It stays in the record, marked.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't in this clinic; [`AppError::Conflict`] when it is no
/// longer final; [`AppError::Invalid`] for a missing reason.
pub async fn mark_in_error(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    observation_id: ObservationId,
    reason: &str,
) -> Result<ObservationView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let reason = error_reason(reason).map_err(invalid("reason"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = vitals::get_for_update(
            tx.conn(),
            observation_id.uuid(),
            actor.reach(Permission::ClinicalWrite).member(),
        )
        .await?
        .ok_or(AppError::NotFound("observation"))?;
        if row.status != "final" {
            return Err(AppError::Conflict(
                "only a final reading can be marked entered in error",
            ));
        }
        let row = vitals::retire(tx.conn(), row.id, "entered_in_error", Some(&reason)).await?;
        view(row)
    })
    .await
}
