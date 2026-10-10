//! A staff member's own avatar: a preset id or a photo (PNG or JPEG, up to 2 MB) kept in file
//! storage under the clinic's folder, as the letterhead's images are. Photos are read through
//! short-lived signed links that name no one and need no sign-in, because an avatar holds no
//! patient data. Changing it needs no permission beyond membership: it is the member's own.

use aarogyam_dal::avatars as dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::avatar::{AvatarError, check_photo, check_preset};
use aarogyam_domain::ids::{AttachmentId, ClinicId};
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::files::{Files, LinkRefusal, StorageKey};
use crate::letterhead::{IMAGE_LINK_LIFETIME, Image, ImageLink, ImageRefusal};
use crate::scope::{public_scope, staff_scope};

/// A member's avatar as shown.
#[derive(Debug, Clone)]
pub struct Avatar {
    /// The preset id, when they chose one.
    pub preset: Option<String>,
    /// A link to their photo, when they uploaded one.
    pub photo: Option<ImageLink>,
}

/// What a member chose.
#[derive(Debug)]
pub enum Choice {
    /// A preset id.
    Preset(String),
    /// A photo's bytes.
    Photo(Vec<u8>),
}

/// The avatar to show for a membership's stored preset and photo, with a fresh link for the
/// photo. `None` when they have neither. `files` is `None` when storage is not configured: a
/// photo then shows nothing.
#[must_use]
pub fn view(
    files: Option<&Files>,
    clinic: ClinicId,
    preset: Option<String>,
    file_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Option<Avatar> {
    let expires_at = now + IMAGE_LINK_LIFETIME;
    let photo = file_id.zip(files).map(|(id, files)| ImageLink {
        id,
        token: files
            .signer()
            .sign_avatar(clinic, AttachmentId::from_uuid(id), expires_at),
        expires_at,
    });
    (preset.is_some() || photo.is_some()).then_some(Avatar { preset, photo })
}

/// Sets the caller's avatar, replacing the previous one; a replaced photo is removed from
/// storage afterwards.
///
/// # Errors
/// [`AppError::Invalid`] for a bad preset id or an empty, too large or unrecognised photo.
pub async fn set(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    choice: Choice,
    now: OffsetDateTime,
) -> Result<Option<Avatar>, AppError> {
    let (preset, photo) = match choice {
        Choice::Preset(text) => {
            let preset = check_preset(text.trim()).map_err(invalid)?.to_owned();
            (Some(preset), None)
        }
        Choice::Photo(bytes) => {
            let file_type = check_photo(&bytes).map_err(invalid)?;
            (
                None,
                Some((AttachmentId::new_v7(), file_type.mime_type(), bytes)),
            )
        }
    };
    let new_key = photo
        .as_ref()
        .map(|(id, _, _)| StorageKey::new(actor.clinic_id, *id));
    let saved = db
        .scoped(&staff_scope(actor, request_id), async |tx| {
            let previous = dal::lock(tx.conn(), actor.membership_id.uuid()).await?;
            if let (Some((_, _, bytes)), Some(key)) = (&photo, new_key) {
                files
                    .storage()
                    .put(key, bytes)
                    .await
                    .map_err(|_| AppError::Internal("could not store the photo"))?;
            }
            let stored = photo.as_ref().map(|(id, mime, _)| (id.uuid(), *mime));
            dal::set(
                tx.conn(),
                actor.membership_id.uuid(),
                preset.as_deref(),
                stored,
            )
            .await?;
            Ok::<_, AppError>(previous)
        })
        .await;
    match saved {
        Ok(previous) => {
            remove(files, actor.clinic_id, previous.file_id).await;
            let file_id = photo.as_ref().map(|(id, _, _)| id.uuid());
            Ok(view(Some(files), actor.clinic_id, preset, file_id, now))
        }
        Err(error) => {
            if let Some(key) = new_key {
                let _ = files.storage().delete(key).await;
            }
            Err(error)
        }
    }
}

/// Clears the caller's avatar.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn clear(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<(), AppError> {
    let previous = db
        .scoped(&staff_scope(actor, request_id), async |tx| {
            let previous = dal::lock(tx.conn(), actor.membership_id.uuid()).await?;
            dal::set(tx.conn(), actor.membership_id.uuid(), None, None).await?;
            Ok::<_, AppError>(previous)
        })
        .await?;
    remove(files, actor.clinic_id, previous.file_id).await;
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

fn invalid(error: AvatarError) -> AppError {
    AppError::invalid(error.field(), error)
}

/// Serves an avatar photo through its signed link, if a member still shows it.
///
/// # Errors
/// [`ImageRefusal`] when the link is wrong, expired, or the photo is no longer in use.
pub async fn image(
    db: &Db,
    files: &Files,
    clinic: ClinicId,
    request_id: Option<Uuid>,
    image_id: AttachmentId,
    token: &str,
    now: OffsetDateTime,
) -> Result<Image, ImageRefusal> {
    files
        .signer()
        .verify_avatar(clinic, image_id, token, now)
        .map_err(|refusal| match refusal {
            LinkRefusal::Expired => ImageRefusal::Expired,
            LinkRefusal::Invalid => ImageRefusal::NotFound,
        })?;
    let mime = db
        .scoped(&public_scope(clinic, request_id), async |tx| {
            Ok::<_, AppError>(dal::photo_mime(tx.conn(), image_id.uuid()).await?)
        })
        .await
        .map_err(ImageRefusal::Failed)?
        .ok_or(ImageRefusal::NotFound)?;
    let mime_type = if mime == "image/png" {
        "image/png"
    } else {
        "image/jpeg"
    };
    let bytes = files
        .storage()
        .get(StorageKey::new(clinic, image_id))
        .await
        .map_err(|_| ImageRefusal::Failed(AppError::Internal("could not read the photo")))?;
    Ok(Image { mime_type, bytes })
}
