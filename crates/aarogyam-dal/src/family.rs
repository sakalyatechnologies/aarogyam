//! Family links between patients of one clinic (`patient_relations`).

use serde::Deserialize;
use sqlx::PgConnection;
use sqlx::types::Json;
use uuid::Uuid;

use sakalya_db::DbError;

/// One link as listed: the related patient and what they are to the patient.
#[derive(Debug, Clone, Deserialize)]
pub struct RelationRow {
    /// The link's identifier.
    pub id: Uuid,
    /// The related patient.
    pub related_patient_id: Uuid,
    /// Their readable number.
    pub number: String,
    /// Their full name.
    pub full_name: String,
    /// `guardian`, `child`, `spouse`, `parent`, `sibling` or `other`.
    pub relation: String,
    /// Whether they are the patient's contact person.
    pub is_primary_contact: bool,
}

/// The patient's links, relatives within `member`'s reach only; `None` when the patient isn't in
/// this clinic or is out of reach.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    patient_id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<Vec<RelationRow>>, DbError> {
    let row = sqlx::query!(
        r#"select exists (select 1 from aarogyam.patients
                          where id = $1 and deleted_at is null
                            and app.patient_in_reach(id, $2)) as "found!",
                  coalesce((
                    select jsonb_agg(to_jsonb(v) order by v.full_name, v.id)
                    from (select r.id, r.related_patient_id, p.number, p.full_name,
                                 r.relation, r.is_primary_contact
                          from aarogyam.patient_relations r
                          join aarogyam.patients p
                            on p.org_id = r.org_id and p.id = r.related_patient_id
                          where r.patient_id = $1 and p.deleted_at is null
                            and app.patient_in_reach(p.id, $2)) v
                  ), '[]'::jsonb) as "items!: Json<Vec<RelationRow>>""#,
        patient_id,
        member
    )
    .fetch_one(conn)
    .await?;
    Ok(row.found.then_some(row.items.0))
}

/// Links `patient_id` to `related_patient_id`; `None` when the pair is already linked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    patient_id: Uuid,
    related_patient_id: Uuid,
    relation: &str,
    is_primary_contact: bool,
) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        r#"insert into aarogyam.patient_relations
             (patient_id, related_patient_id, relation, is_primary_contact)
           values ($1, $2, $3, $4)
           on conflict (org_id, patient_id, related_patient_id) do nothing
           returning id"#,
        patient_id,
        related_patient_id,
        relation,
        is_primary_contact
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// Removes the link `id` of `patient_id` and its inverse; false when there is no such link.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_pair(
    conn: &mut PgConnection,
    patient_id: Uuid,
    id: Uuid,
) -> Result<bool, DbError> {
    let removed = sqlx::query_scalar!(
        r#"with gone as (
             delete from aarogyam.patient_relations
             where id = $2 and patient_id = $1
             returning related_patient_id
           ), inverse as (
             delete from aarogyam.patient_relations r
             using gone g
             where r.patient_id = g.related_patient_id and r.related_patient_id = $1
           )
           select count(*) as "removed!" from gone"#,
        patient_id,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(removed > 0)
}

/// A relative of a matched patient.
#[derive(Debug, Clone, Deserialize)]
pub struct GroupRow {
    /// The patient the lookup matched.
    pub patient_id: Uuid,
    /// The relative.
    pub related_patient_id: Uuid,
    /// Their readable number.
    pub number: String,
    /// Their full name.
    pub full_name: String,
    /// What they are to the matched patient.
    pub relation: String,
}

/// The relatives of several patients at once, within `member`'s reach.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn groups(
    conn: &mut PgConnection,
    patient_ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<GroupRow>, DbError> {
    let rows = sqlx::query_as!(
        GroupRow,
        r#"select r.patient_id, r.related_patient_id, p.number, p.full_name, r.relation
           from aarogyam.patient_relations r
           join aarogyam.patients p on p.org_id = r.org_id and p.id = r.related_patient_id
           where r.patient_id = any($1) and p.deleted_at is null and p.status <> 'merged'
             and app.patient_in_reach(p.id, $2)
           order by p.full_name, p.id"#,
        patient_ids,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
