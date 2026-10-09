//! Support grants on the clinic host: the owner lets a named Sakalya staff member read the
//! clinic's records for up to seven days, sees what they did, and can end it early.

use aarogyam_app::support::{self as app, GrantView, NewGrant};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::SupportGrantId;
use aarogyam_domain::patient::Email;
use aarogyam_domain::permission::require::SupportGrant;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A grant of read access to one Sakalya staff member.
#[derive(Debug, Serialize, ToSchema)]
pub struct SupportGrantView {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The staff member's name.
    pub staff_name: Option<String>,
    /// Their sign-in email.
    pub staff_email: Option<String>,
    /// What it allows: `read` (records, read-only).
    pub access: String,
    /// Why it was granted.
    pub reason: String,
    /// When it started (RFC 3339).
    pub starts_at: String,
    /// When it ends by itself (RFC 3339).
    pub ends_at: String,
    /// `active`, `ended` or `revoked`.
    pub status: String,
    /// The member who granted it.
    pub granted_by: Option<String>,
    /// When it was revoked (RFC 3339).
    pub revoked_at: Option<String>,
    /// The member who revoked it.
    pub revoked_by: Option<String>,
    /// Requests the staff member made under it.
    pub actions: i64,
    /// When they last used it (RFC 3339).
    pub last_action_at: Option<String>,
}

impl From<GrantView> for SupportGrantView {
    fn from(view: GrantView) -> Self {
        let row = view.row;
        Self {
            id: row.id,
            staff_name: row.staff_name,
            staff_email: row.staff_email,
            access: row.access,
            reason: row.reason,
            starts_at: rfc3339(row.starts_at),
            ends_at: rfc3339(row.ends_at),
            status: view.status.as_str().to_owned(),
            granted_by: row.granted_by_name,
            revoked_at: row.revoked_at.map(rfc3339),
            revoked_by: row.revoked_by_name,
            actions: row.actions,
            last_action_at: row.last_action_at.map(rfc3339),
        }
    }
}

/// The clinic's grants, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct SupportGrantList {
    /// Active, ended and revoked, at most 100.
    pub items: Vec<SupportGrantView>,
}

/// A grant to make.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewSupportGrant {
    /// The Sakalya staff member's sign-in email.
    pub staff_email: String,
    /// Why they need access, 3 to 500 characters. No patient details.
    pub reason: String,
    /// When access ends (RFC 3339): 15 minutes to 7 days from now.
    pub ends_at: String,
}

/// A request made under a grant.
#[derive(Debug, Serialize, ToSchema)]
pub struct SupportAction {
    /// When (RFC 3339).
    pub at: String,
    /// `GET`, `POST` ...
    pub method: String,
    /// The route, such as `/api/v1/patients/{id}`: never a value from it.
    pub route: String,
}

/// What the staff member did under a grant, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct SupportActionList {
    /// At most 200.
    pub items: Vec<SupportAction>,
}

/// The clinic's support grants, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/support-grants",
    operation_id = "listSupportGrants",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = SupportGrantList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks support.grant")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<SupportGrant>,
) -> Result<Json<SupportGrantList>, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    let items = app::list(state.db(), &request.actor, request.request_id, now).await?;
    Ok(Json(SupportGrantList {
        items: items.into_iter().map(SupportGrantView::from).collect(),
    }))
}

/// Lets a Sakalya staff member read the clinic's records from now until `ends_at`, at most
/// seven days. Every request they make under it is recorded; they can't change anything.
#[utoipa::path(
    post,
    path = "/api/v1/support-grants",
    operation_id = "createSupportGrant",
    tag = "settings",
    request_body = NewSupportGrant,
    security(("bearer" = [])),
    responses(
        (status = 201, body = SupportGrantView),
        (status = 400, description = "A bad email, reason or end, or the email isn't Sakalya support staff"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks support.grant"),
        (status = 409, description = "That person already has access; revoke it first")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<SupportGrant>,
    ApiJson(body): ApiJson<NewSupportGrant>,
) -> Result<(StatusCode, Json<SupportGrantView>), ApiFailure> {
    let input = NewGrant {
        staff_email: Email::parse(&body.staff_email)
            .map_err(|_| bad("staff_email", "must be an email address"))?,
        reason: body.reason,
        ends_at: parse_instant("ends_at", &body.ends_at)?,
    };
    let now = OffsetDateTime::now_utc();
    let view = app::grant(state.db(), &request.actor, request.request_id, &input, now).await?;
    tracing::info!(
        event = Event::SupportGranted.as_str(),
        grant_id = %view.row.id,
        platform_user_id = %view.row.platform_user_id,
        "support access granted"
    );
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Ends a grant now.
#[utoipa::path(
    post,
    path = "/api/v1/support-grants/{id}/revoke",
    operation_id = "revokeSupportGrant",
    tag = "settings",
    params(("id" = String, Path, description = "The grant")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = SupportGrantView),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks support.grant"),
        (status = 404, description = "No such grant in this clinic"),
        (status = 409, description = "It already ended or was revoked")
    )
)]
pub(crate) async fn revoke(
    State(state): State<AppState>,
    Require { request, .. }: Require<SupportGrant>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<SupportGrantView>, ApiFailure> {
    let id = SupportGrantId::from_uuid(id);
    let now = OffsetDateTime::now_utc();
    let view = app::revoke(state.db(), &request.actor, request.request_id, id, now).await?;
    tracing::info!(
        event = Event::SupportRevoked.as_str(),
        grant_id = %view.row.id,
        "support access revoked"
    );
    Ok(Json(view.into()))
}

/// What the staff member did under a grant, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/support-grants/{id}/actions",
    operation_id = "listSupportGrantActions",
    tag = "settings",
    params(("id" = String, Path, description = "The grant")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = SupportActionList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks support.grant"),
        (status = 404, description = "No such grant in this clinic")
    )
)]
pub(crate) async fn actions(
    State(state): State<AppState>,
    Require { request, .. }: Require<SupportGrant>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<SupportActionList>, ApiFailure> {
    let id = SupportGrantId::from_uuid(id);
    let rows = app::actions(state.db(), &request.actor, request.request_id, id).await?;
    Ok(Json(SupportActionList {
        items: rows
            .into_iter()
            .map(|row| SupportAction {
                at: rfc3339(row.at),
                method: row.method,
                route: row.route,
            })
            .collect(),
    }))
}
