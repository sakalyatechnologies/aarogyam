//! The patient app's queries. Before a clinic is known (the app host) they call the definer
//! functions of migration 0261; inside a linked clinic they run in a clinic transaction whose
//! actor is the patient account, so row-level security limits every row to the linked record
//! (and the clinic's reference data). Each read writes its access record in the same statement.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

/// The signed-in patient account and its active links, from `app.patient_access`.
#[derive(Debug, Clone)]
pub struct AccessRow {
    /// The account.
    pub account_id: Uuid,
    /// `active` or `disabled`.
    pub account_status: String,
    /// The verified email.
    pub account_email: String,
    /// Whether this sign-in session was revoked.
    pub session_revoked: bool,
    /// Active links at open clinics, by clinic name.
    pub links: Vec<LinkRow>,
}

/// An active link and its clinic.
#[derive(Debug, Clone)]
pub struct LinkRow {
    /// The link.
    pub link_id: Uuid,
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub clinic_name: String,
    /// Its portal host, when it has one.
    pub portal_host: Option<String>,
    /// Its IANA time zone.
    pub timezone: String,
    /// Its patient-number prefix.
    pub number_prefix: String,
    /// Its branding (brand colour, theme mode).
    pub branding: Value,
    /// The linked record.
    pub patient_id: Uuid,
    /// The record's clinic number, such as `SD-1042`.
    pub patient_number: String,
    /// When the link was made.
    pub linked_at: OffsetDateTime,
}

/// The account for a verified sign-in (made on first use when `email` is given), whether the
/// session was revoked, and its active links. `None` when there is no account and no email.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn access(
    pool: &PgPool,
    auth_uid: Uuid,
    email: Option<&str>,
    session_id: Uuid,
) -> Result<Option<AccessRow>, DbError> {
    let rows = sqlx::query!(
        r#"select account_id as "account_id!", account_status as "account_status!",
                  account_email as "account_email!", session_revoked as "session_revoked!",
                  link_id, org_id, slug, clinic_name, portal_host, timezone, number_prefix,
                  branding, patient_id, patient_number, linked_at
           from app.patient_access($1, $2, $3)"#,
        auth_uid,
        email,
        session_id
    )
    .fetch_all(pool)
    .await?;
    let Some(first) = rows.first() else {
        return Ok(None);
    };
    let mut access = AccessRow {
        account_id: first.account_id,
        account_status: first.account_status.clone(),
        account_email: first.account_email.clone(),
        session_revoked: first.session_revoked,
        links: Vec::new(),
    };
    for row in rows {
        let (
            Some(link_id),
            Some(org_id),
            Some(slug),
            Some(clinic_name),
            Some(timezone),
            Some(number_prefix),
            Some(patient_id),
            Some(patient_number),
            Some(linked_at),
        ) = (
            row.link_id,
            row.org_id,
            row.slug,
            row.clinic_name,
            row.timezone,
            row.number_prefix,
            row.patient_id,
            row.patient_number,
            row.linked_at,
        )
        else {
            continue;
        };
        access.links.push(LinkRow {
            link_id,
            org_id,
            slug,
            clinic_name,
            portal_host: row.portal_host,
            timezone,
            number_prefix,
            branding: row
                .branding
                .unwrap_or_else(|| Value::Object(serde_json::Map::new())),
            patient_id,
            patient_number,
            linked_at,
        });
    }
    Ok(Some(access))
}

/// Redeems a link code by its hash: the clinic and the outcome, or `None` for no usable code.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn redeem_code(
    pool: &PgPool,
    account_id: Uuid,
    code_hash: &str,
) -> Result<Option<(Uuid, String)>, DbError> {
    let row = sqlx::query!(
        r#"select org_id as "org_id!", outcome as "outcome!"
           from app.redeem_patient_link_code($1, $2)"#,
        account_id,
        code_hash
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| (row.org_id, row.outcome)))
}

/// Asks the clinic with `slug` to confirm the record with this verified email. Says nothing
/// about whether one exists.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn request_link(
    pool: &PgPool,
    account_id: Uuid,
    slug: &str,
    email: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        "select app.request_patient_link($1, $2, $3)",
        account_id,
        slug,
        email
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Ends one of the account's own links. True when one was ended.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn revoke_own_link(
    pool: &PgPool,
    account_id: Uuid,
    link_id: Uuid,
) -> Result<bool, DbError> {
    let ended = sqlx::query_scalar!(
        r#"select app.revoke_patient_link($1, $2) as "ended!""#,
        account_id,
        link_id
    )
    .fetch_one(pool)
    .await?;
    Ok(ended)
}

/// Who is reading, for the access record.
#[derive(Debug, Clone, Copy)]
pub struct Reader<'a> {
    /// The linked record.
    pub patient_id: Uuid,
    /// The patient account.
    pub account_id: Uuid,
    /// The request, for tracing.
    pub request_id: Option<&'a str>,
}

/// One of the patient's appointments.
#[derive(Debug, Clone)]
pub struct AppointmentRow {
    /// Identifier.
    pub id: Uuid,
    /// Start.
    pub starts_at: OffsetDateTime,
    /// End.
    pub ends_at: OffsetDateTime,
    /// Status value.
    pub status: String,
    /// Why they are coming.
    pub reason: Option<String>,
    /// The doctor.
    pub practitioner_id: Uuid,
    /// The doctor's name.
    pub doctor_name: String,
    /// What the doctor practises.
    pub specialty: Option<String>,
}

/// The patient's appointments, newest first (at most 200), recording the read.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn appointments(
    conn: &mut PgConnection,
    reader: Reader<'_>,
) -> Result<Vec<AppointmentRow>, DbError> {
    let rows = sqlx::query_as!(
        AppointmentRow,
        r#"with logged as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
             values ($2, 'patient', $1, 'appointment', 'view', 'patient_self', $3)
           )
           select a.id, a.starts_at, a.ends_at, a.status, a.reason, a.practitioner_id,
                  p.display_name as doctor_name, p.specialty
           from aarogyam.appointments a
           join aarogyam.practitioners p on p.org_id = a.org_id and p.id = a.practitioner_id
           where a.patient_id = $1 and a.deleted_at is null
           order by a.starts_at desc
           limit 200"#,
        reader.patient_id,
        reader.account_id,
        reader.request_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One of the patient's issued prescriptions.
#[derive(Debug, Clone)]
pub struct PrescriptionRow {
    /// Identifier.
    pub id: Uuid,
    /// `RX-…`.
    pub number: String,
    /// When it was issued.
    pub issued_at: OffsetDateTime,
    /// The doctor as printed (`{"name": …}`).
    pub doctor: Value,
    /// The diagnosis as printed.
    pub diagnosis_text: Option<String>,
    /// Advice as printed.
    pub advice: Option<String>,
    /// The follow-up date.
    pub follow_up_on: Option<time::Date>,
    /// The token of the public verify page.
    pub verify_token: String,
    /// The lines, in order, as a JSON array.
    pub items: Value,
}

/// The patient's issued prescriptions, newest first (at most 100), recording the read.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn prescriptions(
    conn: &mut PgConnection,
    reader: Reader<'_>,
) -> Result<Vec<PrescriptionRow>, DbError> {
    let rows = sqlx::query_as!(
        PrescriptionRow,
        r#"with logged as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
             values ($2, 'patient', $1, 'prescription', 'view', 'patient_self', $3)
           )
           select r.id, r.number as "number!", r.issued_at as "issued_at!",
                  r.doctor as "doctor!", r.diagnosis_text, r.advice, r.follow_up_on,
                  r.verify_token as "verify_token!",
                  coalesce((select jsonb_agg(jsonb_build_object(
                              'drug_name', i.drug_name, 'strength', i.strength, 'form', i.form,
                              'dose', i.dose, 'frequency', i.frequency, 'timing', i.timing,
                              'duration_days', i.duration_days, 'instructions', i.instructions)
                            order by i.line_no)
                            from aarogyam.prescription_items i
                            where i.org_id = r.org_id and i.prescription_id = r.id), '[]'::jsonb)
                    as "items!"
           from aarogyam.prescriptions r
           where r.patient_id = $1 and r.status = 'issued'
           order by r.issued_at desc
           limit 100"#,
        reader.patient_id,
        reader.account_id,
        reader.request_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One of the patient's issued bills, with what has been paid against it.
#[derive(Debug, Clone)]
pub struct BillRow {
    /// Identifier.
    pub id: Uuid,
    /// The bill number.
    pub number: String,
    /// When it was issued.
    pub issued_at: OffsetDateTime,
    /// Total.
    pub total_paise: i64,
    /// Paid against it by receipts that weren't voided.
    pub paid_paise: i64,
    /// The lines, in order, as a JSON array.
    pub items: Value,
}

/// The patient's issued bills, newest first (at most 100), recording the read.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn bills(conn: &mut PgConnection, reader: Reader<'_>) -> Result<Vec<BillRow>, DbError> {
    let rows = sqlx::query_as!(
        BillRow,
        r#"with logged as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
             values ($2, 'patient', $1, 'invoice', 'view', 'patient_self', $3)
           )
           select b.id, b.number as "number!", b.issued_at as "issued_at!", b.total_paise,
                  coalesce((select sum(a.amount_paise)
                            from aarogyam.payment_allocations a
                            join aarogyam.payments p on p.org_id = a.org_id and p.id = a.payment_id
                            where a.org_id = b.org_id and a.invoice_id = b.id and p.status = 'received'),
                           0)::bigint as "paid_paise!",
                  coalesce((select jsonb_agg(jsonb_build_object(
                              'description', i.description, 'quantity', i.quantity,
                              'total_paise', i.total_paise) order by i.line_no)
                            from aarogyam.invoice_items i
                            where i.org_id = b.org_id and i.invoice_id = b.id), '[]'::jsonb)
                    as "items!"
           from aarogyam.invoices b
           where b.patient_id = $1 and b.status = 'issued'
           order by b.issued_at desc
           limit 100"#,
        reader.patient_id,
        reader.account_id,
        reader.request_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A file the clinic shared with the patient.
#[derive(Debug, Clone)]
pub struct FileRow {
    /// Identifier.
    pub id: Uuid,
    /// Kind value.
    pub kind: String,
    /// Media type.
    pub mime_type: String,
    /// Size.
    pub size_bytes: i64,
    /// Its label, such as `OPG`.
    pub label: Option<String>,
    /// A caption.
    pub caption: Option<String>,
    /// When it was taken.
    pub taken_at: Option<OffsetDateTime>,
    /// When it was uploaded.
    pub created_at: OffsetDateTime,
}

/// The files the clinic shared with the patient, newest first (at most 200), recording the read.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn files(conn: &mut PgConnection, reader: Reader<'_>) -> Result<Vec<FileRow>, DbError> {
    let rows = sqlx::query_as!(
        FileRow,
        r#"with logged as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
             values ($2, 'patient', $1, 'attachment', 'view', 'patient_self', $3)
           )
           select id, kind, mime_type, size_bytes, label, caption, taken_at, created_at
           from aarogyam.attachments
           where patient_id = $1 and shared_with_patient and deleted_at is null
             and kind <> 'audio'
           order by created_at desc, id desc
           limit 200"#,
        reader.patient_id,
        reader.account_id,
        reader.request_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A shared file's type, recording the download; `None` when it isn't the patient's shared file.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn shared_file(
    conn: &mut PgConnection,
    reader: Reader<'_>,
    attachment_id: Uuid,
) -> Result<Option<String>, DbError> {
    let mime = sqlx::query_scalar!(
        r#"with found as (
             select id, mime_type from aarogyam.attachments
             where id = $4 and patient_id = $1 and shared_with_patient and deleted_at is null
               and kind <> 'audio'
           ), logged as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, resource_id, action, purpose, request_id)
             select $2, 'patient', $1, 'attachment', found.id, 'download', 'patient_self', $3 from found
           )
           select mime_type from found"#,
        reader.patient_id,
        reader.account_id,
        reader.request_id,
        attachment_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(mime)
}

/// What the home screen needs from one clinic.
#[derive(Debug, Clone)]
pub struct SummaryRow {
    /// The next appointment that isn't cancelled or over, as a JSON object.
    pub next_appointment: Option<Value>,
    /// Owed on issued bills.
    pub balance_paise: i64,
    /// Issued prescriptions.
    pub prescriptions: i64,
    /// The newest issued prescription's date.
    pub last_prescription_at: Option<OffsetDateTime>,
}

/// The next appointment, the balance and the prescriptions count, recording the read.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn summary(
    conn: &mut PgConnection,
    reader: Reader<'_>,
    now: OffsetDateTime,
) -> Result<SummaryRow, DbError> {
    let row = sqlx::query_as!(
        SummaryRow,
        r#"with logged as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
             values ($2, 'patient', $1, 'appointment', 'view', 'patient_self', $3)
           )
           select
             (select jsonb_build_object(
                       'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                       'status', a.status, 'reason', a.reason,
                       'practitioner_id', a.practitioner_id,
                       'doctor_name', p.display_name, 'specialty', p.specialty)
              from aarogyam.appointments a
              join aarogyam.practitioners p on p.org_id = a.org_id and p.id = a.practitioner_id
              where a.patient_id = $1 and a.deleted_at is null and a.ends_at > $4
                and a.status in ('requested', 'booked', 'confirmed', 'arrived', 'in_chair')
              order by a.starts_at limit 1) as next_appointment,
             coalesce((select sum(b.total_paise) from aarogyam.invoices b
                       where b.patient_id = $1 and b.status = 'issued'), 0)::bigint
             - coalesce((select sum(a.amount_paise)
                         from aarogyam.payment_allocations a
                         join aarogyam.payments p on p.org_id = a.org_id and p.id = a.payment_id
                         join aarogyam.invoices b on b.org_id = a.org_id and b.id = a.invoice_id
                         where a.patient_id = $1 and p.status = 'received' and b.status = 'issued'),
                        0)::bigint as "balance_paise!",
             (select count(*) from aarogyam.prescriptions r
              where r.patient_id = $1 and r.status = 'issued') as "prescriptions!",
             (select max(r.issued_at) from aarogyam.prescriptions r
              where r.patient_id = $1 and r.status = 'issued') as last_prescription_at"#,
        reader.patient_id,
        reader.account_id,
        reader.request_id,
        now
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// One of the patient's appointments, locked for a change; `None` when it isn't theirs.
#[derive(Debug, Clone)]
pub struct OwnAppointment {
    /// Status value.
    pub status: String,
    /// Start.
    pub starts_at: OffsetDateTime,
    /// The clinic's booking settings.
    pub booking: Value,
}

/// Locks one of the linked patient's appointments, with the clinic's booking settings.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_own_appointment(
    conn: &mut PgConnection,
    patient_id: Uuid,
    appointment_id: Uuid,
) -> Result<Option<OwnAppointment>, DbError> {
    let row = sqlx::query_as!(
        OwnAppointment,
        r#"select a.status, a.starts_at,
                  coalesce((select s.booking from aarogyam.org_settings s where s.org_id = a.org_id),
                           '{}'::jsonb) as "booking!"
           from aarogyam.appointments a
           where a.id = $2 and a.patient_id = $1 and a.deleted_at is null
           for update of a"#,
        patient_id,
        appointment_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A patient record's links, for the clinic.
#[derive(Debug, Clone)]
pub struct ClinicLinkRow {
    /// The link.
    pub id: Uuid,
    /// Status value.
    pub status: String,
    /// How it was made.
    pub linked_via: String,
    /// The patient account's verified email.
    pub account_email: String,
    /// When the patient consented (redeemed the code or asked for the match).
    pub consented_at: OffsetDateTime,
    /// When it became active.
    pub linked_at: Option<OffsetDateTime>,
    /// When it was revoked.
    pub revoked_at: Option<OffsetDateTime>,
}

/// A patient record's links, open ones first, and when its unused code expires.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn links_of_patient(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<(Vec<ClinicLinkRow>, Option<OffsetDateTime>), DbError> {
    let row = sqlx::query!(
        r#"select
             coalesce((select jsonb_agg(jsonb_build_object(
                         'id', l.id, 'status', l.status, 'linked_via', l.linked_via,
                         'account_email', app.patient_account_email(l.account_id),
                         'consented_at', l.consented_at, 'linked_at', l.linked_at,
                         'revoked_at', l.revoked_at)
                       order by (l.status in ('pending', 'active')) desc, l.created_at desc)
                       from aarogyam.patient_links l where l.patient_id = $1), '[]'::jsonb)
               as "links!",
             (select max(c.expires_at) from aarogyam.patient_link_codes c
              where c.patient_id = $1 and c.used_at is null and c.replaced_at is null
                and c.expires_at > now()) as code_expires_at"#,
        patient_id
    )
    .fetch_one(conn)
    .await?;
    let links = serde_json::from_value::<Vec<LinkJson>>(row.links)
        .map_err(|error| DbError::from(sqlx::Error::Decode(Box::new(error))))?
        .into_iter()
        .map(|link| ClinicLinkRow {
            id: link.id,
            status: link.status,
            linked_via: link.linked_via,
            account_email: link.account_email.unwrap_or_default(),
            consented_at: link.consented_at,
            linked_at: link.linked_at,
            revoked_at: link.revoked_at,
        })
        .collect();
    Ok((links, row.code_expires_at))
}

#[derive(serde::Deserialize)]
struct LinkJson {
    id: Uuid,
    status: String,
    linked_via: String,
    account_email: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    consented_at: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    linked_at: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    revoked_at: Option<OffsetDateTime>,
}

/// Issues a link code for a patient (its hash), replacing their unused ones.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn issue_code(
    conn: &mut PgConnection,
    patient_id: Uuid,
    code_hash: &str,
    expires_at: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"with replaced as (
             update aarogyam.patient_link_codes set replaced_at = now()
             where patient_id = $1 and used_at is null and replaced_at is null
           )
           insert into aarogyam.patient_link_codes (patient_id, code_hash, expires_at)
           values ($1, $2, $3)"#,
        patient_id,
        code_hash,
        expires_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Moves a link from one status to another (`pending` → `active` or `declined`, `active` →
/// `revoked`), naming the member, when its patient is in `reach` (as in
/// [`crate::patients::get`]). Returns the patient's id when a link moved.
///
/// # Errors
/// [`DbError`] on a database failure, including the unique index when the record already has
/// an active link.
pub async fn decide_link(
    conn: &mut PgConnection,
    link_id: Uuid,
    from: &str,
    to: &str,
    member: Uuid,
    reach: Option<Uuid>,
) -> Result<Option<Uuid>, DbError> {
    let patient = sqlx::query_scalar!(
        r#"update aarogyam.patient_links
           set status = $3, decided_by = $4,
               linked_at = case when $3 = 'active' then now() else linked_at end,
               revoked_at = case when $3 = 'revoked' then now() else revoked_at end,
               revoked_by = case when $3 = 'revoked' then 'clinic' else revoked_by end
           where id = $1 and status = $2 and app.patient_in_reach(patient_id, $5)
           returning patient_id"#,
        link_id,
        from,
        to,
        member,
        reach
    )
    .fetch_optional(conn)
    .await?;
    Ok(patient)
}

/// Shares a file with the patient or stops sharing it, within the member's reach. Returns the
/// file's patient when it exists.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_file_shared(
    conn: &mut PgConnection,
    attachment_id: Uuid,
    shared: bool,
    member: Option<Uuid>,
) -> Result<Option<Uuid>, DbError> {
    let patient = sqlx::query_scalar!(
        r#"update aarogyam.attachments set shared_with_patient = $2
           where id = $1 and deleted_at is null and kind <> 'audio'
             and app.patient_in_reach(patient_id, $3)
           returning patient_id"#,
        attachment_id,
        shared,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(patient)
}
