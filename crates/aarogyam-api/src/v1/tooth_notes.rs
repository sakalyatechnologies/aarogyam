//! Free-text notes on a tooth: add one, and read a tooth's notes newest first.

use aarogyam_app::tooth_notes::{self as app, ToothNoteView};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{EncounterId, MembershipId, PatientId};
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A free-text note on a tooth.
#[derive(Debug, Serialize, ToSchema)]
pub struct ToothNote {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// FDI tooth number.
    pub tooth: u8,
    /// The text.
    pub body: String,
    /// The visit it joined, when one was open.
    #[schema(required = false, value_type = Option<String>)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visit_id: Option<Uuid>,
    /// The member who wrote it.
    #[schema(required = false, value_type = Option<String>)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded_by: Option<Uuid>,
    /// Their name, when known.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded_by_name: Option<String>,
    /// When it was written (RFC 3339).
    pub recorded_at: String,
}

impl From<ToothNoteView> for ToothNote {
    fn from(view: ToothNoteView) -> Self {
        Self {
            id: view.id.uuid(),
            tooth: view.tooth.number(),
            body: view.body,
            visit_id: view.visit_id.map(EncounterId::uuid),
            recorded_by: view.recorded_by.map(MembershipId::uuid),
            recorded_by_name: view.recorded_by_name,
            recorded_at: rfc3339(view.recorded_at),
        }
    }
}

/// A tooth's notes, newest first (at most 50).
#[derive(Debug, Serialize, ToSchema)]
pub struct ToothNoteList {
    /// The notes.
    pub items: Vec<ToothNote>,
}

/// A note to add.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewToothNote {
    /// An id the client made for this request, any UUID. A retry with the same `client_id` and
    /// body returns the note it added; the same `client_id` for anything else is `id_conflict`
    /// (`409`).
    #[schema(value_type = Option<String>)]
    pub client_id: Option<Uuid>,
    /// The note, 1 to 2000 characters. An empty note is a `400` naming `body`.
    pub body: String,
}

/// Adds a free-text note to a tooth. It joins the open visit when there is one; no visit,
/// treatment or health status is needed. Notes are never edited: to fix one, add another.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/dental-chart/teeth/{tooth}/notes",
    operation_id = "addToothNote",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("tooth" = i64, Path, description = "FDI tooth number")
    ),
    request_body = NewToothNote,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ToothNote),
        (status = 400, description = "A bad tooth or body"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "`id_conflict`: the client_id made something else")
    )
)]
pub(crate) async fn add(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath((id, tooth)): ApiPath<(Uuid, i64)>,
    ApiJson(body): ApiJson<NewToothNote>,
) -> Result<(StatusCode, Json<ToothNote>), ApiFailure> {
    let note = app::add_tooth_note(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        tooth,
        &body.body,
        body.client_id,
    )
    .await?;
    tracing::info!(
        event = Event::ToothNoteAdded.as_str(),
        note_id = %note.id.uuid(),
        patient_id = %id,
        "tooth note added"
    );
    Ok((StatusCode::CREATED, Json(note.into())))
}

/// A tooth's notes, newest first (at most 50).
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/dental-chart/teeth/{tooth}/notes",
    operation_id = "listToothNotes",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("tooth" = i64, Path, description = "FDI tooth number")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ToothNoteList),
        (status = 400, description = "Not an FDI tooth number"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath((id, tooth)): ApiPath<(Uuid, i64)>,
) -> Result<Json<ToothNoteList>, ApiFailure> {
    let notes = app::list_tooth_notes(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        tooth,
    )
    .await?;
    Ok(Json(ToothNoteList {
        items: notes.into_iter().map(Into::into).collect(),
    }))
}
