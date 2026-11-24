//! "What we discussed" in Show patient (docs/plans/present-studio-design.md, sections 10 and
//! 12.5): append-only, a save supersedes the current row for the visit, tooth and situation.

use aarogyam_app::present_discussions as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{EncounterId, PresentDiscussionId};
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use aarogyam_domain::present_discussion::DiscussedOption;
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

/// One option discussed.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DiscussedOptionBody {
    /// A key from the options data, such as `rct_crown`.
    pub key: String,
    /// A material key, when one was compared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub material: Option<String>,
    /// The option the patient prefers; at most one.
    #[serde(default)]
    pub preferred: bool,
    /// Frozen "from" price in paise; set by the server, ignored on input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub from_paise: Option<i64>,
}

/// A discussion to save.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveDiscussionBody {
    /// FDI tooth; leave out for an example-arch topic.
    #[serde(default)]
    pub tooth: Option<i64>,
    /// The situation or topic key, such as `deep_decay`.
    pub situation: String,
    /// The options discussed, 1 to 12.
    pub options: Vec<DiscussedOptionBody>,
    /// The doctor's tick: whether it may reach the patient (slice 2f sends it).
    #[serde(default)]
    pub send_to_patient: bool,
}

/// A saved discussion.
#[derive(Debug, Serialize, ToSchema)]
pub struct Discussion {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// FDI tooth; absent for an example-arch topic.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooth: Option<u8>,
    /// The situation key.
    pub situation: String,
    /// The options discussed.
    pub options: Vec<DiscussedOptionBody>,
    /// The doctor's tick for the patient.
    pub send_to_patient: bool,
    /// The row this one replaced.
    #[schema(required = false, value_type = Option<String>)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes_id: Option<Uuid>,
    /// When it was saved.
    pub created_at: String,
}

/// The visit's current discussions.
#[derive(Debug, Serialize, ToSchema)]
pub struct DiscussionList {
    /// Oldest first.
    pub discussions: Vec<Discussion>,
}

/// Why a discussion is wrong.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DiscussionInError {
    /// 3 to 500 characters.
    pub reason: String,
}

impl From<app::Discussion> for Discussion {
    fn from(d: app::Discussion) -> Self {
        Self {
            id: d.id.uuid(),
            tooth: d.tooth,
            situation: d.situation,
            options: d
                .options
                .into_iter()
                .map(|o| DiscussedOptionBody {
                    key: o.key,
                    material: o.material,
                    preferred: o.preferred,
                    from_paise: o.from_paise,
                })
                .collect(),
            send_to_patient: d.send_to_patient,
            supersedes_id: d.supersedes_id.map(PresentDiscussionId::uuid),
            created_at: rfc3339(d.created_at),
        }
    }
}

/// The visit's current "What we discussed" rows. Works while the visit is open or closed.
#[utoipa::path(
    get,
    path = "/api/v1/visits/{id}/present-discussions",
    operation_id = "listPresentDiscussions",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = DiscussionList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such visit in this clinic or the caller's reach")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<DiscussionList>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
    )
    .await?;
    Ok(Json(DiscussionList {
        discussions: rows.into_iter().map(Into::into).collect(),
    }))
}

/// Saves what was discussed for one situation. It supersedes the current row for the same
/// visit, tooth and situation (append-only). 400 for an unknown situation, option or material,
/// and 409 when the visit is closed.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/present-discussions",
    operation_id = "savePresentDiscussion",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = SaveDiscussionBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Discussion),
        (status = 400, description = "Invalid input; the message says what"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such visit in this clinic or the caller's reach"),
        (status = 409, description = "The visit is closed")
    )
)]
pub(crate) async fn save(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SaveDiscussionBody>,
) -> Result<(StatusCode, Json<Discussion>), ApiFailure> {
    let saved = app::save(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        app::SaveDiscussion {
            tooth: body.tooth,
            situation: body.situation,
            options: body
                .options
                .into_iter()
                .map(|o| DiscussedOption {
                    key: o.key,
                    material: o.material,
                    preferred: o.preferred,
                    from_paise: None,
                })
                .collect(),
            send_to_patient: body.send_to_patient,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::PresentDiscussionSaved.as_str(),
        discussion_id = %saved.id.uuid(),
        "present discussion saved"
    );
    Ok((StatusCode::CREATED, Json(saved.into())))
}

/// Marks a current discussion entered in error, with the reason. The history keeps the row.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/present-discussions/{did}/entered-in-error",
    operation_id = "presentDiscussionInError",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The visit"),
        ("did" = String, Path, description = "The discussion")
    ),
    request_body = DiscussionInError,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Marked"),
        (status = 400, description = "A bad reason"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such visit or current discussion in this clinic"),
        (status = 409, description = "The visit is closed")
    )
)]
pub(crate) async fn in_error(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath((id, did)): ApiPath<(Uuid, Uuid)>,
    ApiJson(body): ApiJson<DiscussionInError>,
) -> Result<StatusCode, ApiFailure> {
    app::mark_in_error(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        PresentDiscussionId::from_uuid(did),
        &body.reason,
    )
    .await?;
    tracing::info!(
        event = Event::PresentDiscussionSaved.as_str(),
        discussion_id = %did,
        "present discussion entered in error"
    );
    Ok(StatusCode::NO_CONTENT)
}
