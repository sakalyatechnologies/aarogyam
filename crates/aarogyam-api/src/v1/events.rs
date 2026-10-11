//! Live updates: a Server-Sent Events stream of small change signals.

use std::convert::Infallible;
use std::time::Duration;

use aarogyam_app::schedule as app;
use aarogyam_dal::live::Kind;
use aarogyam_domain::ids::BranchId;
use aarogyam_domain::permission::require::AppointmentsRead;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use sakalya_http::ApiQuery;
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use super::parse_id;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;
use crate::live::Live;

/// The seconds between heartbeat comments.
const HEARTBEAT_SECS: u64 = 25;
/// How long a stream waits for a signal before checking the client is still there.
const CLIENT_CHECK: Duration = Duration::from_secs(30);

/// What the stream filters on.
#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    /// Only this branch's changes (and those with no branch); every branch when left out.
    pub branch_id: Option<String>,
}

fn change(kind: Kind, id: Uuid, branch: Option<Uuid>) -> Event {
    Event::default().event(kind.as_str()).data(
        serde_json::json!({ "kind": kind.as_str(), "id": id, "branch_id": branch }).to_string(),
    )
}

/// A stream of change signals for the caller's clinic (`text/event-stream`).
///
/// Events: `ready` (sent once when the stream is open; data `{}`), `queue.changed`,
/// `visit.changed`, `notification.created` (data `{kind, id, branch_id}`: identifiers only, never
/// patient data; refetch the list or record they name) and `resync` (signals may have been
/// missed; refetch everything). A `: hb` comment arrives every 25 seconds. Events are not stored:
/// there is no `Last-Event-ID` resume, so after a reconnect refetch before trusting the stream.
/// Polling stays the fallback.
#[utoipa::path(
    get,
    path = "/api/v1/events",
    operation_id = "streamEvents",
    tag = "queue",
    params(("branch_id" = Option<String>, Query, description = "Only this branch")),
    security(("bearer" = [])),
    responses(
        (status = 200, content_type = "text/event-stream", body = String, description = "The event stream; see the operation description for the events"),
        (status = 400, description = "Bad branch id"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read"),
        (status = 404, description = "No such branch in this clinic")
    )
)]
pub(crate) async fn stream(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
    ApiQuery(query): ApiQuery<EventsQuery>,
) -> Result<impl IntoResponse, ApiFailure> {
    let branch = query
        .branch_id
        .as_deref()
        .map(|text| parse_id("branch_id", text).map(BranchId::from_uuid))
        .transpose()?;
    if let Some(branch) = branch {
        app::require_branch(state.db(), &request.actor, request.request_id, branch).await?;
    }
    let clinic = request.actor.clinic_id.uuid();
    let branch = branch.map(BranchId::uuid);
    let mut feed = state
        .live()
        .subscribe(state.db())
        .await
        .map_err(aarogyam_app::AppError::from)?;
    let (out, stream) = mpsc::channel::<Result<Event, Infallible>>(32);
    tokio::spawn(async move {
        if out
            .send(Ok(Event::default().event("ready").data("{}")))
            .await
            .is_err()
        {
            return;
        }
        loop {
            let event = match tokio::time::timeout(CLIENT_CHECK, feed.recv()).await {
                Err(_) => {
                    if out.is_closed() {
                        return;
                    }
                    continue;
                }
                Ok(Ok(Live::Change(signal))) => {
                    let wanted = signal.org_id == clinic
                        && match (branch, signal.branch_id) {
                            (Some(wanted), Some(actual)) => wanted == actual,
                            _ => true,
                        };
                    if !wanted {
                        continue;
                    }
                    change(signal.kind, signal.id, signal.branch_id)
                }
                Ok(Ok(Live::Resync) | Err(broadcast::error::RecvError::Lagged(_))) => {
                    Event::default().event("resync").data("{}")
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => return,
            };
            if out.send(Ok(event)).await.is_err() {
                return;
            }
        }
    });
    Ok(Sse::new(ReceiverStream::new(stream)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(HEARTBEAT_SECS))
            .text("hb"),
    ))
}
