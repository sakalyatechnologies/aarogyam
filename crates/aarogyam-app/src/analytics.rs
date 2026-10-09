//! The owner's Analytics page: chair utilization, income and expenses, and who the patients
//! are, by month or week. Needs `analytics.view`; the money figures also need `finance.view`
//! and are `None` without it. One clinic transaction, one statement.
//!
//! Rules (see `docs/decisions.md`, "Analytics: chair utilization and material costs"):
//! - utilization is a chair's booked minutes (appointments not cancelled and not unconfirmed
//!   online requests; no-shows count, the chair was held) over open minutes, nine hours a day
//!   on every calendar day, because clinic hours are not stored yet;
//! - expenses are the recorded expense entries plus stock received at cost, which counts as
//!   `material`;
//! - a patient is new in the period of their first visit ever, and returning after it.

use aarogyam_dal::analytics::{self as dal, AnalyticsQuery, AnalyticsRows};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::analytics::{
    AgeBand, Bucket, MAX_DAYS, OPEN_MINUTES_PER_DAY, ReferralKind, default_from, open_minutes,
    utilization_bps,
};
use aarogyam_domain::expense::ExpenseCategoryKey;
use aarogyam_domain::ids::RoomId;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::AppointmentKind;
use sakalya_db::Db;
use sakalya_types::Paise;
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
}

/// One chair's use in a period.
#[derive(Debug, Clone, Copy)]
pub struct ChairUse {
    /// The chair.
    pub room_id: RoomId,
    /// Booked minutes.
    pub booked_minutes: i64,
    /// Open minutes: [`OPEN_MINUTES_PER_DAY`] for each day of the period in the range.
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
    /// The open minutes assumed per chair per day.
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
    /// Lab orders received back in the range.
    pub lab_orders_received: i64,
    /// Their average days from sent to received, to one decimal; `None` when there were none.
    pub lab_turnaround_days: Option<f64>,
}

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

fn chairs_of(rows: &AnalyticsRows) -> Vec<ChairRef> {
    let mut chairs: Vec<ChairRef> = rows
        .chairs
        .iter()
        .map(|chair| ChairRef {
            id: RoomId::from_uuid(chair.room_id),
            name: chair.name.clone(),
        })
        .collect();
    for used in &rows.chair_periods {
        if !chairs.iter().any(|chair| chair.id.uuid() == used.room_id) {
            chairs.push(ChairRef {
                id: RoomId::from_uuid(used.room_id),
                name: used.name.clone(),
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

fn build(from: Date, to: Date, bucket: Bucket, money: bool, rows: &AnalyticsRows) -> Analytics {
    let chairs = chairs_of(rows);
    let periods = bucket
        .periods(from, to)
        .into_iter()
        .map(|(start, first_day, last_day)| {
            let open = open_minutes(first_day, last_day);
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
        AgeCount, Chair, ChairPeriod, KeyCount, PatientPeriod, PeriodAmount,
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
            }],
            chair_periods: vec![ChairPeriod {
                period: date!(2026 - 10 - 01),
                room_id: chair,
                name: "Chair 1".into(),
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
            lab_received: aarogyam_dal::analytics::LabTurnaround {
                orders: 2,
                total_minutes: 4 * 1440 + 720,
            },
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
}
