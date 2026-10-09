//! Lab orders, their items and history. Every function takes the connection of an open clinic
//! transaction. Reads narrow to a member's own orders through `app.clinical_in_reach` (the
//! doctor on the order, who created it, or who treats its visit); `member` is `None` for all.

use sakalya_db::DbError;
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgConnection;
use sqlx::types::Json;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// An item on an order.
#[derive(Debug, Clone, Deserialize)]
pub struct ItemJson {
    /// Identifier.
    pub id: Uuid,
    /// Position on the order, from 1.
    pub line_no: i16,
    /// What to make: crown, bridge, denture.
    pub work_type: String,
    /// FDI tooth numbers.
    pub teeth: Vec<i16>,
    /// Shade, such as A2.
    pub shade: Option<String>,
    /// Material, such as zirconia.
    pub material: Option<String>,
    /// How many.
    pub qty: i32,
    /// What the lab charges for one; `None` unless asked for with costs.
    pub unit_cost_paise: Option<i64>,
}

/// An order as `app.lab_order_json` writes it.
#[derive(Debug, Clone, Deserialize)]
pub struct OrderJson {
    /// Identifier.
    pub id: Uuid,
    /// `LAB-<n>`.
    pub number: String,
    /// The lab.
    pub vendor_id: Uuid,
    /// Its name.
    pub vendor_name: Option<String>,
    /// Who at the lab.
    pub contact_id: Option<Uuid>,
    /// Their name.
    pub contact_name: Option<String>,
    /// Their phone, E.164.
    #[serde(default)]
    pub contact_phone: Option<String>,
    /// Their email.
    #[serde(default)]
    pub contact_email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    #[serde(default)]
    pub contact_whatsapp: Option<bool>,
    /// The lab's own phone, E.164.
    #[serde(default)]
    pub vendor_phone: Option<String>,
    /// When a member last contacted the lab about it (contact log or manual reminder).
    #[serde(default, with = "crate::json::timestamp::option")]
    pub last_contacted_at: Option<OffsetDateTime>,
    /// Who.
    #[serde(default)]
    pub last_contacted_by: Option<Uuid>,
    /// Their name.
    #[serde(default)]
    pub last_contacted_by_name: Option<String>,
    /// The patient.
    pub patient_id: Uuid,
    /// Their clinic number.
    pub patient_number: String,
    /// Their name, for clinic staff only: never in a reminder or a log.
    pub patient_name: String,
    /// The member responsible.
    pub doctor_id: Uuid,
    /// Their name.
    pub doctor_name: Option<String>,
    /// The procedure it is for.
    pub procedure_id: Option<Uuid>,
    /// The visit it came from.
    pub encounter_id: Option<Uuid>,
    /// The status.
    pub status: String,
    /// Where the work is between trials.
    pub stage: Option<String>,
    /// Instructions for the lab.
    pub instructions: Option<String>,
    /// When it went to the lab.
    #[serde(with = "crate::json::timestamp::option")]
    pub sent_at: Option<OffsetDateTime>,
    /// When it is due back.
    #[serde(with = "crate::json::date::option")]
    pub due_on: Option<Date>,
    /// When it came back.
    #[serde(with = "crate::json::timestamp::option")]
    pub received_at: Option<OffsetDateTime>,
    /// The order this one remakes.
    pub rework_of_id: Option<Uuid>,
    /// When it was recorded.
    #[serde(with = "crate::json::timestamp")]
    pub created_at: OffsetDateTime,
    /// The items, in order.
    pub items: Vec<ItemJson>,
    /// What happened to it, oldest first; read with one order only.
    #[serde(default)]
    pub events: Vec<EventJson>,
}

/// Something that happened to an order.
#[derive(Debug, Clone, Deserialize)]
pub struct EventJson {
    /// What.
    pub kind: String,
    /// The status before a change.
    pub from_status: Option<String>,
    /// The status after.
    pub to_status: Option<String>,
    /// The stage.
    pub stage: Option<String>,
    /// The due date.
    #[serde(with = "crate::json::date::option")]
    pub due_on: Option<Date>,
    /// Why a reminder went.
    pub reminder: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// How the lab was contacted.
    #[serde(default)]
    pub channel: Option<String>,
    /// What came of it.
    #[serde(default)]
    pub outcome: Option<String>,
    /// Who at the lab.
    #[serde(default)]
    pub contact_id: Option<Uuid>,
    /// The item's position, for an item change.
    #[serde(default)]
    pub line_no: Option<i16>,
    /// Who; `None` for the reminder job.
    pub actor_id: Option<Uuid>,
    /// When.
    #[serde(with = "crate::json::timestamp")]
    pub created_at: OffsetDateTime,
}

/// Which orders to list.
#[derive(Debug, Clone, Copy)]
pub struct OrderFilter {
    /// Only this status.
    pub status: Option<&'static str>,
    /// Only this lab.
    pub vendor_id: Option<Uuid>,
    /// Only this patient.
    pub patient_id: Option<Uuid>,
    /// Only work still at the lab that was due before this clinic day.
    pub overdue_before: Option<Date>,
    /// The member to narrow to; `None` for every order.
    pub member: Option<Uuid>,
    /// Whether to show unit costs.
    pub costs: bool,
    /// Most rows.
    pub limit: i64,
}

/// Orders matching `filter`, newest first, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    filter: &OrderFilter,
) -> Result<Vec<OrderJson>, DbError> {
    let rows = sqlx::query_scalar!(
        r#"select app.lab_order_json(o, $6) as "order!: Json<OrderJson>"
           from aarogyam.lab_orders o
           where ($1::text is null or o.status = $1)
             and ($2::uuid is null or o.vendor_id = $2)
             and ($3::uuid is null or o.patient_id = $3)
             and ($4::date is null or (o.due_on < $4 and o.status in ('sent', 'in_progress')))
             and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $5)
           order by o.id desc
           limit $7"#,
        filter.status,
        filter.vendor_id,
        filter.patient_id,
        filter.overdue_before,
        filter.member,
        filter.costs,
        filter.limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(|row| row.0).collect())
}

/// One order within reach.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
    costs: bool,
) -> Result<Option<OrderJson>, DbError> {
    let row = sqlx::query_scalar!(
        r#"select app.lab_order_json(o, $3) || jsonb_build_object('events', coalesce(
                    (select jsonb_agg(jsonb_build_object(
                              'kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
                              'stage', e.stage, 'due_on', e.due_on, 'reminder', e.reminder,
                              'note', e.note, 'channel', e.channel, 'outcome', e.outcome,
                              'contact_id', e.contact_id, 'line_no', e.line_no,
                              'actor_id', e.actor_id, 'created_at', e.created_at)
                            order by e.id)
                     from aarogyam.lab_order_events e where e.lab_order_id = o.id), '[]'::jsonb))
                  as "order!: Json<OrderJson>"
           from aarogyam.lab_orders o
           where o.id = $1 and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $2)"#,
        id,
        member,
        costs
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| row.0))
}

/// A patient's orders within reach, newest first, and whether the patient is in this clinic
/// and within reach (`app.patient_in_reach`), in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn for_patient(
    conn: &mut PgConnection,
    patient_id: Uuid,
    member: Option<Uuid>,
    costs: bool,
) -> Result<(bool, Vec<OrderJson>), DbError> {
    let row = sqlx::query!(
        r#"select exists (select 1 from aarogyam.patients p
                          where p.id = $1 and p.deleted_at is null
                            and app.patient_in_reach(p.id, $2)) as "found!",
                  coalesce((select jsonb_agg(app.lab_order_json(o, $3) order by o.id desc)
                            from aarogyam.lab_orders o
                            where o.patient_id = $1
                              and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $2)),
                           '[]'::jsonb) as "orders!: Json<Vec<OrderJson>>""#,
        patient_id,
        member,
        costs
    )
    .fetch_one(conn)
    .await?;
    Ok((row.found, row.orders.0))
}

/// What a new order points at, checked in one statement.
#[derive(Debug, Clone, Copy)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one answer per reference, read straight from one statement"
)]
pub struct OrderRefs {
    /// The patient is in this clinic and within reach.
    pub patient: bool,
    /// The lab exists.
    pub vendor: bool,
    /// The contact (if any) is at that lab.
    pub contact: bool,
    /// The doctor is an active member.
    pub doctor: bool,
    /// The procedure (if any) is the patient's.
    pub procedure: bool,
    /// The visit (if any) is the patient's.
    pub encounter: bool,
    /// The remade order (if any) is the patient's and within reach.
    pub rework: bool,
}

/// The references of a new order: patient, lab, contact, doctor, procedure, visit, remade order.
#[derive(Debug, Clone, Copy)]
pub struct NewRefs {
    /// The patient.
    pub patient_id: Uuid,
    /// The lab.
    pub vendor_id: Uuid,
    /// Who at the lab.
    pub contact_id: Option<Uuid>,
    /// The member responsible.
    pub doctor_id: Uuid,
    /// The procedure.
    pub procedure_id: Option<Uuid>,
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// The order remade.
    pub rework_of_id: Option<Uuid>,
}

/// Checks a new order's references.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn check_refs(
    conn: &mut PgConnection,
    refs: &NewRefs,
    member: Option<Uuid>,
) -> Result<OrderRefs, DbError> {
    let row = sqlx::query_as!(
        OrderRefs,
        r#"select
             exists (select 1 from aarogyam.patients p where p.id = $1 and p.deleted_at is null
                     and app.patient_in_reach(p.id, $8)) as "patient!",
             exists (select 1 from aarogyam.lab_vendors v where v.id = $2 and v.deleted_at is null)
               as "vendor!",
             ($3::uuid is null or exists (select 1 from aarogyam.lab_contacts c where c.id = $3
                                          and c.vendor_id = $2 and c.deleted_at is null)) as "contact!",
             exists (select 1 from aarogyam.memberships m where m.id = $4 and m.status = 'active')
               as "doctor!",
             ($5::uuid is null or exists (select 1 from aarogyam.procedures x where x.id = $5
                                          and x.patient_id = $1)) as "procedure!",
             ($6::uuid is null or exists (select 1 from aarogyam.encounters e where e.id = $6
                                          and e.patient_id = $1)) as "encounter!",
             ($7::uuid is null or exists (select 1 from aarogyam.lab_orders o where o.id = $7
                                          and o.patient_id = $1
                                          and app.clinical_in_reach(o.doctor_id, o.created_by,
                                                                    o.encounter_id, $8))) as "rework!""#,
        refs.patient_id,
        refs.vendor_id,
        refs.contact_id,
        refs.doctor_id,
        refs.procedure_id,
        refs.encounter_id,
        refs.rework_of_id,
        member
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// A new order with its items, checked.
#[derive(Debug, Clone)]
pub struct NewOrder<'a> {
    /// Identifier.
    pub id: Uuid,
    /// `LAB-<n>`.
    pub number: &'a str,
    /// What it points at.
    pub refs: NewRefs,
    /// `draft` or `sent`.
    pub status: &'a str,
    /// Stage.
    pub stage: Option<&'a str>,
    /// Instructions for the lab.
    pub instructions: Option<&'a str>,
    /// When it went to the lab, for a sent order.
    pub sent_at: Option<OffsetDateTime>,
    /// When it is due back.
    pub due_on: Option<Date>,
    /// The items: a JSON array of `{line_no, work_type, teeth, shade, material, qty,
    /// unit_cost_paise}`.
    pub items: &'a Value,
    /// The member recording it.
    pub actor: Uuid,
}

/// Records an order, its items and its `created` event in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, order: &NewOrder<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"with o as (
             insert into aarogyam.lab_orders
               (id, number, vendor_id, contact_id, patient_id, doctor_id, procedure_id,
                encounter_id, rework_of_id, status, stage, instructions, sent_at, due_on)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             returning id
           ), i as (
             insert into aarogyam.lab_order_items
               (lab_order_id, line_no, work_type, teeth, shade, material, qty, unit_cost_paise)
             select o.id, x.line_no, x.work_type, x.teeth, x.shade, x.material, x.qty,
                    x.unit_cost_paise
             from o, jsonb_to_recordset($15) as x(line_no smallint, work_type text, teeth smallint[],
                                                  shade text, material text, qty int,
                                                  unit_cost_paise bigint)
             returning id
           )
           insert into aarogyam.lab_order_events (lab_order_id, kind, to_status, due_on, actor_id)
           select o.id, 'created', $10, $14, $16 from o"#,
        order.id,
        order.number,
        order.refs.vendor_id,
        order.refs.contact_id,
        order.refs.patient_id,
        order.refs.doctor_id,
        order.refs.procedure_id,
        order.refs.encounter_id,
        order.refs.rework_of_id,
        order.status,
        order.stage,
        order.instructions,
        order.sent_at,
        order.due_on,
        order.items,
        order.actor
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// An order's state, locked for a change.
#[derive(Debug, Clone)]
pub struct Locked {
    /// The status.
    pub status: String,
    /// The stage.
    pub stage: Option<String>,
    /// The due date.
    pub due_on: Option<Date>,
    /// The lab.
    pub vendor_id: Uuid,
    /// Who at the lab.
    pub contact_id: Option<Uuid>,
    /// Instructions.
    pub instructions: Option<String>,
}

/// Locks an order within reach for a change.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<Locked>, DbError> {
    let row = sqlx::query_as!(
        Locked,
        r#"select status, stage, due_on, vendor_id, contact_id, instructions
           from aarogyam.lab_orders
           where id = $1 and app.clinical_in_reach(doctor_id, created_by, encounter_id, $2)
           for update"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A status change.
#[derive(Debug, Clone, Copy)]
pub struct StatusChange<'a> {
    /// The status it had.
    pub from: &'a str,
    /// The status it moves to.
    pub to: &'a str,
    /// A new stage, if any.
    pub stage: Option<&'a str>,
    /// Why, if said.
    pub note: Option<&'a str>,
    /// When.
    pub at: OffsetDateTime,
    /// Who.
    pub actor: Uuid,
}

/// Moves a locked order to another status (stamping when it went to or came back from the
/// lab) and records the event, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_status(
    conn: &mut PgConnection,
    id: Uuid,
    change: &StatusChange<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"with o as (
             update aarogyam.lab_orders
             set status = $2,
                 sent_at = case when $2 = 'sent' then coalesce(sent_at, $3) else sent_at end,
                 received_at = case when $2 = 'received' then $3 else received_at end,
                 stage = coalesce($5, stage)
             where id = $1
             returning id
           )
           insert into aarogyam.lab_order_events
             (lab_order_id, kind, from_status, to_status, stage, note, actor_id)
           select id, 'status_changed', $4, $2, $5, $6, $7 from o"#,
        id,
        change.to,
        change.at,
        change.from,
        change.stage,
        change.note,
        change.actor
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// An order's details after a change.
#[derive(Debug, Clone, Copy)]
pub struct Details<'a> {
    /// Who at the lab.
    pub contact_id: Option<Uuid>,
    /// Stage.
    pub stage: Option<&'a str>,
    /// Instructions.
    pub instructions: Option<&'a str>,
    /// Due date; a new one clears the reminder steps (trigger).
    pub due_on: Option<Date>,
}

/// Replaces a locked order's details and records a `stage_changed` or `due_changed` event for
/// each that changed, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure, including a contact at another lab.
pub async fn update_details(
    conn: &mut PgConnection,
    id: Uuid,
    details: &Details<'_>,
    stage_changed: bool,
    due_changed: bool,
    actor: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"with o as (
             update aarogyam.lab_orders
             set contact_id = $2, stage = $3, instructions = $4, due_on = $5
             where id = $1
             returning id
           )
           insert into aarogyam.lab_order_events (lab_order_id, kind, stage, due_on, actor_id)
           select o.id, k.kind, $3, $5, $8 from o
           cross join (values ('stage_changed', $6::boolean), ('due_changed', $7::boolean)) k(kind, yes)
           where k.yes"#,
        id,
        details.contact_id,
        details.stage,
        details.instructions,
        details.due_on,
        stage_changed,
        due_changed,
        actor
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Queues a reminder email to the lab of an order at the lab and within reach, records it and
/// marks the lab contacted now by `actor`; `None` when the order isn't at the lab, isn't within reach, or its lab has no email.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn remind(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
    message_id: Uuid,
    actor: Uuid,
) -> Result<Option<Uuid>, DbError> {
    let queued = sqlx::query_scalar!(
        r#"with o as (
             select org_id, id from aarogyam.lab_orders
             where id = $1 and status in ('sent', 'in_progress')
               and app.clinical_in_reach(doctor_id, created_by, encounter_id, $2)
           ), m as (
             insert into aarogyam.outbox_events (id, event_key, channel, recipient, payload)
             select $3, 'lab_order.reminder', 'email', c.email,
                    app.lab_reminder_payload(o.org_id, o.id, 'manual')
             from o cross join lateral app.lab_reminder_email(o.org_id, o.id) c
             returning id
           ), e as (
             insert into aarogyam.lab_order_events (lab_order_id, kind, reminder, actor_id)
             select $1, 'reminded', 'manual', $4 from m
           ), c as (
             update aarogyam.lab_orders set last_contacted_at = now(), last_contacted_by = $4
             where id = $1 and exists (select 1 from m)
           )
           select id as "id!" from m"#,
        id,
        member,
        message_id,
        actor
    )
    .fetch_optional(conn)
    .await?;
    Ok(queued)
}
