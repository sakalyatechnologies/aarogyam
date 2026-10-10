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
    /// Goes up when the details change; edits send it back to detect a stale copy.
    pub row_version: i64,
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
                     preferred_language, status, created_at, last_visit_at, row_version"#,
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

/// The patient with `id` in the current clinic, unless deleted or out of `member`'s reach
/// (`app.patient_in_reach`; `None` reaches every patient).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at, row_version
           from aarogyam.patients
           where id = $1 and deleted_at is null and app.patient_in_reach(id, $2)"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The patient with `id` in the current clinic, unless deleted, locked until the transaction
/// ends so a concurrent edit can't overwrite this one's changes. `member` as in [`get`].
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at, row_version
           from aarogyam.patients
           where id = $1 and deleted_at is null and app.patient_in_reach(id, $2)
           for update"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A patient with the flags the list shows, for responses that carry the patient but no
/// summary.
#[derive(Debug, Clone)]
pub struct FlaggedPatient {
    /// The patient.
    pub patient: PatientRow,
    /// The flags.
    pub flags: Flags,
}

/// [`get`], with the patient's flags read in the same statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_flagged(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<FlaggedPatient>, DbError> {
    let row = sqlx::query!(
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated, p.phone_e164,
                  p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from aarogyam.patients p
           cross join lateral app.patient_flags(p.id) f
           where p.id = $1 and p.deleted_at is null and app.patient_in_reach(p.id, $2)"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| FlaggedPatient {
        patient: PatientRow {
            id: row.id,
            number: row.number,
            full_name: row.full_name,
            sex: row.sex,
            date_of_birth: row.date_of_birth,
            birth_date_estimated: row.birth_date_estimated,
            phone_e164: row.phone_e164,
            email: row.email,
            preferred_language: row.preferred_language,
            status: row.status,
            created_at: row.created_at,
            last_visit_at: row.last_visit_at,
            row_version: row.row_version,
        },
        flags: Flags {
            allergy_alert: row.allergy_alert,
            consent_pending: row.consent_pending,
            has_photo: row.has_photo,
        },
    }))
}

/// [`get_for_update`], with the patient's flags read in the same statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update_flagged(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<FlaggedPatient>, DbError> {
    let row = sqlx::query!(
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated, p.phone_e164,
                  p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from aarogyam.patients p
           cross join lateral app.patient_flags(p.id) f
           where p.id = $1 and p.deleted_at is null and app.patient_in_reach(p.id, $2)
           for update of p"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| FlaggedPatient {
        patient: PatientRow {
            id: row.id,
            number: row.number,
            full_name: row.full_name,
            sex: row.sex,
            date_of_birth: row.date_of_birth,
            birth_date_estimated: row.birth_date_estimated,
            phone_e164: row.phone_e164,
            email: row.email,
            preferred_language: row.preferred_language,
            status: row.status,
            created_at: row.created_at,
            last_visit_at: row.last_visit_at,
            row_version: row.row_version,
        },
        flags: Flags {
            allergy_alert: row.allergy_alert,
            consent_pending: row.consent_pending,
            has_photo: row.has_photo,
        },
    }))
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
                     preferred_language, status, created_at, last_visit_at, row_version"#,
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
    /// The flags read beside the summary.
    pub flags: Flags,
}

/// What the list shows beside a name (`app.patient_flags`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags {
    /// An allergy is active, whoever recorded it.
    pub allergy_alert: bool,
    /// No active consent to care is on record.
    pub consent_pending: bool,
    /// The patient has a photo.
    pub has_photo: bool,
}

/// A patient with their summary, read in the same statement.
#[derive(Debug, Clone)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "the patient's status flags, each read straight from one statement"
)]
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
    /// See [`PatientRow::row_version`].
    pub row_version: i64,
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
    /// See [`Flags::allergy_alert`].
    pub allergy_alert: bool,
    /// See [`Flags::consent_pending`].
    pub consent_pending: bool,
    /// See [`Flags::has_photo`].
    pub has_photo: bool,
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
                row_version: self.row_version,
            },
            SummaryRow {
                next_starts_at: self.next_starts_at,
                next_practitioner: self.next_practitioner,
                balance_paise: self.balance_paise,
                lifetime_paid_paise: self.lifetime_paid_paise,
                recall_due: self.recall_due,
                flags: Flags {
                    allergy_alert: self.allergy_alert,
                    consent_pending: self.consent_pending,
                    has_photo: self.has_photo,
                },
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
    member: Option<Uuid>,
) -> Result<Vec<ListedPatient>, DbError> {
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!",
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from (select * from aarogyam.patients
                 where deleted_at is null and app.patient_in_reach(id, $4)
                 order by created_at desc
                 limit $1) p
           cross join lateral app.patient_summary(p.id, $2, $3) s
           cross join lateral app.patient_flags(p.id) f
           order by p.created_at desc"#,
        limit,
        at.now,
        at.today,
        member
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
    member: Option<Uuid>,
) -> Result<Vec<ListedPatient>, DbError> {
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!",
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from (select p.* from aarogyam.patients p
                 where p.deleted_at is null and app.patient_in_reach(p.id, $7)
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
           cross join lateral app.patient_flags(p.id) f
           order by p.created_at desc"#,
        filter.with_balance,
        filter.recalls_due,
        at.today,
        filter.created_since,
        limit,
        at.now,
        member
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
    member: Option<Uuid>,
) -> Result<Option<ListedPatient>, DbError> {
    let row = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!",
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from aarogyam.patients p
           cross join lateral app.patient_summary(p.id, $2, $3) s
           cross join lateral app.patient_flags(p.id) f
           where p.number = $1 and p.deleted_at is null and app.patient_in_reach(p.id, $4)"#,
        number,
        at.now,
        at.today,
        member
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
    member: Option<Uuid>,
) -> Result<Vec<ListedPatient>, DbError> {
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!",
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from (select * from aarogyam.patients
                 where (phone_e164 = $1 or alt_phone_e164 = $1) and deleted_at is null
                   and app.patient_in_reach(id, $5)
                 order by full_name
                 limit $2) p
           cross join lateral app.patient_summary(p.id, $3, $4) s
           cross join lateral app.patient_flags(p.id) f
           order by p.full_name"#,
        phone_e164,
        limit,
        at.now,
        at.today,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Patients whose phone (main or alternate) ends with `tail` (digits only), by name, with
/// summaries. A clinic's patients are few enough that this filters them without an index.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_phone_tail(
    conn: &mut PgConnection,
    tail: &str,
    limit: i64,
    at: SummaryAt,
    member: Option<Uuid>,
) -> Result<Vec<ListedPatient>, DbError> {
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!",
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from (select * from aarogyam.patients
                 where (right(phone_e164, char_length($1)) = $1 or right(alt_phone_e164, char_length($1)) = $1)
                   and deleted_at is null and app.patient_in_reach(id, $5)
                 order by full_name
                 limit $2) p
           cross join lateral app.patient_summary(p.id, $3, $4) s
           cross join lateral app.patient_flags(p.id) f
           order by p.full_name"#,
        tail,
        limit,
        at.now,
        at.today,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Patients matching `prefix` (lowercased, as stored in `search_name`), best kind of match
/// first, then by name, at most `limit`:
/// 1. the whole name starts with it (`sneha p` finds Sneha Patil);
/// 2. every typed word starts a word of the name, in any order (`pat`, `pat sne`);
/// 3. when `loose`, the name contains it anywhere (`atil`);
/// 4. when `loose` and fewer than three matched, close spellings (`app.search_patients`, best
///    match first). With summaries.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_name(
    conn: &mut PgConnection,
    prefix: &str,
    limit: i64,
    loose: bool,
    at: SummaryAt,
    member: Option<Uuid>,
) -> Result<Vec<ListedPatient>, DbError> {
    let fuzzy_limit = i32::try_from(limit).unwrap_or(20);
    let rows = sqlx::query_as!(
        ListedPatient,
        r#"with by_prefix as (
             select id, row_number() over (order by search_name collate "C") as position
             from aarogyam.patients
             where (search_name collate "C") ^@ $1 and deleted_at is null
               and app.patient_in_reach(id, $7)
             order by search_name collate "C"
             limit $2
           ), by_part as (
             -- Word prefixes (every typed word starts a word of the name), then substrings.
             select id, case when words then 1 else 2 end as source,
                    row_number() over (order by not words, search_name collate "C") as position
             from (select id, search_name,
                          not exists (select 1 from unnest(string_to_array($1, ' ')) t
                                      where strpos(' ' || search_name, ' ' || t) = 0) as words
                   from aarogyam.patients
                   where deleted_at is null and strpos(search_name, split_part($1, ' ', 1)) > 0
                     and app.patient_in_reach(id, $7)) n
             where (words or ($4 and strpos(search_name, $1) > 0))
               and id not in (select id from by_prefix)
             order by position
             limit $2
           ), close as (
             select f.id, f.position
             from app.search_patients($1, $3) with ordinality
                  as f(id, number, full_name, sex, date_of_birth, birth_date_estimated,
                       phone_e164, last_visit_at, similarity, position)
             where $4 and (select count(*) from by_prefix) + (select count(*) from by_part) < 3
               and f.id not in (select id from by_prefix)
               and f.id not in (select id from by_part)
               and app.patient_in_reach(f.id, $7)
           ), picked as (
             select id, 0 as source, position from by_prefix
             union all
             select id, source, position from by_part
             union all
             select id, 3, position from close
           )
           select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!",
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from picked
           join aarogyam.patients p on p.id = picked.id
           cross join lateral app.patient_summary(p.id, $5, $6) s
           cross join lateral app.patient_flags(p.id) f
           where p.deleted_at is null
           order by picked.source, picked.position
           limit $2"#,
        prefix,
        limit,
        fuzzy_limit,
        loose,
        at.now,
        at.today,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The directory's headline numbers: how many patients, how many are new this month, how many
/// have a recall due and, when asked for, how many owe money.
#[derive(Debug, Clone, Copy)]
pub struct DirectoryCounts {
    /// Patients on the list.
    pub total: i64,
    /// Registered at or after the month's start.
    pub new_this_month: i64,
    /// With an open recall due on or before today.
    pub recalls_due: i64,
    /// With a balance on issued bills; zero unless `with_balance` was asked for.
    pub with_balance: i64,
}

/// Counts the patients the caller reaches, in one statement. The balance count is worked out
/// only when `with_balance` is true (the caller has `billing.read`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn directory_counts(
    conn: &mut PgConnection,
    month_start: OffsetDateTime,
    today: Date,
    with_balance: bool,
    member: Option<Uuid>,
) -> Result<DirectoryCounts, DbError> {
    let row = sqlx::query!(
        r#"select count(*) as "total!",
                  count(*) filter (where p.created_at >= $1) as "new_this_month!",
                  count(*) filter (where exists (select 1 from aarogyam.recalls r
                                                 where r.patient_id = p.id and r.status in ('due', 'notified')
                                                   and r.due_on <= $2)) as "recalls_due!",
                  count(*) filter (where case when $3 then
                                     (select coalesce(sum(i.total_paise
                                            - coalesce((select sum(a.amount_paise)
                                                        from aarogyam.payment_allocations a
                                                        join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
                                                        where a.invoice_id = i.id and a.org_id = i.org_id
                                                          and m.status = 'received'), 0)), 0)
                                      from aarogyam.invoices i
                                      where i.patient_id = p.id and i.status = 'issued') > 0
                                   else false end) as "with_balance!"
           from aarogyam.patients p
           where p.deleted_at is null and app.patient_in_reach(p.id, $4)"#,
        month_start,
        today,
        with_balance,
        member
    )
    .fetch_one(conn)
    .await?;
    Ok(DirectoryCounts {
        total: row.total,
        new_this_month: row.new_this_month,
        recalls_due: row.recalls_due,
        with_balance: row.with_balance,
    })
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
    member: Option<Uuid>,
) -> Result<Option<ListedPatient>, DbError> {
    let row = sqlx::query_as!(
        ListedPatient,
        r#"with found as (
             select * from aarogyam.patients
             where id = $1 and deleted_at is null and app.patient_in_reach(id, $10)
           ), recorded as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
             select $2, $3, found.id, $4, $5, $6, $7 from found
           )
           select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at, p.row_version,
                  s.next_starts_at, s.next_practitioner, s.balance_paise as "balance_paise!",
                  s.lifetime_paid_paise as "lifetime_paid_paise!", s.recall_due as "recall_due!",
                  f.allergy_alert as "allergy_alert!", f.consent_pending as "consent_pending!",
                  f.has_photo as "has_photo!"
           from found p
           cross join lateral app.patient_summary(p.id, $8, $9) s
           cross join lateral app.patient_flags(p.id) f"#,
        id,
        access.actor_user_id,
        access.actor_kind,
        access.resource,
        access.action,
        access.purpose,
        access.request_id,
        at.now,
        at.today,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The oldest active patient of the current clinic with this email, if any, counting a record
/// merged into an active patient as that patient. Callers pass an address that was verified;
/// the clinic's records are never matched on an unverified one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn find_by_email(
    conn: &mut PgConnection,
    email: &str,
) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  p.phone_e164, p.email, p.preferred_language, p.status, p.created_at,
                  p.last_visit_at, p.row_version
           from aarogyam.patients m
           join aarogyam.patients p on p.org_id = m.org_id and p.id = coalesce(m.merged_into_id, m.id)
           where m.email = $1 and m.status in ('active', 'merged') and m.deleted_at is null
             and p.status = 'active' and p.deleted_at is null
           order by p.created_at, p.id
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
                     preferred_language, status, created_at, last_visit_at, row_version"#,
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

/// A relative of a patient found by phone, with what they are to that patient.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct FamilyMember {
    /// Identifier.
    pub id: Uuid,
    /// Readable number.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// What this relative is to the patient: `guardian`, `child`, `spouse` or `other`.
    pub relation: String,
}

/// A patient whose phone matches, with only what the desk needs to say "this is them", and the
/// relatives linked to them (`aarogyam.patient_relations`, either way round).
#[derive(Debug, Clone)]
pub struct PhoneMatch {
    /// Identifier.
    pub id: Uuid,
    /// Readable number.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Date of birth.
    pub date_of_birth: Option<Date>,
    /// Whether it was estimated.
    pub birth_date_estimated: bool,
    /// Linked relatives within the caller's reach, by name.
    pub family: Vec<FamilyMember>,
}

/// Patients whose main or second phone is `phone_e164`, by name, within `member`'s reach, each
/// with their linked relatives, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lookup_phone(
    conn: &mut PgConnection,
    phone_e164: &str,
    limit: i64,
    member: Option<Uuid>,
) -> Result<Vec<PhoneMatch>, DbError> {
    let rows = sqlx::query!(
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
                  coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'number', q.number,
                                                                'full_name', q.full_name, 'relation', x.relation)
                                             order by q.full_name, q.id)
                            from (select r.related_patient_id as relative, r.relation
                                  from aarogyam.patient_relations r where r.patient_id = p.id
                                  union all
                                  select r.patient_id, case r.relation when 'guardian' then 'child'
                                                                       when 'child' then 'guardian'
                                                                       else r.relation end
                                  from aarogyam.patient_relations r where r.related_patient_id = p.id) x
                            join aarogyam.patients q on q.id = x.relative
                            where q.deleted_at is null and q.status <> 'merged'
                              and app.patient_in_reach(q.id, $3)), '[]'::jsonb) as "family!: serde_json::Value"
           from aarogyam.patients p
           where (p.phone_e164 = $1 or p.alt_phone_e164 = $1) and p.deleted_at is null
             and p.status <> 'merged' and app.patient_in_reach(p.id, $3)
           order by p.full_name, p.id
           limit $2"#,
        phone_e164,
        limit,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| PhoneMatch {
            id: row.id,
            number: row.number,
            full_name: row.full_name,
            sex: row.sex,
            date_of_birth: row.date_of_birth,
            birth_date_estimated: row.birth_date_estimated,
            family: serde_json::from_value(row.family).unwrap_or_default(),
        })
        .collect())
}

/// Links `related` to `patient`: `related` is `relation` to `patient`. Both must be in this
/// clinic (the composite keys refuse others). Returns whether a link was made (false when the
/// pair already had one).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn link_relative(
    conn: &mut PgConnection,
    patient: Uuid,
    related: Uuid,
    relation: &str,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.patient_relations (patient_id, related_patient_id, relation)
           values ($1, $2, $3)
           on conflict (org_id, least(patient_id, related_patient_id), greatest(patient_id, related_patient_id))
           do nothing"#,
        patient,
        related,
        relation
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}
