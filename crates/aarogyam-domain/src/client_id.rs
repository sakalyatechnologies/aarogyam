//! Identifiers a client chooses itself.
//!
//! A phone that is offline creates records (a visit, a note, a recording) with ids of its own, so
//! later records can refer to earlier ones before anything reaches the server, and a retry can't
//! create a second copy. The ids are UUID version 7: any device can make one, and they sort by
//! time like the ids the server makes.

use sakalya_types::{Entity, Id};
use uuid::{Uuid, Variant};

/// A client-chosen identifier that is not a version 7 UUID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("must be a version 7 UUID, such as 0192f1c4-7b3a-7c2e-8f10-3a5d9e1b2c4d")]
pub struct NotVersion7;

/// Accepts `uuid` as the identifier of a `T` only when it is a version 7 UUID.
///
/// # Errors
/// [`NotVersion7`] for any other UUID, including the nil UUID and random (version 4) ones.
pub fn client_id<T: Entity>(uuid: Uuid) -> Result<Id<T>, NotVersion7> {
    if uuid.get_version_num() == 7 && uuid.get_variant() == Variant::RFC4122 {
        Ok(Id::from_uuid(uuid))
    } else {
        Err(NotVersion7)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Encounter;

    #[test]
    fn accepts_version_7_only() {
        assert!(client_id::<Encounter>(Uuid::now_v7()).is_ok());
        assert!(
            client_id::<Encounter>(uuid::uuid!("0192f1c4-7b3a-7c2e-8f10-3a5d9e1b2c4d")).is_ok()
        );
        assert_eq!(
            client_id::<Encounter>(uuid::uuid!("a0000000-0000-4000-8000-000000000001")),
            Err(NotVersion7)
        );
        assert_eq!(client_id::<Encounter>(Uuid::nil()), Err(NotVersion7));
        assert_eq!(client_id::<Encounter>(Uuid::max()), Err(NotVersion7));
        // Version 7 digits with another variant are not RFC 9562 UUIDs.
        assert_eq!(
            client_id::<Encounter>(uuid::uuid!("0192f1c4-7b3a-7c2e-0f10-3a5d9e1b2c4d")),
            Err(NotVersion7)
        );
    }
}
