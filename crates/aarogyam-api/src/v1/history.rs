//! The patient's history page: every visit as a rich card, for the portal's full-page history.

use aarogyam_app::history::{
    self as app, Cursor, HistoryBill as BillView, HistoryFile as FileView, HistoryPage as PageView,
    HistoryTooth as ToothView, HistoryVisit as VisitView,
};
use aarogyam_domain::ids::{EncounterId, PatientId};
use aarogyam_domain::permission::require::ClinicalRead;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use super::visits::MemberRef;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A tooth touched in a visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryTooth {
    /// FDI tooth number.
    pub tooth: u8,
    /// The chart finding (`caries`, `filled`, `crown` and so on) for chart entries; none for a
    /// procedure recorded on its own.
    pub finding: Option<String>,
    /// The procedure's id in the dental vocabulary, when the chart entry names one.
    pub procedure_key: Option<String>,
    /// The procedure's label or name; none for a bare finding.
    pub label: Option<String>,
    /// `found`, `planned`, `in_progress`, `done` or `elsewhere` (work done at another clinic).
    pub work: String,
}

/// A file on a visit card, or one outside any visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryFile {
    /// The file.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `photo`, `xray`, `report` or `document`.
    pub kind: String,
    /// Its content type: only images ask for a preview link.
    pub mime_type: String,
    /// Its tag: `OPG`, `X-ray` and so on.
    pub label: Option<String>,
    /// When it was added.
    pub created_at: String,
}

/// A bill of a visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryBill {
    /// The bill.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its number once issued.
    pub number: Option<String>,
    /// `issued` (drafts have no total yet and stay off the card).
    pub status: String,
    /// The total in paise.
    pub total_paise: i64,
    /// Received against it, in paise.
    pub paid_paise: i64,
}

/// A plan proposed in a visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryPlan {
    /// The plan.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its title.
    pub title: String,
    /// `proposed`, `accepted`, `in_progress`, `completed` or `declined`.
    pub status: String,
}

/// What a visit holds besides its card lines.
#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryCounts {
    /// Signed notes.
    pub notes: usize,
    /// Voice recordings.
    pub recordings: usize,
    /// Files other than recordings and consent scans.
    pub files: usize,
    /// Procedures.
    pub procedures: usize,
}

/// One visit on the history page.
#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryVisit {
    /// The visit.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its number, `V-8`.
    pub number: String,
    /// `open` or `closed`.
    pub status: String,
    /// When it started.
    pub started_at: String,
    /// When it ended.
    pub ended_at: Option<String>,
    /// The clinician.
    pub clinician: MemberRef,
    /// Why the patient came, as typed when the visit started.
    pub chief_complaint: Option<String>,
    /// Teeth touched, in the order recorded.
    pub teeth: Vec<HistoryTooth>,
    /// The first four photos and X-rays.
    pub images: Vec<HistoryFile>,
    /// All photos and X-rays in the visit.
    pub image_count: usize,
    /// The first line of the first signed note, at most 120 characters. Clinical text: this
    /// endpoint is for clinic staff only and never feeds a shared page.
    pub note_first_line: Option<String>,
    /// Medicines prescribed, in order.
    pub medicines: Vec<String>,
    /// The visit's bills. Absent without `billing.read`, and always for Sakalya support.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bills: Option<Vec<HistoryBill>>,
    /// Plans proposed in the visit.
    pub plans: Vec<HistoryPlan>,
    /// What else it holds.
    pub counts: HistoryCounts,
}

/// A page of the patient's history, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientHistory {
    /// The visits.
    pub visits: Vec<HistoryVisit>,
    /// Files that belong to no visit, newest first (first page only, at most 50).
    pub loose_files: Vec<HistoryFile>,
    /// Pass as `before` for the next page; absent on the last page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Which page.
#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    /// The `next_cursor` of the previous page.
    pub before: Option<String>,
    /// Most visits, 1 to 200 (default 200).
    pub limit: Option<i64>,
}

fn file(view: FileView) -> HistoryFile {
    HistoryFile {
        id: view.id.uuid(),
        kind: view.kind,
        mime_type: view.mime_type,
        label: view.label,
        created_at: rfc3339(view.created_at),
    }
}

fn tooth(view: ToothView) -> HistoryTooth {
    HistoryTooth {
        tooth: view.tooth.number(),
        finding: view.finding.map(|f| f.as_str().to_owned()),
        procedure_key: view.procedure_key,
        label: view.label,
        work: view.work.as_str().to_owned(),
    }
}

fn bill(view: BillView) -> HistoryBill {
    HistoryBill {
        id: view.id.uuid(),
        number: view.number,
        status: view.status.as_str().to_owned(),
        total_paise: view.total.get(),
        paid_paise: view.paid.get(),
    }
}

impl From<VisitView> for HistoryVisit {
    fn from(view: VisitView) -> Self {
        Self {
            id: view.id.uuid(),
            number: view.number,
            status: view.status.as_str().to_owned(),
            started_at: rfc3339(view.started_at),
            ended_at: view.ended_at.map(rfc3339),
            clinician: MemberRef::from(view.clinician),
            chief_complaint: view.chief_complaint,
            teeth: view.teeth.into_iter().map(tooth).collect(),
            images: view.images.into_iter().map(file).collect(),
            image_count: view.image_count,
            note_first_line: view.note_first_line,
            medicines: view.medicines,
            bills: view
                .bills
                .map(|bills| bills.into_iter().map(bill).collect()),
            plans: view
                .plans
                .into_iter()
                .map(|plan| HistoryPlan {
                    id: plan.id.uuid(),
                    title: plan.title,
                    status: plan.status.as_str().to_owned(),
                })
                .collect(),
            counts: HistoryCounts {
                notes: view.counts.notes,
                recordings: view.counts.recordings,
                files: view.counts.files,
                procedures: view.counts.procedures,
            },
        }
    }
}

/// The opaque cursor: the last visit's start in microseconds and its id.
fn encode(cursor: Cursor) -> String {
    let micros = cursor.started_at.unix_timestamp_nanos() / 1_000;
    format!("{micros}~{}", cursor.id.uuid())
}

fn decode(text: &str) -> Option<Cursor> {
    let (micros, id) = text.trim().split_once('~')?;
    let nanos = micros.parse::<i128>().ok()?.checked_mul(1_000)?;
    Some(Cursor {
        started_at: OffsetDateTime::from_unix_timestamp_nanos(nanos).ok()?,
        id: EncounterId::from_uuid(Uuid::try_parse(id).ok()?),
    })
}

/// The patient's history for the portal's full page, newest first: each visit with its teeth,
/// first images, the first line of its signed note, medicines, bills (with `billing.read`) and
/// plans, plus the files outside any visit. Up to 200 visits per page, so search and filters
/// see the whole history at once. Reading it writes the access record. `Cache-Control: no-store`.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/history",
    operation_id = "getPatientHistory",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("before" = Option<String>, Query, description = "The previous page's `next_cursor`"),
        ("limit" = Option<i64>, Query, description = "Most visits, 1 to 200 (default 200)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientHistory, description = "The page; `Cache-Control: no-store`"),
        (status = 400, description = "before isn't a cursor from this endpoint, or limit is out of range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic or the caller's reach")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<HistoryQuery>,
) -> Result<Response, ApiFailure> {
    let before = query
        .before
        .as_deref()
        .map(|text| decode(text).ok_or(()))
        .transpose()
        .map_err(|()| ApiError::bad_request("invalid_request", "before: not a history cursor"))?;
    let limit = query.limit.unwrap_or(app::MAX_PAGE);
    if !(1..=app::MAX_PAGE).contains(&limit) {
        return Err(ApiError::bad_request("invalid_request", "limit: must be 1 to 200").into());
    }
    let page: PageView = app::page(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        before,
        limit,
    )
    .await?;
    let body = PatientHistory {
        visits: page.visits.into_iter().map(HistoryVisit::from).collect(),
        loose_files: page.loose_files.into_iter().map(file).collect(),
        next_cursor: page.next.map(encode),
    };
    let mut response = Json(body).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cursor_round_trips_and_junk_is_refused() {
        let cursor = Cursor {
            started_at: OffsetDateTime::from_unix_timestamp_nanos(1_763_700_000_123_456_000)
                .unwrap(),
            id: EncounterId::from_uuid(Uuid::nil()),
        };
        assert_eq!(decode(&encode(cursor)), Some(cursor));
        assert_eq!(decode("yesterday"), None);
        assert_eq!(decode("12~not-a-uuid"), None);
    }
}
