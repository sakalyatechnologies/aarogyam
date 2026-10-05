//! The waiting-room queue. Every function takes the connection of an open clinic transaction,
//! so row-level security limits it to that clinic.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A token with the names the queue screen shows.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TokenRow {
    /// Identifier.
    pub id: Uuid,
    /// Branch.
    pub branch_id: Uuid,
    /// The clinic day.
    #[serde(with = "crate::json::date")]
    pub day: Date,
    /// Number shown on the screen.
    pub token_number: i32,
    /// `waiting`, `in_chair`, `done` or `left`.
    pub status: String,
    /// When it was issued.
    #[serde(with = "crate::json::timestamp")]
    pub issued_at: OffsetDateTime,
    /// When the patient was called into the chair.
    #[serde(with = "crate::json::timestamp::option")]
    pub called_at: Option<OffsetDateTime>,
    /// When they were done or left.
    #[serde(with = "crate::json::timestamp::option")]
    pub done_at: Option<OffsetDateTime>,
    /// The patient.
    pub patient_id: Uuid,
    /// Their number.
    pub patient_number: String,
    /// Their name.
    pub patient_name: String,
    /// Their sex.
    pub patient_sex: String,
    /// Their date of birth.
    #[serde(with = "crate::json::date::option")]
    pub patient_date_of_birth: Option<Date>,
    /// Whether it was estimated.
    pub patient_birth_date_estimated: bool,
    /// The appointment, unless a walk-in.
    pub appointment_id: Option<Uuid>,
    /// The doctor, if known.
    pub practitioner_id: Option<Uuid>,
    /// Their name.
    pub practitioner_name: Option<String>,
}

/// Issues the next token number of a branch's day (`app.next_number`, kind `queue_token`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn next_number(
    conn: &mut PgConnection,
    series: &str,
    period: &str,
) -> Result<i64, DbError> {
    let value = sqlx::query_scalar!(
        r#"select app.next_number('queue_token', $1, $2) as "value!""#,
        series,
        period
    )
    .fetch_one(conn)
    .await?;
    Ok(value)
}

/// A token to issue.
#[derive(Debug, Clone, Copy)]
pub struct NewToken {
    /// Identifier.
    pub id: Uuid,
    /// Branch.
    pub branch_id: Uuid,
    /// The clinic day.
    pub day: Date,
    /// Number from [`next_number`].
    pub token_number: i32,
    /// The patient.
    pub patient_id: Uuid,
    /// The appointment, unless a walk-in.
    pub appointment_id: Option<Uuid>,
    /// The doctor, if known.
    pub practitioner_id: Option<Uuid>,
    /// When.
    pub issued_at: OffsetDateTime,
}

/// Issues a token.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, token: &NewToken) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.queue_tokens
             (id, branch_id, day, token_number, patient_id, appointment_id, practitioner_id, issued_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        token.id,
        token.branch_id,
        token.day,
        token.token_number,
        token.patient_id,
        token.appointment_id,
        token.practitioner_id,
        token.issued_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Tokens of one clinic day, optionally one branch, by number.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    day: Date,
    branch_id: Option<Uuid>,
) -> Result<Vec<TokenRow>, DbError> {
    let rows = sqlx::query_as!(
        TokenRow,
        r#"select q.id, q.branch_id, q.day, q.token_number, q.status, q.issued_at, q.called_at, q.done_at,
                  q.patient_id, p.number as patient_number, p.full_name as patient_name,
                  p.sex as patient_sex, p.date_of_birth as patient_date_of_birth,
                  p.birth_date_estimated as patient_birth_date_estimated,
                  q.appointment_id, q.practitioner_id, d.display_name as "practitioner_name?"
           from aarogyam.queue_tokens q
           join aarogyam.patients p on p.org_id = q.org_id and p.id = q.patient_id
           left join aarogyam.practitioners d on d.org_id = q.org_id and d.id = q.practitioner_id
           where q.day = $1 and ($2::uuid is null or q.branch_id = $2)
           order by q.branch_id, q.token_number"#,
        day,
        branch_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A token's state, for changing it.
#[derive(Debug, Clone)]
pub struct TokenState {
    /// Identifier.
    pub id: Uuid,
    /// Status.
    pub status: String,
    /// The appointment, unless a walk-in.
    pub appointment_id: Option<Uuid>,
}

/// A token, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<TokenState>, DbError> {
    let row = sqlx::query_as!(
        TokenState,
        r#"select id, status, appointment_id from aarogyam.queue_tokens where id = $1 for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The token of an appointment, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn for_appointment(
    conn: &mut PgConnection,
    appointment_id: Uuid,
) -> Result<Option<TokenState>, DbError> {
    let row = sqlx::query_as!(
        TokenState,
        r#"select id, status, appointment_id from aarogyam.queue_tokens
           where appointment_id = $1 for update"#,
        appointment_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Sets a token's status, stamping the call time when it leaves `waiting` for the chair or
/// done, and the end time when done or left.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_status(
    conn: &mut PgConnection,
    id: Uuid,
    status: &str,
    now: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.queue_tokens
           set status = $2,
               called_at = case when $2 in ('in_chair', 'done') then coalesce(called_at, $3) else called_at end,
               done_at = case when $2 in ('done', 'left') then coalesce(done_at, $3) else done_at end
           where id = $1"#,
        id,
        status,
        now
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The token's row with names, after a change.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<TokenRow>, DbError> {
    let row = sqlx::query_as!(
        TokenRow,
        r#"select q.id, q.branch_id, q.day, q.token_number, q.status, q.issued_at, q.called_at, q.done_at,
                  q.patient_id, p.number as patient_number, p.full_name as patient_name,
                  p.sex as patient_sex, p.date_of_birth as patient_date_of_birth,
                  p.birth_date_estimated as patient_birth_date_estimated,
                  q.appointment_id, q.practitioner_id, d.display_name as "practitioner_name?"
           from aarogyam.queue_tokens q
           join aarogyam.patients p on p.org_id = q.org_id and p.id = q.patient_id
           left join aarogyam.practitioners d on d.org_id = q.org_id and d.id = q.practitioner_id
           where q.id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}
