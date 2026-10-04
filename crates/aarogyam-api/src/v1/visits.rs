//! Visits and clinical notes: start, list, open, close; draft, edit, sign, addenda, entered in
//! error.

use aarogyam_app::record::{self, VisitDetail as DetailView};
use aarogyam_app::visits::{
    self as app, AddendumView, Member as MemberView, NoteInput, NoteView, StartVisit, VisitView,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ClinicalNoteId, EncounterId, PatientId};
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::chart::ChartEntry;
use super::files::Attachment;
use super::rfc3339;
use super::treatment::Procedure;
use super::vitals::Observation;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A member named on a clinical record.
#[derive(Debug, Serialize, ToSchema)]
pub struct Member {
    /// Their membership.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Their display name.
    pub name: String,
}

impl From<MemberView> for Member {
    fn from(view: MemberView) -> Self {
        Self {
            id: view.id.uuid(),
            name: view.name,
        }
    }
}

/// A visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct Visit {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Readable number, such as `V-318`.
    pub number: String,
    /// The patient.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// The member responsible.
    pub clinician: Member,
    /// The appointment it was started from.
    #[schema(value_type = Option<String>)]
    pub appointment_id: Option<Uuid>,
    /// `open` or `closed`.
    pub status: String,
    /// Why the patient came.
    pub chief_complaint: Option<String>,
    /// When it started (RFC 3339).
    pub started_at: String,
    /// When it was closed (RFC 3339).
    pub ended_at: Option<String>,
}

impl From<VisitView> for Visit {
    fn from(view: VisitView) -> Self {
        Self {
            id: view.id.uuid(),
            number: view.number,
            patient_id: view.patient_id.uuid(),
            clinician: view.clinician.into(),
            appointment_id: view.appointment_id,
            status: view.status.as_str().to_owned(),
            chief_complaint: view.chief_complaint,
            started_at: rfc3339(view.started_at),
            ended_at: view.ended_at.map(rfc3339),
        }
    }
}

/// A patient's visits, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitList {
    /// The visits.
    pub items: Vec<Visit>,
}

/// A note's sections. Each may be empty while drafting; signing needs at least one.
#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct NoteSections {
    /// What the patient reports.
    pub subjective: Option<String>,
    /// What the clinician found.
    pub objective: Option<String>,
    /// The clinician's assessment.
    pub assessment: Option<String>,
    /// What happens next.
    pub plan: Option<String>,
}

/// An addendum to a signed note.
#[derive(Debug, Serialize, ToSchema)]
pub struct Addendum {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Who wrote it.
    pub author: Member,
    /// The text.
    pub body: String,
    /// When (RFC 3339).
    pub created_at: String,
}

impl From<AddendumView> for Addendum {
    fn from(view: AddendumView) -> Self {
        Self {
            id: view.id.uuid(),
            author: view.author.into(),
            body: view.body,
            created_at: rfc3339(view.created_at),
        }
    }
}

/// A clinical note. Signed notes never change: corrections go in addenda, and a mistaken note
/// is marked `entered_in_error` with a reason.
#[derive(Debug, Serialize, ToSchema)]
pub struct Note {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The visit.
    #[schema(value_type = String)]
    pub visit_id: Uuid,
    /// `soap`, `progress`, `procedure`, `intake` or `front_desk`.
    pub kind: String,
    /// `typed`, `voice` or `ai_draft`.
    pub source: String,
    /// `draft`, `signed`, `conflict` (collided with a signed note during sync) or `entered_in_error`.
    pub status: String,
    /// The sections.
    pub sections: NoteSections,
    /// Who wrote it; only they may edit or sign it.
    pub author: Member,
    /// When it was signed (RFC 3339).
    pub signed_at: Option<String>,
    /// For a conflict: the signed note it collided with.
    #[schema(value_type = Option<String>)]
    pub conflicts_with_id: Option<Uuid>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// When it was written (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
    /// Addenda, oldest first.
    pub addenda: Vec<Addendum>,
}

impl From<NoteView> for Note {
    fn from(view: NoteView) -> Self {
        Self {
            id: view.id.uuid(),
            visit_id: view.visit_id.uuid(),
            kind: view.kind.as_str().to_owned(),
            source: view.source.as_str().to_owned(),
            status: view.status.as_str().to_owned(),
            sections: NoteSections {
                subjective: view.body.subjective,
                objective: view.body.objective,
                assessment: view.body.assessment,
                plan: view.body.plan,
            },
            author: view.author.into(),
            signed_at: view.signed_at.map(rfc3339),
            conflicts_with_id: view.conflicts_with_id.map(ClinicalNoteId::uuid),
            error_reason: view.error_reason,
            created_at: rfc3339(view.created_at),
            updated_at: rfc3339(view.updated_at),
            addenda: view.addenda.into_iter().map(Addendum::from).collect(),
        }
    }
}

/// Everything recorded in a visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitDetail {
    /// The visit.
    pub visit: Visit,
    /// Notes with their addenda, oldest first.
    pub notes: Vec<Note>,
    /// Vital signs recorded in the visit, oldest first; corrected values stay, marked by status.
    pub observations: Vec<Observation>,
    /// Dental chart entries recorded in the visit.
    pub chart_entries: Vec<ChartEntry>,
    /// Procedures planned or done in the visit.
    pub procedures: Vec<Procedure>,
    /// Files attached to the visit.
    pub attachments: Vec<Attachment>,
}

impl From<DetailView> for VisitDetail {
    fn from(view: DetailView) -> Self {
        Self {
            visit: view.visit.into(),
            notes: view.notes.into_iter().map(Note::from).collect(),
            observations: view
                .observations
                .into_iter()
                .map(Observation::from)
                .collect(),
            chart_entries: view
                .chart_entries
                .into_iter()
                .map(ChartEntry::from)
                .collect(),
            procedures: view.procedures.into_iter().map(Procedure::from).collect(),
            attachments: view.attachments.into_iter().map(Attachment::from).collect(),
        }
    }
}

/// A visit to start.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewVisit {
    /// The appointment the patient came for; a walk-in has none. One visit per appointment.
    #[schema(value_type = Option<String>)]
    pub appointment_id: Option<Uuid>,
    /// Why the patient came, up to 1,000 characters.
    pub chief_complaint: Option<String>,
}

/// Starts a visit, with the caller as the clinician responsible.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/visits",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    request_body = NewVisit,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Visit),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "The appointment already has a visit")
    )
)]
pub(crate) async fn start(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewVisit>,
) -> Result<(StatusCode, Json<Visit>), ApiFailure> {
    let view = app::start(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        StartVisit {
            appointment_id: body.appointment_id,
            chief_complaint: body.chief_complaint,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::VisitStarted.as_str(), visit_id = %view.id.uuid(), "visit started");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// A patient's visits, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/visits",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = VisitList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<VisitList>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(VisitList {
        items: rows.into_iter().map(Visit::from).collect(),
    }))
}

/// Opens a visit with everything recorded in it. Every open is written to the access record.
#[utoipa::path(
    get,
    path = "/api/v1/visits/{id}",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = VisitDetail),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such visit in this clinic")
    )
)]
pub(crate) async fn open(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<VisitDetail>, ApiFailure> {
    let view = record::open_visit(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Closes a visit. Addenda and corrections still work afterwards; new notes, vitals and
/// procedures don't.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/close",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Visit),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such visit in this clinic"),
        (status = 409, description = "Already closed")
    )
)]
pub(crate) async fn close(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Visit>, ApiFailure> {
    let view = app::close(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::VisitClosed.as_str(), visit_id = %id, "visit closed");
    Ok(Json(view.into()))
}

/// A note's content. Sections are replaced as a whole when editing.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NoteContent {
    /// `soap` (default), `progress`, `procedure`, `intake` or `front_desk`.
    pub kind: Option<String>,
    /// The sections, each up to 10,000 characters.
    #[serde(default)]
    pub sections: NoteSections,
}

impl From<NoteContent> for NoteInput {
    fn from(content: NoteContent) -> Self {
        Self {
            kind: content.kind,
            subjective: content.sections.subjective,
            objective: content.sections.objective,
            assessment: content.sections.assessment,
            plan: content.sections.plan,
        }
    }
}

/// Starts a draft note in an open visit, written by the caller.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/notes",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = NoteContent,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Note),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such visit in this clinic"),
        (status = 409, description = "The visit is closed")
    )
)]
pub(crate) async fn create_note(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NoteContent>,
) -> Result<(StatusCode, Json<Note>), ApiFailure> {
    let view = app::create_note(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        body.into(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Replaces a draft's sections. Only the author may, and only while it is a draft.
#[utoipa::path(
    patch,
    path = "/api/v1/notes/{id}",
    tag = "clinical",
    params(("id" = String, Path, description = "The note")),
    request_body = NoteContent,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Note),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write, or the note is someone else's"),
        (status = 404, description = "No such note in this clinic"),
        (status = 409, description = "The note is signed; add an addendum instead")
    )
)]
pub(crate) async fn edit_note(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NoteContent>,
) -> Result<Json<Note>, ApiFailure> {
    let view = app::edit_note(
        state.db(),
        &request.actor,
        request.request_id,
        ClinicalNoteId::from_uuid(id),
        body.into(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Signs a draft. Only its author may; the note never changes afterwards.
#[utoipa::path(
    post,
    path = "/api/v1/notes/{id}/sign",
    tag = "clinical",
    params(("id" = String, Path, description = "The note")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Note),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write, or the note is someone else's"),
        (status = 404, description = "No such note in this clinic"),
        (status = 409, description = "Not a draft, or every section is empty")
    )
)]
pub(crate) async fn sign_note(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Note>, ApiFailure> {
    let view = app::sign_note(
        state.db(),
        &request.actor,
        request.request_id,
        ClinicalNoteId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::NoteSigned.as_str(), note_id = %id, "note signed");
    Ok(Json(view.into()))
}

/// An addendum's text.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewAddendum {
    /// 1 to 10,000 characters.
    pub body: String,
}

/// Adds an addendum to a signed note. Addenda are never edited or removed.
#[utoipa::path(
    post,
    path = "/api/v1/notes/{id}/addenda",
    tag = "clinical",
    params(("id" = String, Path, description = "The note")),
    request_body = NewAddendum,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Note),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such note in this clinic"),
        (status = 409, description = "The note isn't signed")
    )
)]
pub(crate) async fn add_addendum(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewAddendum>,
) -> Result<(StatusCode, Json<Note>), ApiFailure> {
    let view = app::add_addendum(
        state.db(),
        &request.actor,
        request.request_id,
        ClinicalNoteId::from_uuid(id),
        &body.body,
    )
    .await?;
    tracing::info!(event = Event::NoteAmended.as_str(), note_id = %id, "note amended");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Why a record is being marked entered in error.
#[derive(Debug, Deserialize, ToSchema)]
pub struct EnteredInError {
    /// 3 to 500 characters, such as "wrong patient".
    pub reason: String,
}

/// Marks a note entered in error with a reason. It stays in the record, marked; nothing is
/// deleted. A draft can be withdrawn only by its author.
#[utoipa::path(
    post,
    path = "/api/v1/notes/{id}/entered-in-error",
    tag = "clinical",
    params(("id" = String, Path, description = "The note")),
    request_body = EnteredInError,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Note),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write, or the draft is someone else's"),
        (status = 404, description = "No such note in this clinic"),
        (status = 409, description = "Already marked")
    )
)]
pub(crate) async fn note_in_error(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<EnteredInError>,
) -> Result<Json<Note>, ApiFailure> {
    let view = app::mark_note_in_error(
        state.db(),
        &request.actor,
        request.request_id,
        ClinicalNoteId::from_uuid(id),
        &body.reason,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::RecordRetracted.as_str(), note_id = %id, "note entered in error");
    Ok(Json(view.into()))
}
