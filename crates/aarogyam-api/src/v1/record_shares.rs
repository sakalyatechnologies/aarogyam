//! Links to a patient's records: the clinic makes one for the chart, X-rays and bills with a
//! chosen lifetime; the patient opens it on the clinic's host with the PIN.

use aarogyam_app::record_share::{self as app, OpenOutcome, XrayRefusal};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AttachmentId, PatientId};
use aarogyam_domain::permission::require::PatientsRead;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::{ApiFailure, not_found};

/// What to share and for how long.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewRecordShare {
    /// One to three different kinds: `chart`, `xrays`, `bills`. Each needs the matching
    /// permission (`clinical.read` for chart and X-rays, `billing.read` for bills).
    pub record_types: Vec<String>,
    /// How long the link works: `1h`, `24h` or `7d`.
    pub expires_in: String,
}

/// A new link to records. The token and PIN are shown once.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecordShare {
    /// The link's id.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Token for the link: `/shared/{token}` on the clinic's host.
    pub token: String,
    /// Six-digit PIN to tell the patient.
    pub pin: String,
    /// What the link shows.
    pub record_types: Vec<String>,
    /// When it stops working (RFC 3339).
    pub expires_at: String,
}

/// Makes a link for the patient to see chosen records, with a lifetime of 1 hour, 24 hours or
/// 7 days. Writes the access record (`share`, one entry per kind).
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/record-shares",
    operation_id = "createRecordShare",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = NewRecordShare,
    security(("bearer" = [])),
    responses(
        (status = 201, body = RecordShare),
        (status = 400, description = "Unknown or repeated record type, or a lifetime other than 1h, 24h, 7d"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read, or the permission for a chosen kind"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewRecordShare>,
) -> Result<(StatusCode, Json<RecordShare>), ApiFailure> {
    let made = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        &body.record_types,
        &body.expires_in,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ShareLinkCreated.as_str(), share_link_id = %made.link.id.uuid(), "share link created");
    Ok((
        StatusCode::CREATED,
        Json(RecordShare {
            id: made.link.id.uuid(),
            token: made.link.token,
            pin: made.link.pin,
            record_types: made
                .record_types
                .iter()
                .map(|kind| kind.as_str().to_owned())
                .collect(),
            expires_at: rfc3339(made.link.expires_at),
        }),
    ))
}

/// A link to records as listed: never its token or PIN.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecordShareItem {
    /// The link's id.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// What it shows.
    pub record_types: Vec<String>,
    /// `usable`, `expired` (past its expiry or revoked) or `locked` (too many wrong PINs).
    pub state: String,
    /// When it stops working.
    pub expires_at: String,
    /// When it was first opened.
    pub opened_at: Option<String>,
    /// How many times it was opened.
    pub open_count: i32,
    /// When it was made.
    pub created_at: String,
}

/// The patient's links to records.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecordShares {
    /// Newest first.
    pub items: Vec<RecordShareItem>,
}

/// The patient's links to records, newest first, with whether each can still be opened.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/record-shares",
    operation_id = "listRecordShares",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = RecordShares),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<RecordShares>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    let now = OffsetDateTime::now_utc();
    Ok(Json(RecordShares {
        items: rows
            .into_iter()
            .map(|row| RecordShareItem {
                id: row.id,
                record_types: row.record_types,
                state: super::prescriptions::state_name(aarogyam_domain::share::LinkState::of(
                    now,
                    row.expires_at,
                    row.revoked_at.is_some(),
                    row.locked_at.is_some(),
                ))
                .to_owned(),
                expires_at: rfc3339(row.expires_at),
                opened_at: row.opened_at.map(rfc3339),
                open_count: row.open_count,
                created_at: rfc3339(row.created_at),
            })
            .collect(),
    }))
}

/// The PIN.
#[derive(Debug, Deserialize, ToSchema)]
pub struct OpenRecords {
    /// The six digits the clinic gave.
    pub pin: String,
}

/// One tooth finding on the chart.
#[derive(Debug, Serialize, ToSchema)]
pub struct SharedChartEntry {
    /// FDI tooth number.
    pub tooth: Option<i16>,
    /// The surface, such as `O`.
    pub surface: Option<String>,
    /// The finding, such as `caries`.
    pub finding: Option<String>,
    /// The note.
    pub note: Option<String>,
    /// When the finding was made.
    pub effective_at: String,
}

/// An X-ray.
#[derive(Debug, Serialize, ToSchema)]
pub struct SharedXray {
    /// The file.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its label, such as `OPG`.
    pub label: Option<String>,
    /// A caption.
    pub caption: Option<String>,
    /// The tooth it shows.
    pub tooth: Option<i16>,
    /// When it was taken, or else uploaded.
    pub taken_at: String,
    /// Media type, such as `image/jpeg`.
    pub mime_type: String,
    /// Where to fetch it: a signed path on the clinic's host, good for ten minutes (never past
    /// the link's own expiry). Open the link again for a new one.
    pub url: String,
}

/// An issued bill.
#[derive(Debug, Serialize, ToSchema)]
pub struct SharedBill {
    /// The bill.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its number.
    pub number: Option<String>,
    /// When it was issued.
    pub issued_at: Option<String>,
    /// Its total, in paise.
    pub total_paise: i64,
    /// Paid so far, in paise.
    pub paid_paise: i64,
}

/// What an opened link shows; only the kinds the clinic chose are present.
#[derive(Debug, Serialize, ToSchema)]
pub struct SharedRecords {
    /// The patient's name.
    pub patient_name: String,
    /// The kinds shown.
    pub record_types: Vec<String>,
    /// The current chart; absent unless `chart` was shared.
    pub chart: Option<Vec<SharedChartEntry>>,
    /// X-rays, newest first; absent unless `xrays` was shared.
    pub xrays: Option<Vec<SharedXray>>,
    /// Issued bills; absent unless `bills` was shared.
    pub bills: Option<Vec<SharedBill>>,
    /// When the link stops working.
    pub expires_at: String,
}

fn shared(token: &str, records: app::Records) -> SharedRecords {
    SharedRecords {
        patient_name: records.patient_name,
        record_types: records
            .record_types
            .iter()
            .map(|kind| kind.as_str().to_owned())
            .collect(),
        chart: records.chart.map(|lines| {
            lines
                .into_iter()
                .map(|line| SharedChartEntry {
                    tooth: line.tooth,
                    surface: line.surface,
                    finding: line.finding,
                    note: line.note,
                    effective_at: rfc3339(line.effective_at),
                })
                .collect()
        }),
        xrays: records.xrays.map(|list| {
            list.into_iter()
                .map(|item| SharedXray {
                    url: format!(
                        "/api/v1/shared/{token}/records/xrays/{}?sig={}",
                        item.xray.id, item.sig
                    ),
                    id: item.xray.id,
                    label: item.xray.label,
                    caption: item.xray.caption,
                    tooth: item.xray.tooth,
                    taken_at: rfc3339(item.xray.taken_at.unwrap_or(item.xray.created_at)),
                    mime_type: item.xray.mime_type,
                })
                .collect()
        }),
        bills: records.bills.map(|list| {
            list.into_iter()
                .map(|bill| SharedBill {
                    id: bill.id,
                    number: bill.number,
                    issued_at: bill.issued_at.map(rfc3339),
                    total_paise: bill.total_paise,
                    paid_paise: bill.paid_paise,
                })
                .collect()
        }),
        expires_at: rfc3339(records.expires_at),
    }
}

/// Public, no sign-in: opens a link to records with the PIN. Five wrong PINs lock the link.
/// Every open is written to the access record.
#[utoipa::path(
    post,
    path = "/api/v1/shared/{token}/records",
    operation_id = "openSharedRecords",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    request_body = OpenRecords,
    responses(
        (status = 200, body = SharedRecords),
        (status = 403, description = "Wrong PIN; the message says how many tries are left"),
        (status = 404, description = "No such link, or not a link to records"),
        (status = 410, description = "Expired"),
        (status = 423, description = "Locked after too many wrong PINs")
    )
)]
pub(crate) async fn open(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath(token): ApiPath<String>,
    ApiJson(body): ApiJson<OpenRecords>,
) -> Result<Response, ApiFailure> {
    let outcome = app::open(
        state.db(),
        state.files()?,
        public.clinic_id,
        public.request_id,
        &token,
        &body.pin,
        OffsetDateTime::now_utc(),
    )
    .await?;
    let refuse = |status: StatusCode, code: &str, message: String| {
        (
            status,
            Json(serde_json::json!({ "error": { "code": code, "message": message } })),
        )
            .into_response()
    };
    Ok(match outcome {
        OpenOutcome::Opened(records) => {
            tracing::info!(event = Event::ShareLinkOpened.as_str(), "share link opened");
            Json(shared(&token, *records)).into_response()
        }
        OpenOutcome::WrongPin(left) => refuse(
            StatusCode::FORBIDDEN,
            "wrong_pin",
            format!("The PIN is wrong. {left} tries left."),
        ),
        OpenOutcome::Locked => {
            tracing::info!(event = Event::ShareLinkLocked.as_str(), "share link locked");
            refuse(
                StatusCode::LOCKED,
                "locked",
                "Too many wrong PINs. Ask the clinic for a new link.".into(),
            )
        }
        OpenOutcome::Expired => refuse(
            StatusCode::GONE,
            "expired",
            "This link has expired. Ask the clinic for a new one.".into(),
        ),
    })
}

/// The signed token from an X-ray's `url`.
#[derive(Debug, Deserialize)]
pub struct XrayQuery {
    #[serde(default)]
    pub sig: String,
}

/// Public, no sign-in: streams an X-ray through the signed `url` an opened link returned. Works
/// while the link does and for ten minutes at most; each download is written to the access
/// record.
#[utoipa::path(
    get,
    path = "/api/v1/shared/{token}/records/xrays/{id}",
    operation_id = "getSharedXrayContent",
    tag = "public",
    params(
        ("token" = String, Path, description = "The link's token"),
        ("id" = String, Path, description = "The X-ray"),
        ("sig" = String, Query, description = "The signed token from the X-ray's url")
    ),
    responses(
        (status = 200, description = "The file, with its media type"),
        (status = 403, description = "The signed token or the link has expired; open the link again"),
        (status = 404, description = "Not a valid link, token or X-ray of this clinic")
    )
)]
pub(crate) async fn xray_content(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath((token, id)): ApiPath<(String, Uuid)>,
    ApiQuery(query): ApiQuery<XrayQuery>,
) -> Result<Response, ApiFailure> {
    let file = app::xray(
        state.db(),
        state.files()?,
        public.clinic_id,
        public.request_id,
        &token,
        AttachmentId::from_uuid(id),
        &query.sig,
        OffsetDateTime::now_utc(),
    )
    .await
    .map_err(|refusal| match refusal {
        XrayRefusal::Expired => ApiFailure::Error(ApiError::forbidden(
            "link_expired",
            "This link has expired; open the link again.",
        )),
        XrayRefusal::NotFound => ApiFailure::Error(not_found()),
        XrayRefusal::Failed(error) => error.into(),
    })?;
    let mime = HeaderValue::from_str(&file.mime_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    let mut response = file.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, mime);
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    Ok(response)
}
