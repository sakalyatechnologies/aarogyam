//! The fan-out behind `GET /api/v1/events`: one Postgres `LISTEN` connection per server
//! instance, started on the first subscriber, feeding a broadcast channel that each stream
//! filters to its own clinic and branch.

use std::sync::{Arc, Weak};
use std::time::Duration;

use aarogyam_dal::live::{self as dal, Signal};
use sakalya_db::Db;
use tokio::sync::{OnceCell, broadcast};

const CAPACITY: usize = 1024;
/// How long the listener waits before checking that the server still wants it.
const IDLE_CHECK: Duration = Duration::from_secs(5);

/// What the listener hands to streams.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Live {
    /// A record changed.
    Change(Signal),
    /// Signals may have been lost (the listener reconnected): refetch.
    Resync,
}

#[derive(Debug)]
struct HubInner {
    tx: broadcast::Sender<Live>,
    started: OnceCell<()>,
}

/// The broadcast hub; cheap to clone.
#[derive(Debug, Clone)]
pub(crate) struct Hub {
    inner: Arc<HubInner>,
}

impl Hub {
    pub(crate) fn new() -> Self {
        let (tx, _) = broadcast::channel(CAPACITY);
        Self {
            inner: Arc::new(HubInner {
                tx,
                started: OnceCell::new(),
            }),
        }
    }

    /// A receiver of every signal from now on. The first call opens the listener and returns
    /// once it is listening, so nothing committed after this returns is missed.
    pub(crate) async fn subscribe(
        &self,
        db: &Db,
    ) -> Result<broadcast::Receiver<Live>, sakalya_db::DbError> {
        self.inner
            .started
            .get_or_try_init(|| async {
                let listener = dal::listener(db.pool()).await?;
                tokio::spawn(run(listener, Arc::downgrade(&self.inner)));
                Ok::<(), sakalya_db::DbError>(())
            })
            .await?;
        Ok(self.inner.tx.subscribe())
    }
}

async fn run(mut listener: dal::Listener, hub: Weak<HubInner>) {
    loop {
        let next = tokio::time::timeout(IDLE_CHECK, dal::next(&mut listener)).await;
        let Some(hub) = hub.upgrade() else { return };
        let live = match next {
            Err(_) => continue,
            Ok(Ok(Some(Some(signal)))) => Live::Change(signal),
            Ok(Ok(Some(None))) => continue,
            Ok(Ok(None)) => Live::Resync,
            Ok(Err(error)) => {
                tracing::warn!(%error, "live listener lost its connection; retrying");
                tokio::time::sleep(IDLE_CHECK).await;
                Live::Resync
            }
        };
        // No receivers is fine: nobody is watching.
        let _ = hub.tx.send(live);
    }
}
