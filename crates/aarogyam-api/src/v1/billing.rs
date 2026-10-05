//! The price list and bills.

use aarogyam_app::billing::{
    self as app, DraftInvoice, InvoiceChanges, InvoiceQuery, InvoiceView, LineInput,
    PriceItemInput, PriceItemView,
};
use aarogyam_domain::billing::InvoiceStatus;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{InvoiceId, PatientId, PriceItemId};
use aarogyam_domain::permission::require::{BillingRead, BillingWrite, SettingsManage};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{optional_uuid, parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A price list entry.
#[derive(Debug, Serialize, ToSchema)]
pub struct PriceItem {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Short code, unique in the clinic.
    pub code: Option<String>,
    /// Name, as printed on bills.
    pub name: String,
    /// Revenue-mix category, such as `endodontics` or `medicines`.
    pub category: Option<String>,
    /// SAC (9993 for health care) or HSN code.
    pub sac_hsn: Option<String>,
    /// Default price in paise.
    pub price_paise: i64,
    /// Whether GST applies. Health care by a clinical establishment is exempt.
    pub taxable: bool,
    /// GST percentage: 0, 5, 12 or 18.
    pub gst_rate: u32,
    /// Offered.
    pub active: bool,
}

impl From<PriceItemView> for PriceItem {
    fn from(view: PriceItemView) -> Self {
        Self {
            id: view.id.uuid(),
            code: view.code,
            name: view.name,
            category: view.category,
            sac_hsn: view.sac_hsn,
            price_paise: view.price.get(),
            taxable: view.taxable,
            gst_rate: view.gst_rate,
            active: view.active,
        }
    }
}

/// The price list.
#[derive(Debug, Serialize, ToSchema)]
pub struct PriceItemList {
    /// Entries by name.
    pub items: Vec<PriceItem>,
}

/// A price list entry's values. On a change, fields left out stay as they are and an empty
/// string clears an optional one.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PriceItemValues {
    /// Short code: letters, digits, `-` and `_`.
    pub code: Option<String>,
    /// Name; required for a new entry.
    pub name: Option<String>,
    /// Revenue-mix category: lower case, digits and `_`.
    pub category: Option<String>,
    /// SAC or HSN: 4 to 8 digits.
    pub sac_hsn: Option<String>,
    /// Default price in paise; required for a new entry.
    pub price_paise: Option<i64>,
    /// Whether GST applies (medicines and products); false (exempt) by default unless a rate
    /// is given.
    pub taxable: Option<bool>,
    /// GST percentage: 0, 5, 12 or 18.
    pub gst_rate: Option<u32>,
    /// Offered.
    pub active: Option<bool>,
}

impl From<PriceItemValues> for PriceItemInput {
    fn from(body: PriceItemValues) -> Self {
        Self {
            code: body.code,
            name: body.name,
            category: body.category,
            sac_hsn: body.sac_hsn,
            price_paise: body.price_paise,
            taxable: body.taxable,
            gst_rate: body.gst_rate,
            active: body.active,
        }
    }
}

/// The clinic's price list.
#[utoipa::path(
    get,
    path = "/api/v1/price-items",
    operation_id = "listPriceItems",
    tag = "billing",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PriceItemList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn price_items(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingRead>,
) -> Result<Json<PriceItemList>, ApiFailure> {
    let items = app::price_items(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(PriceItemList {
        items: items.into_iter().map(PriceItem::from).collect(),
    }))
}

/// Adds a price list entry.
#[utoipa::path(
    post,
    path = "/api/v1/price-items",
    operation_id = "createPriceItem",
    tag = "billing",
    request_body = PriceItemValues,
    security(("bearer" = [])),
    responses(
        (status = 201, body = PriceItem),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 409, description = "Another entry has this code")
    )
)]
pub(crate) async fn create_price_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<PriceItemValues>,
) -> Result<(StatusCode, Json<PriceItem>), ApiFailure> {
    let view =
        app::create_price_item(state.db(), &request.actor, request.request_id, body.into()).await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Changes a price list entry. Issued bills keep what they printed.
#[utoipa::path(
    patch,
    path = "/api/v1/price-items/{id}",
    operation_id = "updatePriceItem",
    tag = "billing",
    params(("id" = String, Path, description = "The price list entry")),
    request_body = PriceItemValues,
    security(("bearer" = [])),
    responses(
        (status = 200, body = PriceItem),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such entry in this clinic"),
        (status = 409, description = "Another entry has this code")
    )
)]
pub(crate) async fn update_price_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PriceItemValues>,
) -> Result<Json<PriceItem>, ApiFailure> {
    let view = app::update_price_item(
        state.db(),
        &request.actor,
        request.request_id,
        PriceItemId::from_uuid(id),
        body.into(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// A patient as a bill or payment names them.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientRef {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Number, such as `SD-1042`.
    pub number: String,
}

impl From<app::PatientRef> for PatientRef {
    fn from(patient: app::PatientRef) -> Self {
        Self {
            id: patient.id.uuid(),
            name: patient.name,
            number: patient.number,
        }
    }
}

/// A bill line.
#[derive(Debug, Serialize, ToSchema)]
pub struct InvoiceLine {
    /// Position, from 1.
    pub line_no: i16,
    /// The price list entry.
    #[schema(value_type = Option<String>)]
    pub price_item_id: Option<Uuid>,
    /// The procedure it bills.
    #[schema(value_type = Option<String>)]
    pub procedure_id: Option<Uuid>,
    /// As printed.
    pub description: String,
    /// SAC or HSN.
    pub sac_hsn: Option<String>,
    /// How many.
    pub quantity: i32,
    /// Price of one, in paise.
    pub unit_price_paise: i64,
    /// Discount on the line.
    pub discount_paise: i64,
    /// GST percentage.
    pub gst_rate: u32,
    /// Taxable value.
    pub taxable_paise: i64,
    /// Central GST.
    pub cgst_paise: i64,
    /// State GST.
    pub sgst_paise: i64,
    /// Integrated GST.
    pub igst_paise: i64,
    /// Taxable value plus GST.
    pub total_paise: i64,
}

/// A bill. Amounts are paise; on drafts they are a preview computed from the current lines.
#[derive(Debug, Serialize, ToSchema)]
pub struct Invoice {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `SD/26-27/000318`, once issued.
    pub number: Option<String>,
    /// The patient.
    pub patient: PatientRef,
    /// `draft`, `issued` or `void`.
    pub status: String,
    /// For issued bills: `unpaid`, `partial` or `paid`, derived from payments.
    pub payment_state: Option<String>,
    /// `tax_invoice` or `bill_of_supply`, once issued.
    pub doc_type: Option<String>,
    /// The visit it bills.
    #[schema(value_type = Option<String>)]
    pub encounter_id: Option<Uuid>,
    /// Place of supply state code, when set.
    pub place_of_supply: Option<String>,
    /// Notes printed on the bill.
    pub notes: Option<String>,
    /// When issued (RFC 3339).
    pub issued_at: Option<String>,
    /// The clinic as printed: name, legal name, GSTIN, state code, address, phone.
    #[schema(value_type = Option<Object>)]
    pub supplier: Option<serde_json::Value>,
    /// The patient as printed: name and number.
    #[schema(value_type = Option<Object>)]
    pub recipient: Option<serde_json::Value>,
    /// Sum of quantity times unit price.
    pub subtotal_paise: i64,
    /// Sum of discounts.
    pub discount_paise: i64,
    /// What GST is charged on.
    pub taxable_paise: i64,
    /// Central GST.
    pub cgst_paise: i64,
    /// State GST.
    pub sgst_paise: i64,
    /// Integrated GST.
    pub igst_paise: i64,
    /// All GST.
    pub tax_paise: i64,
    /// Rounding to the rupee, -50 to 50.
    pub round_off_paise: i64,
    /// What the patient pays.
    pub total_paise: i64,
    /// Paid so far.
    pub paid_paise: i64,
    /// Left to pay on an issued bill.
    pub balance_paise: i64,
    /// Methods of the payments towards it.
    pub methods: Vec<String>,
    /// The voided bill this one replaces.
    #[schema(value_type = Option<String>)]
    pub replaces_invoice_id: Option<Uuid>,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<String>,
    /// When the draft was started.
    pub created_at: String,
    /// Lines; empty in lists.
    pub items: Vec<InvoiceLine>,
}

impl From<InvoiceView> for Invoice {
    fn from(view: InvoiceView) -> Self {
        let a = view.amounts;
        Self {
            id: view.id.uuid(),
            number: view.number,
            patient: view.patient.into(),
            status: view.status.as_str().to_owned(),
            payment_state: view.payment_state.map(|s| s.as_str().to_owned()),
            doc_type: view.doc_type,
            encounter_id: view.encounter_id,
            place_of_supply: view.place_of_supply,
            notes: view.notes,
            issued_at: view.issued_at.map(rfc3339),
            supplier: view.supplier,
            recipient: view.recipient,
            subtotal_paise: a.subtotal.get(),
            discount_paise: a.discount.get(),
            taxable_paise: a.taxable.get(),
            cgst_paise: a.cgst.get(),
            sgst_paise: a.sgst.get(),
            igst_paise: a.igst.get(),
            tax_paise: a.tax.get(),
            round_off_paise: a.round_off.get(),
            total_paise: a.total.get(),
            paid_paise: view.paid.get(),
            balance_paise: view.balance.get(),
            methods: view.methods,
            replaces_invoice_id: view.replaces_invoice_id,
            void_reason: view.void_reason,
            voided_at: view.voided_at.map(rfc3339),
            created_at: rfc3339(view.created_at),
            items: view
                .lines
                .into_iter()
                .map(|line| InvoiceLine {
                    line_no: line.line_no,
                    price_item_id: line.price_item_id,
                    procedure_id: line.procedure_id,
                    description: line.description,
                    sac_hsn: line.sac_hsn,
                    quantity: line.quantity,
                    unit_price_paise: line.unit_price.get(),
                    discount_paise: line.discount.get(),
                    gst_rate: line.gst_rate,
                    taxable_paise: line.amounts.taxable.get(),
                    cgst_paise: line.amounts.cgst.get(),
                    sgst_paise: line.amounts.sgst.get(),
                    igst_paise: line.amounts.igst.get(),
                    total_paise: line.amounts.total.get(),
                })
                .collect(),
        }
    }
}

/// Bills.
#[derive(Debug, Serialize, ToSchema)]
pub struct InvoiceList {
    /// Newest first.
    pub items: Vec<Invoice>,
}

/// A line on a draft: from a price list entry, whose values fill whatever is left out, or
/// free text with a description and a unit price.
#[derive(Debug, Deserialize, ToSchema)]
pub struct InvoiceLineInput {
    /// The price list entry.
    #[schema(value_type = Option<String>)]
    pub price_item_id: Option<Uuid>,
    /// The procedure it bills.
    #[schema(value_type = Option<String>)]
    pub procedure_id: Option<Uuid>,
    /// As printed.
    pub description: Option<String>,
    /// How many, 1 by default.
    pub quantity: Option<u32>,
    /// Price of one, in paise.
    pub unit_price_paise: Option<i64>,
    /// Discount on the whole line, in paise.
    pub discount_paise: Option<i64>,
    /// GST percentage: 0, 5, 12 or 18.
    pub gst_rate: Option<u32>,
    /// SAC or HSN.
    pub sac_hsn: Option<String>,
}

impl From<InvoiceLineInput> for LineInput {
    fn from(line: InvoiceLineInput) -> Self {
        Self {
            price_item_id: line.price_item_id,
            procedure_id: line.procedure_id,
            description: line.description,
            quantity: line.quantity,
            unit_price_paise: line.unit_price_paise,
            discount_paise: line.discount_paise,
            gst_rate: line.gst_rate,
            sac_hsn: line.sac_hsn,
        }
    }
}

/// A new draft bill.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewInvoice {
    /// The patient.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// The visit it bills.
    #[schema(value_type = Option<String>)]
    pub encounter_id: Option<Uuid>,
    /// GST state code of the place of supply, when not the branch's state (IGST applies).
    pub place_of_supply: Option<String>,
    /// Notes printed on the bill.
    pub notes: Option<String>,
    /// Lines.
    #[serde(default)]
    pub items: Vec<InvoiceLineInput>,
    /// The voided bill this one replaces.
    #[schema(value_type = Option<String>)]
    pub replaces_invoice_id: Option<Uuid>,
}

/// Changes to a draft. Fields left out stay; `items` replaces every line; an empty string
/// clears `encounter_id`, `place_of_supply` or `notes`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct InvoiceEdit {
    /// The visit it bills.
    pub encounter_id: Option<String>,
    /// Place of supply state code.
    pub place_of_supply: Option<String>,
    /// Notes.
    pub notes: Option<String>,
    /// New lines.
    pub items: Option<Vec<InvoiceLineInput>>,
}

/// A reason, for voiding or cancelling.
#[derive(Debug, Deserialize, ToSchema)]
pub struct Reason {
    /// Why, 3 to 500 characters.
    pub reason: String,
}

/// Starts a draft bill for a patient.
#[utoipa::path(
    post,
    path = "/api/v1/invoices",
    operation_id = "createInvoice",
    tag = "billing",
    request_body = NewInvoice,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Invoice),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn create_invoice(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingWrite>,
    ApiJson(body): ApiJson<NewInvoice>,
) -> Result<(StatusCode, Json<Invoice>), ApiFailure> {
    let input = DraftInvoice {
        patient_id: PatientId::from_uuid(body.patient_id),
        encounter_id: body.encounter_id,
        place_of_supply: body.place_of_supply,
        notes: body.notes,
        items: body.items.into_iter().map(LineInput::from).collect(),
        replaces_invoice_id: body.replaces_invoice_id.map(InvoiceId::from_uuid),
    };
    let view = app::create(state.db(), &request.actor, request.request_id, input).await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Edits a draft bill. Issued and void bills never change.
#[utoipa::path(
    patch,
    path = "/api/v1/invoices/{id}",
    operation_id = "updateInvoice",
    tag = "billing",
    params(("id" = String, Path, description = "The bill")),
    request_body = InvoiceEdit,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Invoice),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write"),
        (status = 404, description = "No such bill in this clinic"),
        (status = 409, description = "The bill is issued or void")
    )
)]
pub(crate) async fn edit_invoice(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<InvoiceEdit>,
) -> Result<Json<Invoice>, ApiFailure> {
    let changes = InvoiceChanges {
        encounter_id: body
            .encounter_id
            .map(|text| optional_uuid("encounter_id", &text))
            .transpose()?,
        place_of_supply: body.place_of_supply,
        notes: body.notes,
        items: body
            .items
            .map(|items| items.into_iter().map(LineInput::from).collect()),
    };
    let view = app::edit(
        state.db(),
        &request.actor,
        request.request_id,
        InvoiceId::from_uuid(id),
        changes,
    )
    .await?;
    Ok(Json(view.into()))
}

/// Issues a draft: GST per line (CGST and SGST, or IGST across states), round-off to the
/// rupee, a number in the clinic's financial year, and the printed facts captured. Final.
#[utoipa::path(
    post,
    path = "/api/v1/invoices/{id}/issue",
    operation_id = "issueInvoice",
    tag = "billing",
    params(("id" = String, Path, description = "The bill")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Invoice),
        (status = 400, description = "The bill has no lines"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write"),
        (status = 404, description = "No such bill in this clinic"),
        (status = 409, description = "Already issued or void")
    )
)]
pub(crate) async fn issue_invoice(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Invoice>, ApiFailure> {
    let view = app::issue(
        state.db(),
        &request.actor,
        request.request_id,
        InvoiceId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::InvoiceIssued.as_str(), invoice_id = %id, "invoice issued");
    Ok(Json(view.into()))
}

/// Voids a bill with a reason. It is kept with its number; bill again to correct it.
#[utoipa::path(
    post,
    path = "/api/v1/invoices/{id}/void",
    operation_id = "voidInvoice",
    tag = "billing",
    params(("id" = String, Path, description = "The bill")),
    request_body = Reason,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Invoice),
        (status = 400, description = "No reason given"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write"),
        (status = 404, description = "No such bill in this clinic"),
        (status = 409, description = "Already void, or payments still count towards it")
    )
)]
pub(crate) async fn void_invoice(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<Reason>,
) -> Result<Json<Invoice>, ApiFailure> {
    let view = app::void(
        state.db(),
        &request.actor,
        request.request_id,
        InvoiceId::from_uuid(id),
        &body.reason,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::InvoiceVoided.as_str(), invoice_id = %id, "invoice voided");
    Ok(Json(view.into()))
}

/// Opens a bill with its lines. Writes the access record.
#[utoipa::path(
    get,
    path = "/api/v1/invoices/{id}",
    operation_id = "getInvoice",
    tag = "billing",
    params(("id" = String, Path, description = "The bill")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Invoice),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.read"),
        (status = 404, description = "No such bill in this clinic")
    )
)]
pub(crate) async fn get_invoice(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Invoice>, ApiFailure> {
    let view = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        InvoiceId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Filters for the bill list.
#[derive(Debug, Deserialize)]
pub struct InvoiceParams {
    /// `draft`, `issued` or `void`.
    pub status: Option<String>,
    /// First clinic day (`YYYY-MM-DD`), by issue date (start date for drafts).
    pub from: Option<String>,
    /// Last clinic day, included.
    pub to: Option<String>,
    /// One patient's bills.
    pub patient_id: Option<Uuid>,
    /// Most rows, 1 to 200 (default 50).
    pub limit: Option<i64>,
}

/// Bills, newest first, without lines.
#[utoipa::path(
    get,
    path = "/api/v1/invoices",
    operation_id = "listInvoices",
    tag = "billing",
    params(
        ("status" = Option<String>, Query, description = "draft, issued or void"),
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD (issue date; start date for drafts)"),
        ("to" = Option<String>, Query, description = "Last clinic day, included"),
        ("patient_id" = Option<String>, Query, description = "One patient's bills"),
        ("limit" = Option<i64>, Query, description = "Most rows, 1 to 200 (default 50)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = InvoiceList),
        (status = 400, description = "A bad filter"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.read")
    )
)]
pub(crate) async fn list_invoices(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingRead>,
    ApiQuery(params): ApiQuery<InvoiceParams>,
) -> Result<Json<InvoiceList>, ApiFailure> {
    let status = params
        .status
        .as_deref()
        .map(|text| {
            InvoiceStatus::parse(text).map_err(|_| {
                ApiError::bad_request("invalid_request", "status: draft, issued or void")
            })
        })
        .transpose()?;
    let query = InvoiceQuery {
        status,
        from: params
            .from
            .as_deref()
            .map(|t| parse_day("from", t))
            .transpose()?,
        to: params
            .to
            .as_deref()
            .map(|t| parse_day("to", t))
            .transpose()?,
        patient_id: params.patient_id.map(PatientId::from_uuid),
        limit: params.limit.unwrap_or(50),
    };
    let rows = app::list(state.db(), &request.actor, request.request_id, query).await?;
    Ok(Json(InvoiceList {
        items: rows.into_iter().map(Invoice::from).collect(),
    }))
}
