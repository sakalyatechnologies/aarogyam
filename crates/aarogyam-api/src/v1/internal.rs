//! Internal jobs, run on a schedule rather than by people.
//!
//! For now these exist only in the local environment, like the development sign-in. Before
//! they are deployed, Cloud Scheduler will call them with a Google-signed OIDC token whose
//! audience and service account the API checks, and they will refuse every other caller.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::AppState;
use crate::failure::ApiFailure;

/// What one drain did.
#[derive(Debug, Serialize, ToSchema)]
pub struct DrainReport {
    /// `resend`, or `log` when no Resend key is configured.
    pub email_provider: &'static str,
    /// Messages claimed.
    pub claimed: usize,
    /// Delivered.
    pub sent: usize,
    /// Failed, to be tried again later.
    pub retrying: usize,
    /// Failed for the last time.
    pub failed: usize,
    /// Old processed messages deleted.
    pub purged: i64,
}

/// Delivers due outbox messages across clinics (local development only; later Cloud
/// Scheduler with a Google-signed token).
#[utoipa::path(
    post,
    path = "/api/v1/internal/outbox/drain",
    operation_id = "drainOutbox",
    tag = "internal",
    responses((status = 200, body = DrainReport))
)]
pub(crate) async fn drain_outbox(
    State(state): State<AppState>,
) -> Result<Json<DrainReport>, ApiFailure> {
    let notifier = state.notifier();
    let report = notifier
        .drain(state.db(), OffsetDateTime::now_utc())
        .await?;
    Ok(Json(DrainReport {
        email_provider: notifier.email_provider(),
        claimed: report.claimed,
        sent: report.sent,
        retrying: report.retrying,
        failed: report.failed,
        purged: report.purged,
    }))
}
