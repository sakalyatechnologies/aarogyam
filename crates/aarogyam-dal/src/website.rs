//! The clinic's website settings and pictures. Every function takes the connection of an open
//! clinic transaction, so row-level security limits it to that clinic.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// The website settings as stored.
#[derive(Debug, Clone)]
pub struct SiteRow {
    /// `one` or `multi`.
    pub layout: String,
    /// The design.
    pub template: String,
    /// The colour palette.
    pub palette: String,
    /// The font pairing.
    pub fonts: String,
    /// The owner's text and choices, as stored.
    pub content: Value,
    /// Whether the site is live.
    pub published: bool,
    /// When it was last published.
    pub published_at: Option<OffsetDateTime>,
    /// The clinic's own domain, if any.
    pub custom_domain: Option<String>,
    /// `none`, `pending`, `verified` or `failed`.
    pub domain_status: String,
    /// The value of the verification TXT record.
    pub domain_token: Option<String>,
    /// When the domain was last checked.
    pub domain_checked_at: Option<OffsetDateTime>,
}

/// The current clinic's website settings; `None` until the owner first opens the editor.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection) -> Result<Option<SiteRow>, DbError> {
    let row = sqlx::query_as!(
        SiteRow,
        r#"select layout, template, palette, fonts, content, published, published_at,
                  custom_domain, domain_status, domain_token, domain_checked_at
           from aarogyam.clinic_websites where org_id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Makes sure the clinic has a settings row (with the defaults) and locks it until the
/// transaction ends, so concurrent edits apply one after the other.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(conn: &mut PgConnection) -> Result<SiteRow, DbError> {
    sqlx::query!(
        r#"insert into aarogyam.clinic_websites (org_id) values (app.tenant_id())
           on conflict (org_id) do nothing"#
    )
    .execute(&mut *conn)
    .await?;
    let row = sqlx::query_as!(
        SiteRow,
        r#"select layout, template, palette, fonts, content, published, published_at,
                  custom_domain, domain_status, domain_token, domain_checked_at
           from aarogyam.clinic_websites where org_id = app.tenant_id() for update"#
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves the settings. `published_at` is kept when the site stays published and set to now when
/// it goes live; the audit triggers record what changed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save(conn: &mut PgConnection, row: &SiteRow) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.clinic_websites
           set layout = $1, template = $2, palette = $3, fonts = $4, content = $5,
               published = $6,
               published_at = case when $6 then coalesce($7, now()) else $7 end,
               custom_domain = $8, domain_status = $9, domain_token = $10, domain_checked_at = $11
           where org_id = app.tenant_id()"#,
        row.layout,
        row.template,
        row.palette,
        row.fonts,
        row.content,
        row.published,
        row.published_at,
        row.custom_domain,
        row.domain_status,
        row.domain_token,
        row.domain_checked_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A website picture as stored.
#[derive(Debug, Clone)]
pub struct PhotoRow {
    /// Identifier.
    pub id: Uuid,
    /// `logo`, `hero`, `about`, `doctor` or `gallery`.
    pub kind: String,
    /// Media type.
    pub mime_type: String,
    /// Size in bytes.
    pub size_bytes: i64,
    /// What it shows.
    pub alt: Option<String>,
    /// Position among pictures of its kind.
    pub sort_order: i32,
}

/// The clinic's pictures, by kind, order and age.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn photos(conn: &mut PgConnection) -> Result<Vec<PhotoRow>, DbError> {
    let rows = sqlx::query_as!(
        PhotoRow,
        r#"select id, kind, mime_type, size_bytes, alt, sort_order
           from aarogyam.website_photos order by kind, sort_order, created_at, id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One picture.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn photo(conn: &mut PgConnection, id: Uuid) -> Result<Option<PhotoRow>, DbError> {
    let row = sqlx::query_as!(
        PhotoRow,
        r#"select id, kind, mime_type, size_bytes, alt, sort_order
           from aarogyam.website_photos where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// How many pictures the clinic has.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn count_photos(conn: &mut PgConnection) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(r#"select count(*) as "count!" from aarogyam.website_photos"#)
        .fetch_one(conn)
        .await?;
    Ok(count)
}

/// A picture to store.
#[derive(Debug, Clone)]
pub struct NewPhoto<'a> {
    /// Identifier, also the file's name in storage.
    pub id: Uuid,
    /// `logo`, `hero`, `about`, `doctor` or `gallery`.
    pub kind: &'a str,
    /// `<clinic>/<id>`.
    pub storage_key: &'a str,
    /// Media type.
    pub mime_type: &'a str,
    /// Size in bytes.
    pub size_bytes: i64,
    /// SHA-256, hex.
    pub sha256: &'a str,
    /// What it shows.
    pub alt: Option<&'a str>,
}

/// Records a picture, placing it after the others of its kind.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_photo(conn: &mut PgConnection, new: &NewPhoto<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.website_photos (id, kind, storage_key, mime_type, size_bytes, sha256, alt, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7,
                   (select coalesce(max(sort_order) + 1, 0) from aarogyam.website_photos where kind = $2))"#,
        new.id,
        new.kind,
        new.storage_key,
        new.mime_type,
        new.size_bytes,
        new.sha256,
        new.alt
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Changes a picture's description.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_alt(
    conn: &mut PgConnection,
    id: Uuid,
    alt: Option<&str>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.website_photos set alt = $2 where id = $1"#,
        id,
        alt
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Deletes a picture's record; the caller removes the file.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_photo(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(r#"delete from aarogyam.website_photos where id = $1"#, id)
        .execute(conn)
        .await?;
    Ok(done.rows_affected() == 1)
}

/// Deletes every picture of a kind, returning their ids so the caller can remove the files.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_kind(conn: &mut PgConnection, kind: &str) -> Result<Vec<Uuid>, DbError> {
    let ids = sqlx::query_scalar!(
        r#"delete from aarogyam.website_photos where kind = $1 returning id"#,
        kind
    )
    .fetch_all(conn)
    .await?;
    Ok(ids)
}

/// Where the clinic's free website address stands at the edge.
#[derive(Debug, Clone)]
pub struct SiteHostRow {
    /// The host name.
    pub hostname: String,
    /// `pending`, `ready`, `failed` or `removing`.
    pub edge_status: String,
    /// A short reason when the last attempt failed.
    pub edge_error: Option<String>,
}

/// The current clinic's free site address, if it has been published.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn site_host(conn: &mut PgConnection) -> Result<Option<SiteHostRow>, DbError> {
    let row = sqlx::query_as!(
        SiteHostRow,
        r#"select hostname, edge_status as "edge_status!", edge_error
           from aarogyam.org_domains where kind = 'site' and is_primary"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Queues the clinic's free site address, or keeps it when it is already served.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn publish_site_host(conn: &mut PgConnection, hostname: &str) -> Result<(), DbError> {
    sqlx::query!(r#"select app.site_host_publish($1)"#, hostname)
        .execute(conn)
        .await?;
    Ok(())
}

/// Stops the clinic's free site address resolving and queues its Worker for removal.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn take_down_site_host(conn: &mut PgConnection) -> Result<(), DbError> {
    sqlx::query!(r#"select app.site_host_take_down()"#)
        .execute(conn)
        .await?;
    Ok(())
}
