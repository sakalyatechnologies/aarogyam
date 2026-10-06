//! The clinic's letterhead: uploading its images and resolving what a document prints. The
//! images live in file storage under the clinic's folder; pages show them through signed links
//! that need no sign-in, because a letterhead holds no patient data.

use aarogyam_dal::settings as dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinic::Address;
use aarogyam_domain::ids::{AttachmentId, ClinicId};
use aarogyam_domain::letterhead::{ImageRef, Letterhead, LetterheadMode, check_image};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use serde_json::Value;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::AppError;
use crate::files::{Files, LinkRefusal, StorageKey};
use crate::scope::{public_scope, staff_scope};
use crate::settings::put_value;

/// How long a letterhead image link works.
pub const IMAGE_LINK_LIFETIME: Duration = Duration::hours(1);

/// Which picture of the letterhead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// The full letterhead image used in upload mode.
    Letterhead,
    /// The logo used by generated designs.
    Logo,
}

impl Slot {
    /// Parses `letterhead` or `logo`.
    ///
    /// # Errors
    /// [`AppError::Invalid`] for anything else.
    pub fn parse(text: &str) -> Result<Self, AppError> {
        match text {
            "letterhead" => Ok(Self::Letterhead),
            "logo" => Ok(Self::Logo),
            _ => Err(AppError::invalid("slot", "must be letterhead or logo")),
        }
    }
}

fn read(branding: &Value) -> Letterhead {
    Letterhead::from_value(branding.get("letterhead").unwrap_or(&Value::Null))
}

/// Stores a letterhead or logo image (PNG or JPEG, up to 2 MB) and returns the new settings
/// object. The previous image of the slot is removed afterwards.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for an empty, too large
/// or unrecognised image.
pub async fn upload_image(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    slot: Slot,
    bytes: Vec<u8>,
) -> Result<Letterhead, AppError> {
    actor.require(Permission::SettingsManage)?;
    let file_type = check_image(&bytes).map_err(|error| AppError::invalid(error.field(), error))?;
    let id = AttachmentId::new_v7();
    let key = StorageKey::new(actor.clinic_id, id);
    let image = ImageRef {
        id: id.uuid(),
        file_type,
        size_bytes: bytes.len(),
    };
    let saved = db
        .scoped(&staff_scope(actor, request_id), async |tx| {
            let mut row = dal::get_for_update(tx.conn())
                .await?
                .ok_or(AppError::NotFound("clinic"))?;
            let mut letterhead = read(&row.branding);
            let previous = match slot {
                Slot::Letterhead => letterhead.image.replace(image),
                Slot::Logo => letterhead.logo.replace(image),
            };
            files
                .storage()
                .put(key, &bytes)
                .await
                .map_err(|_| AppError::Internal("could not store the image"))?;
            put_value(&mut row.branding, "letterhead", letterhead.to_value());
            dal::save(tx.conn(), &row).await?;
            Ok::<_, AppError>((letterhead, previous))
        })
        .await;
    match saved {
        Ok((letterhead, previous)) => {
            if let Some(previous) = previous {
                // A failed clean-up only leaves an orphan file.
                let _ = files
                    .storage()
                    .delete(StorageKey::new(
                        actor.clinic_id,
                        AttachmentId::from_uuid(previous.id),
                    ))
                    .await;
            }
            Ok(letterhead)
        }
        Err(error) => {
            let _ = files.storage().delete(key).await;
            Err(error)
        }
    }
}

/// Removes a letterhead or logo image. Upload mode falls back to the generated design.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`.
pub async fn remove_image(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    slot: Slot,
) -> Result<Letterhead, AppError> {
    actor.require(Permission::SettingsManage)?;
    let (letterhead, previous) = db
        .scoped(&staff_scope(actor, request_id), async |tx| {
            let mut row = dal::get_for_update(tx.conn())
                .await?
                .ok_or(AppError::NotFound("clinic"))?;
            let mut letterhead = read(&row.branding);
            let previous = match slot {
                Slot::Letterhead => letterhead.image.take(),
                Slot::Logo => letterhead.logo.take(),
            };
            if letterhead.image.is_none() {
                letterhead.mode = LetterheadMode::Template;
            }
            put_value(&mut row.branding, "letterhead", letterhead.to_value());
            dal::save(tx.conn(), &row).await?;
            Ok::<_, AppError>((letterhead, previous))
        })
        .await?;
    if let Some(previous) = previous {
        let _ = files
            .storage()
            .delete(StorageKey::new(
                actor.clinic_id,
                AttachmentId::from_uuid(previous.id),
            ))
            .await;
    }
    Ok(letterhead)
}

/// A doctor as printed on the letterhead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoctorLine {
    /// Name.
    pub name: String,
    /// Degrees, such as `BDS, MDS`.
    pub qualifications: Option<String>,
    /// Council registration number.
    pub registration_number: Option<String>,
    /// Specialty.
    pub specialty: Option<String>,
}

/// A picture with its signed link token.
#[derive(Debug, Clone)]
pub struct ImageLink {
    /// The image.
    pub id: Uuid,
    /// The token for the content route.
    pub token: String,
    /// When the token stops working.
    pub expires_at: OffsetDateTime,
}

/// Everything a document needs to print the clinic's header and footer.
#[derive(Debug, Clone)]
pub struct Document {
    /// Display name.
    pub name: String,
    /// Registered legal name.
    pub legal_name: Option<String>,
    /// GSTIN.
    pub gstin: Option<String>,
    /// The main branch's address.
    pub address: Address,
    /// The main branch's phone.
    pub phone: Option<String>,
    /// The portal brand colour, used when the letterhead has no accent.
    pub brand: Option<String>,
    /// The letterhead settings.
    pub letterhead: Letterhead,
    /// The doctors to print, in order.
    pub doctors: Vec<DoctorLine>,
    /// Link to the uploaded letterhead image, in upload mode.
    pub image: Option<ImageLink>,
    /// Link to the logo.
    pub logo: Option<ImageLink>,
}

fn text(object: &Value, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

async fn document_in(
    tx: &mut sakalya_db::ScopedTx,
    files: &Files,
    clinic: ClinicId,
    now: OffsetDateTime,
) -> Result<Document, AppError> {
    let (row, doctors) = dal::get_with_doctors(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    let letterhead = read(&row.branding);
    let chosen: Vec<_> = if letterhead.doctor_ids.is_empty() {
        doctors
    } else {
        letterhead
            .doctor_ids
            .iter()
            .filter_map(|id| doctors.iter().find(|doctor| doctor.id == *id).cloned())
            .collect()
    };
    let expires_at = now + IMAGE_LINK_LIFETIME;
    let link = |image: Option<ImageRef>| {
        image.map(|image| ImageLink {
            id: image.id,
            token: files
                .signer()
                .sign_image(clinic, AttachmentId::from_uuid(image.id), expires_at),
            expires_at,
        })
    };
    let address = row.address.unwrap_or(Value::Null);
    Ok(Document {
        name: row.name,
        legal_name: row.legal_name,
        gstin: row.gstin,
        address: Address {
            line1: text(&address, "line1"),
            line2: text(&address, "line2"),
            city: text(&address, "city"),
            state: text(&address, "state"),
            pincode: text(&address, "pincode"),
        },
        phone: row.phone_e164,
        brand: text(&row.branding, "brand"),
        image: if letterhead.mode == LetterheadMode::Upload {
            link(letterhead.image)
        } else {
            None
        },
        logo: link(letterhead.logo),
        doctors: chosen
            .into_iter()
            .take(aarogyam_domain::letterhead::MAX_DOCTORS)
            .map(|doctor| DoctorLine {
                name: doctor.display_name,
                qualifications: doctor.qualifications,
                registration_number: doctor.registration_number,
                specialty: doctor.specialty,
            })
            .collect(),
        letterhead,
    })
}

/// What a clinic document prints, for a signed-in member who works with patients.
///
/// # Errors
/// [`AppError::Denied`] without `patients.read`.
pub async fn document(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Document, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        document_in(tx, files, actor.clinic_id, now).await
    })
    .await
}

/// What the clinic's public pages print: the same letterhead, for someone with a share link on
/// the clinic's host. It holds no patient data.
///
/// # Errors
/// [`AppError::NotFound`] when the clinic has no settings.
pub async fn public_document(
    db: &Db,
    files: &Files,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Document, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        document_in(tx, files, clinic_id, now).await
    })
    .await
}

/// A letterhead image's bytes.
#[derive(Debug, Clone)]
pub struct Image {
    /// `image/png` or `image/jpeg`.
    pub mime_type: &'static str,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// Why an image link did not work.
#[derive(Debug)]
pub enum ImageRefusal {
    /// The link has expired.
    Expired,
    /// Not a valid link for an image of this clinic.
    NotFound,
    /// Something failed.
    Failed(AppError),
}

/// Serves a letterhead image through its signed link, if it is still one of the clinic's images.
///
/// # Errors
/// [`ImageRefusal`] when the link is wrong, expired, or the image is no longer in use.
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
        .verify_image(clinic, image_id, token, now)
        .map_err(|refusal| match refusal {
            LinkRefusal::Expired => ImageRefusal::Expired,
            LinkRefusal::Invalid => ImageRefusal::NotFound,
        })?;
    let file_type = db
        .scoped(&public_scope(clinic, request_id), async |tx| {
            let row = dal::get(tx.conn())
                .await?
                .ok_or(AppError::NotFound("clinic"))?;
            let letterhead = read(&row.branding);
            [letterhead.image, letterhead.logo]
                .into_iter()
                .flatten()
                .find(|image| image.id == image_id.uuid())
                .map(|image| image.file_type)
                .ok_or(AppError::NotFound("image"))
        })
        .await
        .map_err(|error| match error {
            AppError::NotFound(_) => ImageRefusal::NotFound,
            other => ImageRefusal::Failed(other),
        })?;
    let bytes = files
        .storage()
        .get(StorageKey::new(clinic, image_id))
        .await
        .map_err(|_| ImageRefusal::Failed(AppError::Internal("could not read the image")))?;
    Ok(Image {
        mime_type: file_type.mime_type(),
        bytes,
    })
}
