//! Money rules: GST per line, round-off, bill and receipt numbers per financial year, and
//! payment state derived from what was paid. Amounts are whole paise; floating point never
//! touches money.

use sakalya_types::Paise;
use time::{Date, Month};

/// Why a bill or payment value was refused. Messages never echo the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum BillingError {
    /// The GST rate is not 0, 5, 12 or 18 percent.
    #[error("must be 0, 5, 12 or 18")]
    Rate,
    /// The quantity is outside 1 to 10,000.
    #[error("must be between 1 and 10000")]
    Quantity,
    /// An amount is negative.
    #[error("must not be negative")]
    Negative,
    /// The discount is more than the line's amount.
    #[error("must not exceed the line's amount")]
    Discount,
    /// A sum overflowed.
    #[error("amount is too large")]
    Overflow,
    /// The six-digit serial of this financial year is used up.
    #[error("the number series for this financial year is full")]
    SeriesFull,
    /// A state code is not two digits.
    #[error("must be a two-digit GST state code")]
    StateCode,
}

/// A GST rate on a line. Health care by a clinical establishment is exempt (zero); medicines
/// and products sold are taxed at their rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum GstRate {
    /// Exempt or nil-rated.
    #[default]
    Zero,
    /// 5 percent.
    Five,
    /// 12 percent.
    Twelve,
    /// 18 percent.
    Eighteen,
}

impl GstRate {
    /// The rate from a whole percentage.
    ///
    /// # Errors
    /// [`BillingError::Rate`] for anything but 0, 5, 12 or 18.
    pub const fn from_percent(percent: u32) -> Result<Self, BillingError> {
        match percent {
            0 => Ok(Self::Zero),
            5 => Ok(Self::Five),
            12 => Ok(Self::Twelve),
            18 => Ok(Self::Eighteen),
            _ => Err(BillingError::Rate),
        }
    }

    /// The rate from basis points, as stored.
    ///
    /// # Errors
    /// [`BillingError::Rate`] for anything but 0, 500, 1200 or 1800.
    pub const fn from_bps(bps: i32) -> Result<Self, BillingError> {
        match bps {
            0 => Ok(Self::Zero),
            500 => Ok(Self::Five),
            1200 => Ok(Self::Twelve),
            1800 => Ok(Self::Eighteen),
            _ => Err(BillingError::Rate),
        }
    }

    /// Basis points: 1,800 is 18 percent.
    #[must_use]
    pub const fn bps(self) -> u32 {
        match self {
            Self::Zero => 0,
            Self::Five => 500,
            Self::Twelve => 1200,
            Self::Eighteen => 1800,
        }
    }

    /// The whole percentage.
    #[must_use]
    pub const fn percent(self) -> u32 {
        self.bps() / 100
    }
}

/// A GST state code: two digits, the first two characters of a GSTIN (27 is Maharashtra).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct StateCode([u8; 2]);

impl StateCode {
    /// Parses two digits.
    ///
    /// # Errors
    /// [`BillingError::StateCode`] otherwise.
    pub fn parse(text: &str) -> Result<Self, BillingError> {
        match text.trim().as_bytes() {
            [a, b] if a.is_ascii_digit() && b.is_ascii_digit() => Ok(Self([*a, *b])),
            _ => Err(BillingError::StateCode),
        }
    }

    /// The state of a GSTIN, from its first two digits.
    #[must_use]
    pub fn of_gstin(gstin: &str) -> Option<Self> {
        gstin.get(..2).and_then(|code| Self::parse(code).ok())
    }

    /// The two digits.
    #[must_use]
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).unwrap_or("00")
    }
}

/// Which GST applies: CGST and SGST inside the supplier's state, IGST across states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Supply {
    /// Same state: half the rate as CGST, half as SGST.
    IntraState,
    /// Another state: the whole rate as IGST.
    InterState,
}

impl Supply {
    /// Decides from the branch's state and the place of supply. Health care is supplied where
    /// it is performed, so a bill is intra-state unless a different place of supply is set.
    #[must_use]
    pub fn decide(branch: Option<StateCode>, place_of_supply: Option<StateCode>) -> Self {
        match (branch, place_of_supply) {
            (Some(branch), Some(place)) if branch != place => Self::InterState,
            _ => Self::IntraState,
        }
    }
}

/// A bill line before tax.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Line {
    /// How many, 1 to 10,000.
    pub quantity: u32,
    /// Price of one.
    pub unit_price: Paise,
    /// Discount on the whole line.
    pub discount: Paise,
    /// GST rate.
    pub rate: GstRate,
}

/// A bill line's amounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LineAmounts {
    /// Quantity times unit price.
    pub gross: Paise,
    /// The discount.
    pub discount: Paise,
    /// Gross less discount: what GST is charged on.
    pub taxable: Paise,
    /// Central GST.
    pub cgst: Paise,
    /// State GST.
    pub sgst: Paise,
    /// Integrated GST.
    pub igst: Paise,
    /// Taxable value plus tax.
    pub total: Paise,
}

impl Line {
    /// Checks the line's values.
    ///
    /// # Errors
    /// The first [`BillingError`] that applies.
    pub fn check(&self) -> Result<(), BillingError> {
        if !(1..=10_000).contains(&self.quantity) {
            return Err(BillingError::Quantity);
        }
        if self.unit_price.is_negative() || self.discount.is_negative() {
            return Err(BillingError::Negative);
        }
        if self.discount > self.gross()? {
            return Err(BillingError::Discount);
        }
        Ok(())
    }

    fn gross(&self) -> Result<Paise, BillingError> {
        self.unit_price
            .checked_mul(i64::from(self.quantity))
            .ok_or(BillingError::Overflow)
    }

    /// The line's tax and total. Each half of an intra-state rate is rounded on its own, so
    /// CGST and SGST are always equal, as printed.
    ///
    /// # Errors
    /// [`Line::check`]'s errors, or [`BillingError::Overflow`].
    pub fn amounts(&self, supply: Supply) -> Result<LineAmounts, BillingError> {
        self.check()?;
        let gross = self.gross()?;
        let taxable = gross
            .checked_sub(self.discount)
            .ok_or(BillingError::Overflow)?;
        let (cgst, sgst, igst) = match supply {
            Supply::IntraState => {
                let half = taxable
                    .share_bps(self.rate.bps() / 2)
                    .ok_or(BillingError::Overflow)?;
                (half, half, Paise::ZERO)
            }
            Supply::InterState => {
                let whole = taxable
                    .share_bps(self.rate.bps())
                    .ok_or(BillingError::Overflow)?;
                (Paise::ZERO, Paise::ZERO, whole)
            }
        };
        let total =
            Paise::checked_sum([taxable, cgst, sgst, igst]).ok_or(BillingError::Overflow)?;
        Ok(LineAmounts {
            gross,
            discount: self.discount,
            taxable,
            cgst,
            sgst,
            igst,
            total,
        })
    }
}

/// A bill's totals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Totals {
    /// Sum of gross line amounts.
    pub subtotal: Paise,
    /// Sum of line discounts.
    pub discount: Paise,
    /// Sum of taxable values.
    pub taxable: Paise,
    /// Central GST.
    pub cgst: Paise,
    /// State GST.
    pub sgst: Paise,
    /// Integrated GST.
    pub igst: Paise,
    /// All GST.
    pub tax: Paise,
    /// What rounding to the rupee added (negative when it took away), -50 to 50 paise.
    pub round_off: Paise,
    /// What the patient pays: taxable value plus tax plus round-off.
    pub total: Paise,
}

/// Rounds to the nearest rupee, half a rupee up.
#[must_use]
pub fn round_to_rupee(amount: Paise) -> Paise {
    let paise = amount.get();
    let rupees = paise.div_euclid(100);
    let rest = paise.rem_euclid(100);
    let rounded = if rest >= 50 { rupees + 1 } else { rupees };
    Paise::new(rounded.saturating_mul(100))
}

/// Adds up a bill's lines and rounds the total to the rupee.
///
/// # Errors
/// [`BillingError::Overflow`] if a sum doesn't fit.
pub fn totals(lines: &[LineAmounts]) -> Result<Totals, BillingError> {
    let sum = |pick: fn(&LineAmounts) -> Paise| {
        Paise::checked_sum(lines.iter().map(pick)).ok_or(BillingError::Overflow)
    };
    let subtotal = sum(|line| line.gross)?;
    let discount = sum(|line| line.discount)?;
    let taxable = sum(|line| line.taxable)?;
    let cgst = sum(|line| line.cgst)?;
    let sgst = sum(|line| line.sgst)?;
    let igst = sum(|line| line.igst)?;
    let tax = Paise::checked_sum([cgst, sgst, igst]).ok_or(BillingError::Overflow)?;
    let exact = taxable.checked_add(tax).ok_or(BillingError::Overflow)?;
    let total = round_to_rupee(exact);
    let round_off = total.checked_sub(exact).ok_or(BillingError::Overflow)?;
    Ok(Totals {
        subtotal,
        discount,
        taxable,
        cgst,
        sgst,
        igst,
        tax,
        round_off,
        total,
    })
}

text_value!(
    /// Whether a bill charges GST: a tax invoice when the clinic is GST-registered and a line
    /// is taxed; otherwise a bill of supply.
    DocType("doc_type") {
        /// Charges GST.
        TaxInvoice => "tax_invoice",
        /// Exempt supplies, or an unregistered clinic.
        BillOfSupply => "bill_of_supply",
    }
);

impl DocType {
    /// Decides the document type.
    #[must_use]
    pub fn decide(gst_registered: bool, any_taxed_line: bool) -> Self {
        if gst_registered && any_taxed_line {
            Self::TaxInvoice
        } else {
            Self::BillOfSupply
        }
    }
}

text_value!(
    /// A bill's document state. Whether it is paid is derived, see [`PaymentState`].
    InvoiceStatus("status") {
        /// Being written; no number yet.
        Draft => "draft",
        /// Numbered and final.
        Issued => "issued",
        /// Cancelled with a reason; kept.
        Void => "void",
    }
);

text_value!(
    /// How much of an issued bill is paid, from the allocations of payments that aren't void.
    PaymentState("payment_state") {
        /// Nothing paid.
        Unpaid => "unpaid",
        /// Some paid.
        Partial => "partial",
        /// Fully paid.
        Paid => "paid",
    }
);

impl PaymentState {
    /// Derives the state from the bill's total and what was paid towards it.
    #[must_use]
    pub fn of(total: Paise, paid: Paise) -> Self {
        if paid >= total {
            Self::Paid
        } else if paid > Paise::ZERO {
            Self::Partial
        } else {
            Self::Unpaid
        }
    }
}

text_value!(
    /// How a payment was made.
    PaymentMethod("method") {
        /// Cash at the counter.
        Cash => "cash",
        /// UPI.
        Upi => "upi",
        /// Debit or credit card.
        Card => "card",
        /// Bank transfer.
        Bank => "bank",
    }
);

text_value!(
    /// A payment's state.
    PaymentStatus("status") {
        /// Counted.
        Received => "received",
        /// Voided with a reason; its allocations no longer count.
        Void => "void",
    }
);

/// An Indian financial year, April to March, named like `26-27`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FinancialYear {
    start: i32,
}

impl FinancialYear {
    /// The financial year containing `date` (a date in the clinic's time zone).
    #[must_use]
    pub fn of(date: Date) -> Self {
        let year = date.year();
        let start = if date.month() >= Month::April {
            year
        } else {
            year - 1
        };
        Self { start }
    }

    /// The label, such as `26-27`.
    #[must_use]
    pub fn label(self) -> String {
        format!(
            "{:02}-{:02}",
            self.start.rem_euclid(100),
            (self.start + 1).rem_euclid(100)
        )
    }
}

/// Formats a serial in a financial year: `SD/26-27/000318`.
///
/// # Errors
/// [`BillingError::SeriesFull`] past 999,999.
pub fn serial_number(
    prefix: &str,
    year: FinancialYear,
    serial: u64,
) -> Result<String, BillingError> {
    if !(1..=999_999).contains(&serial) {
        return Err(BillingError::SeriesFull);
    }
    Ok(format!("{prefix}/{}/{serial:06}", year.label()))
}

/// The prefix of receipt numbers: `RC/26-27/000042`.
pub const RECEIPT_PREFIX: &str = "RC";

/// Aging of an unpaid bill, by days since issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgingBucket {
    /// 0 to 30 days.
    Days0To30,
    /// 31 to 60 days.
    Days31To60,
    /// 61 to 90 days.
    Days61To90,
    /// More than 90 days.
    Over90,
}

impl AgingBucket {
    /// The bucket for a bill `days` old.
    #[must_use]
    pub const fn of(days: i64) -> Self {
        match days {
            ..=30 => Self::Days0To30,
            31..=60 => Self::Days31To60,
            61..=90 => Self::Days61To90,
            _ => Self::Over90,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn line(quantity: u32, unit: i64, discount: i64, percent: u32) -> Line {
        Line {
            quantity,
            unit_price: Paise::new(unit),
            discount: Paise::new(discount),
            rate: GstRate::from_percent(percent).unwrap(),
        }
    }

    #[test]
    fn intra_state_splits_the_rate_into_equal_halves() {
        // Toothpaste ₹149.99 × 2 at 18%: taxable 299.98, CGST = SGST = 9% = 27.00 (26.9982).
        let amounts = line(2, 14_999, 0, 18).amounts(Supply::IntraState).unwrap();
        assert_eq!(amounts.taxable, Paise::new(29_998));
        assert_eq!(amounts.cgst, Paise::new(2_700));
        assert_eq!(amounts.sgst, Paise::new(2_700));
        assert_eq!(amounts.igst, Paise::ZERO);
        assert_eq!(amounts.total, Paise::new(35_398));
    }

    #[test]
    fn inter_state_charges_the_whole_rate_as_igst() {
        let amounts = line(1, 10_000, 1_000, 12)
            .amounts(Supply::InterState)
            .unwrap();
        assert_eq!(amounts.taxable, Paise::new(9_000));
        assert_eq!(amounts.igst, Paise::new(1_080));
        assert_eq!(amounts.cgst, Paise::ZERO);
        assert_eq!(amounts.total, Paise::new(10_080));
    }

    #[test]
    fn exempt_lines_carry_no_tax() {
        let amounts = line(1, 350_000, 50_000, 0)
            .amounts(Supply::IntraState)
            .unwrap();
        assert_eq!(amounts.taxable, Paise::new(300_000));
        assert_eq!(
            Paise::checked_sum([amounts.cgst, amounts.sgst, amounts.igst]),
            Some(Paise::ZERO)
        );
        assert_eq!(amounts.total, Paise::new(300_000));
    }

    #[test]
    fn totals_round_to_the_rupee() {
        let lines = [
            line(1, 50_000, 0, 0).amounts(Supply::IntraState).unwrap(),
            line(1, 14_999, 0, 18).amounts(Supply::IntraState).unwrap(),
        ];
        // 500.00 + 149.99 + 13.50 + 13.50 = 676.99 → 677.00, round-off +0.01.
        let totals = totals(&lines).unwrap();
        assert_eq!(totals.taxable, Paise::new(64_999));
        assert_eq!(totals.tax, Paise::new(2_700));
        assert_eq!(totals.round_off, Paise::new(1));
        assert_eq!(totals.total, Paise::new(67_700));
        assert_eq!(round_to_rupee(Paise::new(10_049)), Paise::new(10_000));
        assert_eq!(round_to_rupee(Paise::new(10_050)), Paise::new(10_100));
        assert_eq!(round_to_rupee(Paise::ZERO), Paise::ZERO);
        let down = totals_of(&[line(1, 10_040, 0, 0)]);
        assert_eq!(
            (down.total, down.round_off),
            (Paise::new(10_000), Paise::new(-40))
        );
    }

    fn totals_of(lines: &[Line]) -> Totals {
        let amounts: Vec<_> = lines
            .iter()
            .map(|line| line.amounts(Supply::IntraState).unwrap())
            .collect();
        totals(&amounts).unwrap()
    }

    #[test]
    fn bad_lines_are_refused() {
        assert_eq!(line(0, 100, 0, 0).check(), Err(BillingError::Quantity));
        assert_eq!(line(1, -1, 0, 0).check(), Err(BillingError::Negative));
        assert_eq!(line(2, 100, 201, 0).check(), Err(BillingError::Discount));
        assert_eq!(GstRate::from_percent(28), Err(BillingError::Rate));
        assert_eq!(GstRate::from_bps(1200), Ok(GstRate::Twelve));
    }

    #[test]
    fn place_of_supply_decides_igst() {
        let maharashtra = StateCode::parse("27").ok();
        let karnataka = StateCode::parse("29").ok();
        assert_eq!(Supply::decide(maharashtra, None), Supply::IntraState);
        assert_eq!(Supply::decide(maharashtra, maharashtra), Supply::IntraState);
        assert_eq!(Supply::decide(maharashtra, karnataka), Supply::InterState);
        assert_eq!(Supply::decide(None, karnataka), Supply::IntraState);
        assert_eq!(StateCode::of_gstin("27AAPFU0939F1ZV"), maharashtra);
        assert!(StateCode::parse("2A").is_err());
    }

    #[test]
    fn numbers_follow_the_financial_year() {
        assert_eq!(FinancialYear::of(date!(2027 - 03 - 31)).label(), "26-27");
        assert_eq!(FinancialYear::of(date!(2027 - 04 - 01)).label(), "27-28");
        assert_eq!(FinancialYear::of(date!(2099 - 12 - 01)).label(), "99-00");
        let year = FinancialYear::of(date!(2026 - 10 - 04));
        assert_eq!(serial_number("SD", year, 318).unwrap(), "SD/26-27/000318");
        assert_eq!(
            serial_number(RECEIPT_PREFIX, year, 1).unwrap(),
            "RC/26-27/000001"
        );
        assert_eq!(
            serial_number("SD", year, 1_000_000),
            Err(BillingError::SeriesFull)
        );
    }

    #[test]
    fn payment_state_is_derived() {
        let total = Paise::new(10_000);
        assert_eq!(PaymentState::of(total, Paise::ZERO), PaymentState::Unpaid);
        assert_eq!(
            PaymentState::of(total, Paise::new(1)),
            PaymentState::Partial
        );
        assert_eq!(PaymentState::of(total, total), PaymentState::Paid);
        assert_eq!(
            PaymentState::of(Paise::ZERO, Paise::ZERO),
            PaymentState::Paid
        );
        assert_eq!(DocType::decide(true, true), DocType::TaxInvoice);
        assert_eq!(DocType::decide(false, true), DocType::BillOfSupply);
        assert_eq!(PaymentMethod::parse("upi"), Ok(PaymentMethod::Upi));
        assert!(PaymentMethod::parse("cheque").is_err());
        assert_eq!(AgingBucket::of(0), AgingBucket::Days0To30);
        assert_eq!(AgingBucket::of(91), AgingBucket::Over90);
    }
}
