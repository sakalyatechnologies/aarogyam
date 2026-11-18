//! Erasing patient records past retention, over the schema owner's connection (`aarogyam erase`),
//! across clinics; never reachable from a request. Ids only, never names.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// One clinic's patients past retention.
#[derive(Debug, Clone)]
pub struct ClinicCandidates {
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Years it keeps patient records (its own choice, or the default).
    pub years: i32,
    /// Patients past retention and not on legal hold, oldest activity first.
    pub patients: Vec<Uuid>,
    /// Patients past retention but on legal hold, which stay.
    pub held: i64,
}

/// Patients whose last activity (visit, appointment, bill or registration) is older than their
/// clinic's retention years before `now`, who are adults by `adult_born_on` (or have no birth
/// date) and aren't erased. `clinic` narrows to one clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn candidates(
    pool: &PgPool,
    now: OffsetDateTime,
    default_years: i32,
    adult_born_on: Date,
    clinic: Option<Uuid>,
) -> Result<Vec<ClinicCandidates>, DbError> {
    let rows = sqlx::query_as!(
        ClinicCandidates,
        r#"with clinics as (
             select o.id, o.slug, coalesce(s.patient_retention_years::int, $2) as years
             from aarogyam.organizations o
             left join aarogyam.org_settings s on s.org_id = o.id
             where $4::uuid is null or o.id = $4),
           past as (
             select p.org_id, p.id, p.legal_hold,
                    greatest(p.created_at, p.last_visit_at,
                             (select max(a.starts_at) from aarogyam.appointments a
                              where a.org_id = p.org_id and a.patient_id = p.id),
                             (select max(i.issued_at) from aarogyam.invoices i
                              where i.org_id = p.org_id and i.patient_id = p.id)) as anchor,
                    c.years
             from aarogyam.patients p join clinics c on c.id = p.org_id
             where p.status <> 'erased' and (p.date_of_birth is null or p.date_of_birth <= $3))
           select c.id as "org_id!", c.slug as "slug!", c.years as "years!",
                  coalesce(array_agg(x.id order by x.anchor) filter (where not x.legal_hold), '{}')
                    as "patients!: Vec<Uuid>",
                  count(*) filter (where x.legal_hold) as "held!"
           from clinics c
           join past x on x.org_id = c.id and x.anchor < $1::timestamptz - make_interval(years => x.years)
           group by c.id, c.slug, c.years
           order by c.slug"#,
        now,
        default_years,
        adult_born_on,
        clinic
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// The clinic with this subdomain.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_by_slug(pool: &PgPool, slug: &str) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        "select id from aarogyam.organizations where slug = $1",
        slug
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

/// Erases one patient in its own transaction (`app.erase_patient`), first queuing their stored
/// files in `audit.erased_files` so the bytes can be deleted after it commits. `false` when
/// nothing was done (unknown, already erased, or on legal hold unless `replay`); nothing is
/// queued then.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn erase(
    pool: &PgPool,
    org_id: Uuid,
    patient_id: Uuid,
    run_id: Uuid,
    replay: bool,
) -> Result<bool, DbError> {
    let mut tx = pool.begin().await?;
    // Read before the erase deletes the photo and chat rows. A file queued again (a replay after
    // a restore) is deleted again: a missing object counts as deleted.
    sqlx::query!(
        r#"insert into audit.erased_files (org_id, file_id, patient_id, run_id)
           select $1, f.id, $2, $3
           from (select a.id from aarogyam.attachments a where a.org_id = $1 and a.patient_id = $2
                 union
                 select p.id from aarogyam.patient_photos p where p.org_id = $1 and p.patient_id = $2
                 union
                 select c.id from aarogyam.chat_attachments c
                 join aarogyam.chat_messages m on m.org_id = c.org_id and m.id = c.message_id
                 where c.org_id = $1 and m.patient_id = $2) f
           on conflict (org_id, file_id) do update
             set run_id = excluded.run_id, queued_at = now(), deleted_at = null"#,
        org_id,
        patient_id,
        run_id
    )
    .execute(&mut *tx)
    .await?;
    let done = sqlx::query_scalar!(
        r#"select app.erase_patient($1, $2, $3, $4) as "done!""#,
        org_id,
        patient_id,
        run_id,
        replay
    )
    .fetch_one(&mut *tx)
    .await?;
    if done {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }
    Ok(done)
}

/// A file of an erased patient whose bytes are still in storage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErasedFile {
    /// The clinic.
    pub org_id: Uuid,
    /// The file; its storage key is `<org_id>/<file_id>`.
    pub file_id: Uuid,
}

/// Erased patients' files not yet deleted from storage, oldest first, in `clinic` or all.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn pending_files(
    pool: &PgPool,
    clinic: Option<Uuid>,
) -> Result<Vec<ErasedFile>, DbError> {
    let rows = sqlx::query_as!(
        ErasedFile,
        r#"select org_id, file_id from audit.erased_files
           where deleted_at is null and ($1::uuid is null or org_id = $1)
           order by queued_at, file_id"#,
        clinic
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Marks an erased patient's file as deleted from storage.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn file_deleted(pool: &PgPool, file: ErasedFile) -> Result<(), DbError> {
    sqlx::query!(
        "update audit.erased_files set deleted_at = now() where org_id = $1 and file_id = $2",
        file.org_id,
        file.file_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Sets (or, with `None`, clears) a clinic's retention years for patient records.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_patient_years(
    pool: &PgPool,
    org_id: Uuid,
    years: Option<i16>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.org_settings set patient_retention_years = $2 where org_id = $1",
        org_id,
        years
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected() == 1)
}
