//! Changes to a lab order after it is recorded: adding, changing and removing items, and
//! logging a call, message, email or visit to the lab. Each needs `labs.write` (narrowed to
//! own orders at `own`), records a `lab_order_events` row, and returns the order as reread.

use aarogyam_dal::lab_order_changes::{self as dal, ItemValues};
use aarogyam_dal::labs;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{LabContactId, LabOrderId, LabOrderItemId};
use aarogyam_domain::lab::{ContactLogChannel, ContactOutcome, LabError, MAX_ITEMS};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::Date;
use uuid::Uuid;

use crate::error::AppError;
use crate::lab_orders::{CheckedItem, ItemInput, LabOrderView, check_item, locked, reread};
use crate::labs::trimmed;
use crate::scope::staff_scope as scope;

fn values(item: &CheckedItem) -> ItemValues<'_> {
    ItemValues {
        work_type: &item.work_type,
        teeth: &item.teeth,
        shade: item.shade.as_deref(),
        material: item.material.as_deref(),
        qty: item.qty,
        unit_cost_paise: item.unit_cost_paise,
    }
}

/// Locks an order within reach whose items may still change.
async fn open_order(
    tx: &mut ScopedTx,
    id: LabOrderId,
    member: Option<Uuid>,
) -> Result<(), AppError> {
    let (_, status) = locked(tx, id, member).await?;
    if status.is_final() {
        return Err(AppError::Conflict(
            "a fitted, reworked or cancelled order's items can't change",
        ));
    }
    Ok(())
}

/// The next free line: after the last, or the first gap once line 50 is taken.
fn next_line(used: &[i16]) -> Option<i16> {
    let max = i16::try_from(MAX_ITEMS).unwrap_or(i16::MAX);
    match used.iter().max() {
        None => Some(1),
        Some(&last) if last < max => Some(last + 1),
        Some(_) => (1..=max).find(|n| !used.contains(n)),
    }
}

/// Adds an item to an order that isn't final.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::Forbidden`] for a cost without
/// `finance.view`; [`AppError::Invalid`] for bad values or a 51st item; [`AppError::NotFound`];
/// [`AppError::Conflict`] for a fitted, reworked or cancelled order.
pub async fn add_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabOrderId,
    input: &ItemInput,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let item = check_item(input, costs)?;
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        open_order(tx, id, member).await?;
        let used = dal::lines(tx.conn(), id.uuid()).await?;
        let line = next_line(&used).ok_or(AppError::invalid("items", LabError::Items))?;
        let actor_id = actor.membership_id.uuid();
        dal::add_item(tx.conn(), id.uuid(), line, &values(&item), actor_id).await?;
        reread(tx, actor, id, costs).await
    })
    .await
}

/// A change to an item: fields left out stay; an empty shade or material clears, and
/// `Some(None)` clears the unit cost.
#[derive(Debug, Clone, Default)]
pub struct ItemChanges {
    /// What to make, up to 80 characters.
    pub work_type: Option<String>,
    /// FDI tooth numbers.
    pub teeth: Option<Vec<i64>>,
    /// Shade, up to 20 characters.
    pub shade: Option<String>,
    /// Material, up to 80 characters.
    pub material: Option<String>,
    /// How many, 1 to 100.
    pub qty: Option<i32>,
    /// What the lab charges for one; needs `finance.view` to set or clear.
    pub unit_cost: Option<Option<Paise>>,
}

/// Changes an item of an order that isn't final, with the checks of a new item.
///
/// # Errors
/// As [`add_item`], with [`AppError::NotFound`] for an item not in this clinic or reach.
pub async fn update_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    item_id: LabOrderItemId,
    changes: ItemChanges,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    if changes.unit_cost.is_some() && !costs {
        return Err(AppError::Forbidden("setting lab costs needs finance.view"));
    }
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let order = dal::item_order(tx.conn(), item_id.uuid(), member)
            .await?
            .map(LabOrderId::from_uuid)
            .ok_or(AppError::NotFound("lab order item"))?;
        open_order(tx, order, member).await?;
        let stored = dal::item(tx.conn(), item_id.uuid())
            .await?
            .ok_or(AppError::NotFound("lab order item"))?;
        let input = ItemInput {
            work_type: changes.work_type.unwrap_or(stored.work_type),
            teeth: changes
                .teeth
                .unwrap_or_else(|| stored.teeth.iter().map(|&t| i64::from(t)).collect()),
            shade: changes.shade.or(stored.shade),
            material: changes.material.or(stored.material),
            qty: Some(changes.qty.unwrap_or(stored.qty)),
            unit_cost: changes.unit_cost.flatten(),
        };
        let mut item = check_item(&input, costs)?;
        if changes.unit_cost.is_none() {
            item.unit_cost_paise = stored.unit_cost_paise;
        }
        let actor_id = actor.membership_id.uuid();
        dal::update_item(
            tx.conn(),
            order.uuid(),
            item_id.uuid(),
            &values(&item),
            actor_id,
        )
        .await?;
        reread(tx, actor, order, costs).await
    })
    .await
}

/// Removes an item from an order that isn't final; an order keeps at least one.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::NotFound`]; [`AppError::Conflict`]
/// for a final order or its last item.
pub async fn remove_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    item_id: LabOrderItemId,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let order = dal::item_order(tx.conn(), item_id.uuid(), member)
            .await?
            .map(LabOrderId::from_uuid)
            .ok_or(AppError::NotFound("lab order item"))?;
        open_order(tx, order, member).await?;
        if dal::lines(tx.conn(), order.uuid()).await?.len() <= 1 {
            return Err(AppError::Conflict("an order keeps at least one item"));
        }
        let actor_id = actor.membership_id.uuid();
        dal::remove_item(tx.conn(), order.uuid(), item_id.uuid(), actor_id).await?;
        reread(tx, actor, order, costs).await
    })
    .await
}

/// A call, message, email or visit to the lab about an order.
#[derive(Debug, Clone)]
pub struct ContactLogInput {
    /// How.
    pub channel: ContactLogChannel,
    /// Who at the lab: a contact of the order's lab.
    pub contact_id: Option<LabContactId>,
    /// What came of it.
    pub outcome: Option<ContactOutcome>,
    /// Free text, up to 500 characters.
    pub note: Option<String>,
    /// The date the lab promised: becomes the due date, so the reminders run again for it.
    pub promised_on: Option<Date>,
}

/// Logs contacting the lab: a `contacted` event by the caller, the order's
/// `last_contacted_at` and `last_contacted_by`, and the promised date as its due date.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::NotFound`]; [`AppError::Invalid`]
/// for a long note or a contact at another lab; [`AppError::Conflict`] for a promised date on
/// a fitted, reworked or cancelled order.
pub async fn log_contact(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabOrderId,
    input: &ContactLogInput,
) -> Result<LabOrderView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let costs = actor.require(Permission::FinanceView).is_ok();
    let note = trimmed(input.note.as_deref(), "note", 500)?;
    let member = actor.reach(Permission::LabsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let (current, status) = locked(tx, id, member).await?;
        if input.promised_on.is_some() && status.is_final() {
            return Err(AppError::Conflict(
                "a fitted, reworked or cancelled order has no due date to move",
            ));
        }
        if let Some(contact) = input.contact_id {
            let row = labs::contact(tx.conn(), contact.uuid()).await?;
            if row.is_none_or(|c| c.vendor_id != current.vendor_id) {
                return Err(AppError::invalid("contact_id", "not a contact at this lab"));
            }
        }
        let log = dal::ContactLog {
            channel: input.channel.as_str(),
            contact_id: input.contact_id.map(LabContactId::uuid),
            outcome: input.outcome.map(ContactOutcome::as_str),
            note: note.as_deref(),
            promised_on: input.promised_on,
            actor: actor.membership_id.uuid(),
        };
        dal::log_contact(tx.conn(), id.uuid(), &log).await?;
        reread(tx, actor, id, costs).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::next_line;

    #[test]
    fn new_items_go_after_the_last_then_into_gaps() {
        assert_eq!(next_line(&[]), Some(1));
        assert_eq!(next_line(&[1, 3]), Some(4));
        let mut full: Vec<i16> = (1..=50).collect();
        assert_eq!(next_line(&full), None);
        full.retain(|&n| n != 7);
        assert_eq!(next_line(&full), Some(7));
    }
}
