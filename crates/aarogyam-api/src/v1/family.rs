//! Family under one mobile number: a patient's relatives in the same clinic. Reading needs
//! `patients.read`, changing `patients.write`; a link is written with its inverse and removed
//! with it. IDs and clinic numbers only in logs.

use aarogyam_app::family::{self as app, NewRelation, RelationView};
use aarogyam_domain::event::Event;
use aarogyam_domain::family::Relation;
use aarogyam_domain::ids::{PatientId, PatientRelationId};
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_id};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A relative of a patient.
#[derive(Debug, Serialize, ToSchema)]
pub struct FamilyLink {
    /// The link; pass it to the delete route.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The relative; open them at `/patients/{id}`.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// Their readable number, such as `SD-1042`.
    pub number: String,
    /// Their full name.
    pub full_name: String,
    /// What they are to this patient: `guardian`, `child`, `spouse`, `parent`, `sibling` or
    /// `other`.
    pub relation: String,
    /// Whether they are this patient's contact person.
    pub is_primary_contact: bool,
}

impl From<RelationView> for FamilyLink {
    fn from(view: RelationView) -> Self {
        Self {
            id: view.id.uuid(),
            patient_id: view.related_patient_id.uuid(),
            number: view.number,
            full_name: view.full_name,
            relation: view.relation.as_str().to_owned(),
            is_primary_contact: view.is_primary_contact,
        }
    }
}

/// A patient's relatives.
#[derive(Debug, Serialize, ToSchema)]
pub struct FamilyList {
    /// The relatives, by name.
    pub items: Vec<FamilyLink>,
}

/// A relative to link.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewFamilyLink {
    /// The relative, a patient of this clinic.
    pub related_patient_id: String,
    /// What the relative is to this patient: `guardian`, `child`, `spouse`, `parent`, `sibling`
    /// or `other`. The relative's own page shows the inverse (a guardian's dependant lists
    /// them as `child`).
    pub relation: String,
    /// Whether the relative is this patient's contact person.
    #[serde(default)]
    pub is_primary_contact: bool,
}

/// The patient's relatives.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/family",
    operation_id = "listFamily",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = FamilyList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<FamilyList>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(FamilyList {
        items: rows.into_iter().map(FamilyLink::from).collect(),
    }))
}

/// Links a relative to the patient (and the patient back to the relative).
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/family",
    operation_id = "addFamilyLink",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = NewFamilyLink,
    security(("bearer" = [])),
    responses(
        (status = 201, body = FamilyLink),
        (status = 400, description = "Unknown relation or a bad id"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "Either patient isn't in this clinic"),
        (status = 409, description = "A patient linked to themselves, or a pair already linked")
    )
)]
pub(crate) async fn add(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewFamilyLink>,
) -> Result<(StatusCode, Json<FamilyLink>), ApiFailure> {
    let related = parse_id("related_patient_id", &body.related_patient_id)?;
    let relation = Relation::parse(&body.relation).map_err(|_| bad("relation", "unknown value"))?;
    let view = app::add(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        NewRelation {
            related_patient_id: PatientId::from_uuid(related),
            relation,
            is_primary_contact: body.is_primary_contact,
        },
    )
    .await?;
    tracing::info!(
        event = Event::FamilyLinked.as_str(),
        patient_id = %id,
        related_patient_id = %related,
        "family linked"
    );
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Removes a family link and its inverse.
#[utoipa::path(
    delete,
    path = "/api/v1/patients/{id}/family/{link_id}",
    operation_id = "removeFamilyLink",
    tag = "patients",
    params(
        ("id" = String, Path, description = "The patient"),
        ("link_id" = String, Path, description = "The link")
    ),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed, with its inverse"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such link in this clinic")
    )
)]
pub(crate) async fn remove(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath((id, link_id)): ApiPath<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiFailure> {
    app::remove(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        PatientRelationId::from_uuid(link_id),
    )
    .await?;
    tracing::info!(
        event = Event::FamilyUnlinked.as_str(),
        patient_id = %id,
        link_id = %link_id,
        "family unlinked"
    );
    Ok(StatusCode::NO_CONTENT)
}
