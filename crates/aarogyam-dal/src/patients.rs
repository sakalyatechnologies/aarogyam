//! Patient queries. Every function takes the connection of an open clinic transaction, so
//! row-level security limits it to that clinic; none adds its own `org_id` filter. Names are
//! schema-qualified because the API role has an empty `search_path`.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A patient as stored.
#[derive(Debug, Clone)]
pub struct PatientRow {
    /// Identifier.
    pub id: Uuid,
    /// Readable number, such as `SD-1042`.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Date of birth, exact or estimated.
    pub date_of_birth: Option<Date>,
    /// Whether the date of birth was estimated from an age.
    pub birth_date_estimated: bool,
    /// Contact phone in `E.164`.
    pub phone_e164: Option<String>,
    /// Contact email.
    pub email: Option<String>,
    /// Language tag such as `en-IN`.
    pub preferred_language: String,
    /// `active`, `inactive`, `deceased` or `merged`.
    pub status: String,
    /// When the record was created.
    pub created_at: OffsetDateTime,
    /// The last visit, once visits exist.
    pub last_visit_at: Option<OffsetDateTime>,
}

/// Values for a new patient row. The caller has validated them in the domain layer.
#[derive(Debug, Clone)]
pub struct NewPatientRow<'a> {
    /// Identifier chosen by the API (a version 7 UUID).
    pub id: Uuid,
    /// The number issued by [`next_number`].
    pub number: &'a str,
    /// Normalised full name.
    pub full_name: &'a str,
    /// Sex value.
    pub sex: &'a str,
    /// Date of birth.
    pub date_of_birth: Option<Date>,
    /// Whether it was estimated from an age.
    pub birth_date_estimated: bool,
    /// Phone in `E.164`.
    pub phone_e164: Option<&'a str>,
    /// Lower-cased email.
    pub email: Option<&'a str>,
    /// Language tag.
    pub preferred_language: &'a str,
}

/// Issues the next number of `kind` for the current clinic (`app.next_number`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn next_number(conn: &mut PgConnection, kind: &str) -> Result<i64, DbError> {
    let value = sqlx::query_scalar!(r#"select app.next_number($1) as "value!""#, kind)
        .fetch_one(conn)
        .await?;
    Ok(value)
}

/// Inserts a patient into the current clinic and returns the stored row.
///
/// # Errors
/// [`DbError`] on a database failure, including a duplicate number (a conflict).
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewPatientRow<'_>,
) -> Result<PatientRow, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"insert into aarogyam.patients
             (id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email, preferred_language)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                     preferred_language, status, created_at, last_visit_at"#,
        new.id,
        new.number,
        new.full_name,
        new.sex,
        new.date_of_birth,
        new.birth_date_estimated,
        new.phone_e164,
        new.email,
        new.preferred_language
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The patient with `id` in the current clinic, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The patient with `id` in the current clinic, unless deleted, locked until the transaction
/// ends so a concurrent edit can't overwrite this one's changes.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where id = $1 and deleted_at is null
           for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A patient's editable details, all of them, as they should be stored. The caller has
/// validated them in the domain layer.
#[derive(Debug, Clone)]
pub struct PatientDetails<'a> {
    /// Normalised full name.
    pub full_name: &'a str,
    /// Sex value.
    pub sex: &'a str,
    /// Date of birth.
    pub date_of_birth: Option<Date>,
    /// Whether it was estimated from an age.
    pub birth_date_estimated: bool,
    /// Phone in `E.164`.
    pub phone_e164: Option<&'a str>,
    /// Lower-cased email.
    pub email: Option<&'a str>,
    /// Language tag.
    pub preferred_language: &'a str,
}

/// Saves a patient's details and returns the stored row. The change history records what
/// changed through the table's audit trigger.
///
/// # Errors
/// [`DbError`] on a database failure; [`sakalya_db::DbErrorKind::NotFound`] when the patient
/// is not in this clinic.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    details: &PatientDetails<'_>,
) -> Result<PatientRow, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"update aarogyam.patients
           set full_name = $2, sex = $3, date_of_birth = $4, birth_date_estimated = $5,
               phone_e164 = $6, email = $7, preferred_language = $8
           where id = $1 and deleted_at is null
           returning id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                     preferred_language, status, created_at, last_visit_at"#,
        id,
        details.full_name,
        details.sex,
        details.date_of_birth,
        details.birth_date_estimated,
        details.phone_e164,
        details.email,
        details.preferred_language
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// One row of the access record: someone opened a patient's record.
#[derive(Debug, Clone)]
pub struct AccessEntry<'a> {
    /// Who opened it.
    pub actor_user_id: Uuid,
    /// `staff`, `patient` or `support`.
    pub actor_kind: &'a str,
    /// Whose record.
    pub patient_id: Uuid,
    /// What part: `chart`, `note`, `attachment`, `prescription`, `invoice` or `export`.
    pub resource: &'a str,
    /// `view`, `download`, `print`, `share` or `export`.
    pub action: &'a str,
    /// Why: `care`, `front_desk`, `billing`, `support`, `patient_self` or `export`.
    pub purpose: &'a str,
    /// The request, for tracing.
    pub request_id: Option<&'a str>,
}

/// Appends to the access record in the current clinic transaction.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_access(
    conn: &mut PgConnection,
    entry: &AccessEntry<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into audit.access_log (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
           values ($1, $2, $3, $4, $5, $6, $7)"#,
        entry.actor_user_id,
        entry.actor_kind,
        entry.patient_id,
        entry.resource,
        entry.action,
        entry.purpose,
        entry.request_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Which registered patients the list shows.
#[derive(Debug, Clone, Copy, Default)]
pub struct ListFilter {
    /// Only patients with something left to pay.
    pub with_balance: bool,
    /// Only patients with an open recall due.
    pub recalls_due: bool,
    /// Only patients registered at or after this instant.
    pub created_since: Option<OffsetDateTime>,
}

/// What the list and the record header show about a patient beyond the registration: the
/// next booking, money and recalls (`app.patient_summary`).
#[derive(Debug, Clone)]
pub struct SummaryRow {
    /// When the next booked or confirmed appointment starts.
    pub next_starts_at: Option<OffsetDateTime>,
    /// The practitioner of that appointment.
    pub next_practitioner: Option<String>,
    /// Issued, non-void bills minus what received payments allocated to them.
    pub balance_paise: i64,
    /// Everything received (non-void payments), including unallocated advances.
    pub lifetime_paid_paise: i64,
    /// Whether an open recall is due on or before the clinic's today.
    pub recall_due: bool,
}

/// A patient with their summary, read in the same statement.
#[derive(Debug, Clone)]
pub struct ListedPatient {
    /// Identifier.
    pub id: Uuid,
    /// Clinic number.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// Sex as stored.
    pub sex: String,
    /// Date of birth, exact or estimated.
    pub date_of_birth: Option<Date>,
    /// Whether the date of birth was estimated from an age.
    pub birth_date_estimated: bool,
    /// Phone, E.164.
    pub phone_e164: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Preferred language tag.
    pub preferred_language: String,
    /// Status as stored.
    pub status: String,
    /// When registered.
    pub created_at: OffsetDateTime,
    /// When last seen.
    pub last_visit_at: Option<OffsetDateTime>,
    /// See [`SummaryRow::next_starts_at`].
    pub next_starts_at: Option<OffsetDateTime>,
    /// See [`SummaryRow::next_practitioner`].
    pub next_practitioner: Option<String>,
    /// See [`SummaryRow::balance_paise`].
    pub balance_paise: i64,
    /// See [`SummaryRow::lifetime_paid_paise`].
    pub lifetime_paid_paise: i64,
    /// See [`SummaryRow::recall_due`].
    pub recall_due: bool,
}

impl ListedPatient {
    /// The patient and their summary.
    #[must_use]
    pub fn into_parts(self) -> (PatientRow, SummaryRow) {
        (
            PatientRow {
                id: self.id,
                number: self.number,
                full_name: self.full_name,
                sex: self.sex,
                date_of_birth: self.date_of_birth,
                birth_date_estimated: self.birth_date_estimated,
                phone_e164: self.phone_e164,
                email: self.email,
                preferred_language: self.preferred_language,
                status: self.status,
                created_at: self.created_at,
                last_visit_at: self.last_visit_at,
            },
            SummaryRow {
                next_starts_at: self.next_starts_at,
                next_practitioner: self.next_practitioner,
                balance_paise: self.balance_paise,
                lifetime_paid_paise: self.lifetime_paid_paise,
                recall_due: self.recall_due,
            },
        )
    }
}

/// The instant and clinic day summaries are computed for: upcoming appointments start at or
/// after `now`, and recalls are due on or before `today`.
#[derive(Debug, Clone, Copy)]
pub struct SummaryAt {
    /// Now.
    pub now: OffsetDateTime,
    /// The clinic's today.
    pub today: Date,
}

/// The most recently registered patients, with summaries.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn recent(
    conn: &mut PgConnection,
    limit: i64,
    at: SummaryAt,
) -> Result<Vec<ListedPatient>, DbError> {
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!"
           from (select * from aarogyam.patients
                 where deleted_at is null
                 order by created_at desc
                 limit $1) p
           cross join lateral app.patient_summary(p.id, $2, $3) s
           order by p.created_at desc"#,
        limit,
        at.now,
        at.today
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The most recently registered patients that pass `filter`, with summaries.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn recent_filtered(
    conn: &mut PgConnection,
    filter: &ListFilter,
    limit: i64,
    at: SummaryAt,
) -> Result<Vec<ListedPatient>, DbError> {
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!"
           from (select p.* from aarogyam.patients p
                 where p.deleted_at is null
                   and ($4::timestamptz is null or p.created_at >= $4)
                   and (not $2 or exists (select 1 from aarogyam.recalls r
                                          where r.patient_id = p.id and r.status in ('due', 'notified')
                                            and r.due_on <= $3))
                   and (not $1 or (select coalesce(sum(i.total_paise
                                          - coalesce((select sum(a.amount_paise)
                                                      from aarogyam.payment_allocations a
                                                      join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
                                                      where a.invoice_id = i.id and a.org_id = i.org_id
                                                        and m.status = 'received'), 0)), 0)
                                   from aarogyam.invoices i
                                   where i.patient_id = p.id and i.status = 'issued') > 0)
                 order by p.created_at desc
                 limit $5) p
           cross join lateral app.patient_summary(p.id, $6, $3) s
           order by p.created_at desc"#,
        filter.with_balance,
        filter.recalls_due,
        at.today,
        filter.created_since,
        limit,
        at.now
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The patient with this clinic number, with their summary.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn find_by_number(
    conn: &mut PgConnection,
    number: &str,
    at: SummaryAt,
) -> Result<Option<ListedPatient>, DbError> {
    let row = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!"
           from aarogyam.patients p
           cross join lateral app.patient_summary(p.id, $2, $3) s
           where p.number = $1 and p.deleted_at is null"#,
        number,
        at.now,
        at.today
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Patients with this phone number (main or alternate), by name, with summaries.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_phone(
    conn: &mut PgConnection,
    phone_e164: &str,
    limit: i64,
    at: SummaryAt,
) -> Result<Vec<ListedPatient>, DbError> {
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!"
           from (select * from aarogyam.patients
                 where (phone_e164 = $1 or alt_phone_e164 = $1) and deleted_at is null
                 order by full_name
                 limit $2) p
           cross join lateral app.patient_summary(p.id, $3, $4) s
           order by p.full_name"#,
        phone_e164,
        limit,
        at.now,
        at.today
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Patients whose name starts with `prefix` (lowercased, as stored in `search_name`), by
/// name. When `fuzzy` and fewer than three match, close spellings follow
/// (`app.search_patients`, best match first, at most `limit` more). With summaries.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_name(
    conn: &mut PgConnection,
    prefix: &str,
    limit: i64,
    fuzzy: bool,
    at: SummaryAt,
) -> Result<Vec<ListedPatient>, DbError> {
    let fuzzy_limit = i32::try_from(limit).unwrap_or(20);
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"with by_prefix as (
             select id, row_number() over (order by search_name collate "C") as position
             from aarogyam.patients
             where (search_name collate "C") ^@ $1 and deleted_at is null
             order by search_name collate "C"
             limit $2
           ), close as (
             select f.id, f.position
             from app.search_patients($1, $3) with ordinality
                  as f(id, number, full_name, sex, date_of_birth, birth_date_estimated,
                       phone_e164, last_visit_at, similarity, position)
             where $4 and (select count(*) from by_prefix) < 3
               and f.id not in (select id from by_prefix)
           ), picked as (
             select id, 0 as source, position from by_prefix
             union all
             select id, 1, position from close
           )
           select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!"
           from picked
           join aarogyam.patients p on p.id = picked.id
           cross join lateral app.patient_summary(p.id, $5, $6) s
           where p.deleted_at is null
           order by picked.source, picked.position"#,
        prefix,
        limit,
        fuzzy_limit,
        fuzzy,
        at.now,
        at.today
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Opens a patient's record: the patient with their summary, and the access record written
/// in the same statement. `None`, and nothing recorded, when there is no such patient.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn open(
    conn: &mut PgConnection,
    id: Uuid,
    access: &AccessEntry<'_>,
    at: SummaryAt,
) -> Result<Option<ListedPatient>, DbError> {
    let row = sqlx::query_as!(
        ListedPatient,
        r#"with found as (
             select * from aarogyam.patients where id = $1 and deleted_at is null
           ), recorded as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
             select $2, $3, found.id, $4, $5, $6, $7 from found
           )
           select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!"
           from found p
           cross join lateral app.patient_summary(p.id, $8, $9) s"#,
        id,
        access.actor_user_id,
        access.actor_kind,
        access.resource,
        access.action,
        access.purpose,
        access.request_id,
        at.now,
        at.today
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The oldest active patient of the current clinic with this email, if any. Callers pass an
/// address that was verified; the clinic's records are never matched on an unverified one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn find_by_email(
    conn: &mut PgConnection,
    email: &str,
) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where email = $1 and status = 'active' and deleted_at is null
           order by created_at, id
           limit 1"#,
        email
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Inserts a patient who registered themselves through online booking, tagged
/// `self_registered` so the front desk can tell.
///
/// # Errors
/// [`DbError`] on a database failure, including a duplicate number (a conflict).
pub async fn insert_self_registered(
    conn: &mut PgConnection,
    new: &NewPatientRow<'_>,
) -> Result<PatientRow, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"insert into aarogyam.patients
             (id, number, full_name, sex, phone_e164, email, preferred_language, tags)
           values ($1, $2, $3, $4, $5, $6, $7, array['self_registered'])
           returning id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                     preferred_language, status, created_at, last_visit_at"#,
        new.id,
        new.number,
        new.full_name,
        new.sex,
        new.phone_e164,
        new.email,
        new.preferred_language
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}
