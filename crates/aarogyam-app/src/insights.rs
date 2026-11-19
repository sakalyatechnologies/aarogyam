//! The console's Insights page: the drain job's daily steps (database samples, clinic journeys
//! and active staff) and the usage summary the console reads. Everything here is counts,
//! timings and dates; no patient, member or record ever reaches it
//! (docs/plans/console-insights-design.md, Phase 1).

use std::collections::BTreeMap;

use aarogyam_dal::insights as dal;
use sakalya_db::{Db, DbError};
use time::Date;
use uuid::Uuid;

pub use dal::{DbSample, OnboardingRow, RoleDay};

/// Most clinics whose journey day one drain run records.
pub const JOURNEY_BATCH: i32 = 20;

/// Takes a database sample unless one was taken in the last 5 minutes. Returns whether it took
/// one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_db_sample(db: &Db) -> Result<bool, DbError> {
    dal::record_db_sample(db.pool()).await
}

/// What one run of [`record_journeys`] did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct JourneyReport {
    /// Clinics that had no row for their yesterday.
    pub due: usize,
    /// Rows written (another run may have written the rest).
    pub written: usize,
    /// Clinics that failed; they are picked again next run.
    pub failed: usize,
}

/// Records yesterday's journey and active staff for up to [`JOURNEY_BATCH`] clinics, each in its
/// own transaction. One clinic failing is logged and the rest still run.
///
/// # Errors
/// [`DbError`] when the clinics due cannot be read.
pub async fn record_journeys(db: &Db) -> Result<JourneyReport, DbError> {
    let due = dal::journey_days_due(db.pool(), JOURNEY_BATCH).await?;
    let mut report = JourneyReport {
        due: due.len(),
        ..JourneyReport::default()
    };
    for clinic in due {
        match dal::record_journey_day(db.pool(), clinic.org_id, clinic.day).await {
            Ok(true) => report.written += 1,
            Ok(false) => {}
            Err(error) => {
                report.failed += 1;
                tracing::warn!(org_id = %clinic.org_id, error = %error, "could not record a clinic's journey day");
            }
        }
    }
    Ok(report)
}

/// Database samples since `since`, one point per `bucket_seconds`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn db_history(
    db: &Db,
    since: time::OffsetDateTime,
    bucket_seconds: i32,
) -> Result<Vec<DbSample>, DbError> {
    dal::db_history(db.pool(), since, bucket_seconds).await
}

/// Typical timings: the visit-weighted mean of the daily medians that were not suppressed.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Timings {
    /// Arrived to seated, minutes.
    pub arrive_to_seat_p50: Option<f64>,
    /// Seated to visit started, minutes.
    pub seat_to_start_p50: Option<f64>,
    /// Visit length, minutes.
    pub visit_minutes_p50: Option<f64>,
    /// Visit ended to first payment, minutes.
    pub end_to_paid_p50: Option<f64>,
    /// Days between booking and appointment (weighted by appointments booked).
    pub booking_lead_days_p50: Option<f64>,
}

/// All clinics together on one day.
#[derive(Debug, Clone, PartialEq)]
pub struct UsageDay {
    /// The day, in each clinic's own time.
    pub day: Date,
    /// Clinics with a row that day.
    pub clinics: i32,
    /// Visits started.
    pub visits: i64,
    /// Appointments booked for the day.
    pub booked: i64,
    /// No-shows.
    pub no_shows: i64,
    /// Members active, summed over clinics (a person in two clinics counts in each).
    pub active_staff: i64,
    /// Typical timings across clinics.
    pub timings: Timings,
}

/// One clinic over the range.
#[derive(Debug, Clone, PartialEq)]
pub struct ClinicUsage {
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// Days with a row.
    pub days: i32,
    /// Visits started.
    pub visits: i64,
    /// Appointments booked.
    pub booked: i64,
    /// No-shows.
    pub no_shows: i64,
    /// Members active on the latest day, all roles together.
    pub active_staff: i32,
    /// Typical timings.
    pub timings: Timings,
    /// Members active by role on the latest day, only roles with 3 or more.
    pub roles: Vec<(String, i32)>,
}

/// The console's usage summary.
#[derive(Debug, Clone, PartialEq)]
pub struct Usage {
    /// First day.
    pub from: Date,
    /// Last day, included.
    pub to: Date,
    /// All clinics together, per day, oldest first.
    pub days: Vec<UsageDay>,
    /// Each clinic over the range, busiest first.
    pub clinics: Vec<ClinicUsage>,
    /// Active staff by role across all clinics, per day.
    pub roles: Vec<RoleDay>,
    /// Each clinic's onboarding, newest first.
    pub onboarding: Vec<OnboardingRow>,
}

/// The usage summary from `from` to `to` (included).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn usage(db: &Db, from: Date, to: Date) -> Result<Usage, DbError> {
    let pool = db.pool();
    let journeys = dal::journeys(pool, from, to).await?;
    let clinic_roles = dal::clinic_roles(pool, from, to).await?;
    let roles = dal::active_roles(pool, from, to).await?;
    let onboarding = dal::onboarding(pool).await?;
    let (days, clinics) = summarise(&journeys, &clinic_roles);
    Ok(Usage {
        from,
        to,
        days,
        clinics,
        roles,
        onboarding,
    })
}

/// A weighted mean that skips missing values; `None` when nothing has weight.
#[derive(Default)]
struct Mean {
    sum: f64,
    weight: f64,
}

impl Mean {
    fn add(&mut self, value: Option<f64>, weight: i32) {
        if let Some(value) = value
            && weight > 0
        {
            self.sum += value * f64::from(weight);
            self.weight += f64::from(weight);
        }
    }

    fn get(&self) -> Option<f64> {
        (self.weight > 0.0).then(|| (self.sum / self.weight * 10.0).round() / 10.0)
    }
}

#[derive(Default)]
struct TimingMeans {
    arrive: Mean,
    seat: Mean,
    visit: Mean,
    paid: Mean,
    lead: Mean,
}

impl TimingMeans {
    fn add(&mut self, row: &dal::JourneyDay) {
        self.arrive.add(row.arrive_to_seat_p50, row.visits);
        self.seat.add(row.seat_to_start_p50, row.visits);
        self.visit.add(row.visit_minutes_p50, row.visits);
        self.paid.add(row.end_to_paid_p50, row.visits);
        self.lead.add(row.booking_lead_days_p50, row.booked);
    }

    fn get(&self) -> Timings {
        Timings {
            arrive_to_seat_p50: self.arrive.get(),
            seat_to_start_p50: self.seat.get(),
            visit_minutes_p50: self.visit.get(),
            end_to_paid_p50: self.paid.get(),
            booking_lead_days_p50: self.lead.get(),
        }
    }
}

/// Per day across clinics, and per clinic across days (busiest first).
fn summarise(
    journeys: &[dal::JourneyDay],
    clinic_roles: &[dal::ClinicRoleDay],
) -> (Vec<UsageDay>, Vec<ClinicUsage>) {
    let mut days: BTreeMap<Date, (UsageDay, TimingMeans)> = BTreeMap::new();
    let mut clinics: BTreeMap<Uuid, (ClinicUsage, TimingMeans, Option<Date>)> = BTreeMap::new();
    for row in journeys {
        let (day, means) = days.entry(row.day).or_insert_with(|| {
            let day = UsageDay {
                day: row.day,
                clinics: 0,
                visits: 0,
                booked: 0,
                no_shows: 0,
                active_staff: 0,
                timings: Timings::default(),
            };
            (day, TimingMeans::default())
        });
        day.clinics += 1;
        day.visits += i64::from(row.visits);
        day.booked += i64::from(row.booked);
        day.no_shows += i64::from(row.no_shows);
        day.active_staff += i64::from(row.active_staff);
        means.add(row);

        let (clinic, means, latest) = clinics.entry(row.org_id).or_insert_with(|| {
            let clinic = ClinicUsage {
                org_id: row.org_id,
                slug: row.slug.clone(),
                name: row.name.clone(),
                days: 0,
                visits: 0,
                booked: 0,
                no_shows: 0,
                active_staff: 0,
                timings: Timings::default(),
                roles: Vec::new(),
            };
            (clinic, TimingMeans::default(), None)
        });
        clinic.days += 1;
        clinic.visits += i64::from(row.visits);
        clinic.booked += i64::from(row.booked);
        clinic.no_shows += i64::from(row.no_shows);
        means.add(row);
        if latest.is_none_or(|latest| row.day >= latest) {
            *latest = Some(row.day);
            clinic.active_staff = row.active_staff;
        }
    }
    for role in clinic_roles {
        if let Some((clinic, _, Some(latest))) = clinics.get_mut(&role.org_id)
            && role.day == *latest
        {
            clinic.roles.push((role.role_key.clone(), role.members));
        }
    }
    let days = days
        .into_values()
        .map(|(mut day, means)| {
            day.timings = means.get();
            day
        })
        .collect();
    let mut clinics: Vec<ClinicUsage> = clinics
        .into_values()
        .map(|(mut clinic, means, _)| {
            clinic.timings = means.get();
            clinic
        })
        .collect();
    clinics.sort_by(|a, b| b.visits.cmp(&a.visits).then_with(|| a.slug.cmp(&b.slug)));
    (days, clinics)
}

#[cfg(test)]
mod tests {
    use time::macros::date;

    use super::*;

    fn row(
        org: u128,
        day: Date,
        visits: i32,
        visit_p50: Option<f64>,
        staff: i32,
    ) -> dal::JourneyDay {
        dal::JourneyDay {
            org_id: Uuid::from_u128(org),
            slug: format!("clinic-{org}"),
            name: format!("Clinic {org}"),
            day,
            visits,
            arrive_to_seat_p50: None,
            arrive_to_seat_p90: None,
            seat_to_start_p50: None,
            seat_to_start_p90: None,
            visit_minutes_p50: visit_p50,
            visit_minutes_p90: None,
            end_to_paid_p50: None,
            end_to_paid_p90: None,
            booked: visits,
            no_shows: 1,
            booking_lead_days_p50: None,
            active_staff: staff,
        }
    }

    #[test]
    fn days_add_clinics_up_and_weigh_medians_by_visits() {
        let d1 = date!(2026 - 11 - 17);
        let d2 = date!(2026 - 11 - 18);
        let journeys = [
            row(1, d1, 10, Some(20.0), 3),
            row(2, d1, 30, Some(40.0), 5),
            // Suppressed (fewer than 5 visits): counted, but not in the timing.
            row(1, d2, 3, None, 2),
        ];
        let roles = [
            dal::ClinicRoleDay {
                org_id: Uuid::from_u128(2),
                day: d1,
                role_key: "doctor".into(),
                members: 3,
            },
            dal::ClinicRoleDay {
                org_id: Uuid::from_u128(1),
                day: d1,
                role_key: "doctor".into(),
                members: 3,
            },
        ];
        let (days, clinics) = summarise(&journeys, &roles);
        assert_eq!(days.len(), 2);
        assert_eq!(
            (days[0].clinics, days[0].visits, days[0].no_shows),
            (2, 40, 2)
        );
        assert_eq!(days[0].active_staff, 8);
        assert_eq!(days[0].timings.visit_minutes_p50, Some(35.0));
        assert_eq!(days[1].timings.visit_minutes_p50, None);

        assert_eq!(clinics[0].slug, "clinic-2");
        assert_eq!(clinics[0].roles, [("doctor".to_owned(), 3)]);
        // Clinic 1's latest day is d2: its d1 role row is not shown, and staff is d2's.
        assert_eq!(clinics[1].slug, "clinic-1");
        assert_eq!((clinics[1].days, clinics[1].visits), (2, 13));
        assert_eq!(clinics[1].active_staff, 2);
        assert_eq!(clinics[1].roles, Vec::<(String, i32)>::new());
        assert_eq!(clinics[1].timings.visit_minutes_p50, Some(20.0));
    }

    #[test]
    fn nothing_recorded_is_an_empty_summary() {
        let (days, clinics) = summarise(&[], &[]);
        assert_eq!((days, clinics), (vec![], vec![]));
    }
}
