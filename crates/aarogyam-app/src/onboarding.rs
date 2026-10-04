//! Clinics joining Aarogyam: applications from the public landing page, the console's
//! decisions on them, and the console inviting staff to a clinic. Every invitation also makes
//! sure the invited address has a sign-in account, since sign-ups are off.

use aarogyam_dal::applications::{self as dal, Approval, Approved};
use aarogyam_dal::console as console_dal;
use aarogyam_dal::lookups::PlatformAccess;
use aarogyam_domain::ids::ClinicId;
use aarogyam_domain::onboarding::ApplicationStatus;
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::patient::{Email, NumberPrefix};
use sakalya_db::{ActorKind, Db, Scope};
use sakalya_types::{CallingCode, PhoneE164, Slug};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::accounts::SignInAccounts;
use crate::clock::clinic_offset;
use crate::console::{INVITE_VALID_FOR, number_prefix, slug_for};
use crate::error::AppError;
use crate::staff::{InviteStaff, Invited, invite_in_scope};

// Evaluated at compile time: a bad literal fails the build, never a request.
const SUPPORT: ActorKind = match ActorKind::new("support") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

/// The time zone new clinics start in.
const DEFAULT_TIMEZONE: &str = "Asia/Kolkata";

/// An application from the public form, as received.
#[derive(Debug, Clone, Default)]
pub struct Registration {
    /// The clinic's name.
    pub clinic_name: String,
    /// Its city.
    pub city: String,
    /// `dental` (default) or `general`.
    pub specialty: Option<String>,
    /// Who to contact.
    pub contact_name: String,
    /// Their email.
    pub email: String,
    /// Their phone.
    pub phone: Option<String>,
    /// Anything they want to add.
    pub message: Option<String>,
}

fn text(field: &'static str, value: &str, max: usize) -> Result<String, AppError> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::invalid(
            field,
            format!("must be 1 to {max} characters"),
        ));
    }
    Ok(value)
}

fn specialty(value: Option<&str>) -> Result<&'static str, AppError> {
    match value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("dental")
    {
        "dental" => Ok("dental"),
        "general" => Ok("general"),
        _ => Err(AppError::invalid("specialty", "must be dental or general")),
    }
}

/// Records an application. Says nothing about whether the address applied before or already
/// uses Aarogyam; a second application from a pending address replaces the first.
///
/// # Errors
/// [`AppError::Invalid`] for bad input; [`AppError::Db`] on database failures.
pub async fn register(db: &Db, input: Registration) -> Result<(), AppError> {
    let clinic_name = text("clinic_name", &input.clinic_name, 200)?;
    let city = text("city", &input.city, 100)?;
    let contact_name = text("contact_name", &input.contact_name, 200)?;
    let specialty = specialty(input.specialty.as_deref())?;
    let email = Email::parse(&input.email).map_err(|error| AppError::invalid("email", error))?;
    let phone = input
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|raw| PhoneE164::parse_with_default(raw, CallingCode::INDIA))
        .transpose()
        .map_err(|_| AppError::invalid("phone", "must be a phone number"))?;
    let message = input
        .message
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if message.is_some_and(|m| m.chars().count() > 2000) {
        return Err(AppError::invalid(
            "message",
            "must be at most 2000 characters",
        ));
    }
    dal::submit(
        db.pool(),
        &dal::NewApplication {
            clinic_name: &clinic_name,
            city: &city,
            specialty,
            contact_name: &contact_name,
            email: email.as_str(),
            phone_e164: phone.as_ref().map(PhoneE164::as_e164),
            message,
        },
    )
    .await?;
    Ok(())
}

pub use aarogyam_dal::applications::ApplicationRow;

/// Applications with `status`, or all, newest first.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown status; [`AppError::Db`] on database failures.
pub async fn applications(db: &Db, status: Option<&str>) -> Result<Vec<ApplicationRow>, AppError> {
    let status = status
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            ApplicationStatus::parse(s)
                .ok_or_else(|| AppError::invalid("status", "must be pending, approved or rejected"))
        })
        .transpose()?;
    Ok(dal::list(db.pool(), status.map(ApplicationStatus::as_str)).await?)
}

/// A clinic approved from an application. The token is shown once and emailed.
#[derive(Debug, Clone)]
pub struct ApprovedClinic {
    /// The new clinic.
    pub clinic_id: ClinicId,
    /// Its subdomain.
    pub slug: String,
    /// Its portal host.
    pub portal_host: String,
    /// The owner's invitation.
    pub invitation_id: Uuid,
    /// The invitation secret.
    pub invite_token: String,
    /// When it expires.
    pub invite_expires_at: OffsetDateTime,
    /// Whether the owner's sign-in account was made sure of (false when Supabase isn't set up).
    pub account_ready: bool,
}

fn expires_on(at: OffsetDateTime, timezone: &str) -> String {
    let day = at.to_offset(clinic_offset(timezone)).date();
    format!("{} {} {}", day.day(), day.month(), day.year())
}

/// Approves a pending application: makes sure the contact can sign in, then creates the
/// clinic with its owner's invitation and queues the invitation email, in one transaction.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't pending; [`AppError::Invalid`] for a bad slug;
/// [`AppError::Conflict`] for a taken subdomain; [`AppError::Accounts`] when Supabase fails;
/// [`AppError::Db`] on database failures.
pub async fn approve(
    db: &Db,
    staff: &PlatformAccess,
    accounts: Option<&dyn SignInAccounts>,
    id: Uuid,
    slug: Option<&str>,
    portal_domain: &str,
    now: OffsetDateTime,
) -> Result<ApprovedClinic, AppError> {
    let application = dal::list(db.pool(), Some(ApplicationStatus::Pending.as_str()))
        .await?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or(AppError::NotFound("application"))?;
    let slug: Slug = slug_for(&application.clinic_name, slug)?;
    let prefix =
        NumberPrefix::parse(&number_prefix(&application.clinic_name)).map_err(AppError::patient)?;
    let email =
        Email::parse(&application.email).map_err(|error| AppError::invalid("email", error))?;
    let account_ready = match accounts {
        Some(accounts) => {
            accounts.ensure_user(&email).await?;
            true
        }
        None => false,
    };
    let portal_host = format!("{}.{portal_domain}", slug.as_str());
    let (token, token_hash) = crate::tokens::new_token()?;
    let expires_at = now + INVITE_VALID_FOR;
    let payload = json!({
        "clinic_name": application.clinic_name,
        "role_name": "Owner",
        "portal_host": portal_host,
        "expires_on": expires_on(expires_at, DEFAULT_TIMEZONE),
    });
    let outcome = dal::approve(
        db.pool(),
        &Approval {
            id,
            slug: slug.as_str(),
            number_prefix: prefix.as_str(),
            portal_host: &portal_host,
            invite_token_hash: &token_hash,
            invite_expires_at: expires_at,
            decided_by: staff.user_id.uuid(),
            message_id: Uuid::now_v7(),
            message_event: MessageKind::StaffInvited.as_str(),
            message_payload: &payload,
            message_secret: &token,
        },
    )
    .await
    .map_err(|error| match error.kind() {
        sakalya_db::DbErrorKind::Conflict => AppError::Conflict("that subdomain is taken"),
        _ => AppError::Db(error),
    })?;
    match outcome {
        Approved::Created {
            org_id,
            invitation_id,
        } => Ok(ApprovedClinic {
            clinic_id: ClinicId::from_uuid(org_id),
            slug: slug.as_str().to_owned(),
            portal_host,
            invitation_id,
            invite_token: token,
            invite_expires_at: expires_at,
            account_ready,
        }),
        Approved::NotPending => Err(AppError::NotFound("application")),
    }
}

/// Rejects a pending application.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't pending; [`AppError::Invalid`] for a long reason;
/// [`AppError::Db`] on database failures.
pub async fn reject(
    db: &Db,
    staff: &PlatformAccess,
    id: Uuid,
    reason: Option<&str>,
) -> Result<(), AppError> {
    let reason = reason.map(str::trim).filter(|s| !s.is_empty());
    if reason.is_some_and(|r| r.chars().count() > 500) {
        return Err(AppError::invalid(
            "reason",
            "must be at most 500 characters",
        ));
    }
    if dal::reject(db.pool(), id, reason, staff.user_id.uuid()).await? {
        Ok(())
    } else {
        Err(AppError::NotFound("application"))
    }
}

/// One clinic for the console: details, members and open invitations. No patient data.
#[derive(Debug, Clone)]
pub struct ClinicOverview {
    /// The clinic, its hosts and counts.
    pub clinic: console_dal::ClinicDetail,
    /// Its members.
    pub members: Vec<console_dal::ClinicMember>,
    /// Invitations neither accepted nor expired.
    pub invitations: Vec<console_dal::ClinicInvitation>,
}

/// A clinic for the console.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown clinic; [`AppError::Db`] on database failures.
pub async fn clinic(db: &Db, clinic_id: ClinicId) -> Result<ClinicOverview, AppError> {
    let clinic = console_dal::clinic(db.pool(), clinic_id.uuid())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    let members = console_dal::clinic_members(db.pool(), clinic_id.uuid()).await?;
    let invitations = console_dal::clinic_invitations(db.pool(), clinic_id.uuid()).await?;
    Ok(ClinicOverview {
        clinic,
        members,
        invitations,
    })
}

/// An invitation the console sent.
#[derive(Debug, Clone)]
pub struct ConsoleInvited {
    /// The invitation; its token is shown once.
    pub invited: Invited,
    /// Whether the person's sign-in account was made sure of.
    pub account_ready: bool,
}

/// Invites someone to a clinic with one of its roles, from the console: makes sure they can
/// sign in, then creates the invitation and queues its email in the clinic's transaction.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown clinic; [`AppError::Invalid`] for a bad email or a
/// role the clinic doesn't have; [`AppError::Accounts`] when Supabase fails;
/// [`AppError::Db`] on database failures.
pub async fn invite(
    db: &Db,
    staff: &PlatformAccess,
    accounts: Option<&dyn SignInAccounts>,
    clinic_id: ClinicId,
    input: InviteStaff,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<ConsoleInvited, AppError> {
    let email = Email::parse(&input.email).map_err(|error| AppError::invalid("email", error))?;
    let role_key = input.role_key.trim();
    if role_key.is_empty() {
        return Err(AppError::invalid("role_key", "is required"));
    }
    if console_dal::clinic(db.pool(), clinic_id.uuid())
        .await?
        .is_none()
    {
        return Err(AppError::NotFound("clinic"));
    }
    let scope = Scope::tenant(clinic_id.uuid())
        .with_user(staff.user_id.uuid())
        .with_actor_kind(SUPPORT);
    let scope = match request_id {
        Some(id) => scope.with_request_id(id),
        None => scope,
    };
    // The role is checked before an account is made for someone who can't be invited.
    let role_known = db
        .scoped(&scope, async |tx| {
            Ok::<_, AppError>(
                aarogyam_dal::staff::role_by_key(tx.conn(), role_key)
                    .await?
                    .is_some(),
            )
        })
        .await?;
    if !role_known {
        return Err(AppError::invalid(
            "role_key",
            "is not a role in this clinic",
        ));
    }
    let account_ready = match accounts {
        Some(accounts) => {
            accounts.ensure_user(&email).await?;
            true
        }
        None => false,
    };
    let invited = invite_in_scope(
        db,
        &scope,
        staff.user_id.uuid(),
        email,
        role_key.to_owned(),
        now,
    )
    .await?;
    Ok(ConsoleInvited {
        invited,
        account_ready,
    })
}
