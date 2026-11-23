//! "What we discussed" in Show patient (docs/plans/present-studio-design.md, sections 10, 12.4,
//! F6): what the doctor and patient went through for a situation, saved append-only. A save
//! supersedes the current row for the visit, tooth and situation; a wrong row is marked entered
//! in error. Saving needs the visit open; reading works any time.

use aarogyam_dal::present_discussions::{self as dal, DiscussionRow, NewDiscussion};
use aarogyam_dal::present_settings as settings_dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{EncounterId, PresentDiscussionId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::present::{self as builder, PresentSettings};
use aarogyam_domain::present_discussion::{self as domain, DiscussedOption};
use sakalya_db::{Db, DbErrorKind};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;
use crate::visits::require_open_visit;

/// A saved discussion.
#[derive(Debug, Clone)]
pub struct Discussion {
    /// Identifier.
    pub id: PresentDiscussionId,
    /// The visit.
    pub visit_id: EncounterId,
    /// FDI tooth; none for an example-arch topic.
    pub tooth: Option<u8>,
    /// The situation key.
    pub situation: String,
    /// The options discussed.
    pub options: Vec<DiscussedOption>,
    /// The doctor's tick for the patient (slice 2f sends it).
    pub send_to_patient: bool,
    /// The row this one replaced.
    pub supersedes_id: Option<PresentDiscussionId>,
    /// When it was saved.
    pub created_at: OffsetDateTime,
}

fn view(row: DiscussionRow) -> Result<Discussion, AppError> {
    let stored = || AppError::Internal("a stored discussion is malformed");
    Ok(Discussion {
        id: PresentDiscussionId::from_uuid(row.id),
        visit_id: EncounterId::from_uuid(row.encounter_id),
        tooth: row
            .tooth
            .map(|t| u8::try_from(t).map_err(|_| stored()))
            .transpose()?,
        situation: row.situation,
        options: serde_json::from_value(row.options).map_err(|_| stored())?,
        send_to_patient: row.send_to_patient,
        supersedes_id: row.supersedes_id.map(PresentDiscussionId::from_uuid),
        created_at: row.created_at,
    })
}

/// A discussion to save, as received.
#[derive(Debug, Clone)]
pub struct SaveDiscussion {
    /// FDI tooth; none for an example-arch topic.
    pub tooth: Option<i64>,
    /// The situation key.
    pub situation: String,
    /// The options discussed.
    pub options: Vec<DiscussedOption>,
    /// The doctor's tick for the patient.
    pub send_to_patient: bool,
}

/// The visit's current discussions, oldest first. Works while the visit is open or closed.
///
/// # Errors
/// [`AppError::NotFound`] when the visit isn't in this clinic or the caller's clinical reach.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
) -> Result<Vec<Discussion>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        aarogyam_dal::visits::get_encounter(
            tx.conn(),
            visit_id.uuid(),
            false,
            actor.reach(Permission::ClinicalRead).member(),
        )
        .await?
        .ok_or(AppError::NotFound("visit"))?;
        dal::current_of_visit(tx.conn(), visit_id.uuid())
            .await?
            .into_iter()
            .map(view)
            .collect()
    })
    .await
}

/// Saves a discussion: it supersedes the current row for the same visit, tooth and situation.
/// When it is to be sent and the clinic shows prices, each option's "from" price is frozen into
/// the row, so the patient page never shows a later price-list change.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown situation, option or material (braces and aligners until
/// seeded); [`AppError::NotFound`] when the visit isn't in this clinic or reach;
/// [`AppError::Conflict`] when the visit is closed.
pub async fn save(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    input: SaveDiscussion,
    now: OffsetDateTime,
) -> Result<Discussion, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    // Prices are the server's to freeze, never the caller's.
    let mut given = input.options.clone();
    for option in &mut given {
        option.from_paise = None;
    }
    let tooth = domain::validate(input.tooth, &input.situation, &given)
        .map_err(|e| AppError::invalid("options", e))?;
    let tooth = tooth.map(|t| i16::from(t.number()));
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let visit =
            require_open_visit(tx, visit_id, actor.reach(Permission::ClinicalWrite)).await?;
        dal::lock(tx.conn(), visit.id, tooth, &input.situation).await?;
        let mut options = given.clone();
        if input.send_to_patient {
            let settings = PresentSettings::from_stored(&settings_dal::get(tx.conn()).await?);
            if settings.show_prices {
                let snapshot = crate::mouth::of_visit(tx, &visit, now).await?;
                let studio = builder::build(&snapshot);
                let items = aarogyam_dal::billing::price_items(tx.conn()).await?;
                let list: Vec<(String, i64)> = items
                    .into_iter()
                    .filter(|i| i.active)
                    .filter_map(|i| Some((i.code?, i.price_paise)))
                    .collect();
                let prices = builder::prices(&studio, &settings, &list);
                for option in &mut options {
                    option.from_paise = prices
                        .iter()
                        .find(|p| p.option_key == option.key)
                        .map(|p| p.from_paise);
                }
            }
        }
        let replaced = dal::current_for(tx.conn(), visit.id, tooth, &input.situation).await?;
        if let Some(id) = replaced {
            dal::supersede(tx.conn(), id).await?;
        }
        let stored = serde_json::to_value(&options)
            .map_err(|_| AppError::Internal("discussion options did not serialise"))?;
        let row = dal::insert(
            tx.conn(),
            &NewDiscussion {
                id: PresentDiscussionId::new_v7().uuid(),
                patient_id: visit.patient_id,
                encounter_id: visit.id,
                tooth,
                situation: &input.situation,
                options: &stored,
                send_to_patient: input.send_to_patient,
                supersedes_id: replaced,
            },
        )
        .await
        .map_err(|error| match error.kind() {
            DbErrorKind::Conflict => {
                AppError::Conflict("this discussion changed at the same moment; try again")
            }
            _ => AppError::Db(error),
        })?;
        view(row)
    })
    .await
}

/// Marks a current discussion entered in error, with the reason. The history keeps the row.
///
/// # Errors
/// [`AppError::Invalid`] for a bad reason; [`AppError::NotFound`] when the visit or discussion
/// isn't there, or the discussion is no longer current; [`AppError::Conflict`] when the visit
/// is closed.
pub async fn mark_in_error(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    discussion_id: PresentDiscussionId,
    reason: &str,
) -> Result<(), AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let reason = domain::error_reason(reason).map_err(|e| AppError::invalid("reason", e))?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let visit =
            require_open_visit(tx, visit_id, actor.reach(Permission::ClinicalWrite)).await?;
        let done = dal::mark_in_error(tx.conn(), visit.id, discussion_id.uuid(), &reason).await?;
        if done {
            Ok(())
        } else {
            Err(AppError::NotFound("discussion"))
        }
    })
    .await
}
