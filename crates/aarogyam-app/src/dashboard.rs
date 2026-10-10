//! The Today board's layout: a clinic default that `settings.manage` sets, and each member's
//! own layout, which follows them across devices. Reading a member's layout falls back to the
//! clinic's, then to the `MedSync` template, so a reset is just deleting the row. The layout is
//! checked against the widget registry in `aarogyam-domain` before it is saved, and again when
//! it is read: a saved layout the registry no longer accepts is skipped, not an error.

use aarogyam_dal::dashboard::{self as dal, Saved};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::dashboard::{Layout, Template};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Where the layout shown came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The member's own.
    Member,
    /// The clinic's default.
    Clinic,
    /// No one saved one: the built-in `MedSync` template.
    Template,
}

/// A layout and where it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    /// The layout to show.
    pub layout: Layout,
    /// Which level it is from.
    pub source: Source,
}

fn parse(text: Option<&str>) -> Option<Layout> {
    let value: serde_json::Value = serde_json::from_str(text?).ok()?;
    Layout::from_stored(&value)
}

fn resolve(saved: &Saved, with_member: bool) -> Resolved {
    if with_member && let Some(layout) = parse(saved.member.as_deref()) {
        return Resolved {
            layout,
            source: Source::Member,
        };
    }
    parse(saved.clinic.as_deref()).map_or_else(
        || Resolved {
            layout: Template::Medsync.layout(),
            source: Source::Template,
        },
        |layout| Resolved {
            layout,
            source: Source::Clinic,
        },
    )
}

fn text(layout: &Layout) -> Result<String, AppError> {
    serde_json::to_string(layout).map_err(|_| AppError::Internal("could not write the layout"))
}

/// The caller's layout: their own, else the clinic's, else `MedSync`. Any member may read it.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn mine(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Resolved, AppError> {
    db.scoped(&scope(actor, request_id), async |tx| {
        let saved = dal::saved(tx.conn(), Some(actor.membership_id.uuid())).await?;
        Ok(resolve(&saved, true))
    })
    .await
}

/// Saves the caller's own layout and returns it.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn set_mine(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    layout: Layout,
) -> Result<Resolved, AppError> {
    let json = text(&layout)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::set_member(tx.conn(), actor.membership_id.uuid(), &json).await?;
        Ok::<_, AppError>(())
    })
    .await?;
    Ok(Resolved {
        layout,
        source: Source::Member,
    })
}

/// Removes the caller's own layout and returns the one that applies now: the clinic's or the
/// built-in template.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn reset_mine(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Resolved, AppError> {
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::clear(tx.conn(), Some(actor.membership_id.uuid())).await?;
        let saved = dal::saved(tx.conn(), None).await?;
        Ok(resolve(&saved, false))
    })
    .await
}

/// The clinic's default layout, or `MedSync` when none was saved.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Db`] on database failures.
pub async fn clinic_default(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Resolved, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let saved = dal::saved(tx.conn(), None).await?;
        Ok(resolve(&saved, false))
    })
    .await
}

/// Saves the clinic's default layout and returns it. Members with their own layout keep it.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Db`] on database failures.
pub async fn set_clinic_default(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    layout: Layout,
) -> Result<Resolved, AppError> {
    actor.require(Permission::SettingsManage)?;
    let json = text(&layout)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::set_clinic(tx.conn(), &json).await?;
        Ok::<_, AppError>(())
    })
    .await?;
    Ok(Resolved {
        layout,
        source: Source::Clinic,
    })
}

/// Removes the clinic's default, so the built-in `MedSync` template applies again.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Db`] on database failures.
pub async fn reset_clinic_default(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Resolved, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::clear(tx.conn(), None).await?;
        Ok::<_, AppError>(())
    })
    .await?;
    Ok(Resolved {
        layout: Template::Medsync.layout(),
        source: Source::Template,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(clinic: Option<&Layout>, member: Option<&Layout>) -> Saved {
        Saved {
            clinic: clinic.map(|l| serde_json::to_string(l).unwrap()),
            member: member.map(|l| serde_json::to_string(l).unwrap()),
        }
    }

    #[test]
    fn the_member_wins_then_the_clinic_then_the_template() {
        let (care, focus) = (Template::Care.layout(), Template::Focus.layout());
        let both = saved(Some(&care), Some(&focus));
        assert_eq!(resolve(&both, true).source, Source::Member);
        assert_eq!(resolve(&both, true).layout, focus);
        assert_eq!(resolve(&both, false).layout, care);
        let clinic_only = saved(Some(&care), None);
        assert_eq!(resolve(&clinic_only, true).source, Source::Clinic);
        let none = Saved::default();
        assert_eq!(resolve(&none, true).source, Source::Template);
        assert_eq!(resolve(&none, true).layout.tpl, Template::Medsync);
    }

    #[test]
    fn a_stored_layout_that_no_longer_validates_is_skipped() {
        let care = Template::Care.layout();
        let mut broken = saved(Some(&care), None);
        broken.member = Some(r#"{"v":2,"tpl":"care","items":[{"key":"retired"}]}"#.to_owned());
        let resolved = resolve(&broken, true);
        assert_eq!(resolved.source, Source::Clinic);
        assert_eq!(resolved.layout, care);
        broken.member = Some("not json".to_owned());
        assert_eq!(resolve(&broken, true).source, Source::Clinic);
    }
}
