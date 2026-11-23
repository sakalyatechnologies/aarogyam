//! A doctor's own day: what they finished, did, issued and collected (`GET /me/stats`).
//! Needs `clinical.read`; the money figure also needs `billing.read` and is `None` without it.
//! A member with no doctor record gets zeros.

use aarogyam_dal::my_stats as dal;
use aarogyam_dal::schedule;
use aarogyam_domain::access::{ActorKind, ClinicActor};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_today, day_bounds};
use crate::error::AppError;
use crate::scope::staff_scope;

/// The figures for one clinic day.
#[derive(Debug, Clone, Copy)]
pub struct MyStats {
    /// The clinic day.
    pub date: Date,
    /// Visits finished.
    pub patients_seen: i64,
    /// Procedures done.
    pub procedures_done: i64,
    /// Prescriptions issued.
    pub prescriptions_issued: i64,
    /// Paise collected on their visits' invoices; `None` without `billing.read`.
    pub collected_paise: Option<i64>,
}

/// The caller's figures for `date` (today in the clinic's time zone by default).
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
    date: Option<Date>,
) -> Result<MyStats, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let timezone = actor.timezone.as_str();
    let date = date.unwrap_or_else(|| clinic_today(timezone, now));
    let money = actor.require(Permission::BillingRead).is_ok();
    let zero = MyStats {
        date,
        patients_seen: 0,
        procedures_done: 0,
        prescriptions_issued: 0,
        collected_paise: money.then_some(0),
    };
    if actor.kind() != ActorKind::Staff {
        return Ok(zero);
    }
    let member = actor.membership_id.uuid();
    let (start, end) = day_bounds(timezone, date);
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let Some(doctor) = schedule::practitioner_of(tx.conn(), member).await? else {
            return Ok(zero);
        };
        let row = dal::my_stats(tx.conn(), doctor.id, member, start, end).await?;
        Ok(MyStats {
            date,
            patients_seen: row.patients_seen,
            procedures_done: row.procedures_done,
            prescriptions_issued: row.prescriptions_issued,
            collected_paise: money.then_some(row.collected_paise),
        })
    })
    .await
}
