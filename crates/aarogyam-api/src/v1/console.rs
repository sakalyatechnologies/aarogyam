//! Sakalya's console: clinics and service health. Console host only, Sakalya staff only.

use std::time::SystemTime;

use aarogyam_app::console::{self as app, CreateClinic};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::PlatformRequest;
use crate::failure::ApiFailure;
use crate::metrics::Range;

/// A clinic, with counts only.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsoleClinic {
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
    /// When it was created (RFC 3339).
    pub created_at: String,
    /// The portal host name.
    pub portal_host: Option<String>,
    /// Members with an active membership.
    pub active_members: i64,
    /// Patients, excluding deleted records.
    pub patients: i64,
}

/// Every clinic.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsoleClinics {
    /// Newest first.
    pub items: Vec<ConsoleClinic>,
}

/// Lists every clinic with member and patient counts.
#[utoipa::path(
    get,
    path = "/api/v1/console/clinics",
    tag = "console",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ConsoleClinics),
        (status = 403, description = "Not Sakalya staff"),
        (status = 404, description = "Not the console host")
    )
)]
pub(crate) async fn clinics(
    State(state): State<AppState>,
    _staff: PlatformRequest,
) -> Result<Json<ConsoleClinics>, ApiFailure> {
    let rows = app::clinics(state.db()).await?;
    Ok(Json(ConsoleClinics {
        items: rows
            .into_iter()
            .map(|row| ConsoleClinic {
                id: row.id,
                slug: row.slug,
                name: row.name,
                specialty: row.specialty,
                status: row.status,
                created_at: rfc3339(row.created_at),
                portal_host: row.portal_host,
                active_members: row.active_members,
                patients: row.patients,
            })
            .collect(),
    }))
}

/// A clinic to create.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewClinic {
    /// The clinic's name.
    pub name: String,
    /// The subdomain; derived from the name when absent.
    pub slug: Option<String>,
    /// `dental` (default) or `general`.
    pub specialty: Option<String>,
    /// The owner's email; they are invited as the clinic owner.
    pub owner_email: String,
}

/// A clinic just created. `invite_token` is shown once; only its hash is stored.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreatedClinic {
    /// The clinic.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its portal host name.
    pub portal_host: String,
    /// The owner's invitation.
    #[schema(value_type = String)]
    pub invitation_id: Uuid,
    /// The invitation secret, for the link sent to the owner.
    pub invite_token: String,
    /// When the invitation expires (RFC 3339).
    pub invite_expires_at: String,
}

/// Creates a clinic and invites its owner. Owner and onboarding staff only.
#[utoipa::path(
    post,
    path = "/api/v1/console/clinics",
    tag = "console",
    request_body = NewClinic,
    security(("bearer" = [])),
    responses(
        (status = 201, body = CreatedClinic),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 403, description = "Not allowed to create clinics"),
        (status = 409, description = "The subdomain is taken")
    )
)]
pub(crate) async fn create_clinic(
    State(state): State<AppState>,
    request: PlatformRequest,
    ApiJson(body): ApiJson<NewClinic>,
) -> Result<(StatusCode, Json<CreatedClinic>), ApiFailure> {
    if !request
        .staff
        .role
        .is_some_and(aarogyam_domain::access::PlatformRole::can_create_clinics)
    {
        return Err(
            ApiError::forbidden("forbidden", "Your console role can't create clinics.").into(),
        );
    }
    let created = app::create_clinic(
        state.db(),
        &request.staff,
        CreateClinic {
            name: body.name,
            slug: body.slug,
            specialty: body.specialty.unwrap_or_else(|| "dental".to_owned()),
            owner_email: body.owner_email,
        },
        &state.hosts().portal_domain,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(CreatedClinic {
            id: created.id,
            slug: created.slug,
            portal_host: created.portal_host,
            invitation_id: created.invitation_id,
            invite_token: created.invite_token,
            invite_expires_at: rfc3339(created.invite_expires_at),
        }),
    ))
}

/// Which window of service metrics to show.
#[derive(Debug, Deserialize)]
pub struct MetricsParams {
    /// `1h` (default), `24h` or `7d`.
    pub range: Option<String>,
}

/// Service health for the console dashboard.
#[derive(Debug, Serialize, ToSchema)]
pub struct ServiceMetrics {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The window: `1h`, `24h` or `7d`.
    pub range: String,
    /// This instance's API requests, error rates and latency.
    #[schema(value_type = Object)]
    pub api: Option<serde_json::Value>,
    /// Database connections, cache hit ratio, size, tables and slow statements.
    #[schema(value_type = Object)]
    pub db: serde_json::Value,
    /// Edge and front-end numbers from Cloudflare; `null` until connected.
    #[schema(value_type = Object)]
    pub edge: Option<serde_json::Value>,
}

/// Service health: API, database and edge.
#[utoipa::path(
    get,
    path = "/api/v1/console/metrics",
    tag = "console",
    params(("range" = Option<String>, Query, description = "1h (default), 24h or 7d")),
    security(("bearer" = [])),
    responses((status = 200, body = ServiceMetrics), (status = 403, description = "Not Sakalya staff"))
)]
pub(crate) async fn metrics(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<MetricsParams>,
) -> Result<Json<ServiceMetrics>, ApiFailure> {
    let range: Range = params
        .range
        .as_deref()
        .unwrap_or("1h")
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_request", "range: must be 1h, 24h or 7d"))?;
    let db = aarogyam_dal::console::db_health(state.db().pool()).await?;
    let api = serde_json::to_value(state.metrics().snapshot(range, SystemTime::now()))
        .map_err(ApiError::internal)?;
    Ok(Json(ServiceMetrics {
        generated_at: rfc3339(OffsetDateTime::now_utc()),
        range: range.as_str().to_owned(),
        api: Some(api),
        db,
        edge: None,
    }))
}
