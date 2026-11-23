//! Exact detail taps on a tooth (docs/plans/visit-story-v2-offers-design.md, section 1.13): a
//! condition (infection, gum bleeding, pocket depth, mobility) merged under a lock, and a
//! permanent tooth's eruption. Each has its own current row per tooth, which chart saves and
//! status saves never touch. Wrong rows are marked entered in error with a reason.

use aarogyam_app::tooth_details::{
    self as app, DetailKind, Recorded, SetToothCondition, SetToothEruption, ToothConditionView,
    ToothEruptionView,
};
use aarogyam_domain::ids::{EncounterId, MembershipId, PatientId};
use aarogyam_domain::permission::require::ClinicalWrite;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Deserializer, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Absent stays `None`; `null` becomes `Some(None)`; a value becomes `Some(Some(value))`.
#[expect(
    clippy::option_option,
    reason = "absent keeps the value, null clears it"
)]
pub(crate) fn absent_or_null<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// A tooth's current condition. Each field is present only when recorded.
#[derive(Debug, Serialize, ToSchema)]
pub struct ToothCondition {
    /// Identifier of the current row; the cleared row when a change left no condition.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// FDI tooth number (primary teeth included).
    pub tooth: u8,
    /// `infection` or `abscess`.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub infection: Option<String>,
    /// Gums bleed on probing.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bleeding: Option<bool>,
    /// Deepest pocket in mm, 1 to 15.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pocket_mm: Option<u8>,
    /// Mobility grade, 0 to 3.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobility: Option<u8>,
    /// The visit it was recorded in, if one was open.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// The member who recorded it.
    #[schema(value_type = Option<String>)]
    pub recorded_by: Option<Uuid>,
    /// When it was recorded (RFC 3339).
    pub recorded_at: String,
}

/// A permanent tooth's current eruption.
#[derive(Debug, Serialize, ToSchema)]
pub struct ToothEruption {
    /// Identifier of the current row.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// FDI tooth number (permanent only).
    pub tooth: u8,
    /// `erupted`, `partial`, `impacted` or `unerupted`.
    pub eruption: String,
    /// `vertical`, `mesioangular`, `distoangular` or `horizontal`, only when not through.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angulation: Option<String>,
    /// The visit it was recorded in, if one was open.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// The member who recorded it.
    #[schema(value_type = Option<String>)]
    pub recorded_by: Option<Uuid>,
    /// When it was recorded (RFC 3339).
    pub recorded_at: String,
}

struct Meta {
    id: Uuid,
    visit_id: Option<Uuid>,
    recorded_by: Option<Uuid>,
    recorded_at: String,
}

fn meta(recorded: &Recorded) -> Meta {
    Meta {
        id: recorded.id.uuid(),
        visit_id: recorded.visit_id.map(EncounterId::uuid),
        recorded_by: recorded.recorded_by.map(MembershipId::uuid),
        recorded_at: rfc3339(recorded.recorded_at),
    }
}

impl From<ToothConditionView> for ToothCondition {
    fn from(view: ToothConditionView) -> Self {
        let m = meta(&view.recorded);
        Self {
            id: m.id,
            tooth: view.tooth.number(),
            infection: view.infection.map(|i| i.as_str().to_owned()),
            bleeding: view.bleeding,
            pocket_mm: view.pocket_mm,
            mobility: view.mobility,
            visit_id: m.visit_id,
            recorded_by: m.recorded_by,
            recorded_at: m.recorded_at,
        }
    }
}

impl From<ToothEruptionView> for ToothEruption {
    fn from(view: ToothEruptionView) -> Self {
        let m = meta(&view.recorded);
        Self {
            id: m.id,
            tooth: view.tooth.number(),
            eruption: view.eruption.as_str().to_owned(),
            angulation: view.angulation.map(|a| a.as_str().to_owned()),
            visit_id: m.visit_id,
            recorded_by: m.recorded_by,
            recorded_at: m.recorded_at,
        }
    }
}

/// A change to a tooth's condition: an omitted field keeps its value, `null` clears it.
#[derive(Debug, Deserialize, ToSchema)]
#[expect(
    clippy::option_option,
    reason = "absent keeps the value, null clears it"
)]
pub struct NewToothCondition {
    /// `infection` or `abscess`; `null` clears it ("Infection resolved").
    #[serde(default, deserialize_with = "absent_or_null")]
    #[schema(value_type = Option<String>, nullable, required = false)]
    pub infection: Option<Option<String>>,
    /// Gums bleed on probing.
    #[serde(default, deserialize_with = "absent_or_null")]
    #[schema(value_type = Option<bool>, nullable, required = false)]
    pub bleeding: Option<Option<bool>>,
    /// Deepest pocket in mm, 1 to 15 (the "7+" chip sends 7).
    #[serde(default, deserialize_with = "absent_or_null")]
    #[schema(value_type = Option<i64>, nullable, required = false)]
    pub pocket_mm: Option<Option<i64>>,
    /// Mobility grade, 0 to 3; allowed on primary teeth.
    #[serde(default, deserialize_with = "absent_or_null")]
    #[schema(value_type = Option<i64>, nullable, required = false)]
    pub mobility: Option<Option<i64>>,
}

/// A permanent tooth's eruption.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewToothEruption {
    /// `erupted`, `partial`, `impacted` or `unerupted`.
    pub eruption: String,
    /// `vertical`, `mesioangular`, `distoangular` or `horizontal`; only with `partial`,
    /// `impacted` or `unerupted`.
    pub angulation: Option<String>,
}

/// Why a detail row is wrong.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DetailInError {
    /// 3 to 500 characters.
    pub reason: String,
}

/// Sets a tooth's condition. Under a lock on the tooth's condition, the change merges onto the
/// current row (an omitted field keeps its value, `null` clears it) and the merged row
/// supersedes it, in the open visit when there is one; concurrent changes both land. Returns the
/// condition. A change that clears every field ("Infection resolved" on the only field, or
/// untapping the last chip) supersedes the current row and leaves no current condition (history
/// kept): the body then has no `infection`, `bleeding`, `pocket_mm` or `mobility`, and `id` is
/// the cleared row.
#[utoipa::path(
    put,
    path = "/api/v1/patients/{id}/dental-chart/teeth/{tooth}/condition",
    operation_id = "setToothCondition",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("tooth" = i64, Path, description = "FDI tooth number")
    ),
    request_body = NewToothCondition,
    security(("bearer" = [])),
    responses(
        (status = 200, body = ToothCondition),
        (status = 400, description = "A bad tooth or value, nothing to record on a tooth with no condition, or infection, pocket or mobility on a missing tooth"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "The tooth changed at the same moment")
    )
)]
pub(crate) async fn set_condition(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath((id, tooth)): ApiPath<(Uuid, i64)>,
    ApiJson(body): ApiJson<NewToothCondition>,
) -> Result<Json<ToothCondition>, ApiFailure> {
    let view = app::set_condition(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        tooth,
        SetToothCondition {
            infection: body.infection,
            bleeding: body.bleeding,
            pocket_mm: body.pocket_mm,
            mobility: body.mobility,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Sets a permanent tooth's eruption: it supersedes the current one, in the open visit when
/// there is one. Returns the eruption.
#[utoipa::path(
    put,
    path = "/api/v1/patients/{id}/dental-chart/teeth/{tooth}/eruption",
    operation_id = "setToothEruption",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("tooth" = i64, Path, description = "FDI tooth number (permanent)")
    ),
    request_body = NewToothEruption,
    security(("bearer" = [])),
    responses(
        (status = 200, body = ToothEruption),
        (status = 400, description = "A primary tooth, an unknown eruption or angle, or an angle on an erupted tooth"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "The tooth changed at the same moment")
    )
)]
pub(crate) async fn set_eruption(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath((id, tooth)): ApiPath<(Uuid, i64)>,
    ApiJson(body): ApiJson<NewToothEruption>,
) -> Result<Json<ToothEruption>, ApiFailure> {
    let view = app::set_eruption(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        tooth,
        SetToothEruption {
            eruption: body.eruption,
            angulation: body.angulation,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(view.into()))
}

async fn in_error(
    state: &AppState,
    request: &crate::extract::ClinicRequest,
    (id, tooth): (Uuid, i64),
    kind: DetailKind,
    reason: &str,
) -> Result<StatusCode, ApiFailure> {
    app::mark_in_error(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        tooth,
        kind,
        reason,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Marks a tooth's current condition entered in error. The tooth has no condition until the
/// next change; the history keeps the row with the reason.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/dental-chart/teeth/{tooth}/condition/entered-in-error",
    operation_id = "toothConditionInError",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("tooth" = i64, Path, description = "FDI tooth number")
    ),
    request_body = DetailInError,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Marked"),
        (status = 400, description = "A bad tooth or reason"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic, or no condition on the tooth")
    )
)]
pub(crate) async fn condition_in_error(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(path): ApiPath<(Uuid, i64)>,
    ApiJson(body): ApiJson<DetailInError>,
) -> Result<StatusCode, ApiFailure> {
    in_error(&state, &request, path, DetailKind::Condition, &body.reason).await
}

/// Marks a tooth's current eruption entered in error. The history keeps the row with the reason.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/dental-chart/teeth/{tooth}/eruption/entered-in-error",
    operation_id = "toothEruptionInError",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("tooth" = i64, Path, description = "FDI tooth number")
    ),
    request_body = DetailInError,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Marked"),
        (status = 400, description = "A bad tooth or reason"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic, or no eruption on the tooth")
    )
)]
pub(crate) async fn eruption_in_error(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(path): ApiPath<(Uuid, i64)>,
    ApiJson(body): ApiJson<DetailInError>,
) -> Result<StatusCode, ApiFailure> {
    in_error(&state, &request, path, DetailKind::Eruption, &body.reason).await
}
