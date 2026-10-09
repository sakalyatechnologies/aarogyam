//! A clinic's own dental terms: the list of what it added, renaming and retiring.

use aarogyam_app::dental_terms as app;
use aarogyam_dal::dental_terms::OwnTermRow;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::DentalTermId;
use aarogyam_domain::permission::require::{ClinicalRead, SettingsManage};
use axum::Json;
use axum::extract::State;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::{Require, RequireEither};
use crate::failure::ApiFailure;

/// A procedure or material the clinic added.
#[derive(Debug, Serialize, ToSchema)]
pub struct OwnDentalTerm {
    /// Identifier, as chart entries name it.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `procedure` or `material`.
    pub kind: String,
    /// The current label; old chart entries show it too.
    pub label: String,
    /// Who added it.
    pub added_by: Option<String>,
    /// When (RFC 3339).
    pub added_at: String,
    /// Retired: no longer offered for new entries.
    pub retired: bool,
    /// When it was retired (RFC 3339).
    pub retired_at: Option<String>,
    /// Who retired it.
    pub retired_by: Option<String>,
}

impl From<OwnTermRow> for OwnDentalTerm {
    fn from(row: OwnTermRow) -> Self {
        Self {
            id: row.id,
            kind: row.kind,
            label: row.label,
            added_by: row.added_by_name,
            added_at: rfc3339(row.created_at),
            retired: row.retired_at.is_some(),
            retired_at: row.retired_at.map(rfc3339),
            retired_by: row.retired_by_name,
        }
    }
}

/// The clinic's own terms.
#[derive(Debug, Serialize, ToSchema)]
pub struct OwnDentalTermList {
    /// By list, then label; retired ones included.
    pub items: Vec<OwnDentalTerm>,
}

/// A new label.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RenameDentalTerm {
    /// 1 to 80 characters.
    pub label: String,
}

/// The procedures and materials the clinic added, retired ones included.
#[utoipa::path(
    get,
    path = "/api/v1/dental-terms",
    operation_id = "listOwnDentalTerms",
    tag = "clinical",
    security(("bearer" = [])),
    responses(
        (status = 200, body = OwnDentalTermList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read and settings.manage")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<ClinicalRead, SettingsManage>,
) -> Result<Json<OwnDentalTermList>, ApiFailure> {
    let rows = app::own(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(OwnDentalTermList {
        items: rows.into_iter().map(OwnDentalTerm::from).collect(),
    }))
}

/// Gives a term a new label. Old chart entries show the new label; the change history keeps
/// the old one. To change what a term means, retire it and add a new one.
#[utoipa::path(
    patch,
    path = "/api/v1/dental-terms/{id}",
    operation_id = "renameDentalTerm",
    tag = "clinical",
    params(("id" = String, Path, description = "The clinic's term")),
    request_body = RenameDentalTerm,
    security(("bearer" = [])),
    responses(
        (status = 200, body = OwnDentalTerm),
        (status = 400, description = "A bad label"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such term in this clinic"),
        (status = 409, description = "The list already has that label, or it is a standard term")
    )
)]
pub(crate) async fn rename(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RenameDentalTerm>,
) -> Result<Json<OwnDentalTerm>, ApiFailure> {
    let id = DentalTermId::from_uuid(id);
    let row = app::rename(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        &body.label,
    )
    .await?;
    tracing::info!(event = Event::DentalTermRenamed.as_str(), term_id = %row.id, "dental term renamed");
    Ok(Json(row.into()))
}

async fn set_retired(
    state: &AppState,
    request: &crate::extract::ClinicRequest,
    id: Uuid,
    retire: bool,
) -> Result<Json<OwnDentalTerm>, ApiFailure> {
    let id = DentalTermId::from_uuid(id);
    let row = app::set_retired(state.db(), &request.actor, request.request_id, id, retire).await?;
    let event = if retire {
        Event::DentalTermRetired
    } else {
        Event::DentalTermRestored
    };
    tracing::info!(event = event.as_str(), term_id = %row.id, "dental term retirement changed");
    Ok(Json(row.into()))
}

/// Retires a term: it stays on old chart entries but is no longer offered for new ones.
/// Retiring twice keeps the first time. Adding the same label again brings it back.
#[utoipa::path(
    post,
    path = "/api/v1/dental-terms/{id}/retire",
    operation_id = "retireDentalTerm",
    tag = "clinical",
    params(("id" = String, Path, description = "The clinic's term")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = OwnDentalTerm),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such term in this clinic")
    )
)]
pub(crate) async fn retire(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<OwnDentalTerm>, ApiFailure> {
    set_retired(&state, &request, id, true).await
}

/// Offers a retired term for new entries again.
#[utoipa::path(
    post,
    path = "/api/v1/dental-terms/{id}/restore",
    operation_id = "restoreDentalTerm",
    tag = "clinical",
    params(("id" = String, Path, description = "The clinic's term")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = OwnDentalTerm),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such term in this clinic")
    )
)]
pub(crate) async fn restore(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<OwnDentalTerm>, ApiFailure> {
    set_retired(&state, &request, id, false).await
}
