//! A clinic's portal or site address at the edge: whether Cloudflare serves its host yet.

text_value! {
    /// Whether a portal or site host is served: the console shows it as "address ready / pending /
    /// failed".
    AddressStatus ("address_status") {
        /// Queued: the outbox job hasn't made the host work yet, or will try again.
        Pending => "pending",
        /// The edge serves the host; sign-in works there.
        Ready => "ready",
        /// The last attempt failed; the reason is kept, and the backfill script queues it again.
        Failed => "failed",
        /// A taken-down site waiting for the job to remove its Worker; never shown to owners.
        Removing => "removing",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_values_round_trip() {
        for status in AddressStatus::ALL {
            assert_eq!(AddressStatus::parse(status.as_str()), Ok(*status));
        }
        assert!(AddressStatus::parse("gone").is_err());
    }
}
