//! The studio layer of Show patient (docs/plans/present-studio-design.md, section 5.1): the usual
//! options for the situations the visit's recorded snapshot shows. It reads the same snapshot as
//! `GET /visits/{id}/mouth` and hands it to the pure builder, so no new fact is read. Slice 2a: no
//! prices.

use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::present::{self as builder, PresentStudio};
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;

/// The studio layer of a visit. It works while the visit is open.
///
/// # Errors
/// [`AppError::NotFound`] when the visit isn't in this clinic or the caller's clinical reach.
pub async fn studio(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    now: OffsetDateTime,
) -> Result<PresentStudio, AppError> {
    let snapshot = crate::mouth::snapshot(db, actor, request_id, visit_id, now).await?;
    Ok(builder::build(&snapshot))
}
