//! Links to one visit and the visit summary a patient reads: the treatments done, the advice
//! (the Plan section of signed notes only, through `app.visit_advice`), the prescription, the
//! next follow-up and earlier visits. The link lookup, PIN counting and open count are shared
//! with the other links in [`crate::prescriptions`].
//!
//! Every query filters by the patient as well as the visit, so a link can never reach another
//! patient's rows, whoever the actor is. Row-level security (migration 0425) does the same for a
//! patient account.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A new link to one visit.
#[derive(Debug, Clone)]
pub struct NewVisitLink<'a> {
    /// Identifier.
    pub id: Uuid,
    /// SHA-256 of the token.
    pub token_hash: &'a str,
    /// SHA-256 of the token and PIN.
    pub pin_hash: &'a str,
    /// The visit.
    pub encounter_id: Uuid,
    /// Its patient.
    pub patient_id: Uuid,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// Records a link to a visit.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, link: &NewVisitLink<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.share_links
             (id, token_hash, pin_hash, resource, encounter_id, patient_id, channel, expires_at)
           values ($1, $2, $3, 'visit', $4, $5, 'whatsapp', $6)"#,
        link.id,
        link.token_hash,
        link.pin_hash,
        link.encounter_id,
        link.patient_id,
        link.expires_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The visit a link shows.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn link_encounter(
    conn: &mut PgConnection,
    link_id: Uuid,
) -> Result<Option<Uuid>, DbError> {
    let row = sqlx::query_scalar!(
        "select encounter_id from aarogyam.share_links where id = $1",
        link_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.flatten())
}

/// A visit as the summary starts.
#[derive(Debug, Clone)]
pub struct HeadRow {
    /// The visit.
    pub id: Uuid,
    /// `V-318`.
    pub number: String,
    /// When it started.
    pub started_at: OffsetDateTime,
    /// The doctor's display name, when the clinician has a practitioner record.
    pub doctor_name: Option<String>,
    /// The Plan section of the signed notes.
    pub advice: Option<String>,
}

/// A patient's visits, newest first: one visit (`only`), or those before `before`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn heads(
    conn: &mut PgConnection,
    patient_id: Uuid,
    only: Option<Uuid>,
    before: Option<OffsetDateTime>,
    limit: i64,
) -> Result<Vec<HeadRow>, DbError> {
    let rows = sqlx::query_as!(
        HeadRow,
        r#"select e.id, e.number, e.started_at, d.display_name as "doctor_name?",
                  app.visit_advice(e.id) as advice
           from aarogyam.encounters e
           left join aarogyam.practitioners d
             on d.org_id = e.org_id and d.membership_id = e.clinician_id
           where e.patient_id = $1
             and ($2::uuid is null or e.id = $2)
             and ($3::timestamptz is null or e.started_at < $3)
           order by e.started_at desc, e.id desc
           limit $4"#,
        patient_id,
        only,
        before,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A procedure done in a visit. No fee: the summary never shows prices.
#[derive(Debug, Clone)]
pub struct TreatmentRow {
    /// The visit.
    pub encounter_id: Uuid,
    /// What was done.
    pub name: String,
    /// FDI tooth number.
    pub tooth: Option<i16>,
    /// Surfaces, such as `O`.
    pub surfaces: Vec<String>,
}

/// The procedures done in these visits, in the order they were done.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn treatments(
    conn: &mut PgConnection,
    patient_id: Uuid,
    encounters: &[Uuid],
) -> Result<Vec<TreatmentRow>, DbError> {
    let rows = sqlx::query_as!(
        TreatmentRow,
        r#"select encounter_id, name, tooth, surfaces
           from aarogyam.procedures
           where patient_id = $1 and encounter_id = any($2) and status = 'done'
           order by performed_at nulls last, created_at, id"#,
        patient_id,
        encounters
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The issued prescription of a visit.
#[derive(Debug, Clone)]
pub struct PrescriptionRow {
    /// The visit.
    pub encounter_id: Uuid,
    /// `RX-…`.
    pub number: String,
    /// When it was issued.
    pub issued_at: OffsetDateTime,
    /// The lines in order, as a JSON array.
    pub items: Value,
}

/// The newest issued prescription of each of these visits.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn prescriptions(
    conn: &mut PgConnection,
    patient_id: Uuid,
    encounters: &[Uuid],
) -> Result<Vec<PrescriptionRow>, DbError> {
    let rows = sqlx::query_as!(
        PrescriptionRow,
        r#"select distinct on (r.encounter_id)
                  r.encounter_id as "encounter_id!", r.number as "number!",
                  r.issued_at as "issued_at!",
                  coalesce((select jsonb_agg(jsonb_build_object(
                              'drug_name', i.drug_name, 'strength', i.strength, 'form', i.form,
                              'dose', i.dose, 'frequency', i.frequency, 'timing', i.timing,
                              'duration_days', i.duration_days, 'instructions', i.instructions)
                            order by i.line_no)
                            from aarogyam.prescription_items i
                            where i.org_id = r.org_id and i.prescription_id = r.id), '[]'::jsonb)
                    as "items!"
           from aarogyam.prescriptions r
           where r.patient_id = $1 and r.encounter_id = any($2) and r.status = 'issued'
           order by r.encounter_id, r.issued_at desc"#,
        patient_id,
        encounters
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The patient's next follow-up.
#[derive(Debug, Clone)]
pub struct FollowUpRow {
    /// The day it is due.
    pub due_on: Date,
    /// `follow_up`, `cleaning`, …
    pub kind: String,
}

/// The earliest recall of the patient still open and due on or after `today`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn next_follow_up(
    conn: &mut PgConnection,
    patient_id: Uuid,
    today: Date,
) -> Result<Option<FollowUpRow>, DbError> {
    let row = sqlx::query_as!(
        FollowUpRow,
        r#"select due_on, kind from aarogyam.recalls
           where patient_id = $1 and status in ('due', 'notified') and due_on >= $2
           order by due_on, id
           limit 1"#,
        patient_id,
        today
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}
