//! Staff notifications in the outbox job: the reminder and escalation step for booking
//! requests nobody has answered, and the seam where push delivery will plug in.
//!
//! The notification rows themselves are the in-app delivery: the portal polls the feed and the
//! count. Push (FCM for Android, APNs for iOS) becomes another [`StaffChannel`] once the
//! credentials exist; it will carry [`StaffAlert`]'s IDs only, never a patient's name.

use aarogyam_dal::notifications as dal;
use aarogyam_domain::booking::BookingSettings;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ClinicId, InboxMessageId, StaffNotificationId};
use aarogyam_domain::notification::{InboxKind, OpenHours, OpenRequest, ReminderStep, due_step};
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

use crate::Failure;

/// Most open booking requests one run looks at.
const BATCH: i32 = 200;
/// Requests younger than this can't be due: the shortest reminder wait.
const MIN_WAIT_MINUTES: i32 = 5;

/// What staff are alerted to. IDs only: safe for a push payload or a log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaffAlert {
    /// The clinic.
    pub clinic_id: ClinicId,
    /// The notification it is about.
    pub notification_id: StaffNotificationId,
    /// The inbox message the step left.
    pub message_id: InboxMessageId,
    /// A reminder for the clinic, or an escalation for the owners.
    pub kind: InboxKind,
}

/// How staff alerts leave the server, beyond the rows the portal reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaffChannel {
    /// In the portal and the staff app's list: the notification and inbox rows are the
    /// delivery, so nothing more is sent.
    InApp,
}

impl StaffChannel {
    /// The channels in use: in-app only until push credentials exist.
    pub const ACTIVE: &'static [Self] = &[Self::InApp];

    /// The channel's name, for logs.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::InApp => "in_app",
        }
    }

    /// Delivers one alert to the members it is addressed to.
    ///
    /// # Errors
    /// A [`Failure`] when the provider refuses it (none yet: in-app always succeeds).
    pub(crate) fn deliver(
        self,
        _alert: &StaffAlert,
    ) -> impl Future<Output = Result<(), Failure>> + use<> {
        // Push providers will be called over HTTP here; in-app has nothing to send.
        std::future::ready(match self {
            Self::InApp => Ok(()),
        })
    }
}

/// What one reminder run did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReminderReport {
    /// Open booking requests looked at.
    pub open: usize,
    /// Reminders written.
    pub reminded: usize,
    /// Escalations written.
    pub escalated: usize,
}

/// Reminds staff of booking requests nobody has answered, then tells the owners, across
/// clinics, while each clinic is open by its own clock (`hours`: the job passes
/// [`OpenHours::DEFAULT`], 09:00 to 21:00, until clinics set their own). The wait is the
/// clinic's `reminder_minutes`. Each step is recorded once, whatever runs at once.
///
/// # Errors
/// [`DbError`] when the database fails; steps already recorded stay recorded.
pub async fn remind(
    db: &Db,
    now: OffsetDateTime,
    hours: OpenHours,
) -> Result<ReminderReport, DbError> {
    let pool = db.pool();
    let open = dal::open_requests(pool, now, MIN_WAIT_MINUTES, BATCH).await?;
    let mut report = ReminderReport {
        open: open.len(),
        ..ReminderReport::default()
    };
    for request in &open {
        let settings = BookingSettings::from_stored(&request.booking);
        let state = OpenRequest {
            created_at: request.created_at,
            reminded_at: request.reminded_at,
            local_now: request.local_now,
        };
        let Some(step) = due_step(state, now, settings.reminder_minutes, hours) else {
            continue;
        };
        let Some(message) =
            dal::record_step(pool, request.org_id, request.id, step.as_str(), now).await?
        else {
            continue;
        };
        let alert = StaffAlert {
            clinic_id: ClinicId::from_uuid(request.org_id),
            notification_id: StaffNotificationId::from_uuid(request.id),
            message_id: InboxMessageId::from_uuid(message),
            kind: step.inbox_kind(),
        };
        let event = match step {
            ReminderStep::Remind => {
                report.reminded += 1;
                Event::BookingReminded
            }
            ReminderStep::Escalate => {
                report.escalated += 1;
                Event::BookingEscalated
            }
        };
        tracing::info!(
            event = event.as_str(),
            org_id = %request.org_id,
            notification_id = %request.id,
            message_id = %message,
            "booking request {}",
            step.as_str()
        );
        deliver(&alert).await;
    }
    Ok(report)
}

/// Sends an alert through every active channel. The inbox message is already saved, so a
/// channel that fails is logged and the alert is not retried (push will be best effort).
async fn deliver(alert: &StaffAlert) {
    for channel in StaffChannel::ACTIVE {
        if let Err(failure) = channel.deliver(alert).await {
            tracing::warn!(
                org_id = %alert.clinic_id.uuid(),
                message_id = %alert.message_id.uuid(),
                channel = channel.name(),
                reason = %failure.reason,
                "staff alert not delivered"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_in_app_delivery_is_active_until_push_credentials_exist() {
        assert_eq!(StaffChannel::ACTIVE, [StaffChannel::InApp]);
        assert_eq!(StaffChannel::InApp.name(), "in_app");
    }
}

/// How long a queue token waits before staff are told, in minutes.
pub const WAITING_MINUTES: i32 = 15;

/// What one run of the follow-up and waiting-patient step did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FlagReport {
    /// `recall_due` alerts written.
    pub recalls: i32,
    /// `patient_waiting` alerts written.
    pub waiting: i32,
}

/// Writes the alerts nothing else triggers: a follow-up that fell due (unless the clinic
/// switched `recall` off) and a patient who has waited [`WAITING_MINUTES`] in the queue. Each is
/// written once, whatever runs at once.
///
/// # Errors
/// [`DbError`] when the database fails; alerts already written stay written.
pub async fn flag_alerts(db: &Db, now: OffsetDateTime) -> Result<FlagReport, DbError> {
    let pool = db.pool();
    let recalls = dal::flag_due_recalls(pool, now, BATCH).await?;
    let waiting = dal::flag_waiting_tokens(pool, now, WAITING_MINUTES, BATCH).await?;
    Ok(FlagReport { recalls, waiting })
}
