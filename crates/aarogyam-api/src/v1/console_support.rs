//! The console's view of support grants: which clinics have let the signed-in staff member in,
//! why, and until when. The records themselves are read on each clinic's own host.

use aarogyam_app::support as app;
use aarogyam_domain::support::GrantStatus;
use axum::Json;
use axum::extract::State;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::PlatformRequest;
use crate::failure::ApiFailure;

/// A grant the staff member holds.
#[derive(Debug, Serialize, ToSchema)]
pub struct StaffSupportGrant {
    /// The grant.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic.
    #[schema(value_type = String)]
    pub clinic_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub clinic_name: String,
    /// The clinic's portal host, where the records are read.
    pub portal_host: Option<String>,
    /// What it allows: `read`.
    pub access: String,
    /// Why the clinic granted it.
    pub reason: String,
    /// When it started (RFC 3339).
    pub starts_at: String,
    /// When it ends (RFC 3339).
    pub ends_at: String,
    /// `active`, `ended` or `revoked`.
    pub status: String,
    /// The clinic member who granted it.
    pub granted_by: String,
}

/// The grants the staff member holds, newest end first.
#[derive(Debug, Serialize, ToSchema)]
pub struct StaffSupportGrants {
    /// At most 100.
    pub items: Vec<StaffSupportGrant>,
}

/// The support grants clinics have given the signed-in staff member.
#[utoipa::path(
    get,
    path = "/api/v1/console/support-grants",
    operation_id = "listMySupportGrants",
    tag = "console",
    security(("bearer" = [])),
    responses(
        (status = 200, body = StaffSupportGrants),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "Not Sakalya staff, or the authenticator step is missing"),
        (status = 404, description = "Not the console host")
    )
)]
pub(crate) async fn mine(
    State(state): State<AppState>,
    staff: PlatformRequest,
) -> Result<Json<StaffSupportGrants>, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    let rows = app::staff_grants(state.db(), staff.staff.user_id).await?;
    Ok(Json(StaffSupportGrants {
        items: rows
            .into_iter()
            .map(|row| StaffSupportGrant {
                id: row.grant_id,
                clinic_id: row.org_id,
                slug: row.slug,
                clinic_name: row.clinic_name,
                portal_host: row.portal_host,
                access: row.access,
                reason: row.reason,
                starts_at: rfc3339(row.starts_at),
                ends_at: rfc3339(row.ends_at),
                status: GrantStatus::at(row.ends_at, row.revoked_at, now)
                    .as_str()
                    .to_owned(),
                granted_by: row.granted_by_name,
            })
            .collect(),
    }))
}
