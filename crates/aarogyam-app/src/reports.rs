//! Money reports for owners and finance: collections by day, week and method, the revenue
//! mix, unpaid bills by age, and the money tiles on the Today screen. Needs `finance.view`.

use aarogyam_dal::billing::{self as dal, InvoiceFilter};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::billing::{AgingBucket, PaymentMethod};
use aarogyam_domain::ids::{InvoiceId, PatientId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::billing::PatientRef;
use crate::clock::{clinic_today, day_range};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Longest range a collections report covers.
pub const MAX_DAYS: i64 = 366;

/// An amount on one day.
#[derive(Debug, Clone, Copy)]
pub struct DayTotal {
    /// The clinic day (a Monday for weeks).
    pub date: Date,
    /// Received.
    pub amount: Paise,
    /// How many payments.
    pub payments: i64,
}

/// An amount by payment method.
#[derive(Debug, Clone, Copy)]
pub struct MethodTotal {
    /// The method.
    pub method: PaymentMethod,
    /// Received.
    pub amount: Paise,
    /// How many payments.
    pub payments: i64,
    /// Share of everything received, in basis points (10,000 is all).
    pub share_bps: i64,
}

/// Billed revenue in a category.
#[derive(Debug, Clone)]
pub struct MixTotal {
    /// The price list category, or `other`.
    pub category: String,
    /// Billed, including GST.
    pub amount: Paise,
    /// Share of all billed, in basis points.
    pub share_bps: i64,
}

/// Collections over a range of clinic days.
#[derive(Debug, Clone)]
pub struct Collections {
    /// First day.
    pub from: Date,
    /// Last day, included.
    pub to: Date,
    /// Everything received.
    pub collected: Paise,
    /// How many payments.
    pub payments: i64,
    /// Every day of the range, zero when nothing came in.
    pub by_day: Vec<DayTotal>,
    /// Weeks starting on Monday.
    pub by_week: Vec<DayTotal>,
    /// By method, every method listed.
    pub by_method: Vec<MethodTotal>,
    /// Bills issued in the range, by category.
    pub revenue_mix: Vec<MixTotal>,
    /// Total of bills issued in the range.
    pub invoiced: Paise,
    /// How many bills were issued.
    pub invoices: i64,
    /// Left to pay on every issued bill, now.
    pub outstanding: Paise,
}

fn share(part: i64, whole: i64) -> i64 {
    if whole <= 0 {
        0
    } else {
        i64::try_from(i128::from(part) * 10_000 / i128::from(whole)).unwrap_or(0)
    }
}

fn monday(date: Date) -> Date {
    date - Duration::days(i64::from(date.weekday().number_days_from_monday()))
}

fn summarise(
    from: Date,
    to: Date,
    rows: &[dal::CollectionRow],
) -> (Vec<DayTotal>, Vec<DayTotal>, Vec<MethodTotal>) {
    let mut by_day = Vec::new();
    let mut day = from;
    while day <= to {
        let (amount, payments) = rows
            .iter()
            .filter(|row| row.day == day)
            .fold((0, 0), |(a, n), row| {
                (a + row.amount_paise, n + row.payments)
            });
        by_day.push(DayTotal {
            date: day,
            amount: Paise::new(amount),
            payments,
        });
        match day.next_day() {
            Some(next) => day = next,
            None => break,
        }
    }
    let mut by_week: Vec<DayTotal> = Vec::new();
    for total in &by_day {
        let week = monday(total.date);
        match by_week.last_mut() {
            Some(last) if last.date == week => {
                last.amount = Paise::new(last.amount.get() + total.amount.get());
                last.payments += total.payments;
            }
            _ => by_week.push(DayTotal {
                date: week,
                ..*total
            }),
        }
    }
    let whole: i64 = rows.iter().map(|row| row.amount_paise).sum();
    let by_method = PaymentMethod::ALL
        .iter()
        .map(|method| {
            let (amount, payments) = rows
                .iter()
                .filter(|row| row.method == method.as_str())
                .fold((0, 0), |(a, n), row| {
                    (a + row.amount_paise, n + row.payments)
                });
            MethodTotal {
                method: *method,
                amount: Paise::new(amount),
                payments,
                share_bps: share(amount, whole),
            }
        })
        .collect();
    (by_day, by_week, by_method)
}

fn mix(rows: Vec<dal::MixRow>) -> Vec<MixTotal> {
    let whole: i64 = rows.iter().map(|row| row.amount_paise).sum();
    rows.into_iter()
        .map(|row| MixTotal {
            share_bps: share(row.amount_paise, whole),
            category: row.category,
            amount: Paise::new(row.amount_paise),
        })
        .collect()
}

/// Collections and revenue mix for clinic days `from` to `to`; the last seven days by default.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::Invalid`] for a backwards or
/// too-long range.
pub async fn collections(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    from: Option<Date>,
    to: Option<Date>,
    now: OffsetDateTime,
) -> Result<Collections, AppError> {
    actor.require(Permission::FinanceView)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let timezone = actor.timezone.as_str();
        let today = clinic_today(timezone, now);
        let to = to.unwrap_or(today);
        let from = from.unwrap_or(to - Duration::days(6));
        let days = (to - from).whole_days();
        if days < 0 {
            return Err(AppError::invalid("from", "must not be after to"));
        }
        if days >= MAX_DAYS {
            return Err(AppError::invalid(
                "from",
                "the range can be at most 366 days",
            ));
        }
        let (start, end) = day_range(timezone, from, to);
        let overview = dal::money_overview(
            tx.conn(),
            dal::MoneyRanges {
                payments: (start, end),
                bills: (start, end),
                mix: (start, end),
            },
            timezone,
        )
        .await?;
        let rows = overview.collections;
        let (by_day, by_week, by_method) = summarise(from, to, &rows);
        let revenue_mix = mix(overview.mix);
        let (bill_count, billed) = overview.invoiced;
        let pending = pending_rows(tx).await?;
        Ok(Collections {
            from,
            to,
            collected: Paise::new(rows.iter().map(|row| row.amount_paise).sum()),
            payments: rows.iter().map(|row| row.payments).sum(),
            by_day,
            by_week,
            by_method,
            revenue_mix,
            invoiced: Paise::new(billed),
            invoices: bill_count,
            outstanding: Paise::new(
                pending
                    .iter()
                    .map(|row| row.total_paise - row.paid_paise)
                    .sum(),
            ),
        })
    })
    .await
}

/// Most weeks a weekly collections report covers.
pub const MAX_WEEKS: u32 = 52;

/// Collections for the last `weeks` weeks: the current week (Monday to today) and the weeks
/// before it, so `by_week` has exactly `weeks` entries, oldest first.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::Invalid`] for `weeks` outside 1 to
/// 52.
pub async fn weekly_collections(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    weeks: u32,
    now: OffsetDateTime,
) -> Result<Collections, AppError> {
    actor.require(Permission::FinanceView)?;
    if !(1..=MAX_WEEKS).contains(&weeks) {
        return Err(AppError::invalid("weeks", "must be 1 to 52"));
    }
    let to = clinic_today(&actor.timezone, now);
    let from = monday(to) - Duration::weeks(i64::from(weeks - 1));
    collections(db, actor, request_id, Some(from), Some(to), now).await
}

/// An issued bill with something left to pay.
#[derive(Debug, Clone)]
pub struct PendingBill {
    /// The bill.
    pub invoice_id: InvoiceId,
    /// Its number.
    pub number: Option<String>,
    /// The patient.
    pub patient: PatientRef,
    /// When issued.
    pub issued_at: Option<OffsetDateTime>,
    /// Total.
    pub total: Paise,
    /// Paid.
    pub paid: Paise,
    /// Left to pay.
    pub balance: Paise,
    /// Days since issue, in clinic days.
    pub age_days: i64,
    /// Aging bucket.
    pub bucket: AgingBucket,
}

/// Unpaid bills, oldest first, with totals by age.
#[derive(Debug, Clone)]
pub struct Pending {
    /// The bills.
    pub bills: Vec<PendingBill>,
    /// Left to pay on all of them.
    pub outstanding: Paise,
    /// How many patients owe.
    pub patients: usize,
    /// Owed by age: 0–30, 31–60, 61–90 and over 90 days.
    pub buckets: [Paise; 4],
}

async fn pending_rows(tx: &mut ScopedTx) -> Result<Vec<dal::InvoiceRow>, AppError> {
    Ok(dal::invoices(
        tx.conn(),
        &InvoiceFilter {
            with_balance: true,
            limit: 1000,
            ..InvoiceFilter::default()
        },
    )
    .await?)
}

fn pending_report(rows: Vec<dal::InvoiceRow>, timezone: &str, now: OffsetDateTime) -> Pending {
    let today = clinic_today(timezone, now);
    let mut bills: Vec<PendingBill> = rows
        .into_iter()
        .map(|row| {
            let issued_day = row.issued_at.map_or(today, |at| clinic_today(timezone, at));
            let age_days = (today - issued_day).whole_days().max(0);
            PendingBill {
                invoice_id: InvoiceId::from_uuid(row.id),
                number: row.number,
                patient: PatientRef {
                    id: PatientId::from_uuid(row.patient_id),
                    name: row.patient_name,
                    number: row.patient_number,
                },
                issued_at: row.issued_at,
                total: Paise::new(row.total_paise),
                paid: Paise::new(row.paid_paise),
                balance: Paise::new(row.total_paise - row.paid_paise),
                age_days,
                bucket: AgingBucket::of(age_days),
            }
        })
        .collect();
    bills.reverse();
    let mut buckets = [Paise::ZERO; 4];
    for bill in &bills {
        let slot = match bill.bucket {
            AgingBucket::Days0To30 => 0,
            AgingBucket::Days31To60 => 1,
            AgingBucket::Days61To90 => 2,
            AgingBucket::Over90 => 3,
        };
        buckets[slot] = Paise::new(buckets[slot].get() + bill.balance.get());
    }
    let mut patients: Vec<PatientId> = bills.iter().map(|bill| bill.patient.id).collect();
    patients.sort_by_key(|id| id.uuid());
    patients.dedup();
    Pending {
        outstanding: Paise::new(bills.iter().map(|bill| bill.balance.get()).sum()),
        patients: patients.len(),
        buckets,
        bills,
    }
}

/// Issued bills with a balance, oldest first.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`.
pub async fn pending(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Pending, AppError> {
    actor.require(Permission::FinanceView)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = pending_rows(tx).await?;
        Ok(pending_report(rows, &actor.timezone, now))
    })
    .await
}

/// The money tiles and tables on the Today screen.
#[derive(Debug, Clone)]
pub struct TodayMoney {
    /// The clinic day.
    pub date: Date,
    /// Received today.
    pub collected_today: Paise,
    /// Payments today.
    pub payments_today: i64,
    /// Billed today.
    pub invoiced_today: Paise,
    /// Bills issued today.
    pub invoices_today: i64,
    /// Received this month so far.
    pub collected_this_month: Paise,
    /// UPI's share of this month's collections, in basis points.
    pub upi_share_bps: i64,
    /// Left to pay on every issued bill.
    pub pending_dues: Paise,
    /// How many patients owe.
    pub pending_dues_patients: usize,
    /// This month's billed revenue by category.
    pub revenue_mix: Vec<MixTotal>,
    /// The largest unpaid balances, at most five.
    pub top_pending: Vec<PendingBill>,
}

/// What the Today screen's money widgets show.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`.
pub async fn today(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<TodayMoney, AppError> {
    actor.require(Permission::FinanceView)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let timezone = actor.timezone.as_str();
        let today = clinic_today(timezone, now);
        let month_start = today.replace_day(1).unwrap_or(today);
        let (day_start, day_end) = day_range(timezone, today, today);
        let (month_from, _) = day_range(timezone, month_start, today);
        let overview = dal::money_overview(
            tx.conn(),
            dal::MoneyRanges {
                payments: (month_from, day_end),
                bills: (day_start, day_end),
                mix: (month_from, day_end),
            },
            timezone,
        )
        .await?;
        let rows = overview.collections;
        let todays: Vec<&dal::CollectionRow> = rows.iter().filter(|row| row.day == today).collect();
        let month_total: i64 = rows.iter().map(|row| row.amount_paise).sum();
        let upi: i64 = rows
            .iter()
            .filter(|row| row.method == PaymentMethod::Upi.as_str())
            .map(|row| row.amount_paise)
            .sum();
        let (bills_today, billed_today) = overview.invoiced;
        let revenue_mix = mix(overview.mix);
        let pending = pending_report(pending_rows(tx).await?, timezone, now);
        let mut top_pending = pending.bills.clone();
        top_pending.sort_by_key(|bill| std::cmp::Reverse(bill.balance));
        top_pending.truncate(5);
        Ok(TodayMoney {
            date: today,
            collected_today: Paise::new(todays.iter().map(|row| row.amount_paise).sum()),
            payments_today: todays.iter().map(|row| row.payments).sum(),
            invoiced_today: Paise::new(billed_today),
            invoices_today: bills_today,
            collected_this_month: Paise::new(month_total),
            upi_share_bps: share(upi, month_total),
            pending_dues: pending.outstanding,
            pending_dues_patients: pending.patients,
            revenue_mix,
            top_pending,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn row(day: Date, method: &str, amount: i64) -> dal::CollectionRow {
        dal::CollectionRow {
            day,
            method: method.into(),
            amount_paise: amount,
            payments: 1,
        }
    }

    #[test]
    fn a_weekly_range_starts_on_the_monday_weeks_back() {
        // Saturday 10 October 2026, in the week of Monday 5 October.
        let to = date!(2026 - 10 - 10);
        assert_eq!(
            monday(to) - Duration::weeks(7),
            date!(2026 - 08 - 17),
            "week 1 of 8 starts seven Mondays before this one"
        );
        assert_eq!(monday(date!(2026 - 10 - 05)), date!(2026 - 10 - 05));
    }

    #[test]
    fn collections_fill_every_day_and_week() {
        // Thursday 1 to Tuesday 6 October 2026.
        let rows = [
            row(date!(2026 - 10 - 01), "upi", 30_000),
            row(date!(2026 - 10 - 01), "cash", 10_000),
            row(date!(2026 - 10 - 05), "upi", 60_000),
        ];
        let (days, weeks, methods) = summarise(date!(2026 - 10 - 01), date!(2026 - 10 - 06), &rows);
        assert_eq!(days.len(), 6);
        assert_eq!(days[0].amount, Paise::new(40_000));
        assert_eq!(days[1].amount, Paise::ZERO);
        assert_eq!(weeks.len(), 2);
        assert_eq!(weeks[0].date, date!(2026 - 09 - 28));
        assert_eq!(weeks[1].amount, Paise::new(60_000));
        let upi = methods
            .iter()
            .find(|m| m.method == PaymentMethod::Upi)
            .unwrap();
        assert_eq!(upi.share_bps, 9_000);
        assert_eq!(methods.len(), 4);
        assert_eq!(share(1, 0), 0);
    }
}
