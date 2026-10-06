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
pub(crate) fn number_prefix(name: &str) -> String {
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

/// The subdomain: `slug` when given, else derived from the clinic's name; never a reserved one.
pub(crate) fn slug_for(name: &str, slug: Option<&str>) -> Result<Slug, AppError> {
    let slug = match slug.map(str::trim).filter(|s| !s.is_empty()) {
        Some(text) => Slug::parse(text).map_err(|error| AppError::invalid("slug", error))?,
        None => Slug::from_name(name).map_err(|error| AppError::invalid("slug", error))?,
    };
    if RESERVED.contains(&slug.as_str()) {
        return Err(AppError::invalid("slug", "is reserved"));
    }
    Ok(slug)
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
    let slug = slug_for(&name, input.slug.as_deref())?;
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

/// The longest suggested slug: what the console's address field accepts.
const SUGGESTION_MAX: usize = 30;
/// Characters for a suggestion's suffix: no `0`/`o` or `1`/`l` look-alikes.
const SUFFIX_CHARS: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";

/// Whether a clinic address is free, and free ones to offer when it isn't.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlugCheck {
    /// The slug checked: the one typed, or the one derived from the name.
    pub slug: String,
    /// Free to use.
    pub available: bool,
    /// Why it can't be used when it is malformed or reserved.
    pub problem: Option<String>,
    /// Free alternatives, best first: `<name>-<city>`, then short suffixes.
    pub suggestions: Vec<String>,
}

/// `base` cut so that `base-<tail>` fits [`SUGGESTION_MAX`], on a hyphen when possible.
fn with_tail(base: &str, tail: &str) -> String {
    let room = SUGGESTION_MAX.saturating_sub(tail.len() + 1);
    let mut cut = base.get(..room.min(base.len())).unwrap_or(base).to_owned();
    if cut.len() < base.len()
        && let Some(boundary) = cut.rfind('-').filter(|&at| at > 0)
    {
        cut.truncate(boundary);
    }
    format!("{}-{tail}", cut.trim_end_matches('-'))
}

/// Three-character suffixes from `bytes`.
fn suffixes(bytes: &[u8]) -> Vec<String> {
    bytes
        .chunks(3)
        .map(|chunk| {
            chunk
                .iter()
                .map(|b| char::from(SUFFIX_CHARS[usize::from(*b) % SUFFIX_CHARS.len()]))
                .collect()
        })
        .collect()
}

/// The candidates after `base`: with the city's slug, then with random suffixes. Only valid,
/// unreserved slugs.
fn candidates(base: &str, city: Option<&str>, random: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(city) = city.and_then(|c| Slug::from_name(c).ok())
        && !base.ends_with(city.as_str())
    {
        out.push(with_tail(base, city.as_str()));
    }
    out.extend(
        suffixes(random)
            .iter()
            .map(|suffix| with_tail(base, suffix)),
    );
    out.retain(|text| {
        Slug::parse(text).is_ok() && !RESERVED.contains(&text.as_str()) && text != base
    });
    out.dedup();
    out
}

/// Checks a clinic address for the console's approve form: the typed `slug`, or the one
/// derived from `name`; when it is taken, up to three free alternatives.
///
/// # Errors
/// [`AppError::Internal`] if the random number generator fails; [`AppError::Db`] on database
/// failures.
pub async fn check_slug(
    db: &Db,
    name: &str,
    slug: Option<&str>,
    city: Option<&str>,
) -> Result<SlugCheck, AppError> {
    let typed = slug.map(str::trim).filter(|s| !s.is_empty());
    let (base, problem) = match slug_for(name, typed) {
        Ok(slug) => (slug.as_str().to_owned(), None),
        Err(AppError::Invalid { message, .. }) => {
            // Suggest from the name instead, when the typed text can't be used.
            let fallback = slug_for(name, None).map(|s| s.as_str().to_owned()).ok();
            return Ok(SlugCheck {
                slug: typed.unwrap_or_default().to_owned(),
                available: false,
                problem: Some(message),
                suggestions: fallback.into_iter().collect(),
            });
        }
        Err(other) => return Err(other),
    };
    let mut random = [0_u8; 9];
    aws_lc_rs::rand::fill(&mut random)
        .map_err(|_| AppError::Internal("random number generator failed"))?;
    let alternatives = candidates(&base, city, &random);
    let mut asked = vec![base.clone()];
    asked.extend(alternatives.iter().cloned());
    let taken = dal::slugs_taken(db.pool(), &asked).await?;
    let available = !taken.contains(&base);
    let suggestions = if available {
        Vec::new()
    } else {
        alternatives
            .into_iter()
            .filter(|s| !taken.contains(s))
            .take(3)
            .collect()
    };
    Ok(SlugCheck {
        slug: base,
        available,
        problem,
        suggestions,
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
    fn suggestions_add_the_city_then_short_suffixes_and_fit_the_field() {
        let found = candidates("sunrise-dental", Some("Pune"), &[0, 1, 2, 3, 4, 5]);
        assert_eq!(
            found,
            [
                "sunrise-dental-pune",
                "sunrise-dental-abc",
                "sunrise-dental-def"
            ]
        );
        let long = candidates(
            "dr-mehtas-dental-implant-centre",
            Some("Navi Mumbai"),
            &[9, 9, 9],
        );
        assert!(long.iter().all(|s| s.len() <= SUGGESTION_MAX), "{long:?}");
        assert_eq!(long[0], "dr-mehtas-dental-navi-mumbai");
        // No city suffix twice, and nothing reserved or malformed.
        assert_eq!(
            candidates("lotus-pune", Some("pune"), &[]),
            Vec::<String>::new()
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
