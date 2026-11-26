//! Sterilisation cycles: staff record each autoclave run (`tasks.use`, the permission that
//! completes the "Sterilise instruments" task) and list a day's runs. The Today screen counts
//! the day's cycles.

use aarogyam_dal::sterilisation::{self as dal, CycleRow, NewCycle};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::SterilisationCycleId;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_today, day_bounds};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Longest load note, in characters.
const MAX_NOTE: usize = 120;

/// A recorded cycle.
#[derive(Debug, Clone)]
pub struct Cycle {
    /// Identifier.
    pub id: SterilisationCycleId,
    /// When it ran.
    pub run_at: OffsetDateTime,
    /// The member who recorded it.
    pub recorded_by: Uuid,
    /// Their name, when known.
    pub recorded_by_name: Option<String>,
    /// What was in the load.
    pub load_note: Option<String>,
}

impl From<CycleRow> for Cycle {
    fn from(row: CycleRow) -> Self {
        Self {
            id: SterilisationCycleId::from_uuid(row.id),
            run_at: row.run_at,
            recorded_by: row.recorded_by,
            recorded_by_name: row.recorded_by_name,
            load_note: row.load_note,
        }
    }
}

/// A load note: trimmed, at most 120 characters, no control characters; empty means none.
fn check_note(note: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(note) = note.map(str::trim).filter(|note| !note.is_empty()) else {
        return Ok(None);
    };
    if note.chars().count() > MAX_NOTE || note.chars().any(char::is_control) {
        return Err(AppError::invalid(
            "load_note",
            "must be at most 120 characters",
        ));
    }
    Ok(Some(note.to_owned()))
}

/// Records a cycle that ran now.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.use`; [`AppError::Invalid`] for a bad note.
pub async fn record(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    load_note: Option<&str>,
    now: OffsetDateTime,
) -> Result<Cycle, AppError> {
    actor.require(Permission::TasksUse)?;
    let note = check_note(load_note)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::insert(
            tx.conn(),
            &NewCycle {
                id: SterilisationCycleId::new_v7().uuid(),
                run_at: now,
                recorded_by: actor.membership_id.uuid(),
                load_note: note.as_deref(),
            },
        )
        .await?;
        Ok(Cycle::from(row))
    })
    .await
}

/// The cycles of a clinic day (default today), latest first.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.use`.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    date: Option<Date>,
    now: OffsetDateTime,
) -> Result<(Date, Vec<Cycle>), AppError> {
    actor.require(Permission::TasksUse)?;
    let date = date.unwrap_or_else(|| clinic_today(&actor.timezone, now));
    let (start, end) = day_bounds(&actor.timezone, date);
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(dal::list(tx.conn(), start, end).await?)
        })
        .await?;
    Ok((date, rows.into_iter().map(Cycle::from).collect()))
}
