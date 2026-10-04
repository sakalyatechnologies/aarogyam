//! The outbox. Messages are queued inside a clinic transaction, with the change that causes
//! them; the worker claims and settles them across clinics through the definer functions in
//! `db/migrations/0017_outbox.sql`, since it acts for no one clinic.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

/// A message to queue in the current clinic.
#[derive(Debug, Clone)]
pub struct NewMessage<'a> {
    /// Identifier chosen by the caller (a version 7 UUID).
    pub id: Uuid,
    /// What it is about, such as `staff.invited`.
    pub event_key: &'a str,
    /// `email`.
    pub channel: &'a str,
    /// Where it goes, for messages to staff.
    pub recipient: Option<&'a str>,
    /// Ids and the non-patient values its template needs.
    pub payload: &'a Value,
    /// A one-time link secret it carries, cleared once it is sent or abandoned.
    pub secret: Option<&'a str>,
}

/// Queues a message in the current clinic transaction.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn enqueue(conn: &mut PgConnection, message: &NewMessage<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.outbox_events (id, event_key, channel, recipient, payload, secret)
           values ($1, $2, $3, $4, $5, $6)"#,
        message.id,
        message.event_key,
        message.channel,
        message.recipient,
        message.payload,
        message.secret
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A message claimed for delivery.
#[derive(Debug, Clone)]
pub struct Claimed {
    /// Its clinic.
    pub org_id: Uuid,
    /// The message.
    pub id: Uuid,
    /// What it is about.
    pub event_key: String,
    /// How it travels.
    pub channel: String,
    /// Where it goes.
    pub recipient: Option<String>,
    /// Template values.
    pub payload: Value,
    /// The link secret it carries.
    pub secret: Option<String>,
    /// Attempts so far, this one included.
    pub attempts: i32,
}

impl std::fmt::Display for Claimed {
    /// Ids only, so a claimed message can be logged without its address or secret.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.org_id, self.id)
    }
}

/// Claims up to `limit` due messages across clinics for `lease_seconds`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn claim(pool: &PgPool, limit: i32, lease_seconds: i32) -> Result<Vec<Claimed>, DbError> {
    let rows = sqlx::query_as!(
        Claimed,
        r#"select org_id as "org_id!", id as "id!", event_key as "event_key!", channel as "channel!",
                  recipient, payload as "payload!", secret, attempts as "attempts!"
           from app.outbox_claim($1, $2)"#,
        limit,
        lease_seconds
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Records that a claimed message was delivered.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_sent(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    provider: &str,
    provider_message_id: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"select app.outbox_sent($1, $2, $3, $4)"#,
        org_id,
        id,
        provider,
        provider_message_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Records a failed attempt: retried at `retry_at`, or abandoned when it is `None`. `error` is
/// a short description without the message's content.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_failed(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    error: &str,
    retry_at: Option<OffsetDateTime>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"select app.outbox_failed($1, $2, $3, $4)"#,
        org_id,
        id,
        error,
        retry_at
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Deletes messages processed more than `keep_days` ago; returns how many.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn purge(pool: &PgPool, keep_days: i32) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(r#"select app.outbox_purge($1) as "count!""#, keep_days)
        .fetch_one(pool)
        .await?;
    Ok(count)
}
