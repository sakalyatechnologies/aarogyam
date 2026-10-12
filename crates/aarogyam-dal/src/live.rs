//! Live change signals: the `aarogyam_live` NOTIFY channel the triggers of migration 0702 write
//! to. A signal carries the clinic, the branch, the kind and a record id, nothing else.

use sqlx::postgres::PgListener;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use sakalya_db::DbError;

/// The Postgres channel.
pub const CHANNEL: &str = "aarogyam_live";

/// A connection listening on the channel.
pub type Listener = PgListener;

/// What changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A queue token was issued or moved.
    QueueChanged,
    /// A visit was started or closed.
    VisitChanged,
    /// A staff notification was written.
    NotificationCreated,
}

impl Kind {
    /// The event name clients see.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::QueueChanged => "queue.changed",
            Self::VisitChanged => "visit.changed",
            Self::NotificationCreated => "notification.created",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "queue.changed" => Some(Self::QueueChanged),
            "visit.changed" => Some(Self::VisitChanged),
            "notification.created" => Some(Self::NotificationCreated),
            _ => None,
        }
    }
}

/// One change signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Signal {
    /// The event id (the SSE `id:`), increasing; replay resumes after it.
    pub event_id: i64,
    /// The clinic it happened in; used to route, never sent to clients.
    pub org_id: Uuid,
    /// The branch, when the record has one.
    pub branch_id: Option<Uuid>,
    /// What changed.
    pub kind: Kind,
    /// The record that changed.
    pub id: Uuid,
}

#[derive(serde::Deserialize)]
struct Payload {
    e: i64,
    o: Uuid,
    b: Option<Uuid>,
    k: String,
    i: Uuid,
}

impl Signal {
    /// Reads a NOTIFY payload; `None` for anything that isn't one of ours.
    #[must_use]
    pub fn parse(payload: &str) -> Option<Self> {
        let raw: Payload = serde_json::from_str(payload).ok()?;
        Some(Self {
            event_id: raw.e,
            org_id: raw.o,
            branch_id: raw.b,
            kind: Kind::parse(&raw.k)?,
            id: raw.i,
        })
    }
}

/// A listener on the channel, on a connection of its own (a session-mode connection: a
/// transaction-mode pooler cannot deliver notifications).
///
/// # Errors
/// [`DbError`] when the connection or the `LISTEN` fails.
pub async fn listener(pool: &PgPool) -> Result<PgListener, DbError> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(CHANNEL).await?;
    Ok(listener)
}

/// Waits for the next signal: `Some(Some(signal))` for one, `Some(None)` for a notification that
/// isn't ours, and `None` when the connection was lost and re-established (signals in between
/// are gone, so subscribers should refetch).
///
/// # Errors
/// [`DbError`] when the connection can't be re-established.
pub async fn next(listener: &mut PgListener) -> Result<Option<Option<Signal>>, DbError> {
    Ok(listener
        .try_recv()
        .await?
        .map(|note| Signal::parse(note.payload())))
}

/// How many events one replay returns at most; more than this and the client is told to reset.
pub const REPLAY_LIMIT: i32 = 500;

/// What a reconnect with `Last-Event-ID` gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Replay {
    /// Everything after the id, oldest first (possibly nothing).
    Events(Vec<Signal>),
    /// The buffer no longer reaches back that far, or the id is not from this database.
    Reset,
}

/// The caller's clinic's events after `after`, from the bounded buffer (migration 0702), or
/// [`Replay::Reset`] when the buffer was trimmed past `after`, `after` is newer than anything
/// held, or more than [`REPLAY_LIMIT`] events are waiting.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn replay(conn: &mut PgConnection, org_id: Uuid, after: i64) -> Result<Replay, DbError> {
    let bounds: (Option<i64>, Option<i64>) =
        sqlx::query_as("select lo, hi from app.live_events_bounds()")
            .fetch_one(&mut *conn)
            .await?;
    let (Some(lo), Some(hi)) = bounds else {
        return Ok(Replay::Events(Vec::new()));
    };
    // `lo - 1` is the newest id that may already be trimmed. Gaps from rolled-back ids can make
    // this reset when nothing was lost, which is safe.
    if after > hi || after < lo - 1 {
        return Ok(Replay::Reset);
    }
    // Runtime-checked: a function call over a private table, with a fixed shape.
    let rows: Vec<(i64, Option<Uuid>, String, Uuid)> =
        sqlx::query_as("select id, branch_id, kind, record_id from app.live_events_since($1, $2)")
            .bind(after)
            .bind(REPLAY_LIMIT + 1)
            .fetch_all(&mut *conn)
            .await?;
    if rows.len() > REPLAY_LIMIT as usize {
        return Ok(Replay::Reset);
    }
    Ok(Replay::Events(
        rows.into_iter()
            .filter_map(|(event_id, branch_id, kind, id)| {
                Some(Signal {
                    event_id,
                    org_id,
                    branch_id,
                    kind: Kind::parse(&kind)?,
                    id,
                })
            })
            .collect(),
    ))
}
