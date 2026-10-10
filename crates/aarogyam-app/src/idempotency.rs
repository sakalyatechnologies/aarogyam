//! A client's own `client_id` on a create it may repeat after a lost answer (a chart batch, a
//! procedure, a prescription draft; migration 0625). The first request stores the id with a hash
//! of what it asked for; a retry with the same id and the same request finds that record and
//! returns it, and the same id for a different request is refused as `id_conflict`.

use aarogyam_dal::visits::ClientRecord;
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::tokens::hash_token;

/// The hash a request is stored and compared by: what it asks for, with the patient, as JSON.
pub(crate) fn request_hash(request: &Value) -> String {
    hash_token(&request.to_string())
}

/// What an earlier record with the client's id means for this request: the record to return
/// (the same patient and request), nothing when there is none, or `id_conflict`.
///
/// # Errors
/// [`AppError::IdConflict`] when the id made a record for another patient or another request.
pub(crate) fn replayed(
    found: Option<ClientRecord>,
    patient_id: Uuid,
    hash: &str,
) -> Result<Option<Uuid>, AppError> {
    match found {
        None => Ok(None),
        Some(record) if record.patient_id == patient_id && record.request_hash == hash => {
            Ok(Some(record.id))
        }
        Some(_) => Err(AppError::IdConflict),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_retry_is_the_same_request_and_anything_else_conflicts() {
        let patient = Uuid::now_v7();
        let hash = request_hash(&json!({ "patient": patient, "tooth": 16 }));
        assert_eq!(
            hash,
            request_hash(&json!({ "patient": patient, "tooth": 16 }))
        );
        assert_ne!(
            hash,
            request_hash(&json!({ "patient": patient, "tooth": 17 }))
        );
        let record = |patient_id, hash: &str| ClientRecord {
            id: Uuid::now_v7(),
            patient_id,
            request_hash: hash.to_owned(),
        };
        assert_eq!(replayed(None, patient, &hash).unwrap(), None);
        let first = record(patient, &hash);
        assert_eq!(
            replayed(Some(first.clone()), patient, &hash).unwrap(),
            Some(first.id)
        );
        assert!(matches!(
            replayed(Some(first.clone()), Uuid::now_v7(), &hash),
            Err(AppError::IdConflict)
        ));
        assert!(matches!(
            replayed(Some(first), patient, &request_hash(&json!({ "other": 1 }))),
            Err(AppError::IdConflict)
        ));
    }
}
