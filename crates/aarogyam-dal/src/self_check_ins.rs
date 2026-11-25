//! QR arrival requests and the clinic's QR settings. Every function takes the connection of an
//! open clinic transaction (the public scope for a patient's request, the staff scope for the
//! desk), so row-level security limits it to one clinic. The payload is personal data: it is
//! never logged and is cleared when a request is handled.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

/// A request waiting for the desk.
#[derive(Debug, Clone)]
pub struct PendingRow {
    /// Identifier.
    pub id: Uuid,
    /// When the patient sent it.
    pub created_at: OffsetDateTime,
    /// Branch, if one was named.
    pub branch_id: Option<Uuid>,
    /// What the patient typed.
    pub payload: Value,
}

/// How full the lists are, for the caps.
#[derive(Debug, Clone, Copy)]
pub struct Counts {
    /// Requests waiting for the desk.
    pub pending: i64,
    /// Requests the clinic received in the last hour.
    pub clinic_last_hour: i64,
    /// Requests this phone made in the last hour.
    pub phone_last_hour: i64,
}

/// The clinic's QR settings object (`{}` when none).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn settings(conn: &mut PgConnection) -> Result<Value, DbError> {
    let value = sqlx::query_scalar!(
        r#"select self_check_in as "self_check_in!" from aarogyam.org_settings where org_id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(value.unwrap_or_else(|| Value::Object(serde_json::Map::new())))
}

/// Replaces the QR settings object; `false` when the clinic has no settings row.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_settings(conn: &mut PgConnection, value: &Value) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.org_settings set self_check_in = $1 where org_id = app.tenant_id()",
        value
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Takes the clinic's lock on its arrival list until the transaction ends, so the caps hold
/// when requests come in at once.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_list(conn: &mut PgConnection) -> Result<(), DbError> {
    sqlx::query!(
        "select pg_advisory_xact_lock(hashtextextended('self_check_ins:' || app.tenant_id()::text, 0))"
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// The counts the caps need, for `phone` (`E.164`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn counts(
    conn: &mut PgConnection,
    phone: &str,
    now: OffsetDateTime,
) -> Result<Counts, DbError> {
    let row = sqlx::query!(
        r#"select count(*) filter (where status = 'pending') as "pending!",
                  count(*) filter (where created_at > $2::timestamptz - interval '1 hour') as "clinic!",
                  count(*) filter (where created_at > $2::timestamptz - interval '1 hour'
                                     and phone_hash = sha256(convert_to(app.tenant_id()::text || $1, 'UTF8'))) as "phone!"
           from aarogyam.self_check_ins"#,
        phone,
        now
    )
    .fetch_one(conn)
    .await?;
    Ok(Counts {
        pending: row.pending,
        clinic_last_hour: row.clinic,
        phone_last_hour: row.phone,
    })
}

/// Saves a pending request; returns its id.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    branch_id: Option<Uuid>,
    payload: &Value,
    phone: &str,
) -> Result<Uuid, DbError> {
    let id = sqlx::query_scalar!(
        r#"insert into aarogyam.self_check_ins (branch_id, payload, phone_hash)
           values ($1, $2, sha256(convert_to(app.tenant_id()::text || $3, 'UTF8')))
           returning id"#,
        branch_id,
        payload,
        phone
    )
    .fetch_one(conn)
    .await?;
    Ok(id)
}

/// The pending requests, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_pending(conn: &mut PgConnection) -> Result<Vec<PendingRow>, DbError> {
    let rows = sqlx::query!(
        r#"select id, created_at, branch_id, payload as "payload!"
           from aarogyam.self_check_ins where status = 'pending' and payload is not null
           order by created_at, id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| PendingRow {
            id: row.id,
            created_at: row.created_at,
            branch_id: row.branch_id,
            payload: row.payload,
        })
        .collect())
}

/// A request, locked until the transaction ends: `Some((pending, row))`. `None` when the clinic
/// has no such request. The row is `None` once the request was handled (its payload is gone).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<Option<PendingRow>>, DbError> {
    let row = sqlx::query!(
        r#"select id, created_at, branch_id, payload, status
           from aarogyam.self_check_ins where id = $1 for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| match (row.status.as_str(), row.payload) {
        ("pending", Some(payload)) => Some(PendingRow {
            id: row.id,
            created_at: row.created_at,
            branch_id: row.branch_id,
            payload,
        }),
        _ => None,
    }))
}

/// Marks a locked request handled and clears its payload.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_handled(
    conn: &mut PgConnection,
    id: Uuid,
    status: &str,
    patient_id: Option<Uuid>,
    token_id: Option<Uuid>,
    handled_by: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.self_check_ins
           set status = $2, payload = null, patient_id = $3, token_id = $4,
               handled_at = now(), handled_by = $5
           where id = $1"#,
        id,
        status,
        patient_id,
        token_id,
        handled_by
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Deletes pending requests older than 24 hours and handled ones older than 7 days, in every
/// clinic (`app.sweep_self_check_ins`); returns how many rows went.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn sweep(pool: &PgPool, now: OffsetDateTime) -> Result<i32, DbError> {
    let deleted: i32 = sqlx::query_scalar("select app.sweep_self_check_ins($1)")
        .bind(now)
        .fetch_one(pool)
        .await?;
    Ok(deleted)
}

/// Adds a line to the patient's summary note, starting the note when there is none.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn append_patient_note(
    conn: &mut PgConnection,
    patient_id: Uuid,
    line: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.patient_notes (patient_id, body) values ($1, $2)
           on conflict (org_id, patient_id)
           do update set body = aarogyam.patient_notes.body || E'\n' || excluded.body"#,
        patient_id,
        line
    )
    .execute(conn)
    .await?;
    Ok(())
}
