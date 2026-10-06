//! Joining a clinic by invitation.

use aarogyam_dal::invitations::{self, Acceptance};
use aarogyam_domain::patient::Email;
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::tokens::hash_token;

/// The clinic just joined.
#[derive(Debug, Clone, Copy)]
pub struct Joined {
    /// The clinic.
    pub org_id: Uuid,
    /// The new membership.
    pub membership_id: Uuid,
}

/// Accepts an invitation for the signed-in person. The invitation must be for the email address
/// they verified when signing in.
///
/// # Errors
/// [`AppError::Invalid`] without a verified email; [`AppError::NotFound`] for an unknown, used or
/// expired invitation (indistinguishable on purpose); [`AppError::Conflict`] when it is for another
/// address; [`AppError::Db`] on database failures.
pub async fn accept(
    db: &Db,
    auth_uid: Uuid,
    verified_email: Option<&str>,
    token: &str,
    display_name: Option<&str>,
) -> Result<Joined, AppError> {
    let email = verified_email
        .map(Email::parse)
        .transpose()
        .map_err(|_| AppError::invalid("email", "sign in with your email address first"))?
        .ok_or_else(|| AppError::invalid("email", "sign in with your email address first"))?;
    let display_name = display_name.map(str::trim).filter(|name| !name.is_empty());
    match invitations::accept(
        db.pool(),
        &hash_token(token),
        auth_uid,
        email.as_str(),
        display_name,
    )
    .await?
    {
        Acceptance::Accepted {
            org_id,
            membership_id,
        } => Ok(Joined {
            org_id,
            membership_id,
        }),
        Acceptance::Invalid => Err(AppError::NotFound("invitation")),
        Acceptance::WrongEmail => Err(AppError::Conflict(
            "this invitation is for a different email address; sign in with the address it was sent to",
        )),
        Acceptance::PlatformStaff => Err(AppError::Conflict(
            "Sakalya staff accounts can't join a clinic; sign in with a different email address",
        )),
        Acceptance::Disabled => Err(AppError::Denied(
            aarogyam_domain::access::Denied::UserDisabled,
        )),
    }
}
