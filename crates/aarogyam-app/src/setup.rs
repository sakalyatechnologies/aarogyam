//! First-run setup: the clinic owner's short wizard (`settings.manage`) and each member's own
//! one-screen version. Answers are saved per step; every step can be skipped.

use aarogyam_dal::setup::{self as dal, SetupRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::setup::{
    Practice, Standing, StepStatus, Track, is_complete, read_steps, standing,
};
use sakalya_db::Db;
use serde_json::{Map, Value};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;

/// Where a setup stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupView {
    /// The overall standing.
    pub standing: Standing,
    /// `solo`, `team` or `multi`, once the owner said (the clinic's setup only).
    pub practice: Option<String>,
    /// Every step of the track, in order, with its status (`None` while still to do).
    pub steps: Vec<(String, Option<StepStatus>)>,
}

/// What to change; anything left out stays as it is.
#[derive(Debug, Clone, Default)]
pub struct SetupChanges {
    /// A step and how it ended; `None` as the status reopens it.
    pub step: Option<(String, Option<StepStatus>)>,
    /// Close or reopen the "Finish setting up" card.
    pub dismissed: Option<bool>,
    /// How the clinic practises (clinic setup only).
    pub practice: Option<String>,
}

fn view_of(track: Track, row: Option<&SetupRow>) -> SetupView {
    let (steps, dismissed, practice) = row.map_or_else(
        || (std::collections::BTreeMap::default(), false, None),
        |row| {
            (
                read_steps(track, &row.steps),
                row.dismissed_at.is_some(),
                row.practice.clone(),
            )
        },
    );
    SetupView {
        standing: standing(track, &steps, dismissed),
        practice,
        steps: track
            .steps()
            .iter()
            .map(|key| ((*key).to_owned(), steps.get(*key).copied()))
            .collect(),
    }
}

/// Applies `changes` to a row and returns it ready to save.
fn apply(track: Track, mut row: SetupRow, changes: &SetupChanges) -> Result<SetupRow, AppError> {
    let mut steps = read_steps(track, &row.steps);
    if let Some((key, status)) = &changes.step {
        if !track.has_step(key) {
            return Err(AppError::invalid("step", "not a setup step"));
        }
        match status {
            Some(status) => steps.insert(key.clone(), *status),
            None => steps.remove(key),
        };
    }
    if let Some(practice) = &changes.practice {
        if track != Track::Clinic {
            return Err(AppError::invalid("practice", "only the clinic has one"));
        }
        row.practice = Some(
            Practice::parse(practice)
                .ok_or_else(|| AppError::invalid("practice", "must be solo, team or multi"))?
                .as_str()
                .to_owned(),
        );
    }
    if let Some(dismissed) = changes.dismissed {
        row.dismissed_at = dismissed.then(OffsetDateTime::now_utc);
    }
    row.completed_at = if is_complete(track, &steps) {
        row.completed_at.or_else(|| Some(OffsetDateTime::now_utc()))
    } else {
        None
    };
    let mut map = Map::new();
    for (key, status) in &steps {
        map.insert(key.clone(), Value::String(status.as_str().to_owned()));
    }
    row.steps = Value::Object(map);
    Ok(row)
}

/// The clinic's setup.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Db`] on database failures.
pub async fn clinic(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<SetupView, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let row = dal::clinic(tx.conn()).await?;
        Ok(view_of(Track::Clinic, row.as_ref()))
    })
    .await
}

/// Changes the clinic's setup.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for an unknown step
/// or practice; [`AppError::Db`] on database failures.
pub async fn change_clinic(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    changes: SetupChanges,
) -> Result<SetupView, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let row = dal::clinic_for_update(tx.conn()).await?;
        let row = apply(Track::Clinic, row, &changes)?;
        dal::save_clinic(tx.conn(), &row).await?;
        Ok(view_of(Track::Clinic, Some(&row)))
    })
    .await
}

/// The member's own setup. Needs no permission: it is the member's own.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn mine(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<SetupView, AppError> {
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let row = dal::member(tx.conn(), actor.membership_id.uuid()).await?;
        Ok(view_of(Track::Member, row.as_ref()))
    })
    .await
}

/// Changes the member's own setup.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown step; [`AppError::Db`] on database failures.
pub async fn change_mine(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    changes: SetupChanges,
) -> Result<SetupView, AppError> {
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let row = dal::member_for_update(tx.conn(), actor.membership_id.uuid()).await?;
        let row = apply(Track::Member, row, &changes)?;
        dal::save_member(tx.conn(), actor.membership_id.uuid(), &row).await?;
        Ok(view_of(Track::Member, Some(&row)))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(steps: &Value) -> SetupRow {
        SetupRow {
            practice: None,
            steps: steps.clone(),
            dismissed_at: None,
            completed_at: None,
        }
    }

    #[test]
    fn answering_every_step_completes_and_reopening_undoes_it() {
        let all =
            json!({ "clinic": "done", "hours": "done", "look": "skipped", "services": "done" });
        let changes = SetupChanges {
            step: Some(("team".into(), Some(StepStatus::Skipped))),
            ..SetupChanges::default()
        };
        let done = apply(Track::Clinic, row(&all), &changes).unwrap();
        assert!(done.completed_at.is_some());
        assert_eq!(
            view_of(Track::Clinic, Some(&done)).standing,
            Standing::Complete
        );
        let reopen = SetupChanges {
            step: Some(("look".into(), None)),
            ..SetupChanges::default()
        };
        let reopened = apply(Track::Clinic, done, &reopen).unwrap();
        assert!(reopened.completed_at.is_none());
        assert_eq!(
            view_of(Track::Clinic, Some(&reopened)).standing,
            Standing::InProgress
        );
    }

    #[test]
    fn bad_steps_and_practices_are_refused() {
        let bad_step = SetupChanges {
            step: Some(("profile".into(), Some(StepStatus::Done))),
            ..SetupChanges::default()
        };
        assert!(apply(Track::Clinic, row(&json!({})), &bad_step).is_err());
        let bad_practice = SetupChanges {
            practice: Some("chain".into()),
            ..SetupChanges::default()
        };
        assert!(apply(Track::Clinic, row(&json!({})), &bad_practice).is_err());
        let member_practice = SetupChanges {
            practice: Some("solo".into()),
            ..SetupChanges::default()
        };
        assert!(apply(Track::Member, row(&json!({})), &member_practice).is_err());
    }
}
