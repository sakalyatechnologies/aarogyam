//! The app-store reviewer's sign-in. Store reviewers can't receive emailed codes, and there is
//! no fixed-code bypass: the reviewer signs in with a Supabase password, as the owner of a
//! synthetic demo clinic, so they see every feature and no real data.
//!
//! `aarogyam admin review-account` sets it up from the `ARO_REVIEW_PASSWORD` environment
//! variable; `review-account-off` ends it. The password is a [`SecretString`] and is in no error,
//! log line or output of this module.

use std::fmt::Write as _;

use aarogyam_dal::console as dal;
use aarogyam_domain::patient::Email;
use sakalya_db::Db;
use secrecy::{ExposeSecret, SecretString};

use crate::accounts::{AccountsError, SignInAccounts};

/// The only clinics a reviewer account can be made at: the synthetic demo clinics. A real
/// clinic is refused. (`suhasyadental` is synthetic too: the founder confirmed it on 15 Nov 2026.)
pub const REVIEW_CLINICS: &[&str] = &["sunrise", "lotus", "suhasyadental"];

/// The environment variable the password is read from, and nowhere else.
pub const PASSWORD_ENV: &str = "ARO_REVIEW_PASSWORD";

/// Fewest characters in the password (the website accepts 12; a reviewer's is stricter).
pub const MIN_PASSWORD_CHARS: usize = 16;

/// Why the reviewer account was not set up or ended. Carries no password.
#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    /// The password variable is not set.
    #[error("set {PASSWORD_ENV} to the reviewer's password")]
    PasswordMissing,
    /// The password is shorter than [`MIN_PASSWORD_CHARS`].
    #[error("{PASSWORD_ENV} must be at least {MIN_PASSWORD_CHARS} characters")]
    PasswordTooShort,
    /// The clinic is not a synthetic demo clinic.
    #[error("a reviewer account can only be made at a synthetic demo clinic: {}", REVIEW_CLINICS.join(", "))]
    NotADemoClinic,
    /// No clinic has the slug.
    #[error("no clinic with that --clinic slug")]
    NoSuchClinic,
    /// The address is Sakalya platform staff.
    #[error("that address is Sakalya platform staff, who can't hold a clinic membership")]
    PlatformStaff,
    /// The clinic has no `owner` role.
    #[error("the clinic has no owner role")]
    NoOwnerRole,
    /// The sign-in account could not be set up.
    #[error("could not set up the Supabase sign-in account: {0}")]
    Account(#[from] AccountsError),
    /// The system's random source failed.
    #[error("the random number generator failed")]
    Random,
    /// A database failure.
    #[error("database error: {0}")]
    Database(#[from] sakalya_db::DbError),
}

/// The slug if it is a synthetic demo clinic.
///
/// # Errors
/// [`ReviewError::NotADemoClinic`] for any other slug.
pub fn check_clinic(slug: &str) -> Result<&str, ReviewError> {
    let slug = slug.trim();
    if REVIEW_CLINICS.contains(&slug) {
        Ok(slug)
    } else {
        Err(ReviewError::NotADemoClinic)
    }
}

/// The password from the value of [`PASSWORD_ENV`].
///
/// # Errors
/// [`ReviewError::PasswordMissing`] when unset or empty; [`ReviewError::PasswordTooShort`]
/// under [`MIN_PASSWORD_CHARS`] characters.
pub fn password_from(value: Option<String>) -> Result<SecretString, ReviewError> {
    let password = SecretString::from(
        value
            .filter(|value| !value.is_empty())
            .ok_or(ReviewError::PasswordMissing)?,
    );
    if password.expose_secret().chars().count() < MIN_PASSWORD_CHARS {
        return Err(ReviewError::PasswordTooShort);
    }
    Ok(password)
}

/// A random password nobody knows: 32 random bytes in hex.
fn scrambled() -> Result<SecretString, ReviewError> {
    let mut bytes = [0_u8; 32];
    aws_lc_rs::rand::fill(&mut bytes).map_err(|_| ReviewError::Random)?;
    let mut hex = String::with_capacity(64);
    for byte in bytes {
        let _ = write!(hex, "{byte:02x}");
    }
    Ok(SecretString::from(hex))
}

/// Makes `email` an active owner of the demo clinic `slug`, signing in with `password`: finds or
/// creates their Supabase account with it, then adds the membership as `admin add-member` does.
/// Nothing is changed for a clinic that isn't a demo clinic or for platform staff.
///
/// # Errors
/// [`ReviewError`] as it says; none carries the password.
pub async fn enable(
    db: &Db,
    accounts: &dyn SignInAccounts,
    slug: &str,
    email: &Email,
    name: Option<&str>,
    password: &SecretString,
) -> Result<String, ReviewError> {
    let slug = check_clinic(slug)?;
    let preflight = dal::review_preflight(db.pool(), slug, email.as_str()).await?;
    if !preflight.clinic_exists {
        return Err(ReviewError::NoSuchClinic);
    }
    if preflight.platform_staff {
        return Err(ReviewError::PlatformStaff);
    }
    let auth_uid = accounts.ensure_user_with_password(email, password).await?;
    let display_name = name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .or_else(|| email.as_str().split('@').next())
        .unwrap_or("Reviewer");
    dal::add_member(
        db.pool(),
        slug,
        "owner",
        auth_uid.uuid(),
        email.as_str(),
        display_name,
    )
    .await?
    .ok_or(ReviewError::NoOwnerRole)?;
    Ok(format!(
        "clinic: {slug}, email: {}, password set from {PASSWORD_ENV}",
        email.as_str()
    ))
}

/// Ends `email`'s membership at the demo clinic `slug` and scrambles their Supabase password to a
/// random value nobody sees.
///
/// # Errors
/// [`ReviewError`] as it says; none carries a password.
pub async fn disable(
    db: &Db,
    accounts: &dyn SignInAccounts,
    slug: &str,
    email: &Email,
) -> Result<String, ReviewError> {
    let slug = check_clinic(slug)?;
    let ended = dal::end_membership_by_email(db.pool(), slug, email.as_str()).await?;
    let password = scrambled()?;
    accounts.replace_password(email, &password).await?;
    Ok(format!(
        "clinic: {slug}, email: {}, {}; password scrambled",
        email.as_str(),
        if ended {
            "membership ended"
        } else {
            "no active membership"
        }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_synthetic_demo_clinics_are_accepted() {
        assert_eq!(check_clinic("sunrise").unwrap(), "sunrise");
        assert_eq!(check_clinic(" lotus ").unwrap(), "lotus");
        assert_eq!(check_clinic("suhasyadental").unwrap(), "suhasyadental");
        for other in ["alpha", "Sunrise", "sunrise2", "sun", ""] {
            assert!(
                matches!(check_clinic(other), Err(ReviewError::NotADemoClinic)),
                "{other}"
            );
        }
    }

    #[test]
    fn the_password_must_be_set_and_at_least_16_characters() {
        assert!(matches!(
            password_from(None),
            Err(ReviewError::PasswordMissing)
        ));
        assert!(matches!(
            password_from(Some(String::new())),
            Err(ReviewError::PasswordMissing)
        ));
        let short = "a".repeat(15);
        let error = password_from(Some(short.clone())).unwrap_err();
        assert!(matches!(error, ReviewError::PasswordTooShort));
        assert!(!format!("{error} {error:?}").contains(&short));
        let ok = "b".repeat(16);
        assert_eq!(password_from(Some(ok.clone())).unwrap().expose_secret(), ok);
    }

    #[test]
    fn a_scrambled_password_is_64_hex_characters_and_differs_each_time() {
        let (a, b) = (scrambled().unwrap(), scrambled().unwrap());
        assert_eq!(a.expose_secret().len(), 64);
        assert!(a.expose_secret().bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a.expose_secret(), b.expose_secret());
        assert!(!format!("{a:?}").contains(a.expose_secret()));
    }
}
