//! Staff notifications in the outbox job: the reminder and escalation step for booking
//! requests nobody has answered, and the channels an alert leaves through.
//!
//! The notification rows themselves are the in-app delivery: the portal polls the feed and the
//! count. Push (FCM for Android, APNs for iOS, `push.rs`) is another [`StaffChannel`]: it
//! carries [`StaffAlert`]'s IDs only, never a patient's name, and does nothing until push keys
//! are configured. A new staff notification is pushed by the push step ([`Push::run`]), which
//! claims the rows; only the reminder and escalation alerts, which write no new notification
//! row, come through this channel.

use aarogyam_dal::notifications as dal;
use aarogyam_domain::booking::BookingSettings;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ClinicId, InboxMessageId, StaffNotificationId};
use aarogyam_domain::notification::{InboxKind, OpenHours, OpenRequest, ReminderStep, due_step};
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

use crate::Failure;
use crate::push::Push;

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
    /// A push notification to the staff devices of the members the alert is for: APNs and FCM,
    /// each only once its keys are configured.
    Push,
}

impl StaffChannel {
    /// The channels in use: in-app always, push when it has a provider (it skips itself
    /// otherwise).
    pub const ACTIVE: &'static [Self] = &[Self::InApp, Self::Push];

    /// The channel's name, for logs.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::InApp => "in_app",
            Self::Push => "push",
        }
    }

    /// Delivers one alert to the members it is addressed to.
    ///
    /// # Errors
    /// A [`Failure`] when the recipients can't be worked out (in-app always succeeds). A
    /// provider that refuses a push is logged by device and is not a failure here.
    pub(crate) async fn deliver(
        self,
        db: &Db,
        push: &Push,
        alert: &StaffAlert,
    ) -> Result<(), Failure> {
        match self {
            Self::InApp => Ok(()),
            Self::Push => push
                .alert(db, alert)
                .await
                .map(|_| ())
                .map_err(|_| Failure::retryable("could not work out who to push to")),
        }
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
    remind_with(db, now, hours, &Push::off()).await
}

/// [`remind`], also pushing each reminder and escalation through `push`.
///
/// # Errors
/// [`DbError`] when the database fails; steps already recorded stay recorded.
pub async fn remind_with(
    db: &Db,
    now: OffsetDateTime,
    hours: OpenHours,
    push: &Push,
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
        deliver(db, push, &alert).await;
    }
    Ok(report)
}

/// Sends an alert through every active channel. The inbox message is already saved, so a
/// channel that fails is logged and the alert is not retried (push will be best effort).
async fn deliver(db: &Db, push: &Push, alert: &StaffAlert) {
    for channel in StaffChannel::ACTIVE {
        if let Err(failure) = channel.deliver(db, push, alert).await {
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
    fn in_app_and_push_are_the_channels() {
        assert_eq!(
            StaffChannel::ACTIVE,
            [StaffChannel::InApp, StaffChannel::Push]
        );
        assert_eq!(StaffChannel::InApp.name(), "in_app");
        assert_eq!(StaffChannel::Push.name(), "push");
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
    /// Appointments marked no-show.
    pub no_shows: i32,
    /// Stale queue tokens closed.
    pub tokens_closed: i32,
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
    let no_shows = dal::auto_no_show(pool, now, BATCH).await?;
    let tokens_closed = dal::close_stale_tokens(pool, now, BATCH).await?;
    Ok(FlagReport {
        recalls,
        waiting,
        no_shows,
        tokens_closed,
    })
}
