//! Outside labs and the people there. Every function takes the connection of an open clinic
//! transaction, except [`run_reminders`], the outbox job's cross-clinic step.

use sakalya_db::DbError;
use serde::Deserialize;
use sqlx::types::Json;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

/// A person at a lab.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactRow {
    /// Identifier.
    pub id: Uuid,
    /// The lab.
    pub vendor_id: Uuid,
    /// Name.
    pub name: String,
    /// What they do there.
    pub role: Option<String>,
    /// Phone, E.164.
    pub phone_e164: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    pub whatsapp: bool,
    /// `email`, `whatsapp` or `phone`.
    pub preferred_channel: String,
}

/// A lab with its contacts.
#[derive(Debug, Clone)]
pub struct VendorRow {
    /// Identifier.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// `dental_lab`, `pathology`, `radiology` or `other`.
    pub kind: String,
    /// Phone, E.164.
    pub phone_e164: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Address.
    pub address: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// The people there, by name.
    pub contacts: Json<Vec<ContactRow>>,
    /// When it was added.
    pub created_at: OffsetDateTime,
}

/// A lab's values, checked.
#[derive(Debug, Clone, Copy)]
pub struct VendorValues<'a> {
    /// Name.
    pub name: &'a str,
    /// Kind.
    pub kind: &'a str,
    /// Phone, E.164.
    pub phone_e164: Option<&'a str>,
    /// Email.
    pub email: Option<&'a str>,
    /// Address.
    pub address: Option<&'a str>,
    /// A note.
    pub note: Option<&'a str>,
}

/// The clinic's labs (`None`) or one (`Some(id)`), with their contacts, by name; removed ones
/// left out.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn vendors(conn: &mut PgConnection, id: Option<Uuid>) -> Result<Vec<VendorRow>, DbError> {
    let rows = sqlx::query_as!(
        VendorRow,
        r#"select v.id, v.name, v.kind, v.phone_e164, v.email, v.address, v.note, v.created_at,
                  (select coalesce(json_agg(c order by c.name, c.id), '[]'::json)
                   from (select c.id, c.vendor_id, c.name, c.role, c.phone_e164, c.email,
                                c.whatsapp, c.preferred_channel
                         from aarogyam.lab_contacts c
                         where c.vendor_id = v.id and c.deleted_at is null) c
                  ) as "contacts!: Json<Vec<ContactRow>>"
           from aarogyam.lab_vendors v
           where v.deleted_at is null and ($1::uuid is null or v.id = $1)
           order by lower(v.name), v.id"#,
        id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Adds a lab.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken name (`lab_vendors_name`).
pub async fn insert_vendor(
    conn: &mut PgConnection,
    id: Uuid,
    values: &VendorValues<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.lab_vendors (id, name, kind, phone_e164, email, address, note)
           values ($1, $2, $3, $4, $5, $6, $7)"#,
        id,
        values.name,
        values.kind,
        values.phone_e164,
        values.email,
        values.address,
        values.note
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Replaces a lab's values. `false` when the clinic has no such lab.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken name.
pub async fn update_vendor(
    conn: &mut PgConnection,
    id: Uuid,
    values: &VendorValues<'_>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.lab_vendors
           set name = $2, kind = $3, phone_e164 = $4, email = $5, address = $6, note = $7
           where id = $1 and deleted_at is null"#,
        id,
        values.name,
        values.kind,
        values.phone_e164,
        values.email,
        values.address,
        values.note
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Removes a lab and its contacts; its orders and payments stay. `false` when there is none.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_vendor(
    conn: &mut PgConnection,
    id: Uuid,
    at: OffsetDateTime,
) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"with v as (
             update aarogyam.lab_vendors set deleted_at = $2
             where id = $1 and deleted_at is null returning id
           ), c as (
             update aarogyam.lab_contacts set deleted_at = $2
             where vendor_id in (select id from v) and deleted_at is null returning id
           )
           select count(*) as "found!" from v"#,
        id,
        at
    )
    .fetch_one(conn)
    .await?;
    Ok(found == 1)
}

/// A contact's values, checked.
#[derive(Debug, Clone, Copy)]
pub struct ContactValues<'a> {
    /// Name.
    pub name: &'a str,
    /// What they do there.
    pub role: Option<&'a str>,
    /// Phone, E.164.
    pub phone_e164: Option<&'a str>,
    /// Email.
    pub email: Option<&'a str>,
    /// Whether they use `WhatsApp`.
    pub whatsapp: bool,
    /// `email`, `whatsapp` or `phone`.
    pub preferred_channel: &'a str,
}

/// Adds a contact to a lab; `None` when the clinic has no such lab.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_contact(
    conn: &mut PgConnection,
    id: Uuid,
    vendor_id: Uuid,
    values: &ContactValues<'_>,
) -> Result<Option<ContactRow>, DbError> {
    let row = sqlx::query_as!(
        ContactRow,
        r#"insert into aarogyam.lab_contacts
             (id, vendor_id, name, role, phone_e164, email, whatsapp, preferred_channel)
           select $1, v.id, $3, $4, $5, $6, $7, $8
           from aarogyam.lab_vendors v where v.id = $2 and v.deleted_at is null
           returning id, vendor_id, name, role, phone_e164, email, whatsapp, preferred_channel"#,
        id,
        vendor_id,
        values.name,
        values.role,
        values.phone_e164,
        values.email,
        values.whatsapp,
        values.preferred_channel
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// One contact, unless removed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn contact(conn: &mut PgConnection, id: Uuid) -> Result<Option<ContactRow>, DbError> {
    let row = sqlx::query_as!(
        ContactRow,
        r#"select id, vendor_id, name, role, phone_e164, email, whatsapp, preferred_channel
           from aarogyam.lab_contacts where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Replaces a contact's values; `None` when there is no such contact.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_contact(
    conn: &mut PgConnection,
    id: Uuid,
    values: &ContactValues<'_>,
) -> Result<Option<ContactRow>, DbError> {
    let row = sqlx::query_as!(
        ContactRow,
        r#"update aarogyam.lab_contacts
           set name = $2, role = $3, phone_e164 = $4, email = $5, whatsapp = $6,
               preferred_channel = $7
           where id = $1 and deleted_at is null
           returning id, vendor_id, name, role, phone_e164, email, whatsapp, preferred_channel"#,
        id,
        values.name,
        values.role,
        values.phone_e164,
        values.email,
        values.whatsapp,
        values.preferred_channel
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Removes a contact. `false` when there is none.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_contact(
    conn: &mut PgConnection,
    id: Uuid,
    at: OffsetDateTime,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.lab_contacts set deleted_at = $2 where id = $1 and deleted_at is null",
        id,
        at
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// One step the reminder job took.
#[derive(Debug, Clone)]
pub struct ReminderStep {
    /// The clinic.
    pub org_id: Uuid,
    /// The order.
    pub lab_order_id: Uuid,
    /// `due_soon`, `due_today` or `overdue`.
    pub step: String,
    /// The email queued; `None` for an overdue flag or a lab without an email.
    pub message_id: Option<Uuid>,
}

/// Runs the lab reminder step across clinics (`app.run_lab_reminders`): each step once per
/// due date.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn run_reminders(
    pool: &PgPool,
    now: OffsetDateTime,
    limit: i32,
) -> Result<Vec<ReminderStep>, DbError> {
    let rows = sqlx::query_as!(
        ReminderStep,
        r#"select org_id as "org_id!", lab_order_id as "lab_order_id!", step as "step!",
                  message_id
           from app.run_lab_reminders($1, $2)"#,
        now,
        limit
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
