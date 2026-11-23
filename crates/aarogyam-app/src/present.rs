//! The studio layer of Show patient (docs/plans/present-studio-design.md, section 5.1): the usual
//! options for the situations the visit's recorded snapshot shows. It reads the same snapshot as
//! `GET /visits/{id}/mouth` and hands it to the pure builder, so no new fact is read. Slice 2a: no
//! prices.

use aarogyam_dal::present_settings as dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::present::{self as builder, PresentSettings, PresentStudio};
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;

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
    let mut studio = builder::build(&snapshot);
    // Prices only for a member who may read billing, and only when the clinic turned them on.
    if actor.permissions.allows(Permission::BillingRead) {
        let (settings, list) = db
            .scoped(&staff_scope(actor, request_id), async |tx| {
                let settings = PresentSettings::from_stored(&dal::get(tx.conn()).await?);
                let list = price_list(tx).await?;
                Ok::<_, AppError>((settings, list))
            })
            .await?;
        if settings.show_prices {
            studio.prices = Some(builder::prices(&studio, &settings, &list));
        }
    }
    Ok(studio)
}

/// The clinic's active, coded price items as (code, paise).
async fn price_list(tx: &mut sakalya_db::ScopedTx) -> Result<Vec<(String, i64)>, AppError> {
    let items = aarogyam_dal::billing::price_items(tx.conn()).await?;
    Ok(items
        .into_iter()
        .filter(|i| i.active)
        .filter_map(|i| Some((i.code?, i.price_paise)))
        .collect())
}

/// The clinic's Show patient settings.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`.
pub async fn settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<PresentSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(PresentSettings::from_stored(&dal::get(tx.conn()).await?))
    })
    .await
}

/// Replaces the price mapping and the show-prices switch; other keys stay.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for an unknown key or code.
pub async fn update_settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    settings: PresentSettings,
) -> Result<PresentSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let codes: Vec<String> = price_list(tx).await?.into_iter().map(|(c, _)| c).collect();
        settings
            .validate(&codes)
            .map_err(|e| AppError::invalid("price_map", e))?;
        let mut stored = dal::for_update(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        settings.merge_into(&mut stored);
        dal::save(tx.conn(), &stored).await?;
        Ok(settings)
    })
    .await
}
