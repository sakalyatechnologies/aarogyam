//! The console's onboarding: clinic applications, a clinic's details, and inviting its staff.
//! Console host only, Sakalya staff only; deciding and inviting need the owner or onboarding
//! role. Never patient data.

use aarogyam_app::onboarding as app;
use aarogyam_domain::access::PlatformRole;
use aarogyam_domain::ids::ClinicId;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::PlatformRequest;
use crate::failure::ApiFailure;

fn require_onboarding(request: &PlatformRequest) -> Result<(), ApiFailure> {
    if request
        .staff
        .role
        .is_some_and(PlatformRole::can_create_clinics)
    {
        Ok(())
    } else {
        Err(ApiError::forbidden("forbidden", "Your console role can't onboard clinics.").into())
    }
}

/// Says when an invited person has no sign-in account yet, so the link alone won't get them in.
fn note_account(state: &AppState, invitation_id: Uuid, account_ready: bool) {
    if !account_ready && state.accounts().is_none() {
        tracing::warn!(
            %invitation_id,
            "Supabase admin is not configured: no sign-in account was created for the invitation"
        );
    }
}

/// Which applications to list.
#[derive(Debug, Deserialize)]
pub struct ApplicationParams {
    /// `pending`, `approved` or `rejected`; all when absent.
    pub status: Option<String>,
}

/// A clinic's application.
#[derive(Debug, Serialize, ToSchema)]
pub struct Application {
    /// The application.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic's name.
    pub clinic_name: String,
    /// Its city.
    pub city: String,
    /// `dental` or `general`.
    pub specialty: String,
    /// Who to contact.
    pub contact_name: String,
    /// Their email.
    pub email: String,
    /// Their phone, E.164.
    pub phone: Option<String>,
    /// What they added.
    pub message: Option<String>,
    /// `pending`, `approved` or `rejected`.
    pub status: String,
    /// Times the address applied while pending.
    pub submissions: i32,
    /// Why it was rejected.
    pub decision_reason: Option<String>,
    /// Who decided.
    pub decided_by: Option<String>,
    /// When (RFC 3339).
    pub decided_at: Option<String>,
    /// The clinic approval created.
    #[schema(value_type = Option<String>)]
    pub clinic_id: Option<Uuid>,
    /// When it arrived (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
}

/// Applications, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct Applications {
    /// At most 500.
    pub items: Vec<Application>,
}

/// Lists clinic applications.
#[utoipa::path(
    get,
    path = "/api/v1/console/applications",
    tag = "console",
    params(("status" = Option<String>, Query, description = "pending, approved or rejected")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Applications),
        (status = 403, description = "Not Sakalya staff"),
        (status = 404, description = "Not the console host")
    )
)]
pub(crate) async fn applications(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<ApplicationParams>,
) -> Result<Json<Applications>, ApiFailure> {
    let rows = app::applications(state.db(), params.status.as_deref()).await?;
    Ok(Json(Applications {
        items: rows
            .into_iter()
            .map(|row| Application {
                id: row.id,
                clinic_name: row.clinic_name,
                city: row.city,
                specialty: row.specialty,
                contact_name: row.contact_name,
                email: row.email,
                phone: row.phone_e164,
                message: row.message,
                status: row.status,
                submissions: row.submissions,
                decision_reason: row.decision_reason,
                decided_by: row.decided_by_name,
                decided_at: row.decided_at.map(rfc3339),
                clinic_id: row.created_org_id,
                created_at: rfc3339(row.created_at),
                updated_at: rfc3339(row.updated_at),
            })
            .collect(),
    }))
}

/// How to approve.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ApproveApplication {
    /// The subdomain; derived from the clinic's name when absent.
    pub slug: Option<String>,
}

/// A clinic created from an application. `invite_link` is shown once; it was also emailed.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApprovedApplication {
    /// The new clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its portal host.
    pub portal_host: String,
    /// The owner's invitation.
    #[schema(value_type = String)]
    pub invitation_id: Uuid,
    /// The invitation link, with its one-time secret.
    pub invite_link: String,
    /// When it expires (RFC 3339).
    pub invite_expires_at: String,
    /// Whether the owner's sign-in account exists in Supabase.
    pub account_ready: bool,
}

/// Approves an application: creates the clinic, the owner's sign-in account and invitation,
/// and emails the invitation.
#[utoipa::path(
    post,
    path = "/api/v1/console/applications/{id}/approve",
    tag = "console",
    params(("id" = String, Path, description = "The application")),
    request_body = ApproveApplication,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ApprovedApplication),
        (status = 400, description = "Invalid subdomain"),
        (status = 403, description = "Not allowed to onboard clinics"),
        (status = 404, description = "No pending application with that id"),
        (status = 409, description = "The subdomain is taken"),
        (status = 503, description = "Supabase could not create the sign-in account")
    )
)]
pub(crate) async fn approve(
    State(state): State<AppState>,
    request: PlatformRequest,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ApproveApplication>,
) -> Result<(StatusCode, Json<ApprovedApplication>), ApiFailure> {
    require_onboarding(&request)?;
    let approved = app::approve(
        state.db(),
        &request.staff,
        state.accounts(),
        id,
        body.slug.as_deref(),
        &state.hosts().portal_domain,
        OffsetDateTime::now_utc(),
    )
    .await?;
    note_account(&state, approved.invitation_id, approved.account_ready);
    tracing::info!(clinic_id = %approved.clinic_id.uuid(), "clinic application approved");
    Ok((
        StatusCode::CREATED,
        Json(ApprovedApplication {
            clinic_id: approved.clinic_id.uuid(),
            invite_link: state
                .notifier()
                .links()
                .invite(&approved.portal_host, &approved.invite_token),
            slug: approved.slug,
            portal_host: approved.portal_host,
            invitation_id: approved.invitation_id,
            invite_expires_at: rfc3339(approved.invite_expires_at),
            account_ready: approved.account_ready,
        }),
    ))
}

/// Why an application is turned down.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct RejectApplication {
    /// A short reason, for the console only.
    pub reason: Option<String>,
}

/// Rejects an application.
#[utoipa::path(
    post,
    path = "/api/v1/console/applications/{id}/reject",
    tag = "console",
    params(("id" = String, Path, description = "The application")),
    request_body = RejectApplication,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Rejected"),
        (status = 403, description = "Not allowed to onboard clinics"),
        (status = 404, description = "No pending application with that id")
    )
)]
pub(crate) async fn reject(
    State(state): State<AppState>,
    request: PlatformRequest,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RejectApplication>,
) -> Result<StatusCode, ApiFailure> {
    require_onboarding(&request)?;
    app::reject(state.db(), &request.staff, id, body.reason.as_deref()).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A member of a clinic's staff.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicMember {
    /// The membership.
    #[schema(value_type = String)]
    pub membership_id: Uuid,
    /// Their name.
    pub display_name: String,
    /// Their sign-in address.
    pub email: Option<String>,
    /// Role key.
    pub role_key: String,
    /// Role name.
    pub role_name: String,
    /// `invited`, `active`, `suspended` or `left`.
    pub status: String,
    /// When they joined (RFC 3339).
    pub joined_at: Option<String>,
}

/// An invitation not yet accepted.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicInvitation {
    /// The invitation.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Who was invited.
    pub email: Option<String>,
    /// Role key.
    pub role_key: String,
    /// Role name.
    pub role_name: String,
    /// When it expires (RFC 3339).
    pub expires_at: String,
    /// When it was sent (RFC 3339).
    pub created_at: String,
}

/// A clinic for the console: details, hosts, counts, staff and open invitations.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicDetail {
    /// The clinic.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// `dental` or `general`.
    pub specialty: String,
    /// `trial`, `active`, `suspended` or `churned`.
    pub status: String,
    /// Its time zone.
    pub timezone: String,
    /// When it was created (RFC 3339).
    pub created_at: String,
    /// Host names, primary first.
    pub hosts: Vec<String>,
    /// Active members.
    pub active_members: i64,
    /// Patients (a count only).
    pub patients: i64,
    /// Open invitations.
    pub pending_invitations: i64,
    /// The staff.
    pub members: Vec<ClinicMember>,
    /// Invitations neither accepted nor expired.
    pub invitations: Vec<ClinicInvitation>,
}

/// One clinic, with its staff. Counts only, never patient data.
#[utoipa::path(
    get,
    path = "/api/v1/console/clinics/{id}",
    tag = "console",
    params(("id" = String, Path, description = "The clinic")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ClinicDetail),
        (status = 403, description = "Not Sakalya staff"),
        (status = 404, description = "No such clinic, or not the console host")
    )
)]
pub(crate) async fn clinic(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ClinicDetail>, ApiFailure> {
    let overview = app::clinic(state.db(), ClinicId::from_uuid(id)).await?;
    let clinic = overview.clinic;
    Ok(Json(ClinicDetail {
        id: clinic.id,
        slug: clinic.slug,
        name: clinic.name,
        specialty: clinic.specialty,
        status: clinic.status,
        timezone: clinic.timezone,
        created_at: rfc3339(clinic.created_at),
        hosts: clinic.hosts,
        active_members: clinic.active_members,
        patients: clinic.patients,
        pending_invitations: clinic.pending_invitations,
        members: overview
            .members
            .into_iter()
            .map(|m| ClinicMember {
                membership_id: m.membership_id,
                display_name: m.display_name,
                email: m.email,
                role_key: m.role_key,
                role_name: m.role_name,
                status: m.status,
                joined_at: m.joined_at.map(rfc3339),
            })
            .collect(),
        invitations: overview
            .invitations
            .into_iter()
            .map(|i| ClinicInvitation {
                id: i.id,
                email: i.email,
                role_key: i.role_key,
                role_name: i.role_name,
                expires_at: rfc3339(i.expires_at),
                created_at: rfc3339(i.created_at),
            })
            .collect(),
    }))
}

/// Someone to invite to a clinic.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewClinicInvitation {
    /// Their email; they sign in with it.
    pub email: String,
    /// A role of the clinic, such as `doctor` or `front_desk`.
    pub role_key: String,
}

/// An invitation just sent. `invite_link` is shown once; it was also emailed.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicInvited {
    /// The invitation.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Who was invited.
    pub email: String,
    /// Their role.
    pub role_key: String,
    /// The invitation link, with its one-time secret.
    pub invite_link: String,
    /// When it expires (RFC 3339).
    pub expires_at: String,
    /// Whether their sign-in account exists in Supabase.
    pub account_ready: bool,
}

/// Invites a doctor or other staff to a clinic: creates their sign-in account and invitation,
/// and emails it.
#[utoipa::path(
    post,
    path = "/api/v1/console/clinics/{id}/invitations",
    tag = "console",
    params(("id" = String, Path, description = "The clinic")),
    request_body = NewClinicInvitation,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ClinicInvited),
        (status = 400, description = "Invalid email or unknown role"),
        (status = 403, description = "Not allowed to onboard clinics"),
        (status = 404, description = "No such clinic"),
        (status = 503, description = "Supabase could not create the sign-in account")
    )
)]
pub(crate) async fn invite(
    State(state): State<AppState>,
    request: PlatformRequest,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewClinicInvitation>,
) -> Result<(StatusCode, Json<ClinicInvited>), ApiFailure> {
    require_onboarding(&request)?;
    let sent = app::invite(
        state.db(),
        &request.staff,
        state.accounts(),
        ClinicId::from_uuid(id),
        aarogyam_app::staff::InviteStaff {
            email: body.email,
            role_key: body.role_key,
        },
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    let invited = sent.invited;
    note_account(&state, invited.id.uuid(), sent.account_ready);
    Ok((
        StatusCode::CREATED,
        Json(ClinicInvited {
            id: invited.id.uuid(),
            invite_link: state
                .notifier()
                .links()
                .invite(&invited.portal_host, &invited.token),
            email: invited.email,
            role_key: invited.role_key,
            expires_at: rfc3339(invited.expires_at),
            account_ready: sent.account_ready,
        }),
    ))
}
