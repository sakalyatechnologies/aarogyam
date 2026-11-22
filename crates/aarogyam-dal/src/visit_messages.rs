//! What the doctor's `WhatsApp` visit summary and the richer shared visit page read
//! (docs/plans/visit-story-design.md, C2 and C4): the relative it may go to, the visit's
//! medicines and plan, whether the automatic summary already went, and the clinic's phone.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A relative the summary may go to.
#[derive(Debug, Clone)]
pub struct Contact {
    /// The relative's patient record.
    pub patient_id: Uuid,
    /// Their mobile, when recorded.
    pub phone_e164: Option<String>,
}

/// The relative a patient's summary goes to: for a minor (`minor`), their primary contact or a
/// guardian or parent; for an adult, only a relative marked as primary contact. One with a
/// mobile comes first, then the primary contact, then a guardian. `None` when there is none.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn relative_contact(
    conn: &mut PgConnection,
    patient_id: Uuid,
    minor: bool,
) -> Result<Option<Contact>, DbError> {
    let row = sqlx::query_as!(
        Contact,
        r#"select p.id as patient_id, p.phone_e164
           from aarogyam.patient_relations r
           join aarogyam.patients p on p.org_id = r.org_id and p.id = r.related_patient_id
           where r.patient_id = $1 and p.deleted_at is null
             and (r.is_primary_contact or ($2 and r.relation in ('guardian', 'parent')))
           order by (p.phone_e164 is not null) desc, r.is_primary_contact desc,
                    (r.relation = 'guardian') desc, r.created_at, r.id
           limit 1"#,
        patient_id,
        minor
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A medicine prescribed in the visit.
#[derive(Debug, Clone)]
pub struct MedicineRow {
    /// Generic name (from the medicine list), or the name as printed.
    pub generic: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// How often, such as `1-0-1`.
    pub frequency: String,
    /// When to take it, such as `after_food`.
    pub timing: Option<String>,
    /// For how many days.
    pub duration_days: Option<i16>,
}

/// The medicines of the visit's issued prescriptions, in order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn medicines(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<MedicineRow>, DbError> {
    let rows = sqlx::query_as!(
        MedicineRow,
        r#"select coalesce(d.generic_name, i.drug_name) as "generic!",
                  coalesce(i.strength, d.strength) as strength, i.frequency, i.timing,
                  i.duration_days
           from aarogyam.prescriptions r
           join aarogyam.prescription_items i
             on i.org_id = r.org_id and i.prescription_id = r.id
           left join aarogyam.drug_catalog d on d.id = i.drug_id
           where r.encounter_id = $1 and r.status = 'issued'
           order by r.issued_at, r.id, i.line_no"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A planned item of the visit: a planned procedure or an accepted plan item.
#[derive(Debug, Clone)]
pub struct PlannedRow {
    /// The procedure's or plan item's id.
    pub id: Uuid,
    /// What is to be done.
    pub name: String,
    /// The code, when coded.
    pub code: Option<String>,
    /// FDI tooth.
    pub tooth: Option<i16>,
    /// The fee or estimate in paise, when known.
    pub estimate_paise: Option<i64>,
    /// When it was planned or proposed.
    pub created_at: OffsetDateTime,
}

/// The visit's planned procedures, in order of entry.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn planned_procedures(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<PlannedRow>, DbError> {
    let rows = sqlx::query_as!(
        PlannedRow,
        r#"select id, name, code, tooth, price_paise as estimate_paise, created_at
           from aarogyam.procedures
           where encounter_id = $1 and status = 'planned'
           order by created_at, id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The patient's accepted plan items still to do, by phase, leaving out those a planned
/// procedure of this visit already carries (`treatment_plan_item_id`) and those done elsewhere.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn accepted_plan_items(
    conn: &mut PgConnection,
    patient_id: Uuid,
    encounter_id: Uuid,
) -> Result<Vec<PlannedRow>, DbError> {
    let rows = sqlx::query_as!(
        PlannedRow,
        r#"select i.id, i.name, i.code, i.tooth, i.estimate_paise as "estimate_paise?",
                  i.created_at
           from aarogyam.treatment_plan_items i
           join aarogyam.treatment_plans p on p.org_id = i.org_id and p.id = i.plan_id
           where p.patient_id = $1 and p.status in ('accepted', 'in_progress')
             and i.status = 'accepted'
             and not exists (select 1 from aarogyam.procedures c
                             where c.treatment_plan_item_id = i.id
                               and c.patient_id = i.patient_id
                               and (c.status = 'done'
                                    or (c.status = 'planned' and c.encounter_id = $2)))
           order by p.created_at, i.phase, i.id"#,
        patient_id,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The patient's proposed (not yet accepted) plan items on open plans, by phase, leaving out
/// those a planned procedure of this visit or a done procedure already carries. The mouth view
/// shows them as recommended (decisions.md, 20 Nov 2026).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn proposed_plan_items(
    conn: &mut PgConnection,
    patient_id: Uuid,
    encounter_id: Uuid,
) -> Result<Vec<PlannedRow>, DbError> {
    let rows = sqlx::query_as!(
        PlannedRow,
        r#"select i.id, i.name, i.code, i.tooth, i.estimate_paise as "estimate_paise?",
                  i.created_at
           from aarogyam.treatment_plan_items i
           join aarogyam.treatment_plans p on p.org_id = i.org_id and p.id = i.plan_id
           where p.patient_id = $1 and p.status in ('proposed', 'accepted', 'in_progress')
             and i.status = 'proposed'
             and not exists (select 1 from aarogyam.procedures c
                             where c.treatment_plan_item_id = i.id
                               and c.patient_id = i.patient_id
                               and (c.status = 'done'
                                    or (c.status = 'planned' and c.encounter_id = $2)))
           order by p.created_at, i.phase, i.id"#,
        patient_id,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// When the automatic summary for the visit was sent, or queued to send; `None` when it wasn't
/// (or was skipped, or failed).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn auto_summary_at(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Option<OffsetDateTime>, DbError> {
    // The automatic summary's dedupe key (`aarogyam_app::auto_messages::visit_closed`).
    let key = format!("auto:visit_summary:{encounter_id}");
    let at = sqlx::query_scalar!(
        r#"select coalesce(sent_at, created_at) as "at!" from aarogyam.messages
           where dedupe_key = $1 and template_key = 'visit.summary'
             and status in ('queued', 'sending', 'sent')"#,
        key
    )
    .fetch_optional(conn)
    .await?;
    Ok(at)
}

/// Revokes the visit's live links but the newest `keep`; returns how many it revoked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn keep_newest_links(
    conn: &mut PgConnection,
    encounter_id: Uuid,
    keep: i64,
) -> Result<u64, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.share_links set revoked_at = now()
           where id in (select id from aarogyam.share_links
                        where resource = 'visit' and encounter_id = $1
                          and revoked_at is null and expires_at > now()
                        order by created_at desc, id desc
                        offset $2)"#,
        encounter_id,
        keep
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected())
}

/// The patient's next booked appointment after `after`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn next_booked(
    conn: &mut PgConnection,
    patient_id: Uuid,
    after: OffsetDateTime,
) -> Result<Option<OffsetDateTime>, DbError> {
    let at = sqlx::query_scalar!(
        r#"select starts_at from aarogyam.appointments
           where patient_id = $1 and status in ('booked', 'confirmed') and starts_at > $2
           order by starts_at limit 1"#,
        patient_id,
        after
    )
    .fetch_optional(conn)
    .await?;
    Ok(at)
}

/// What the shared visit page adds about the clinic and the visit's doctor.
#[derive(Debug, Clone)]
pub struct PageContext {
    /// The visit branch's phone, else the default branch's.
    pub clinic_phone: Option<String>,
    /// Whether the clinic shows patients estimates (`billing.patient_estimates`; on when unset).
    pub patient_estimates: bool,
    /// The visit doctor's practitioner, for booking.
    pub practitioner_id: Option<Uuid>,
}

/// The page context of a visit; `None` for an unknown visit.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn page_context(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Option<PageContext>, DbError> {
    let row = sqlx::query_as!(
        PageContext,
        r#"select coalesce(
                    (select b.phone_e164 from aarogyam.branches b
                     where b.org_id = e.org_id and b.id = e.branch_id and b.deleted_at is null),
                    (select b.phone_e164 from aarogyam.branches b
                     where b.org_id = e.org_id and b.is_default and b.deleted_at is null
                     limit 1)) as clinic_phone,
                  coalesce((select case jsonb_typeof(s.billing -> 'patient_estimates')
                                     when 'boolean' then (s.billing -> 'patient_estimates')::boolean
                                   end
                            from aarogyam.org_settings s where s.org_id = e.org_id), true)
                    as "patient_estimates!",
                  (select pr.id from aarogyam.practitioners pr
                   where pr.org_id = e.org_id and pr.membership_id = e.clinician_id
                     and pr.deleted_at is null
                   limit 1) as practitioner_id
           from aarogyam.encounters e where e.id = $1"#,
        encounter_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}
