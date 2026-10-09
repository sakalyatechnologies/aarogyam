//! Merging a self-registered patient record into an existing patient. Every function takes the
//! connection of an open clinic transaction; the caller checks the rules first.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// What the merge rules need about one record, read with the row locked.
#[derive(Debug, Clone)]
pub struct MergeSide {
    /// The patient.
    pub id: Uuid,
    /// `active`, `inactive`, `deceased` or `merged`.
    pub status: String,
    /// Tagged `self_registered` (registered through online booking).
    pub self_registered: bool,
    /// Has any visit, clinical, file, note, recall or billing row.
    pub has_clinical: bool,
}

/// Locks the patient and reads what the merge rules need; `None` when the patient isn't in
/// this clinic or is out of `member`'s reach.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_side(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<MergeSide>, DbError> {
    let row = sqlx::query_as!(
        MergeSide,
        r#"select p.id, p.status, 'self_registered' = any(p.tags) as "self_registered!",
                  (p.allergies_reviewed <> 'unknown'
                   or exists (select 1 from aarogyam.encounters x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.allergies x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.conditions x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.observations x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.clinical_notes x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.procedures x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.specialty_records x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.treatment_plans x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.prescriptions x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.attachments x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.patient_notes x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.recalls x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.invoices x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.payments x where x.patient_id = p.id)
                   or exists (select 1 from aarogyam.share_links x where x.patient_id = p.id)
                  ) as "has_clinical!"
           from aarogyam.patients p
           where p.id = $1 and p.deleted_at is null and app.patient_in_reach(p.id, $2)
           for update of p"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Moves the front-desk records of `source` to `target` and marks `source` merged into it, in
/// one statement: appointments, queue tokens, patient-app links, identifiers, and active
/// consents for purposes `target` has none for (the rest stay on `source` as history). Fills
/// `target`'s email from `source` when it has none, and closes `source`'s open duplicate flags
/// as merged by `by`. Returns how many appointments moved.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn merge_into(
    conn: &mut PgConnection,
    source: Uuid,
    target: Uuid,
    by: Uuid,
) -> Result<i64, DbError> {
    let moved = sqlx::query_scalar!(
        r#"with appointments as (
             update aarogyam.appointments set patient_id = $2 where patient_id = $1 returning id
           ), tokens as (
             update aarogyam.queue_tokens set patient_id = $2 where patient_id = $1
           ), links as (
             update aarogyam.patient_links set patient_id = $2 where patient_id = $1
           ), identifiers as (
             update aarogyam.patient_identifiers set patient_id = $2 where patient_id = $1
           ), consents as (
             update aarogyam.patient_consents c set patient_id = $2
             where c.patient_id = $1 and c.status = 'given'
               and not exists (select 1 from aarogyam.patient_consents t
                               where t.patient_id = $2 and t.purpose = c.purpose
                                 and t.status = 'given')
           ), flags as (
             update aarogyam.patient_duplicates
             set status = 'merged', resolved_at = now(), resolved_by = $3
             where (patient_id = $1 or candidate_id = $1) and status = 'open'
           ), filled as (
             update aarogyam.patients t set email = s.email
             from aarogyam.patients s
             where t.id = $2 and s.id = $1 and t.email is null and s.email is not null
           ), merged as (
             update aarogyam.patients set status = 'merged', merged_into_id = $2 where id = $1
           )
           select count(*) as "moved!" from appointments"#,
        source,
        target,
        by
    )
    .fetch_one(conn)
    .await?;
    Ok(moved)
}
