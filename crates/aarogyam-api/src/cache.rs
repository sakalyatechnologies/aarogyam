//! A small time-limited cache for answers that are safe to reuse for a few seconds: which
//! clinic a host is, and what a member may do. Keeps a database round trip off most requests.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Entries live for `ttl`; when `capacity` is reached the cache starts over, which bounds
/// memory without bookkeeping.
#[derive(Debug)]
pub(crate) struct TtlCache<K, V> {
    ttl: Duration,
    capacity: usize,
    entries: Mutex<HashMap<K, (Instant, V)>>,
}

impl<K: Eq + Hash, V: Clone> TtlCache<K, V> {
    pub(crate) fn new(ttl: Duration, capacity: usize) -> Self {
        Self {
            ttl,
            capacity,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// The cached value, if fresh.
    pub(crate) fn get(&self, key: &K) -> Option<V> {
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries
            .get(key)
            .filter(|(stored, _)| stored.elapsed() < self.ttl)
            .map(|(_, value)| value.clone())
    }

    /// Drops every entry `stale` picks, so a change takes effect on the next request instead of
    /// when the entry expires.
    pub(crate) fn remove_where(&self, stale: impl Fn(&K, &V) -> bool) {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries.retain(|key, (_, value)| !stale(key, value));
    }

    pub(crate) fn insert(&self, key: K, value: V) {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        if entries.len() >= self.capacity {
            entries.clear();
        }
        entries.insert(key, (Instant::now(), value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_expire_and_capacity_is_bounded() {
        let cache = TtlCache::new(Duration::from_millis(30), 2);
        cache.insert("a", 1);
        assert_eq!(cache.get(&"a"), Some(1));
        cache.insert("b", 2);
        cache.insert("c", 3);
        assert_eq!(cache.get(&"a"), None);
        assert_eq!(cache.get(&"c"), Some(3));
        std::thread::sleep(Duration::from_millis(40));
        assert_eq!(cache.get(&"c"), None);
    }

    #[test]
    fn chosen_entries_can_be_dropped_at_once() {
        let cache = TtlCache::new(Duration::from_secs(30), 10);
        cache.insert(("clinic", 1), "member one");
        cache.insert(("clinic", 2), "member two");
        cache.remove_where(|key, value| key.1 == 1 || *value == "nobody");
        assert_eq!(cache.get(&("clinic", 1)), None);
        assert_eq!(cache.get(&("clinic", 2)), Some("member two"));
    }
}
