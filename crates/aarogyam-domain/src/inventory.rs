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
}
