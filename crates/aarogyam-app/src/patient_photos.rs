//! A patient's own photo: PNG or JPEG of at most 2 MB, kept in file storage under the clinic's
//! folder beside the patient files. Unlike a staff avatar it is patient data, so it is read
//! only through the API after a permission check, never through a signed link.

use aarogyam_dal::patient_photos::{self as dal, NewPhoto};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::avatar::check_photo;
use aarogyam_domain::ids::{AttachmentId, ClinicId, PatientId};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::files::{Files, StorageKey, sha256_hex};
use crate::scope::staff_scope as scope;
use crate::visits::require_patient;

/// A patient's photo.
#[derive(Debug, Clone)]
pub struct Photo {
    /// `image/png` or `image/jpeg`.
    pub mime_type: &'static str,
    /// The bytes.
    pub bytes: Vec<u8>,
}

fn mime_type(stored: &str) -> &'static str {
    if stored == "image/png" {
        "image/png"
    } else {
        "image/jpeg"
    }
}

/// Sets the patient's photo, replacing the old one (its bytes are removed afterwards). Needs
/// `patients.write`.
///
/// # Errors
/// [`AppError::Invalid`] for an empty, too large or unrecognised image;
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach.
pub async fn put(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    bytes: Vec<u8>,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    let file_type = check_photo(&bytes).map_err(|error| AppError::invalid(error.field(), error))?;
    let size = i64::try_from(bytes.len()).map_err(|_| AppError::Internal("file size"))?;
    let sha256 = sha256_hex(&bytes);
    let id = AttachmentId::new_v7();
    let key = StorageKey::new(actor.clinic_id, id);
    let reach = actor.reach(Permission::PatientsWrite);
    let saved = db
        .scoped(&scope(actor, request_id), async |tx| {
            require_patient(tx, patient_id, reach).await?;
            files
                .storage()
                .put(key, &bytes)
                .await
                .map_err(|_| AppError::Internal("could not store the photo"))?;
            let previous = dal::delete(tx.conn(), patient_id.uuid()).await?;
            dal::insert(
                tx.conn(),
                &NewPhoto {
                    id: id.uuid(),
                    patient_id: patient_id.uuid(),
                    mime_type: file_type.mime_type(),
                    size_bytes: size,
                    sha256: &sha256,
                },
            )
            .await?;
            Ok::<_, AppError>(previous)
        })
        .await;
    match saved {
        Ok(previous) => {
            remove(files, actor.clinic_id, previous).await;
            Ok(())
        }
        Err(error) => {
            // Nothing points at the bytes; a failed clean-up only leaves an orphan file.
            let _ = files.storage().delete(key).await;
            Err(error)
        }
    }
}

/// The patient's photo. Needs `patients.read`. Sakalya staff under a support grant don't read
/// photos.
///
/// # Errors
/// [`AppError::NotFound`] when the patient has no photo, isn't in this clinic or is out of
/// reach; [`AppError::Forbidden`] under a support grant.
pub async fn get(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Photo, AppError> {
    actor.require(Permission::PatientsRead)?;
    if actor.support_grant.is_some() {
        return Err(AppError::Forbidden("Support access doesn't read photos."));
    }
    let reach = actor.reach(Permission::PatientsRead).member();
    let row = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(dal::get(tx.conn(), patient_id.uuid(), reach).await?)
        })
        .await?
        .ok_or(AppError::NotFound("photo"))?;
    let bytes = files
        .storage()
        .get(StorageKey::new(
            actor.clinic_id,
            AttachmentId::from_uuid(row.id),
        ))
        .await
        .map_err(|_| AppError::Internal("could not read the photo"))?;
    Ok(Photo {
        mime_type: mime_type(&row.mime_type),
        bytes,
    })
}

/// Removes the patient's photo; removing none is fine. Needs `patients.write`.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach.
pub async fn delete(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    let reach = actor.reach(Permission::PatientsWrite);
    let previous = db
        .scoped(&scope(actor, request_id), async |tx| {
            require_patient(tx, patient_id, reach).await?;
            Ok::<_, AppError>(dal::delete(tx.conn(), patient_id.uuid()).await?)
        })
        .await?;
    remove(files, actor.clinic_id, previous).await;
    Ok(())
}

/// A failed clean-up only leaves an orphan file.
async fn remove(files: &Files, clinic: ClinicId, file_id: Option<Uuid>) {
    if let Some(id) = file_id {
        let _ = files
            .storage()
            .delete(StorageKey::new(clinic, AttachmentId::from_uuid(id)))
            .await;
    }
}
