//! How a request to move a record to another state ended.

/// The result of asking a record to move to another state: sign a note, mark an appointment
/// arrived, call a patient in. Repeating a move that already happened is not an error, and a
/// move the record's state doesn't allow carries the record as it is, so a client can show it.
#[derive(Debug, Clone)]
pub enum Moved<V> {
    /// The record moved now.
    Done(V),
    /// The record was already in the requested state, so nothing was written: a retry of a
    /// request that had already succeeded.
    AlreadyDone(V),
    /// The record's state doesn't allow the move, and nothing was written.
    Refused {
        /// Why not, without patient data.
        reason: String,
        /// The record as it is.
        current: V,
    },
}
