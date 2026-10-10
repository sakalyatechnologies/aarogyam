//! Who is signed in: their clinics and sign-in sessions (any host) and the current clinic
//! session (clinic host).

use aarogyam_app::patients as app;
use aarogyam_app::profile::{self as profile_app, ProfileChanges};
use aarogyam_app::sessions as sessions_app;
use aarogyam_dal::lookups;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::ClinicId;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::avatars::{self, Avatar};
use super::rfc3339;
use crate::AppState;
use crate::extract::{ClinicRequest, SignedIn};
use crate::failure::ApiFailure;

/// A clinic the person belongs to.
#[derive(Debug, Serialize, ToSchema)]
pub struct MyClinic {
    /// The clinic.
    #[schema(value_type = String)]
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// The person's role there, such as `doctor`.
    pub role_key: String,
    /// The role's name.
    pub role_name: String,
    /// The clinic portal's host name.
    pub host: Option<String>,
    /// The person's avatar at this clinic; photo links work on the clinic's `host`.
    pub avatar: Option<Avatar>,
}

/// The signed-in person's clinics.
#[derive(Debug, Serialize, ToSchema)]
pub struct Me {
    /// Clinics they are invited to or active in, by name.
    pub clinics: Vec<MyClinic>,
    /// Whether they are active Sakalya staff who can open the console. Central sign-in sends
    /// them there, or offers it first beside their clinics.
    pub console_access: bool,
    /// Whether the console asks Sakalya staff for an authenticator code (`auth.staff_mfa`). The
    /// console reads this to show or skip its second step.
    pub staff_mfa_required: bool,
    /// The person's own name; absent when it could not be read.
    pub display_name: Option<String>,
    /// The person's phone in `E.164`, if recorded.
    pub phone: Option<String>,
}

/// The signed-in person's clinics, for the clinic switcher.
#[utoipa::path(
    get,
    path = "/api/v1/me",
    operation_id = "getMe",
    tag = "session",
    security(("bearer" = [])),
    responses((status = 200, body = Me), (status = 401, description = "Not signed in"))
)]
pub(crate) async fn me(
    State(state): State<AppState>,
    signed_in: SignedIn,
) -> Result<Json<Me>, ApiFailure> {
    let auth_uid = signed_in.claims.subject().uuid();
    let (clinics, console_access) = lookups::me(state.db().pool(), auth_uid).await?;
    let profile = profile_app::get(state.db(), auth_uid).await.ok();
    Ok(Json(Me {
        console_access,
        staff_mfa_required: state.staff_mfa(),
        display_name: profile.as_ref().map(|profile| profile.display_name.clone()),
        phone: profile.and_then(|profile| profile.phone),
        clinics: clinics
            .into_iter()
            .map(|clinic| MyClinic {
                org_id: clinic.org_id,
                slug: clinic.slug,
                name: clinic.name,
                role_key: clinic.role_key,
                role_name: clinic.role_name,
                host: clinic.host,
                avatar: avatars::of(
                    &state,
                    ClinicId::from_uuid(clinic.org_id),
                    clinic.avatar_preset,
                    clinic.avatar_file_id,
                ),
            })
            .collect(),
    }))
}

/// The clinic the portal runs in.
#[derive(Debug, Serialize, ToSchema)]
pub struct SessionClinic {
    /// The clinic.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// IANA time zone.
    pub timezone: String,
    /// Branding (brand colour, theme mode).
    #[schema(value_type = Object)]
    pub branding: serde_json::Value,
}

/// The member's place in the clinic.
#[derive(Debug, Serialize, ToSchema)]
pub struct SessionMembership {
    /// The membership.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Role key, such as `front_desk`.
    pub role_key: String,
    /// Permission keys the role holds, such as `patients.read`.
    pub permissions: Vec<&'static str>,
}

/// The signed-in member.
#[derive(Debug, Serialize, ToSchema)]
pub struct SessionUser {
    /// The user.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Their name.
    pub display_name: String,
    /// Their avatar at this clinic.
    pub avatar: Option<Avatar>,
}

/// The current clinic session.
#[derive(Debug, Serialize, ToSchema)]
pub struct Session {
    /// The clinic.
    pub clinic: SessionClinic,
    /// The membership and its permissions.
    pub membership: SessionMembership,
    /// The member.
    pub user: SessionUser,
}

/// The clinic, member and permissions for this host. The portal hides what the role can't
/// do; the API still enforces it.
#[utoipa::path(
    get,
    path = "/api/v1/session",
    operation_id = "getSession",
    tag = "session",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Session),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn session(
    State(state): State<AppState>,
    request: ClinicRequest,
) -> Result<Json<Session>, ApiFailure> {
    let actor = &request.actor;
    let session = app::session(state.db(), actor, request.request_id).await?;
    Ok(Json(Session {
        clinic: SessionClinic {
            id: session.clinic.id,
            slug: session.clinic.slug,
            name: session.clinic.name,
            timezone: session.clinic.timezone,
            branding: session.clinic.branding,
        },
        membership: SessionMembership {
            id: actor.membership_id.uuid(),
            role_key: actor.role_key.clone(),
            permissions: actor
                .permissions
                .iter()
                .map(aarogyam_domain::permission::Permission::key)
                .collect(),
        },
        user: SessionUser {
            id: actor.user_id.uuid(),
            display_name: session.display_name,
            avatar: avatars::of(
                &state,
                actor.clinic_id,
                session.avatar.preset,
                session.avatar.file_id,
            ),
        },
    }))
}

/// A device or browser where the person is signed in.
#[derive(Debug, Serialize, ToSchema)]
pub struct MySession {
    /// The session.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `clinic`, `patient` or `platform`.
    pub audience: String,
    /// When it was first seen (RFC 3339).
    pub created_at: String,
    /// When it was last used, to within a few minutes (RFC 3339).
    pub last_active_at: String,
    /// When its current token expires (RFC 3339).
    pub expires_at: String,
    /// Whether this is the session making the request.
    pub current: bool,
}

/// The person's active sessions.
#[derive(Debug, Serialize, ToSchema)]
pub struct MySessions {
    /// Most recently used first.
    pub items: Vec<MySession>,
}

/// Where the signed-in person is signed in: their sessions that are neither revoked nor expired.
#[utoipa::path(
    get,
    path = "/api/v1/me/sessions",
    operation_id = "listMySessions",
    tag = "session",
    security(("bearer" = [])),
    responses((status = 200, body = MySessions), (status = 401, description = "Not signed in"))
)]
pub(crate) async fn sessions(
    State(state): State<AppState>,
    signed_in: SignedIn,
) -> Result<Json<MySessions>, ApiFailure> {
    let current = signed_in
        .claims
        .session_id()
        .ok_or_else(ApiError::unauthenticated)?;
    let rows = sessions_app::mine(state.db(), signed_in.claims.subject().uuid(), current).await?;
    Ok(Json(MySessions {
        items: rows
            .into_iter()
            .map(|row| MySession {
                id: row.id,
                audience: row.audience,
                created_at: rfc3339(row.created_at),
                last_active_at: rfc3339(row.last_active_at),
                expires_at: rfc3339(row.expires_at),
                current: row.is_current,
            })
            .collect(),
    }))
}

/// Signs one of the person's own sessions out. Its next request gets `401`, on every host.
#[utoipa::path(
    post,
    path = "/api/v1/me/sessions/{id}/revoke",
    operation_id = "revokeMySession",
    tag = "session",
    params(("id" = String, Path, description = "The session")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Revoked"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not one of the person's sessions")
    )
)]
pub(crate) async fn revoke_session(
    State(state): State<AppState>,
    signed_in: SignedIn,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let provider_session =
        sessions_app::revoke(state.db(), signed_in.claims.subject().uuid(), id).await?;
    state.forget_session(provider_session);
    tracing::info!(event = Event::SessionRevoked.as_str(), session_id = %id, "session revoked");
    Ok(StatusCode::NO_CONTENT)
}

/// The person's own name and phone.
#[derive(Debug, Serialize, ToSchema)]
pub struct Profile {
    /// Their name.
    pub display_name: String,
    /// Their phone in `E.164`, if recorded.
    pub phone: Option<String>,
}

/// Changes to the person's own profile; what is left out stays.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ProfileUpdate {
    /// Their name, 1 to 200 characters.
    pub display_name: Option<String>,
    /// Their phone; +91 is assumed without a country code, and an empty string clears it.
    pub phone: Option<String>,
}

/// Changes the signed-in person's own name and phone. It is theirs across every clinic they
/// belong to; the change history records them as the actor.
#[utoipa::path(
    patch,
    path = "/api/v1/me",
    operation_id = "updateMe",
    tag = "session",
    request_body = ProfileUpdate,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Profile),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 409, description = "Another account holds that phone number")
    )
)]
pub(crate) async fn update_me(
    State(state): State<AppState>,
    signed_in: SignedIn,
    ApiJson(body): ApiJson<ProfileUpdate>,
) -> Result<Json<Profile>, ApiFailure> {
    let profile = profile_app::update(
        state.db(),
        signed_in.claims.subject().uuid(),
        ProfileChanges {
            display_name: body.display_name,
            phone: body.phone,
        },
    )
    .await?;
    tracing::info!(
        event = Event::ProfileChanged.as_str(),
        "own profile changed"
    );
    Ok(Json(Profile {
        display_name: profile.display_name,
        phone: profile.phone,
    }))
}

/// How many sessions a sign-out-everywhere-else ended.
#[derive(Debug, Serialize, ToSchema)]
pub struct RevokedSessions {
    /// Sessions signed out; the current one stays.
    pub revoked: usize,
}

/// Signs out every other session of the person, keeping the one asking. Their next requests get
/// `401`, on every host.
#[utoipa::path(
    post,
    path = "/api/v1/me/sessions/revoke-others",
    operation_id = "revokeOtherSessions",
    tag = "session",
    security(("bearer" = [])),
    responses(
        (status = 200, body = RevokedSessions),
        (status = 401, description = "Not signed in")
    )
)]
pub(crate) async fn revoke_other_sessions(
    State(state): State<AppState>,
    signed_in: SignedIn,
) -> Result<Json<RevokedSessions>, ApiFailure> {
    let current = signed_in
        .claims
        .session_id()
        .ok_or_else(ApiError::unauthenticated)?;
    let revoked =
        sessions_app::revoke_others(state.db(), signed_in.claims.subject().uuid(), current).await?;
    for provider_session in &revoked {
        state.forget_session(*provider_session);
    }
    tracing::info!(
        event = Event::SessionsRevokedOthers.as_str(),
        revoked = revoked.len(),
        "other sessions revoked"
    );
    Ok(Json(RevokedSessions {
        revoked: revoked.len(),
    }))
}
