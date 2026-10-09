//! Staff notifications about online bookings: written in the booking's or the cancellation's
//! transaction, marked handled in the status change's, and read per member. A member sees a
//! notification when their role has `appointments.read` and its scope reaches the appointment's
//! doctor. IDs, times and the doctor only: never the patient's name or reason.

use aarogyam_dal::appointments::AppointmentRow;
use aarogyam_dal::notifications::{self as dal, FeedRow, InboxRow, Viewer};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{
    AppointmentId, InboxMessageId, MembershipId, PractitionerId, StaffNotificationId,
};
use aarogyam_domain::notification::{
    Audience, InboxKind, NotificationKind, UNREAD_CAP, UNREAD_WINDOW_DAYS, addressed_to, page_size,
};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{AppointmentStatus, BookingSource};
use sakalya_db::{Db, ScopedTx};
use time::{OffsetDateTime, UtcOffset};
use uuid::Uuid;

use crate::clock::clinic_offset;
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Writes a notification in the caller's transaction.
pub(crate) async fn notify(
    tx: &mut ScopedTx,
    kind: NotificationKind,
    appointment_id: AppointmentId,
) -> Result<StaffNotificationId, AppError> {
    let id = StaffNotificationId::new_v7();
    dal::insert(tx.conn(), id.uuid(), kind.as_str(), appointment_id.uuid()).await?;
    Ok(id)
}

/// Marks the appointment's open notifications handled when staff confirm, decline or cancel an
/// online booking, in the status change's transaction. Other appointments have none, so they
/// cost no extra statement.
pub(crate) async fn on_status(
    tx: &mut ScopedTx,
    current: &AppointmentRow,
    to: AppointmentStatus,
    by: Option<MembershipId>,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let online = current.status == AppointmentStatus::Requested.as_str()
        || current.source == BookingSource::Website.as_str()
        || current.source == BookingSource::App.as_str();
    if online
        && matches!(
            to,
            AppointmentStatus::Confirmed | AppointmentStatus::Cancelled
        )
    {
        dal::handle(tx.conn(), current.id, by.map(MembershipId::uuid), now).await?;
    }
    Ok(())
}

/// Who handled a notification, and when.
#[derive(Debug, Clone)]
pub struct Handled {
    /// When.
    pub at: OffsetDateTime,
    /// The member; `None` when the patient cancelled.
    pub by: Option<MembershipId>,
    /// Their display name.
    pub by_name: Option<String>,
}

/// The appointment a notification is about.
#[derive(Debug, Clone)]
pub struct NotifiedAppointment {
    /// The appointment.
    pub id: AppointmentId,
    /// Start, in the clinic's offset.
    pub starts_at: OffsetDateTime,
    /// End, in the clinic's offset.
    pub ends_at: OffsetDateTime,
    /// Its status now.
    pub status: AppointmentStatus,
    /// Its doctor.
    pub practitioner_id: PractitionerId,
    /// The doctor's name.
    pub practitioner_name: String,
}

/// A notification as one member sees it.
#[derive(Debug, Clone)]
pub struct NotificationView {
    /// The notification.
    pub id: StaffNotificationId,
    /// What happened.
    pub kind: NotificationKind,
    /// When.
    pub created_at: OffsetDateTime,
    /// When this member read it.
    pub read_at: Option<OffsetDateTime>,
    /// Who handled it.
    pub handled: Option<Handled>,
    /// When everyone was reminded.
    pub reminded_at: Option<OffsetDateTime>,
    /// When the owners were told.
    pub escalated_at: Option<OffsetDateTime>,
    /// The appointment.
    pub appointment: NotifiedAppointment,
}

fn status_of(text: &str) -> Result<AppointmentStatus, AppError> {
    AppointmentStatus::parse(text).map_err(|_| AppError::Internal("unknown appointment status"))
}

fn view(row: FeedRow, offset: UtcOffset) -> Result<NotificationView, AppError> {
    Ok(NotificationView {
        id: StaffNotificationId::from_uuid(row.id),
        kind: NotificationKind::parse(&row.kind)
            .map_err(|_| AppError::Internal("unknown notification kind"))?,
        created_at: row.created_at,
        read_at: row.read_at,
        handled: row.handled_at.map(|at| Handled {
            at,
            by: row.handled_by.map(MembershipId::from_uuid),
            by_name: row.handled_by_name,
        }),
        reminded_at: row.reminded_at,
        escalated_at: row.escalated_at,
        appointment: NotifiedAppointment {
            id: AppointmentId::from_uuid(row.appointment_id),
            starts_at: row.starts_at.to_offset(offset),
            ends_at: row.ends_at.to_offset(offset),
            status: status_of(&row.appointment_status)?,
            practitioner_id: PractitionerId::from_uuid(row.practitioner_id),
            practitioner_name: row.practitioner_name,
        },
    })
}

fn viewer(actor: &ClinicActor) -> Viewer {
    Viewer {
        member: actor.membership_id.uuid(),
        reach: actor.reach(Permission::AppointmentsRead).member(),
        unread_days: UNREAD_WINDOW_DAYS,
    }
}

/// Which notifications a feed asks for.
#[derive(Debug, Clone, Copy, Default)]
pub struct FeedQuery {
    /// Only those this member hasn't read (from the last 30 days).
    pub unread_only: bool,
    /// Page size; 30 when absent, at most 100.
    pub limit: Option<u32>,
    /// Only those older than this notification (the last one of the previous page).
    pub before: Option<StaffNotificationId>,
}

/// The member's notifications, newest first. Needs `appointments.read`.
///
/// # Errors
/// [`AppError::Forbidden`] without the permission; [`AppError::Db`] on database failures.
pub async fn feed(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    query: FeedQuery,
) -> Result<Vec<NotificationView>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let offset = clinic_offset(&actor.timezone);
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::feed(
            tx.conn(),
            viewer(actor),
            query.unread_only,
            query.before.map(StaffNotificationId::uuid),
            page_size(query.limit),
        )
        .await?;
        rows.into_iter().map(|row| view(row, offset)).collect()
    })
    .await
}

/// How many notifications the member hasn't read from the last 30 days, at most 100 (the bell
/// shows "99+" beyond 99). Needs `appointments.read`.
///
/// # Errors
/// As [`feed`].
pub async fn unread_count(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<i64, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::unread_count(tx.conn(), viewer(actor), UNREAD_CAP).await?)
    })
    .await
}

/// Marks one notification read for the member. Reading it again changes nothing.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't in this clinic or its appointment is out of reach.
pub async fn mark_read(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: StaffNotificationId,
) -> Result<(), AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let member = actor.membership_id.uuid();
    let reach = actor.reach(Permission::AppointmentsRead).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::mark_read(tx.conn(), id.uuid(), member, reach).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("notification"))
        }
    })
    .await
}

/// Marks every notification the member can see read; returns how many were unread.
///
/// # Errors
/// As [`feed`].
pub async fn mark_all_read(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<u64, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let member = actor.membership_id.uuid();
    let reach = actor.reach(Permission::AppointmentsRead).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::mark_all_read(tx.conn(), member, reach).await?)
    })
    .await
}

/// A message in the clinic inbox.
#[derive(Debug, Clone)]
pub struct InboxView {
    /// The message.
    pub id: InboxMessageId,
    /// A reminder, or an escalation to the owners.
    pub kind: InboxKind,
    /// Who it is for.
    pub audience: Audience,
    /// When it was written.
    pub created_at: OffsetDateTime,
    /// The notification it is about.
    pub notification_id: StaffNotificationId,
    /// When the booking was handled; the message is open until then.
    pub handled_at: Option<OffsetDateTime>,
    /// The appointment.
    pub appointment_id: AppointmentId,
    /// Its start, in the clinic's offset.
    pub starts_at: OffsetDateTime,
    /// Its doctor.
    pub practitioner_id: PractitionerId,
    /// The doctor's name.
    pub practitioner_name: String,
}

fn inbox_view(row: InboxRow, offset: UtcOffset) -> Result<InboxView, AppError> {
    let unknown = |_| AppError::Internal("unknown inbox value");
    Ok(InboxView {
        id: InboxMessageId::from_uuid(row.id),
        kind: InboxKind::parse(&row.kind).map_err(unknown)?,
        audience: Audience::parse(&row.audience).map_err(unknown)?,
        created_at: row.created_at,
        notification_id: StaffNotificationId::from_uuid(row.notification_id),
        handled_at: row.handled_at,
        appointment_id: AppointmentId::from_uuid(row.appointment_id),
        starts_at: row.starts_at.to_offset(offset),
        practitioner_id: PractitionerId::from_uuid(row.practitioner_id),
        practitioner_name: row.practitioner_name,
    })
}

/// Which inbox messages to list.
#[derive(Debug, Clone, Copy, Default)]
pub struct InboxQuery {
    /// Only those whose booking hasn't been handled.
    pub open_only: bool,
    /// Page size; 30 when absent, at most 100.
    pub limit: Option<u32>,
    /// Only those older than this message.
    pub before: Option<InboxMessageId>,
}

/// The inbox messages for this member, newest first: reminders about appointments within
/// reach, and escalations too for owners. Needs `appointments.read`.
///
/// # Errors
/// As [`feed`].
pub async fn inbox(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    query: InboxQuery,
) -> Result<Vec<InboxView>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let offset = clinic_offset(&actor.timezone);
    let reach = actor.reach(Permission::AppointmentsRead).member();
    let owner = addressed_to(Audience::Owners, &actor.role_key);
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::inbox(
            tx.conn(),
            reach,
            owner,
            query.open_only,
            query.before.map(InboxMessageId::uuid),
            page_size(query.limit),
        )
        .await?;
        rows.into_iter()
            .map(|row| inbox_view(row, offset))
            .collect()
    })
    .await
}
