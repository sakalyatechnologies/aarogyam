//! Patient files: upload, list, and download through short-lived signed links.
//!
//! The bytes live behind [`Storage`]: local disk in development ([`LocalDisk`]), a private
//! Supabase Storage bucket in the cloud ([`SupabaseStorage`]). Keys are made by the server from ids (`<clinic>/<attachment>`),
//! never from a file name. A download link carries an HMAC over the clinic, the file, the
//! member and an expiry five minutes ahead; opening it streams the file and writes the access
//! record.

mod supabase;

pub use supabase::SupabaseStorage;

use std::fmt::{self, Write as _};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use aarogyam_dal::attachments::{self, AttachmentRow, NewAttachment};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{
    AttachmentKind, NoteState, NoteStatus, RecordSource, optional_text,
};
use aarogyam_domain::dental::Tooth;
use aarogyam_domain::files::{FileType, MAX_BYTES, MAX_VOICE_SECONDS, VoiceLanguage};
use aarogyam_domain::ids::{
    AttachmentId, ClinicId, ClinicalNoteId, EncounterId, MembershipId, NoteAddendumId, PatientId,
    ShareLinkId, UserId,
};
use aarogyam_domain::permission::Permission;
use aws_lc_rs::{digest, hmac, rand};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sakalya_db::{Db, DbErrorKind, Scope};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::{STAFF, staff_scope as scope};
use crate::visits::{invalid, refused, require_patient};

/// How long a download link works.
pub const LINK_LIFETIME: Duration = Duration::minutes(5);

/// Where a file's bytes are kept: `<clinic id>/<attachment id>`, both made by the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageKey {
    clinic: Uuid,
    attachment: Uuid,
}

impl StorageKey {
    /// The key for an attachment of a clinic.
    #[must_use]
    pub const fn new(clinic: ClinicId, attachment: AttachmentId) -> Self {
        Self {
            clinic: clinic.uuid(),
            attachment: attachment.uuid(),
        }
    }

    /// The clinic's folder.
    #[must_use]
    pub fn folder(&self) -> String {
        self.clinic.to_string()
    }

    /// The file's name within the folder.
    #[must_use]
    pub fn name(&self) -> String {
        self.attachment.to_string()
    }
}

impl fmt::Display for StorageKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.clinic, self.attachment)
    }
}

/// Storage failed. The message never names a path or a patient.
#[derive(Debug, thiserror::Error)]
#[error("file storage failed: {0}")]
pub struct StorageError(&'static str);

/// A boxed future, so [`Storage`] can be used as a trait object.
pub type StorageFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, StorageError>> + Send + 'a>>;

/// Where file bytes are kept.
pub trait Storage: Send + Sync + fmt::Debug {
    /// Stores the bytes under `key`, replacing nothing: keys are new ids.
    fn put<'a>(&'a self, key: StorageKey, bytes: &'a [u8]) -> StorageFuture<'a, ()>;
    /// Reads the bytes under `key`.
    fn get(&self, key: StorageKey) -> StorageFuture<'_, Vec<u8>>;
    /// Removes the bytes under `key`, if any.
    fn delete(&self, key: StorageKey) -> StorageFuture<'_, ()>;
}

/// Files on the local disk under one directory, for development.
#[derive(Debug, Clone)]
pub struct LocalDisk {
    root: PathBuf,
}

impl LocalDisk {
    /// Files under `root`, which is created when the first file is stored.
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn path(&self, key: StorageKey) -> PathBuf {
        self.root.join(key.folder()).join(key.name())
    }
}

impl Storage for LocalDisk {
    fn put<'a>(&'a self, key: StorageKey, bytes: &'a [u8]) -> StorageFuture<'a, ()> {
        Box::pin(async move {
            let folder = self.root.join(key.folder());
            tokio::fs::create_dir_all(&folder)
                .await
                .map_err(|_| StorageError("could not create the folder"))?;
            // Written under a temporary name and renamed, so a reader never sees half a file.
            let partial = folder.join(format!("{}.partial", key.name()));
            tokio::fs::write(&partial, bytes)
                .await
                .map_err(|_| StorageError("could not write the file"))?;
            tokio::fs::rename(&partial, self.path(key))
                .await
                .map_err(|_| StorageError("could not move the file into place"))
        })
    }

    fn get(&self, key: StorageKey) -> StorageFuture<'_, Vec<u8>> {
        Box::pin(async move {
            tokio::fs::read(self.path(key))
                .await
                .map_err(|_| StorageError("could not read the file"))
        })
    }

    fn delete(&self, key: StorageKey) -> StorageFuture<'_, ()> {
        Box::pin(async move {
            match tokio::fs::remove_file(self.path(key)).await {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    Err(StorageError("could not remove the file"))
                }
                _ => Ok(()),
            }
        })
    }
}

/// Signs and checks download links.
#[derive(Clone)]
pub struct LinkSigner {
    key: hmac::Key,
}

impl fmt::Debug for LinkSigner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LinkSigner(***)")
    }
}

/// Why a download link was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkRefusal {
    /// Not signed by this server for this clinic and file.
    Invalid,
    /// Signed, but past its expiry.
    Expired,
}

/// What a valid link grants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkGrant {
    /// The member it was issued to.
    pub user_id: UserId,
}

impl LinkSigner {
    /// A signer with this secret (at least 32 bytes).
    ///
    /// # Errors
    /// [`AppError::Internal`] when the secret is shorter.
    pub fn new(secret: &[u8]) -> Result<Self, AppError> {
        if secret.len() < 32 {
            return Err(AppError::Internal(
                "the download signing key needs 32 bytes",
            ));
        }
        Ok(Self {
            key: hmac::Key::new(hmac::HMAC_SHA256, secret),
        })
    }

    /// A signer with a random secret: links work only on this process, which is enough for
    /// local development and tests.
    ///
    /// # Errors
    /// [`AppError::Internal`] if the random number generator fails.
    pub fn random() -> Result<Self, AppError> {
        let mut secret = [0_u8; 32];
        rand::fill(&mut secret)
            .map_err(|_| AppError::Internal("random number generator failed"))?;
        Self::new(&secret)
    }

    fn message(clinic: ClinicId, attachment: AttachmentId, user: UserId, expires: i64) -> String {
        format!(
            "attachment-download:v1|{}|{}|{}|{expires}",
            clinic.uuid(),
            attachment.uuid(),
            user.uuid()
        )
    }

    /// A token for `user` to download `attachment` of `clinic` until `expires`.
    #[must_use]
    pub fn sign(
        &self,
        clinic: ClinicId,
        attachment: AttachmentId,
        user: UserId,
        expires: OffsetDateTime,
    ) -> String {
        let expires = expires.unix_timestamp();
        let tag = hmac::sign(
            &self.key,
            Self::message(clinic, attachment, user, expires).as_bytes(),
        );
        format!(
            "{expires}.{}.{}",
            user.uuid().simple(),
            URL_SAFE_NO_PAD.encode(tag.as_ref())
        )
    }

    /// Checks a token for `attachment` of `clinic` at `now`.
    ///
    /// # Errors
    /// [`LinkRefusal::Invalid`] unless this server signed it for this clinic and file;
    /// [`LinkRefusal::Expired`] once it is past its expiry.
    pub fn verify(
        &self,
        clinic: ClinicId,
        attachment: AttachmentId,
        token: &str,
        now: OffsetDateTime,
    ) -> Result<LinkGrant, LinkRefusal> {
        let mut parts = token.trim().splitn(3, '.');
        let (Some(expires), Some(user), Some(tag)) = (parts.next(), parts.next(), parts.next())
        else {
            return Err(LinkRefusal::Invalid);
        };
        let expires: i64 = expires.parse().map_err(|_| LinkRefusal::Invalid)?;
        let user = UserId::from_uuid(Uuid::try_parse(user).map_err(|_| LinkRefusal::Invalid)?);
        let tag = URL_SAFE_NO_PAD
            .decode(tag)
            .map_err(|_| LinkRefusal::Invalid)?;
        hmac::verify(
            &self.key,
            Self::message(clinic, attachment, user, expires).as_bytes(),
            &tag,
        )
        .map_err(|_| LinkRefusal::Invalid)?;
        if now.unix_timestamp() > expires {
            return Err(LinkRefusal::Expired);
        }
        Ok(LinkGrant { user_id: user })
    }
}

impl LinkSigner {
    fn image_message(kind: &str, clinic: ClinicId, image: AttachmentId, expires: i64) -> String {
        format!("{kind}:v1|{}|{}|{expires}", clinic.uuid(), image.uuid())
    }

    fn sign_picture(
        &self,
        kind: &str,
        clinic: ClinicId,
        image: AttachmentId,
        expires: OffsetDateTime,
    ) -> String {
        let expires = expires.unix_timestamp();
        let tag = hmac::sign(
            &self.key,
            Self::image_message(kind, clinic, image, expires).as_bytes(),
        );
        format!("{expires}.{}", URL_SAFE_NO_PAD.encode(tag.as_ref()))
    }

    fn verify_picture(
        &self,
        kind: &str,
        clinic: ClinicId,
        image: AttachmentId,
        token: &str,
        now: OffsetDateTime,
    ) -> Result<(), LinkRefusal> {
        let (expires, tag) = token.trim().split_once('.').ok_or(LinkRefusal::Invalid)?;
        let expires: i64 = expires.parse().map_err(|_| LinkRefusal::Invalid)?;
        let tag = URL_SAFE_NO_PAD
            .decode(tag)
            .map_err(|_| LinkRefusal::Invalid)?;
        hmac::verify(
            &self.key,
            Self::image_message(kind, clinic, image, expires).as_bytes(),
            &tag,
        )
        .map_err(|_| LinkRefusal::Invalid)?;
        if now.unix_timestamp() > expires {
            return Err(LinkRefusal::Expired);
        }
        Ok(())
    }

    /// A token for an X-ray of the patient behind share link `link`, shown on that link's page
    /// until `expires`. It names no member: the link's PIN was the proof.
    #[must_use]
    pub fn sign_share_file(
        &self,
        clinic: ClinicId,
        link: ShareLinkId,
        file: AttachmentId,
        expires: OffsetDateTime,
    ) -> String {
        self.sign_picture(
            &format!("share-file-{}", link.uuid().simple()),
            clinic,
            file,
            expires,
        )
    }

    /// Checks a share-link file token at `now`.
    ///
    /// # Errors
    /// [`LinkRefusal::Invalid`] unless signed by this server for this clinic, link and file;
    /// [`LinkRefusal::Expired`] once past its expiry.
    pub fn verify_share_file(
        &self,
        clinic: ClinicId,
        link: ShareLinkId,
        file: AttachmentId,
        token: &str,
        now: OffsetDateTime,
    ) -> Result<(), LinkRefusal> {
        self.verify_picture(
            &format!("share-file-{}", link.uuid().simple()),
            clinic,
            file,
            token,
            now,
        )
    }

    /// A token to show a staff member's avatar photo (not patient data, so it names no one)
    /// until `expires`.
    #[must_use]
    pub fn sign_avatar(
        &self,
        clinic: ClinicId,
        image: AttachmentId,
        expires: OffsetDateTime,
    ) -> String {
        self.sign_picture("avatar-image", clinic, image, expires)
    }

    /// Checks an avatar photo token at `now`.
    ///
    /// # Errors
    /// [`LinkRefusal::Invalid`] unless signed by this server for this clinic and photo;
    /// [`LinkRefusal::Expired`] once past its expiry.
    pub fn verify_avatar(
        &self,
        clinic: ClinicId,
        image: AttachmentId,
        token: &str,
        now: OffsetDateTime,
    ) -> Result<(), LinkRefusal> {
        self.verify_picture("avatar-image", clinic, image, token, now)
    }

    /// A token to show a clinic's letterhead image (not patient data, so it names no member)
    /// until `expires`.
    #[must_use]
    pub fn sign_image(
        &self,
        clinic: ClinicId,
        image: AttachmentId,
        expires: OffsetDateTime,
    ) -> String {
        self.sign_picture("letterhead-image", clinic, image, expires)
    }

    /// Checks a letterhead image token at `now`.
    ///
    /// # Errors
    /// [`LinkRefusal::Invalid`] unless signed by this server for this clinic and image;
    /// [`LinkRefusal::Expired`] once past its expiry.
    pub fn verify_image(
        &self,
        clinic: ClinicId,
        image: AttachmentId,
        token: &str,
        now: OffsetDateTime,
    ) -> Result<(), LinkRefusal> {
        self.verify_picture("letterhead-image", clinic, image, token, now)
    }
}

/// Where files go and how their links are signed.
#[derive(Debug, Clone)]
pub struct Files {
    storage: Arc<dyn Storage>,
    signer: LinkSigner,
}

impl Files {
    /// Files in `storage`, with links signed by `signer`.
    #[must_use]
    pub fn new(storage: Arc<dyn Storage>, signer: LinkSigner) -> Self {
        Self { storage, signer }
    }

    /// Where the bytes are kept; website pictures use it too, under their own keys.
    pub(crate) fn storage(&self) -> &Arc<dyn Storage> {
        &self.storage
    }

    /// The link signer.
    #[must_use]
    pub const fn signer(&self) -> &LinkSigner {
        &self.signer
    }
}

/// A patient file's details (never its bytes or storage key).
#[derive(Debug, Clone)]
pub struct AttachmentView {
    /// Identifier.
    pub id: AttachmentId,
    /// The visit it belongs to.
    pub visit_id: Option<EncounterId>,
    /// What it is.
    pub kind: AttachmentKind,
    /// Its type, from its content.
    pub file_type: FileType,
    /// Its size.
    pub size_bytes: i64,
    /// SHA-256 of the content, hex.
    pub sha256: String,
    /// A caption.
    pub caption: Option<String>,
    /// Its label, such as `OPG`.
    pub label: Option<String>,
    /// The tooth it shows.
    pub tooth: Option<Tooth>,
    /// When it was taken.
    pub taken_at: Option<OffsetDateTime>,
    /// When it was uploaded.
    pub created_at: OffsetDateTime,
    /// The note a recording belongs to.
    pub note_id: Option<ClinicalNoteId>,
    /// The addendum a recording belongs to, when its note is signed.
    pub addendum_id: Option<NoteAddendumId>,
    /// A recording's length in seconds.
    pub duration_seconds: Option<i32>,
    /// The language a recording is spoken in.
    pub language: Option<VoiceLanguage>,
    /// Whether the clinic shares it with the patient in the patient app.
    pub shared_with_patient: bool,
}

fn view(row: AttachmentRow) -> Result<AttachmentView, AppError> {
    Ok(AttachmentView {
        id: AttachmentId::from_uuid(row.id),
        visit_id: row.encounter_id.map(EncounterId::from_uuid),
        kind: AttachmentKind::parse(&row.kind).map_err(invalid("kind"))?,
        file_type: FileType::from_mime_type(&row.mime_type)
            .ok_or(AppError::Internal("a stored file has an unknown type"))?,
        size_bytes: row.size_bytes,
        sha256: row.sha256,
        caption: row.caption,
        label: row.label,
        tooth: row.tooth.and_then(|n| Tooth::new(i64::from(n)).ok()),
        taken_at: row.taken_at,
        created_at: row.created_at,
        note_id: row.note_id.map(ClinicalNoteId::from_uuid),
        addendum_id: row.addendum_id.map(NoteAddendumId::from_uuid),
        duration_seconds: row.duration_seconds,
        language: row.language.as_deref().and_then(VoiceLanguage::parse),
        shared_with_patient: row.shared_with_patient,
    })
}

/// The files of a visit.
pub(crate) async fn of_visit(
    tx: &mut sakalya_db::ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<AttachmentView>, AppError> {
    attachments::of_encounter(tx.conn(), encounter_id)
        .await?
        .into_iter()
        .map(view)
        .collect()
}

/// A file as received.
#[derive(Debug, Clone, Default)]
pub struct Upload {
    /// An identifier the client made (version 7), so a retry returns this file's record instead
    /// of storing another; the server makes one when absent.
    pub id: Option<AttachmentId>,
    /// The bytes.
    pub bytes: Vec<u8>,
    /// `photo`, `xray`, `report`, `document` (default), `audio` or `consent`.
    pub kind: Option<String>,
    /// The visit it belongs to.
    pub visit_id: Option<Uuid>,
    /// A caption.
    pub caption: Option<String>,
    /// A label, up to 60 characters.
    pub label: Option<String>,
    /// The tooth it shows.
    pub tooth: Option<i64>,
    /// The note a recording belongs to; its visit is the recording's visit.
    pub note_id: Option<Uuid>,
    /// The addendum a recording belongs to; required for a signed note.
    pub addendum_id: Option<Uuid>,
    /// A recording's length in seconds (1 to 600); required for audio.
    pub duration_seconds: Option<i32>,
    /// `en-IN`, `hi-IN`, `mr-IN` or `gu-IN`.
    pub language: Option<String>,
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    digest::digest(&digest::SHA256, bytes).as_ref().iter().fold(
        String::with_capacity(64),
        |mut hex, byte| {
            // Writing to a String can't fail.
            let _ = write!(hex, "{byte:02x}");
            hex
        },
    )
}

/// The kind and spoken language a file's fields say, which must agree with its content.
fn check_kind_and_recording(
    input: &Upload,
    file_type: FileType,
) -> Result<(AttachmentKind, Option<VoiceLanguage>), AppError> {
    let kind = match input.kind.as_deref() {
        Some(text) => AttachmentKind::parse(text.trim()).map_err(invalid("kind"))?,
        None if file_type.is_audio() => AttachmentKind::Audio,
        None => AttachmentKind::Document,
    };
    if file_type.is_audio() != (kind == AttachmentKind::Audio) {
        return Err(AppError::invalid(
            "kind",
            "audio files are kind audio, and only they",
        ));
    }
    let language = input
        .language
        .as_deref()
        .map(|text| {
            VoiceLanguage::parse(text.trim()).ok_or_else(|| {
                AppError::invalid("language", "must be en-IN, hi-IN, mr-IN or gu-IN")
            })
        })
        .transpose()?;
    if file_type.is_audio() {
        match input.duration_seconds {
            Some(1..=MAX_VOICE_SECONDS) => {}
            _ => return Err(AppError::invalid("duration_seconds", "must be 1 to 600")),
        }
    } else if input.duration_seconds.is_some() || language.is_some() {
        return Err(AppError::invalid(
            "duration_seconds",
            "only a recording has a length and language",
        ));
    }
    if input.note_id.is_none() && input.addendum_id.is_some() {
        return Err(AppError::invalid("addendum_id", "needs a note_id"));
    }
    Ok((kind, language))
}

/// What an upload says once its fields are checked, to compare with a stored file when the
/// client retries.
struct Described<'a> {
    patient_id: Uuid,
    input: &'a Upload,
    kind: AttachmentKind,
    file_type: FileType,
    size: i64,
    sha256: &'a str,
    caption: Option<&'a str>,
    label: Option<&'a str>,
    tooth: Option<i16>,
    language: Option<VoiceLanguage>,
}

impl Described<'_> {
    fn matches(&self, row: &AttachmentRow) -> bool {
        let input = self.input;
        row.patient_id == self.patient_id
            && row.kind == self.kind.as_str()
            && row.mime_type == self.file_type.mime_type()
            && row.size_bytes == self.size
            && row.sha256 == self.sha256
            && row.caption.as_deref() == self.caption
            && row.label.as_deref() == self.label
            && row.tooth == self.tooth
            && row.note_id == input.note_id
            && row.addendum_id == input.addendum_id
            && row.duration_seconds == input.duration_seconds
            && row.language.as_deref() == self.language.map(VoiceLanguage::as_str)
            // A recording's visit is its note's; any other file's is the one named, if any.
            && if input.note_id.is_some() {
                input.visit_id.is_none_or(|visit| row.encounter_id == Some(visit))
            } else {
                row.encounter_id == input.visit_id
            }
    }
}

/// The stored file a retry refers to, when the client-chosen `id` already has one.
async fn replayed(
    tx: &mut sakalya_db::ScopedTx,
    id: AttachmentId,
    described: &Described<'_>,
    member: Option<Uuid>,
) -> Result<Option<AttachmentView>, AppError> {
    aarogyam_dal::visits::lock_client_id(tx.conn(), id.uuid()).await?;
    let Some(row) = attachments::get(tx.conn(), id.uuid(), member).await? else {
        return Ok(None);
    };
    if described.matches(&row) {
        view(row).map(Some)
    } else {
        Err(AppError::IdConflict)
    }
}

/// An upload's fields once checked.
struct Checked {
    file_type: FileType,
    kind: AttachmentKind,
    language: Option<VoiceLanguage>,
    caption: Option<String>,
    label: Option<String>,
    tooth: Option<Tooth>,
}

fn check_fields(input: &Upload) -> Result<Checked, AppError> {
    if input.bytes.is_empty() || input.bytes.len() > MAX_BYTES {
        return Err(AppError::invalid("file", "must be 1 byte to 10 MB"));
    }
    let file_type = FileType::sniff(&input.bytes).ok_or_else(|| {
        AppError::invalid("file", "must be a JPEG, PNG, PDF, DICOM or audio recording")
    })?;
    let (kind, language) = check_kind_and_recording(input, file_type)?;
    let caption = optional_text(input.caption.as_deref(), 300).map_err(invalid("caption"))?;
    let label = optional_text(input.label.as_deref(), 60).map_err(invalid("label"))?;
    let tooth = input
        .tooth
        .map(Tooth::new)
        .transpose()
        .map_err(|error| AppError::invalid("tooth", error))?;
    Ok(Checked {
        file_type,
        kind,
        language,
        caption,
        label,
        tooth,
    })
}

/// Stores a patient file. Its type comes from its content: JPEG, PNG, PDF, DICOM or a `WebM`,
/// `MP4` or `Ogg` recording. A recording may be linked to a note of the same visit: a draft only by its
/// author, a signed note only through one of the uploader's own addenda. A retry with the same
/// client-chosen `id` and the same content returns the stored file's record and keeps its bytes.
///
/// # Errors
/// [`AppError::Invalid`] for an empty, too large or unrecognised file, or a visit of another
/// patient; [`AppError::NotFound`] when the patient isn't in this clinic;
/// [`AppError::IdConflict`] when the id belongs to a different file.
pub async fn upload(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: Upload,
) -> Result<AttachmentView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let Checked {
        file_type,
        kind,
        language,
        caption,
        label,
        tooth,
    } = check_fields(&input)?;
    let size = i64::try_from(input.bytes.len()).map_err(|_| AppError::Internal("file size"))?;
    let sha256 = sha256_hex(&input.bytes);
    let described = Described {
        patient_id: patient_id.uuid(),
        input: &input,
        kind,
        file_type,
        size,
        sha256: &sha256,
        caption: caption.as_deref(),
        label: label.as_deref(),
        tooth: tooth.map(|t| i16::from(t.number())),
        language,
    };
    let id = input.id.unwrap_or_else(AttachmentId::new_v7);
    let key = StorageKey::new(actor.clinic_id, id);
    // Set once this attempt has stored the bytes, so a failure removes only what it wrote: with a
    // client-chosen id the key may already hold an earlier upload's file.
    let mut wrote = false;
    let reach = actor.reach(Permission::ClinicalWrite);
    let stored = db
        .scoped(&scope(actor, request_id), async |tx| {
            let patient = require_patient(tx, patient_id, reach).await?;
            if input.id.is_some()
                && let Some(existing) = replayed(tx, id, &described, reach.member()).await?
            {
                return Ok(existing);
            }
            let mut encounter_id = input.visit_id;
            if let Some(note_id) = input.note_id {
                encounter_id = Some(
                    check_note_link(
                        tx,
                        actor,
                        patient.id,
                        note_id,
                        input.addendum_id,
                        input.visit_id,
                    )
                    .await?,
                );
            }
            files
                .storage
                .put(key, &input.bytes)
                .await
                .map_err(|_| AppError::Internal("could not store the file"))?;
            wrote = true;
            let row = attachments::insert(
                tx.conn(),
                &NewAttachment {
                    id: id.uuid(),
                    patient_id: patient.id,
                    encounter_id,
                    kind: kind.as_str(),
                    storage_key: &key.to_string(),
                    mime_type: file_type.mime_type(),
                    size_bytes: size,
                    sha256: &sha256,
                    caption: caption.as_deref(),
                    label: label.as_deref(),
                    tooth: tooth.map(|t| i16::from(t.number())),
                    source: RecordSource::Clinician.as_str(),
                    note_id: input.note_id,
                    addendum_id: input.addendum_id,
                    duration_seconds: input.duration_seconds,
                    language: language.map(VoiceLanguage::as_str),
                },
            )
            .await
            .map_err(|error| match error.kind() {
                DbErrorKind::Conflict => {
                    AppError::invalid("visit_id", "not a visit of this patient")
                }
                _ => AppError::Db(error),
            })?;
            if let Some(note_id) = input.note_id.filter(|_| input.addendum_id.is_none()) {
                aarogyam_dal::visits::mark_note_voice(tx.conn(), note_id).await?;
            }
            view(row)
        })
        .await;
    if stored.is_err() && wrote {
        // Nothing points at the bytes; a failed clean-up only leaves an orphan file.
        let _ = files.storage.delete(key).await;
    }
    stored
}

/// Checks that `actor` may link a recording to the note, and returns the note's visit.
async fn check_note_link(
    tx: &mut sakalya_db::ScopedTx,
    actor: &ClinicActor,
    patient: Uuid,
    note_id: Uuid,
    addendum_id: Option<Uuid>,
    visit_id: Option<Uuid>,
) -> Result<Uuid, AppError> {
    let reach = actor.reach(Permission::ClinicalWrite).member();
    let note = aarogyam_dal::visits::get_note_for_update(tx.conn(), note_id, reach)
        .await?
        .filter(|note| note.patient_id == patient)
        .ok_or(AppError::NotFound("note"))?;
    if visit_id.is_some_and(|visit| visit != note.encounter_id) {
        return Err(AppError::invalid("visit_id", "not the visit of that note"));
    }
    let state = NoteState {
        status: NoteStatus::parse(&note.status).map_err(invalid("status"))?,
        author: MembershipId::from_uuid(note.author_id),
    };
    if state.status == NoteStatus::Draft {
        if addendum_id.is_some() {
            return Err(AppError::invalid("addendum_id", "a draft has no addenda"));
        }
        state.check_edit(actor.membership_id).map_err(refused)?;
    } else {
        // A signed note is frozen: the recording joins it as part of an addendum of the member's own.
        state.check_addendum().map_err(refused)?;
        let addendum_id = addendum_id.ok_or_else(|| {
            AppError::invalid(
                "addendum_id",
                "a signed note takes a recording only with an addendum",
            )
        })?;
        let own = aarogyam_dal::visits::list_addenda(tx.conn(), &[note.id])
            .await?
            .into_iter()
            .any(|a| a.id == addendum_id && a.author_id == actor.membership_id.uuid());
        if !own {
            return Err(AppError::invalid(
                "addendum_id",
                "not your addendum to this note",
            ));
        }
    }
    Ok(note.encounter_id)
}

/// A patient's files, newest first.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<AttachmentView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::ClinicalRead)).await?;
        attachments::list(tx.conn(), patient.id)
            .await?
            .into_iter()
            .map(view)
            .collect()
    })
    .await
}

/// A download link: the token and when it stops working.
#[derive(Debug, Clone)]
pub struct DownloadLink {
    /// The file.
    pub attachment_id: AttachmentId,
    /// The signed token.
    pub token: String,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
}

/// Issues a five-minute download link for a file the member may see.
///
/// # Errors
/// [`AppError::NotFound`] when the file isn't in this clinic; [`AppError::Forbidden`] for
/// Sakalya staff under a support grant, who see that files exist but don't download them.
pub async fn link(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    attachment_id: AttachmentId,
    now: OffsetDateTime,
) -> Result<DownloadLink, AppError> {
    actor.require(Permission::ClinicalRead)?;
    if actor.support_grant.is_some() {
        return Err(AppError::Forbidden(
            "Support access doesn't download files.",
        ));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalRead).member();
        attachments::get(tx.conn(), attachment_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("attachment"))?;
        Ok::<_, AppError>(())
    })
    .await?;
    let expires_at = now + LINK_LIFETIME;
    Ok(DownloadLink {
        attachment_id,
        token: files
            .signer
            .sign(actor.clinic_id, attachment_id, actor.user_id, expires_at),
        expires_at,
    })
}

/// A file to send.
#[derive(Debug, Clone)]
pub struct Download {
    /// Its type.
    pub file_type: FileType,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// Why a download was refused.
#[derive(Debug)]
pub enum DownloadRefusal {
    /// The link is past its expiry.
    Expired,
    /// Not a link for this file in this clinic, or the file is gone.
    NotFound,
    /// Something else failed.
    Failed(AppError),
}

impl From<AppError> for DownloadRefusal {
    fn from(error: AppError) -> Self {
        match error {
            AppError::NotFound(_) => Self::NotFound,
            other => Self::Failed(other),
        }
    }
}

impl From<sakalya_db::DbError> for DownloadRefusal {
    fn from(error: sakalya_db::DbError) -> Self {
        Self::Failed(AppError::Db(error))
    }
}

/// Opens a download link on `clinic`'s host: checks the signature and expiry, writes the
/// access record for the member it was issued to, and returns the file.
///
/// # Errors
/// The [`DownloadRefusal`] that applies.
pub async fn download(
    db: &Db,
    files: &Files,
    clinic: ClinicId,
    request_id: Option<Uuid>,
    attachment_id: AttachmentId,
    token: &str,
    now: OffsetDateTime,
) -> Result<Download, DownloadRefusal> {
    let grant = files
        .signer
        .verify(clinic, attachment_id, token, now)
        .map_err(|refusal| match refusal {
            LinkRefusal::Expired => DownloadRefusal::Expired,
            LinkRefusal::Invalid => DownloadRefusal::NotFound,
        })?;
    let mut scope = Scope::tenant(clinic.uuid())
        .with_user(grant.user_id.uuid())
        .with_actor_kind(STAFF);
    if let Some(id) = request_id {
        scope = scope.with_request_id(id);
    }
    let row = db
        .scoped(&scope, async |tx| {
            // The link was issued within the member's reach; it stays valid for five minutes.
            let row = attachments::get(tx.conn(), attachment_id.uuid(), None)
                .await?
                .ok_or(AppError::NotFound("attachment"))?;
            let request_text = request_id.map(|id| id.to_string());
            aarogyam_dal::visits::record_access(
                tx.conn(),
                &aarogyam_dal::visits::Access {
                    actor_user_id: grant.user_id.uuid(),
                    actor_kind: STAFF.as_str(),
                    patient_id: row.patient_id,
                    resource: "attachment",
                    resource_id: Some(row.id),
                    action: "download",
                    purpose: "care",
                    request_id: request_text.as_deref(),
                },
            )
            .await?;
            Ok::<_, DownloadRefusal>(row)
        })
        .await?;
    let file_type = FileType::from_mime_type(&row.mime_type).ok_or(DownloadRefusal::Failed(
        AppError::Internal("unknown stored type"),
    ))?;
    let bytes = files
        .storage
        .get(StorageKey::new(clinic, attachment_id))
        .await
        .map_err(|_| DownloadRefusal::Failed(AppError::Internal("could not read the file")))?;
    Ok(Download { file_type, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_bound_to_clinic_file_member_and_time() {
        let signer = LinkSigner::new(&[7_u8; 32]).unwrap();
        let (clinic, file, user) = (ClinicId::new_v7(), AttachmentId::new_v7(), UserId::new_v7());
        let now = OffsetDateTime::now_utc();
        let token = signer.sign(clinic, file, user, now + LINK_LIFETIME);
        assert_eq!(
            signer.verify(clinic, file, &token, now),
            Ok(LinkGrant { user_id: user })
        );
        assert_eq!(
            signer.verify(clinic, file, &token, now + Duration::minutes(6)),
            Err(LinkRefusal::Expired)
        );
        assert_eq!(
            signer.verify(ClinicId::new_v7(), file, &token, now),
            Err(LinkRefusal::Invalid)
        );
        assert_eq!(
            signer.verify(clinic, AttachmentId::new_v7(), &token, now),
            Err(LinkRefusal::Invalid)
        );
        let other = LinkSigner::new(&[8_u8; 32]).unwrap();
        assert_eq!(
            other.verify(clinic, file, &token, now),
            Err(LinkRefusal::Invalid)
        );
        let forged = token.replacen(
            &user.uuid().simple().to_string(),
            &UserId::new_v7().uuid().simple().to_string(),
            1,
        );
        assert_eq!(
            signer.verify(clinic, file, &forged, now),
            Err(LinkRefusal::Invalid)
        );
        assert_eq!(
            signer.verify(clinic, file, "junk", now),
            Err(LinkRefusal::Invalid)
        );
        assert!(LinkSigner::new(b"short").is_err());
    }
}
