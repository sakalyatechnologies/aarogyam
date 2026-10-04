//! Who is signed in: their clinics (any host) and the current clinic session (clinic host).

use aarogyam_app::patients as app;
use aarogyam_dal::lookups;
use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::extract::{ClinicRequest, SignedIn};
use crate::failure::ApiFailure;

/// A clinic the person belongs to.
#[derive(Debug, Serialize, ToSchema)]
pub struct MyClinic {
    /// The clinic.
    #[schema(value_type = String)]
    pub org_id: uuid::Uuid,
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
}

/// The signed-in person's clinics, for the clinic switcher.
#[utoipa::path(
    get,
    path = "/api/v1/me",
    tag = "session",
    security(("bearer" = [])),
    responses((status = 200, body = Me), (status = 401, description = "Not signed in"))
)]
pub(crate) async fn me(
    State(state): State<AppState>,
    signed_in: SignedIn,
) -> Result<Json<Me>, ApiFailure> {
    let clinics = lookups::my_clinics(state.db().pool(), signed_in.claims.subject().uuid()).await?;
    Ok(Json(Me {
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
    pub id: uuid::Uuid,
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
    pub id: uuid::Uuid,
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
    pub id: uuid::Uuid,
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
