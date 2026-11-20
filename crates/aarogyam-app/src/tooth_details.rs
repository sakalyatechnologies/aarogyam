//! Exact detail taps on a tooth (docs/plans/visit-story-v2-offers-design.md, section 1.13): its
//! condition (infection, gum bleeding, pocket depth, mobility) and a permanent tooth's eruption.
//! Each is its own `specialty_records` kind with one current row per tooth. A condition PUT
//! merges onto the current row under a lock (DT2), so two taps at once both land; an eruption
//! PUT supersedes. A wrong row is marked entered in error with a reason; nothing is deleted.

use aarogyam_dal::chart::{self, ChartRow, NewChartRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::RecordSource;
use aarogyam_domain::dental::{ChartData, Finding, MODULE, Tooth};
use aarogyam_domain::dental_details::{
    Angulation, CONDITION_KIND, CONDITION_SCHEMA_VERSION, Change, ConditionChange, DetailError,
    ERUPTION_KIND, ERUPTION_SCHEMA_VERSION, Eruption, Infection, ToothConditionData,
    ToothEruptionData, error_reason, eruption, merge_condition,
};
use aarogyam_domain::ids::{EncounterId, MembershipId, PatientId, SpecialtyRecordId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, DbErrorKind, ScopedTx};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::chart::open_visit;
use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::require_patient;

/// Where and when a detail row was recorded.
#[derive(Debug, Clone)]
pub struct Recorded {
    /// Identifier.
    pub id: SpecialtyRecordId,
    /// The visit it was recorded in, if one was open.
    pub visit_id: Option<EncounterId>,
    /// The member who recorded it.
    pub recorded_by: Option<MembershipId>,
    /// When.
    pub recorded_at: OffsetDateTime,
}

impl Recorded {
    fn of(row: &ChartRow) -> Self {
        Self {
            id: SpecialtyRecordId::from_uuid(row.id),
            visit_id: row.encounter_id.map(EncounterId::from_uuid),
            recorded_by: row.verified_by.map(MembershipId::from_uuid),
            recorded_at: row.effective_at,
        }
    }
}

/// A tooth's current condition.
#[derive(Debug, Clone)]
pub struct ToothConditionView {
    /// The tooth.
    pub tooth: Tooth,
    /// Infection or abscess, when recorded.
    pub infection: Option<Infection>,
    /// Gums bleed on probing, when recorded.
    pub bleeding: Option<bool>,
    /// Deepest pocket in mm, when recorded.
    pub pocket_mm: Option<u8>,
    /// Mobility grade 0 to 3, when recorded.
    pub mobility: Option<u8>,
    /// Where and when.
    pub recorded: Recorded,
}

/// A permanent tooth's current eruption.
#[derive(Debug, Clone)]
pub struct ToothEruptionView {
    /// The tooth.
    pub tooth: Tooth,
    /// How far it is through.
    pub eruption: Eruption,
    /// Its angle, when not through.
    pub angulation: Option<Angulation>,
    /// Where and when.
    pub recorded: Recorded,
}

fn stored() -> AppError {
    AppError::Internal("a stored tooth detail is malformed")
}

fn tooth_of(number: u8) -> Result<Tooth, AppError> {
    Tooth::new(i64::from(number)).map_err(|_| stored())
}

pub(crate) fn condition_data(row: &ChartRow) -> Result<ToothConditionData, AppError> {
    serde_json::from_value(row.data.clone()).map_err(|_| stored())
}

pub(crate) fn eruption_data(row: &ChartRow) -> Result<ToothEruptionData, AppError> {
    serde_json::from_value(row.data.clone()).map_err(|_| stored())
}

fn condition_view(row: &ChartRow) -> Result<ToothConditionView, AppError> {
    let data = condition_data(row)?;
    Ok(ToothConditionView {
        tooth: tooth_of(data.tooth)?,
        infection: data
            .infection
            .as_deref()
            .map(Infection::parse)
            .transpose()
            .map_err(|_| stored())?,
        bleeding: data.bleeding,
        pocket_mm: data.pocket_mm,
        mobility: data.mobility,
        recorded: Recorded::of(row),
    })
}

fn eruption_view(row: &ChartRow) -> Result<ToothEruptionView, AppError> {
    let data = eruption_data(row)?;
    Ok(ToothEruptionView {
        tooth: tooth_of(data.tooth)?,
        eruption: Eruption::parse(&data.eruption).map_err(|_| stored())?,
        angulation: data
            .angulation
            .as_deref()
            .map(Angulation::parse)
            .transpose()
            .map_err(|_| stored())?,
        recorded: Recorded::of(row),
    })
}

/// The patient's current conditions and eruptions, by tooth.
pub(crate) async fn current(
    tx: &mut ScopedTx,
    patient_id: Uuid,
) -> Result<(Vec<ToothConditionView>, Vec<ToothEruptionView>), AppError> {
    let conditions = chart::current_of_kind(tx.conn(), patient_id, CONDITION_KIND)
        .await?
        .iter()
        .map(condition_view)
        .collect::<Result<_, _>>()?;
    let eruptions = chart::current_of_kind(tx.conn(), patient_id, ERUPTION_KIND)
        .await?
        .iter()
        .map(eruption_view)
        .collect::<Result<_, _>>()?;
    Ok((conditions, eruptions))
}

fn detail_error(error: DetailError) -> AppError {
    let field = match error {
        DetailError::Tooth | DetailError::PrimaryTooth => "tooth",
        DetailError::Infection => "infection",
        DetailError::Pocket => "pocket_mm",
        DetailError::Mobility => "mobility",
        DetailError::Empty | DetailError::MissingTooth => "condition",
        DetailError::Eruption => "eruption",
        DetailError::Angulation | DetailError::AngulationErupted => "angulation",
        DetailError::Reason => "reason",
    };
    AppError::invalid(field, error)
}

/// A condition PUT as received: each field absent (keep), `null` (clear) or a value.
#[derive(Debug, Clone, Default)]
pub struct SetToothCondition {
    /// `infection` or `abscess`.
    pub infection: Option<Option<String>>,
    /// Bleeding on probing.
    pub bleeding: Option<Option<bool>>,
    /// Pocket depth in mm, 1 to 15.
    pub pocket_mm: Option<Option<i64>>,
    /// Mobility grade, 0 to 3.
    pub mobility: Option<Option<i64>>,
}

/// Whether the tooth's current chart says it is missing.
async fn is_missing(tx: &mut ScopedTx, patient_id: Uuid, tooth: i16) -> Result<bool, AppError> {
    Ok(chart::current(tx.conn(), patient_id)
        .await?
        .into_iter()
        .filter(|row| row.tooth == Some(tooth))
        .filter_map(|row| serde_json::from_value::<ChartData>(row.data).ok())
        .any(|data| data.finding == Finding::Missing.as_str()))
}

struct NewDetail<'a> {
    kind: &'a str,
    schema_version: i32,
    data: serde_json::Value,
    replaced: Option<Uuid>,
}

async fn insert_detail(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    patient_id: Uuid,
    new: NewDetail<'_>,
    now: OffsetDateTime,
) -> Result<ChartRow, AppError> {
    let reach = actor.reach(Permission::ClinicalWrite);
    if let Some(id) = new.replaced {
        chart::supersede(tx.conn(), id).await?;
    }
    let encounter_id = open_visit(tx, patient_id, reach.member()).await?;
    chart::insert(
        tx.conn(),
        &NewChartRow {
            id: SpecialtyRecordId::new_v7().uuid(),
            patient_id,
            encounter_id,
            module: MODULE,
            kind: new.kind,
            schema_version: new.schema_version,
            data: &new.data,
            supersedes_id: new.replaced,
            effective_at: now,
            source: RecordSource::Clinician.as_str(),
            verified_by: actor.membership_id.uuid(),
            client_id: None,
            request_hash: None,
        },
    )
    .await
    .map_err(|error| match error.kind() {
        DbErrorKind::Conflict => {
            AppError::Conflict("the tooth changed at the same moment; try again")
        }
        _ => AppError::Db(error),
    })
}

/// Sets a tooth's condition. In one transaction, under a lock on that tooth's condition, the
/// change merges onto the current row (omitted fields keep their value, `null` clears) and the
/// merged row supersedes it, in the open visit when there is one. Concurrent PUTs serialise on
/// the lock, so the second merges onto the first (DT2). Mobility is allowed on primary teeth.
///
/// # Errors
/// [`AppError::Invalid`] for a bad tooth or value, nothing left after the merge, or infection,
/// pocket or mobility on a missing tooth; [`AppError::NotFound`] when the patient isn't in this
/// clinic or reach.
pub async fn set_condition(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    tooth: i64,
    input: SetToothCondition,
    now: OffsetDateTime,
) -> Result<ToothConditionView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let number = Tooth::new(tooth).map_err(|error| AppError::invalid("tooth", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::ClinicalWrite)).await?;
        let key = i16::from(number.number());
        chart::lock_tooth(tx.conn(), patient.id, CONDITION_KIND, key).await?;
        let current =
            chart::current_of_kind_for_tooth(tx.conn(), patient.id, CONDITION_KIND, key).await?;
        let base = current.as_ref().map(condition_data).transpose()?;
        let missing = is_missing(tx, patient.id, key).await?;
        let change = ConditionChange {
            infection: Change::from_json(input.infection.as_ref().map(Option::as_deref)),
            bleeding: Change::from_json(input.bleeding),
            pocket_mm: Change::from_json(input.pocket_mm),
            mobility: Change::from_json(input.mobility),
        };
        let merged =
            merge_condition(tooth, base.as_ref(), &change, missing).map_err(detail_error)?;
        if let Some(row) = current.as_ref().filter(|_| base.as_ref() == Some(&merged)) {
            return condition_view(row);
        }
        let data = serde_json::to_value(&merged)
            .map_err(|_| AppError::Internal("tooth condition did not serialise"))?;
        let row = insert_detail(
            tx,
            actor,
            patient.id,
            NewDetail {
                kind: CONDITION_KIND,
                schema_version: CONDITION_SCHEMA_VERSION,
                data,
                replaced: current.map(|row| row.id),
            },
            now,
        )
        .await?;
        condition_view(&row)
    })
    .await
}

/// An eruption PUT as received.
#[derive(Debug, Clone, Default)]
pub struct SetToothEruption {
    /// `erupted`, `partial`, `impacted` or `unerupted`.
    pub eruption: String,
    /// The angle, only when not through.
    pub angulation: Option<String>,
}

/// Sets a permanent tooth's eruption: supersedes its current eruption (`erupted` replaces
/// `partial` or `unerupted` when the tooth comes through), in the open visit when there is one.
///
/// # Errors
/// [`AppError::Invalid`] for a primary tooth, an unknown eruption or angle, or an angle on an
/// erupted tooth; [`AppError::NotFound`] when the patient isn't in this clinic or reach.
pub async fn set_eruption(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    tooth: i64,
    input: SetToothEruption,
    now: OffsetDateTime,
) -> Result<ToothEruptionView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let data =
        eruption(tooth, &input.eruption, input.angulation.as_deref()).map_err(detail_error)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::ClinicalWrite)).await?;
        let key = i16::from(data.tooth);
        chart::lock_tooth(tx.conn(), patient.id, ERUPTION_KIND, key).await?;
        let current =
            chart::current_of_kind_for_tooth(tx.conn(), patient.id, ERUPTION_KIND, key).await?;
        let json = serde_json::to_value(&data)
            .map_err(|_| AppError::Internal("tooth eruption did not serialise"))?;
        let row = insert_detail(
            tx,
            actor,
            patient.id,
            NewDetail {
                kind: ERUPTION_KIND,
                schema_version: ERUPTION_SCHEMA_VERSION,
                data: json,
                replaced: current.map(|row| row.id),
            },
            now,
        )
        .await?;
        eruption_view(&row)
    })
    .await
}

/// Which detail row to mark entered in error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetailKind {
    /// The tooth's condition.
    Condition,
    /// The tooth's eruption.
    Eruption,
}

impl DetailKind {
    const fn kind(self) -> &'static str {
        match self {
            Self::Condition => CONDITION_KIND,
            Self::Eruption => ERUPTION_KIND,
        }
    }
}

/// Marks a tooth's current condition or eruption entered in error, with the reason. The tooth
/// then has none until the next PUT; the history keeps the row.
///
/// # Errors
/// [`AppError::Invalid`] for a bad tooth or reason; [`AppError::NotFound`] when the patient isn't
/// in this clinic or reach, or the tooth has no current row of that kind.
pub async fn mark_in_error(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    tooth: i64,
    kind: DetailKind,
    reason: &str,
) -> Result<(), AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let tooth = Tooth::new(tooth).map_err(|error| AppError::invalid("tooth", error))?;
    let reason = error_reason(reason).map_err(detail_error)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::ClinicalWrite)).await?;
        let key = i16::from(tooth.number());
        chart::lock_tooth(tx.conn(), patient.id, kind.kind(), key).await?;
        let row = chart::current_of_kind_for_tooth(tx.conn(), patient.id, kind.kind(), key)
            .await?
            .ok_or(AppError::NotFound("tooth detail"))?;
        chart::mark_in_error(tx.conn(), row.id, &reason).await?;
        Ok(())
    })
    .await
}
