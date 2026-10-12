//! Stock rules: units, how low is low, and which batch is used first. Quantities are whole
//! units of the item's own unit; nothing here touches the clock or the database.

use time::Date;

/// Days ahead in which a batch counts as about to expire.
pub const EXPIRY_WINDOW_DAYS: i64 = 30;

/// The most that one receipt, use or adjustment may move, so a typo cannot overflow a sum.
pub const MAX_MOVEMENT: i64 = 1_000_000;

/// Why a stock value or movement was refused. Messages never echo the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum StockError {
    /// The quantity is zero, negative where it must be positive, or too large.
    #[error("must be between 1 and 1000000")]
    Quantity,
    /// The reorder level is negative or too large.
    #[error("must be between 0 and 1000000")]
    ReorderLevel,
    /// The unit is not one the clinic stocks in.
    #[error("must be piece, ml, g, box or pack")]
    Unit,
    /// A cost is negative.
    #[error("must not be negative")]
    Cost,
    /// More was asked for than is on the shelf.
    #[error("not enough stock")]
    Insufficient,
}

/// What an item is counted in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum StockUnit {
    /// Single pieces.
    #[default]
    Piece,
    /// Millilitres.
    Ml,
    /// Grams.
    G,
    /// Boxes.
    Box,
    /// Packs.
    Pack,
}

impl StockUnit {
    /// The stored and API name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Piece => "piece",
            Self::Ml => "ml",
            Self::G => "g",
            Self::Box => "box",
            Self::Pack => "pack",
        }
    }

    /// Parses the stored name.
    ///
    /// # Errors
    /// [`StockError::Unit`] for an unknown unit.
    pub fn parse(text: &str) -> Result<Self, StockError> {
        match text {
            "piece" => Ok(Self::Piece),
            "ml" => Ok(Self::Ml),
            "g" => Ok(Self::G),
            "box" => Ok(Self::Box),
            "pack" => Ok(Self::Pack),
            _ => Err(StockError::Unit),
        }
    }
}

/// Why stock changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MovementKind {
    /// A delivery arrived.
    Receive,
    /// Material was used.
    Use,
    /// A count was corrected.
    Adjust,
    /// Expired stock was written off.
    Expire,
}

impl MovementKind {
    /// The stored and API name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Receive => "receive",
            Self::Use => "use",
            Self::Adjust => "adjust",
            Self::Expire => "expire",
        }
    }
}

/// Where an item stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StockStatus {
    /// Enough on the shelf.
    Ok,
    /// At or below the reorder level.
    Low,
    /// Out, or at a fifth of the reorder level or less.
    Critical,
    /// Enough on the shelf, but a batch expires soon or already has.
    Expiring,
}

impl StockStatus {
    /// The API name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Low => "low",
            Self::Critical => "critical",
            Self::Expiring => "expiring",
        }
    }
}

/// The status of an item. Running out beats running low, which beats expiry.
#[must_use]
pub const fn status(on_hand: i64, reorder_level: i64, expiring: bool) -> StockStatus {
    if on_hand <= 0 || on_hand.saturating_mul(5) <= reorder_level {
        StockStatus::Critical
    } else if on_hand <= reorder_level {
        StockStatus::Low
    } else if expiring {
        StockStatus::Expiring
    } else {
        StockStatus::Ok
    }
}

/// Whether a batch expiring on `expiry` counts as expiring on `today`: already expired, or
/// within [`EXPIRY_WINDOW_DAYS`].
#[must_use]
pub fn is_expiring(expiry: Option<Date>, today: Date) -> bool {
    expiry.is_some_and(|date| (date - today).whole_days() <= EXPIRY_WINDOW_DAYS)
}

/// Whether a batch has expired and may no longer be used.
#[must_use]
pub fn is_expired(expiry: Option<Date>, today: Date) -> bool {
    expiry.is_some_and(|date| date < today)
}

/// Checks a movement's size.
///
/// # Errors
/// [`StockError::Quantity`] unless it is between 1 and [`MAX_MOVEMENT`].
pub const fn check_quantity(quantity: i64) -> Result<i64, StockError> {
    if quantity >= 1 && quantity <= MAX_MOVEMENT {
        Ok(quantity)
    } else {
        Err(StockError::Quantity)
    }
}

/// A batch as the picker sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shelf<I> {
    /// The batch.
    pub id: I,
    /// Last day it may be used.
    pub expiry: Option<Date>,
    /// Day it arrived.
    pub received_on: Date,
    /// Left on the shelf.
    pub quantity: i64,
}

/// Takes `needed` units first-expired-first-out: earliest expiry first (no expiry last, then
/// oldest delivery first), skipping batches already expired on `today`. Returns what to take
/// from which batch.
///
/// # Errors
/// [`StockError::Quantity`] for a size outside the limits; [`StockError::Insufficient`] when
/// the usable batches hold less than `needed`.
pub fn pick_fefo<I: Copy>(
    batches: &[Shelf<I>],
    needed: i64,
    today: Date,
) -> Result<Vec<(I, i64)>, StockError> {
    check_quantity(needed)?;
    let mut usable: Vec<&Shelf<I>> = batches
        .iter()
        .filter(|batch| batch.quantity > 0 && !is_expired(batch.expiry, today))
        .collect();
    usable.sort_by_key(|batch| (batch.expiry.is_none(), batch.expiry, batch.received_on));
    let mut left = needed;
    let mut picks = Vec::new();
    for batch in usable {
        if left == 0 {
            break;
        }
        let take = left.min(batch.quantity);
        picks.push((batch.id, take));
        left -= take;
    }
    if left > 0 {
        return Err(StockError::Insufficient);
    }
    Ok(picks)
}

/// The fewest calendar days of use history a projection needs.
pub const MIN_PROJECTION_DAYS: i64 = 7;

/// The most calendar days of use history a projection averages over.
pub const MAX_PROJECTION_DAYS: i64 = 14;

/// Days of cover above the lead time at which an alert still fires: order before it is too late.
pub const ALERT_MARGIN_DAYS: i64 = 3;

/// Days of use a suggested reorder buys beyond the lead time.
pub const REORDER_COVER_DAYS: i64 = 14;

/// What `project` is given for one item. Dates are the clinic's own calendar days.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionInput<'a> {
    /// The clinic's local day today.
    pub today: Date,
    /// At or below this the item is low (see [`status`]).
    pub reorder_level: i64,
    /// Days from ordering to delivery.
    pub lead_time_days: i64,
    /// Batches with stock left: expiry (none: never) and quantity.
    pub batches: &'a [(Option<Date>, i64)],
    /// Units used on each clinic-local day (movements of kind `use` only; days with no use may
    /// be left out). Days from today on are ignored: today is not over.
    pub daily_use: &'a [(Date, i64)],
    /// The first day with any use, if there has been one.
    pub first_use_on: Option<Date>,
}

/// Why an item needs an alert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertReason {
    /// Low or critical against its reorder level.
    Low,
    /// Enough now, but the stock runs out within the lead time plus a margin.
    Projected,
}

impl AlertReason {
    /// The stored name (`staff_notifications.stock_reason`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Projected => "projected",
        }
    }
}

/// What the recent rate of use says about an item.
#[derive(Debug, Clone, PartialEq)]
pub struct Projection {
    /// Units on the shelf that have not expired today.
    pub on_hand: i64,
    /// Units that will still be good on the day the stock runs out: batches expiring before it
    /// do not count. Equals `on_hand` when there is no projection.
    pub usable_on_hand: i64,
    /// Units used per day over the window. `None` without enough history.
    pub daily_usage: Option<f64>,
    /// Whole days the usable stock lasts at that rate. `None` without enough history.
    pub days_cover: Option<i64>,
    /// The day the stock runs out. `None` without enough history.
    pub runs_out_on: Option<Date>,
    /// Whether to tell the clinic.
    pub should_alert: bool,
    /// Why, when `should_alert`.
    pub reason: Option<AlertReason>,
    /// How many units to order to cover the lead time plus two weeks. `None` without enough
    /// history; zero when the stock already covers it.
    pub suggested_reorder_qty: Option<i64>,
}

/// Works out how long an item's stock lasts and whether to alert.
///
/// The window is W = min(14, days from the first use to today) complete days before today, and
/// the item is projected only when W is at least 7 and at least two of those days had use;
/// otherwise only the reorder-level alert applies. `daily_usage` is the units used in the window
/// over W; `days_cover` is the usable stock over it, rounded down; the stock that counts is the
/// batches not expired today and not expiring before the day it runs out. The alert fires when
/// the item is low or critical, or when `days_cover` is at most the lead time plus three days.
/// The suggested order is `ceil(daily_usage * (lead time + 14)) - usable`, never below zero.
/// Arithmetic is on whole numbers, so nothing depends on rounding of fractions.
#[must_use]
pub fn project(input: &ProjectionInput<'_>) -> Projection {
    let today = input.today;
    let live = |expiry: Option<Date>| !is_expired(expiry, today);
    let on_hand: i64 = input
        .batches
        .iter()
        .filter(|(expiry, quantity)| *quantity > 0 && live(*expiry))
        .map(|(_, quantity)| *quantity)
        .fold(0, i64::saturating_add);
    let stock = status(on_hand, input.reorder_level, false);
    let low = matches!(stock, StockStatus::Low | StockStatus::Critical);
    let none = |reason: Option<AlertReason>| Projection {
        on_hand,
        usable_on_hand: on_hand,
        daily_usage: None,
        days_cover: None,
        runs_out_on: None,
        should_alert: reason.is_some(),
        reason,
        suggested_reorder_qty: None,
    };
    let reason_low = low.then_some(AlertReason::Low);

    let Some(first) = input.first_use_on else {
        return none(reason_low);
    };
    let window = (today - first).whole_days().min(MAX_PROJECTION_DAYS);
    if window < MIN_PROJECTION_DAYS {
        return none(reason_low);
    }
    let start = today - time::Duration::days(window);
    let in_window = |day: Date| day >= start && day < today;
    let used: i64 = input
        .daily_use
        .iter()
        .filter(|(day, quantity)| in_window(*day) && *quantity > 0)
        .map(|(_, quantity)| *quantity)
        .fold(0, i64::saturating_add);
    let use_days = input
        .daily_use
        .iter()
        .filter(|(day, quantity)| in_window(*day) && *quantity > 0)
        .map(|(day, _)| *day)
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    if use_days < 2 || used <= 0 {
        return none(reason_low);
    }

    // The stock that is still good on the run-out day. Dropping a batch can only bring the
    // run-out day forward, so this settles after at most one pass per batch.
    let cover = |usable: i64| usable.saturating_mul(window) / used;
    let mut usable = on_hand;
    let mut days_cover = cover(usable);
    for _ in 0..=input.batches.len() {
        let runs_out = today + time::Duration::days(days_cover.min(36_500));
        let kept: i64 = input
            .batches
            .iter()
            .filter(|(expiry, quantity)| {
                *quantity > 0 && live(*expiry) && expiry.is_none_or(|date| date >= runs_out)
            })
            .map(|(_, quantity)| *quantity)
            .fold(0, i64::saturating_add);
        if kept == usable {
            break;
        }
        usable = kept;
        days_cover = cover(usable);
    }
    let runs_out_on = today + time::Duration::days(days_cover.min(36_500));
    let projected = days_cover <= input.lead_time_days + ALERT_MARGIN_DAYS;
    let reason = if low {
        Some(AlertReason::Low)
    } else if projected {
        Some(AlertReason::Projected)
    } else {
        None
    };
    #[expect(
        clippy::cast_precision_loss,
        reason = "quantities are far below 2^52; the figure is for display"
    )]
    let daily = used as f64 / window as f64;
    let target = (used * (input.lead_time_days + REORDER_COVER_DAYS) + window - 1) / window;
    Projection {
        on_hand,
        usable_on_hand: usable,
        daily_usage: Some(daily),
        days_cover: Some(days_cover),
        runs_out_on: Some(runs_out_on),
        should_alert: reason.is_some(),
        reason,
        suggested_reorder_qty: Some((target - usable).max(0)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    const TODAY: Date = date!(2026 - 10 - 04);

    fn shelf(id: u8, expiry: Option<Date>, received_on: Date, quantity: i64) -> Shelf<u8> {
        Shelf {
            id,
            expiry,
            received_on,
            quantity,
        }
    }

    #[test]
    fn status_by_reorder_level() {
        assert_eq!(status(4, 40, false), StockStatus::Critical);
        assert_eq!(status(8, 40, false), StockStatus::Critical);
        assert_eq!(status(9, 40, false), StockStatus::Low);
        assert_eq!(status(12, 30, false), StockStatus::Low);
        assert_eq!(status(58, 100, false), StockStatus::Low);
        assert_eq!(status(0, 0, false), StockStatus::Critical);
        assert_eq!(status(41, 40, false), StockStatus::Ok);
        assert_eq!(status(41, 40, true), StockStatus::Expiring);
        assert_eq!(status(9, 40, true), StockStatus::Low);
    }

    #[test]
    fn expiry_window_is_thirty_days() {
        assert!(is_expiring(Some(date!(2026 - 11 - 03)), TODAY));
        assert!(!is_expiring(Some(date!(2026 - 11 - 04)), TODAY));
        assert!(is_expiring(Some(date!(2026 - 09 - 01)), TODAY));
        assert!(!is_expiring(None, TODAY));
        assert!(is_expired(Some(date!(2026 - 10 - 03)), TODAY));
        assert!(!is_expired(Some(TODAY), TODAY));
    }

    #[test]
    fn fefo_takes_the_earliest_expiry_first() {
        let batches = [
            shelf(1, Some(date!(2027 - 01 - 01)), date!(2026 - 01 - 01), 5),
            shelf(2, Some(date!(2026 - 11 - 01)), date!(2026 - 06 - 01), 3),
            shelf(3, None, date!(2025 - 01 - 01), 10),
            shelf(4, Some(date!(2026 - 09 - 01)), date!(2026 - 01 - 01), 9),
        ];
        // Batch 4 has expired, so 2 then 1 then the one without expiry.
        assert_eq!(pick_fefo(&batches, 4, TODAY), Ok(vec![(2, 3), (1, 1)]));
        assert_eq!(
            pick_fefo(&batches, 12, TODAY),
            Ok(vec![(2, 3), (1, 5), (3, 4)])
        );
        assert_eq!(
            pick_fefo(&batches, 19, TODAY),
            Err(StockError::Insufficient)
        );
        assert_eq!(pick_fefo(&batches, 18, TODAY).map(|p| p.len()), Ok(3));
    }

    #[test]
    fn same_expiry_uses_the_older_delivery() {
        let batches = [
            shelf(1, None, date!(2026 - 05 - 01), 2),
            shelf(2, None, date!(2026 - 03 - 01), 2),
        ];
        assert_eq!(pick_fefo(&batches, 3, TODAY), Ok(vec![(2, 2), (1, 1)]));
    }

    #[test]
    fn sizes_are_limited() {
        assert_eq!(check_quantity(0), Err(StockError::Quantity));
        assert_eq!(check_quantity(-1), Err(StockError::Quantity));
        assert_eq!(check_quantity(MAX_MOVEMENT + 1), Err(StockError::Quantity));
        assert_eq!(check_quantity(1), Ok(1));
        assert_eq!(pick_fefo::<u8>(&[], 0, TODAY), Err(StockError::Quantity));
        assert_eq!(StockUnit::parse("box"), Ok(StockUnit::Box));
        assert_eq!(StockUnit::parse("kg"), Err(StockError::Unit));
    }

    // ---- project ----

    const DAY: Date = date!(2026 - 10 - 15);

    fn day(back: i64) -> Date {
        DAY - time::Duration::days(back)
    }

    /// Ten units a day on each of the `days` days before today, first use that long ago.
    fn steady(days: i64, per_day: i64) -> Vec<(Date, i64)> {
        (1..=days).map(|back| (day(back), per_day)).collect()
    }

    fn input<'a>(
        batches: &'a [(Option<Date>, i64)],
        daily_use: &'a [(Date, i64)],
        reorder_level: i64,
        lead_time_days: i64,
    ) -> ProjectionInput<'a> {
        ProjectionInput {
            today: DAY,
            reorder_level,
            lead_time_days,
            batches,
            daily_use,
            first_use_on: daily_use.iter().map(|(d, _)| *d).min(),
        }
    }

    #[test]
    fn no_history_only_the_reorder_level_speaks() {
        let ok = project(&input(&[(None, 100)], &[], 20, 7));
        assert!(!ok.should_alert);
        assert_eq!(
            (ok.daily_usage, ok.days_cover, ok.runs_out_on),
            (None, None, None)
        );
        assert_eq!(ok.suggested_reorder_qty, None);
        assert_eq!(ok.on_hand, 100);
        let low = project(&input(&[(None, 20)], &[], 20, 7));
        assert!(low.should_alert);
        assert_eq!(low.reason, Some(AlertReason::Low));
        let out = project(&input(&[], &[], 0, 7));
        assert_eq!(out.reason, Some(AlertReason::Low));
    }

    #[test]
    fn six_days_of_history_is_not_enough_and_seven_is() {
        let six = steady(6, 10);
        let p = project(&input(&[(None, 30)], &six, 5, 7));
        assert_eq!((p.daily_usage, p.days_cover), (None, None));
        assert!(!p.should_alert);
        let seven = steady(7, 10);
        let p = project(&input(&[(None, 30)], &seven, 5, 7));
        assert_eq!(p.daily_usage, Some(10.0));
        assert_eq!(p.days_cover, Some(3));
        assert_eq!(p.runs_out_on, Some(day(-3)));
        assert_eq!(p.reason, Some(AlertReason::Projected));
    }

    #[test]
    fn the_window_is_fourteen_days_at_most() {
        // Heavy use long ago does not count; 14 days at 5 a day does.
        let mut use_ = steady(14, 5);
        use_.push((day(20), 500));
        let p = project(&input(&[(None, 100)], &use_, 5, 7));
        assert_eq!(p.daily_usage, Some(5.0));
        assert_eq!(p.days_cover, Some(20));
        assert!(!p.should_alert);
    }

    #[test]
    fn zero_usage_or_one_day_of_use_is_no_projection() {
        let none: [(Date, i64); 0] = [];
        let p = project(&ProjectionInput {
            first_use_on: Some(day(10)),
            ..input(&[(None, 50)], &none, 5, 7)
        });
        assert_eq!(p.days_cover, None);
        assert!(!p.should_alert);
        // One big use on one day: a spike, not a rate.
        let spike = [(day(10), 40), (day(3), 0)];
        let p = project(&input(&[(None, 50)], &spike, 5, 7));
        assert_eq!(p.days_cover, None);
        assert_eq!(p.suggested_reorder_qty, None);
    }

    #[test]
    fn today_is_not_counted() {
        let mut use_ = steady(7, 10);
        use_.push((DAY, 1000));
        let p = project(&input(&[(None, 100)], &use_, 5, 7));
        assert_eq!(p.daily_usage, Some(10.0));
    }

    #[test]
    fn expired_batches_do_not_count() {
        let use_ = steady(7, 10);
        let batches = [(Some(day(1)), 500), (None, 40)];
        let p = project(&input(&batches, &use_, 5, 7));
        assert_eq!(p.on_hand, 40);
        assert_eq!(p.usable_on_hand, 40);
        assert_eq!(p.days_cover, Some(4));
    }

    #[test]
    fn batches_expiring_before_the_run_out_do_not_count() {
        let use_ = steady(7, 10);
        // 100 on the shelf would last 10 days, but 60 of it expires in 3 days: the 40 that
        // lasts is 4 days, which is after that expiry, so it settles at 4.
        let batches = [(Some(DAY + time::Duration::days(3)), 60), (None, 40)];
        let p = project(&input(&batches, &use_, 5, 7));
        assert_eq!(p.on_hand, 100);
        assert_eq!(p.usable_on_hand, 40);
        assert_eq!(p.days_cover, Some(4));
        assert_eq!(p.runs_out_on, Some(DAY + time::Duration::days(4)));
        // Expiring on the run-out day itself still counts that day.
        let batches = [(Some(DAY + time::Duration::days(10)), 100)];
        let p = project(&input(&batches, &use_, 5, 7));
        assert_eq!(p.usable_on_hand, 100);
        assert_eq!(p.days_cover, Some(10));
    }

    #[test]
    fn lead_time_plus_three_days_is_the_alert_line() {
        let use_ = steady(7, 10);
        // 100 units: 10 days of cover; lead 7 + 3 = 10: alerts. 110 units: 11 days: quiet.
        assert!(project(&input(&[(None, 100)], &use_, 5, 7)).should_alert);
        let p = project(&input(&[(None, 110)], &use_, 5, 7));
        assert!(!p.should_alert);
        assert_eq!(p.reason, None);
        // A longer lead time moves the line.
        assert!(project(&input(&[(None, 110)], &use_, 5, 10)).should_alert);
    }

    #[test]
    fn low_stock_beats_projection_as_the_reason() {
        let use_ = steady(7, 10);
        let p = project(&input(&[(None, 30)], &use_, 40, 7));
        assert_eq!(p.reason, Some(AlertReason::Low));
        assert_eq!(p.days_cover, Some(3));
    }

    #[test]
    fn rounding_is_down_for_cover_and_up_for_the_order() {
        // 10 units over 7 days: 10/7 a day.
        let mut use_ = vec![(day(1), 5), (day(7), 5)];
        use_.sort();
        let p = project(&input(&[(None, 25)], &use_, 1, 7));
        // 25 / (10/7) = 17.5 days, rounded down.
        assert_eq!(p.days_cover, Some(17));
        // ceil(10/7 * 21) = 30, less 25 on hand.
        assert_eq!(p.suggested_reorder_qty, Some(5));
        // Plenty on hand: never below zero.
        let p = project(&input(&[(None, 500)], &use_, 1, 7));
        assert_eq!(p.suggested_reorder_qty, Some(0));
    }

    #[test]
    fn positive_adjustments_and_non_use_never_count() {
        // The caller passes only `use` days; a stray non-positive or zero entry is ignored too.
        let mut use_ = steady(7, 10);
        use_.push((day(2), -50));
        use_.push((day(3), 0));
        let p = project(&input(&[(None, 100)], &use_, 5, 7));
        assert_eq!(p.daily_usage, Some(10.0));
    }
}
