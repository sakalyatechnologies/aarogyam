//! Reading a clinic's stock list: which column is which, and what each row says. Pure: the
//! file has already been read into rows of text, and nothing here knows about the database.
//!
//! Columns are found by their header (many spellings are accepted, in English), in any order.
//! `name` is required; everything else is optional. A row with a `quantity` receives stock
//! (a batch with its `batch_no`, `expiry`, `unit_cost` and `supplier`); a row without one only
//! creates or updates the item. Rows of the same item (a second batch) may repeat the name.

use serde::{Deserialize, Serialize};
use time::{Date, Month};

use crate::inventory::{MAX_MOVEMENT, StockUnit};

/// Most data rows in one import.
pub const MAX_ROWS: usize = 1_000;

/// One checked row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StockRow {
    /// The row in the file (1 is the header).
    pub row: usize,
    /// The item's name.
    pub name: String,
    /// The category, lower case with underscores.
    pub category: Option<String>,
    /// `piece`, `ml`, `g`, `box` or `pack`.
    pub unit: Option<String>,
    /// The reorder level.
    pub reorder_level: Option<i64>,
    /// What to order up to.
    pub max_level: Option<i64>,
    /// Units to receive; zero when the row only describes the item.
    pub quantity: i64,
    /// Cost of one unit in paise.
    pub unit_cost_paise: Option<i64>,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day the stock may be used, `YYYY-MM-DD`.
    pub expiry: Option<String>,
    /// The supplier's name, to match one of the clinic's suppliers.
    pub supplier: Option<String>,
}

/// Why a row was refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowError {
    /// The row in the file.
    pub row: usize,
    /// The column's field name, or `row` for the whole row.
    pub field: String,
    /// What is wrong; never echoes the cell.
    pub message: String,
}

impl RowError {
    /// An error on `field` of `row`.
    #[must_use]
    pub fn new(row: usize, field: &str, message: &str) -> Self {
        Self {
            row,
            field: field.to_owned(),
            message: message.to_owned(),
        }
    }
}

/// The columns of the file by field, as indexes into a row.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Columns {
    name: Option<usize>,
    category: Option<usize>,
    unit: Option<usize>,
    reorder_level: Option<usize>,
    max_level: Option<usize>,
    quantity: Option<usize>,
    unit_cost: Option<usize>,
    unit_cost_paise: Option<usize>,
    batch_no: Option<usize>,
    expiry: Option<usize>,
    supplier: Option<usize>,
}

/// A header in a fixed form: lower case, every run of other characters one space.
fn key(header: &str) -> String {
    let mut out = String::new();
    for c in header.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim_end().to_owned()
}

/// Finds the columns from the header row.
///
/// # Errors
/// A message when there is no `name` column.
pub fn columns(headers: &[String]) -> Result<Columns, &'static str> {
    let mut found = Columns::default();
    for (index, header) in headers.iter().enumerate() {
        let slot = match key(header).as_str() {
            "name" | "item" | "item name" | "product" | "material" | "description" => {
                &mut found.name
            }
            "category" | "type" | "group" => &mut found.category,
            "unit" | "uom" | "unit of measure" => &mut found.unit,
            "reorder level" | "reorder" | "reorder at" | "min" | "min level" | "minimum" => {
                &mut found.reorder_level
            }
            "max level" | "max" | "maximum" | "par" | "par level" | "order up to" => {
                &mut found.max_level
            }
            "quantity" | "qty" | "on hand" | "stock" | "opening stock" | "received" => {
                &mut found.quantity
            }
            "unit cost" | "cost" | "price" | "cost per unit" | "rate" => &mut found.unit_cost,
            "unit cost paise" | "cost paise" => &mut found.unit_cost_paise,
            "batch" | "batch no" | "batch number" | "lot" => &mut found.batch_no,
            "expiry" | "expiry date" | "exp" | "expires" => &mut found.expiry,
            "supplier" | "vendor" | "supplier name" => &mut found.supplier,
            _ => continue,
        };
        // The first column of a kind wins.
        slot.get_or_insert(index);
    }
    if found.name.is_none() {
        return Err("the file needs a column named name (or item)");
    }
    Ok(found)
}

fn cell(cells: &[String], index: Option<usize>) -> Option<&str> {
    index
        .and_then(|i| cells.get(i))
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
}

/// A whole number of units, with thousands separators allowed.
fn units(text: &str) -> Option<i64> {
    let digits: String = text.chars().filter(|c| !matches!(c, ',' | ' ')).collect();
    // A spreadsheet may write 12.0 for 12.
    let digits = digits.strip_suffix(".0").unwrap_or(&digits);
    let value: i64 = digits.parse().ok()?;
    (0..=MAX_MOVEMENT).contains(&value).then_some(value)
}

/// Rupees such as `12`, `12.5`, `1,200.75` or `₹90` as paise, with at most two decimals.
fn rupees(text: &str) -> Option<i64> {
    let cleaned: String = text
        .trim_start_matches(['₹', ' '])
        .chars()
        .filter(|c| !matches!(c, ',' | ' '))
        .collect();
    let (whole, fraction) = match cleaned.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (cleaned.as_str(), ""),
    };
    if whole.is_empty() && fraction.is_empty()
        || fraction.len() > 2
        || !whole.chars().all(|c| c.is_ascii_digit())
        || !fraction.chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let whole: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().ok()?
    };
    let fraction: i64 = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().ok()? * 10,
        _ => fraction.parse().ok()?,
    };
    let paise = whole.checked_mul(100)?.checked_add(fraction)?;
    (paise <= 100_000_000).then_some(paise)
}

/// A date as `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`.
fn day(text: &str) -> Option<Date> {
    let parts: Vec<&str> = text.split(['-', '/', '.']).map(str::trim).collect();
    let [a, b, c] = parts.as_slice() else {
        return None;
    };
    let (year, month, day) = if a.len() == 4 {
        (a, b, c)
    } else if c.len() == 4 {
        (c, b, a)
    } else {
        return None;
    };
    let month = Month::try_from(month.parse::<u8>().ok()?).ok()?;
    Date::from_calendar_date(year.parse().ok()?, month, day.parse().ok()?).ok()
}

/// A category as the clinic's stock stores it: lower case, words joined by `_`.
fn category(text: &str) -> Option<String> {
    let mut out = String::new();
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('_') {
            out.push('_');
        }
    }
    let out = out.trim_end_matches('_').to_owned();
    (out.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && out.len() <= 40).then_some(out)
}

fn unit(text: &str) -> Option<StockUnit> {
    match text.to_lowercase().as_str() {
        "pcs" | "pc" | "pieces" | "nos" | "no" | "unit" | "units" | "each" => {
            Some(StockUnit::Piece)
        }
        "millilitre" | "milliliter" | "millilitres" | "milliliters" => Some(StockUnit::Ml),
        "gm" | "gms" | "gram" | "grams" => Some(StockUnit::G),
        "boxes" => Some(StockUnit::Box),
        "packs" | "packet" | "packets" => Some(StockUnit::Pack),
        other => StockUnit::parse(other).ok(),
    }
}

/// Checks every data row. Returns the rows that passed and an error for each field that failed
/// (a row can have several); a row with any error is left out of the first list.
#[must_use]
#[expect(
    clippy::too_many_lines,
    reason = "one pass reads every column of a row"
)]
pub fn parse_rows(
    columns: &Columns,
    records: &[(usize, Vec<String>)],
) -> (Vec<StockRow>, Vec<RowError>) {
    let mut rows: Vec<StockRow> = Vec::new();
    let mut errors: Vec<RowError> = Vec::new();
    for (line, cells) in records {
        let before = errors.len();
        let row = *line;
        let mut bad = |field: &str, message: &str| errors.push(RowError::new(row, field, message));
        let name = match cell(cells, columns.name) {
            None => {
                bad("name", "is required");
                String::new()
            }
            Some(text) if text.chars().count() > 200 => {
                bad("name", "must be at most 200 characters");
                String::new()
            }
            Some(text) => text.to_owned(),
        };
        let category = cell(cells, columns.category).and_then(|text| {
            let parsed = category(text);
            if parsed.is_none() {
                bad(
                    "category",
                    "must start with a letter and be at most 40 characters",
                );
            }
            parsed
        });
        let unit_value = cell(cells, columns.unit).and_then(|text| {
            let parsed = unit(text);
            if parsed.is_none() {
                bad("unit", "must be piece, ml, g, box or pack");
            }
            parsed.map(|u| u.as_str().to_owned())
        });
        let mut number = |index, field: &str| {
            cell(cells, index).and_then(|text| {
                let parsed = units(text);
                if parsed.is_none() {
                    bad(field, "must be a whole number from 0 to 1000000");
                }
                parsed
            })
        };
        let reorder_level = number(columns.reorder_level, "reorder_level");
        let max_level = number(columns.max_level, "max_level");
        let quantity = number(columns.quantity, "quantity").unwrap_or(0);
        if let (Some(reorder), Some(max)) = (reorder_level, max_level)
            && max < reorder
        {
            bad("max_level", "must not be below the reorder level");
        }
        let mut unit_cost_paise = cell(cells, columns.unit_cost).and_then(|text| {
            let parsed = rupees(text);
            if parsed.is_none() {
                bad(
                    "unit_cost",
                    "must be an amount in rupees with at most two decimals",
                );
            }
            parsed
        });
        if let Some(text) = cell(cells, columns.unit_cost_paise) {
            match units(text) {
                Some(paise) => unit_cost_paise = unit_cost_paise.or(Some(paise)),
                None => bad("unit_cost_paise", "must be a whole number of paise"),
            }
        }
        let batch_no = cell(cells, columns.batch_no).and_then(|text| {
            if text.chars().count() > 60 {
                bad("batch_no", "must be at most 60 characters");
                None
            } else {
                Some(text.to_owned())
            }
        });
        let expiry = cell(cells, columns.expiry).and_then(|text| {
            let parsed = day(text);
            if parsed.is_none() {
                bad("expiry", "must be a date such as 2027-03-31 or 31/03/2027");
            }
            parsed.map(|d| d.to_string())
        });
        let supplier = cell(cells, columns.supplier).map(str::to_owned);
        if quantity == 0 && (batch_no.is_some() || expiry.is_some() || supplier.is_some()) {
            bad(
                "quantity",
                "is needed with a batch number, expiry or supplier",
            );
        }
        if errors.len() == before {
            rows.push(StockRow {
                row,
                name,
                category,
                unit: unit_value,
                reorder_level,
                max_level,
                quantity,
                unit_cost_paise,
                batch_no,
                expiry,
                supplier,
            });
        }
    }
    let conflicts = same_item_conflicts(&mut rows);
    errors.extend(conflicts);
    errors.sort_by_key(|e| e.row);
    (rows, errors)
}

/// Rows that name an item again must not describe it differently from its first row. The later
/// row is removed from `rows` and reported.
fn same_item_conflicts(rows: &mut Vec<StockRow>) -> Vec<RowError> {
    let mut errors = Vec::new();
    let mut kept: Vec<StockRow> = Vec::with_capacity(rows.len());
    for row in rows.drain(..) {
        let first = kept
            .iter()
            .find(|k| k.name.to_lowercase() == row.name.to_lowercase());
        let clash = first.and_then(|first| {
            [
                ("category", &first.category, &row.category),
                ("unit", &first.unit, &row.unit),
            ]
            .into_iter()
            .find(|(_, a, b)| a.is_some() && b.is_some() && a != b)
            .map(|(field, _, _)| field)
            .or_else(|| {
                [
                    ("reorder_level", first.reorder_level, row.reorder_level),
                    ("max_level", first.max_level, row.max_level),
                ]
                .into_iter()
                .find(|(_, a, b)| a.is_some() && b.is_some() && a != b)
                .map(|(field, _, _)| field)
            })
        });
        match clash {
            Some(field) => errors.push(RowError::new(
                row.row,
                field,
                "differs from an earlier row of the same item",
            )),
            None => kept.push(row),
        }
    }
    *rows = kept;
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(list: &[&str]) -> Vec<String> {
        list.iter().map(|h| (*h).to_owned()).collect()
    }

    fn record(line: usize, cells: &[&str]) -> (usize, Vec<String>) {
        (line, cells.iter().map(|c| (*c).to_owned()).collect())
    }

    #[test]
    fn finds_columns_by_many_spellings() {
        let found = columns(&headers(&[
            "Item Name",
            "Qty",
            "Cost (₹)",
            "Reorder-Level",
            "Exp.",
        ]));
        // "Cost (₹)" and "Exp." fold to "cost" and "exp".
        let found = found.unwrap();
        assert_eq!(found.name, Some(0));
        assert_eq!(found.quantity, Some(1));
        assert_eq!(found.unit_cost, Some(2));
        assert_eq!(found.reorder_level, Some(3));
        assert_eq!(found.expiry, Some(4));
        assert!(columns(&headers(&["Qty", "Cost"])).is_err());
    }

    #[test]
    fn money_dates_and_numbers() {
        assert_eq!(rupees("12"), Some(1_200));
        assert_eq!(rupees("12.5"), Some(1_250));
        assert_eq!(rupees("₹1,200.75"), Some(120_075));
        assert_eq!(rupees("12.345"), None);
        assert_eq!(rupees("-3"), None);
        assert_eq!(rupees("abc"), None);
        assert_eq!(
            day("2027-03-31").map(|d| d.to_string()),
            Some("2027-03-31".into())
        );
        assert_eq!(
            day("31/03/2027").map(|d| d.to_string()),
            Some("2027-03-31".into())
        );
        assert_eq!(
            day("31-3-2027").map(|d| d.to_string()),
            Some("2027-03-31".into())
        );
        assert_eq!(day("2027-13-01"), None);
        assert_eq!(day("March 2027"), None);
        assert_eq!(units("1,200"), Some(1_200));
        assert_eq!(units("12.0"), Some(12));
        assert_eq!(units("-1"), None);
        assert_eq!(units("2000000"), None);
        assert_eq!(
            category("Restorative Materials").as_deref(),
            Some("restorative_materials")
        );
        assert_eq!(category("1st"), None);
        assert_eq!(unit("Pcs"), Some(StockUnit::Piece));
        assert_eq!(unit("litre"), None);
    }

    #[test]
    fn good_rows_pass_and_bad_ones_say_why() {
        let columns = columns(&headers(&[
            "name",
            "category",
            "unit",
            "reorder level",
            "max level",
            "qty",
            "cost",
            "expiry",
            "supplier",
        ]))
        .unwrap();
        let records = vec![
            record(
                2,
                &[
                    "Composite A2",
                    "Restorative",
                    "pcs",
                    "5",
                    "20",
                    "10",
                    "450.50",
                    "31/03/2027",
                    "Dent Co",
                ],
            ),
            record(3, &["", "x", "", "", "", "", "", "", ""]),
            record(4, &["Gloves", "", "box", "10", "5", "", "", "", ""]),
            record(5, &["Gloves", "", "", "", "", "3", "abc", "soon", ""]),
            record(6, &["Floss", "", "", "", "", "", "", "2027-01-01", ""]),
            record(7, &["Composite A2", "Other", "", "", "", "4", "", "", ""]),
        ];
        let (rows, errors) = parse_rows(&columns, &records);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Composite A2");
        assert_eq!(rows[0].category.as_deref(), Some("restorative"));
        assert_eq!(rows[0].unit.as_deref(), Some("piece"));
        assert_eq!(rows[0].unit_cost_paise, Some(45_050));
        assert_eq!(rows[0].expiry.as_deref(), Some("2027-03-31"));
        let at = |row: usize| -> Vec<&str> {
            errors
                .iter()
                .filter(|e| e.row == row)
                .map(|e| e.field.as_str())
                .collect()
        };
        assert_eq!(at(3), vec!["name"]);
        // Max below reorder on row 4.
        assert_eq!(at(4), vec!["max_level"]);
        assert_eq!(at(5), vec!["unit_cost", "expiry"]);
        assert_eq!(at(6), vec!["quantity"]);
        // The same item again with another category.
        assert_eq!(at(7), vec!["category"]);
        // Errors never echo cells.
        assert!(errors.iter().all(|e| !e.message.contains("abc")));
    }

    #[test]
    fn a_second_batch_of_an_item_may_repeat_its_name() {
        let columns = columns(&headers(&["item", "qty", "batch", "category"])).unwrap();
        let records = vec![
            record(2, &["Gauze", "10", "B1", "disposables"]),
            record(3, &["gauze", "5", "B2", ""]),
        ];
        let (rows, errors) = parse_rows(&columns, &records);
        assert_eq!(errors, []);
        assert_eq!(rows.len(), 2);
    }
}
