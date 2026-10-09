//! The clinic's privacy notice versions. Every function takes the connection of an open clinic
//! transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A published notice version.
#[derive(Debug, Clone)]
pub struct NoticeRow {
    /// Identifier.
    pub id: Uuid,
    /// 1, 2, 3, ... per clinic.
    pub version: i32,
    /// The clinic's short label, such as `v2 2026-11`.
    pub label: String,
    /// The notice text.
    pub body: String,
    /// When it was published.
    pub published_at: OffsetDateTime,
    /// Who published it.
    pub published_by_name: Option<String>,
}

/// Every version, newest first; the first is the current notice.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(conn: &mut PgConnection) -> Result<Vec<NoticeRow>, DbError> {
    let rows = sqlx::query_as!(
        NoticeRow,
        r#"select n.id, n.version, n.label, n.body, n.published_at,
                  (select u.display_name from aarogyam.memberships m
                   join aarogyam.users u on u.id = m.user_id
                   where m.org_id = n.org_id and m.id = n.published_by) as published_by_name
           from aarogyam.consent_notices n
           order by n.version desc"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The current notice's id and label, if the clinic has published one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn current(conn: &mut PgConnection) -> Result<Option<(Uuid, String)>, DbError> {
    let row = sqlx::query!(
        r#"select id, label from aarogyam.consent_notices order by version desc limit 1"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.id, row.label)))
}

/// A notice's label, if it is one of this clinic's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn label(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let label = sqlx::query_scalar!(
        r#"select label from aarogyam.consent_notices where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(label)
}

/// Publishes the next version, numbered after the newest one, and returns its id. Two
/// publications at once collide on the version (a conflict) rather than share a number.
///
/// # Errors
/// [`DbError`] on a database failure, a conflict on a concurrent publication.
pub async fn publish(
    conn: &mut PgConnection,
    label: &str,
    body: &str,
    by: Uuid,
) -> Result<Uuid, DbError> {
    let id = sqlx::query_scalar!(
        r#"insert into aarogyam.consent_notices (version, label, body, published_by)
           select coalesce(max(version), 0) + 1, $1, $2, $3 from aarogyam.consent_notices
           returning id"#,
        label,
        body,
        by
    )
    .fetch_one(conn)
    .await?;
    Ok(id)
}
