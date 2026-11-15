//! A person deleting their own account (`db/migrations/0713_account_deletion.sql`), and the
//! queue of sign-in identities the outbox job then deletes in Supabase Auth. Both act for no one
//! clinic, so they go through definer functions, like [`crate::sessions`].

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// A clinic whose only active owner is the person asking to delete their account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoleOwned {
    /// The clinic.
    pub id: Uuid,
    /// Its name.
    pub name: String,
}

/// What `app.delete_own_account` did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Deleted {
    /// No staff account for this sign-in (a patient-only identity): nothing changed.
    Unknown,
    /// Already deleted: nothing changed.
    Nothing,
    /// Active Sakalya staff are managed in the console: nothing changed.
    PlatformStaff,
    /// The person is the only active owner of these clinics: nothing changed.
    LastOwner(Vec<SoleOwned>),
    /// Done.
    Done {
        /// The provider ids of the sessions just signed out, for the caller's caches.
        sessions: Vec<Uuid>,
        /// The photos the person had at clinics, as (clinic, file) to remove from storage.
        avatars: Vec<(Uuid, Uuid)>,
    },
}

/// Deletes the person's own account in one transaction: leaves every clinic, signs out every
/// session, drops the devices and push tokens, anonymises the user and queues the Supabase
/// identity for deletion. Refuses (changing nothing) for platform staff and for the only owner
/// of a clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_own(
    pool: &PgPool,
    auth_uid: Uuid,
    current_session: Option<Uuid>,
) -> Result<Deleted, DbError> {
    let rows = sqlx::query!(
        r#"select outcome as "outcome!", org_id, org_name, provider_session_id
           from app.delete_own_account($1, $2)"#,
        auth_uid,
        current_session
    )
    .fetch_all(pool)
    .await?;
    let outcome = rows.first().map_or("", |row| row.outcome.as_str());
    Ok(match outcome {
        "platform_staff" => Deleted::PlatformStaff,
        "last_owner" => Deleted::LastOwner(
            rows.into_iter()
                .filter_map(|row| Some((row.org_id?, row.org_name?)))
                .map(|(id, name)| SoleOwned { id, name })
                .collect(),
        ),
        "deleted" => {
            let mut sessions = Vec::new();
            let mut avatars = Vec::new();
            for row in rows {
                match (row.outcome.as_str(), row.org_id, row.provider_session_id) {
                    ("avatar", Some(org), Some(file)) => avatars.push((org, file)),
                    ("deleted", _, Some(session)) => sessions.push(session),
                    _ => {}
                }
            }
            Deleted::Done { sessions, avatars }
        }
        "unknown" => Deleted::Unknown,
        _ => Deleted::Nothing,
    })
}

/// A Supabase identity claimed for deletion.
#[derive(Debug, Clone)]
pub struct ClaimedDeletion {
    /// The queue row.
    pub id: Uuid,
    /// The Supabase Auth id to delete.
    pub auth_uid: Uuid,
    /// Attempts so far, this one included.
    pub attempts: i32,
    /// The person also has a patient-app account on this identity: keep the identity.
    pub keep_identity: bool,
}

/// Claims up to `limit` due identities for `lease_seconds`: a job that dies mid-call leaves them
/// to be retried after the lease.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn claim(
    pool: &PgPool,
    limit: i32,
    lease_seconds: i32,
) -> Result<Vec<ClaimedDeletion>, DbError> {
    let rows = sqlx::query_as!(
        ClaimedDeletion,
        r#"select id as "id!", auth_uid as "auth_uid!", attempts as "attempts!",
                  keep_identity as "keep_identity!"
           from app.account_deletions_claim($1, $2)"#,
        limit,
        lease_seconds
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Records that the row is finished: the identity is gone from Supabase Auth, or (with a `note`
/// such as `kept_for_patient_app`) was kept on purpose.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_done(pool: &PgPool, id: Uuid, note: Option<&str>) -> Result<(), DbError> {
    sqlx::query!(r#"select app.account_deletion_done($1, $2)"#, id, note)
        .execute(pool)
        .await?;
    Ok(())
}

/// Records a failed attempt, retried at `retry_at`. `error` is a short reason without secrets,
/// names or addresses.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_failed(
    pool: &PgPool,
    id: Uuid,
    error: &str,
    retry_at: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"select app.account_deletion_failed($1, $2, $3)"#,
        id,
        error,
        retry_at
    )
    .execute(pool)
    .await?;
    Ok(())
}
