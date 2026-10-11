//! Live change signals: the `aarogyam_live` NOTIFY channel the triggers of migration 0426 write
//! to. A signal carries the clinic, the branch, the kind and a record id, nothing else.

use sqlx::PgPool;
use sqlx::postgres::PgListener;
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
