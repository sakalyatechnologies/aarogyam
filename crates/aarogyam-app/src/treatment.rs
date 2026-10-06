//! Procedures in visits and treatment plans with estimates. Completing a procedure for a plan
//! item marks the item done and moves the plan along.

use aarogyam_dal::treatment::{self, ItemRow, NewProcedure, PlanRow, ProcedureRow, Work};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{
    CodeSystem, PlanItemStatus, PlanStatus, ProcedureStatus, clinical_text, error_reason, fee,
    optional_text,
};
use aarogyam_domain::dental::{Surface, Tooth, surfaces};
use aarogyam_domain::ids::{
    EncounterId, PatientId, ProcedureId, TreatmentPlanId, TreatmentPlanItemId,
};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, DbErrorKind, ScopedTx};
use sakalya_types::Paise;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::facts::{CodeInput, parse_code, stored_code};
use crate::scope::staff_scope as scope;
use crate::visits::{Member, Names, invalid, require_open_visit, require_patient};

/// Most items a plan may have.
pub const MAX_ITEMS: usize = 50;

/// What is done and where, as received.
#[derive(Debug, Clone, Default)]
pub struct WorkInput {
    /// What is done, such as "Root canal treatment".
    pub name: Option<String>,
    /// Optional code.
    pub code: Option<CodeInput>,
    /// FDI tooth number.
    pub tooth: Option<i64>,
    /// Surfaces: `M`, `O`, `D`, `B`, `L`.
    pub surfaces: Vec<String>,
}

/// What is done and where, validated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkView {
    /// What is done.
    pub name: String,
    /// Code system and code, when coded.
    pub code: Option<(CodeSystem, String)>,
    /// The tooth.
    pub tooth: Option<Tooth>,
    /// The surfaces.
    pub surfaces: Vec<Surface>,
}

impl WorkView {
    fn parse(input: &WorkInput, fallback: Option<&Self>) -> Result<Self, AppError> {
        let name = match (&input.name, fallback) {
            (Some(text), _) => clinical_text(text, 1, 200).map_err(invalid("name"))?,
            (None, Some(work)) => work.name.clone(),
            (None, None) => return Err(AppError::invalid("name", "is required")),
        };
        let code = match (&input.code, fallback) {
            (Some(code), _) => parse_code(code)?,
            (None, Some(work)) => work.code.clone(),
            (None, None) => None,
        };
        let tooth = match (input.tooth, fallback) {
            (Some(number), _) => {
                Some(Tooth::new(number).map_err(|e| AppError::invalid("tooth", e))?)
            }
            (None, Some(work)) => work.tooth,
            (None, None) => None,
        };
        let surfaces = if input.surfaces.is_empty() {
            fallback
                .map(|work| work.surfaces.clone())
                .unwrap_or_default()
        } else {
            surfaces(input.surfaces.iter().map(String::as_str))
                .map_err(|e| AppError::invalid("surfaces", e))?
        };
        if !surfaces.is_empty() && tooth.is_none() {
            return Err(AppError::invalid("surfaces", "name the tooth too"));
        }
        Ok(Self {
            name,
            code,
            tooth,
            surfaces,
        })
    }

    fn stored(
        name: String,
        code_system: Option<&str>,
        code: Option<String>,
        tooth: Option<i16>,
        stored_surfaces: &[String],
    ) -> Self {
        Self {
            name,
            code: stored_code(code_system, code),
            tooth: tooth.and_then(|n| Tooth::new(i64::from(n)).ok()),
            surfaces: surfaces(stored_surfaces.iter().map(String::as_str)).unwrap_or_default(),
        }
    }

    fn surface_texts(&self) -> Vec<String> {
        self.surfaces
            .iter()
            .map(|s| s.as_str().to_owned())
            .collect()
    }

    fn row<'a>(&'a self, surfaces: &'a [String]) -> Work<'a> {
        Work {
            name: &self.name,
            code: self
                .code
                .as_ref()
                .map(|(system, code)| (system.as_str(), code.as_str())),
            tooth: self.tooth.map(|tooth| i16::from(tooth.number())),
            surfaces,
        }
    }
}

/// A procedure planned or done in a visit.
#[derive(Debug, Clone)]
pub struct ProcedureView {
    /// Identifier.
    pub id: ProcedureId,
    /// The visit.
    pub visit_id: EncounterId,
    /// The member who did it.
    pub clinician: Member,
    /// What was done, and where.
    pub work: WorkView,
    /// Planned, done or entered in error.
    pub status: ProcedureStatus,
    /// When it was done.
    pub performed_at: Option<OffsetDateTime>,
    /// The fee.
    pub price: Option<Paise>,
    /// The plan item it carries out.
    pub plan_item_id: Option<TreatmentPlanItemId>,
    /// A remark.
    pub note: Option<String>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
}

fn procedure_view(row: ProcedureRow, names: &Names) -> Result<ProcedureView, AppError> {
    Ok(ProcedureView {
        id: ProcedureId::from_uuid(row.id),
        visit_id: EncounterId::from_uuid(row.encounter_id),
        clinician: names.member(row.clinician_id),
        work: WorkView::stored(
            row.name,
            row.code_system.as_deref(),
            row.code,
            row.tooth,
            &row.surfaces,
        ),
        status: ProcedureStatus::parse(&row.status).map_err(invalid("status"))?,
        performed_at: row.performed_at,
        price: row.price_paise.map(Paise::new),
        plan_item_id: row
            .treatment_plan_item_id
            .map(TreatmentPlanItemId::from_uuid),
        note: row.note,
        error_reason: row.error_reason,
        created_at: row.created_at,
    })
}

async fn procedure_views(
    tx: &mut ScopedTx,
    rows: Vec<ProcedureRow>,
) -> Result<Vec<ProcedureView>, AppError> {
    let names = Names::load(tx, rows.iter().map(|row| row.clinician_id)).await?;
    rows.into_iter()
        .map(|row| procedure_view(row, &names))
        .collect()
}

/// The procedures of a visit.
pub(crate) async fn of_visit(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<ProcedureView>, AppError> {
    let rows = treatment::procedures_of_encounter(tx.conn(), encounter_id).await?;
    procedure_views(tx, rows).await
}

/// A procedure as received.
#[derive(Debug, Clone, Default)]
pub struct ProcedureInput {
    /// What and where; taken from the plan item when left out.
    pub work: WorkInput,
    /// `done` (default) or `planned`.
    pub status: Option<String>,
    /// The fee in paise; the plan item's estimate when left out.
    pub price_paise: Option<i64>,
    /// The accepted plan item it carries out.
    pub plan_item_id: Option<Uuid>,
    /// A remark.
    pub note: Option<String>,
}

/// Marks a plan item done once its procedure is done.
async fn finish_item(tx: &mut ScopedTx, row: &ProcedureRow) -> Result<(), AppError> {
    if let Some(item_id) = row.treatment_plan_item_id {
        treatment::set_item_status(tx.conn(), item_id, PlanItemStatus::Done.as_str()).await?;
    }
    Ok(())
}

/// Records a procedure in an open visit. Done procedures never change afterwards; one for a
/// plan item marks the item done and moves the plan to in progress or completed.
///
/// # Errors
/// [`AppError::Invalid`] for bad input or a plan item of another patient;
/// [`AppError::NotFound`] when the visit isn't in this clinic; [`AppError::Conflict`] when the
/// visit is closed, the plan item isn't accepted, or it already has a procedure.
pub async fn record_procedure(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    input: ProcedureInput,
    now: OffsetDateTime,
) -> Result<ProcedureView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let status = match input.status.as_deref() {
        Some(text) => ProcedureStatus::parse(text.trim()).map_err(invalid("status"))?,
        None => ProcedureStatus::Done,
    };
    if status == ProcedureStatus::EnteredInError {
        return Err(AppError::invalid("status", "must be planned or done"));
    }
    let price = input
        .price_paise
        .map(fee)
        .transpose()
        .map_err(invalid("price_paise"))?;
    let note = optional_text(input.note.as_deref(), 1000).map_err(invalid("note"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let visit = require_open_visit(tx, visit_id).await?;
        let item = match input.plan_item_id {
            Some(item_id) => {
                let item = treatment::get_item_for_update(tx.conn(), item_id)
                    .await?
                    .filter(|item| item.patient_id == visit.patient_id)
                    .ok_or_else(|| {
                        AppError::invalid("plan_item_id", "not a plan item of this patient")
                    })?;
                if item.status != PlanItemStatus::Accepted.as_str() {
                    return Err(AppError::Conflict(
                        "only an accepted plan item can be carried out",
                    ));
                }
                Some(item)
            }
            None => None,
        };
        let planned = item.as_ref().map(|item| {
            WorkView::stored(
                item.name.clone(),
                item.code_system.as_deref(),
                item.code.clone(),
                item.tooth,
                &item.surfaces,
            )
        });
        let work = WorkView::parse(&input.work, planned.as_ref())?;
        let surface_texts = work.surface_texts();
        let price = price.or(item.as_ref().map(|item| Paise::new(item.estimate_paise)));
        let row = treatment::insert_procedure(
            tx.conn(),
            &NewProcedure {
                id: ProcedureId::new_v7().uuid(),
                encounter_id: visit.id,
                patient_id: visit.patient_id,
                clinician_id: actor.membership_id.uuid(),
                work: work.row(&surface_texts),
                status: status.as_str(),
                performed_at: (status == ProcedureStatus::Done).then_some(now),
                price_paise: price.map(Paise::get),
                treatment_plan_item_id: item.as_ref().map(|item| item.id),
                note: note.as_deref(),
            },
        )
        .await
        .map_err(|error| match error.kind() {
            DbErrorKind::Conflict => AppError::Conflict("that plan item already has a procedure"),
            _ => AppError::Db(error),
        })?;
        if status == ProcedureStatus::Done {
            finish_item(tx, &row).await?;
        }
        let names = Names::load(tx, [row.clinician_id]).await?;
        procedure_view(row, &names)
    })
    .await
}

/// Marks a planned procedure done, which also marks its plan item done.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't in this clinic; [`AppError::Conflict`] unless planned.
pub async fn complete_procedure(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    procedure_id: ProcedureId,
    now: OffsetDateTime,
) -> Result<ProcedureView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = treatment::get_procedure_for_update(tx.conn(), procedure_id.uuid())
            .await?
            .ok_or(AppError::NotFound("procedure"))?;
        if row.status != ProcedureStatus::Planned.as_str() {
            return Err(AppError::Conflict(
                "only a planned procedure can be completed",
            ));
        }
        let row = treatment::set_procedure_status(
            tx.conn(),
            row.id,
            ProcedureStatus::Done.as_str(),
            Some(now),
            None,
        )
        .await?;
        finish_item(tx, &row).await?;
        let names = Names::load(tx, [row.clinician_id]).await?;
        procedure_view(row, &names)
    })
    .await
}

/// Marks a procedure entered in error with a reason. Its plan item, if done by it, is open
/// again.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't in this clinic; [`AppError::Conflict`] when already
/// marked; [`AppError::Invalid`] for a missing reason.
pub async fn mark_procedure_in_error(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    procedure_id: ProcedureId,
    reason: &str,
) -> Result<ProcedureView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let reason = error_reason(reason).map_err(invalid("reason"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = treatment::get_procedure_for_update(tx.conn(), procedure_id.uuid())
            .await?
            .ok_or(AppError::NotFound("procedure"))?;
        if row.status == ProcedureStatus::EnteredInError.as_str() {
            return Err(AppError::Conflict("already marked entered in error"));
        }
        let was_done = row.status == ProcedureStatus::Done.as_str();
        let row = treatment::set_procedure_status(
            tx.conn(),
            row.id,
            ProcedureStatus::EnteredInError.as_str(),
            None,
            Some(&reason),
        )
        .await?;
        if let (true, Some(item_id)) = (was_done, row.treatment_plan_item_id) {
            treatment::set_item_status(tx.conn(), item_id, PlanItemStatus::Accepted.as_str())
                .await?;
        }
        let names = Names::load(tx, [row.clinician_id]).await?;
        procedure_view(row, &names)
    })
    .await
}

/// A patient's procedures, newest first.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn procedures(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<ProcedureView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient = require_patient(tx, patient_id).await?;
        let rows = treatment::list_procedures(tx.conn(), patient.id).await?;
        procedure_views(tx, rows).await
    })
    .await
}

/// A step of a treatment plan.
#[derive(Debug, Clone)]
pub struct PlanItemView {
    /// Identifier.
    pub id: TreatmentPlanItemId,
    /// What is to be done, and where.
    pub work: WorkView,
    /// Phase, from 1.
    pub phase: i16,
    /// Estimated cost.
    pub estimate: Paise,
    /// Proposed, accepted, done or cancelled.
    pub status: PlanItemStatus,
    /// The procedure carrying it out.
    pub procedure_id: Option<ProcedureId>,
}

/// A treatment plan with its items.
#[derive(Debug, Clone)]
pub struct PlanView {
    /// Identifier.
    pub id: TreatmentPlanId,
    /// The patient.
    pub patient_id: PatientId,
    /// The visit it was proposed in.
    pub visit_id: Option<EncounterId>,
    /// The member who proposed it.
    pub clinician: Member,
    /// Its title.
    pub title: String,
    /// Its status.
    pub status: PlanStatus,
    /// When the patient accepted it.
    pub accepted_at: Option<OffsetDateTime>,
    /// When it was proposed.
    pub created_at: OffsetDateTime,
    /// The estimate: the sum of the items that aren't cancelled.
    pub estimate: Paise,
    /// Its items, by phase.
    pub items: Vec<PlanItemView>,
}

fn item_view(row: ItemRow) -> Result<PlanItemView, AppError> {
    Ok(PlanItemView {
        id: TreatmentPlanItemId::from_uuid(row.id),
        work: WorkView::stored(
            row.name,
            row.code_system.as_deref(),
            row.code,
            row.tooth,
            &row.surfaces,
        ),
        phase: row.phase,
        estimate: Paise::new(row.estimate_paise),
        status: PlanItemStatus::parse(&row.status).map_err(invalid("status"))?,
        procedure_id: row.procedure_id.map(ProcedureId::from_uuid),
    })
}

async fn plan_views(tx: &mut ScopedTx, plans: Vec<PlanRow>) -> Result<Vec<PlanView>, AppError> {
    let ids: Vec<Uuid> = plans.iter().map(|plan| plan.id).collect();
    let items = treatment::list_items(tx.conn(), &ids).await?;
    let names = Names::load(tx, plans.iter().map(|plan| plan.clinician_id)).await?;
    plans
        .into_iter()
        .map(|plan| {
            let own = items
                .iter()
                .filter(|item| item.plan_id == plan.id)
                .cloned()
                .collect();
            plan_view(plan, own, &names)
        })
        .collect()
}

/// A plan as the API shows it, from its rows.
fn plan_view(plan: PlanRow, items: Vec<ItemRow>, names: &Names) -> Result<PlanView, AppError> {
    let items: Vec<PlanItemView> = items.into_iter().map(item_view).collect::<Result<_, _>>()?;
    let estimate = Paise::checked_sum(
        items
            .iter()
            .filter(|item| item.status != PlanItemStatus::Cancelled)
            .map(|item| item.estimate),
    )
    .ok_or(AppError::Internal("plan estimate overflowed"))?;
    Ok(PlanView {
        id: TreatmentPlanId::from_uuid(plan.id),
        patient_id: PatientId::from_uuid(plan.patient_id),
        visit_id: plan.encounter_id.map(EncounterId::from_uuid),
        clinician: names.member(plan.clinician_id),
        title: plan.title,
        status: PlanStatus::parse(&plan.status).map_err(invalid("status"))?,
        accepted_at: plan.accepted_at,
        created_at: plan.created_at,
        estimate,
        items,
    })
}

/// A plan item as received.
#[derive(Debug, Clone, Default)]
pub struct PlanItemInput {
    /// What and where.
    pub work: WorkInput,
    /// Estimated cost in paise.
    pub estimate_paise: i64,
    /// Phase, 1 (default) to 20.
    pub phase: Option<i16>,
}

/// A plan as received.
#[derive(Debug, Clone, Default)]
pub struct PlanInput {
    /// Its title.
    pub title: String,
    /// The visit it is proposed in.
    pub visit_id: Option<Uuid>,
    /// Its items.
    pub items: Vec<PlanItemInput>,
}

/// Proposes a treatment plan with an estimate per item.
///
/// # Errors
/// [`AppError::Invalid`] for bad input or a visit of another patient;
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn create_plan(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: PlanInput,
) -> Result<PlanView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let title = clinical_text(&input.title, 1, 200).map_err(invalid("title"))?;
    if input.items.is_empty() || input.items.len() > MAX_ITEMS {
        return Err(AppError::invalid(
            "items",
            format!("give 1 to {MAX_ITEMS} items"),
        ));
    }
    let items = input
        .items
        .iter()
        .map(|item| {
            let work = WorkView::parse(&item.work, None)?;
            let estimate = fee(item.estimate_paise).map_err(invalid("items.estimate_paise"))?;
            let phase = item.phase.unwrap_or(1);
            if !(1..=20).contains(&phase) {
                return Err(AppError::invalid("items.phase", "must be 1 to 20"));
            }
            Ok((work, estimate, phase))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient = require_patient(tx, patient_id).await?;
        let plan = treatment::insert_plan(
            tx.conn(),
            TreatmentPlanId::new_v7().uuid(),
            patient.id,
            actor.membership_id.uuid(),
            input.visit_id,
            &title,
        )
        .await
        .map_err(|error| match error.kind() {
            DbErrorKind::Conflict => AppError::invalid("visit_id", "not a visit of this patient"),
            _ => AppError::Db(error),
        })?;
        for (work, estimate, phase) in &items {
            let surface_texts = work.surface_texts();
            treatment::insert_item(
                tx.conn(),
                TreatmentPlanItemId::new_v7().uuid(),
                &plan,
                &work.row(&surface_texts),
                *phase,
                estimate.get(),
            )
            .await?;
        }
        let mut views = plan_views(tx, vec![plan]).await?;
        views.pop().ok_or(AppError::Internal("plan vanished"))
    })
    .await
}

/// A patient's treatment plans, newest first.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn plans(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<PlanView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let entries = treatment::list_for_patient(tx.conn(), patient_id.uuid())
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        entries
            .into_iter()
            .map(|entry| {
                let names = Names::of([(entry.plan.clinician_id, entry.clinician_name)]);
                plan_view(entry.plan, entry.items, &names)
            })
            .collect()
    })
    .await
}

/// Records the patient's acceptance of a proposed plan: the chosen items (all when
/// `item_ids` is `None`) are accepted and the others cancelled.
///
/// # Errors
/// [`AppError::NotFound`] when the plan isn't in this clinic; [`AppError::Conflict`] unless
/// it is proposed; [`AppError::Invalid`] when a chosen item isn't a proposed item of the plan.
pub async fn accept_plan(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    plan_id: TreatmentPlanId,
    item_ids: Option<Vec<Uuid>>,
    now: OffsetDateTime,
) -> Result<PlanView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let plan = treatment::get_plan(tx.conn(), plan_id.uuid(), true)
            .await?
            .ok_or(AppError::NotFound("treatment plan"))?;
        if plan.status != PlanStatus::Proposed.as_str() {
            return Err(AppError::Conflict("only a proposed plan can be accepted"));
        }
        if let Some(ids) = &item_ids {
            let items = treatment::list_items(tx.conn(), &[plan.id]).await?;
            let proposed = |id: &Uuid| {
                items
                    .iter()
                    .any(|item| item.id == *id && item.status == PlanItemStatus::Proposed.as_str())
            };
            if ids.is_empty() || !ids.iter().all(proposed) {
                return Err(AppError::invalid(
                    "item_ids",
                    "choose proposed items of this plan",
                ));
            }
        }
        treatment::accept_plan(tx.conn(), plan.id, item_ids.as_deref(), now).await?;
        let plan = treatment::get_plan(tx.conn(), plan.id, false)
            .await?
            .ok_or(AppError::NotFound("treatment plan"))?;
        let mut views = plan_views(tx, vec![plan]).await?;
        views.pop().ok_or(AppError::Internal("plan vanished"))
    })
    .await
}

/// Moves an accepted plan item to done or cancelled, then the plan to in progress or
/// completed. Items that are proposed, done or cancelled are frozen: proposals change only
/// through the plan's acceptance, and finished items never change.
///
/// # Errors
/// [`AppError::NotFound`] when the item isn't in this clinic; [`AppError::Invalid`] for a
/// status other than `done` or `cancelled`; [`AppError::Conflict`] unless the item is accepted.
pub async fn set_item_status(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    item_id: TreatmentPlanItemId,
    status: &str,
) -> Result<PlanView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let status = PlanItemStatus::parse(status).map_err(invalid("status"))?;
    if !matches!(status, PlanItemStatus::Done | PlanItemStatus::Cancelled) {
        return Err(AppError::invalid("status", "use done or cancelled"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let item = treatment::get_item_for_update(tx.conn(), item_id.uuid())
            .await?
            .ok_or(AppError::NotFound("treatment plan item"))?;
        if item.status != PlanItemStatus::Accepted.as_str() {
            return Err(AppError::Conflict("only an accepted item can be finished"));
        }
        treatment::set_item_status(tx.conn(), item.id, status.as_str()).await?;
        let plan = treatment::get_plan(tx.conn(), item.plan_id, false)
            .await?
            .ok_or(AppError::NotFound("treatment plan"))?;
        let mut views = plan_views(tx, vec![plan]).await?;
        views.pop().ok_or(AppError::Internal("plan vanished"))
    })
    .await
}
