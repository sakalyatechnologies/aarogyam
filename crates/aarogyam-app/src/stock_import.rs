//! Stock import: a CSV (or Excel) list of items and opening stock. The upload is checked row by
//! row and held as a preview (the rows that passed, the errors with their row numbers) under a
//! one-time token; committing the token applies the rows, once. Committing the same token again
//! returns the first result and changes nothing.

use std::collections::{HashMap, HashSet};

use aarogyam_dal::inventory::{self as inv, ItemRow};
use aarogyam_dal::stock_imports::{self as dal, NewPreview};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{InventoryItemId, SupplierId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::stock_import::{self as rules, MAX_ROWS, RowError, StockRow};
use sakalya_db::{Db, ScopedTx};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::files::sha256_hex;
use crate::inventory::{ItemInput, ReceiveInput, check_receive, merge_item, receive_in};
use crate::scope::staff_scope as scope;
use crate::tabular::{MAX_FILE_BYTES, TableError, read_table};
use crate::tokens::{hash_token, new_token};

/// A file as uploaded.
#[derive(Debug, Clone, Default)]
pub struct Upload {
    /// Its name.
    pub file_name: String,
    /// Its bytes.
    pub bytes: Vec<u8>,
    /// The workbook sheet to read; the first when `None`.
    pub sheet: Option<String>,
}

/// A row that passed, as the preview shows it.
#[derive(Debug, Clone)]
pub struct PreviewLine {
    /// The row in the file.
    pub row: usize,
    /// The item's name.
    pub name: String,
    /// Units to receive; `0` for an item only described.
    pub quantity: i64,
    /// The item does not exist yet and will be created.
    pub new_item: bool,
}

/// A checked upload, waiting to be committed.
#[derive(Debug, Clone)]
pub struct Preview {
    /// Commit with this token. Shown once.
    pub token: String,
    /// The file's name.
    pub file_name: String,
    /// Data rows in the file.
    pub row_count: usize,
    /// Rows that passed.
    pub valid_rows: usize,
    /// Rows that failed, with their reasons.
    pub errors: Vec<RowError>,
    /// The rows that passed.
    pub rows: Vec<PreviewLine>,
    /// Items the commit creates.
    pub new_items: usize,
    /// Things worth knowing, such as the file having been imported before.
    pub warnings: Vec<String>,
    /// When the preview ends unless committed.
    pub expires_at: OffsetDateTime,
}

/// What a commit did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Committed {
    /// Items created.
    pub items_created: usize,
    /// Existing items whose values changed.
    pub items_updated: usize,
    /// Batches received.
    pub batches_received: usize,
    /// Units received in all.
    pub units_received: i64,
    /// Rows that could no longer be applied (the clinic's items or suppliers changed since the
    /// preview).
    pub skipped: Vec<RowError>,
}

/// The result of a commit call.
#[derive(Debug, Clone)]
pub struct CommitOutcome {
    /// What was done.
    pub result: Committed,
    /// This token had been committed already; nothing changed this time.
    pub replayed: bool,
}

fn file_error(error: &TableError) -> AppError {
    AppError::invalid("file", error)
}

fn clean_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let clean: String = base
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect::<String>()
        .trim()
        .to_owned();
    if clean.is_empty() {
        "upload".to_owned()
    } else {
        clean
    }
}

/// How the row's item fields read as an item change: only the cells that were given.
fn item_input(row: &StockRow, new: bool) -> ItemInput {
    ItemInput {
        name: new.then(|| row.name.clone()),
        category: row.category.clone(),
        unit: row.unit.clone(),
        reorder_level: row.reorder_level,
        max_level: row.max_level,
        active: None,
    }
}

struct Known {
    items: HashMap<String, Uuid>,
    suppliers: HashMap<String, Uuid>,
}

async fn known(tx: &mut ScopedTx) -> Result<Known, AppError> {
    let items = inv::stock(tx.conn())
        .await?
        .into_iter()
        .map(|row| (row.name.to_lowercase(), row.id))
        .collect();
    let suppliers = inv::suppliers(tx.conn())
        .await?
        .into_iter()
        .map(|row| (row.name.to_lowercase(), row.id))
        .collect();
    Ok(Known { items, suppliers })
}

/// Checks a row against what the clinic has: the item's values must be valid together with the
/// ones it already has, and a named supplier must exist. Returns the item's current row.
async fn check_row(
    tx: &mut ScopedTx,
    known: &Known,
    row: &StockRow,
) -> Result<Result<Option<ItemRow>, RowError>, AppError> {
    let current = match known.items.get(&row.name.to_lowercase()) {
        Some(id) => inv::item(tx.conn(), *id).await?,
        None => None,
    };
    if let Err(AppError::Invalid { field, message }) =
        merge_item(current.as_ref(), &item_input(row, current.is_none()))
    {
        return Ok(Err(RowError::new(row.row, field, &message)));
    }
    if let Some(name) = &row.supplier
        && !known.suppliers.contains_key(&name.to_lowercase())
    {
        return Ok(Err(RowError::new(
            row.row,
            "supplier",
            "is not one of the clinic's suppliers",
        )));
    }
    Ok(Ok(current))
}

/// Reads an upload, checks every row and opens a preview.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Invalid`] (field `file`) when the
/// file can't be read, has no usable header or no rows, or is too big.
#[expect(clippy::too_many_lines, reason = "one transaction checks every row")]
pub async fn preview(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    upload: Upload,
    now: OffsetDateTime,
) -> Result<Preview, AppError> {
    actor.require(Permission::InventoryManage)?;
    let Upload {
        file_name,
        bytes,
        sheet,
    } = upload;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(file_error(&TableError::TooLarge));
    }
    let size_bytes = i32::try_from(bytes.len()).map_err(|_| file_error(&TableError::TooLarge))?;
    let (table, sha256) = tokio::task::spawn_blocking(move || {
        read_table(&bytes, sheet.as_deref()).map(|table| (table, sha256_hex(&bytes)))
    })
    .await
    .map_err(|_| AppError::Internal("file reader"))?
    .map_err(|error| file_error(&error))?;
    let (header, data) = table
        .records
        .split_first()
        .ok_or_else(|| file_error(&TableError::Empty))?;
    if data.is_empty() {
        return Err(AppError::invalid(
            "file",
            "the file has no rows under its header",
        ));
    }
    if data.len() > MAX_ROWS {
        return Err(AppError::invalid(
            "file",
            format!("the file has more than {MAX_ROWS} rows"),
        ));
    }
    let columns =
        rules::columns(&header.1).map_err(|message| AppError::invalid("file", message))?;
    let (rows, mut errors) = rules::parse_rows(&columns, data);
    let (token, token_hash) = new_token()?;
    let file_name = clean_file_name(&file_name);
    let sha = sha256.clone();
    let preview = db
        .scoped(&scope(actor, request_id), async |tx| {
            let known = known(tx).await?;
            let mut passed = Vec::with_capacity(rows.len());
            let mut lines = Vec::with_capacity(rows.len());
            let mut seen_new: HashSet<String> = HashSet::new();
            let mut new_items = 0;
            for row in rows {
                match check_row(tx, &known, &row).await? {
                    Err(error) => errors.push(error),
                    Ok(current) => {
                        let key = row.name.to_lowercase();
                        let new_item = current.is_none();
                        if new_item && seen_new.insert(key) {
                            new_items += 1;
                        }
                        lines.push(PreviewLine {
                            row: row.row,
                            name: row.name.clone(),
                            quantity: row.quantity,
                            new_item,
                        });
                        passed.push(row);
                    }
                }
            }
            errors.sort_by_key(|error| error.row);
            let row_count = data.len();
            let to_i32 = |n: usize| i32::try_from(n).map_err(|_| AppError::Internal("count"));
            let rows_json =
                serde_json::to_value(&passed).map_err(|_| AppError::Internal("rows"))?;
            let errors_json =
                serde_json::to_value(&errors).map_err(|_| AppError::Internal("errors"))?;
            let id = Uuid::now_v7();
            dal::open(
                tx.conn(),
                &NewPreview {
                    id,
                    token_hash: &token_hash,
                    file_name: &file_name,
                    file_sha256: &sha,
                    size_bytes,
                    row_count: to_i32(row_count)?,
                    valid_rows: to_i32(passed.len())?,
                    error_rows: to_i32(row_count - passed.len())?,
                    rows: &rows_json,
                    errors: &errors_json,
                },
            )
            .await?;
            let mut warnings = Vec::new();
            if dal::already_committed(tx.conn(), &sha).await? {
                warnings.push(
                    "a file with exactly these contents was imported before; committing it again receives the stock again"
                        .to_owned(),
                );
            }
            Ok::<_, AppError>(Preview {
                token: String::new(),
                file_name: file_name.clone(),
                row_count,
                valid_rows: passed.len(),
                errors: errors.clone(),
                rows: lines,
                new_items,
                warnings,
                expires_at: now + time::Duration::hours(24),
            })
        })
        .await?;
    Ok(Preview { token, ..preview })
}

/// Commits a preview by its token: creates the items that are new, changes the values the file
/// gives for those that exist, and receives each row's quantity as a batch. Committing a token
/// again returns the first result.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::NotFound`] for a token this
/// clinic doesn't hold; [`AppError::Conflict`] when the preview has expired.
pub async fn commit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    token: &str,
    now: OffsetDateTime,
) -> Result<CommitOutcome, AppError> {
    actor.require(Permission::InventoryManage)?;
    let hash = hash_token(token);
    db.scoped(&scope(actor, request_id), async |tx| {
        let held = dal::lock_by_token(tx.conn(), &hash)
            .await?
            .ok_or(AppError::NotFound("stock import"))?;
        match held.status.as_str() {
            "committed" => {
                let result: Committed = held
                    .result
                    .and_then(|value| serde_json::from_value(value).ok())
                    .ok_or(AppError::Internal("stock import result"))?;
                return Ok(CommitOutcome {
                    result,
                    replayed: true,
                });
            }
            "open" => {}
            _ => {
                return Err(AppError::Conflict(
                    "this preview has expired; upload the file again",
                ));
            }
        }
        let rows: Vec<StockRow> = held
            .rows
            .and_then(|value| serde_json::from_value(value).ok())
            .ok_or(AppError::Internal("stock import rows"))?;
        let today = clinic_today(&actor.timezone, now);
        let result = apply(tx, rows, today).await?;
        let value = serde_json::to_value(&result).map_err(|_| AppError::Internal("result"))?;
        dal::commit(tx.conn(), held.id, &value).await?;
        Ok(CommitOutcome {
            result,
            replayed: false,
        })
    })
    .await
}

async fn apply(tx: &mut ScopedTx, rows: Vec<StockRow>, today: Date) -> Result<Committed, AppError> {
    let mut known = known(tx).await?;
    let mut done = Committed::default();
    for row in rows {
        let current = match check_row(tx, &known, &row).await? {
            Ok(current) => current,
            Err(error) => {
                done.skipped.push(error);
                continue;
            }
        };
        let item_id = if let Some(current) = current {
            let fields = merge_item(Some(&current), &item_input(&row, false))?;
            let changed = fields.reorder_level != current.reorder_level
                || fields.max_level != current.max_level
                || fields.category != current.category
                || fields.unit.as_str() != current.unit;
            if changed {
                inv::update_item(tx.conn(), current.id, &fields.values()).await?;
                done.items_updated += 1;
            }
            current.id
        } else {
            let fields = merge_item(None, &item_input(&row, true))?;
            let id = InventoryItemId::new_v7().uuid();
            inv::insert_item(tx.conn(), id, &fields.values()).await?;
            known.items.insert(row.name.to_lowercase(), id);
            done.items_created += 1;
            id
        };
        if row.quantity > 0 {
            let expiry = row
                .expiry
                .as_deref()
                .map(|text| Date::parse(text, &time::format_description::well_known::Iso8601::DATE))
                .transpose()
                .map_err(|_| AppError::Internal("expiry"))?;
            let input = ReceiveInput {
                item_id: InventoryItemId::from_uuid(item_id),
                supplier_id: row
                    .supplier
                    .as_ref()
                    .and_then(|name| known.suppliers.get(&name.to_lowercase()))
                    .copied()
                    .map(SupplierId::from_uuid),
                batch_no: row.batch_no.clone(),
                expiry,
                quantity: row.quantity,
                unit_cost_paise: row.unit_cost_paise.unwrap_or(0),
                received_on: None,
            };
            let batch_no = check_receive(&input)?;
            receive_in(tx, &input, batch_no.as_deref(), today).await?;
            done.batches_received += 1;
            done.units_received += row.quantity;
        }
    }
    Ok(done)
}
