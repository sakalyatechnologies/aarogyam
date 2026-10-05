//! First-run setup progress for the clinic and for each member. Every function takes the
//! connection of an open clinic transaction, so row-level security limits it to that clinic.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A setup row as stored.
#[derive(Debug, Clone)]
pub struct SetupRow {
    /// `solo`, `team` or `multi` (the clinic's row only).
    pub practice: Option<String>,
    /// Step key to `done` or `skipped`.
    pub steps: Value,
    /// When the person closed the card.
    pub dismissed_at: Option<OffsetDateTime>,
    /// When the last step was answered.
    pub completed_at: Option<OffsetDateTime>,
}

/// The clinic's setup row, created with nothing answered on first use, and locked until the
/// transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_for_update(conn: &mut PgConnection) -> Result<SetupRow, DbError> {
    sqlx::query!(
        r#"insert into aarogyam.clinic_setup (org_id) values (app.tenant_id())
           on conflict (org_id) do nothing"#
    )
    .execute(&mut *conn)
    .await?;
    let row = sqlx::query_as!(
        SetupRow,
        r#"select practice, steps, dismissed_at, completed_at
           from aarogyam.clinic_setup where org_id = app.tenant_id() for update"#
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The clinic's setup row, if there is one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic(conn: &mut PgConnection) -> Result<Option<SetupRow>, DbError> {
    let row = sqlx::query_as!(
        SetupRow,
        r#"select practice, steps, dismissed_at, completed_at
           from aarogyam.clinic_setup where org_id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Saves the clinic's setup row.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save_clinic(conn: &mut PgConnection, row: &SetupRow) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.clinic_setup
           set practice = $1, steps = $2, dismissed_at = $3, completed_at = $4, updated_at = now()
           where org_id = app.tenant_id()"#,
        row.practice,
        row.steps,
        row.dismissed_at,
        row.completed_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A member's setup row, created with nothing answered on first use, and locked until the
/// transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn member_for_update(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<SetupRow, DbError> {
    sqlx::query!(
        r#"insert into aarogyam.member_setup (org_id, membership_id)
           values (app.tenant_id(), $1) on conflict (org_id, membership_id) do nothing"#,
        membership_id
    )
    .execute(&mut *conn)
    .await?;
    let row = sqlx::query_as!(
        SetupRow,
        r#"select null::text as "practice?", steps, dismissed_at, completed_at
           from aarogyam.member_setup
           where org_id = app.tenant_id() and membership_id = $1 for update"#,
        membership_id
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// A member's setup row, if there is one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn member(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<Option<SetupRow>, DbError> {
    let row = sqlx::query_as!(
        SetupRow,
        r#"select null::text as "practice?", steps, dismissed_at, completed_at
           from aarogyam.member_setup
           where org_id = app.tenant_id() and membership_id = $1"#,
        membership_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Saves a member's setup row.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save_member(
    conn: &mut PgConnection,
    membership_id: Uuid,
    row: &SetupRow,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.member_setup
           set steps = $2, dismissed_at = $3, completed_at = $4, updated_at = now()
           where org_id = app.tenant_id() and membership_id = $1"#,
        membership_id,
        row.steps,
        row.dismissed_at,
        row.completed_at
    )
    .execute(conn)
    .await?;
    Ok(())
}
