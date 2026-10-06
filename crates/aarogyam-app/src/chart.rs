//! The dental chart: the current state of each tooth, its history, and recording findings.

use aarogyam_dal::chart::{self, ChartRow, NewChartRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{EncounterStatus, NoteRefusal, RecordSource};
use aarogyam_domain::dental::{
    ChartData, ChartEntry, Finding, KIND, MODULE, SCHEMA_VERSION, Surface, Tooth,
};
use aarogyam_domain::ids::{EncounterId, MembershipId, PatientId, SpecialtyRecordId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, DbErrorKind, ScopedTx};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::require_patient;

/// Most entries recorded at once: every surface of a full mouth would be more than a visit
/// records.
pub const MAX_ENTRIES: usize = 64;

/// A chart entry.
#[derive(Debug, Clone)]
pub struct ChartEntryView {
    /// Identifier.
    pub id: SpecialtyRecordId,
    /// The visit that recorded it.
    pub visit_id: Option<EncounterId>,
    /// The tooth.
    pub tooth: Tooth,
    /// The surface, or none for the whole tooth.
    pub surface: Option<Surface>,
    /// The finding.
    pub finding: Finding,
    /// The clinician's remark.
    pub note: Option<String>,
    /// `current`, `superseded` or `entered_in_error`.
    pub status: String,
    /// The entry it replaced.
    pub supersedes_id: Option<SpecialtyRecordId>,
    /// When the finding was made.
    pub effective_at: OffsetDateTime,
    /// The member who recorded it.
    pub recorded_by: Option<MembershipId>,
}

fn view(row: ChartRow) -> Result<ChartEntryView, AppError> {
    let stored = || AppError::Internal("a stored chart entry is malformed");
    let data: ChartData = serde_json::from_value(row.data).map_err(|_| stored())?;
    Ok(ChartEntryView {
        id: SpecialtyRecordId::from_uuid(row.id),
        visit_id: row.encounter_id.map(EncounterId::from_uuid),
        tooth: Tooth::new(i64::from(data.tooth)).map_err(|_| stored())?,
        surface: data
            .surface
            .as_deref()
            .map(Surface::parse)
            .transpose()
            .map_err(|_| stored())?,
        finding: Finding::parse(&data.finding).map_err(|_| stored())?,
        note: data.note,
        status: row.status,
        supersedes_id: row.supersedes_id.map(SpecialtyRecordId::from_uuid),
        effective_at: row.effective_at,
        recorded_by: row.verified_by.map(MembershipId::from_uuid),
    })
}

/// The chart entries recorded in a visit.
pub(crate) async fn of_visit(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<ChartEntryView>, AppError> {
    chart::of_encounter(tx.conn(), encounter_id)
        .await?
        .into_iter()
        .map(view)
        .collect()
}

/// A patient's chart: the current entries of every tooth that has any, by tooth and surface,
/// and the full history of one tooth when asked.
#[derive(Debug, Clone)]
pub struct DentalChart {
    /// Current entries, by tooth (whole-tooth entry first, then surfaces).
    pub current: Vec<ChartEntryView>,
    /// Every entry of the requested tooth, newest first; empty when no tooth was asked for.
    pub history: Vec<ChartEntryView>,
}

async fn load(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    tooth: Option<Tooth>,
) -> Result<DentalChart, AppError> {
    let current = chart::current(tx.conn(), patient_id)
        .await?
        .into_iter()
        .map(view)
        .collect::<Result<_, _>>()?;
    let history = match tooth {
        Some(tooth) => chart::history(tx.conn(), patient_id, i16::from(tooth.number()))
            .await?
            .into_iter()
            .map(view)
            .collect::<Result<_, _>>()?,
        None => Vec::new(),
    };
    Ok(DentalChart { current, history })
}

/// A patient's dental chart, with one tooth's history when `tooth` is given.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Invalid`] for a
/// tooth that isn't an FDI number.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    tooth: Option<i64>,
) -> Result<DentalChart, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let tooth = tooth
        .map(Tooth::new)
        .transpose()
        .map_err(|error| AppError::invalid("tooth", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::ClinicalRead)).await?;
        load(tx, patient.id, tooth).await
    })
    .await
}

/// One entry as received.
#[derive(Debug, Clone)]
pub struct EntryInput {
    /// FDI tooth number.
    pub tooth: i64,
    /// `M`, `O`, `D`, `B` or `L`; none for the whole tooth.
    pub surface: Option<String>,
    /// The finding, such as `caries`.
    pub finding: String,
    /// A remark.
    pub note: Option<String>,
}

/// Entries recorded together, as received.
#[derive(Debug, Clone, Default)]
pub struct RecordChart {
    /// The visit they were found in, if any; it must be open.
    pub visit_id: Option<Uuid>,
    /// The entries, applied in order.
    pub entries: Vec<EntryInput>,
}

/// Records chart entries. Each supersedes the current entry for its tooth and surface; a
/// crown, implant or missing tooth also supersedes the tooth's surface entries. Nothing is
/// overwritten: the history keeps every entry.
///
/// # Errors
/// [`AppError::Invalid`] for a bad tooth, surface or finding, or a visit of another patient;
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Conflict`] when
/// the visit is closed or another change to the same tooth happened at the same moment.
pub async fn record(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: RecordChart,
    now: OffsetDateTime,
) -> Result<DentalChart, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    if input.entries.is_empty() || input.entries.len() > MAX_ENTRIES {
        return Err(AppError::invalid(
            "entries",
            format!("give 1 to {MAX_ENTRIES} entries"),
        ));
    }
    let entries = input
        .entries
        .iter()
        .map(|entry| {
            ChartEntry::new(
                entry.tooth,
                entry.surface.as_deref(),
                &entry.finding,
                entry.note.as_deref(),
            )
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::invalid("entries", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::ClinicalWrite)).await?;
        if let Some(visit_id) = input.visit_id {
            let visit = aarogyam_dal::visits::get_encounter(
                tx.conn(),
                visit_id,
                false,
                actor.reach(Permission::ClinicalWrite).member(),
            )
            .await?
            .filter(|visit| visit.patient_id == patient.id)
            .ok_or_else(|| AppError::invalid("visit_id", "not a visit of this patient"))?;
            if visit.status != EncounterStatus::Open.as_str() {
                return Err(AppError::Conflict(NoteRefusal::VisitClosed.message()));
            }
        }
        for entry in &entries {
            let tooth = i16::from(entry.tooth().number());
            let mut replaced = None;
            for row in chart::current_for_tooth(tx.conn(), patient.id, tooth).await? {
                let current = view(row)?;
                if entry.replaces(current.surface) {
                    chart::supersede(tx.conn(), current.id.uuid()).await?;
                    if current.surface == entry.surface() {
                        replaced = Some(current.id.uuid());
                    }
                }
            }
            let data = serde_json::to_value(entry.data())
                .map_err(|_| AppError::Internal("chart entry did not serialise"))?;
            chart::insert(
                tx.conn(),
                &NewChartRow {
                    id: SpecialtyRecordId::new_v7().uuid(),
                    patient_id: patient.id,
                    encounter_id: input.visit_id,
                    module: MODULE,
                    kind: KIND,
                    schema_version: SCHEMA_VERSION,
                    data: &data,
                    supersedes_id: replaced,
                    effective_at: now,
                    source: RecordSource::Clinician.as_str(),
                    verified_by: actor.membership_id.uuid(),
                },
            )
            .await
            .map_err(|error| match error.kind() {
                DbErrorKind::Conflict => {
                    AppError::Conflict("the chart changed at the same moment; try again")
                }
                _ => AppError::Db(error),
            })?;
        }
        load(tx, patient.id, None).await
    })
    .await
}
