//! Sakalya's console: listing and creating clinics. The console never sees patient records.

use aarogyam_dal::console as dal;
use aarogyam_dal::lookups::PlatformAccess;
use aarogyam_domain::patient::{Email, NumberPrefix};
use sakalya_db::Db;
use sakalya_types::Slug;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::AppError;

/// How long an owner's invitation stays valid.
pub const INVITE_VALID_FOR: Duration = Duration::days(7);

/// Subdomains the platform keeps for itself (mirrors the check in the database).
const RESERVED: [&str; 18] = [
    "www", "api", "app", "console", "admin", "auth", "login", "mail", "status", "docs", "help",
    "support", "static", "assets", "cdn", "staging", "dev", "test",
];

/// Every clinic with counts, newest first.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn clinics(db: &Db) -> Result<Vec<dal::ConsoleClinic>, AppError> {
    Ok(dal::clinics(db.pool()).await?)
}

/// Input for creating a clinic, as received.
#[derive(Debug, Clone)]
pub struct CreateClinic {
    /// The clinic's name.
    pub name: String,
    /// The subdomain; derived from the name when absent.
    pub slug: Option<String>,
    /// `dental` or `general`.
    pub specialty: String,
    /// The owner's email; they receive the invitation.
    pub owner_email: String,
}

/// A clinic just created, with the owner's one-time invitation token. The token is shown once
/// (and later emailed); only its SHA-256 is stored.
#[derive(Debug, Clone)]
pub struct CreatedClinic {
    /// The clinic.
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its portal host name.
    pub portal_host: String,
    /// The invitation.
    pub invitation_id: Uuid,
    /// The secret for the invitation link.
    pub invite_token: String,
    /// When the invitation expires.
    pub invite_expires_at: OffsetDateTime,
}

/// A clinic's portal host: `{slug}` in the template replaced with its slug. A template with no
/// `{slug}` in it (a single flat staging host, say) is returned unchanged, on purpose: it lets a
/// deployment without a wildcard domain yet point every clinic at the same host for now.
fn portal_host(template: &str, slug: &str) -> String {
    template.replace("{slug}", slug)
}

/// Initials of the first three words, such as `SD` for "Sunrise Dental"; `CL` if none.
fn number_prefix(name: &str) -> String {
    let prefix: String = name
        .split_whitespace()
        .filter_map(|word| word.chars().find(char::is_ascii_alphabetic))
        .take(3)
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if prefix.is_empty() {
        "CL".to_owned()
    } else {
        prefix
    }
}

/// Creates a clinic with an owner invitation. Its portal host comes from `portal_host_template`
/// with `{slug}` replaced by the clinic's own slug.
///
/// # Errors
/// [`AppError::Denied`]-style refusal is the caller's job (platform role); this returns
/// [`AppError::Invalid`] for bad input, [`AppError::Conflict`] for a taken subdomain, and
/// [`AppError::Db`] on database failures.
pub async fn create_clinic(
    db: &Db,
    staff: &PlatformAccess,
    input: CreateClinic,
    portal_host_template: &str,
    now: OffsetDateTime,
) -> Result<CreatedClinic, AppError> {
    let name = input.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > 200 {
        return Err(AppError::invalid("name", "must be 1 to 200 characters"));
    }
    let slug = match input
        .slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(text) => Slug::parse(text).map_err(|error| AppError::invalid("slug", error))?,
        None => Slug::from_name(&name).map_err(|error| AppError::invalid("slug", error))?,
    };
    if RESERVED.contains(&slug.as_str()) {
        return Err(AppError::invalid("slug", "is reserved"));
    }
    if !matches!(input.specialty.as_str(), "dental" | "general") {
        return Err(AppError::invalid("specialty", "must be dental or general"));
    }
    let owner_email = Email::parse(&input.owner_email)
        .map_err(|error| AppError::invalid("owner_email", error))?;
    let prefix = NumberPrefix::parse(&number_prefix(&name)).map_err(AppError::patient)?;
    let portal_host = portal_host(portal_host_template, slug.as_str());
    let (token, token_hash) = crate::tokens::new_token()?;
    let expires_at = now + INVITE_VALID_FOR;
    let created = dal::create_clinic(
        db.pool(),
        &dal::NewClinic {
            slug: slug.as_str(),
            name: &name,
            number_prefix: prefix.as_str(),
            specialty: &input.specialty,
            portal_host: &portal_host,
            owner_email: owner_email.as_str(),
            invite_token_hash: &token_hash,
            invite_expires_at: expires_at,
            created_by: staff.user_id.uuid(),
        },
    )
    .await
    .map_err(|error| match error.kind() {
        sakalya_db::DbErrorKind::Conflict => AppError::Conflict("that subdomain is taken"),
        _ => AppError::Db(error),
    })?;
    Ok(CreatedClinic {
        id: created.org_id,
        slug: slug.as_str().to_owned(),
        portal_host,
        invitation_id: created.invitation_id,
        invite_token: token,
        invite_expires_at: expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_come_from_initials() {
        assert_eq!(number_prefix("Sunrise Dental"), "SD");
        assert_eq!(number_prefix("lotus dental care clinic"), "LDC");
        assert_eq!(number_prefix("123 456"), "CL");
    }

    #[test]
    fn portal_host_substitutes_the_slug() {
        assert_eq!(
            portal_host("{slug}.localtest.me", "sunrise"),
            "sunrise.localtest.me"
        );
    }

    #[test]
    fn portal_host_with_no_placeholder_is_unchanged() {
        // A single flat staging host, before a wildcard domain exists.
        assert_eq!(
            portal_host("aarogyam-portal.aarogyam.workers.dev", "sunrise"),
            "aarogyam-portal.aarogyam.workers.dev"
        );
    }
}
