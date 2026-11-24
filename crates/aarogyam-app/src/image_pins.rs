//! Tooth pins on an X-ray or photo, placed once and kept for the next visit (slice 2g of
//! docs/plans/present-studio-design.md). One pin per attachment and tooth; a save replaces the
//! attachment's whole set. A pin is a placement aid, not a clinical record.

use aarogyam_dal::attachments;
use aarogyam_dal::image_pins::{self as dal, PinRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::dental::Tooth;
use aarogyam_domain::ids::AttachmentId;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;

const MAX_PINS: usize = 64;
const MAX_LABEL: usize = 80;

/// A pin: a tooth at a place on the image, as fractions of its width and height in the image's
/// own orientation.
#[derive(Debug, Clone)]
pub struct Pin {
    /// FDI tooth.
    pub tooth: u8,
    /// Across, 0 to 1.
    pub x: f32,
    /// Down, 0 to 1.
    pub y: f32,
    /// The doctor's short note, if any.
    pub label: Option<String>,
}

fn view(row: &PinRow) -> Result<Pin, AppError> {
    Ok(Pin {
        tooth: u8::try_from(row.tooth).map_err(|_| AppError::Internal("a stored pin is bad"))?,
        x: row.x,
        y: row.y,
        label: row.label.clone(),
    })
}

/// The attachment's pins, by tooth.
///
/// # Errors
/// [`AppError::NotFound`] when the file isn't in this clinic or the caller's clinical reach.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    attachment: AttachmentId,
) -> Result<Vec<Pin>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        attachments::get(
            tx.conn(),
            attachment.uuid(),
            actor.reach(Permission::ClinicalRead).member(),
        )
        .await?
        .ok_or(AppError::NotFound("attachment"))?;
        dal::of_attachment(tx.conn(), attachment.uuid())
            .await?
            .iter()
            .map(view)
            .collect()
    })
    .await
}

/// Replaces the attachment's pins with `pins`: new teeth are placed, known teeth moved, the
/// others removed.
///
/// # Errors
/// [`AppError::Invalid`] for a bad tooth, a place outside the image, a tooth twice or too many
/// pins or a label over 80 characters; [`AppError::NotFound`] when the file isn't in this clinic or reach.
pub async fn replace(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    attachment: AttachmentId,
    pins: &[(i64, f32, f32, Option<String>)],
) -> Result<Vec<Pin>, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    if pins.len() > MAX_PINS {
        return Err(AppError::invalid("pins", "at most 64 pins"));
    }
    let mut rows: Vec<PinRow> = Vec::with_capacity(pins.len());
    for (tooth, x, y, label) in pins {
        let (tooth, x, y) = (*tooth, *x, *y);
        let tooth =
            Tooth::new(tooth).map_err(|_| AppError::invalid("tooth", "not an FDI tooth"))?;
        if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) {
            return Err(AppError::invalid("pins", "x and y are between 0 and 1"));
        }
        let tooth = i16::from(tooth.number());
        if rows.iter().any(|r| r.tooth == tooth) {
            return Err(AppError::invalid("pins", "one pin per tooth"));
        }
        let label = label.as_deref().map(str::trim).filter(|l| !l.is_empty());
        if label.is_some_and(|l| l.chars().count() > MAX_LABEL) {
            return Err(AppError::invalid("label", "at most 80 characters"));
        }
        rows.push(PinRow {
            tooth,
            x,
            y,
            label: label.map(str::to_owned),
        });
    }
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let file = attachments::get(
            tx.conn(),
            attachment.uuid(),
            actor.reach(Permission::ClinicalWrite).member(),
        )
        .await?
        .ok_or(AppError::NotFound("attachment"))?;
        dal::lock(tx.conn(), attachment.uuid()).await?;
        let keep: Vec<i16> = rows.iter().map(|r| r.tooth).collect();
        dal::delete_except(tx.conn(), attachment.uuid(), &keep).await?;
        for row in &rows {
            dal::upsert(
                tx.conn(),
                Uuid::now_v7(),
                attachment.uuid(),
                file.patient_id,
                row,
            )
            .await?;
        }
        dal::of_attachment(tx.conn(), attachment.uuid())
            .await?
            .iter()
            .map(view)
            .collect()
    })
    .await
}
