//! A patient's notes on Patient 360: the summary note (one per patient, versioned) and the
//! list of their visit notes.

use aarogyam_app::patient_notes::{self as app, PatientNotes as NotesView, VisitNoteView};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use axum::Json;
use axum::extract::State;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::visits::{MemberRef, NoteSections};
use super::{WithEtag, rfc3339, with_etag};
use crate::AppState;
use crate::extract::{IfMatch, Require};
use crate::failure::ApiFailure;

/// A patient's summary note: formatted text kept up to date outside any single visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct SummaryNote {
    /// The text: a strict Markdown subset (headings `#` to `###`, `-` and `1.` lists, `**bold**`,
    /// `*italic*`). Render it with a renderer that treats everything else as plain text.
    pub body: String,
    /// Goes up when the text changes. Send it back in `If-Match` (it is also the `ETag`).
    pub row_version: i64,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
    /// Who last changed it.
    pub updated_by: Option<String>,
}

impl From<aarogyam_app::patient_notes::SummaryView> for SummaryNote {
    fn from(view: aarogyam_app::patient_notes::SummaryView) -> Self {
        Self {
            body: view.body,
            row_version: view.row_version,
            updated_at: rfc3339(view.updated_at),
            updated_by: view.updated_by,
        }
    }
}

/// A visit note as listed on the patient. Open the visit to edit it or add an addendum.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitNote {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The visit.
    #[schema(value_type = String)]
    pub visit_id: Uuid,
    /// The visit's number, such as `V-318`.
    pub visit_number: String,
    /// `soap`, `progress`, `procedure`, `intake` or `front_desk`.
    pub kind: String,
    /// `draft`, `signed`, `conflict` or `entered_in_error`.
    pub status: String,
    /// The sections (each a Markdown subset).
    pub sections: NoteSections,
    /// Who wrote it.
    pub author: MemberRef,
    /// When it was signed (RFC 3339).
    pub signed_at: Option<String>,
    /// When it was written (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
    /// The note's version; send it in `If-Match` to `PATCH /notes/{id}` (drafts only).
    pub row_version: i64,
    /// How many addenda it has.
    pub addenda_count: i64,
}

impl From<VisitNoteView> for VisitNote {
    fn from(view: VisitNoteView) -> Self {
        Self {
            id: view.id.uuid(),
            visit_id: view.visit_id.uuid(),
            visit_number: view.visit_number,
            kind: view.kind.as_str().to_owned(),
            status: view.status.as_str().to_owned(),
            sections: NoteSections {
                subjective: view.body.subjective,
                objective: view.body.objective,
                assessment: view.body.assessment,
                plan: view.body.plan,
            },
            author: view.author.into(),
            signed_at: view.signed_at.map(rfc3339),
            created_at: rfc3339(view.created_at),
            updated_at: rfc3339(view.updated_at),
            row_version: view.row_version,
            addenda_count: view.addenda_count,
        }
    }
}

/// A patient's notes.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientNotes {
    /// The summary note; absent until someone writes it.
    pub summary: Option<SummaryNote>,
    /// Visit notes, newest first (up to 100), limited to those the caller's role reaches.
    pub visit_notes: Vec<VisitNote>,
}

impl From<NotesView> for PatientNotes {
    fn from(view: NotesView) -> Self {
        Self {
            summary: view.summary.map(SummaryNote::from),
            visit_notes: view.visit_notes.into_iter().map(VisitNote::from).collect(),
        }
    }
}

/// The summary note's new text.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SummaryContent {
    /// The text, up to 20,000 characters, in the Markdown subset. Empty clears the note. HTML,
    /// links, images and code are refused (`400`).
    pub body: String,
}

/// The patient's summary note and visit notes, for Patient 360. Reading writes the access record.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/notes",
    operation_id = "getPatientNotes",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientNotes),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientNotes>, ApiFailure> {
    let notes = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(notes.into()))
}

/// Saves the patient's summary note: the first save creates it, later saves replace the text.
/// Anyone with `clinical.write` whose scope reaches the patient may, at any time. Send the
/// `row_version` you read in `If-Match` to refuse the edit (`412`) if the note changed since.
/// The change history records each change.
#[utoipa::path(
    put,
    path = "/api/v1/patients/{id}/summary-note",
    operation_id = "savePatientSummaryNote",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("If-Match" = Option<String>, Header, description = "The `row_version` (the `ETag`) you last read, in quotes; the edit is refused with `412` if the note changed since")
    ),
    request_body = SummaryContent,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SummaryNote, headers(("ETag" = String, description = "The `row_version` in quotes; send it back in `If-Match` when editing"))),
        (status = 400, description = "Too long, or outside the allowed Markdown subset"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach"),
        (status = 412, description = "`stale_version`: the note changed since the `If-Match` version; the current version is in `ETag`")
    )
)]
pub(crate) async fn save_summary(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    IfMatch(expected): IfMatch,
    ApiJson(body): ApiJson<SummaryContent>,
) -> Result<WithEtag<SummaryNote>, ApiFailure> {
    let view = app::save_summary(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        expected,
        &body.body,
    )
    .await?;
    tracing::info!(
        event = Event::PatientNoteSaved.as_str(),
        patient_id = %id,
        "summary note saved"
    );
    Ok(with_etag(view.row_version, view.into()))
}
