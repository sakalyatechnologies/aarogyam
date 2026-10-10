//! Staff notifications about online bookings and overdue lab work: the bell's count, the feed
//! with per-member read state and who handled each one, marking read, and the clinic inbox that
//! reminders and escalations write to. The feed routes need `appointments.read` (bookings) or
//! `labs.read` (lab work), each within its scope; the inbox needs `appointments.read`. IDs,
//! times, the doctor and the lab only: never patient data.

use aarogyam_app::notifications::{
    self as app, FeedQuery, InboxQuery, InboxView, NotificationView, Subject,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{InboxMessageId, MembershipId, StaffNotificationId};
use aarogyam_domain::permission::require::{AppointmentsRead, LabsRead};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_id, rfc3339};
use crate::AppState;
use crate::extract::{Require, RequireEither};
use crate::failure::ApiFailure;

/// The appointment a notification is about.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotifiedAppointment {
    /// The appointment; open it at `/appointments/{id}`.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Start (RFC 3339, the clinic's offset).
    pub starts_at: String,
    /// End (RFC 3339, the clinic's offset).
    pub ends_at: String,
    /// Its status now, such as `requested` or `confirmed`.
    pub status: String,
    /// Its doctor.
    #[schema(value_type = String)]
    pub practitioner_id: Uuid,
    /// The doctor's name as shown on the calendar.
    pub practitioner_name: String,
}

/// The lab order an overdue alert is about.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotifiedLabOrder {
    /// The order; open it at `/lab-orders/{id}`.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its number, such as `LAB-12`.
    pub number: String,
    /// Its lab's name.
    pub vendor_name: String,
    /// Its due date now (`YYYY-MM-DD`).
    pub due_on: Option<String>,
}

/// Who handled a notification: confirmed, declined or cancelled its appointment, or received,
/// cancelled or re-dated its lab work.
#[derive(Debug, Serialize, ToSchema)]
pub struct HandledBy {
    /// When (RFC 3339).
    pub at: String,
    /// The member; absent when the patient cancelled.
    #[schema(value_type = Option<String>)]
    pub membership_id: Option<Uuid>,
    /// Their display name, such as `Farah Desk`.
    pub name: Option<String>,
}

/// A notification as the caller sees it.
#[derive(Debug, Serialize, ToSchema)]
pub struct Notification {
    /// Identifier; pass as `before` for the next page.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `booking_requested`, `booking_confirmed_auto`, `booking_cancelled_by_patient` or
    /// `lab_overdue`.
    pub kind: String,
    /// When it happened (RFC 3339).
    pub created_at: String,
    /// Whether the caller has read it.
    pub read: bool,
    /// When the caller read it (RFC 3339).
    pub read_at: Option<String>,
    /// Who handled it and when; absent while nobody has.
    pub handled: Option<HandledBy>,
    /// When everyone was reminded because nobody had answered (RFC 3339).
    pub reminded_at: Option<String>,
    /// When the owners were told (RFC 3339).
    pub escalated_at: Option<String>,
    /// The appointment, for a booking notification.
    pub appointment: Option<NotifiedAppointment>,
    /// The lab order, for `lab_overdue`.
    pub lab_order: Option<NotifiedLabOrder>,
}

impl From<NotificationView> for Notification {
    fn from(view: NotificationView) -> Self {
        let (appointment, lab_order) = match view.subject {
            Subject::Appointment(appointment) => (
                Some(NotifiedAppointment {
                    id: appointment.id.uuid(),
                    starts_at: rfc3339(appointment.starts_at),
                    ends_at: rfc3339(appointment.ends_at),
                    status: appointment.status.as_str().to_owned(),
                    practitioner_id: appointment.practitioner_id.uuid(),
                    practitioner_name: appointment.practitioner_name,
                }),
                None,
            ),
            Subject::LabOrder(order) => (
                None,
                Some(NotifiedLabOrder {
                    id: order.id.uuid(),
                    number: order.number,
                    vendor_name: order.vendor_name,
                    due_on: order.due_on.map(|day| day.to_string()),
                }),
            ),
        };
        Self {
            id: view.id.uuid(),
            kind: view.kind.as_str().to_owned(),
            created_at: rfc3339(view.created_at),
            read: view.read_at.is_some(),
            read_at: view.read_at.map(rfc3339),
            handled: view.handled.map(|handled| HandledBy {
                at: rfc3339(handled.at),
                membership_id: handled.by.map(MembershipId::uuid),
                name: handled.by_name,
            }),
            reminded_at: view.reminded_at.map(rfc3339),
            escalated_at: view.escalated_at.map(rfc3339),
            appointment,
            lab_order,
        }
    }
}

/// A page of the caller's notifications, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotificationList {
    /// The notifications.
    pub items: Vec<Notification>,
}

/// Filters for the feed.
#[derive(Debug, Deserialize)]
pub struct FeedParams {
    /// Only unread ones, from the last 30 days.
    pub unread_only: Option<bool>,
    /// Page size, 1 to 100 (default 30).
    pub limit: Option<u32>,
    /// Only those older than this notification id (the last of the previous page).
    pub before: Option<String>,
}

/// The caller's notifications, newest first: bookings within their `appointments.read` scope
/// and overdue lab work within their `labs.read` scope, with their own read state and who
/// handled each one. The portal checks every minute.
#[utoipa::path(
    get,
    path = "/api/v1/notifications",
    operation_id = "listNotifications",
    tag = "notifications",
    params(
        ("unread_only" = Option<bool>, Query, description = "Only unread ones, from the last 30 days"),
        ("limit" = Option<u32>, Query, description = "Page size, 1 to 100 (default 30)"),
        ("before" = Option<String>, Query, description = "Only those older than this notification id")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = NotificationList),
        (status = 400, description = "`before` is not an id"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks both appointments.read and labs.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<AppointmentsRead, LabsRead>,
    ApiQuery(params): ApiQuery<FeedParams>,
) -> Result<Json<NotificationList>, ApiFailure> {
    let before = params
        .before
        .as_deref()
        .map(|text| parse_id("before", text).map(StaffNotificationId::from_uuid))
        .transpose()?;
    let items = app::feed(
        state.db(),
        &request.actor,
        request.request_id,
        FeedQuery {
            unread_only: params.unread_only.unwrap_or(false),
            limit: params.limit,
            before,
        },
    )
    .await?;
    Ok(Json(NotificationList {
        items: items.into_iter().map(Notification::from).collect(),
    }))
}

/// The bell's number.
#[derive(Debug, Serialize, ToSchema)]
pub struct UnreadCount {
    /// Unread notifications from the last 30 days, at most 100; show "99+" above 99.
    pub unread: i64,
}

/// How many notifications the caller hasn't read: one cheap query for the bell.
#[utoipa::path(
    get,
    path = "/api/v1/notifications/count",
    operation_id = "countUnreadNotifications",
    tag = "notifications",
    security(("bearer" = [])),
    responses(
        (status = 200, body = UnreadCount),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks both appointments.read and labs.read")
    )
)]
pub(crate) async fn count(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<AppointmentsRead, LabsRead>,
) -> Result<Json<UnreadCount>, ApiFailure> {
    let unread = app::unread_count(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(UnreadCount { unread }))
}

/// Marks one notification read for the caller only; others still see it unread. Repeating it
/// changes nothing.
#[utoipa::path(
    post,
    path = "/api/v1/notifications/{id}/read",
    operation_id = "markNotificationRead",
    tag = "notifications",
    params(("id" = String, Path, description = "The notification")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Read"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks both appointments.read and labs.read"),
        (status = 404, description = "No such notification in this clinic, or its appointment or lab order is out of the role's reach")
    )
)]
pub(crate) async fn read(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<AppointmentsRead, LabsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::mark_read(
        state.db(),
        &request.actor,
        request.request_id,
        StaffNotificationId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// What "mark all read" did.
#[derive(Debug, Serialize, ToSchema)]
pub struct MarkedRead {
    /// Notifications that were unread and are now read.
    pub marked: u64,
}

/// Marks every notification the caller can see read, for the caller only.
#[utoipa::path(
    post,
    path = "/api/v1/notifications/read-all",
    operation_id = "markAllNotificationsRead",
    tag = "notifications",
    security(("bearer" = [])),
    responses(
        (status = 200, body = MarkedRead),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks both appointments.read and labs.read")
    )
)]
pub(crate) async fn read_all(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<AppointmentsRead, LabsRead>,
) -> Result<Json<MarkedRead>, ApiFailure> {
    let marked = app::mark_all_read(state.db(), &request.actor, request.request_id).await?;
    tracing::info!(
        event = Event::NotificationsRead.as_str(),
        marked,
        "notifications marked read"
    );
    Ok(Json(MarkedRead { marked }))
}

/// A message in the clinic inbox: a booking request still waiting. It stays open until the
/// booking is confirmed, declined or cancelled.
#[derive(Debug, Serialize, ToSchema)]
pub struct InboxMessage {
    /// Identifier; pass as `before` for the next page.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `booking_reminder` (for everyone who handles the appointment) or `booking_escalation`
    /// (for the owners).
    pub kind: String,
    /// `clinic` or `owners`.
    pub audience: String,
    /// When it was written (RFC 3339).
    pub created_at: String,
    /// The notification it is about.
    #[schema(value_type = String)]
    pub notification_id: Uuid,
    /// Whether the booking has been handled.
    pub open: bool,
    /// When the booking was handled (RFC 3339).
    pub handled_at: Option<String>,
    /// The appointment.
    #[schema(value_type = String)]
    pub appointment_id: Uuid,
    /// Its start (RFC 3339, the clinic's offset).
    pub starts_at: String,
    /// Its doctor.
    #[schema(value_type = String)]
    pub practitioner_id: Uuid,
    /// The doctor's name.
    pub practitioner_name: String,
}

impl From<InboxView> for InboxMessage {
    fn from(view: InboxView) -> Self {
        Self {
            id: view.id.uuid(),
            kind: view.kind.as_str().to_owned(),
            audience: view.audience.as_str().to_owned(),
            created_at: rfc3339(view.created_at),
            notification_id: view.notification_id.uuid(),
            open: view.handled_at.is_none(),
            handled_at: view.handled_at.map(rfc3339),
            appointment_id: view.appointment_id.uuid(),
            starts_at: rfc3339(view.starts_at),
            practitioner_id: view.practitioner_id.uuid(),
            practitioner_name: view.practitioner_name,
        }
    }
}

/// A page of the inbox, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct InboxList {
    /// The messages.
    pub items: Vec<InboxMessage>,
}

/// Filters for the inbox.
#[derive(Debug, Deserialize)]
pub struct InboxParams {
    /// Only messages whose booking hasn't been handled.
    pub open_only: Option<bool>,
    /// Page size, 1 to 100 (default 30).
    pub limit: Option<u32>,
    /// Only those older than this message id.
    pub before: Option<String>,
}

/// The caller's inbox: reminders about booking requests within their scope, and escalations
/// too for owners, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/inbox",
    operation_id = "listInbox",
    tag = "notifications",
    params(
        ("open_only" = Option<bool>, Query, description = "Only messages whose booking is still unhandled"),
        ("limit" = Option<u32>, Query, description = "Page size, 1 to 100 (default 30)"),
        ("before" = Option<String>, Query, description = "Only those older than this message id")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = InboxList),
        (status = 400, description = "`before` is not an id"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read")
    )
)]
pub(crate) async fn inbox(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
    ApiQuery(params): ApiQuery<InboxParams>,
) -> Result<Json<InboxList>, ApiFailure> {
    let before = params
        .before
        .as_deref()
        .map(|text| parse_id("before", text).map(InboxMessageId::from_uuid))
        .transpose()?;
    let items = app::inbox(
        state.db(),
        &request.actor,
        request.request_id,
        InboxQuery {
            open_only: params.open_only.unwrap_or(false),
            limit: params.limit,
            before,
        },
    )
    .await?;
    Ok(Json(InboxList {
        items: items.into_iter().map(InboxMessage::from).collect(),
    }))
}
