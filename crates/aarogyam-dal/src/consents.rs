//! Notice and consent records: a patient's consents, recording one and withdrawing it.

use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

use sakalya_db::DbError;

/// A consent as stored, with the names of the staff who recorded and withdrew it.
#[derive(Debug, Clone)]
pub struct ConsentRow {
    /// Identifier.
    pub id: Uuid,
    /// What the patient agreed to.
    pub purpose: String,
    /// The notice version they were shown.
    pub notice_version: String,
    /// When they agreed.
    pub given_at: OffsetDateTime,
    /// `paper`, `verbal` or `app`.
    pub method: String,
    /// The staff member who recorded it.
    pub recorded_by: Uuid,
    /// Their name.
    pub recorded_by_name: Option<String>,
    /// `given` or `withdrawn`.
    pub status: String,
    /// When it was withdrawn.
    pub withdrawn_at: Option<OffsetDateTime>,
    /// Who recorded the withdrawal.
    pub withdrawn_by_name: Option<String>,
    /// How it was withdrawn.
    pub withdrawn_method: Option<String>,
    /// A short remark.
    pub note: Option<String>,
    /// A short remark about the withdrawal.
    pub withdrawal_note: Option<String>,
}

/// The patient's consents, newest first; `None` when the patient isn't in this clinic or is out
/// of `member`'s reach (`None` member: every patient).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    patient_id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<Vec<ConsentRow>>, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.patients
                          where id = $1 and deleted_at is null and app.patient_in_reach(id, $2)) as "found!""#,
        patient_id,
        member
    )
    .fetch_one(&mut *conn)
    .await?;
    if !found {
        return Ok(None);
    }
    let rows = sqlx::query_as!(
        ConsentRow,
        r#"select c.id, c.purpose, c.notice_version, c.given_at, c.method, c.recorded_by,
                  (select u.display_name from aarogyam.memberships m
                   join aarogyam.users u on u.id = m.user_id
                   where m.org_id = c.org_id and m.id = c.recorded_by) as recorded_by_name,
                  c.status, c.withdrawn_at,
                  (select u.display_name from aarogyam.memberships m
                   join aarogyam.users u on u.id = m.user_id
                   where m.org_id = c.org_id and m.id = c.withdrawn_by) as withdrawn_by_name,
                  c.withdrawn_method, c.note, c.withdrawal_note
           from aarogyam.patient_consents c
           where c.patient_id = $1
           order by c.given_at desc, c.id desc"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(Some(rows))
}

/// What a new consent holds.
#[derive(Debug, Clone, Copy)]
pub struct NewConsent<'a> {
    /// The patient.
    pub patient_id: Uuid,
    /// The purpose key.
    pub purpose: &'a str,
    /// The notice version shown.
    pub notice_version: &'a str,
    /// When they agreed; now when absent.
    pub given_at: Option<OffsetDateTime>,
    /// How.
    pub method: &'a str,
    /// The staff membership recording it.
    pub recorded_by: Uuid,
    /// A short remark.
    pub note: Option<&'a str>,
}

/// Records a consent; `None` when the patient already has an active one for the purpose.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewConsent<'_>,
) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        r#"insert into aarogyam.patient_consents
             (patient_id, purpose, notice_version, given_at, method, recorded_by, note)
           values ($1, $2, $3, coalesce($4, now()), $5, $6, $7)
           on conflict (org_id, patient_id, purpose) where status = 'given' do nothing
           returning id"#,
        new.patient_id,
        new.purpose,
        new.notice_version,
        new.given_at,
        new.method,
        new.recorded_by,
        new.note
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// A consent found for withdrawal.
#[derive(Debug, Clone)]
pub struct Found {
    /// The patient it belongs to.
    pub patient_id: Uuid,
    /// `given` or `withdrawn`.
    pub status: String,
}

/// The consent, locked until the transaction ends; `None` when it isn't in this clinic or its
/// patient is out of `member`'s reach.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<Found>, DbError> {
    let row = sqlx::query_as!(
        Found,
        r#"select patient_id, status from aarogyam.patient_consents
           where id = $1 and app.patient_in_reach(patient_id, $2) for update"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks the consent withdrawn.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn withdraw(
    conn: &mut PgConnection,
    id: Uuid,
    method: &str,
    by: Uuid,
    note: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.patient_consents
           set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $3, withdrawn_method = $2,
               withdrawal_note = $4
           where id = $1"#,
        id,
        method,
        by,
        note
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Records several consents of one patient given now, one per purpose, in one statement.
/// Purposes that already have an active consent are left as they are. Returns the purposes
/// recorded.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_many(
    conn: &mut PgConnection,
    patient_id: Uuid,
    purposes: &[String],
    methods: &[String],
    notice_version: &str,
    recorded_by: Uuid,
) -> Result<Vec<String>, DbError> {
    let rows = sqlx::query_scalar!(
        r#"insert into aarogyam.patient_consents
             (patient_id, purpose, notice_version, given_at, method, recorded_by)
           select $1, c.purpose, $4, now(), c.method, $5
           from unnest($2::text[], $3::text[]) as c(purpose, method)
           on conflict (org_id, patient_id, purpose) where status = 'given' do nothing
           returning purpose"#,
        patient_id,
        purposes,
        methods,
        notice_version,
        recorded_by
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
