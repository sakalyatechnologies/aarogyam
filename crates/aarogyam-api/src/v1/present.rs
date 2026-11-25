//! The studio layer of Show patient (docs/plans/present-studio-design.md, sections 5.1 and 12.5):
//! the usual options compared for the situations the visit's record shows. General guidance from
//! the specialty data, never about this patient beyond which situations are recorded. Prices
//! (slice 2b) only for `billing.read` and `show_prices`.

use aarogyam_app::present as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::require::{ClinicalRead, SettingsManage};
use aarogyam_domain::present as domain;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The studio layer of a visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentStudio {
    /// The recorded situations, by tooth, each with its usual options.
    pub situations: Vec<PresentSituation>,
    /// "From" prices; present only for a member with `billing.read` when the clinic turned
    /// prices on. An option with an unmapped part has no entry: show "Ask the front desk".
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prices: Option<Vec<PresentPrice>>,
}

/// A "from" price for one option.
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentPrice {
    /// The option's key.
    pub option_key: String,
    /// Sum of the clinic's mapped price items, in paise.
    pub from_paise: i64,
}

/// The clinic's Show patient settings.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PresentSettingsBody {
    /// Whether prices may be shown behind the doctor's Prices tap.
    #[serde(default)]
    pub show_prices: bool,
    /// `"<procedure>[:<material>]"` to a price item code.
    #[serde(default)]
    pub price_map: std::collections::BTreeMap<String, String>,
}

/// A recorded situation on one tooth.
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentSituation {
    /// `deep_decay`, `infection`, `missing` or `impacted_wisdom` (a plain string; more may come).
    pub key: String,
    /// FDI tooth.
    pub tooth: u8,
    /// Words for the situation.
    pub title: String,
    /// True when only the planned treatment suggests this situation: nothing recorded on the
    /// tooth shows it, so say what the doctor recommends, never claim a finding. Absent otherwise.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub from_plan: bool,
    /// What waiting usually leads to, in order. General guidance ("Illustration · general guidance");
    /// absent when there are no words.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub if_wait: Option<Vec<PresentWaitStage>>,
    /// The usual options. General guidance: show "Usual options · general guidance".
    pub options: Vec<PresentOption>,
}

/// One stage of what waiting usually leads to.
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentWaitStage {
    /// Short name of the stage, such as "Usually next".
    pub stage: String,
    /// What the patient reads.
    pub words: String,
}

/// One usual option for a situation.
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentOption {
    /// Stable key, such as `rct_crown`.
    pub key: String,
    /// Short name.
    pub label: String,
    /// What is done.
    pub summary: String,
    /// How it looks afterwards, in words.
    pub looks_like: String,
    /// Usual visits.
    pub visits: PresentRange,
    /// Usual time to finish; absent when nothing is done.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish: Option<PresentFinish>,
    /// An art key for the illustration (an `art-map.json` value).
    pub look: String,
    /// Typical lifespan words; absent unless the guidance has some.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifespan: Option<PresentLifespan>,
    /// How it feels, in words.
    pub comfort: String,
    /// True on the one option that is the same work as a treatment already planned or in progress
    /// on this tooth: show it first as "Your dentist suggests". Absent otherwise.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested: Option<bool>,
}

/// A range of whole numbers.
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentRange {
    /// Fewest.
    pub min: u8,
    /// Most.
    pub max: u8,
}

/// How long an option takes to finish.
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentFinish {
    /// Shortest.
    pub min: u8,
    /// Longest.
    pub max: u8,
    /// `days`, `weeks` or `months`.
    pub unit: String,
}

/// Outcome words: "General guidance, not a promise. Your dentist will advise."
#[derive(Debug, Serialize, ToSchema)]
pub struct PresentLifespan {
    /// What the patient reads.
    pub words: String,
    /// Why we say it.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// The paper; present whenever the words carry a number.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// The exact sentence the number comes from.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_quote: Option<String>,
}

impl From<domain::PresentStudio> for PresentStudio {
    fn from(s: domain::PresentStudio) -> Self {
        Self {
            prices: s.prices.map(|p| {
                p.into_iter()
                    .map(|p| PresentPrice {
                        option_key: p.option_key,
                        from_paise: p.from_paise,
                    })
                    .collect()
            }),
            situations: s
                .situations
                .into_iter()
                .map(|s| PresentSituation {
                    key: s.key,
                    tooth: s.tooth,
                    title: s.title,
                    from_plan: s.from_plan,
                    if_wait: (!s.if_wait.is_empty()).then(|| {
                        s.if_wait
                            .into_iter()
                            .map(|w| PresentWaitStage {
                                stage: w.stage,
                                words: w.words,
                            })
                            .collect()
                    }),
                    options: s
                        .options
                        .into_iter()
                        .map(|o| PresentOption {
                            key: o.key,
                            label: o.label,
                            summary: o.summary,
                            looks_like: o.looks_like,
                            visits: PresentRange {
                                min: o.visits.min,
                                max: o.visits.max,
                            },
                            finish: o.finish.map(|f| PresentFinish {
                                min: f.min,
                                max: f.max,
                                unit: f.unit,
                            }),
                            look: o.look,
                            lifespan: o.lifespan.map(|l| PresentLifespan {
                                words: l.words,
                                why: l.why,
                                source: l.source,
                                source_quote: l.source_quote,
                            }),
                            comfort: o.comfort,
                            suggested: o.suggested.then_some(true),
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

/// The studio layer of a visit for Show patient: the usual options for each recorded situation
/// (deep decay, a missing tooth, a wisdom tooth not fully out). It works while the visit is open.
#[utoipa::path(
    get,
    path = "/api/v1/visits/{id}/present",
    operation_id = "getVisitPresent",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PresentStudio, description = "The studio layer; `Cache-Control: no-store`"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such visit in this clinic or the caller's reach")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiFailure> {
    let studio = app::studio(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    let mut response = Json(PresentStudio::from(studio)).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

impl From<domain::PresentSettings> for PresentSettingsBody {
    fn from(s: domain::PresentSettings) -> Self {
        Self {
            show_prices: s.show_prices,
            price_map: s.price_map,
        }
    }
}

/// The clinic's Show patient settings: the price mapping and whether prices may be shown.
#[utoipa::path(
    get,
    path = "/api/v1/settings/present",
    operation_id = "getPresentSettings",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PresentSettingsBody),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<PresentSettingsBody>, ApiFailure> {
    let settings = app::settings(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(settings.into()))
}

/// Replaces the Show patient price mapping and show-prices switch. 400 on an unknown key
/// (not a seeded procedure or material), an unknown or inactive price code, or an unknown field.
#[utoipa::path(
    put,
    path = "/api/v1/settings/present",
    operation_id = "updatePresentSettings",
    tag = "settings",
    request_body = PresentSettingsBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = PresentSettingsBody),
        (status = 400, description = "Invalid input; the message names the key"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn put_settings(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<PresentSettingsBody>,
) -> Result<Json<PresentSettingsBody>, ApiFailure> {
    let settings = domain::PresentSettings {
        show_prices: body.show_prices,
        price_map: body.price_map,
    };
    let saved =
        app::update_settings(state.db(), &request.actor, request.request_id, settings).await?;
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        "present settings changed"
    );
    Ok(Json(saved.into()))
}
