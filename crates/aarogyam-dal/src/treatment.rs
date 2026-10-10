//! Treatment plans, their items, and procedures planned or done in visits.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::visits::ClientRecord;

/// A treatment plan as stored.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PlanRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The member who proposed it.
    pub clinician_id: Uuid,
    /// The visit it was proposed in.
    pub encounter_id: Option<Uuid>,
    /// Its title.
    pub title: String,
    /// `proposed`, `accepted`, `in_progress`, `completed` or `declined`.
    pub status: String,
    /// When the patient accepted it.
    #[serde(default, deserialize_with = "crate::json::optional_timestamp")]
    pub accepted_at: Option<OffsetDateTime>,
    /// When it was proposed.
    #[serde(with = "crate::json::timestamp")]
    pub created_at: OffsetDateTime,
}

/// A plan item as stored, with the live procedure that carries it out, if any.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ItemRow {
    /// Identifier.
    pub id: Uuid,
    /// The plan.
    pub plan_id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// What is to be done.
    pub name: String,
    /// Code system, when coded.
    pub code_system: Option<String>,
    /// Code, when coded.
    pub code: Option<String>,
    /// FDI tooth.
    pub tooth: Option<i16>,
    /// Surfaces.
    pub surfaces: Vec<String>,
    /// Phase, from 1.
    pub phase: i16,
    /// Estimated cost in paise.
    pub estimate_paise: i64,
    /// `proposed`, `accepted`, `done` or `cancelled`.
    pub status: String,
    /// The procedure carrying it out.
    pub procedure_id: Option<Uuid>,
}

/// A listed plan with its items and the clinician's name.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PlanEntry {
    /// The plan.
    #[serde(flatten)]
    pub plan: PlanRow,
    /// The clinician's display name.
    pub clinician_name: Option<String>,
    /// The plan's items by phase.
    pub items: Vec<ItemRow>,
}

/// A patient's plans, newest first, each with its items and the clinician's name, and whether
/// the patient is in this clinic: `None` when not. One statement instead of four.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_for_patient(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Option<Vec<PlanEntry>>, DbError> {
    let row = sqlx::query!(
        r#"select exists (select 1 from aarogyam.patients where id = $1) as "found!",
                  coalesce((
                    select jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc)
                    from (select p.id, p.patient_id, p.clinician_id, p.encounter_id, p.title,
                                 p.status, p.accepted_at, p.created_at,
                                 u.display_name as clinician_name,
                                 coalesce((
                                   select jsonb_agg(to_jsonb(x) order by x.phase, x.id)
                                   from (select i.id, i.plan_id, i.patient_id, i.name,
                                                i.code_system, i.code, i.tooth, i.surfaces,
                                                i.phase, i.estimate_paise, i.status,
                                                (select c.id from aarogyam.procedures c
                                                 where c.treatment_plan_item_id = i.id
                                                   and c.patient_id = i.patient_id
                                                   and c.status <> 'entered_in_error'
                                                 limit 1) as procedure_id
                                         from aarogyam.treatment_plan_items i
                                         where i.plan_id = p.id) x
                                 ), '[]'::jsonb) as items
                          from aarogyam.treatment_plans p
                          left join aarogyam.memberships m
                            on m.org_id = p.org_id and m.id = p.clinician_id
                          left join aarogyam.users u on u.id = m.user_id
                          where p.patient_id = $1) t
                  ), '[]'::jsonb) as "rows!: sqlx::types::Json<Vec<PlanEntry>>""#,
        patient_id
    )
    .fetch_one(conn)
    .await?;
    Ok(row.found.then_some(row.rows.0))
}

/// Inserts a plan.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the visit belongs to another patient.
pub async fn insert_plan(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    clinician_id: Uuid,
    encounter_id: Option<Uuid>,
    title: &str,
) -> Result<PlanRow, DbError> {
    let row = sqlx::query_as!(
        PlanRow,
        r#"insert into aarogyam.treatment_plans (id, patient_id, clinician_id, encounter_id, title)
           values ($1, $2, $3, $4, $5)
           returning id, patient_id, clinician_id, encounter_id, title, status, accepted_at, created_at"#,
        id,
        patient_id,
        clinician_id,
        encounter_id,
        title
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Values for a plan item or a procedure: what, where, and the code.
#[derive(Debug, Clone)]
pub struct Work<'a> {
    /// What is done.
    pub name: &'a str,
    /// Code system and code, when coded.
    pub code: Option<(&'a str, &'a str)>,
    /// FDI tooth.
    pub tooth: Option<i16>,
    /// Surfaces.
    pub surfaces: &'a [String],
}

/// Inserts a plan item.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_item(
    conn: &mut PgConnection,
    id: Uuid,
    plan: &PlanRow,
    work: &Work<'_>,
    phase: i16,
    estimate_paise: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.treatment_plan_items
             (id, plan_id, patient_id, name, code_system, code, tooth, surfaces, phase, estimate_paise)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
        id,
        plan.id,
        plan.patient_id,
        work.name,
        work.code.map(|(system, _)| system),
        work.code.map(|(_, code)| code),
        work.tooth,
        work.surfaces,
        phase,
        estimate_paise
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A patient's plans, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_plans(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<PlanRow>, DbError> {
    let rows = sqlx::query_as!(
        PlanRow,
        r#"select id, patient_id, clinician_id, encounter_id, title, status, accepted_at, created_at
           from aarogyam.treatment_plans where patient_id = $1
           order by created_at desc, id desc"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The plan with `id`; `lock` holds it until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_plan(
    conn: &mut PgConnection,
    id: Uuid,
    lock: bool,
    member: Option<Uuid>,
) -> Result<Option<PlanRow>, DbError> {
    let row = if lock {
        sqlx::query_as!(
            PlanRow,
            r#"select id, patient_id, clinician_id, encounter_id, title, status, accepted_at, created_at
               from aarogyam.treatment_plans
               where id = $1 and app.patient_in_reach(patient_id, $2)
               for update"#,
            id,
            member
        )
        .fetch_optional(conn)
        .await?
    } else {
        sqlx::query_as!(
            PlanRow,
            r#"select id, patient_id, clinician_id, encounter_id, title, status, accepted_at, created_at
               from aarogyam.treatment_plans
               where id = $1 and app.patient_in_reach(patient_id, $2)"#,
            id,
            member
        )
        .fetch_optional(conn)
        .await?
    };
    Ok(row)
}

/// The items of these plans, by plan, phase and order of entry.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_items(
    conn: &mut PgConnection,
    plan_ids: &[Uuid],
) -> Result<Vec<ItemRow>, DbError> {
    let rows = sqlx::query_as!(
        ItemRow,
        r#"select i.id, i.plan_id, i.patient_id, i.name, i.code_system, i.code, i.tooth,
                  i.surfaces, i.phase, i.estimate_paise, i.status,
                  (select p.id from aarogyam.procedures p
                   where p.treatment_plan_item_id = i.id and p.patient_id = i.patient_id
                     and p.status <> 'entered_in_error'
                   limit 1) as procedure_id
           from aarogyam.treatment_plan_items i
           where i.plan_id = any($1)
           order by i.plan_id, i.phase, i.id"#,
        plan_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The plan item with `id`, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_item_for_update(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<ItemRow>, DbError> {
    let row = sqlx::query_as!(
        ItemRow,
        r#"select i.id, i.plan_id, i.patient_id, i.name, i.code_system, i.code, i.tooth,
                  i.surfaces, i.phase, i.estimate_paise, i.status,
                  null::uuid as procedure_id
           from aarogyam.treatment_plan_items i
           where i.id = $1 and app.patient_in_reach(i.patient_id, $2)
           for update"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Accepts a proposed plan: the chosen proposed items (all of them when `item_ids` is
/// `None`) become accepted and the rest cancelled. Returns how many items were accepted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn accept_plan(
    conn: &mut PgConnection,
    id: Uuid,
    item_ids: Option<&[Uuid]>,
    at: OffsetDateTime,
) -> Result<u64, DbError> {
    let accepted = sqlx::query!(
        r#"update aarogyam.treatment_plan_items set status = 'accepted'
           where plan_id = $1 and status = 'proposed' and ($2::uuid[] is null or id = any($2))"#,
        id,
        item_ids
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    sqlx::query!(
        r#"update aarogyam.treatment_plan_items set status = 'cancelled'
           where plan_id = $1 and status = 'proposed'"#,
        id
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"update aarogyam.treatment_plans set status = 'accepted', accepted_at = $2 where id = $1"#,
        id,
        at
    )
    .execute(conn)
    .await?;
    Ok(accepted)
}

/// Sets a plan item's status, then the plan's: in progress while accepted items remain,
/// completed when none do.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_item_status(
    conn: &mut PgConnection,
    item_id: Uuid,
    status: &str,
) -> Result<(), DbError> {
    let plan_id = sqlx::query_scalar!(
        r#"update aarogyam.treatment_plan_items set status = $2 where id = $1 returning plan_id"#,
        item_id,
        status
    )
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query!(
        r#"update aarogyam.treatment_plans p
           set status = case when exists (select 1 from aarogyam.treatment_plan_items i
                                          where i.plan_id = p.id and i.status = 'accepted')
                             then 'in_progress' else 'completed' end
           where p.id = $1 and p.status in ('accepted', 'in_progress', 'completed')"#,
        plan_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A procedure as stored.
#[derive(Debug, Clone)]
pub struct ProcedureRow {
    /// Identifier.
    pub id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The member who did it.
    pub clinician_id: Uuid,
    /// What was done.
    pub name: String,
    /// Code system, when coded.
    pub code_system: Option<String>,
    /// Code, when coded.
    pub code: Option<String>,
    /// FDI tooth.
    pub tooth: Option<i16>,
    /// Surfaces.
    pub surfaces: Vec<String>,
    /// `planned`, `done` or `entered_in_error`.
    pub status: String,
    /// When it was done.
    pub performed_at: Option<OffsetDateTime>,
    /// The fee in paise.
    pub price_paise: Option<i64>,
    /// The plan item it carries out.
    pub treatment_plan_item_id: Option<Uuid>,
    /// A remark.
    pub note: Option<String>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
}

/// Values for a new procedure.
#[derive(Debug, Clone)]
pub struct NewProcedure<'a> {
    /// Identifier chosen by the API.
    pub id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// The visit's patient.
    pub patient_id: Uuid,
    /// The member who did it.
    pub clinician_id: Uuid,
    /// What, where, and the code.
    pub work: Work<'a>,
    /// Status value.
    pub status: &'a str,
    /// When it was done (for `done`).
    pub performed_at: Option<OffsetDateTime>,
    /// The fee.
    pub price_paise: Option<i64>,
    /// The plan item it carries out.
    pub treatment_plan_item_id: Option<Uuid>,
    /// A remark.
    pub note: Option<&'a str>,
    /// The client's id, so a retry finds this procedure.
    pub client_id: Option<Uuid>,
    /// Hash of the request that carried `client_id`.
    pub request_hash: Option<&'a str>,
}

/// The procedure the client's id made, if any, in this clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn procedure_by_client_id(
    conn: &mut PgConnection,
    client_id: Uuid,
) -> Result<Option<ClientRecord>, DbError> {
    let row = sqlx::query!(
        r#"select id, patient_id, request_hash as "request_hash!"
           from aarogyam.procedures where client_id = $1"#,
        client_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| ClientRecord {
        id: row.id,
        patient_id: row.patient_id,
        request_hash: row.request_hash,
    }))
}

/// Inserts a procedure.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the plan item belongs to another patient
/// or already has a live procedure.
pub async fn insert_procedure(
    conn: &mut PgConnection,
    new: &NewProcedure<'_>,
) -> Result<ProcedureRow, DbError> {
    let row = sqlx::query_as!(
        ProcedureRow,
        r#"insert into aarogyam.procedures
             (id, encounter_id, patient_id, clinician_id, name, code_system, code, tooth, surfaces,
              status, performed_at, price_paise, treatment_plan_item_id, note, client_id,
              request_hash)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           returning id, encounter_id, patient_id, clinician_id, name, code_system, code, tooth,
                     surfaces, status, performed_at, price_paise, treatment_plan_item_id, note,
                     error_reason, created_at"#,
        new.id,
        new.encounter_id,
        new.patient_id,
        new.clinician_id,
        new.work.name,
        new.work.code.map(|(system, _)| system),
        new.work.code.map(|(_, code)| code),
        new.work.tooth,
        new.work.surfaces,
        new.status,
        new.performed_at,
        new.price_paise,
        new.treatment_plan_item_id,
        new.note,
        new.client_id,
        new.request_hash
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The procedure with `id`, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_procedure_for_update(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<ProcedureRow>, DbError> {
    let row = sqlx::query_as!(
        ProcedureRow,
        r#"select id, encounter_id, patient_id, clinician_id, name, code_system, code, tooth,
                  surfaces, status, performed_at, price_paise, treatment_plan_item_id, note,
                  error_reason, created_at
           from aarogyam.procedures
           where id = $1 and app.clinical_in_reach(clinician_id, created_by, encounter_id, $2)
           for update"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks a planned procedure done, or any live one entered in error (with a reason).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_procedure_status(
    conn: &mut PgConnection,
    id: Uuid,
    status: &str,
    performed_at: Option<OffsetDateTime>,
    reason: Option<&str>,
) -> Result<ProcedureRow, DbError> {
    let row = sqlx::query_as!(
        ProcedureRow,
        r#"update aarogyam.procedures
           set status = $2, performed_at = coalesce($3, performed_at), error_reason = $4
           where id = $1
           returning id, encounter_id, patient_id, clinician_id, name, code_system, code, tooth,
                     surfaces, status, performed_at, price_paise, treatment_plan_item_id, note,
                     error_reason, created_at"#,
        id,
        status,
        performed_at,
        reason
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// A patient's procedures, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_procedures(
    conn: &mut PgConnection,
    patient_id: Uuid,
    member: Option<Uuid>,
) -> Result<Vec<ProcedureRow>, DbError> {
    let rows = sqlx::query_as!(
        ProcedureRow,
        r#"select id, encounter_id, patient_id, clinician_id, name, code_system, code, tooth,
                  surfaces, status, performed_at, price_paise, treatment_plan_item_id, note,
                  error_reason, created_at
           from aarogyam.procedures
           where patient_id = $1 and app.clinical_in_reach(clinician_id, created_by, encounter_id, $2)
           order by coalesce(performed_at, created_at) desc, id desc"#,
        patient_id,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A visit's procedures, in order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn procedures_of_encounter(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<ProcedureRow>, DbError> {
    let rows = sqlx::query_as!(
        ProcedureRow,
        r#"select id, encounter_id, patient_id, clinician_id, name, code_system, code, tooth,
                  surfaces, status, performed_at, price_paise, treatment_plan_item_id, note,
                  error_reason, created_at
           from aarogyam.procedures where encounter_id = $1
           order by created_at, id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
