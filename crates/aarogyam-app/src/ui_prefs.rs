//! A member's saved screen choices (migration 0745, docs/plans/present-studio-design.md §12.2).
//! No row means the defaults; a stored value this build does not know falls back to the default.

use aarogyam_dal::member_ui_prefs as dal;
use aarogyam_domain::access::{ActorKind, ClinicActor, Denied};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;

/// The Show patient styles, the first is the default.
pub const PRESENT_STYLES: [&str; 5] = ["story", "painted", "xray", "smile3d", "face"];
/// The history views, the first is the default.
pub const HISTORY_VIEWS: [&str; 3] = ["page", "popup", "story"];

/// A member's choices, with defaults filled in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UiPrefs {
    /// The Show patient style.
    pub present_style: &'static str,
    /// The history view.
    pub history_view: &'static str,
}

fn known(options: &'static [&'static str], value: Option<&str>) -> &'static str {
    value
        .and_then(|v| options.iter().find(|o| **o == v).copied())
        .unwrap_or(options[0])
}

impl From<dal::UiPrefsRow> for UiPrefs {
    fn from(row: dal::UiPrefsRow) -> Self {
        Self {
            present_style: known(&PRESENT_STYLES, row.present_style.as_deref()),
            history_view: known(&HISTORY_VIEWS, row.history_view.as_deref()),
        }
    }
}

fn own_member(actor: &ClinicActor) -> Option<Uuid> {
    (actor.kind() == ActorKind::Staff).then(|| actor.membership_id.uuid())
}

/// The caller's choices.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<UiPrefs, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let Some(member) = own_member(actor) else {
        return Ok(dal::UiPrefsRow::default().into());
    };
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(dal::get(tx.conn(), member)
            .await?
            .unwrap_or_default()
            .into())
    })
    .await
}

/// Saves the fields that are sent.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`, or for Sakalya support;
/// [`AppError::Invalid`] on an unknown value (not echoed).
pub async fn save(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    present_style: Option<&str>,
    history_view: Option<&str>,
) -> Result<UiPrefs, AppError> {
    actor.require(Permission::ClinicalRead)?;
    if present_style.is_some_and(|v| !PRESENT_STYLES.contains(&v)) {
        return Err(AppError::invalid("present_style", "unknown style"));
    }
    if history_view.is_some_and(|v| !HISTORY_VIEWS.contains(&v)) {
        return Err(AppError::invalid("history_view", "unknown view"));
    }
    let member = own_member(actor).ok_or(AppError::Denied(Denied::NotAMember))?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(dal::save(tx.conn(), member, present_style, history_view)
            .await?
            .into())
    })
    .await
}
