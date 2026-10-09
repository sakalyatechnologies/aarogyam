//! The clinic's privacy notice text, with versions.

use aarogyam_app::notices as app;
use aarogyam_dal::notices::NoticeRow;
use aarogyam_domain::event::Event;
use aarogyam_domain::permission::require::{PatientsRead, SettingsManage};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// One published version of the clinic's notice.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsentNotice {
    /// Identifier; consents record it as `notice_id`.
    pub id: String,
    /// 1 for the first version, then 2, 3, ...
    pub version: i32,
    /// The clinic's short label, such as `v2 2026-11`.
    pub label: String,
    /// The notice text.
    pub body: String,
    /// When it was published (RFC 3339).
    pub published_at: String,
    /// Who published it.
    pub published_by: Option<String>,
}

impl From<NoticeRow> for ConsentNotice {
    fn from(row: NoticeRow) -> Self {
        Self {
            id: row.id.to_string(),
            version: row.version,
            label: row.label,
            body: row.body,
            published_at: rfc3339(row.published_at),
            published_by: row.published_by_name,
        }
    }
}

/// The clinic's notice versions.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsentNoticeList {
    /// Newest first; the first is the current notice. Empty until the clinic publishes one
    /// (consents then record the template's label, `v1 2026-10`).
    pub items: Vec<ConsentNotice>,
}

/// A new version to publish.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PublishNotice {
    /// A short label, 1 to 40 characters, such as `v2 2026-11`.
    pub label: String,
    /// The full notice text, up to 20,000 characters.
    pub body: String,
}

/// Every version of the clinic's privacy notice, newest (current) first.
#[utoipa::path(
    get,
    path = "/api/v1/consent-notices",
    operation_id = "listConsentNotices",
    tag = "patients",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ConsentNoticeList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
) -> Result<Json<ConsentNoticeList>, ApiFailure> {
    let rows = app::list(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(ConsentNoticeList {
        items: rows.into_iter().map(ConsentNotice::from).collect(),
    }))
}

/// Publishes a new version of the clinic's notice; it becomes the current one, which consents
/// record from now on. Versions are never edited.
#[utoipa::path(
    post,
    path = "/api/v1/consent-notices",
    operation_id = "publishConsentNotice",
    tag = "patients",
    request_body = PublishNotice,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ConsentNotice),
        (status = 400, description = "A bad label or text"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 409, description = "Another version was published at the same moment")
    )
)]
pub(crate) async fn publish(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<PublishNotice>,
) -> Result<(StatusCode, Json<ConsentNotice>), ApiFailure> {
    let row = app::publish(
        state.db(),
        &request.actor,
        request.request_id,
        &body.label,
        &body.body,
    )
    .await?;
    tracing::info!(
        event = Event::ConsentNoticePublished.as_str(),
        notice_id = %row.id,
        version = row.version,
        "consent notice published"
    );
    Ok((StatusCode::CREATED, Json(row.into())))
}
