//! Accepting invitations, before the person is a member of anything (`app.accept_invitation`).

use sakalya_db::DbError;
use sqlx::PgPool;
use uuid::Uuid;

/// What happened when someone tried to accept an invitation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Acceptance {
    /// They joined the clinic.
    Accepted {
        /// The clinic.
        org_id: Uuid,
        /// Their membership.
        membership_id: Uuid,
    },
    /// Unknown, already used or expired.
    Invalid,
    /// The invitation is for a different email address than the one they signed in with.
    WrongEmail,
    /// Their account is disabled.
    Disabled,
    /// They are Sakalya platform staff, whose accounts are separate from clinic accounts.
    PlatformStaff,
}

/// Accepts the invitation whose token hashes to `token_hash` for the signed-in person.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn accept(
    pool: &PgPool,
    token_hash: &str,
    auth_uid: Uuid,
    email: &str,
    display_name: Option<&str>,
) -> Result<Acceptance, DbError> {
    let row = sqlx::query!(
        r#"select org_id, membership_id, outcome as "outcome!"
           from app.accept_invitation($1, $2, $3, $4)"#,
        token_hash,
        auth_uid,
        email,
        display_name
    )
    .fetch_one(pool)
    .await?;
    Ok(
        match (row.outcome.as_str(), row.org_id, row.membership_id) {
            ("accepted", Some(org_id), Some(membership_id)) => Acceptance::Accepted {
                org_id,
                membership_id,
            },
            ("wrong_email", _, _) => Acceptance::WrongEmail,
            ("disabled", _, _) => Acceptance::Disabled,
            ("platform_staff", _, _) => Acceptance::PlatformStaff,
            _ => Acceptance::Invalid,
        },
    )
}
