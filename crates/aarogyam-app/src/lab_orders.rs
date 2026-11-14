//! Lab orders: work sent to a lab for a patient, its items, where it is, and reminders to the
//! lab. Seen with `labs.read`, recorded and moved with `labs.write`; both narrow to a member's
//! own orders at the `own` scope (`app.clinical_in_reach`). Unit costs need `finance.view`.

use aarogyam_dal::lab_orders::{self as dal, EventJson, ItemJson, OrderJson};
use aarogyam_dal::{labs, patients};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{
    EncounterId, LabContactId, LabOrderId, LabOrderItemId, LabVendorId, MembershipId, MessageId,
    PatientId, ProcedureId,
};
use aarogyam_domain::lab::{
    ContactLogChannel, ContactOutcome, LabError, LabEventKind, LabOrderStatus, LabPipeline,
    LabReminder, MAX_ITEMS, MAX_REMINDER_ORDERS, ReminderChannel, ReminderItem, ReminderOrder,
    TrackerStage, check_qty, check_teeth, check_unit_cost, reminder_payload, reminder_text,
    tracker_stage, whatsapp_link,
};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::labs::trimmed;
use crate::scope::staff_scope as scope;
use serde_json::json;

/// An item on an order.
#[derive(Debug, Clone)]
pub struct ItemView {
    /// Identifier.
    pub id: LabOrderItemId,
    /// Position on the order, from 1.
    pub line_no: i16,
    /// What to make.
    pub work_type: String,
    /// FDI tooth numbers.
    pub teeth: Vec<i16>,
    /// Shade.
    pub shade: Option<String>,
    /// Material.
    pub material: Option<String>,
    /// How many.
    pub qty: i32,
    /// What the lab charges for one; `None` without `finance.view` or when not given.
    pub unit_cost: Option<Paise>,
}

/// Something that happened to an order.
#[derive(Debug, Clone)]
pub struct EventView {
    /// What.
    pub kind: LabEventKind,
    /// The status before a change.
    pub from_status: Option<LabOrderStatus>,
    /// The status after.
    pub to_status: Option<LabOrderStatus>,
    /// The stage.
    pub stage: Option<String>,
    /// The due date.
    pub due_on: Option<Date>,
    /// Why a reminder went.
    pub reminder: Option<LabReminder>,
    /// A note.
    pub note: Option<String>,
    /// How the lab was contacted, for `contacted`.
    pub channel: Option<ContactLogChannel>,
    /// What came of it.
    pub outcome: Option<ContactOutcome>,
    /// Who at the lab.
    pub contact_id: Option<LabContactId>,
    /// The item's position, for an item change.
    pub line_no: Option<i16>,
    /// Who; `None` for the reminder job.
    pub actor_id: Option<MembershipId>,
    /// When.
    pub at: OffsetDateTime,
}

/// How to reach the order's contact: phone, email, and whether they use `WhatsApp`.
#[derive(Debug, Clone, Default)]
pub struct ContactReach {
    /// Phone, E.164.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    pub whatsapp: bool,
}

/// When a member last contacted the lab about an order, and who.
#[derive(Debug, Clone)]
pub struct LastContact {
    /// When.
    pub at: OffsetDateTime,
    /// Who, and their name.
    pub by: Option<(MembershipId, Option<String>)>,
}

/// A lab order as the API shows it.
#[derive(Debug, Clone)]
pub struct LabOrderView {
    /// Identifier.
    pub id: LabOrderId,
    /// `LAB-<n>`.
    pub number: String,
    /// The lab and its name.
    pub vendor: (LabVendorId, Option<String>),
    /// Who at the lab, and their name.
    pub contact: Option<(LabContactId, Option<String>)>,
    /// How to reach them.
    pub contact_reach: ContactReach,
    /// The lab's own phone.
    pub vendor_phone: Option<String>,
    /// When the lab was last contacted about it (contact log or manual reminder).
    pub last_contact: Option<LastContact>,
    /// The patient, their clinic number and name.
    pub patient: (PatientId, String, String),
    /// The member responsible, and their name.
    pub doctor: (MembershipId, Option<String>),
    /// The procedure it is for.
    pub procedure_id: Option<ProcedureId>,
    /// The visit it came from.
    pub encounter_id: Option<EncounterId>,
    /// Where it is.
    pub status: LabOrderStatus,
    /// Where the work is between trials.
    pub stage: Option<String>,
    /// Where it is on the five-step tracker, derived from the status and stage; `None` when
    /// cancelled.
    pub tracker_stage: Option<TrackerStage>,
    /// Instructions for the lab.
    pub instructions: Option<String>,
    /// When it went to the lab.
    pub sent_at: Option<OffsetDateTime>,
    /// When it is due back.
    pub due_on: Option<Date>,
    /// When it came back.
    pub received_at: Option<OffsetDateTime>,
    /// The order this one remakes.
    pub rework_of_id: Option<LabOrderId>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
    /// The items.
    pub items: Vec<ItemView>,
    /// What happened to it, oldest first; filled for one order only.
    pub events: Vec<EventView>,
    /// Whether unit costs are shown.
    pub costs_visible: bool,
    /// Where it stands for the front desk, derived from the status.
    pub pipeline: LabPipeline,
    /// Still at the lab after its due day.
    pub late: bool,
    /// Whole clinic days past the due day while late.
    pub days_late: Option<i64>,
}

fn item(row: ItemJson) -> ItemView {
    ItemView {
        id: LabOrderItemId::from_uuid(row.id),
        line_no: row.line_no,
        work_type: row.work_type,
        teeth: row.teeth,
        shade: row.shade,
        material: row.material,
        qty: row.qty,
        unit_cost: row.unit_cost_paise.map(Paise::new),
    }
}

fn status_of(text: Option<&str>) -> Option<LabOrderStatus> {
    text.and_then(|t| LabOrderStatus::parse(t).ok())
}

fn event(row: EventJson) -> EventView {
    EventView {
        kind: LabEventKind::parse(&row.kind).unwrap_or(LabEventKind::Created),
        from_status: status_of(row.from_status.as_deref()),
        to_status: status_of(row.to_status.as_deref()),
        stage: row.stage,
        due_on: row.due_on,
        reminder: row.reminder.and_then(|r| LabReminder::parse(&r).ok()),
        note: row.note,
        channel: row.channel.and_then(|c| ContactLogChannel::parse(&c).ok()),
        outcome: row.outcome.and_then(|o| ContactOutcome::parse(&o).ok()),
        contact_id: row.contact_id.map(LabContactId::from_uuid),
        line_no: row.line_no,
        actor_id: row.actor_id.map(MembershipId::from_uuid),
        at: row.created_at,
    }
}

fn view(row: OrderJson, costs_visible: bool, today: Date) -> LabOrderView {
    let status = LabOrderStatus::parse(&row.status).unwrap_or(LabOrderStatus::Draft);
    let late = status.is_late(row.due_on, today);
    LabOrderView {
        pipeline: status.pipeline(),
        late,
        days_late: row
            .due_on
            .filter(|_| late)
            .map(|due| (today - due).whole_days()),
        id: LabOrderId::from_uuid(row.id),
        number: row.number,
        vendor: (LabVendorId::from_uuid(row.vendor_id), row.vendor_name),
        contact: row
            .contact_id
            .map(|id| (LabContactId::from_uuid(id), row.contact_name)),
        contact_reach: ContactReach {
            phone: row.contact_phone,
            email: row.contact_email,
            whatsapp: row.contact_whatsapp.unwrap_or(false),
        },
        vendor_phone: row.vendor_phone,
        last_contact: row.last_contacted_at.map(|at| LastContact {
            at,
            by: row
                .last_contacted_by
                .map(|id| (MembershipId::from_uuid(id), row.last_contacted_by_name)),
        }),
        patient: (
            PatientId::from_uuid(row.patient_id),
            row.patient_number,
            row.patient_name,
        ),
        doctor: (MembershipId::from_uuid(row.doctor_id), row.doctor_name),
        procedure_id: row.procedure_id.map(ProcedureId::from_uuid),
        encounter_id: row.encounter_id.map(EncounterId::from_uuid),
        status,
        tracker_stage: tracker_stage(status, row.stage.as_deref()),
        stage: row.stage,
        instructions: row.instructions,
        sent_at: row.sent_at,
        due_on: row.due_on,
        received_at: row.received_at,
        rework_of_id: row.rework_of_id.map(LabOrderId::from_uuid),
        created_at: row.created_at,
        items: row.items.into_iter().map(item).collect(),
        events: row.events.into_iter().map(event).collect(),
        costs_visible,
    }
}

/// The clinic's date now.
fn today_of(actor: &ClinicActor) -> Date {
    clinic_today(&actor.timezone, OffsetDateTime::now_utc())
}

/// Most orders one list returns.
pub const MAX_LIST: i64 = 200;

/// Which orders to list.
#[derive(Debug, Clone, Copy, Default)]
pub struct ListFilter {
    /// Only this status.
    pub status: Option<LabOrderStatus>,
    /// Only this lab.
    pub vendor_id: Option<LabVendorId>,
    /// Only this patient.
    pub patient_id: Option<PatientId>,
    /// Only work still at the lab past its due date.
    pub overdue: bool,
    /// Only orders still needing something done, soonest due first.
    pub open: bool,
}

/// Orders within reach, newest first; at most `limit` (1 to 200).
///
/// # Errors
/// [`AppError::Denied`] without `labs.read`.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    filter: ListFilter,
    limit: i64,
    now: OffsetDateTime,
) -> Result<Vec<LabOrderView>, AppError> {
    actor.require(Permission::LabsRead)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let today = clinic_today(&actor.timezone, now);
    let query = dal::OrderFilter {
        status: filter.status.map(LabOrderStatus::as_str),
        vendor_id: filter.vendor_id.map(LabVendorId::uuid),
        patient_id: filter.patient_id.map(PatientId::uuid),
        overdue_before: filter.overdue.then_some(today),
        open: filter.open,
        member: actor.reach(Permission::LabsRead).member(),
        costs,
        limit: limit.clamp(1, MAX_LIST),
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(tx.conn(), &query).await?;
        Ok(rows
            .into_iter()
            .map(|row| view(row, costs, today))
            .collect())
    })
    .await
}

/// One order within reach, with its history.
///
/// # Errors
/// [`AppError::Denied`] without `labs.read`; [`AppError::NotFound`] when it isn't in this
/// clinic or within reach.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabOrderId,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsRead)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let member = actor.reach(Permission::LabsRead).member();
    let today = today_of(actor);
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::get(tx.conn(), id.uuid(), member, costs)
            .await?
            .map(|row| view(row, costs, today))
            .ok_or(AppError::NotFound("lab order"))
    })
    .await
}

/// A patient's orders within reach, newest first.
///
/// # Errors
/// [`AppError::Denied`] without `labs.read`; [`AppError::NotFound`] when the patient isn't in
/// this clinic or within reach (`patients.read`'s scope).
pub async fn for_patient(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<LabOrderView>, AppError> {
    actor.require(Permission::LabsRead)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let member = actor.reach(Permission::LabsRead).member();
    let today = today_of(actor);
    db.scoped(&scope(actor, request_id), async |tx| {
        let (found, rows) = dal::for_patient(tx.conn(), patient_id.uuid(), member, costs).await?;
        if !found {
            return Err(AppError::NotFound("patient"));
        }
        Ok(rows
            .into_iter()
            .map(|row| view(row, costs, today))
            .collect())
    })
    .await
}

/// An item to make.
#[derive(Debug, Clone, Default)]
pub struct ItemInput {
    /// What to make, such as `Crown`; up to 80 characters.
    pub work_type: String,
    /// FDI tooth numbers.
    pub teeth: Vec<i64>,
    /// Shade, up to 20 characters.
    pub shade: Option<String>,
    /// Material, up to 80 characters.
    pub material: Option<String>,
    /// How many; 1 unless said.
    pub qty: Option<i32>,
    /// What the lab charges for one; needs `finance.view`.
    pub unit_cost: Option<Paise>,
}

/// A lab order to record.
#[derive(Debug, Clone)]
pub struct NewOrderInput {
    /// The lab.
    pub vendor_id: LabVendorId,
    /// Who at the lab.
    pub contact_id: Option<LabContactId>,
    /// The patient.
    pub patient_id: PatientId,
    /// The member responsible; the caller unless said.
    pub doctor_id: Option<MembershipId>,
    /// The procedure it is for.
    pub procedure_id: Option<ProcedureId>,
    /// The visit it came from.
    pub encounter_id: Option<EncounterId>,
    /// The order this one remakes.
    pub rework_of_id: Option<LabOrderId>,
    /// Whether it goes to the lab now (`sent`) or stays a draft.
    pub send: bool,
    /// Stage, up to 80 characters.
    pub stage: Option<String>,
    /// Instructions for the lab, up to 2000 characters.
    pub instructions: Option<String>,
    /// When it is due back.
    pub due_on: Option<Date>,
    /// What to make: 1 to 50 items.
    pub items: Vec<ItemInput>,
}

/// An item's values, checked.
#[derive(Debug, Clone)]
pub(crate) struct CheckedItem {
    pub work_type: String,
    pub teeth: Vec<i16>,
    pub shade: Option<String>,
    pub material: Option<String>,
    pub qty: i32,
    pub unit_cost_paise: Option<i64>,
}

/// Checks one item: FDI teeth, quantity, and a unit cost only with `finance.view` (`costs`).
pub(crate) fn check_item(item: &ItemInput, costs: bool) -> Result<CheckedItem, AppError> {
    let work_type = trimmed(Some(&item.work_type), "work_type", 80)?
        .ok_or(AppError::invalid("work_type", "is required"))?;
    let teeth = check_teeth(&item.teeth).map_err(|e| AppError::invalid("teeth", e))?;
    let qty = check_qty(item.qty.unwrap_or(1)).map_err(|e| AppError::invalid("qty", e))?;
    let unit_cost_paise = match item.unit_cost {
        Some(_) if !costs => {
            return Err(AppError::Forbidden("setting lab costs needs finance.view"));
        }
        Some(cost) => {
            Some(check_unit_cost(cost.get()).map_err(|e| AppError::invalid("unit_cost_paise", e))?)
        }
        None => None,
    };
    Ok(CheckedItem {
        work_type,
        teeth,
        shade: trimmed(item.shade.as_deref(), "shade", 20)?,
        material: trimmed(item.material.as_deref(), "material", 80)?,
        qty,
        unit_cost_paise,
    })
}

fn items_json(items: &[ItemInput], costs: bool) -> Result<serde_json::Value, AppError> {
    if items.is_empty() || items.len() > MAX_ITEMS {
        return Err(AppError::invalid("items", LabError::Items));
    }
    let mut out = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let item = check_item(item, costs)?;
        out.push(json!({
            "line_no": index + 1,
            "work_type": item.work_type,
            "teeth": item.teeth,
            "shade": item.shade,
            "material": item.material,
            "qty": item.qty,
            "unit_cost_paise": item.unit_cost_paise,
        }));
    }
    Ok(serde_json::Value::Array(out))
}

fn refs_error(refs: dal::OrderRefs) -> Option<AppError> {
    if !refs.patient {
        Some(AppError::NotFound("patient"))
    } else if !refs.vendor {
        Some(AppError::invalid("vendor_id", "no such lab in this clinic"))
    } else if !refs.contact {
        Some(AppError::invalid("contact_id", "not a contact at this lab"))
    } else if !refs.doctor {
        Some(AppError::invalid(
            "doctor_id",
            "not an active member of this clinic",
        ))
    } else if !refs.procedure {
        Some(AppError::invalid(
            "procedure_id",
            "not this patient's procedure",
        ))
    } else if !refs.encounter {
        Some(AppError::invalid(
            "encounter_id",
            "not this patient's visit",
        ))
    } else if !refs.rework {
        Some(AppError::invalid(
            "rework_of_id",
            "not this patient's lab order",
        ))
    } else {
        None
    }
}

/// Records a lab order with its items, as a draft or sent to the lab now.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::Forbidden`] for costs without
/// `finance.view`; [`AppError::Invalid`] for bad values or references;
/// [`AppError::NotFound`] when the patient isn't in this clinic or within reach.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewOrderInput,
    now: OffsetDateTime,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let items = items_json(&input.items, costs)?;
    let stage = trimmed(input.stage.as_deref(), "stage", 80)?;
    let instructions = trimmed(input.instructions.as_deref(), "instructions", 2000)?;
    let member = actor.reach(Permission::LabsWrite).member();
    let refs = dal::NewRefs {
        patient_id: input.patient_id.uuid(),
        vendor_id: input.vendor_id.uuid(),
        contact_id: input.contact_id.map(LabContactId::uuid),
        doctor_id: input.doctor_id.unwrap_or(actor.membership_id).uuid(),
        procedure_id: input.procedure_id.map(ProcedureId::uuid),
        encounter_id: input.encounter_id.map(EncounterId::uuid),
        rework_of_id: input.rework_of_id.map(LabOrderId::uuid),
    };
    let status = if input.send {
        LabOrderStatus::Sent
    } else {
        LabOrderStatus::Draft
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let checked = dal::check_refs(tx.conn(), &refs, member).await?;
        if let Some(error) = refs_error(checked) {
            return Err(error);
        }
        let serial = patients::next_number(tx.conn(), "lab_order").await?;
        let number = format!("LAB-{serial}");
        let id = LabOrderId::new_v7();
        dal::insert(
            tx.conn(),
            &dal::NewOrder {
                id: id.uuid(),
                number: &number,
                refs,
                status: status.as_str(),
                stage: stage.as_deref(),
                instructions: instructions.as_deref(),
                sent_at: input.send.then_some(now),
                due_on: input.due_on,
                items: &items,
                actor: actor.membership_id.uuid(),
            },
        )
        .await?;
        // The creator always reaches what they created.
        dal::get(tx.conn(), id.uuid(), None, costs)
            .await?
            .map(|row| view(row, costs, clinic_today(&actor.timezone, now)))
            .ok_or(AppError::Internal("lab order missing after insert"))
    })
    .await
}

pub(crate) async fn locked(
    tx: &mut ScopedTx,
    id: LabOrderId,
    member: Option<Uuid>,
) -> Result<(dal::Locked, LabOrderStatus), AppError> {
    let row = dal::lock(tx.conn(), id.uuid(), member)
        .await?
        .ok_or(AppError::NotFound("lab order"))?;
    let status =
        LabOrderStatus::parse(&row.status).map_err(|_| AppError::Internal("lab status"))?;
    Ok((row, status))
}

pub(crate) async fn reread(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    id: LabOrderId,
    costs: bool,
) -> Result<LabOrderView, AppError> {
    let today = today_of(actor);
    dal::get(tx.conn(), id.uuid(), None, costs)
        .await?
        .map(|row| view(row, costs, today))
        .ok_or(AppError::NotFound("lab order"))
}

/// A move to another status.
#[derive(Debug, Clone)]
pub struct StatusInput {
    /// The status to move to.
    pub status: LabOrderStatus,
    /// A new stage, up to 80 characters.
    pub stage: Option<String>,
    /// Why, up to 500 characters.
    pub note: Option<String>,
}

/// Moves an order to another status, optionally with a new stage and a note: sent stamps when
/// it went, received when it came back.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::NotFound`]; [`AppError::Conflict`]
/// for a move its status doesn't allow; [`AppError::Invalid`] for a long stage or note.
pub async fn set_status(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabOrderId,
    input: &StatusInput,
    now: OffsetDateTime,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let to = input.status;
    let stage = trimmed(input.stage.as_deref(), "stage", 80)?;
    let note = trimmed(input.note.as_deref(), "note", 500)?;
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let (_, from) = locked(tx, id, member).await?;
        if !from.can_move_to(to) {
            return Err(AppError::Conflict(
                "the order's status doesn't allow that move",
            ));
        }
        let change = dal::StatusChange {
            from: from.as_str(),
            to: to.as_str(),
            stage: stage.as_deref(),
            note: note.as_deref(),
            at: now,
            actor: actor.membership_id.uuid(),
        };
        dal::set_status(tx.conn(), id.uuid(), &change).await?;
        reread(tx, actor, id, costs).await
    })
    .await
}

/// A change to an order's details: fields left out stay; an empty stage or instructions
/// clears, and `Some(None)` clears the contact or due date.
#[derive(Debug, Clone, Default)]
pub struct DetailsInput {
    /// Who at the lab.
    pub contact_id: Option<Option<LabContactId>>,
    /// Stage.
    pub stage: Option<String>,
    /// Instructions.
    pub instructions: Option<String>,
    /// When it is due back; a new date runs the reminders again.
    pub due_on: Option<Option<Date>>,
}

/// Changes an order's contact, stage, instructions or due date, while it isn't final.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::NotFound`]; [`AppError::Conflict`]
/// for a fitted, reworked or cancelled order; [`AppError::Invalid`] for bad values or a
/// contact at another lab.
pub async fn update(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabOrderId,
    input: DetailsInput,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let (current, status) = locked(tx, id, member).await?;
        if status.is_final() {
            return Err(AppError::Conflict(
                "a fitted, reworked or cancelled order can't change",
            ));
        }
        let contact_id = match input.contact_id {
            None => current.contact_id,
            Some(None) => None,
            Some(Some(contact)) => {
                let row = labs::contact(tx.conn(), contact.uuid()).await?;
                if row.is_none_or(|c| c.vendor_id != current.vendor_id) {
                    return Err(AppError::invalid("contact_id", "not a contact at this lab"));
                }
                Some(contact.uuid())
            }
        };
        let stage = match input.stage.as_deref() {
            Some(text) => trimmed(Some(text), "stage", 80)?,
            None => current.stage.clone(),
        };
        let instructions = match input.instructions.as_deref() {
            Some(text) => trimmed(Some(text), "instructions", 2000)?,
            None => current.instructions.clone(),
        };
        let due_on = input.due_on.unwrap_or(current.due_on);
        let details = dal::Details {
            contact_id,
            stage: stage.as_deref(),
            instructions: instructions.as_deref(),
            due_on,
        };
        dal::update_details(
            tx.conn(),
            id.uuid(),
            &details,
            stage != current.stage,
            due_on != current.due_on,
            actor.membership_id.uuid(),
        )
        .await?;
        reread(tx, actor, id, costs).await
    })
    .await
}

/// A reminder queued for one order, and a `WhatsApp` link to send the same by hand.
#[derive(Debug, Clone)]
pub struct Reminded {
    /// The outbox message (email).
    pub message_id: MessageId,
    /// A `wa.me` link to the lab's contact with the same reminder typed in; `None` when the lab
    /// has no phone number.
    pub wa_link: Option<String>,
}

/// Emails the lab a reminder about an order at the lab now, through the outbox: the clinic,
/// the order number, the work, teeth, shade and due date, never the patient. Also returns a
/// `wa.me` link to remind the lab's contact on `WhatsApp` by hand (nothing is sent on it).
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::NotFound`]; [`AppError::Conflict`]
/// when the work isn't at the lab or the lab has no contact with an email address.
pub async fn remind(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabOrderId,
) -> Result<Reminded, AppError> {
    actor.require(Permission::LabsWrite)?;
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let message = MessageId::new_v7();
        let queued = dal::remind(
            tx.conn(),
            id.uuid(),
            member,
            message.uuid(),
            actor.membership_id.uuid(),
        )
        .await?;
        if queued.is_some() {
            let wa_link = whatsapp_links(tx, &[id.uuid()], member)
                .await?
                .into_iter()
                .next()
                .and_then(|group| group.wa_link);
            return Ok(Reminded {
                message_id: message,
                wa_link,
            });
        }
        let (_, status) = locked(tx, id, member).await?;
        if status.at_lab() {
            Err(AppError::Conflict(
                "this lab has no contact with an email address",
            ))
        } else {
            Err(AppError::Conflict("only work at the lab can be reminded"))
        }
    })
    .await
}

/// Why an order of a batch reminder was left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// The work isn't at the lab (not sent, already back, fitted, reworked or cancelled).
    NotAtLab,
    /// The lab has no contact with an email address.
    NoEmail,
    /// The lab has no phone number to open `WhatsApp` with.
    NoPhone,
}

impl SkipReason {
    /// The value the API shows.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NotAtLab => "not_at_lab",
            Self::NoEmail => "no_email",
            Self::NoPhone => "no_phone",
        }
    }
}

/// An order of a batch reminder that was left out.
#[derive(Debug, Clone)]
pub struct SkippedOrder {
    /// The order.
    pub order_id: LabOrderId,
    /// `LAB-<n>`.
    pub number: String,
    /// Why.
    pub reason: SkipReason,
}

/// What a batch reminder did for one lab.
#[derive(Debug, Clone)]
pub struct VendorReminder {
    /// The lab.
    pub vendor_id: LabVendorId,
    /// Its name.
    pub vendor_name: String,
    /// The contact the reminder is for, and their name; `None` when only the lab's own phone
    /// is known.
    pub contact: Option<(LabContactId, String)>,
    /// The orders it lists.
    pub order_ids: Vec<LabOrderId>,
    /// Their numbers, in the same order.
    pub order_numbers: Vec<String>,
    /// The queued email (email channel).
    pub message_id: Option<MessageId>,
    /// The `wa.me` link (`WhatsApp` channel).
    pub wa_link: Option<String>,
}

/// The result of a batch reminder.
#[derive(Debug, Clone)]
pub struct BatchReminded {
    /// The channel asked for.
    pub channel: ReminderChannel,
    /// One entry per lab that got a reminder, by name.
    pub vendors: Vec<VendorReminder>,
    /// Orders left out.
    pub skipped: Vec<SkippedOrder>,
}

/// A group of one lab's orders with the contact chosen for a `WhatsApp` link.
struct WhatsappGroup {
    wa_link: Option<String>,
}

/// Contacts in the order to try them: those the orders name first, then oldest first.
fn preferred<'a>(
    contacts: &'a [dal::ReminderContactRow],
    named: &[Option<Uuid>],
) -> Vec<&'a dal::ReminderContactRow> {
    let mut sorted: Vec<&dal::ReminderContactRow> = contacts.iter().collect();
    sorted.sort_by_key(|c| !named.contains(&Some(c.id)));
    sorted
}

/// Who gets an email: the first contact with an address.
fn pick_email<'a>(
    contacts: &'a [dal::ReminderContactRow],
    named: &[Option<Uuid>],
) -> Option<&'a dal::ReminderContactRow> {
    preferred(contacts, named)
        .into_iter()
        .find(|c| c.email.is_some())
}

/// Who gets a `WhatsApp` message: a contact who uses it on their phone, else any with a phone.
fn pick_whatsapp<'a>(
    contacts: &'a [dal::ReminderContactRow],
    named: &[Option<Uuid>],
) -> Option<&'a dal::ReminderContactRow> {
    let sorted = preferred(contacts, named);
    sorted
        .iter()
        .find(|c| c.whatsapp && c.phone_e164.is_some())
        .or_else(|| sorted.iter().find(|c| c.phone_e164.is_some()))
        .copied()
}

fn reminder_orders_of(rows: &[&dal::ReminderOrderRow]) -> Vec<ReminderOrder> {
    rows.iter()
        .map(|row| ReminderOrder {
            number: row.number.clone(),
            due_on: row.due_on,
            items: row
                .items
                .0
                .iter()
                .map(|item| ReminderItem {
                    work_type: item.work_type.clone(),
                    teeth: item.teeth.clone(),
                    shade: item.shade.clone(),
                })
                .collect(),
        })
        .collect()
}

/// A `wa.me` link for each lab among the orders `ids` (one group per lab).
async fn whatsapp_links(
    tx: &mut ScopedTx,
    ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<WhatsappGroup>, AppError> {
    let rows = dal::reminder_orders(tx.conn(), ids, member).await?;
    let vendors: Vec<Uuid> = rows.iter().map(|r| r.vendor_id).collect();
    let contacts = dal::reminder_contacts(tx.conn(), &vendors).await?;
    let clinic = dal::clinic_name(tx.conn()).await?;
    let mut groups = Vec::new();
    for (_, orders) in by_vendor(&rows) {
        let target = vendor_whatsapp(&contacts, &orders);
        let text = reminder_text(&clinic, &reminder_orders_of(&orders));
        groups.push(WhatsappGroup {
            wa_link: target.and_then(|(_, phone)| whatsapp_link(&phone, &text)),
        });
    }
    Ok(groups)
}

/// The orders as skipped, for `reason`.
fn skipped_of(
    orders: &[&dal::ReminderOrderRow],
    reason: SkipReason,
) -> impl Iterator<Item = SkippedOrder> {
    orders.iter().map(move |o| SkippedOrder {
        order_id: LabOrderId::from_uuid(o.id),
        number: o.number.clone(),
        reason,
    })
}

/// The orders grouped by lab, keeping their order.
fn by_vendor(rows: &[dal::ReminderOrderRow]) -> Vec<(Uuid, Vec<&dal::ReminderOrderRow>)> {
    let mut groups: Vec<(Uuid, Vec<&dal::ReminderOrderRow>)> = Vec::new();
    for row in rows {
        match groups
            .iter_mut()
            .find(|(vendor, _)| *vendor == row.vendor_id)
        {
            Some((_, orders)) => orders.push(row),
            None => groups.push((row.vendor_id, vec![row])),
        }
    }
    groups
}

/// The contact (if any) and phone a lab's `WhatsApp` reminder goes to.
fn vendor_whatsapp(
    contacts: &[dal::ReminderContactRow],
    orders: &[&dal::ReminderOrderRow],
) -> Option<(Option<(Uuid, String)>, String)> {
    let vendor = orders.first()?.vendor_id;
    let own: Vec<dal::ReminderContactRow> = contacts
        .iter()
        .filter(|c| c.vendor_id == vendor)
        .cloned()
        .collect();
    let named: Vec<Option<Uuid>> = orders.iter().map(|o| o.contact_id).collect();
    if let Some(contact) = pick_whatsapp(&own, &named) {
        let phone = contact.phone_e164.clone()?;
        return Some((Some((contact.id, contact.name.clone())), phone));
    }
    orders
        .first()?
        .vendor_phone
        .clone()
        .map(|phone| (None, phone))
}

/// Reminds the labs of several orders at once, one message per lab listing its order numbers and
/// work (type, teeth, shade, due date), never a patient. `email` queues one outbox message per
/// lab (to the order's contact with an address, else the lab's first), records a `reminded`
/// event on each order and marks the lab contacted. `whatsapp` queues nothing: it returns a
/// `wa.me` link per lab, to the contact who uses `WhatsApp` (else any with a phone, else the
/// lab's own phone), for staff to open and send; log the call with the contact log if it
/// matters. Orders not at the lab, and labs with no way to reach, are listed in `skipped`.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::Invalid`] for no orders or more than
/// 50; [`AppError::NotFound`] when an order isn't in this clinic or within reach (nothing is
/// done).
pub async fn remind_many(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    order_ids: &[LabOrderId],
    channel: ReminderChannel,
) -> Result<BatchReminded, AppError> {
    actor.require(Permission::LabsWrite)?;
    let mut ids: Vec<Uuid> = order_ids.iter().map(|id| id.uuid()).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() || ids.len() > MAX_REMINDER_ORDERS {
        return Err(AppError::invalid(
            "order_ids",
            format!("must name 1 to {MAX_REMINDER_ORDERS} orders"),
        ));
    }
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::reminder_orders(tx.conn(), &ids, member).await?;
        if rows.len() != ids.len() {
            return Err(AppError::NotFound("lab order"));
        }
        let vendors: Vec<Uuid> = rows.iter().map(|r| r.vendor_id).collect();
        let contacts = dal::reminder_contacts(tx.conn(), &vendors).await?;
        let clinic = dal::clinic_name(tx.conn()).await?;
        let mut result = BatchReminded {
            channel,
            vendors: Vec::new(),
            skipped: Vec::new(),
        };
        for (vendor_id, group) in by_vendor(&rows) {
            let (at_lab, away): (Vec<_>, Vec<_>) = group
                .into_iter()
                .partition(|o| LabOrderStatus::parse(&o.status).is_ok_and(LabOrderStatus::at_lab));
            result
                .skipped
                .extend(skipped_of(&away, SkipReason::NotAtLab));
            let Some(first) = at_lab.first() else {
                continue;
            };
            let lines = reminder_orders_of(&at_lab);
            let named: Vec<Option<Uuid>> = at_lab.iter().map(|o| o.contact_id).collect();
            let own: Vec<dal::ReminderContactRow> = contacts
                .iter()
                .filter(|c| c.vendor_id == vendor_id)
                .cloned()
                .collect();
            let mut entry = VendorReminder {
                vendor_id: LabVendorId::from_uuid(vendor_id),
                vendor_name: first.vendor_name.clone(),
                contact: None,
                order_ids: at_lab.iter().map(|o| LabOrderId::from_uuid(o.id)).collect(),
                order_numbers: at_lab.iter().map(|o| o.number.clone()).collect(),
                message_id: None,
                wa_link: None,
            };
            let reached = match channel {
                ReminderChannel::Email => match pick_email(&own, &named) {
                    Some(contact) => {
                        let message = MessageId::new_v7();
                        let ids: Vec<Uuid> = at_lab.iter().map(|o| o.id).collect();
                        let email = contact.email.clone().unwrap_or_default();
                        dal::queue_batch_reminder(
                            tx.conn(),
                            message.uuid(),
                            &email,
                            &reminder_payload(&clinic, &lines),
                            &ids,
                            actor.membership_id.uuid(),
                        )
                        .await?;
                        entry.contact =
                            Some((LabContactId::from_uuid(contact.id), contact.name.clone()));
                        entry.message_id = Some(message);
                        true
                    }
                    None => false,
                },
                ReminderChannel::Whatsapp => match vendor_whatsapp(&contacts, &at_lab) {
                    Some((contact, phone)) => {
                        entry.contact =
                            contact.map(|(id, name)| (LabContactId::from_uuid(id), name));
                        entry.wa_link = whatsapp_link(&phone, &reminder_text(&clinic, &lines));
                        entry.wa_link.is_some()
                    }
                    None => false,
                },
            };
            if reached {
                result.vendors.push(entry);
            } else {
                let reason = match channel {
                    ReminderChannel::Email => SkipReason::NoEmail,
                    ReminderChannel::Whatsapp => SkipReason::NoPhone,
                };
                result.skipped.extend(skipped_of(&at_lab, reason));
            }
        }
        Ok(result)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contact(
        n: u128,
        email: Option<&str>,
        phone: Option<&str>,
        whatsapp: bool,
    ) -> dal::ReminderContactRow {
        dal::ReminderContactRow {
            id: Uuid::from_u128(n),
            vendor_id: Uuid::nil(),
            name: format!("C{n}"),
            phone_e164: phone.map(str::to_owned),
            email: email.map(str::to_owned),
            whatsapp,
        }
    }

    #[test]
    fn the_contact_the_order_names_is_tried_first() {
        let contacts = [
            contact(1, Some("a@lab.in"), Some("+919800000001"), false),
            contact(2, Some("b@lab.in"), Some("+919800000002"), true),
        ];
        let named = [Some(Uuid::from_u128(2))];
        assert_eq!(
            pick_email(&contacts, &named).map(|c| c.id),
            Some(Uuid::from_u128(2))
        );
        assert_eq!(
            pick_email(&contacts, &[None]).map(|c| c.id),
            Some(Uuid::from_u128(1))
        );
        // A contact who uses WhatsApp wins over one who merely has a phone.
        assert_eq!(
            pick_whatsapp(&contacts, &[None]).map(|c| c.id),
            Some(Uuid::from_u128(2))
        );
    }

    #[test]
    fn a_contact_without_the_channel_is_passed_over() {
        let contacts = [contact(1, None, Some("+919800000001"), false)];
        assert!(pick_email(&contacts, &[None]).is_none());
        assert_eq!(
            pick_whatsapp(&contacts, &[None]).map(|c| c.id),
            Some(Uuid::from_u128(1))
        );
        assert!(pick_whatsapp(&[contact(3, Some("x@y.in"), None, false)], &[None]).is_none());
    }
}
