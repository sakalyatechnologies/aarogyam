//! The mouth snapshot of a visit (docs/plans/visit-story-v2-offers-design.md, section 1.12): the
//! one builder behind `GET /visits/{id}/mouth` (the doctor's Present mode) and the `chart` of the
//! patient's visit page. It reads the recorded facts in the caller's reach and hands them to the
//! pure builder in `aarogyam_domain::mouth`, so both places show exactly the same JSON.

use aarogyam_dal::visit_messages::next_booked;
use aarogyam_dal::{chart, patients, prescriptions as links, treatment, visits};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::ProcedureStatus;
use aarogyam_domain::dental::{ChartData, ToothStatusData};
use aarogyam_domain::dental_details::{CONDITION_KIND, ERUPTION_KIND};
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::mouth::{
    self as builder, DetailRecord, EntryRecord, MouthInput, MouthSnapshot, ProcedureRecord,
    StatusRecord,
};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::patient_message::{PlanItem, plan_in, proposed_in};
use crate::scope::staff_scope;
use crate::tooth_details::{condition_data, eruption_data};

fn age_on(date_of_birth: Option<Date>, on: Date) -> Option<u8> {
    let born = date_of_birth?;
    let mut years = on.year() - born.year();
    if (on.month() as u8, on.day()) < (born.month() as u8, born.day()) {
        years -= 1;
    }
    u8::try_from(years).ok()
}

/// The snapshot of a visit, read inside the caller's transaction (staff or the patient's link).
pub(crate) async fn of_visit(
    tx: &mut ScopedTx,
    visit: &visits::EncounterRow,
    now: OffsetDateTime,
) -> Result<MouthSnapshot, AppError> {
    let timezone = links::clinic_name(tx.conn())
        .await?
        .map(|(_, timezone)| timezone)
        .ok_or(AppError::NotFound("clinic"))?;
    let day = |at: OffsetDateTime| clinic_today(&timezone, at);
    let visit_on = day(visit.started_at);
    let date_of_birth = patients::get(tx.conn(), visit.patient_id, None)
        .await?
        .ok_or(AppError::NotFound("patient"))?
        .date_of_birth;
    let today = |encounter: Option<Uuid>| encounter == Some(visit.id);
    let entries = chart::all_entries(tx.conn(), visit.patient_id)
        .await?
        .into_iter()
        .filter_map(|row| {
            Some(EntryRecord {
                data: serde_json::from_value::<ChartData>(row.data).ok()?,
                current: row.status == "current",
                on: day(row.effective_at),
                in_visit: row.encounter_id.is_some(),
                today: today(row.encounter_id),
            })
        })
        .collect();
    let statuses = chart::current_statuses(tx.conn(), visit.patient_id)
        .await?
        .into_iter()
        .filter_map(|row| {
            Some(StatusRecord {
                data: serde_json::from_value::<ToothStatusData>(row.data).ok()?,
                today: today(row.encounter_id),
            })
        })
        .collect();
    let mut conditions = Vec::new();
    for row in chart::current_of_kind(tx.conn(), visit.patient_id, CONDITION_KIND).await? {
        conditions.push(DetailRecord {
            data: condition_data(&row)?,
            on: day(row.effective_at),
            today: today(row.encounter_id),
        });
    }
    let mut eruptions = Vec::new();
    for row in chart::current_of_kind(tx.conn(), visit.patient_id, ERUPTION_KIND).await? {
        eruptions.push(DetailRecord {
            data: eruption_data(&row)?,
            on: day(row.effective_at),
            today: today(row.encounter_id),
        });
    }
    let tooth = |n: Option<i16>| n.and_then(|n| u8::try_from(n).ok());
    let done_today = treatment::procedures_of_encounter(tx.conn(), visit.id)
        .await?
        .into_iter()
        .filter(|row| row.status == ProcedureStatus::Done.as_str())
        .map(|row| ProcedureRecord {
            tooth: tooth(row.tooth),
            code: row.code,
            name: row.name,
            on: None,
        })
        .collect();
    let record = |item: PlanItem| ProcedureRecord {
        tooth: item.tooth.map(aarogyam_domain::dental::Tooth::number),
        code: item.code,
        name: item.name,
        on: Some(day(item.created_at)),
    };
    let planned = plan_in(tx, visit.id, visit.patient_id)
        .await?
        .into_iter()
        .map(record)
        .collect();
    let recommended = proposed_in(tx, visit.id, visit.patient_id)
        .await?
        .into_iter()
        .map(record)
        .collect();
    let next_visit = next_booked(tx.conn(), visit.patient_id, now)
        .await?
        .map(day);
    Ok(builder::snapshot(&MouthInput {
        visit_on,
        age: age_on(date_of_birth, visit_on),
        entries,
        statuses,
        conditions,
        eruptions,
        done_today,
        planned,
        recommended,
        next_visit,
    }))
}

/// The mouth snapshot of a visit for the doctor's Present mode: the same allowlisted shape the
/// patient's page shows, and nothing else. It works while the visit is open; no messaging check
/// applies.
///
/// # Errors
/// [`AppError::NotFound`] when the visit isn't in this clinic or the caller's clinical reach.
pub async fn snapshot(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    now: OffsetDateTime,
) -> Result<MouthSnapshot, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let visit = visits::get_encounter(
            tx.conn(),
            visit_id.uuid(),
            false,
            actor.reach(Permission::ClinicalRead).member(),
        )
        .await?
        .ok_or(AppError::NotFound("visit"))?;
        of_visit(tx, &visit, now).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn age_counts_whole_years() {
        assert_eq!(
            age_on(Some(date!(2017 - 11 - 21)), date!(2026 - 11 - 20)),
            Some(8)
        );
        assert_eq!(
            age_on(Some(date!(2017 - 11 - 20)), date!(2026 - 11 - 20)),
            Some(9)
        );
        assert_eq!(age_on(None, date!(2026 - 11 - 20)), None);
    }
}
