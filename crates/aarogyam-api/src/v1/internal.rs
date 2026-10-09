//! Internal jobs, run on a schedule rather than by people.
//!
//! For now these exist only in the local environment, like the development sign-in. Before
//! they are deployed, Cloud Scheduler will call them with a Google-signed OIDC token whose
//! audience and service account the API checks, and they will refuse every other caller.

use aarogyam_domain::notification::OpenHours;
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
    /// How portal hosts are made to work: `off`, `wildcard` or `workers_dev`.
    pub address_provider: &'static str,
    /// Portal hosts made to work, run before the messages so invitation links work.
    pub addresses_ready: usize,
    /// Portal hosts that failed and will be tried again.
    pub addresses_retrying: usize,
    /// Portal hosts that failed for the last time.
    pub addresses_failed: usize,
    /// Booking requests nobody has answered that were looked at.
    pub booking_requests_open: usize,
    /// Reminders written to the clinic inbox.
    pub booking_requests_reminded: usize,
    /// Escalations written to the owners' inbox.
    pub booking_requests_escalated: usize,
    /// Appointment reminders queued for patients.
    pub reminders_queued: i32,
    /// Patient messages claimed to send now.
    pub messages_claimed: usize,
    /// Patient messages sent.
    pub messages_sent: usize,
    /// Patient messages not sent, for a reason (consent, an opt-out, no address).
    pub messages_skipped: usize,
    /// Patient messages put back: quiet hours, or a reminder whose appointment moved.
    pub messages_rescheduled: usize,
    /// Patient messages moved to tomorrow because the daily email budget was spent.
    pub messages_deferred: usize,
    /// Patient messages that failed and will be tried again.
    pub messages_retrying: usize,
    /// Patient messages that failed for the last time.
    pub messages_failed: usize,
}

/// Makes new portal hosts work, reminds staff of unanswered booking requests (then the
/// owners), delivers due outbox messages, then queues appointment reminders and sends due
/// patient messages across clinics (local development only; later Cloud
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
    let addresses = state.addresses();
    let hosts = addresses
        .provision(state.db(), OffsetDateTime::now_utc())
        .await?;
    let reminders =
        aarogyam_notify::remind(state.db(), OffsetDateTime::now_utc(), OpenHours::DEFAULT).await?;
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
        address_provider: addresses.name(),
        addresses_ready: hosts.ready,
        addresses_retrying: hosts.retrying,
        addresses_failed: hosts.failed,
        booking_requests_open: reminders.open,
        booking_requests_reminded: reminders.reminded,
        booking_requests_escalated: reminders.escalated,
        reminders_queued: report.messages.reminders_queued,
        messages_claimed: report.messages.claimed,
        messages_sent: report.messages.sent,
        messages_skipped: report.messages.skipped,
        messages_rescheduled: report.messages.rescheduled,
        messages_deferred: report.messages.deferred,
        messages_retrying: report.messages.retrying,
        messages_failed: report.messages.failed,
    }))
}
