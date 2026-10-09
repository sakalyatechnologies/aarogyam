//! Possible duplicate patients: a self-registered record from online booking whose phone
//! matches an existing patient. Every function takes the connection of an open clinic
//! transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// Flags `patient_id` as a possible duplicate of every other active patient whose main or
/// second phone is `phone_e164`, in one statement. Returns how many were flagged.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn flag_by_phone(
    conn: &mut PgConnection,
    patient_id: Uuid,
    phone_e164: &str,
) -> Result<u64, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.patient_duplicates (patient_id, candidate_id, reason)
           select $1, p.id, 'phone'
           from aarogyam.patients p
           where (p.phone_e164 = $2 or p.alt_phone_e164 = $2) and p.id <> $1
             and p.status = 'active' and p.deleted_at is null
           on conflict do nothing"#,
        patient_id,
        phone_e164
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected())
}

/// An open flag with both records' briefs.
#[derive(Debug, Clone)]
pub struct DuplicateRow {
    /// The flag.
    pub id: Uuid,
    /// Why it was flagged (`phone`).
    pub reason: String,
    /// When.
    pub created_at: OffsetDateTime,
    /// The self-registered record.
    pub patient_id: Uuid,
    /// Its number.
    pub patient_number: String,
    /// Its name.
    pub patient_name: String,
    /// Its sex.
    pub patient_sex: String,
    /// Its date of birth.
    pub patient_date_of_birth: Option<Date>,
    /// The existing patient.
    pub candidate_id: Uuid,
    /// Their number.
    pub candidate_number: String,
    /// Their name.
    pub candidate_name: String,
    /// Their sex.
    pub candidate_sex: String,
    /// Their date of birth.
    pub candidate_date_of_birth: Option<Date>,
}

/// Open flags whose two records are both within `member`'s reach, newest first, at most 200.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_open(
    conn: &mut PgConnection,
    member: Option<Uuid>,
) -> Result<Vec<DuplicateRow>, DbError> {
    let rows = sqlx::query_as!(
        DuplicateRow,
        r#"select d.id, d.reason, d.created_at,
                  p.id as patient_id, p.number as patient_number, p.full_name as patient_name,
                  p.sex as patient_sex, p.date_of_birth as patient_date_of_birth,
                  c.id as candidate_id, c.number as candidate_number,
                  c.full_name as candidate_name, c.sex as candidate_sex,
                  c.date_of_birth as candidate_date_of_birth
           from aarogyam.patient_duplicates d
           join aarogyam.patients p on p.org_id = d.org_id and p.id = d.patient_id
           join aarogyam.patients c on c.org_id = d.org_id and c.id = d.candidate_id
           where d.status = 'open' and p.deleted_at is null and c.deleted_at is null
             and app.patient_in_reach(p.id, $1) and app.patient_in_reach(c.id, $1)
           order by d.created_at desc, d.id desc
           limit 200"#,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Marks an open flag dismissed by `by`; `false` when there is no such open flag in reach.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn dismiss(
    conn: &mut PgConnection,
    id: Uuid,
    by: Uuid,
    member: Option<Uuid>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.patient_duplicates
           set status = 'dismissed', resolved_at = now(), resolved_by = $2
           where id = $1 and status = 'open'
             and app.patient_in_reach(patient_id, $3) and app.patient_in_reach(candidate_id, $3)"#,
        id,
        by,
        member
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}
