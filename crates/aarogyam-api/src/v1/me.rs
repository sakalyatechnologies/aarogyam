//! Who is signed in: their clinics and sign-in sessions (any host) and the current clinic
//! session (clinic host).

use aarogyam_app::patients as app;
use aarogyam_app::sessions as sessions_app;
use aarogyam_dal::lookups;
use aarogyam_domain::event::Event;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiPath};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

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
}

/// The signed-in person's clinics.
#[derive(Debug, Serialize, ToSchema)]
pub struct Me {
    /// Clinics they are invited to or active in, by name.
    pub clinics: Vec<MyClinic>,
    /// Whether they are active Sakalya staff who can open the console. Central sign-in sends
    /// them there, or offers it first beside their clinics.
    pub console_access: bool,
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
    let (clinics, console_access) =
        lookups::me(state.db().pool(), signed_in.claims.subject().uuid()).await?;
    Ok(Json(Me {
        console_access,
        clinics: clinics
            .into_iter()
            .map(|clinic| MyClinic {
                org_id: clinic.org_id,
                slug: clinic.slug,
                name: clinic.name,
                role_key: clinic.role_key,
                role_name: clinic.role_name,
                host: clinic.host,
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
