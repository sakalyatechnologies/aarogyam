//! A clinic's own medicine sets: several medicines added to a prescription in one tap, beside the
//! specialty's compiled-in ones (which `GET /quick-picks` lists too).

use aarogyam_app::medicine_sets::{self as app, SetInput, SetView};
use aarogyam_domain::ids::MedicineSetId;
use aarogyam_domain::permission::require::{ClinicalRead, PrescriptionsIssue};
use aarogyam_domain::quick_picks::SetMedicine;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::quick_picks::QuickSetMedicine;
use super::rfc3339;
use crate::AppState;
use crate::extract::{Require, RequireEither};
use crate::failure::ApiFailure;

/// One medicine of a set, as a prescription line starts.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MedicineInput {
    /// Generic name, 1 to 80 characters; matched to the medicine list when the set is added.
    pub drug_name: String,
    /// Strength, such as `500 mg`.
    pub strength: String,
    /// Form, such as `tablet`.
    pub form: String,
    /// Dose, such as `1 tablet`.
    pub dose: String,
    /// Frequency, such as `1-0-1`.
    pub frequency: String,
    /// `before_food`, `after_food`, `empty_stomach`, `bedtime`, `sos` or `as_directed`.
    pub timing: Option<String>,
    /// For how many days, 1 to 365.
    pub duration_days: Option<u16>,
    /// Extra instructions, up to 300 characters.
    pub instructions: Option<String>,
}

impl From<MedicineInput> for SetMedicine {
    fn from(item: MedicineInput) -> Self {
        Self {
            drug_name: item.drug_name,
            strength: item.strength,
            form: item.form,
            dose: item.dose,
            frequency: item.frequency,
            timing: item.timing,
            duration_days: item.duration_days,
            instructions: item.instructions,
        }
    }
}

/// A set to save. An edit replaces the label and every medicine.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MedicineSetValues {
    /// The chip's label, 1 to 80 characters, one line, unique in the clinic ignoring case.
    pub label: String,
    /// 1 to 20 medicines, in prescription order.
    pub items: Vec<MedicineInput>,
}

impl From<MedicineSetValues> for SetInput {
    fn from(values: MedicineSetValues) -> Self {
        Self {
            label: values.label,
            items: values.items.into_iter().map(SetMedicine::from).collect(),
        }
    }
}

/// A clinic's medicine set.
#[derive(Debug, Serialize, ToSchema)]
pub struct MedicineSet {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The chip's label.
    pub label: String,
    /// The medicines, in order.
    pub items: Vec<QuickSetMedicine>,
    /// When it was made (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
}

impl From<SetView> for MedicineSet {
    fn from(view: SetView) -> Self {
        Self {
            id: view.id.uuid(),
            label: view.label,
            items: view.items.iter().map(QuickSetMedicine::from_set).collect(),
            created_at: rfc3339(view.created_at),
            updated_at: rfc3339(view.updated_at),
        }
    }
}

/// The clinic's medicine sets.
#[derive(Debug, Serialize, ToSchema)]
pub struct MedicineSetList {
    /// By label.
    pub items: Vec<MedicineSet>,
}

/// The clinic's own medicine sets, by label.
#[utoipa::path(
    get,
    path = "/api/v1/medicine-sets",
    operation_id = "listMedicineSets",
    tag = "prescriptions",
    security(("bearer" = [])),
    responses(
        (status = 200, body = MedicineSetList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks both prescriptions.issue and clinical.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<PrescriptionsIssue, ClinicalRead>,
) -> Result<Json<MedicineSetList>, ApiFailure> {
    let sets = app::list_any(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(MedicineSetList {
        items: sets.into_iter().map(MedicineSet::from).collect(),
    }))
}

/// Adds a medicine set.
#[utoipa::path(
    post,
    path = "/api/v1/medicine-sets",
    operation_id = "createMedicineSet",
    tag = "prescriptions",
    request_body = MedicineSetValues,
    security(("bearer" = [])),
    responses(
        (status = 201, body = MedicineSet),
        (status = 400, description = "A bad label or medicine; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 409, description = "A set with that label exists")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiJson(body): ApiJson<MedicineSetValues>,
) -> Result<(StatusCode, Json<MedicineSet>), ApiFailure> {
    let view = app::create(state.db(), &request.actor, request.request_id, body.into()).await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Replaces a medicine set's label and medicines.
#[utoipa::path(
    put,
    path = "/api/v1/medicine-sets/{id}",
    operation_id = "updateMedicineSet",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The medicine set")),
    request_body = MedicineSetValues,
    security(("bearer" = [])),
    responses(
        (status = 200, body = MedicineSet),
        (status = 400, description = "A bad label or medicine; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 404, description = "No such medicine set in this clinic"),
        (status = 409, description = "Another set has that label")
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<MedicineSetValues>,
) -> Result<Json<MedicineSet>, ApiFailure> {
    let view = app::update(
        state.db(),
        &request.actor,
        request.request_id,
        MedicineSetId::from_uuid(id),
        body.into(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Deletes a medicine set. It is hidden, not erased: the change history keeps it.
#[utoipa::path(
    delete,
    path = "/api/v1/medicine-sets/{id}",
    operation_id = "deleteMedicineSet",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The medicine set")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 404, description = "No such medicine set in this clinic")
    )
)]
pub(crate) async fn delete(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete(
        state.db(),
        &request.actor,
        request.request_id,
        MedicineSetId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
