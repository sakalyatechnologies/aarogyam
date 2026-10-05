//! Joining a clinic by invitation.

use aarogyam_app::invitations as app;
use aarogyam_domain::ids::{ClinicId, MembershipId};
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;
use crate::extract::SignedIn;
use crate::failure::ApiFailure;

/// An invitation to accept.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AcceptInvitation {
    /// The secret from the invitation link.
    pub token: String,
    /// The name to show colleagues, when signing in for the first time.
    pub display_name: Option<String>,
}

/// The clinic just joined.
#[derive(Debug, Serialize, ToSchema)]
pub struct Joined {
    /// The clinic.
    #[schema(value_type = String)]
    pub org_id: Uuid,
    /// The new membership.
    #[schema(value_type = String)]
    pub membership_id: Uuid,
}

/// Accepts an invitation. The person must have signed in with the email address it was sent
/// to; each invitation works once and expires after seven days.
#[utoipa::path(
    post,
    path = "/api/v1/invitations/accept",
    operation_id = "acceptInvitation",
    tag = "session",
    request_body = AcceptInvitation,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Joined),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Unknown, used or expired invitation"),
        (status = 409, description = "The invitation is for another email address")
    )
)]
pub(crate) async fn accept(
    State(state): State<AppState>,
    signed_in: SignedIn,
    ApiJson(body): ApiJson<AcceptInvitation>,
) -> Result<Json<Joined>, ApiFailure> {
    let joined = app::accept(
        state.db(),
        signed_in.claims.subject().uuid(),
        signed_in.claims.email(),
        &body.token,
        body.display_name.as_deref(),
    )
    .await?;
    // Someone rejoining may have a cached answer from when their membership wasn't active.
    state.forget_membership(
        ClinicId::from_uuid(joined.org_id),
        MembershipId::from_uuid(joined.membership_id),
    );
    Ok(Json(Joined {
        org_id: joined.org_id,
        membership_id: joined.membership_id,
    }))
}
