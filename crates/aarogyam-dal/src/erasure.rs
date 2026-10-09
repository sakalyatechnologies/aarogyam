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

/// Erases one patient in its own transaction (`app.erase_patient`). `false` when nothing was
/// done: unknown, already erased, or on legal hold (unless `replay`).
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
    let done = sqlx::query_scalar!(
        r#"select app.erase_patient($1, $2, $3, $4) as "done!""#,
        org_id,
        patient_id,
        run_id,
        replay
    )
    .fetch_one(pool)
    .await?;
    Ok(done)
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
