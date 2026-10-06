//! Central sign-in's session handoff. A person signs in once on the public site; a session
//! belongs to one origin, so the site asks for a one-time code bound to the person and the host
//! they are going to, and sends them to `https://<host>/auth/handoff#code=…`. That host redeems
//! it (once, within [`VALID_FOR_SECONDS`]) for a session of its own. Only the code's SHA-256 is
//! stored; the fragment never reaches a server log.

use aarogyam_dal::handoff as dal;
use aarogyam_domain::patient::Email;
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::tokens;

/// How long a handoff code is valid.
pub const VALID_FOR_SECONDS: i32 = 60;

/// A handoff just made. The code is shown once, to the person who asked.
#[derive(Debug, Clone)]
pub struct Handoff {
    /// The one-time code.
    pub code: String,
    /// The host it is for, normalised.
    pub host: String,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// The host a handoff is for: lower case, no port, no trailing dot; letters, digits, dots and
/// hyphens only.
fn target_host(host: &str) -> Result<String, AppError> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = host.split(':').next().unwrap_or_default().to_owned();
    let valid = !host.is_empty()
        && host.len() <= 253
        && host.contains('.')
        && !host.contains("..")
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-');
    if valid {
        Ok(host)
    } else {
        Err(AppError::invalid("host", "must be a host name"))
    }
}

/// Makes a handoff for the person behind `auth_uid` to `host`, a clinic portal they are an
/// active member of or, for Sakalya staff, `console_host`.
///
/// # Errors
/// [`AppError::Invalid`] for a malformed host; [`AppError::NotFound`] for a host that isn't
/// theirs (the same answer as an unknown one); [`AppError::Db`] on database failures.
pub async fn create(
    db: &Db,
    auth_uid: Uuid,
    host: &str,
    console_host: &str,
) -> Result<Handoff, AppError> {
    let host = target_host(host)?;
    let (code, code_hash) = tokens::new_token()?;
    let expires_at = dal::create(
        db.pool(),
        &dal::NewHandoff {
            auth_uid,
            code_hash: &code_hash,
            host: &host,
            console_host,
            ttl_seconds: VALID_FOR_SECONDS,
        },
    )
    .await?
    .ok_or(AppError::NotFound("host"))?;
    Ok(Handoff {
        code,
        host,
        expires_at,
    })
}

/// The person a redeemed handoff signs in.
#[derive(Debug, Clone)]
pub struct Redeemed {
    /// Their Supabase id.
    pub auth_uid: Uuid,
    /// Their sign-in address, for a Supabase sign-in token.
    pub email: Option<Email>,
}

/// Uses up a handoff code on `host`. Unknown, used, expired and wrong-host codes all get the
/// same answer, and the first attempt uses a code up whatever happens.
///
/// # Errors
/// [`AppError::NotFound`] when the code doesn't sign anyone in here; [`AppError::Db`] on
/// database failures.
pub async fn redeem(db: &Db, code: &str, host: &str) -> Result<Redeemed, AppError> {
    let code = code.trim();
    // Codes are 32 random bytes in URL-safe base64; anything else is not worth a lookup.
    if code.len() != 43
        || !code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(AppError::NotFound("handoff"));
    }
    let host = target_host(host).map_err(|_| AppError::NotFound("handoff"))?;
    let redeemed = dal::redeem(db.pool(), &tokens::hash_token(code), &host)
        .await?
        .ok_or(AppError::NotFound("handoff"))?;
    Ok(Redeemed {
        auth_uid: redeemed.auth_uid,
        email: redeemed.email.as_deref().and_then(|e| Email::parse(e).ok()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_are_normalised_and_checked() {
        assert_eq!(
            target_host(" Sunrise-Aarogyam.Example.com:443 ").unwrap(),
            "sunrise-aarogyam.example.com"
        );
        assert_eq!(
            target_host("sunrise.localtest.me.").unwrap(),
            "sunrise.localtest.me"
        );
        for bad in [
            "",
            "localhost",
            "a..b",
            "evil.com/x",
            "x y.com",
            "https://a.b",
        ] {
            assert!(target_host(bad).is_err(), "{bad}");
        }
    }
}
