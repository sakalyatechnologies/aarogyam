//! Outside labs and their contacts (`labs.read`, `labs.write`), and what each lab is owed
//! (`finance.view`).

use aarogyam_app::lab_payments::{self as payments, BalanceView};
use aarogyam_app::labs::{self as app, ContactInput, ContactView, VendorInput, VendorView};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{LabContactId, LabVendorId};
use aarogyam_domain::lab::{ContactChannel, LabKind};
use aarogyam_domain::permission::require::{FinanceView, LabsRead, LabsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// What kind of lab.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabVendorKind {
    /// Crowns, bridges, dentures, aligners.
    DentalLab,
    /// Blood and tissue tests.
    Pathology,
    /// Scans and X-rays.
    Radiology,
    /// Anything else.
    Other,
}

impl From<LabKind> for LabVendorKind {
    fn from(kind: LabKind) -> Self {
        match kind {
            LabKind::DentalLab => Self::DentalLab,
            LabKind::Pathology => Self::Pathology,
            LabKind::Radiology => Self::Radiology,
            LabKind::Other => Self::Other,
        }
    }
}

impl From<LabVendorKind> for LabKind {
    fn from(kind: LabVendorKind) -> Self {
        match kind {
            LabVendorKind::DentalLab => Self::DentalLab,
            LabVendorKind::Pathology => Self::Pathology,
            LabVendorKind::Radiology => Self::Radiology,
            LabVendorKind::Other => Self::Other,
        }
    }
}

/// How a lab contact likes to be reached. Only email is sent today.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabContactChannel {
    /// Email.
    Email,
    /// `WhatsApp`.
    Whatsapp,
    /// A phone call.
    Phone,
}

impl From<ContactChannel> for LabContactChannel {
    fn from(channel: ContactChannel) -> Self {
        match channel {
            ContactChannel::Email => Self::Email,
            ContactChannel::Whatsapp => Self::Whatsapp,
            ContactChannel::Phone => Self::Phone,
        }
    }
}

impl From<LabContactChannel> for ContactChannel {
    fn from(channel: LabContactChannel) -> Self {
        match channel {
            LabContactChannel::Email => Self::Email,
            LabContactChannel::Whatsapp => Self::Whatsapp,
            LabContactChannel::Phone => Self::Phone,
        }
    }
}

/// A person at a lab.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabContact {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The lab.
    #[schema(value_type = String)]
    pub vendor_id: Uuid,
    /// Name.
    pub name: String,
    /// What they do there.
    pub role: Option<String>,
    /// Phone in E.164.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    pub whatsapp: bool,
    /// How they like to be reached.
    pub preferred_channel: LabContactChannel,
}

impl From<ContactView> for LabContact {
    fn from(view: ContactView) -> Self {
        Self {
            id: view.id.uuid(),
            vendor_id: view.vendor_id.uuid(),
            name: view.name,
            role: view.role,
            phone: view.phone,
            email: view.email,
            whatsapp: view.whatsapp,
            preferred_channel: view.preferred_channel.into(),
        }
    }
}

/// An outside lab with its contacts.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabVendor {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// What kind of lab.
    pub kind: LabVendorKind,
    /// Phone in E.164.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Address.
    pub address: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// The people there, by name.
    pub contacts: Vec<LabContact>,
    /// When it was added (RFC 3339).
    pub created_at: String,
}

impl From<VendorView> for LabVendor {
    fn from(view: VendorView) -> Self {
        Self {
            id: view.id.uuid(),
            name: view.name,
            kind: view.kind.into(),
            phone: view.phone,
            email: view.email,
            address: view.address,
            note: view.note,
            contacts: view.contacts.into_iter().map(LabContact::from).collect(),
            created_at: rfc3339(view.created_at),
        }
    }
}

/// The clinic's labs.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabVendorList {
    /// By name.
    pub items: Vec<LabVendor>,
}

/// A lab's values. On a change, fields left out stay as they are and an empty string clears
/// an optional one.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LabVendorValues {
    /// Name, up to 120 characters; required for a new lab.
    pub name: Option<String>,
    /// What kind; a new lab is a dental lab unless said.
    pub kind: Option<LabVendorKind>,
    /// Phone; +91 is assumed without a country code.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Address, up to 500 characters.
    pub address: Option<String>,
    /// A note, up to 500 characters.
    pub note: Option<String>,
}

impl From<LabVendorValues> for VendorInput {
    fn from(body: LabVendorValues) -> Self {
        Self {
            name: body.name,
            kind: body.kind.map(LabKind::from),
            phone: body.phone,
            email: body.email,
            address: body.address,
            note: body.note,
        }
    }
}

/// A contact's values. On a change, fields left out stay as they are and an empty string
/// clears an optional one.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LabContactValues {
    /// Name, up to 120 characters; required for a new contact.
    pub name: Option<String>,
    /// What they do there, up to 80 characters.
    pub role: Option<String>,
    /// Phone; +91 is assumed without a country code.
    pub phone: Option<String>,
    /// Email; lab reminders go to it.
    pub email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    pub whatsapp: Option<bool>,
    /// How they like to be reached; must match a phone, email or `WhatsApp` given.
    pub preferred_channel: Option<LabContactChannel>,
}

impl From<LabContactValues> for ContactInput {
    fn from(body: LabContactValues) -> Self {
        Self {
            name: body.name,
            role: body.role,
            phone: body.phone,
            email: body.email,
            whatsapp: body.whatsapp,
            preferred_channel: body.preferred_channel.map(ContactChannel::from),
        }
    }
}

/// What a lab has billed and been paid.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabBalance {
    /// The lab.
    #[schema(value_type = String)]
    pub vendor_id: Uuid,
    /// Its name.
    pub name: String,
    /// Orders sent to it, not cancelled.
    pub orders: i64,
    /// Their items at the lab's prices, in paise (items without a price count as nothing).
    pub billed_paise: i64,
    /// Payments recorded, not void, in paise.
    pub paid_paise: i64,
    /// Billed less paid, in paise: still owed, or (below zero) paid ahead.
    pub due_paise: i64,
}

impl From<BalanceView> for LabBalance {
    fn from(view: BalanceView) -> Self {
        Self {
            vendor_id: view.vendor_id.uuid(),
            name: view.name,
            orders: view.orders,
            billed_paise: view.billed.get(),
            paid_paise: view.paid.get(),
            due_paise: view.due.get(),
        }
    }
}

/// The clinic's labs with their contacts.
#[utoipa::path(
    get,
    path = "/api/v1/lab-vendors",
    operation_id = "listLabVendors",
    tag = "labs",
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabVendorList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.read")
    )
)]
pub(crate) async fn list_vendors(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsRead>,
) -> Result<Json<LabVendorList>, ApiFailure> {
    let rows = app::vendors(state.db(), &request.actor, request.request_id, None).await?;
    Ok(Json(LabVendorList {
        items: rows.into_iter().map(LabVendor::from).collect(),
    }))
}

/// One lab with its contacts.
#[utoipa::path(
    get,
    path = "/api/v1/lab-vendors/{id}",
    operation_id = "getLabVendor",
    tag = "labs",
    params(("id" = String, Path, description = "The lab")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabVendor),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.read"),
        (status = 404, description = "No such lab in this clinic")
    )
)]
pub(crate) async fn get_vendor(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<LabVendor>, ApiFailure> {
    let id = Some(LabVendorId::from_uuid(id));
    let rows = app::vendors(state.db(), &request.actor, request.request_id, id).await?;
    let view = rows
        .into_iter()
        .next()
        .ok_or(aarogyam_app::error::AppError::NotFound("lab"))?;
    Ok(Json(view.into()))
}

/// Adds a lab.
#[utoipa::path(
    post,
    path = "/api/v1/lab-vendors",
    operation_id = "createLabVendor",
    tag = "labs",
    request_body = LabVendorValues,
    security(("bearer" = [])),
    responses(
        (status = 201, body = LabVendor),
        (status = 400, description = "Invalid values"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 409, description = "A lab has this name")
    )
)]
pub(crate) async fn create_vendor(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiJson(body): ApiJson<LabVendorValues>,
) -> Result<(StatusCode, Json<LabVendor>), ApiFailure> {
    let view =
        app::create_vendor(state.db(), &request.actor, request.request_id, body.into()).await?;
    tracing::info!(event = Event::LabChanged.as_str(), lab_vendor_id = %view.id.uuid(), "lab added");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Changes a lab.
#[utoipa::path(
    patch,
    path = "/api/v1/lab-vendors/{id}",
    operation_id = "updateLabVendor",
    tag = "labs",
    params(("id" = String, Path, description = "The lab")),
    request_body = LabVendorValues,
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabVendor),
        (status = 400, description = "Invalid values"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such lab in this clinic"),
        (status = 409, description = "A lab has this name")
    )
)]
pub(crate) async fn update_vendor(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LabVendorValues>,
) -> Result<Json<LabVendor>, ApiFailure> {
    let view = app::update_vendor(
        state.db(),
        &request.actor,
        request.request_id,
        LabVendorId::from_uuid(id),
        body.into(),
    )
    .await?;
    tracing::info!(event = Event::LabChanged.as_str(), lab_vendor_id = %id, "lab changed");
    Ok(Json(view.into()))
}

/// Removes a lab and its contacts from the lists; its orders and payments stay.
#[utoipa::path(
    delete,
    path = "/api/v1/lab-vendors/{id}",
    operation_id = "deleteLabVendor",
    tag = "labs",
    params(("id" = String, Path, description = "The lab")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such lab in this clinic")
    )
)]
pub(crate) async fn delete_vendor(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete_vendor(
        state.db(),
        &request.actor,
        request.request_id,
        LabVendorId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::LabChanged.as_str(), lab_vendor_id = %id, "lab removed");
    Ok(StatusCode::NO_CONTENT)
}

/// Adds a contact to a lab.
#[utoipa::path(
    post,
    path = "/api/v1/lab-vendors/{id}/contacts",
    operation_id = "createLabContact",
    tag = "labs",
    params(("id" = String, Path, description = "The lab")),
    request_body = LabContactValues,
    security(("bearer" = [])),
    responses(
        (status = 201, body = LabContact),
        (status = 400, description = "Invalid values"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such lab in this clinic")
    )
)]
pub(crate) async fn create_contact(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LabContactValues>,
) -> Result<(StatusCode, Json<LabContact>), ApiFailure> {
    let view = app::create_contact(
        state.db(),
        &request.actor,
        request.request_id,
        LabVendorId::from_uuid(id),
        body.into(),
    )
    .await?;
    tracing::info!(event = Event::LabChanged.as_str(), lab_contact_id = %view.id.uuid(), "lab contact added");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Changes a lab contact.
#[utoipa::path(
    patch,
    path = "/api/v1/lab-contacts/{id}",
    operation_id = "updateLabContact",
    tag = "labs",
    params(("id" = String, Path, description = "The contact")),
    request_body = LabContactValues,
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabContact),
        (status = 400, description = "Invalid values"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such contact in this clinic")
    )
)]
pub(crate) async fn update_contact(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LabContactValues>,
) -> Result<Json<LabContact>, ApiFailure> {
    let view = app::update_contact(
        state.db(),
        &request.actor,
        request.request_id,
        LabContactId::from_uuid(id),
        body.into(),
    )
    .await?;
    tracing::info!(event = Event::LabChanged.as_str(), lab_contact_id = %id, "lab contact changed");
    Ok(Json(view.into()))
}

/// Removes a lab contact.
#[utoipa::path(
    delete,
    path = "/api/v1/lab-contacts/{id}",
    operation_id = "deleteLabContact",
    tag = "labs",
    params(("id" = String, Path, description = "The contact")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such contact in this clinic")
    )
)]
pub(crate) async fn delete_contact(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete_contact(
        state.db(),
        &request.actor,
        request.request_id,
        LabContactId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::LabChanged.as_str(), lab_contact_id = %id, "lab contact removed");
    Ok(StatusCode::NO_CONTENT)
}

/// What a lab has billed and been paid.
#[utoipa::path(
    get,
    path = "/api/v1/lab-vendors/{id}/balance",
    operation_id = "getLabBalance",
    tag = "labs",
    params(("id" = String, Path, description = "The lab")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabBalance),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view"),
        (status = 404, description = "No such lab in this clinic")
    )
)]
pub(crate) async fn balance(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<LabBalance>, ApiFailure> {
    let view = payments::balance(
        state.db(),
        &request.actor,
        request.request_id,
        LabVendorId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}
