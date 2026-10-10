//! The price list and bills: drafts, issue with GST and a financial-year number, void.
//! Every function runs in one clinic transaction.

use aarogyam_dal::billing::{self as dal, InvoiceFilter, InvoiceLineRow, PriceItemValues};
use aarogyam_dal::{access, patients};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::billing::{
    BillingError, DocType, FinancialYear, GstRate, InvoiceStatus, Line, LineAmounts, PaymentState,
    StateCode, Supply, Totals, serial_number, totals,
};
use aarogyam_domain::ids::{InvoiceId, PatientId, PriceItemId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use serde_json::{Value, json};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_today, day_range};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

fn billing(field: &'static str) -> impl Fn(BillingError) -> AppError {
    move |error| AppError::invalid(field, error)
}

/// Trims optional text; empty means none.
fn trimmed(
    text: Option<&str>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) if text.chars().count() > max => Err(AppError::invalid(
            field,
            format!("must be at most {max} characters"),
        )),
        Some(text) => Ok(Some(text.to_owned())),
    }
}

fn pattern(
    text: Option<String>,
    field: &'static str,
    ok: fn(&str) -> bool,
) -> Result<Option<String>, AppError> {
    match text {
        Some(text) if !ok(&text) => Err(AppError::invalid(field, "has an invalid format")),
        other => Ok(other),
    }
}

fn is_code(text: &str) -> bool {
    (1..=32).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn is_category(text: &str) -> bool {
    let bytes = text.as_bytes();
    (1..=40).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_')
}

fn is_sac_hsn(text: &str) -> bool {
    (4..=8).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit())
}

// ------------------------------------------------------------------ price list

/// A price list entry as the API shows it.
#[derive(Debug, Clone)]
pub struct PriceItemView {
    /// Identifier.
    pub id: PriceItemId,
    /// Short code.
    pub code: Option<String>,
    /// Name.
    pub name: String,
    /// Revenue-mix category.
    pub category: Option<String>,
    /// SAC or HSN.
    pub sac_hsn: Option<String>,
    /// Default price.
    pub price: Paise,
    /// Whether GST applies.
    pub taxable: bool,
    /// GST percentage.
    pub gst_rate: u32,
    /// Offered.
    pub active: bool,
}

impl From<dal::PriceItemRow> for PriceItemView {
    fn from(row: dal::PriceItemRow) -> Self {
        Self {
            id: PriceItemId::from_uuid(row.id),
            code: row.code,
            name: row.name,
            category: row.category,
            sac_hsn: row.sac_hsn,
            price: Paise::new(row.price_paise),
            taxable: row.taxable,
            gst_rate: GstRate::from_bps(row.tax_rate_bps).map_or(0, GstRate::percent),
            active: row.active,
        }
    }
}

/// A price list entry's values, as received. On a change, `None` keeps the current value and
/// an empty string clears an optional one.
#[derive(Debug, Clone, Default)]
pub struct PriceItemInput {
    /// Short code, unique in the clinic.
    pub code: Option<String>,
    /// Name.
    pub name: Option<String>,
    /// Revenue-mix category.
    pub category: Option<String>,
    /// SAC or HSN.
    pub sac_hsn: Option<String>,
    /// Default price.
    pub price_paise: Option<i64>,
    /// Whether GST applies (medicines, products).
    pub taxable: Option<bool>,
    /// GST percentage: 0, 5, 12 or 18.
    pub gst_rate: Option<u32>,
    /// Offered.
    pub active: Option<bool>,
}

struct PriceItemFields {
    code: Option<String>,
    name: String,
    category: Option<String>,
    sac_hsn: Option<String>,
    price_paise: i64,
    taxable: bool,
    rate: GstRate,
    active: bool,
}

fn merge_price_item(
    current: Option<&dal::PriceItemRow>,
    input: PriceItemInput,
) -> Result<PriceItemFields, AppError> {
    let keep = |new: Option<String>, old: Option<&Option<String>>| match new {
        Some(text) => Some(text),
        None => old.cloned().flatten(),
    };
    let code = trimmed(
        keep(input.code, current.map(|c| &c.code)).as_deref(),
        "code",
        32,
    )?;
    let code = pattern(code, "code", is_code)?;
    let category = trimmed(
        keep(input.category, current.map(|c| &c.category)).as_deref(),
        "category",
        40,
    )?
    .map(|text| text.to_lowercase());
    let category = pattern(category, "category", is_category)?;
    let sac_hsn = trimmed(
        keep(input.sac_hsn, current.map(|c| &c.sac_hsn)).as_deref(),
        "sac_hsn",
        8,
    )?;
    let sac_hsn = pattern(sac_hsn, "sac_hsn", is_sac_hsn)?;
    let name = input
        .name
        .or_else(|| current.map(|c| c.name.clone()))
        .unwrap_or_default();
    let name =
        trimmed(Some(&name), "name", 200)?.ok_or(AppError::invalid("name", "is required"))?;
    let price_paise = input
        .price_paise
        .or(current.map(|c| c.price_paise))
        .ok_or(AppError::invalid("price_paise", "is required"))?;
    if price_paise < 0 {
        return Err(AppError::invalid("price_paise", BillingError::Negative));
    }
    let rate = match input.gst_rate {
        Some(percent) => GstRate::from_percent(percent).map_err(billing("gst_rate"))?,
        None => current
            .map(|c| GstRate::from_bps(c.tax_rate_bps))
            .transpose()
            .map_err(billing("gst_rate"))?
            .unwrap_or_default(),
    };
    let taxable = input
        .taxable
        .or(current.map(|c| c.taxable))
        .unwrap_or(rate != GstRate::Zero);
    if !taxable && rate != GstRate::Zero {
        return Err(AppError::invalid(
            "gst_rate",
            "must be 0 for an exempt item; set taxable to charge GST",
        ));
    }
    Ok(PriceItemFields {
        code,
        name,
        category,
        sac_hsn,
        price_paise,
        taxable,
        rate,
        active: input.active.or(current.map(|c| c.active)).unwrap_or(true),
    })
}

impl PriceItemFields {
    fn values(&self) -> PriceItemValues<'_> {
        PriceItemValues {
            code: self.code.as_deref(),
            name: &self.name,
            category: self.category.as_deref(),
            sac_hsn: self.sac_hsn.as_deref(),
            price_paise: self.price_paise,
            taxable: self.taxable,
            tax_rate_bps: i32::try_from(self.rate.bps()).unwrap_or(0),
            active: self.active,
        }
    }
}

fn code_taken(error: AppError) -> AppError {
    match error {
        AppError::Db(db) if db.constraint() == Some("price_items_code") => {
            AppError::Conflict("another price list entry has this code")
        }
        other => other,
    }
}

/// The price list.
///
/// # Errors
/// [`AppError::Denied`] without `billing.read`; [`AppError::Db`] on failures.
pub async fn price_items(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<PriceItemView>, AppError> {
    actor.require(Permission::BillingRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::price_items(tx.conn()).await?;
        Ok(rows.into_iter().map(PriceItemView::from).collect())
    })
    .await
}

/// Adds a price list entry.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for bad values;
/// [`AppError::Conflict`] for a taken code.
pub async fn create_price_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: PriceItemInput,
) -> Result<PriceItemView, AppError> {
    actor.require(Permission::SettingsManage)?;
    let fields = merge_price_item(None, input)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::insert_price_item(tx.conn(), PriceItemId::new_v7().uuid(), &fields.values())
            .await?;
        Ok(PriceItemView::from(row))
    })
    .await
    .map_err(code_taken)
}

/// Changes a price list entry. Bills already issued keep what they printed.
///
/// # Errors
/// As [`create_price_item`], and [`AppError::NotFound`] for an unknown entry.
pub async fn update_price_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PriceItemId,
    input: PriceItemInput,
) -> Result<PriceItemView, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::price_item(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("price item"))?;
        let fields = merge_price_item(Some(&current), input)?;
        let row = dal::update_price_item(tx.conn(), id.uuid(), &fields.values())
            .await?
            .ok_or(AppError::NotFound("price item"))?;
        Ok(PriceItemView::from(row))
    })
    .await
    .map_err(code_taken)
}

// ------------------------------------------------------------------ bills

/// A bill line as received: from a price list entry (whose values fill what is left out) or
/// free text.
#[derive(Debug, Clone, Default)]
pub struct LineInput {
    /// The price list entry.
    pub price_item_id: Option<Uuid>,
    /// The procedure it bills.
    pub procedure_id: Option<Uuid>,
    /// As printed; the entry's name by default.
    pub description: Option<String>,
    /// How many; 1 by default.
    pub quantity: Option<u32>,
    /// Price of one; the entry's price by default.
    pub unit_price_paise: Option<i64>,
    /// Discount on the line.
    pub discount_paise: Option<i64>,
    /// GST percentage; the entry's rate by default, 0 for free text.
    pub gst_rate: Option<u32>,
    /// SAC or HSN; the entry's by default.
    pub sac_hsn: Option<String>,
}

/// A new draft bill.
#[derive(Debug, Clone)]
pub struct DraftInvoice {
    /// The patient.
    pub patient_id: PatientId,
    /// The visit it bills.
    pub encounter_id: Option<Uuid>,
    /// GST state code of the place of supply, when not the branch's state.
    pub place_of_supply: Option<String>,
    /// Notes printed on the bill.
    pub notes: Option<String>,
    /// Lines.
    pub items: Vec<LineInput>,
    /// The voided bill this one replaces.
    pub replaces_invoice_id: Option<InvoiceId>,
}

/// Changes to a draft. `None` keeps a value; given items replace all lines.
#[derive(Debug, Clone, Default)]
pub struct InvoiceChanges {
    /// The visit; `Some(None)` clears it.
    pub encounter_id: Option<Option<Uuid>>,
    /// Place of supply; empty clears it.
    pub place_of_supply: Option<String>,
    /// Notes; empty clears them.
    pub notes: Option<String>,
    /// New lines.
    pub items: Option<Vec<LineInput>>,
}

/// A patient as a bill names them.
#[derive(Debug, Clone)]
pub struct PatientRef {
    /// Identifier.
    pub id: PatientId,
    /// Name.
    pub name: String,
    /// Number.
    pub number: String,
}

/// A bill's amounts.
#[derive(Debug, Clone, Copy, Default)]
pub struct Amounts {
    /// Gross.
    pub subtotal: Paise,
    /// Discounts.
    pub discount: Paise,
    /// Taxable value.
    pub taxable: Paise,
    /// CGST.
    pub cgst: Paise,
    /// SGST.
    pub sgst: Paise,
    /// IGST.
    pub igst: Paise,
    /// All GST.
    pub tax: Paise,
    /// Round-off.
    pub round_off: Paise,
    /// Total.
    pub total: Paise,
}

impl From<Totals> for Amounts {
    fn from(t: Totals) -> Self {
        Self {
            subtotal: t.subtotal,
            discount: t.discount,
            taxable: t.taxable,
            cgst: t.cgst,
            sgst: t.sgst,
            igst: t.igst,
            tax: t.tax,
            round_off: t.round_off,
            total: t.total,
        }
    }
}

/// A bill line as the API shows it.
#[derive(Debug, Clone)]
pub struct LineView {
    /// Position.
    pub line_no: i16,
    /// Price list entry.
    pub price_item_id: Option<Uuid>,
    /// Procedure.
    pub procedure_id: Option<Uuid>,
    /// As printed.
    pub description: String,
    /// SAC or HSN.
    pub sac_hsn: Option<String>,
    /// How many.
    pub quantity: i32,
    /// Price of one.
    pub unit_price: Paise,
    /// Discount.
    pub discount: Paise,
    /// GST percentage.
    pub gst_rate: u32,
    /// The line's amounts (a preview on drafts).
    pub amounts: LineAmounts,
}

/// A bill as the API shows it.
#[derive(Debug, Clone)]
pub struct InvoiceView {
    /// Identifier.
    pub id: InvoiceId,
    /// Number, once issued.
    pub number: Option<String>,
    /// The patient.
    pub patient: PatientRef,
    /// Document state.
    pub status: InvoiceStatus,
    /// How much is paid, for issued bills.
    pub payment_state: Option<PaymentState>,
    /// Tax invoice or bill of supply, once issued.
    pub doc_type: Option<String>,
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// Place of supply.
    pub place_of_supply: Option<String>,
    /// Notes.
    pub notes: Option<String>,
    /// When issued.
    pub issued_at: Option<OffsetDateTime>,
    /// Supplier as printed.
    pub supplier: Option<Value>,
    /// Patient as printed.
    pub recipient: Option<Value>,
    /// Amounts: stored once issued, a preview on drafts.
    pub amounts: Amounts,
    /// Paid so far.
    pub paid: Paise,
    /// Left to pay on an issued bill.
    pub balance: Paise,
    /// Methods of the payments towards it.
    pub methods: Vec<String>,
    /// The voided bill this one replaces.
    pub replaces_invoice_id: Option<Uuid>,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<OffsetDateTime>,
    /// When the draft was started.
    pub created_at: OffsetDateTime,
    /// Lines (empty in lists).
    pub lines: Vec<LineView>,
}

fn invoice_view(
    row: dal::InvoiceRow,
    lines: Vec<LineView>,
    preview: Option<Totals>,
) -> InvoiceView {
    let status = InvoiceStatus::parse(&row.status).unwrap_or(InvoiceStatus::Draft);
    let stored = Amounts {
        subtotal: Paise::new(row.subtotal_paise),
        discount: Paise::new(row.discount_paise),
        taxable: Paise::new(row.taxable_paise),
        cgst: Paise::new(row.cgst_paise),
        sgst: Paise::new(row.sgst_paise),
        igst: Paise::new(row.igst_paise),
        tax: Paise::new(row.tax_paise),
        round_off: Paise::new(row.round_off_paise),
        total: Paise::new(row.total_paise),
    };
    let amounts = preview.map_or(stored, Amounts::from);
    let paid = Paise::new(row.paid_paise);
    let issued = status == InvoiceStatus::Issued;
    let balance = if issued {
        Paise::new((row.total_paise - row.paid_paise).max(0))
    } else {
        Paise::ZERO
    };
    InvoiceView {
        id: InvoiceId::from_uuid(row.id),
        number: row.number,
        patient: PatientRef {
            id: PatientId::from_uuid(row.patient_id),
            name: row.patient_name,
            number: row.patient_number,
        },
        status,
        payment_state: issued.then(|| PaymentState::of(stored.total, paid)),
        doc_type: row.doc_type,
        encounter_id: row.encounter_id,
        place_of_supply: row.place_of_supply,
        notes: row.notes,
        issued_at: row.issued_at,
        supplier: row.supplier,
        recipient: row.recipient,
        amounts,
        paid,
        balance,
        methods: row.methods,
        replaces_invoice_id: row.replaces_invoice_id,
        void_reason: row.void_reason,
        voided_at: row.voided_at,
        created_at: row.created_at,
        lines,
    }
}

fn place_of_supply(text: Option<&str>) -> Result<Option<String>, AppError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => StateCode::parse(text)
            .map(|code| Some(code.as_str().to_owned()))
            .map_err(billing("place_of_supply")),
    }
}

/// Builds the draft lines, filling defaults from the price list.
async fn build_lines(
    tx: &mut ScopedTx,
    items: Vec<LineInput>,
) -> Result<Vec<InvoiceLineRow>, AppError> {
    if items.len() > 200 {
        return Err(AppError::invalid("items", "at most 200 lines"));
    }
    let mut lines = Vec::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        let entry =
            match item.price_item_id {
                Some(id) => Some(dal::price_item(tx.conn(), id).await?.ok_or(
                    AppError::invalid("items.price_item_id", "is not on the price list"),
                )?),
                None => None,
            };
        let description = item
            .description
            .or_else(|| entry.as_ref().map(|e| e.name.clone()))
            .unwrap_or_default();
        let description = trimmed(Some(&description), "items.description", 300)?.ok_or(
            AppError::invalid("items.description", "is required for a free-text line"),
        )?;
        let unit_price = item
            .unit_price_paise
            .or_else(|| entry.as_ref().map(|e| e.price_paise))
            .ok_or(AppError::invalid(
                "items.unit_price_paise",
                "is required for a free-text line",
            ))?;
        let rate = match item.gst_rate {
            Some(percent) => GstRate::from_percent(percent).map_err(billing("items.gst_rate"))?,
            None => entry
                .as_ref()
                .map(|e| GstRate::from_bps(e.tax_rate_bps))
                .transpose()
                .map_err(billing("items.gst_rate"))?
                .unwrap_or_default(),
        };
        let sac_hsn = trimmed(
            item.sac_hsn
                .or_else(|| entry.as_ref().and_then(|e| e.sac_hsn.clone()))
                .as_deref(),
            "items.sac_hsn",
            8,
        )?;
        let sac_hsn = pattern(sac_hsn, "items.sac_hsn", is_sac_hsn)?;
        let line = Line {
            quantity: item.quantity.unwrap_or(1),
            unit_price: Paise::new(unit_price),
            discount: Paise::new(item.discount_paise.unwrap_or(0)),
            rate,
        };
        line.check().map_err(billing("items"))?;
        lines.push(InvoiceLineRow {
            id: Uuid::now_v7(),
            line_no: i16::try_from(index + 1).unwrap_or(i16::MAX),
            price_item_id: entry.as_ref().map(|e| e.id),
            procedure_id: item.procedure_id,
            description,
            sac_hsn,
            category: entry.and_then(|e| e.category),
            quantity: i32::try_from(line.quantity).unwrap_or(i32::MAX),
            unit_price_paise: unit_price,
            discount_paise: line.discount.get(),
            tax_rate_bps: i32::try_from(rate.bps()).unwrap_or(0),
            taxable_paise: 0,
            cgst_paise: 0,
            sgst_paise: 0,
            igst_paise: 0,
            total_paise: 0,
        });
    }
    Ok(lines)
}

/// How a clinic charges GST, from its settings.
struct TaxSetup {
    registered: bool,
    branch_state: Option<StateCode>,
}

impl TaxSetup {
    fn of(supplier: &dal::SupplierRow) -> Self {
        let gstin = supplier
            .branch_gstin
            .as_deref()
            .or(supplier.org_gstin.as_deref());
        let branch_state = supplier
            .state_code
            .as_deref()
            .and_then(|code| StateCode::parse(code).ok())
            .or_else(|| gstin.and_then(StateCode::of_gstin));
        Self {
            registered: gstin.is_some(),
            branch_state,
        }
    }

    /// Computes each line and the totals. An unregistered clinic charges no GST.
    fn compute(
        &self,
        place: Option<&str>,
        lines: &mut [InvoiceLineRow],
    ) -> Result<(Totals, bool), AppError> {
        let place = place.and_then(|code| StateCode::parse(code).ok());
        let supply = Supply::decide(self.branch_state, place);
        let mut amounts = Vec::with_capacity(lines.len());
        let mut any_taxed = false;
        for row in lines.iter_mut() {
            let rate = if self.registered {
                GstRate::from_bps(row.tax_rate_bps).map_err(billing("items.gst_rate"))?
            } else {
                GstRate::Zero
            };
            any_taxed |= rate != GstRate::Zero;
            let line = Line {
                quantity: u32::try_from(row.quantity).unwrap_or(0),
                unit_price: Paise::new(row.unit_price_paise),
                discount: Paise::new(row.discount_paise),
                rate,
            };
            let computed = line.amounts(supply).map_err(billing("items"))?;
            row.tax_rate_bps = i32::try_from(rate.bps()).unwrap_or(0);
            row.taxable_paise = computed.taxable.get();
            row.cgst_paise = computed.cgst.get();
            row.sgst_paise = computed.sgst.get();
            row.igst_paise = computed.igst.get();
            row.total_paise = computed.total.get();
            amounts.push(computed);
        }
        Ok((totals(&amounts).map_err(billing("items"))?, any_taxed))
    }
}

fn line_view(row: &InvoiceLineRow) -> LineView {
    LineView {
        line_no: row.line_no,
        price_item_id: row.price_item_id,
        procedure_id: row.procedure_id,
        description: row.description.clone(),
        sac_hsn: row.sac_hsn.clone(),
        quantity: row.quantity,
        unit_price: Paise::new(row.unit_price_paise),
        discount: Paise::new(row.discount_paise),
        gst_rate: GstRate::from_bps(row.tax_rate_bps).map_or(0, GstRate::percent),
        amounts: LineAmounts {
            gross: Paise::new(row.unit_price_paise.saturating_mul(i64::from(row.quantity))),
            discount: Paise::new(row.discount_paise),
            taxable: Paise::new(row.taxable_paise),
            cgst: Paise::new(row.cgst_paise),
            sgst: Paise::new(row.sgst_paise),
            igst: Paise::new(row.igst_paise),
            total: Paise::new(row.total_paise),
        },
    }
}

/// Loads a bill with its lines; drafts get a preview of their amounts.
async fn load(tx: &mut ScopedTx, id: Uuid) -> Result<InvoiceView, AppError> {
    let row = dal::invoices(
        tx.conn(),
        &InvoiceFilter {
            id: Some(id),
            limit: 1,
            ..InvoiceFilter::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .ok_or(AppError::NotFound("invoice"))?;
    let mut lines = dal::invoice_lines(tx.conn(), id).await?;
    let preview = if row.status == InvoiceStatus::Draft.as_str() {
        let supplier = dal::supplier(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let (totals, _) =
            TaxSetup::of(&supplier).compute(row.place_of_supply.as_deref(), &mut lines)?;
        Some(totals)
    } else {
        None
    };
    let lines = lines.iter().map(line_view).collect();
    Ok(invoice_view(row, lines, preview))
}

/// Starts a draft bill for a patient.
///
/// # Errors
/// [`AppError::Denied`] without `billing.write`; [`AppError::NotFound`] for an unknown
/// patient; [`AppError::Invalid`] for bad lines.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: DraftInvoice,
) -> Result<InvoiceView, AppError> {
    actor.require(Permission::BillingWrite)?;
    let place = place_of_supply(input.place_of_supply.as_deref())?;
    let notes = trimmed(input.notes.as_deref(), "notes", 1000)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        create_in(tx, input, place.as_deref(), notes.as_deref()).await
    })
    .await
}

/// [`create`] inside the caller's clinic transaction, with the place of supply and notes already
/// checked.
pub(crate) async fn create_in(
    tx: &mut ScopedTx,
    input: DraftInvoice,
    place: Option<&str>,
    notes: Option<&str>,
) -> Result<InvoiceView, AppError> {
    patients::get(tx.conn(), input.patient_id.uuid(), None)
        .await?
        .ok_or(AppError::NotFound("patient"))?;
    if let Some(replaced) = input.replaces_invoice_id {
        let found = dal::lock_invoices(tx.conn(), &[replaced.uuid()]).await?;
        match found.first() {
            Some(old) if old.patient_id == input.patient_id.uuid() && old.status == "void" => {}
            Some(_) => {
                return Err(AppError::invalid(
                    "replaces_invoice_id",
                    "must be a voided bill of the same patient",
                ));
            }
            None => return Err(AppError::NotFound("invoice")),
        }
    }
    let supplier = dal::supplier(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    let branch_id = supplier
        .branch_id
        .ok_or(AppError::Conflict("the clinic has no branch to bill from"))?;
    let lines = build_lines(tx, input.items).await?;
    let id = InvoiceId::new_v7().uuid();
    dal::insert_invoice(
        tx.conn(),
        &dal::NewInvoice {
            id,
            patient_id: input.patient_id.uuid(),
            encounter_id: input.encounter_id,
            branch_id,
            place_of_supply: place,
            notes,
            replaces_invoice_id: input.replaces_invoice_id.map(InvoiceId::uuid),
        },
    )
    .await
    .map_err(|error| match error.constraint() {
        Some("invoices_replaces") => AppError::Conflict("that bill was already replaced"),
        _ => error.into(),
    })?;
    for line in &lines {
        dal::insert_line(tx.conn(), id, line).await?;
    }
    load(tx, id).await
}

/// Edits a draft bill.
///
/// # Errors
/// As [`create`], and [`AppError::Conflict`] once the bill is issued or void.
pub async fn edit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InvoiceId,
    changes: InvoiceChanges,
) -> Result<InvoiceView, AppError> {
    actor.require(Permission::BillingWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::lock_invoices(tx.conn(), &[id.uuid()]).await?;
        let current = load(tx, id.uuid()).await?;
        if current.status != InvoiceStatus::Draft {
            return Err(AppError::Conflict(
                "only a draft bill can be edited; void it and bill again",
            ));
        }
        let place = match changes.place_of_supply.as_deref() {
            Some(text) => place_of_supply(Some(text))?,
            None => current.place_of_supply,
        };
        let notes = match changes.notes.as_deref() {
            Some(text) => trimmed(Some(text), "notes", 1000)?,
            None => current.notes,
        };
        let encounter_id = changes.encounter_id.unwrap_or(current.encounter_id);
        dal::update_draft(
            tx.conn(),
            id.uuid(),
            encounter_id,
            place.as_deref(),
            notes.as_deref(),
        )
        .await?;
        if let Some(items) = changes.items {
            let lines = build_lines(tx, items).await?;
            dal::clear_draft_lines(tx.conn(), id.uuid()).await?;
            for line in &lines {
                dal::insert_line(tx.conn(), id.uuid(), line).await?;
            }
        }
        load(tx, id.uuid()).await
    })
    .await
}

/// Issues a draft: computes GST per line, rounds to the rupee, numbers it in the clinic's
/// financial year (`SD/26-27/000318`), and snapshots the supplier and patient. From here on
/// it never changes.
///
/// # Errors
/// [`AppError::Denied`] without `billing.write`; [`AppError::NotFound`] for an unknown bill;
/// [`AppError::Conflict`] when not a draft; [`AppError::Invalid`] with no lines.
pub async fn issue(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InvoiceId,
    now: OffsetDateTime,
) -> Result<InvoiceView, AppError> {
    actor.require(Permission::BillingWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let locked = dal::lock_invoices(tx.conn(), &[id.uuid()])
            .await?
            .into_iter()
            .next()
            .ok_or(AppError::NotFound("invoice"))?;
        if locked.status != InvoiceStatus::Draft.as_str() {
            return Err(AppError::Conflict("this bill is already issued or void"));
        }
        let mut lines = dal::invoice_lines(tx.conn(), id.uuid()).await?;
        if lines.is_empty() {
            return Err(AppError::invalid(
                "items",
                "add at least one line before issuing",
            ));
        }
        let supplier = dal::supplier(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let setup = TaxSetup::of(&supplier);
        let (totals, any_taxed) = setup.compute(locked.place_of_supply.as_deref(), &mut lines)?;
        for line in &lines {
            dal::set_line_amounts(tx.conn(), line).await?;
        }
        let year = FinancialYear::of(clinic_today(&supplier.timezone, now));
        let label = year.label();
        let serial = dal::next_number(tx.conn(), "invoice", &label).await?;
        let serial = u64::try_from(serial).map_err(|_| AppError::Internal("negative serial"))?;
        let number =
            serial_number(&supplier.number_prefix, year, serial).map_err(billing("number"))?;
        let patient = patients::get(tx.conn(), locked.patient_id, None)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let gstin = supplier.branch_gstin.clone().or(supplier.org_gstin.clone());
        let supplier_json = json!({
            "name": supplier.name,
            "legal_name": supplier.legal_name.clone().unwrap_or_else(|| supplier.name.clone()),
            "gstin": gstin,
            "state_code": setup.branch_state.map(|code| code.as_str().to_owned()),
            "address": supplier.address,
            "phone": supplier.phone_e164,
        });
        let recipient = json!({ "name": patient.full_name, "number": patient.number });
        dal::issue(
            tx.conn(),
            id.uuid(),
            &dal::IssuedInvoice {
                number: &number,
                financial_year: &label,
                doc_type: DocType::decide(setup.registered, any_taxed).as_str(),
                issued_at: now,
                issued_by: actor.membership_id.uuid(),
                supplier: supplier_json,
                recipient,
                subtotal_paise: totals.subtotal.get(),
                discount_paise: totals.discount.get(),
                taxable_paise: totals.taxable.get(),
                cgst_paise: totals.cgst.get(),
                sgst_paise: totals.sgst.get(),
                igst_paise: totals.igst.get(),
                tax_paise: totals.tax.get(),
                round_off_paise: totals.round_off.get(),
                total_paise: totals.total.get(),
            },
        )
        .await?;
        load(tx, id.uuid()).await
    })
    .await
}

/// A reason for voiding, 3 to 500 characters.
pub(crate) fn void_reason(text: &str) -> Result<String, AppError> {
    let text = text.trim();
    if (3..=500).contains(&text.chars().count()) {
        Ok(text.to_owned())
    } else {
        Err(AppError::invalid(
            "reason",
            "give a reason of 3 to 500 characters",
        ))
    }
}

/// Voids a bill with a reason. It is kept, with its number; a bill with payments counting
/// towards it is voided only after those payments are.
///
/// # Errors
/// [`AppError::Denied`] without `billing.write`; [`AppError::NotFound`]; [`AppError::Conflict`]
/// when already void or still paid; [`AppError::Invalid`] without a reason.
pub async fn void(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InvoiceId,
    reason: &str,
    now: OffsetDateTime,
) -> Result<InvoiceView, AppError> {
    actor.require(Permission::BillingWrite)?;
    let reason = void_reason(reason)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let locked = dal::lock_invoices(tx.conn(), &[id.uuid()])
            .await?
            .into_iter()
            .next()
            .ok_or(AppError::NotFound("invoice"))?;
        if locked.status == InvoiceStatus::Void.as_str() {
            return Err(AppError::Conflict("this bill is already void"));
        }
        if locked.paid_paise > 0 {
            return Err(AppError::Conflict(
                "void the payments towards this bill first",
            ));
        }
        dal::void_invoice(
            tx.conn(),
            id.uuid(),
            &reason,
            now,
            actor.membership_id.uuid(),
        )
        .await?;
        load(tx, id.uuid()).await
    })
    .await
}

/// Opens a bill and writes the access record.
///
/// # Errors
/// [`AppError::Denied`] without `billing.read`; [`AppError::NotFound`].
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InvoiceId,
) -> Result<InvoiceView, AppError> {
    actor.require(Permission::BillingRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let view = load(tx, id.uuid()).await?;
        let request_text = request_id.map(|id| id.to_string());
        access::record(
            tx.conn(),
            &access::DocumentAccess {
                actor_user_id: Some(actor.user_id.uuid()),
                actor_kind: crate::scope::actor_kind(actor).as_str(),
                patient_id: view.patient.id.uuid(),
                share_link_id: None,
                resource: "invoice",
                resource_id: id.uuid(),
                action: "view",
                purpose: if actor.role_key == "front_desk" {
                    "front_desk"
                } else {
                    "billing"
                },
                request_id: request_text.as_deref(),
            },
        )
        .await?;
        Ok(view)
    })
    .await
}

/// A way for the patient to pay an issued bill: the clinic's UPI link for what is left.
#[derive(Debug, Clone)]
pub struct UpiLink {
    /// The `upi://pay` link; also the text to encode in a QR code.
    pub uri: String,
    /// The clinic's UPI ID, as set in settings.
    pub upi_id: String,
    /// Who the payment goes to (the clinic's name).
    pub payee_name: String,
    /// The bill number, sent as the payment note.
    pub invoice_number: String,
    /// What is left to pay.
    pub amount: Paise,
}

/// The UPI payment link for an issued bill's balance. Nothing is recorded: the front desk
/// records the payment as usual once it arrives.
///
/// # Errors
/// [`AppError::Denied`] without `billing.read`; [`AppError::NotFound`];
/// [`AppError::Conflict`] unless the bill is issued with a balance and the clinic has a UPI ID.
pub async fn upi_link(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InvoiceId,
) -> Result<UpiLink, AppError> {
    actor.require(Permission::BillingRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let view = load(tx, id.uuid()).await?;
        let (InvoiceStatus::Issued, Some(number)) = (view.status, view.number) else {
            return Err(AppError::Conflict("only an issued bill can be paid"));
        };
        if view.balance <= Paise::ZERO {
            return Err(AppError::Conflict("the bill has nothing left to pay"));
        }
        let clinic = aarogyam_dal::settings::get(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let upi_id = clinic
            .billing
            .get("upi_id")
            .and_then(Value::as_str)
            .filter(|upi_id| !upi_id.is_empty())
            .ok_or(AppError::Conflict(
                "the clinic has no UPI ID in its settings",
            ))?
            .to_owned();
        Ok(UpiLink {
            uri: aarogyam_domain::upi::pay_link(&upi_id, &clinic.name, view.balance.get(), &number),
            upi_id,
            payee_name: clinic.name,
            invoice_number: number,
            amount: view.balance,
        })
    })
    .await
}

/// Which bills to list.
#[derive(Debug, Clone, Copy, Default)]
pub struct InvoiceQuery {
    /// Document state.
    pub status: Option<InvoiceStatus>,
    /// Issued (or started) on or after this clinic day.
    pub from: Option<Date>,
    /// Issued (or started) on or before this clinic day.
    pub to: Option<Date>,
    /// One patient's bills.
    pub patient_id: Option<PatientId>,
    /// Most rows, 1 to 200.
    pub limit: i64,
}

/// Bills, newest first.
///
/// # Errors
/// [`AppError::Denied`] without `billing.read`; [`AppError::Db`] on failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    query: InvoiceQuery,
) -> Result<Vec<InvoiceView>, AppError> {
    actor.require(Permission::BillingRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let from = query.from.map(|day| day_range(&actor.timezone, day, day).0);
        let to = query.to.map(|day| day_range(&actor.timezone, day, day).1);
        let rows = dal::invoices(
            tx.conn(),
            &InvoiceFilter {
                status: query.status.map(InvoiceStatus::as_str),
                patient_id: query.patient_id.map(PatientId::uuid),
                from,
                to,
                limit: query.limit.clamp(1, 200),
                ..InvoiceFilter::default()
            },
        )
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| invoice_view(row, Vec::new(), None))
            .collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn supplier(org_gstin: Option<&str>, state: Option<&str>) -> dal::SupplierRow {
        dal::SupplierRow {
            name: "Alpha".into(),
            legal_name: None,
            org_gstin: org_gstin.map(Into::into),
            number_prefix: "AD".into(),
            timezone: "Asia/Kolkata".into(),
            branch_id: None,
            branch_gstin: None,
            state_code: state.map(Into::into),
            address: None,
            phone_e164: None,
        }
    }

    fn row(quantity: i32, unit: i64, rate_bps: i32) -> InvoiceLineRow {
        InvoiceLineRow {
            id: Uuid::nil(),
            line_no: 1,
            price_item_id: None,
            procedure_id: None,
            description: "x".into(),
            sac_hsn: None,
            category: None,
            quantity,
            unit_price_paise: unit,
            discount_paise: 0,
            tax_rate_bps: rate_bps,
            taxable_paise: 0,
            cgst_paise: 0,
            sgst_paise: 0,
            igst_paise: 0,
            total_paise: 0,
        }
    }

    #[test]
    fn unregistered_clinics_charge_no_gst_and_place_of_supply_picks_igst() {
        let mut lines = [row(1, 10_000, 1800)];
        let (totals, taxed) = TaxSetup::of(&supplier(None, None))
            .compute(None, &mut lines)
            .unwrap();
        assert!(!taxed);
        assert_eq!(totals.total, Paise::new(10_000));
        assert_eq!(lines[0].tax_rate_bps, 0);

        let registered = TaxSetup::of(&supplier(Some("27AAPFU0939F1ZV"), None));
        let mut lines = [row(1, 10_000, 1800)];
        let (totals, taxed) = registered.compute(Some("29"), &mut lines).unwrap();
        assert!(taxed);
        assert_eq!((totals.igst, totals.cgst), (Paise::new(1_800), Paise::ZERO));
        let mut lines = [row(1, 10_000, 1800)];
        let (totals, _) = registered.compute(None, &mut lines).unwrap();
        assert_eq!(
            (totals.cgst, totals.sgst),
            (Paise::new(900), Paise::new(900))
        );
    }

    #[test]
    fn price_items_are_validated() {
        let exempt_with_rate = PriceItemInput {
            name: Some("Scaling".into()),
            price_paise: Some(100_000),
            taxable: Some(false),
            gst_rate: Some(18),
            ..PriceItemInput::default()
        };
        assert!(matches!(
            merge_price_item(None, exempt_with_rate),
            Err(AppError::Invalid {
                field: "gst_rate",
                ..
            })
        ));
        let paste = PriceItemInput {
            name: Some(" Toothpaste ".into()),
            code: Some("TP-1".into()),
            category: Some("Products".into()),
            sac_hsn: Some("3306".into()),
            price_paise: Some(14_999),
            gst_rate: Some(18),
            ..PriceItemInput::default()
        };
        let fields = merge_price_item(None, paste).unwrap();
        assert!(fields.taxable);
        assert_eq!(fields.name, "Toothpaste");
        assert_eq!(fields.category.as_deref(), Some("products"));
        let bad_code = PriceItemInput {
            name: Some("X".into()),
            code: Some("a b".into()),
            price_paise: Some(1),
            ..PriceItemInput::default()
        };
        assert!(matches!(
            merge_price_item(None, bad_code),
            Err(AppError::Invalid { field: "code", .. })
        ));
    }
}
