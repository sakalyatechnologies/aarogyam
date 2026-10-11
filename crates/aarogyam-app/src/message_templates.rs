//! A clinic's message templates (docs/whatsapp.md): listing them, adding a language or channel,
//! editing the clinic's copy, and recording that a `WhatsApp` template was submitted to Meta.
//! All need `settings.manage`. Bodies may use only their key's allow-listed `{{variables}}`.

use aarogyam_dal::message_templates::{self as dal, TemplateFields, TemplateRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::messaging::{Channel, placeholders};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::whatsapp::{TemplateCategory, TemplateStatus};
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Keys a template may have: the messages staff send and the patient emails the system sends.
pub const KEYS: &[&str] = &[
    "care.note",
    "reminder.follow_up",
    "promo.offer",
    "appointment.reminder",
    "booking.requested",
    "booking.confirmed",
    "booking.declined",
    "prescription.shared",
    "patient_app.invited",
];

/// A template to add.
#[derive(Debug, Clone)]
pub struct NewTemplate {
    /// One of [`KEYS`].
    pub key: String,
    /// Its channel.
    pub channel: Channel,
    /// `en-IN`, `hi-IN`, `mr-IN`...
    pub language: String,
    /// Its text.
    pub body: String,
    /// Its category.
    pub category: TemplateCategory,
    /// Its name at Meta (`WhatsApp`).
    pub provider_template_ref: Option<String>,
}

/// Changes to a clinic's copy; absent fields stay.
#[derive(Debug, Clone, Default)]
pub struct TemplatePatch {
    /// New text.
    pub body: Option<String>,
    /// New category.
    pub category: Option<TemplateCategory>,
    /// New name at Meta.
    pub provider_template_ref: Option<String>,
    /// SMS sender header (DLT).
    pub sender_header: Option<String>,
    /// SMS DLT template id.
    pub dlt_template_id: Option<String>,
}

fn check_body(key: &str, body: &str) -> Result<(), AppError> {
    let length = body.trim().chars().count();
    if !(1..=1024).contains(&length) {
        return Err(AppError::invalid("body", "must be 1 to 1024 characters"));
    }
    placeholders(key, body).map_err(|error| AppError::invalid("body", error))?;
    Ok(())
}

fn check_ref(reference: Option<&str>) -> Result<(), AppError> {
    match reference {
        Some(text)
            if text.is_empty()
                || text.len() > 512
                || !text
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') =>
        {
            Err(AppError::invalid(
                "provider_template_ref",
                "lower-case letters, digits and _",
            ))
        }
        _ => Ok(()),
    }
}

/// The clinic's templates.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<TemplateRow>, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok::<_, AppError>(dal::list(tx.conn()).await?)
    })
    .await
}

/// Adds a template for a key, channel and language the clinic lacks: email ones are in use at
/// once, `WhatsApp` ones start as drafts.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown key, a language, body or name that isn't valid, or SMS;
/// [`AppError::Conflict`] when the clinic has that template.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewTemplate,
) -> Result<TemplateRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    if !KEYS.contains(&input.key.as_str()) {
        return Err(AppError::invalid("key", "unknown template key"));
    }
    if input.channel == Channel::Sms {
        return Err(AppError::invalid("channel", "SMS is not available yet"));
    }
    let language = input.language.trim();
    let shaped = language.len() == 5
        && language.as_bytes()[2] == b'-'
        && language[..2].chars().all(|c| c.is_ascii_lowercase())
        && language[3..].chars().all(|c| c.is_ascii_uppercase());
    if !shaped {
        return Err(AppError::invalid("language", "like en-IN"));
    }
    check_body(&input.key, &input.body)?;
    check_ref(input.provider_template_ref.as_deref())?;
    let status = if input.channel == Channel::Email {
        TemplateStatus::Approved
    } else {
        TemplateStatus::Draft
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let fields = TemplateFields {
            key: &input.key,
            channel: input.channel.as_str(),
            language,
            body: input.body.trim(),
            category: input.category.as_str(),
            provider_template_ref: input.provider_template_ref.as_deref(),
            status: status.as_str(),
            sender_header: None,
            dlt_template_id: None,
        };
        let id = dal::create(tx.conn(), &fields)
            .await?
            .ok_or(AppError::Conflict("the clinic has this template"))?;
        dal::get(tx.conn(), id)
            .await?
            .ok_or(AppError::Internal("template vanished"))
    })
    .await
}

/// Changes the clinic's copy. A `WhatsApp` template whose text, name or category changes goes
/// back to draft: Meta must review it again.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't the clinic's; [`AppError::Invalid`] for a bad body.
pub async fn update(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
    patch: TemplatePatch,
) -> Result<TemplateRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    check_ref(patch.provider_template_ref.as_deref())?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::get(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("template"))?;
        let body = patch.body.as_deref().map_or(row.body.as_str(), str::trim);
        check_body(&row.key, body)?;
        let category = patch
            .category
            .map_or(row.category.as_str(), |category| category.as_str());
        let reference = patch
            .provider_template_ref
            .as_deref()
            .or(row.provider_template_ref.as_deref());
        let reviewed_changed = body != row.body
            || category != row.category
            || reference != row.provider_template_ref.as_deref();
        let status = if row.channel == "whatsapp" && reviewed_changed {
            TemplateStatus::Draft.as_str()
        } else {
            row.status.as_str()
        };
        let fields = TemplateFields {
            key: &row.key,
            channel: &row.channel,
            language: &row.language,
            body,
            category,
            provider_template_ref: reference,
            status,
            sender_header: patch
                .sender_header
                .as_deref()
                .or(row.sender_header.as_deref()),
            dlt_template_id: patch
                .dlt_template_id
                .as_deref()
                .or(row.dlt_template_id.as_deref()),
        };
        dal::update(tx.conn(), id, &fields, false).await?;
        dal::get(tx.conn(), id)
            .await?
            .ok_or(AppError::Internal("template vanished"))
    })
    .await
}

/// Records that the clinic submitted its `WhatsApp` template to Meta (by hand for the pilot;
/// docs/whatsapp.md). If Meta already reviewed the same name, language and text for another
/// clinic on the shared number, that decision applies at once.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't the clinic's; [`AppError::Conflict`] for an email
/// template, one without a name at Meta, or one already approved.
pub async fn submit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<TemplateRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::get(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("template"))?;
        if row.channel != "whatsapp" {
            return Err(AppError::Conflict("only WhatsApp templates are reviewed"));
        }
        if row.status == "approved" {
            return Err(AppError::Conflict("the template is approved already"));
        }
        let Some(reference) = row.provider_template_ref.as_deref() else {
            return Err(AppError::Conflict("give the template's name at Meta first"));
        };
        let known = dal::known_status(tx.conn(), reference, &row.language, &row.body).await?;
        let status = known.as_deref().unwrap_or("submitted");
        let fields = TemplateFields {
            key: &row.key,
            channel: &row.channel,
            language: &row.language,
            body: &row.body,
            category: &row.category,
            provider_template_ref: Some(reference),
            status,
            sender_header: row.sender_header.as_deref(),
            dlt_template_id: row.dlt_template_id.as_deref(),
        };
        dal::update(tx.conn(), id, &fields, true).await?;
        dal::get(tx.conn(), id)
            .await?
            .ok_or(AppError::Internal("template vanished"))
    })
    .await
}
