//! A clinic's message templates (migration 0375), inside a clinic transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// One template as stored.
#[derive(Debug, Clone)]
pub struct TemplateRow {
    /// Identifier.
    pub id: Uuid,
    /// `care.note`, `appointment.reminder`...
    pub key: String,
    /// `email`, `whatsapp` or `sms`.
    pub channel: String,
    /// `en-IN`, `hi-IN`...
    pub language: String,
    /// Its text with `{{variables}}`.
    pub body: String,
    /// `marketing`, `utility` or `authentication`.
    pub category: String,
    /// Its name at Meta.
    pub provider_template_ref: Option<String>,
    /// `draft`, `submitted`, `approved`, `rejected` or `paused`.
    pub status: String,
    /// When it was last submitted.
    pub submitted_at: Option<OffsetDateTime>,
    /// When Meta last reviewed it.
    pub reviewed_at: Option<OffsetDateTime>,
    /// The SMS sender header (DLT), later.
    pub sender_header: Option<String>,
    /// The SMS DLT template id, later.
    pub dlt_template_id: Option<String>,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// The clinic's templates, by key, channel and language.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(conn: &mut PgConnection) -> Result<Vec<TemplateRow>, DbError> {
    let rows = sqlx::query_as!(
        TemplateRow,
        "select id, key, channel, language, body, category, provider_template_ref, status,
                submitted_at, reviewed_at, sender_header, dlt_template_id, updated_at
         from aarogyam.message_templates order by key, channel, language"
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One of the clinic's templates; `None` when it isn't the clinic's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<TemplateRow>, DbError> {
    let row = sqlx::query_as!(
        TemplateRow,
        "select id, key, channel, language, body, category, provider_template_ref, status,
                submitted_at, reviewed_at, sender_header, dlt_template_id, updated_at
         from aarogyam.message_templates where id = $1",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The status of the clinic's template for a key and channel in English (India), if any.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn status_of(
    conn: &mut PgConnection,
    key: &str,
    channel: &str,
) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!(
        "select status from aarogyam.message_templates where key = $1 and channel = $2
         order by (status = 'approved') desc, (language = 'en-IN') desc limit 1",
        key,
        channel
    )
    .fetch_optional(conn)
    .await?;
    Ok(status)
}

/// A template's fields as they are to be stored.
#[derive(Debug, Clone)]
pub struct TemplateFields<'a> {
    /// Its key.
    pub key: &'a str,
    /// Its channel.
    pub channel: &'a str,
    /// Its language.
    pub language: &'a str,
    /// Its text.
    pub body: &'a str,
    /// Its category.
    pub category: &'a str,
    /// Its name at Meta.
    pub provider_template_ref: Option<&'a str>,
    /// Its status.
    pub status: &'a str,
    /// SMS sender header.
    pub sender_header: Option<&'a str>,
    /// SMS DLT template id.
    pub dlt_template_id: Option<&'a str>,
}

/// Adds a template; `None` when the clinic has one for that key, channel and language.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn create(
    conn: &mut PgConnection,
    fields: &TemplateFields<'_>,
) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        "insert into aarogyam.message_templates (key, channel, language, body, category,
                provider_template_ref, status, sender_header, dlt_template_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (org_id, key, channel, language) do nothing
         returning id",
        fields.key,
        fields.channel,
        fields.language,
        fields.body,
        fields.category,
        fields.provider_template_ref,
        fields.status,
        fields.sender_header,
        fields.dlt_template_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// Stores a template's changed text, name at Meta, category, status and SMS fields.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    fields: &TemplateFields<'_>,
    submitted: bool,
) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.message_templates
            set body = $2, category = $3, provider_template_ref = $4, status = $5,
                sender_header = $6, dlt_template_id = $7,
                submitted_at = case when $8 then now() else submitted_at end,
                reviewed_at = case when $5 in ('approved', 'rejected', 'paused') and $8
                                   then now() else reviewed_at end
          where id = $1",
        id,
        fields.body,
        fields.category,
        fields.provider_template_ref,
        fields.status,
        fields.sender_header,
        fields.dlt_template_id,
        submitted
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// What Meta last decided about this name, language and text for any clinic on the shared
/// number (`app.whatsapp_template_known_status`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn known_status(
    conn: &mut PgConnection,
    name: &str,
    language: &str,
    body: &str,
) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!(
        "select app.whatsapp_template_known_status($1, $2, $3)",
        name,
        language,
        body
    )
    .fetch_one(conn)
    .await?;
    Ok(status)
}
