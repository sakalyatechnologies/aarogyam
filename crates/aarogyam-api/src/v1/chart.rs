//! The dental chart: current state per tooth, one tooth's history, and new findings.

use aarogyam_app::chart::{
    self as app, Canal, ChartEntryView, DentalChart as ChartView, EntryInput, RecordChart, TermView,
};
use aarogyam_domain::ids::{EncounterId, MembershipId, PatientId, SpecialtyRecordId};
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// One canal of a root canal treatment.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RootCanal {
    /// What the clinician calls it: `MB`, `MB2`, `DB`, `P`. 1 to 20 characters, each name once.
    pub name: String,
    /// The working length in millimetres, above 0 and at most 40; kept to two decimals.
    pub working_length_mm: Option<f64>,
}

impl From<Canal> for RootCanal {
    fn from(canal: Canal) -> Self {
        Self {
            name: canal.name,
            working_length_mm: canal.working_length_mm,
        }
    }
}

impl From<RootCanal> for Canal {
    fn from(canal: RootCanal) -> Self {
        Self {
            name: canal.name,
            working_length_mm: canal.working_length_mm,
        }
    }
}

/// A finding on a tooth or one of its surfaces.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChartEntry {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The visit that recorded it.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// FDI tooth number: 11-48, or 51-85 for primary teeth.
    pub tooth: u8,
    /// `M`, `O`, `D`, `B` or `L`; absent for the whole tooth.
    pub surface: Option<String>,
    /// `sound`, `caries`, `filled`, `crown`, `missing`, `implant`, `root_canal`, `bridge`, `fractured` or `watch`.
    pub finding: String,
    /// What was done, with its label.
    pub procedure: Option<DentalTerm>,
    /// What it was done with, with its label.
    pub material: Option<DentalTerm>,
    /// The clinician's remark.
    pub note: Option<String>,
    /// `current`, `superseded` or `entered_in_error`.
    pub status: String,
    /// The entry it replaced.
    #[schema(value_type = Option<String>)]
    pub supersedes_id: Option<Uuid>,
    /// When the finding was made (RFC 3339).
    pub effective_at: String,
    /// The member who recorded it.
    #[schema(value_type = Option<String>)]
    pub recorded_by: Option<Uuid>,
    /// For a root canal: its canals with their working lengths. Empty for any other entry.
    pub canals: Vec<RootCanal>,
    /// For a root canal: which sitting (visit) of the treatment this entry belongs to.
    pub sitting: Option<u8>,
}

impl From<ChartEntryView> for ChartEntry {
    fn from(view: ChartEntryView) -> Self {
        Self {
            id: view.id.uuid(),
            visit_id: view.visit_id.map(EncounterId::uuid),
            tooth: view.tooth.number(),
            surface: view.surface.map(|s| s.as_str().to_owned()),
            finding: view.finding.as_str().to_owned(),
            procedure: view.procedure.map(DentalTerm::from),
            material: view.material.map(DentalTerm::from),
            note: view.note,
            status: view.status,
            supersedes_id: view.supersedes_id.map(SpecialtyRecordId::uuid),
            effective_at: rfc3339(view.effective_at),
            recorded_by: view.recorded_by.map(MembershipId::uuid),
            canals: view.canals.into_iter().map(RootCanal::from).collect(),
            sitting: view.sitting,
        }
    }
}

/// A procedure or material: seeded (`zirconia`) or added by the clinic (a UUID id).
#[derive(Debug, Serialize, ToSchema)]
pub struct DentalTerm {
    /// The seeded id, such as `zirconia`, or the clinic term's UUID.
    pub id: String,
    /// `procedure` or `material`.
    pub kind: String,
    /// What the clinician reads.
    pub label: String,
    /// Added by the clinic rather than seeded.
    pub own: bool,
    /// Retired: still shown on old entries, not offered for new ones.
    pub retired: bool,
}

impl From<TermView> for DentalTerm {
    fn from(view: TermView) -> Self {
        Self {
            id: view.id,
            kind: view.kind.as_str().to_owned(),
            label: view.label,
            own: view.own,
            retired: view.retired,
        }
    }
}

/// A patient's dental chart. Teeth without entries are absent: draw them as sound.
#[derive(Debug, Serialize, ToSchema)]
pub struct DentalChart {
    /// The current entries, by tooth (the whole-tooth entry first, then surfaces).
    pub current: Vec<ChartEntry>,
    /// Every entry of the requested tooth, newest first; empty unless `tooth` was given.
    pub history: Vec<ChartEntry>,
    /// The procedures and materials to offer: the seeded vocabulary, then the clinic's own.
    /// Filter it as the clinician types; it changes only when someone adds a term.
    pub terms: Vec<DentalTerm>,
}

impl From<ChartView> for DentalChart {
    fn from(view: ChartView) -> Self {
        Self {
            current: view.current.into_iter().map(ChartEntry::from).collect(),
            history: view.history.into_iter().map(ChartEntry::from).collect(),
            terms: view.terms.into_iter().map(DentalTerm::from).collect(),
        }
    }
}

/// Which tooth's history to include.
#[derive(Debug, Deserialize)]
pub struct ChartQuery {
    /// FDI tooth number whose full history to include.
    pub tooth: Option<i64>,
}

/// A patient's dental chart, with one tooth's history when `tooth` is given.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/dental-chart",
    operation_id = "getDentalChart",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("tooth" = Option<i64>, Query, description = "FDI tooth number whose full history to include")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = DentalChart),
        (status = 400, description = "Not an FDI tooth number"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ChartQuery>,
) -> Result<Json<DentalChart>, ApiFailure> {
    let view = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        query.tooth,
    )
    .await?;
    Ok(Json(view.into()))
}

/// One finding to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewChartEntry {
    /// FDI tooth number: 11-48, or 51-85 for primary teeth.
    pub tooth: i64,
    /// `M`, `O`, `D`, `B` or `L`; leave out for the whole tooth (crown, missing, implant, root canal and bridge are whole-tooth only).
    pub surface: Option<String>,
    /// `sound` (clears an earlier finding), `caries`, `filled`, `crown`, `missing`, `implant`, `root_canal`, `bridge`, `fractured` or `watch`.
    pub finding: String,
    /// A procedure id from the chart's `terms`: seeded (`crown`) or the clinic's own. Not with `sound`.
    pub procedure: Option<String>,
    /// A material id from the chart's `terms`: seeded (`zirconia`) or the clinic's own. Not with `sound`.
    pub material: Option<String>,
    /// A remark, up to 500 characters.
    pub note: Option<String>,
    /// Corrects this current entry of the patient, which may be on another tooth or surface:
    /// it is superseded and the new entry links to it. Leave out to supersede the current entry
    /// for the new entry's own tooth and surface.
    #[schema(value_type = Option<String>)]
    pub supersedes_id: Option<Uuid>,
    /// Only with `root_canal`: 1 to 8 canals, each with a name and an optional working length.
    #[serde(default)]
    pub canals: Vec<RootCanal>,
    /// Only with `root_canal`: the sitting (visit) of the treatment, 1 to 20.
    pub sitting: Option<i64>,
}

/// Findings recorded together.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewChartEntries {
    /// An id the client made for this request, any UUID. A retry with the same `client_id` and
    /// the same entries records nothing again and returns the chart as it is now; the same
    /// `client_id` for other entries is `id_conflict` (`409`), whoever's chart it was. Unique per
    /// clinic. The first entry of the batch carries it.
    #[schema(value_type = Option<String>)]
    pub client_id: Option<Uuid>,
    /// The open visit they were found in, if any.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// 1 to 64 entries, applied in order.
    pub entries: Vec<NewChartEntry>,
}

/// Records findings. Each supersedes the current entry for its tooth and surface (a crown,
/// implant or missing tooth also supersedes the tooth's surface entries); an entry with
/// `supersedes_id` corrects that entry, even on another tooth or surface. The history keeps
/// everything. Returns the updated chart.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/dental-chart",
    operation_id = "recordDentalChart",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    request_body = NewChartEntries,
    security(("bearer" = [])),
    responses(
        (status = 200, body = DentalChart),
        (status = 400, description = "A bad tooth, surface, finding, procedure or material, a visit of another patient, or a `supersedes_id` that isn't this patient's chart entry"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "The visit is closed, the corrected entry is no longer current, the chart changed at the same moment, or `id_conflict`: the client_id made other entries")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewChartEntries>,
) -> Result<Json<DentalChart>, ApiFailure> {
    let input = RecordChart {
        client_id: body.client_id,
        visit_id: body.visit_id,
        entries: body
            .entries
            .into_iter()
            .map(|entry| EntryInput {
                tooth: entry.tooth,
                surface: entry.surface,
                finding: entry.finding,
                procedure: entry.procedure,
                material: entry.material,
                note: entry.note,
                supersedes_id: entry.supersedes_id,
                canals: entry.canals.into_iter().map(Canal::from).collect(),
                sitting: entry.sitting,
            })
            .collect(),
    };
    let view = app::record(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// A procedure or material to add to the clinic's list.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewDentalTerm {
    /// `procedure` or `material`.
    pub kind: String,
    /// What the clinician reads, 1 to 80 characters.
    pub label: String,
}

/// Adds a procedure or material to the clinic's list ("Add new" in the chart's dropdowns). A
/// label matching a seeded term or one the clinic has (ignoring case) returns that term with
/// `200`; a new one answers `201`.
#[utoipa::path(
    post,
    path = "/api/v1/dental-terms",
    operation_id = "addDentalTerm",
    tag = "clinical",
    request_body = NewDentalTerm,
    security(("bearer" = [])),
    responses(
        (status = 201, body = DentalTerm, description = "Added"),
        (status = 200, body = DentalTerm, description = "Already in the list"),
        (status = 400, description = "An unknown list or a bad label"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 409, description = "The same label was added at the same moment")
    )
)]
pub(crate) async fn add_term(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiJson(body): ApiJson<NewDentalTerm>,
) -> Result<(StatusCode, Json<DentalTerm>), ApiFailure> {
    let (term, added) = app::add_term(
        state.db(),
        &request.actor,
        request.request_id,
        &body.kind,
        &body.label,
    )
    .await?;
    let status = if added {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(term.into())))
}
