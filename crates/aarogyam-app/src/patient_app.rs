//! The patient app: a person signed in with a verified email reads their own records at the
//! clinics that linked them, and clinics issue link codes, confirm matches and share files.
//!
//! Reads run once per linked clinic, each in a clinic transaction whose actor is the patient
//! account, so row-level security (migration 0261) limits rows to the linked record. Every read
//! writes the access record. Links are made only by a clinic-issued code or a match the clinic
//! confirms (`docs/patient-access.md`).

use aarogyam_dal::patient_app::{self as dal, Reader};
use aarogyam_dal::{appointments as appointments_dal, clinic, patients as patients_dal, staff};
use aarogyam_domain::access::{ClinicActor, ClinicPlace};
use aarogyam_domain::ids::{
    AppointmentId, AttachmentId, ClinicId, PatientAccountId, PatientId, PatientLinkId,
};
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::patient::Email;
use aarogyam_domain::patient_app::{
    LINK_CODE_LIFETIME, LinkCode, LinkStatus, RedeemOutcome, patient_may_cancel,
};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::AppointmentStatus;
use sakalya_db::{Db, ScopedTx};
use serde_json::{Value, json};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::accounts::SignInAccounts;
use crate::clock::clinic_offset;
use crate::error::AppError;
use crate::files::{Files, StorageKey};
use crate::messaging::{PatientEmail, enqueue_patient_email};
use crate::patients::mask_email;
use crate::scope::{patient_account_scope, staff_scope};
use crate::self_booking::read_settings;
use crate::tokens::hash_token;

/// A clinic that linked the patient account, with the linked record.
#[derive(Debug, Clone)]
pub struct LinkedClinic {
    /// The link.
    pub link_id: PatientLinkId,
    /// The clinic, its time zone and number prefix.
    pub place: ClinicPlace,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// Its portal host, when it has one.
    pub host: Option<String>,
    /// Its branding (brand colour, theme mode).
    pub branding: Value,
    /// The linked record.
    pub patient_id: PatientId,
    /// The record's clinic number, such as `SD-1042`.
    pub patient_number: String,
    /// When the link was made.
    pub linked_at: OffsetDateTime,
}

/// A signed-in patient account and the clinics that linked it.
#[derive(Debug, Clone)]
pub struct PatientAccess {
    /// The account.
    pub account_id: PatientAccountId,
    /// Its verified email.
    pub email: String,
    /// Active links at open clinics, by clinic name.
    pub clinics: Vec<LinkedClinic>,
}

impl PatientAccess {
    /// The link at `clinic`, if the account has one.
    #[must_use]
    pub fn at(&self, clinic: ClinicId) -> Option<&LinkedClinic> {
        self.clinics.iter().find(|linked| linked.place.id == clinic)
    }
}

/// Why a patient request was refused before any record was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessRefusal {
    /// The sign-in session was revoked.
    Revoked,
    /// The token carries no verified email and no account exists yet.
    NoEmail,
    /// The account is disabled.
    Disabled,
}

/// The patient account behind a verified sign-in, made on first use from the verified email,
/// with its active links: one round trip.
///
/// # Errors
/// `Ok(Err(refusal))` when the request must be refused; [`AppError::Db`] on database failures.
pub async fn access(
    db: &Db,
    auth_uid: Uuid,
    email: Option<&str>,
    session: (Uuid, OffsetDateTime),
) -> Result<Result<PatientAccess, AccessRefusal>, AppError> {
    let email = email.and_then(|text| Email::parse(text).ok());
    let Some(row) = dal::access(
        db.pool(),
        auth_uid,
        email.as_ref().map(Email::as_str),
        session,
    )
    .await?
    else {
        return Ok(Err(AccessRefusal::NoEmail));
    };
    if row.session_revoked {
        return Ok(Err(AccessRefusal::Revoked));
    }
    if row.account_status != "active" {
        return Ok(Err(AccessRefusal::Disabled));
    }
    Ok(Ok(PatientAccess {
        account_id: PatientAccountId::from_uuid(row.account_id),
        email: row.account_email,
        clinics: row
            .links
            .into_iter()
            .map(|link| LinkedClinic {
                link_id: PatientLinkId::from_uuid(link.link_id),
                place: ClinicPlace {
                    id: ClinicId::from_uuid(link.org_id),
                    timezone: link.timezone,
                    number_prefix: link.number_prefix,
                },
                slug: link.slug,
                name: link.clinic_name,
                host: link.portal_host,
                branding: link.branding,
                patient_id: PatientId::from_uuid(link.patient_id),
                patient_number: link.patient_number,
                linked_at: link.linked_at,
            })
            .collect(),
    }))
}

/// Reads one linked clinic in the patient account's scope.
async fn read_clinic<T>(
    db: &Db,
    access: &PatientAccess,
    clinic: &LinkedClinic,
    request_id: Option<Uuid>,
    read: impl AsyncFnOnce(&mut ScopedTx, Reader<'_>) -> Result<T, sakalya_db::DbError>,
) -> Result<T, AppError> {
    let request_text = request_id.map(|id| id.to_string());
    let reader = Reader {
        patient_id: clinic.patient_id.uuid(),
        account_id: access.account_id.uuid(),
        request_id: request_text.as_deref(),
    };
    let scope = patient_account_scope(clinic.place.id, access.account_id, request_id);
    db.scoped(&scope, async |tx| {
        Ok::<_, AppError>(read(tx, reader).await?)
    })
    .await
}

/// What the home screen shows for one clinic.
#[derive(Debug, Clone)]
pub struct ClinicSummary {
    /// The next appointment that isn't cancelled or over.
    pub next_appointment: Option<Value>,
    /// Owed on issued bills, in paise.
    pub balance_paise: i64,
    /// Issued prescriptions.
    pub prescriptions: i64,
    /// The newest issued prescription's date.
    pub last_prescription_at: Option<OffsetDateTime>,
}

/// Each linked clinic's next appointment, balance and prescriptions count.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn home(
    db: &Db,
    access: &PatientAccess,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Vec<ClinicSummary>, AppError> {
    let mut summaries = Vec::with_capacity(access.clinics.len());
    for clinic in &access.clinics {
        let row = read_clinic(db, access, clinic, request_id, async |tx, reader| {
            dal::summary(tx.conn(), reader, now).await
        })
        .await?;
        summaries.push(ClinicSummary {
            next_appointment: row.next_appointment,
            balance_paise: row.balance_paise.max(0),
            prescriptions: row.prescriptions,
            last_prescription_at: row.last_prescription_at,
        });
    }
    Ok(summaries)
}

/// Rows read from every linked clinic, each with the clinic's index in [`PatientAccess::clinics`].
pub type PerClinic<T> = Vec<(usize, T)>;

macro_rules! each_clinic {
    ($(#[$doc:meta])* $name:ident, $row:ty, $query:path) => {
        $(#[$doc])*
        ///
        /// # Errors
        /// [`AppError::Db`] on database failures.
        pub async fn $name(
            db: &Db,
            access: &PatientAccess,
            request_id: Option<Uuid>,
        ) -> Result<PerClinic<$row>, AppError> {
            let mut all = Vec::new();
            for (index, clinic) in access.clinics.iter().enumerate() {
                let rows: Vec<$row> = read_clinic(db, access, clinic, request_id, async |tx, reader| {
                    $query(tx.conn(), reader).await
                })
                .await?;
                all.extend(rows.into_iter().map(|row| (index, row)));
            }
            Ok(all)
        }
    };
}

each_clinic!(
    /// The patient's appointments at every linked clinic.
    appointments,
    dal::AppointmentRow,
    dal::appointments
);
each_clinic!(
    /// The patient's issued prescriptions at every linked clinic.
    prescriptions,
    dal::PrescriptionRow,
    dal::prescriptions
);
each_clinic!(
    /// The patient's issued bills at every linked clinic.
    bills,
    dal::BillRow,
    dal::bills
);
each_clinic!(
    /// The files every linked clinic shared with the patient.
    files,
    dal::FileRow,
    dal::files
);

/// What redeeming a code did, and where.
#[derive(Debug, Clone, Copy)]
pub struct Redeemed {
    /// The clinic.
    pub clinic_id: ClinicId,
    /// The outcome.
    pub outcome: RedeemOutcome,
}

/// Redeems a clinic-issued link code. `None` when no unused, unexpired code matches.
///
/// # Errors
/// [`AppError::Invalid`] for text that isn't a code; [`AppError::Db`] on database failures.
pub async fn redeem(
    db: &Db,
    access: &PatientAccess,
    code: &str,
) -> Result<Option<Redeemed>, AppError> {
    let code = LinkCode::parse(code).map_err(|error| AppError::invalid("code", error))?;
    let found = dal::redeem_code(
        db.pool(),
        access.account_id.uuid(),
        &hash_token(code.as_str()),
    )
    .await?;
    found
        .map(|(org_id, outcome)| {
            RedeemOutcome::parse(&outcome)
                .map(|outcome| Redeemed {
                    clinic_id: ClinicId::from_uuid(org_id),
                    outcome,
                })
                .ok_or(AppError::Internal("unknown redeem outcome"))
        })
        .transpose()
}

/// Asks the clinic with `slug` to confirm the record with the account's verified email. Says
/// nothing about whether one exists.
///
/// # Errors
/// [`AppError::Invalid`] for an empty slug; [`AppError::Db`] on database failures.
pub async fn request_link(db: &Db, access: &PatientAccess, slug: &str) -> Result<(), AppError> {
    let slug = slug.trim();
    if slug.is_empty() || slug.len() > 63 {
        return Err(AppError::invalid("clinic", "name the clinic's address"));
    }
    dal::request_link(db.pool(), access.account_id.uuid(), slug, &access.email).await?;
    Ok(())
}

/// Ends one of the account's own links (active or pending).
///
/// # Errors
/// [`AppError::NotFound`] when it isn't one of theirs; [`AppError::Db`] on database failures.
pub async fn revoke_own(
    db: &Db,
    access: &PatientAccess,
    link_id: PatientLinkId,
) -> Result<(), AppError> {
    if dal::revoke_own_link(db.pool(), access.account_id.uuid(), link_id.uuid()).await? {
        Ok(())
    } else {
        Err(AppError::NotFound("link"))
    }
}

/// The message when an appointment is too close, or past, to cancel in the app.
pub const TOO_LATE_TO_CANCEL: &str =
    "this appointment can no longer be cancelled in the app; please call the clinic";

/// Cancels one of the patient's own appointments at a linked clinic, if it is still open and
/// starts at least the clinic's booking notice from now. The appointment is the patient's only
/// if row-level security shows it.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't theirs; [`AppError::Conflict`] when it is too late;
/// [`AppError::Db`] on database failures.
pub async fn cancel(
    db: &Db,
    access: &PatientAccess,
    clinic: &LinkedClinic,
    request_id: Option<Uuid>,
    appointment_id: AppointmentId,
    now: OffsetDateTime,
) -> Result<AppointmentStatus, AppError> {
    let scope = patient_account_scope(clinic.place.id, access.account_id, request_id);
    db.scoped(&scope, async |tx| {
        let found =
            dal::lock_own_appointment(tx.conn(), clinic.patient_id.uuid(), appointment_id.uuid())
                .await?
                .ok_or(AppError::NotFound("appointment"))?;
        let status = AppointmentStatus::parse(&found.status)
            .map_err(|_| AppError::Internal("unknown appointment status"))?;
        if status == AppointmentStatus::Cancelled {
            return Ok(status);
        }
        let notice = Duration::minutes(i64::from(read_settings(&found.booking).min_notice_minutes));
        if !patient_may_cancel(status, found.starts_at, now, notice) {
            return Err(AppError::Conflict(TOO_LATE_TO_CANCEL));
        }
        let to = AppointmentStatus::Cancelled;
        appointments_dal::set_status(
            tx.conn(),
            appointment_id.uuid(),
            to.as_str(),
            Some("Cancelled by the patient in the app"),
            now,
        )
        .await?;
        appointments_dal::insert_event(
            tx.conn(),
            &appointments_dal::NewEvent {
                appointment_id: appointment_id.uuid(),
                kind: "status",
                from_status: Some(status.as_str()),
                to_status: Some(to.as_str()),
                changes: None,
                note: Some("patient app"),
                at: now,
            },
        )
        .await?;
        // Tells the clinic, and closes the booking's open notifications, in this transaction.
        aarogyam_dal::notifications::patient_cancelled(tx.conn(), appointment_id.uuid()).await?;
        Ok(to)
    })
    .await
}

/// A shared file's bytes.
#[derive(Debug, Clone)]
pub struct SharedFile {
    /// Media type.
    pub mime_type: String,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// A file the clinic shared with the patient, recording the download.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't the patient's shared file; [`AppError::Db`] on
/// database failures; [`AppError::Internal`] when storage fails.
pub async fn shared_file(
    db: &Db,
    files: &Files,
    access: &PatientAccess,
    clinic: &LinkedClinic,
    request_id: Option<Uuid>,
    attachment_id: AttachmentId,
) -> Result<SharedFile, AppError> {
    let found: Option<String> = read_clinic(db, access, clinic, request_id, async |tx, reader| {
        dal::shared_file(tx.conn(), reader, attachment_id.uuid()).await
    })
    .await?;
    let mime_type = found.ok_or(AppError::NotFound("file"))?;
    let bytes = files
        .storage()
        .get(StorageKey::new(clinic.place.id, attachment_id))
        .await
        .map_err(|_| AppError::Internal("could not read the file"))?;
    Ok(SharedFile { mime_type, bytes })
}

/// A patient record's app access, for the clinic.
#[derive(Debug, Clone)]
pub struct AppAccess {
    /// Links, open ones first.
    pub links: Vec<LinkView>,
    /// When the record's unused code expires, if one is waiting.
    pub code_expires_at: Option<OffsetDateTime>,
    /// Whether the record has an email, which the patient signs in with.
    pub has_email: bool,
}

/// One link, as the clinic sees it.
#[derive(Debug, Clone)]
pub struct LinkView {
    /// The link.
    pub id: PatientLinkId,
    /// Where it stands.
    pub status: LinkStatus,
    /// `code` or `clinic_confirmed`.
    pub linked_via: String,
    /// The account's verified email, masked without `patients.contact`.
    pub account_email: String,
    /// When the patient consented.
    pub consented_at: OffsetDateTime,
    /// When it became active.
    pub linked_at: Option<OffsetDateTime>,
    /// When it was revoked.
    pub revoked_at: Option<OffsetDateTime>,
}

/// A patient record's links and waiting code.
///
/// # Errors
/// [`AppError::NotFound`] for a patient outside the member's reach; [`AppError::Db`] on
/// database failures.
pub async fn app_access(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<AppAccess, AppError> {
    actor.require(Permission::PatientsRead)?;
    let contact = actor.permissions.allows(Permission::PatientsContact);
    let reach = actor.reach(Permission::PatientsRead).member();
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let patient = patients_dal::get(tx.conn(), patient_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let (links, code_expires_at) = dal::links_of_patient(tx.conn(), patient_id.uuid()).await?;
        let links = links
            .into_iter()
            .filter_map(|link| {
                Some(LinkView {
                    id: PatientLinkId::from_uuid(link.id),
                    status: LinkStatus::parse(&link.status)?,
                    linked_via: link.linked_via,
                    account_email: if contact {
                        link.account_email
                    } else {
                        mask_email(&link.account_email)
                    },
                    consented_at: link.consented_at,
                    linked_at: link.linked_at,
                    revoked_at: link.revoked_at,
                })
            })
            .collect();
        Ok(AppAccess {
            links,
            code_expires_at,
            has_email: patient.email.is_some(),
        })
    })
    .await
}

/// A code issued for a patient: shown once, as text and a QR code.
#[derive(Debug, Clone)]
pub struct Invited {
    /// The code, `XXXXX-XXXXX`.
    pub code: String,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
    /// Whether the email with the code was queued.
    pub emailed: bool,
    /// Whether the patient's sign-in account exists (false when Supabase admin isn't configured).
    pub account_ready: bool,
}

/// "Invite to patient app": makes sure the patient can sign in with the email on their record,
/// issues a new link code (replacing unused ones) and queues an email with it.
///
/// # Errors
/// [`AppError::NotFound`] for a patient outside the member's reach; [`AppError::Conflict`] when
/// the record has no email or the clinic no portal address; [`AppError::Accounts`] when
/// Supabase can't create the account; [`AppError::Db`] on database failures.
pub async fn invite(
    db: &Db,
    accounts: Option<&dyn SignInAccounts>,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    now: OffsetDateTime,
) -> Result<Invited, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let reach = actor.reach(Permission::PatientsRead).member();
    let scope = staff_scope(actor, request_id);
    let email = db
        .scoped(&scope, async |tx| {
            let patient = patients_dal::get(tx.conn(), patient_id.uuid(), reach)
                .await?
                .ok_or(AppError::NotFound("patient"))?;
            patient
                .email
                .and_then(|text| Email::parse(&text).ok())
                .ok_or(AppError::Conflict(
                    "add the patient's email first: they sign in to the app with it",
                ))
        })
        .await?;
    let account_ready = match accounts {
        Some(accounts) => {
            accounts.ensure_user(&email).await?;
            true
        }
        None => false,
    };
    let mut entropy = [0_u8; 7];
    aws_lc_rs::rand::fill(&mut entropy)
        .map_err(|_| AppError::Internal("random number generator failed"))?;
    let code = LinkCode::from_random(entropy);
    let expires_at = now + LINK_CODE_LIFETIME;
    let shown = code.display();
    db.scoped(&scope, async |tx| {
        // The record may have changed since: still in reach, same email.
        patients_dal::get(tx.conn(), patient_id.uuid(), reach)
            .await?
            .filter(|patient| patient.email.as_deref() == Some(email.as_str()))
            .ok_or(AppError::Conflict(
                "the patient's record changed; try again",
            ))?;
        dal::issue_code(
            tx.conn(),
            patient_id.uuid(),
            &hash_token(code.as_str()),
            expires_at,
        )
        .await?;
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let host = staff::portal_host(tx.conn())
            .await?
            .ok_or(AppError::Conflict("the clinic has no portal address yet"))?;
        let expires_on = expires_at
            .to_offset(clinic_offset(&profile.timezone))
            .date();
        enqueue_patient_email(
            tx,
            &PatientEmail {
                kind: MessageKind::PatientAppInvited,
                patient_id,
                payload: json!({
                    "clinic_name": profile.name,
                    "portal_host": host,
                    "expires_on": expires_on.to_string(),
                }),
                secret: Some(&shown),
                appointment_id: None,
            },
        )
        .await?;
        Ok::<_, AppError>(())
    })
    .await?;
    Ok(Invited {
        code: shown,
        expires_at,
        emailed: true,
        account_ready,
    })
}

/// What the clinic decides about a link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Confirm a match the patient asked for.
    Confirm,
    /// Turn a match down.
    Decline,
    /// End an active link.
    Revoke,
}

/// The message when the record already has an app account linked.
pub const ALREADY_LINKED: &str = "this patient's record is already linked to an app account";

/// Confirms or declines a pending match, or revokes an active link, for a patient in reach.
///
/// # Errors
/// [`AppError::NotFound`] when there is no such link in that state within reach;
/// [`AppError::Conflict`] when the record already has an active link; [`AppError::Db`] on
/// database failures.
pub async fn decide(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    link_id: PatientLinkId,
    decision: Decision,
) -> Result<LinkStatus, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let reach = actor.reach(Permission::PatientsRead).member();
    let (from, to) = match decision {
        Decision::Confirm => (LinkStatus::Pending, LinkStatus::Active),
        Decision::Decline => (LinkStatus::Pending, LinkStatus::Declined),
        Decision::Revoke => (LinkStatus::Active, LinkStatus::Revoked),
    };
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        dal::decide_link(
            tx.conn(),
            link_id.uuid(),
            from.as_str(),
            to.as_str(),
            actor.membership_id.uuid(),
            reach,
        )
        .await
        .map_err(|error| {
            AppError::on_constraint(error, "patient_links_active_per_patient", ALREADY_LINKED)
        })?
        .ok_or(AppError::NotFound("link"))?;
        Ok(to)
    })
    .await
}

/// Shares a file with the patient in the app, or stops sharing it.
///
/// # Errors
/// [`AppError::NotFound`] for a file outside the member's reach (or a voice recording, which
/// is never shared); [`AppError::Db`] on database failures.
pub async fn set_file_shared(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    attachment_id: AttachmentId,
    shared: bool,
) -> Result<(), AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let reach = actor.reach(Permission::ClinicalWrite).member();
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        dal::set_file_shared(tx.conn(), attachment_id.uuid(), shared, reach)
            .await?
            .ok_or(AppError::NotFound("attachment"))?;
        Ok(())
    })
    .await
}
