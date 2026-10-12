//! The owner's Analytics page: chair utilization, income and expenses, and who the patients
//! are, by month or week. Needs `analytics.view`; the money figures also need `finance.view`
//! and are `None` without it. One clinic transaction, one statement.
//!
//! Rules (see `docs/decisions.md`, "Analytics: chair utilization and material costs"):
//! - utilization is a chair's booked minutes (appointments not cancelled and not unconfirmed
//!   online requests; no-shows count, the chair was held) over open minutes, from the opening
//!   hours of the chair's branch, or nine hours a day when the branch has none;
//! - expenses are the recorded expense entries plus stock received at cost, which counts as
//!   `material`;
//! - a patient is new in the period of their first visit ever, and returning after it.

use aarogyam_dal::analytics::{self as dal, AnalyticsQuery, AnalyticsRows};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::analytics::{
    AgeBand, Bucket, ChairTime, MAX_DAYS, OPEN_MINUTES_PER_DAY, ReferralKind, default_from,
    open_minutes, utilization_bps,
};
use aarogyam_domain::expense::ExpenseCategoryKey;
use aarogyam_domain::ids::RoomId;
use aarogyam_domain::patient::Sex;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::AppointmentKind;
use sakalya_db::Db;
use sakalya_types::Paise;
use std::collections::BTreeMap;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_today, day_range};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// A chair the report covers.
#[derive(Debug, Clone)]
pub struct ChairRef {
    /// The chair.
    pub id: RoomId,
    /// Its name.
    pub name: String,
    /// Minutes open per weekday (Monday first) from its branch's opening hours; `None` when the
    /// branch has none and [`OPEN_MINUTES_PER_DAY`] is assumed.
    pub week: Option<[i64; 7]>,
}

/// One chair's use in a period.
#[derive(Debug, Clone, Copy)]
pub struct ChairUse {
    /// The chair.
    pub room_id: RoomId,
    /// Booked minutes.
    pub booked_minutes: i64,
    /// Open minutes on the days of the period in the range, from [`ChairRef::week`].
    pub open_minutes: i64,
    /// Appointments.
    pub appointments: i64,
    /// Booked over open, in basis points.
    pub utilization_bps: i64,
}

/// Spent in one category in a period.
#[derive(Debug, Clone, Copy)]
pub struct CategoryAmount {
    /// The category.
    pub category: ExpenseCategoryKey,
    /// Spent, including stock received for `material`.
    pub amount: Paise,
}

/// The money in a period, for callers with `finance.view`.
#[derive(Debug, Clone)]
pub struct PeriodMoney {
    /// Payments received, not void.
    pub income: Paise,
    /// How many payments.
    pub payments: i64,
    /// Every category, zero when nothing was spent.
    pub expenses: Vec<CategoryAmount>,
    /// Stock received at cost, already inside `material`.
    pub stock_purchases: Paise,
    /// All expenses.
    pub expenses_total: Paise,
}

/// One month or week.
#[derive(Debug, Clone)]
pub struct Period {
    /// The period's first day (a Monday for weeks, the 1st for months).
    pub start: Date,
    /// The first day counted: `start`, or the range's first day.
    pub first_day: Date,
    /// The last day counted.
    pub last_day: Date,
    /// Every chair, in the order of [`Analytics::chairs`].
    pub chairs: Vec<ChairUse>,
    /// Money, or `None` without `finance.view`.
    pub money: Option<PeriodMoney>,
    /// Patients whose first visit ever was in this period.
    pub new_patients: i64,
    /// Patients seen who had visited before.
    pub returning_patients: i64,
}

/// The Analytics report.
#[derive(Debug, Clone)]
pub struct Analytics {
    /// First day.
    pub from: Date,
    /// Last day, included.
    pub to: Date,
    /// Months or weeks.
    pub bucket: Bucket,
    /// The open minutes assumed per day for a chair whose branch has no opening hours.
    pub open_minutes_per_day: i64,
    /// Whether money is filled in (the caller has `finance.view`).
    pub money_visible: bool,
    /// Chairs: the active ones, and any other with bookings in the range.
    pub chairs: Vec<ChairRef>,
    /// Every period in the range, oldest first.
    pub periods: Vec<Period>,
    /// Patients seen in the range, by age on the last day; every band listed.
    pub age_bands: Vec<(AgeBand, i64)>,
    /// Visits in the range by appointment kind; every kind listed.
    pub visit_kinds: Vec<(AppointmentKind, i64)>,
    /// Patients whose first visit was in the range, by referral source; every kind listed.
    pub referral_sources: Vec<(ReferralKind, i64)>,
    /// Visits by ISO weekday (1 Monday) and hour in clinic time; only non-zero cells.
    pub busy_hours: Vec<(u8, u8, i64)>,
    /// Patients seen in the range, by recorded sex; every value listed.
    pub sexes: Vec<(Sex, i64)>,
    /// Procedures done in the range, by the category of the bill line that charged them; the
    /// key is [`UNCATEGORISED`] for those not billed or without a category. Most first.
    pub procedures: Vec<ProcedureMix>,
    /// Booked chair minutes by hour: per chair, and per weekday. Only cells with bookings.
    pub occupancy: Occupancy,
    /// Booked chair minutes by what they were spent on.
    pub chair_time: Vec<(ChairTime, i64)>,
    /// Visits that were booked appointments.
    pub booked_visits: i64,
    /// Walk-in tokens issued in the range.
    pub walk_ins: i64,
    /// Lab orders received back in the range.
    pub lab_orders_received: i64,
    /// Their average days from sent to received, to one decimal; `None` when there were none.
    pub lab_turnaround_days: Option<f64>,
}

/// Procedures done under one bill category.
#[derive(Debug, Clone)]
pub struct ProcedureMix {
    /// The category, or [`UNCATEGORISED`].
    pub category: String,
    /// Procedures done.
    pub count: i64,
    /// What their issued bill lines came to, including GST; `None` without `finance.view`.
    pub amount: Option<Paise>,
}

/// Booked minutes in an hour of the day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HourLoad {
    /// Hour of the day in clinic time, 0 to 23.
    pub hour: u8,
    /// Booked minutes (no-shows included) that fall in the hour, over the range.
    pub booked_minutes: i64,
    /// Appointments touching the hour.
    pub appointments: i64,
}

/// Occupancy of the chairs by hour over the range.
#[derive(Debug, Clone, Default)]
pub struct Occupancy {
    /// Per chair and hour of the day, all weekdays added.
    pub by_chair_hour: Vec<(RoomId, HourLoad)>,
    /// Per ISO weekday (1 Monday) and hour of the day, all chairs added.
    pub by_weekday_hour: Vec<(u8, HourLoad)>,
}

/// The category shown for procedures with none.
pub const UNCATEGORISED: &str = "uncategorised";

/// Average days at the lab, to one decimal.
#[expect(
    clippy::cast_precision_loss,
    reason = "minutes in a report fit an f64 exactly"
)]
fn average_days(orders: i64, total_minutes: i64) -> Option<f64> {
    (orders > 0).then(|| {
        let days = total_minutes as f64 / orders as f64 / 1440.0;
        (days * 10.0).round() / 10.0
    })
}

/// The report for clinic days `from` to `to` by `bucket` (months by default). The last twelve
/// months by default; at most 731 days.
///
/// # Errors
/// [`AppError::Denied`] without `analytics.view`; [`AppError::Invalid`] for a backwards or
/// too-long range.
pub async fn report(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    from: Option<Date>,
    to: Option<Date>,
    bucket: Option<Bucket>,
    now: OffsetDateTime,
) -> Result<Analytics, AppError> {
    actor.require(Permission::AnalyticsView)?;
    let money = actor.permissions.allows(Permission::FinanceView);
    let bucket = bucket.unwrap_or(Bucket::Month);
    let timezone = actor.timezone.as_str();
    let to = to.unwrap_or_else(|| clinic_today(timezone, now));
    let from = from.unwrap_or_else(|| default_from(to));
    let days = (to - from).whole_days();
    if days < 0 {
        return Err(AppError::invalid("from", "must not be after to"));
    }
    if days >= MAX_DAYS {
        return Err(AppError::invalid(
            "from",
            "the range can be at most 731 days (24 months)",
        ));
    }
    let (start, end) = day_range(timezone, from, to);
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            let rows = dal::analytics(
                tx.conn(),
                &AnalyticsQuery {
                    timezone,
                    bucket: bucket.as_str(),
                    from,
                    to,
                    start,
                    end,
                    money,
                },
            )
            .await?;
            Ok::<_, AppError>(rows)
        })
        .await?;
    Ok(build(from, to, bucket, money, &rows))
}

/// Minutes open per weekday for a branch, from the opening hours read with the report.
fn branch_week(rows: &AnalyticsRows, branch_id: Option<Uuid>) -> Option<[i64; 7]> {
    let branch_id = branch_id?;
    let mut week = [0_i64; 7];
    let mut any = false;
    for day in rows
        .open_days
        .iter()
        .filter(|day| day.branch_id == branch_id)
    {
        let index = usize::try_from(day.weekday - 1).ok().filter(|d| *d < 7)?;
        week[index] += day.minutes.max(0);
        any = true;
    }
    any.then_some(week)
}

fn chairs_of(rows: &AnalyticsRows) -> Vec<ChairRef> {
    let mut chairs: Vec<ChairRef> = rows
        .chairs
        .iter()
        .map(|chair| ChairRef {
            id: RoomId::from_uuid(chair.room_id),
            name: chair.name.clone(),
            week: branch_week(rows, chair.branch_id),
        })
        .collect();
    for used in &rows.chair_periods {
        if !chairs.iter().any(|chair| chair.id.uuid() == used.room_id) {
            chairs.push(ChairRef {
                id: RoomId::from_uuid(used.room_id),
                name: used.name.clone(),
                week: branch_week(rows, used.branch_id),
            });
        }
    }
    chairs.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.uuid().cmp(&b.id.uuid())));
    chairs
}

fn money_of(rows: &AnalyticsRows, start: Date) -> PeriodMoney {
    let (income, payments) = rows
        .income
        .iter()
        .filter(|row| row.period == start)
        .fold((0, 0), |(a, n), row| (a + row.amount_paise, n + row.count));
    let stock: i64 = rows
        .stock
        .iter()
        .filter(|row| row.period == start)
        .map(|row| row.amount_paise)
        .sum();
    let expenses: Vec<CategoryAmount> = ExpenseCategoryKey::ALL
        .iter()
        .map(|category| {
            let recorded: i64 = rows
                .expenses
                .iter()
                .filter(|row| {
                    row.period == start
                        && row.key.as_deref().map_or(ExpenseCategoryKey::Other, |key| {
                            ExpenseCategoryKey::parse(key).unwrap_or(ExpenseCategoryKey::Other)
                        }) == *category
                })
                .map(|row| row.amount_paise)
                .sum();
            let from_stock = if *category == ExpenseCategoryKey::Material {
                stock
            } else {
                0
            };
            CategoryAmount {
                category: *category,
                amount: Paise::new(recorded + from_stock),
            }
        })
        .collect();
    PeriodMoney {
        income: Paise::new(income),
        payments,
        expenses_total: Paise::new(expenses.iter().map(|e| e.amount.get()).sum()),
        expenses,
        stock_purchases: Paise::new(stock),
    }
}

/// Sums `rows` under every key in `keys`, in that order; `key_of` gives a row's key and count.
fn tally<K: Copy + PartialEq, R>(
    keys: &[K],
    rows: &[R],
    key_of: impl Fn(&R) -> (K, i64),
) -> Vec<(K, i64)> {
    keys.iter()
        .map(|key| {
            let count = rows
                .iter()
                .map(&key_of)
                .filter(|(k, _)| k == key)
                .map(|(_, n)| n)
                .sum();
            (*key, count)
        })
        .collect()
}

/// Adds the occupancy cells up per chair and hour, and per weekday and hour.
fn occupancy_of(cells: &[dal::OccupancyCell]) -> Occupancy {
    let mut by_chair: BTreeMap<(Uuid, u8), HourLoad> = BTreeMap::new();
    let mut by_weekday: BTreeMap<(u8, u8), HourLoad> = BTreeMap::new();
    for cell in cells {
        let (Some(weekday), Some(hour)) = (
            u8::try_from(cell.weekday)
                .ok()
                .filter(|d| (1..=7).contains(d)),
            u8::try_from(cell.hour).ok().filter(|h| *h < 24),
        ) else {
            continue;
        };
        for load in [
            by_chair.entry((cell.room_id, hour)).or_insert(HourLoad {
                hour,
                booked_minutes: 0,
                appointments: 0,
            }),
            by_weekday.entry((weekday, hour)).or_insert(HourLoad {
                hour,
                booked_minutes: 0,
                appointments: 0,
            }),
        ] {
            load.booked_minutes += cell.minutes;
            load.appointments += cell.appointments;
        }
    }
    Occupancy {
        by_chair_hour: by_chair
            .into_iter()
            .map(|((room, _), load)| (RoomId::from_uuid(room), load))
            .collect(),
        by_weekday_hour: by_weekday
            .into_iter()
            .map(|((weekday, _), load)| (weekday, load))
            .collect(),
    }
}

#[expect(
    clippy::too_many_lines,
    reason = "one pass that turns the statement's rows into the report"
)]
fn build(from: Date, to: Date, bucket: Bucket, money: bool, rows: &AnalyticsRows) -> Analytics {
    let chairs = chairs_of(rows);
    let periods = bucket
        .periods(from, to)
        .into_iter()
        .map(|(start, first_day, last_day)| {
            let chair_uses = chairs
                .iter()
                .map(|chair| {
                    let (booked, appointments) = rows
                        .chair_periods
                        .iter()
                        .filter(|row| row.period == start && row.room_id == chair.id.uuid())
                        .fold((0, 0), |(m, n), row| {
                            (m + row.minutes, n + row.appointments)
                        });
                    let open = open_minutes(first_day, last_day, chair.week.as_ref());
                    ChairUse {
                        room_id: chair.id,
                        booked_minutes: booked,
                        open_minutes: open,
                        appointments,
                        utilization_bps: utilization_bps(booked, open),
                    }
                })
                .collect();
            let patients = rows.patients.iter().find(|row| row.period == start);
            Period {
                start,
                first_day,
                last_day,
                chairs: chair_uses,
                money: money.then(|| money_of(rows, start)),
                new_patients: patients.map_or(0, |row| row.new),
                returning_patients: patients.map_or(0, |row| row.returning),
            }
        })
        .collect();
    let age_bands = tally(AgeBand::ALL, &rows.ages, |row| {
        (AgeBand::of(row.years), row.count)
    });
    let visit_kinds = tally(AppointmentKind::ALL, &rows.visit_kinds, |row| {
        let kind = row
            .key
            .as_deref()
            .and_then(|key| AppointmentKind::parse(key).ok());
        (kind.unwrap_or(AppointmentKind::FollowUp), row.count)
    });
    let referral_sources = tally(ReferralKind::ALL, &rows.referrals, |row| {
        let kind = row.key.as_deref().map_or(ReferralKind::Unknown, |key| {
            ReferralKind::parse(key).unwrap_or(ReferralKind::Other)
        });
        (kind, row.count)
    });
    let sexes = tally(
        &[Sex::Female, Sex::Male, Sex::Other, Sex::Unknown],
        &rows.sexes,
        |row| {
            let sex = row.key.as_deref().and_then(|key| Sex::parse(key).ok());
            (sex.unwrap_or(Sex::Unknown), row.count)
        },
    );
    let mut procedures: Vec<ProcedureMix> = Vec::new();
    for row in &rows.procedures {
        let key = row.key.as_deref().unwrap_or(UNCATEGORISED);
        match procedures.iter_mut().find(|mix| mix.category == key) {
            Some(mix) => {
                mix.count += row.count;
                mix.amount = mix.amount.map(|a| Paise::new(a.get() + row.amount_paise));
            }
            None => procedures.push(ProcedureMix {
                category: key.to_owned(),
                count: row.count,
                amount: money.then(|| Paise::new(row.amount_paise)),
            }),
        }
    }
    procedures.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.category.cmp(&b.category))
    });
    let occupancy = occupancy_of(&rows.occupancy);
    let chair_time = tally(ChairTime::ALL, &rows.chair_kinds, |row| {
        let kind = row
            .key
            .as_deref()
            .and_then(|key| AppointmentKind::parse(key).ok());
        (
            ChairTime::of(kind.unwrap_or(AppointmentKind::FollowUp)),
            row.minutes,
        )
    });
    let busy_hours = rows
        .busy_hours
        .iter()
        .filter_map(|row| {
            let weekday = u8::try_from(row.weekday)
                .ok()
                .filter(|d| (1..=7).contains(d))?;
            let hour = u8::try_from(row.hour).ok().filter(|h| *h < 24)?;
            Some((weekday, hour, row.count))
        })
        .collect();
    Analytics {
        from,
        to,
        bucket,
        open_minutes_per_day: OPEN_MINUTES_PER_DAY,
        money_visible: money,
        chairs,
        periods,
        age_bands,
        visit_kinds,
        referral_sources,
        busy_hours,
        sexes,
        procedures,
        occupancy,
        chair_time,
        booked_visits: rows.booked_visits,
        walk_ins: rows.walk_ins,
        lab_orders_received: rows.lab_received.orders,
        lab_turnaround_days: average_days(
            rows.lab_received.orders,
            rows.lab_received.total_minutes,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aarogyam_dal::analytics::{
        AgeCount, Chair, ChairPeriod, KeyCount, OpenDay, PatientPeriod, PeriodAmount,
    };
    use time::macros::date;

    fn amount(period: Date, key: Option<&str>, paise: i64) -> PeriodAmount {
        PeriodAmount {
            period,
            key: key.map(str::to_owned),
            amount_paise: paise,
            count: 1,
        }
    }

    #[test]
    fn builds_every_period_with_stock_as_material() {
        let chair = Uuid::from_u128(1);
        let rows = AnalyticsRows {
            chairs: vec![Chair {
                room_id: chair,
                name: "Chair 1".into(),
                branch_id: None,
            }],
            chair_periods: vec![ChairPeriod {
                period: date!(2026 - 10 - 01),
                room_id: chair,
                name: "Chair 1".into(),
                branch_id: None,
                minutes: 540,
                appointments: 9,
            }],
            income: vec![amount(date!(2026 - 10 - 01), None, 50_000)],
            expenses: vec![
                amount(date!(2026 - 10 - 01), Some("rent"), 20_000),
                amount(date!(2026 - 10 - 01), Some("material"), 1_000),
            ],
            stock: vec![amount(date!(2026 - 10 - 01), None, 4_000)],
            patients: vec![PatientPeriod {
                period: date!(2026 - 10 - 01),
                new: 2,
                returning: 3,
            }],
            ages: vec![
                AgeCount {
                    years: Some(40),
                    count: 2,
                },
                AgeCount {
                    years: None,
                    count: 1,
                },
            ],
            visit_kinds: vec![KeyCount {
                key: Some("new".into()),
                count: 4,
            }],
            referrals: vec![KeyCount {
                key: None,
                count: 2,
            }],
            busy_hours: vec![],
            open_days: vec![],
            lab_received: aarogyam_dal::analytics::LabTurnaround {
                orders: 2,
                total_minutes: 4 * 1440 + 720,
            },
            ..AnalyticsRows::default()
        };
        let report = build(
            date!(2026 - 09 - 21),
            date!(2026 - 10 - 02),
            Bucket::Month,
            true,
            &rows,
        );
        assert_eq!(report.periods.len(), 2);
        assert_eq!(report.lab_orders_received, 2);
        assert_eq!(report.lab_turnaround_days, Some(2.3));
        let october = &report.periods[1];
        assert_eq!(october.first_day, date!(2026 - 10 - 01));
        // Two days open, nine hours each: 540 of 1,080 minutes booked.
        assert_eq!(october.chairs[0].open_minutes, 1_080);
        assert_eq!(october.chairs[0].utilization_bps, 5_000);
        let money = october.money.as_ref().unwrap();
        assert_eq!(money.income, Paise::new(50_000));
        let material = money
            .expenses
            .iter()
            .find(|e| e.category == ExpenseCategoryKey::Material)
            .unwrap();
        assert_eq!(material.amount, Paise::new(5_000));
        assert_eq!(money.expenses_total, Paise::new(25_000));
        assert_eq!(money.expenses.len(), ExpenseCategoryKey::ALL.len());
        assert_eq!(october.new_patients, 2);
        assert_eq!(report.periods[0].chairs[0].booked_minutes, 0);
        assert!(report.age_bands.contains(&(AgeBand::Adult, 2)));
        assert!(report.age_bands.contains(&(AgeBand::Unknown, 1)));
        assert!(
            report
                .referral_sources
                .contains(&(ReferralKind::Unknown, 2))
        );
        assert!(report.visit_kinds.contains(&(AppointmentKind::New, 4)));

        let hidden = build(
            date!(2026 - 09 - 21),
            date!(2026 - 10 - 02),
            Bucket::Month,
            false,
            &rows,
        );
        assert!(hidden.periods.iter().all(|p| p.money.is_none()));
    }

    #[test]
    fn occupancy_adds_up_per_chair_and_per_weekday() {
        let (one, two) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let cell = |room, weekday, hour, minutes, appointments| dal::OccupancyCell {
            room_id: room,
            weekday,
            hour,
            minutes,
            appointments,
        };
        let rows = AnalyticsRows {
            // Chair 1 on Monday and Tuesday at 10, chair 2 on Monday at 10; 25 is no hour.
            occupancy: vec![
                cell(one, 1, 10, 60, 1),
                cell(one, 2, 10, 30, 1),
                cell(two, 1, 10, 45, 2),
                cell(two, 1, 25, 45, 2),
            ],
            procedures: vec![
                dal::ProcedureCount {
                    key: Some("endo".into()),
                    count: 2,
                    amount_paise: 500_000,
                },
                dal::ProcedureCount {
                    key: None,
                    count: 1,
                    amount_paise: 0,
                },
            ],
            ..AnalyticsRows::default()
        };
        let report = build(
            date!(2026 - 10 - 05),
            date!(2026 - 10 - 11),
            Bucket::Week,
            true,
            &rows,
        );
        let chair_one: Vec<_> = report
            .occupancy
            .by_chair_hour
            .iter()
            .filter(|(room, _)| room.uuid() == one)
            .collect();
        assert_eq!(chair_one.len(), 1);
        assert_eq!(chair_one[0].1.booked_minutes, 90);
        assert_eq!(chair_one[0].1.appointments, 2);
        assert_eq!(report.occupancy.by_chair_hour.len(), 2);
        let monday_ten = report
            .occupancy
            .by_weekday_hour
            .iter()
            .find(|(weekday, load)| *weekday == 1 && load.hour == 10)
            .unwrap();
        assert_eq!(monday_ten.1.booked_minutes, 105);
        assert_eq!(report.occupancy.by_weekday_hour.len(), 2);
        // Procedures carry what they were billed, only for callers with money.
        assert_eq!(report.procedures[0].category, "endo");
        assert_eq!(report.procedures[0].amount, Some(Paise::new(500_000)));
        let hidden = build(
            date!(2026 - 10 - 05),
            date!(2026 - 10 - 11),
            Bucket::Week,
            false,
            &rows,
        );
        assert!(hidden.procedures.iter().all(|p| p.amount.is_none()));
    }

    #[test]
    fn open_minutes_come_from_the_chair_branch_hours() {
        let (main, annex) = (Uuid::from_u128(10), Uuid::from_u128(11));
        let chair = |id: u128, name: &str, branch| Chair {
            room_id: Uuid::from_u128(id),
            name: name.into(),
            branch_id: Some(branch),
        };
        let day = |weekday, minutes| OpenDay {
            branch_id: main,
            weekday,
            minutes,
        };
        let rows = AnalyticsRows {
            chairs: vec![chair(1, "Chair 1", main), chair(2, "Chair 2", annex)],
            chair_periods: vec![ChairPeriod {
                period: date!(2026 - 10 - 05),
                room_id: Uuid::from_u128(1),
                name: "Chair 1".into(),
                branch_id: Some(main),
                minutes: 300,
                appointments: 5,
            }],
            // The main branch: Monday 10-13 and 17-20, Saturday 10-14. The annex has no hours.
            open_days: vec![day(1, 360), day(6, 240)],
            ..AnalyticsRows::default()
        };
        let report = build(
            date!(2026 - 10 - 05),
            date!(2026 - 10 - 11),
            Bucket::Week,
            false,
            &rows,
        );
        let week = &report.periods[0];
        assert_eq!(week.chairs[0].open_minutes, 600);
        assert_eq!(week.chairs[0].utilization_bps, 5_000);
        // Without hours for its branch a chair counts nine hours on each of the seven days.
        assert_eq!(week.chairs[1].open_minutes, 7 * OPEN_MINUTES_PER_DAY);
        assert_eq!(report.open_minutes_per_day, OPEN_MINUTES_PER_DAY);
    }
}
