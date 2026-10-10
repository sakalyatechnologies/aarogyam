//! The dental chart: the current state of each tooth, its history, and recording findings.

use aarogyam_dal::chart::{self, ChartRow, NewChartRow};
use aarogyam_dal::dental_terms::{self as terms, TermRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{EncounterStatus, NoteRefusal, RecordSource};
use aarogyam_domain::dental::{
    ChartData, ChartEntry, Detail, Finding, KIND, MODULE, SCHEMA_VERSION, Surface, Tooth,
};
use aarogyam_domain::dental_terms::{TermKind, TermRef, seeded, seeded_match, term_label};
use aarogyam_domain::ids::{DentalTermId, EncounterId, MembershipId, PatientId, SpecialtyRecordId};
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
    /// What was done.
    pub procedure: Option<TermView>,
    /// What it was done with.
    pub material: Option<TermView>,
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

/// A procedure or material: seeded, or one the clinic added.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TermView {
    /// The seeded id (`zirconia`) or the clinic term's UUID.
    pub id: String,
    /// Which list.
    pub kind: TermKind,
    /// What the clinician reads.
    pub label: String,
    /// Added by the clinic rather than seeded.
    pub own: bool,
    /// Retired: shown on old entries, not offered for new ones.
    pub retired: bool,
}

impl TermView {
    fn seeded(term: &aarogyam_domain::dental_terms::SeedTerm) -> Self {
        Self {
            id: term.id.clone(),
            kind: term.kind,
            label: term.label.clone(),
            own: false,
            retired: term.retired,
        }
    }

    fn own(row: TermRow) -> Result<Self, AppError> {
        Ok(Self {
            id: row.id.to_string(),
            kind: TermKind::parse(&row.kind)
                .map_err(|_| AppError::Internal("a stored dental term is malformed"))?,
            label: row.label,
            own: true,
            retired: row.retired,
        })
    }
}

/// The ids of the clinic terms a stored entry names.
fn clinic_ids(data: &ChartData) -> impl Iterator<Item = Uuid> + '_ {
    [data.procedure.as_deref(), data.material.as_deref()]
        .into_iter()
        .flatten()
        .filter_map(|id| Uuid::try_parse(id).ok())
}

fn resolve(
    kind: TermKind,
    id: Option<&str>,
    own: &[TermView],
) -> Result<Option<TermView>, AppError> {
    let stored = || AppError::Internal("a stored chart entry names an unknown term");
    match id.map(|id| TermRef::stored(kind, id)) {
        None => Ok(None),
        Some(None) => Err(stored()),
        Some(Some(TermRef::Seeded(term))) => Ok(Some(TermView::seeded(term))),
        Some(Some(TermRef::Clinic(id))) => own
            .iter()
            .find(|t| t.kind == kind && t.id == id.uuid().to_string())
            .cloned()
            .map(Some)
            .ok_or_else(stored),
    }
}

fn view(row: ChartRow, own: &[TermView]) -> Result<ChartEntryView, AppError> {
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
        procedure: resolve(TermKind::Procedure, data.procedure.as_deref(), own)?,
        material: resolve(TermKind::Material, data.material.as_deref(), own)?,
        note: data.note,
        status: row.status,
        supersedes_id: row.supersedes_id.map(SpecialtyRecordId::from_uuid),
        effective_at: row.effective_at,
        recorded_by: row.verified_by.map(MembershipId::from_uuid),
    })
}

/// Rows as views, reading the clinic terms they name in one query (none when they name only
/// seeded terms).
async fn views(tx: &mut ScopedTx, rows: Vec<ChartRow>) -> Result<Vec<ChartEntryView>, AppError> {
    let mut ids: Vec<Uuid> = Vec::new();
    for row in &rows {
        if let Ok(data) = serde_json::from_value::<ChartData>(row.data.clone()) {
            ids.extend(clinic_ids(&data));
        }
    }
    let own = if ids.is_empty() {
        Vec::new()
    } else {
        ids.sort_unstable();
        ids.dedup();
        terms::some(tx.conn(), &ids)
            .await?
            .into_iter()
            .map(TermView::own)
            .collect::<Result<Vec<_>, _>>()?
    };
    rows.into_iter().map(|row| view(row, &own)).collect()
}

/// The chart entries recorded in a visit.
pub(crate) async fn of_visit(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<ChartEntryView>, AppError> {
    let rows = chart::of_encounter(tx.conn(), encounter_id).await?;
    views(tx, rows).await
}

/// A patient's chart: the current entries of every tooth that has any, by tooth and surface,
/// and the full history of one tooth when asked.
#[derive(Debug, Clone)]
pub struct DentalChart {
    /// Current entries, by tooth (whole-tooth entry first, then surfaces).
    pub current: Vec<ChartEntryView>,
    /// Every entry of the requested tooth, newest first; empty when no tooth was asked for.
    pub history: Vec<ChartEntryView>,
    /// The procedures and materials to offer: the seeded vocabulary, then the clinic's own.
    /// Clients filter it as the clinician types; nothing is asked per keystroke.
    pub terms: Vec<TermView>,
}

async fn load(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    tooth: Option<Tooth>,
) -> Result<DentalChart, AppError> {
    let own = terms::list(tx.conn())
        .await?
        .into_iter()
        .map(TermView::own)
        .collect::<Result<Vec<_>, _>>()?;
    let current = chart::current(tx.conn(), patient_id)
        .await?
        .into_iter()
        .map(|row| view(row, &own))
        .collect::<Result<_, _>>()?;
    let history = match tooth {
        Some(tooth) => chart::history(tx.conn(), patient_id, i16::from(tooth.number()))
            .await?
            .into_iter()
            .map(|row| view(row, &own))
            .collect::<Result<_, _>>()?,
        None => Vec::new(),
    };
    let terms = seeded()
        .iter()
        .filter(|t| !t.retired)
        .map(TermView::seeded)
        .chain(own.into_iter().filter(|t| !t.retired))
        .collect();
    Ok(DentalChart {
        current,
        history,
        terms,
    })
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
    /// A procedure id: seeded (`crown`) or a clinic term's UUID.
    pub procedure: Option<String>,
    /// A material id: seeded (`zirconia`) or a clinic term's UUID.
    pub material: Option<String>,
    /// A remark.
    pub note: Option<String>,
    /// A current entry of this patient that this one corrects, on any tooth or surface. It is
    /// superseded alongside the current entry for this entry's own tooth and surface.
    pub supersedes_id: Option<Uuid>,
}

/// Entries recorded together, as received.
#[derive(Debug, Clone, Default)]
pub struct RecordChart {
    /// The visit they were found in, if any; it must be open.
    pub visit_id: Option<Uuid>,
    /// The entries, applied in order.
    pub entries: Vec<EntryInput>,
}

/// The surface of a stored entry.
fn stored_surface(row: &ChartRow) -> Result<Option<Surface>, AppError> {
    let stored = || AppError::Internal("a stored chart entry is malformed");
    row.data
        .get("surface")
        .and_then(serde_json::Value::as_str)
        .map(Surface::parse)
        .transpose()
        .map_err(|_| stored())
}

/// Refuses entries naming a clinic term this clinic doesn't have, or one of the wrong list.
async fn check_own_terms(tx: &mut ScopedTx, entries: &[ChartEntry]) -> Result<(), AppError> {
    let wanted: Vec<(TermKind, DentalTermId)> = entries
        .iter()
        .flat_map(|e| {
            [
                (TermKind::Procedure, e.procedure()),
                (TermKind::Material, e.material()),
            ]
        })
        .filter_map(|(kind, term)| term.and_then(TermRef::clinic).map(|id| (kind, id)))
        .collect();
    if wanted.is_empty() {
        return Ok(());
    }
    let mut ids: Vec<Uuid> = wanted.iter().map(|(_, id)| id.uuid()).collect();
    ids.sort_unstable();
    ids.dedup();
    let found = terms::some(tx.conn(), &ids).await?;
    for (kind, id) in wanted {
        if !found
            .iter()
            .any(|row| row.id == id.uuid() && row.kind == kind.as_str() && !row.retired)
        {
            return Err(AppError::invalid(
                "entries",
                format!("unknown {}", kind.as_str()),
            ));
        }
    }
    Ok(())
}

/// Supersedes the entry a correction names: it must be one of this patient's current dental
/// entries. The audit trigger records the change of status.
async fn correct(tx: &mut ScopedTx, patient_id: Uuid, id: Uuid) -> Result<(), AppError> {
    let row = chart::entry_for_update(tx.conn(), patient_id, id)
        .await?
        .ok_or_else(|| AppError::invalid("supersedes_id", "not a chart entry of this patient"))?;
    if row.status != "current" {
        return Err(AppError::Conflict(
            "the entry being corrected is no longer current; reload the chart",
        ));
    }
    chart::supersede(tx.conn(), row.id).await?;
    Ok(())
}

/// Records chart entries. Each supersedes the current entry for its tooth and surface; a
/// crown, implant or missing tooth also supersedes the tooth's surface entries. An entry with
/// `supersedes_id` corrects that entry instead, even on another tooth or surface, and links to
/// it. Nothing is overwritten: the history keeps every entry.
///
/// # Errors
/// [`AppError::Invalid`] for a bad tooth, surface or finding, or a visit of another patient;
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Conflict`] when
/// the visit is closed, the corrected entry is no longer current, or another change to the
/// same tooth happened at the same moment.
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
                Detail {
                    procedure: entry.procedure.as_deref(),
                    material: entry.material.as_deref(),
                    note: entry.note.as_deref(),
                },
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
        check_own_terms(tx, &entries).await?;
        for (entry, given) in entries.iter().zip(&input.entries) {
            let tooth = i16::from(entry.tooth().number());
            let mut replaced = None;
            if let Some(id) = given.supersedes_id {
                correct(tx, patient.id, id).await?;
                replaced = Some(id);
            }
            for row in chart::current_for_tooth(tx.conn(), patient.id, tooth).await? {
                let surface = stored_surface(&row)?;
                if entry.replaces(surface) {
                    chart::supersede(tx.conn(), row.id).await?;
                    if surface == entry.surface() && given.supersedes_id.is_none() {
                        replaced = Some(row.id);
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

/// Adds a procedure or material to the clinic's list, for "Add new" in the chart. A label that
/// matches a seeded term or one the clinic already has (ignoring case) returns that term
/// instead, so the list never holds the same thing twice. Returns the term and whether it was
/// added.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown list or a bad label; [`AppError::Conflict`] when the
/// same label was added at the same moment.
pub async fn add_term(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    kind: &str,
    label: &str,
) -> Result<(TermView, bool), AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let kind = TermKind::parse(kind.trim())
        .map_err(|_| AppError::invalid("kind", "must be procedure or material"))?;
    let label = term_label(label).map_err(|error| AppError::invalid("label", error))?;
    if let Some(term) = seeded_match(kind, &label).filter(|t| !t.retired) {
        return Ok((TermView::seeded(term), false));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let (row, added) = terms::add(
            tx.conn(),
            DentalTermId::new_v7().uuid(),
            kind.as_str(),
            &label,
            actor.membership_id.uuid(),
        )
        .await
        .map_err(|error| match error.kind() {
            DbErrorKind::NotFound | DbErrorKind::Conflict => {
                AppError::Conflict("the same term was added at the same moment; try again")
            }
            _ => AppError::Db(error),
        })?;
        Ok((TermView::own(row)?, added))
    })
    .await
}
