//! Live updates: a Server-Sent Events stream of small change signals.

use std::convert::Infallible;
use std::time::Duration;

use aarogyam_app::schedule as app;
use aarogyam_dal::live::{Replay, Signal};
use aarogyam_domain::ids::BranchId;
use aarogyam_domain::permission::require::AppointmentsRead;
use axum::extract::State;
use axum::http::HeaderMap;
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
/// A stream ends after this long; the client reconnects with `Last-Event-ID` (Cloud Run bills an
/// open request, and a stream must not pin the instance forever).
const MAX_LIFETIME: Duration = Duration::from_mins(8);
/// How long a stream waits for a signal before checking the client is still there.
const CLIENT_CHECK: Duration = Duration::from_secs(30);

/// What the stream filters on.
#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    /// Only this branch's changes (and those with no branch); every branch when left out.
    pub branch_id: Option<String>,
}

fn change(signal: Signal) -> Event {
    let Signal {
        event_id,
        kind,
        id,
        branch_id,
        ..
    } = signal;
    Event::default()
        .id(event_id.to_string())
        .event(kind.as_str())
        .data(
            serde_json::json!({ "kind": kind.as_str(), "id": id, "branch_id": branch_id })
                .to_string(),
        )
}

/// Does a signal belong on a stream for this clinic and (optional) branch?
fn wanted(signal: &Signal, clinic: Uuid, branch: Option<Uuid>) -> bool {
    signal.org_id == clinic
        && match (branch, signal.branch_id) {
            (Some(wanted), Some(actual)) => wanted == actual,
            _ => true,
        }
}

/// A stream of change signals for the caller's clinic (`text/event-stream`).
///
/// Events: `ready` (sent once when the stream is open; data `{}`), `queue.changed`,
/// `visit.changed`, `appointment.changed`, `notification.created` (data `{kind, id, branch_id}`: identifiers only, never
/// patient data; refetch the list or record they name) and `resync` (signals may have been
/// missed, or a resume is impossible; refetch everything). Each change event has an `id:` (a
/// number that only grows). A `: hb` comment arrives every 25 seconds; the stream closes after 8 minutes (reconnect with `Last-Event-ID`).
///
/// Resume: send `Last-Event-ID` (browsers' `EventSource` does it by itself) and the server replays
/// the clinic's events after that id from a buffer of the last 2000 events, then goes live
/// (`ready` is sent first). When the buffer no longer reaches back that far (or the id is
/// unknown, or over 500 events were missed) it sends `resync` straight away instead: refetch everything. Without
/// the header nothing is replayed: fetch, then listen. Polling stays the fallback.
#[utoipa::path(
    get,
    path = "/api/v1/events",
    operation_id = "streamEvents",
    tag = "queue",
    params(
        ("branch_id" = Option<String>, Query, description = "Only this branch"),
        ("Last-Event-ID" = Option<i64>, Header, description = "The id of the last event seen: replay what came after")
    ),
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
    headers: HeaderMap,
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
    let last_id = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|text| text.trim().parse::<i64>().ok())
        .filter(|id| *id >= 0);
    // Subscribe first, then replay: nothing falls between the two, and the ids seen in the replay
    // are dropped from the live feed.
    let replay = match last_id {
        Some(after) => {
            Some(app::live_replay(state.db(), &request.actor, request.request_id, after).await?)
        }
        None => None,
    };
    let (out, stream) = mpsc::channel::<Result<Event, Infallible>>(32);
    tokio::spawn(async move {
        if out
            .send(Ok(Event::default().event("ready").data("{}")))
            .await
            .is_err()
        {
            return;
        }
        // Live signals at or below this id were already sent by the replay.
        let mut floor = last_id.unwrap_or(0);
        match replay {
            Some(Replay::Events(signals)) => {
                for signal in signals {
                    floor = floor.max(signal.event_id);
                    if wanted(&signal, clinic, branch)
                        && out.send(Ok(change(signal))).await.is_err()
                    {
                        return;
                    }
                }
            }
            Some(Replay::Reset) => {
                floor = 0;
                if out
                    .send(Ok(Event::default().event("resync").data("{}")))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            None => {}
        }
        let ends = tokio::time::Instant::now() + MAX_LIFETIME;
        loop {
            if tokio::time::Instant::now() >= ends {
                return;
            }
            let event = match tokio::time::timeout(CLIENT_CHECK, feed.recv()).await {
                Err(_) => {
                    if out.is_closed() {
                        return;
                    }
                    continue;
                }
                Ok(Ok(Live::Change(signal))) => {
                    if signal.event_id <= floor || !wanted(&signal, clinic, branch) {
                        continue;
                    }
                    change(signal)
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
