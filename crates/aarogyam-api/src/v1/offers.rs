//! Offers and referral codes (docs/plans/visit-story-v2-offers-design.md §2.6). Codes travel in
//! JSON bodies only, never in URLs; answers that carry one are `Cache-Control: no-store`, and
//! nothing here logs a code.

use aarogyam_app::promo as app;
use aarogyam_domain::ids::{EncounterId, InvoiceId, PatientId};
use aarogyam_domain::permission::require::{
    BillingRead, BillingWrite, ClinicalRead, OffersGive, PaymentsCollect, SettingsManage,
};
use aarogyam_domain::promo::DiscountKind;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::billing::Invoice;
use crate::AppState;
use crate::extract::{Require, RequireBoth, RequireEither};
use crate::failure::ApiFailure;

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/settings/offers", get(get_settings).put(put_settings))
        .route("/visits/{id}/offers", get(visit_offers).post(issue))
        .route("/promo-codes/{id}/revoke", post(revoke))
        .route("/patients/{id}/offers", get(patient_offers))
        .route("/invoices/{id}/promo", post(apply).delete(remove))
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths(
    get_settings,
    put_settings,
    visit_offers,
    issue,
    revoke,
    patient_offers,
    apply,
    remove
))]
pub(crate) struct Doc;

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The clinic's offer settings (`org_settings.billing.offers`). Every key is optional on read
/// back; see docs/plans/visit-story-v2-offers-design.md §2.2 for the defaults.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[schema(value_type = Object)]
pub struct OfferSettings(pub Value);

/// A code as staff see it.
#[derive(Debug, Serialize, ToSchema)]
pub struct IssuedCode {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The code as shown, `K7QM-4XRD`. Never put it in a URL or a log.
    pub code: String,
    /// `patient_offer`, `referral` or `referrer_reward` (a documented string).
    pub purpose: String,
    /// `percent_bps` or `fixed` (a documented string).
    pub kind: String,
    /// Basis points (`percent_bps`) or paise (`fixed`).
    pub value: i64,
    /// The cap on a percentage code's discount, in paise.
    pub max_discount_paise: Option<i64>,
    /// The last clinic day it works, `YYYY-MM-DD`.
    pub valid_to: String,
    /// The target label `{plan_item_id?, procedure_id?, tooth?, procedure_term?, words}`; absent
    /// for "the next treatment".
    #[schema(value_type = Option<Object>)]
    pub applies_to: Option<Value>,
}

impl From<app::IssuedCode> for IssuedCode {
    fn from(code: app::IssuedCode) -> Self {
        Self {
            id: code.id,
            code: code.code,
            purpose: code.purpose.as_str().to_owned(),
            kind: code.kind.as_str().to_owned(),
            value: code.value,
            max_discount_paise: code.max_discount_paise,
            valid_to: code.valid_to.to_string(),
            applies_to: code.applies_to,
        }
    }
}

/// The clinic's presets, lowered to the caller's caps.
#[derive(Debug, Serialize, ToSchema)]
pub struct OfferPresets {
    /// The clinic gives patient offers.
    pub offer_enabled: bool,
    /// The one-tap offer: `percent_bps` or `fixed`.
    pub offer_kind: String,
    /// Its value.
    pub offer_value: i64,
    /// Its validity in days.
    pub offer_valid_days: i64,
    /// Its cap, for a percentage.
    pub offer_max_discount_paise: Option<i64>,
    /// The clinic gives referral codes.
    pub referral_enabled: bool,
    /// What a friend gets: `percent_bps` or `fixed`.
    pub referral_kind: String,
    /// Its value.
    pub referral_value: i64,
    /// The friend's cap, in paise.
    pub referral_max_discount_paise: i64,
    /// The referral code's validity in days.
    pub referral_valid_days: i64,
    /// The caller's highest percentage, basis points.
    pub max_percent_bps: i64,
    /// The caller's highest fixed amount, paise.
    pub max_fixed_paise: i64,
    /// The caller's longest validity, days.
    pub max_valid_days: i64,
}

/// A visit's live codes and the caller's presets.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitOffers {
    /// The patient's offer from this visit.
    pub patient_offer: Option<IssuedCode>,
    /// The patient's referral code.
    pub referral: Option<IssuedCode>,
    /// The presets.
    pub presets: OfferPresets,
}

impl From<app::VisitOffers> for VisitOffers {
    fn from(offers: app::VisitOffers) -> Self {
        let p = offers.presets;
        Self {
            patient_offer: offers.patient_offer.map(Into::into),
            referral: offers.referral.map(Into::into),
            presets: OfferPresets {
                offer_enabled: p.offer_enabled,
                offer_kind: p.offer.kind.as_str().to_owned(),
                offer_value: p.offer.value,
                offer_valid_days: p.offer.valid_days,
                offer_max_discount_paise: p.offer.max_discount_paise,
                referral_enabled: p.referral_enabled,
                referral_kind: p.referral_kind.as_str().to_owned(),
                referral_value: p.referral_value,
                referral_max_discount_paise: p.referral_max_discount_paise,
                referral_valid_days: p.referral_valid_days,
                max_percent_bps: p.caps.max_percent_bps,
                max_fixed_paise: p.caps.max_fixed_paise,
                max_valid_days: p.caps.max_valid_days,
            },
        }
    }
}

/// An offer's requested terms; anything left out comes from the presets.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NewPatientOffer {
    /// `percent_bps` or `fixed`.
    pub kind: Option<String>,
    /// Basis points or paise.
    pub value: Option<i64>,
    /// Days, from today.
    pub valid_days: Option<i64>,
    /// The patient's plan item it targets.
    #[schema(value_type = Option<String>)]
    pub plan_item_id: Option<Uuid>,
}

/// What to give at the end of the visit.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NewVisitOffers {
    /// An offer (`{}` for the presets); absent or null for none.
    pub patient_offer: Option<NewPatientOffer>,
    /// A referral code.
    #[serde(default)]
    pub referral: bool,
}

/// Why a code is revoked.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RevokePromoCode {
    /// `undo` (the giver's Undo) or `staff`.
    pub reason: String,
}

/// A code applied to a draft bill.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ApplyPromoCode {
    /// The code as typed or shown (case, spaces and hyphens don't matter).
    pub code: String,
    /// Apply a targeted offer although the visit didn't record its target (`billing.write`).
    #[serde(default)]
    pub r#override: bool,
}

/// One of a patient's codes at the desk.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientCode {
    /// The code.
    pub offer: IssuedCode,
    /// Passes the visit check on the bill asked about.
    pub eligible: bool,
    /// Why not, such as `promo_not_for_this_visit`.
    pub reason: Option<String>,
}

/// A patient's live offers and rewards.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientOffers {
    /// Codes, soonest to expire first.
    pub codes: Vec<PatientCode>,
}

/// Which bill the visit check is for.
#[derive(Debug, Deserialize)]
pub(crate) struct PatientOffersQuery {
    invoice_id: Option<Uuid>,
}

fn settings_body(
    settings: &aarogyam_domain::promo::OfferSettings,
) -> Result<Json<OfferSettings>, ApiFailure> {
    serde_json::to_value(settings)
        .map(|value| Json(OfferSettings(value)))
        .map_err(|_| ApiFailure::from(aarogyam_app::error::AppError::Internal("settings")))
}

/// The clinic's offer settings.
#[utoipa::path(
    get,
    path = "/api/v1/settings/offers",
    operation_id = "getOfferSettings",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = OfferSettings, description = "The settings, defaults filled in"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage and offers.give")
    )
)]
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<SettingsManage, OffersGive>,
) -> Result<Json<OfferSettings>, ApiFailure> {
    let settings = app::settings(state.db(), &request.actor, request.request_id).await?;
    settings_body(&settings)
}

/// Replaces the clinic's offer settings. Unknown keys, a missing `max_discount_paise` or a value
/// out of range are refused.
#[utoipa::path(
    put,
    path = "/api/v1/settings/offers",
    operation_id = "putOfferSettings",
    tag = "settings",
    request_body = OfferSettings,
    security(("bearer" = [])),
    responses(
        (status = 200, body = OfferSettings, description = "Saved"),
        (status = 400, description = "A field is missing, unknown or out of range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn put_settings(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<OfferSettings>,
) -> Result<Json<OfferSettings>, ApiFailure> {
    let settings =
        app::save_settings(state.db(), &request.actor, request.request_id, body.0).await?;
    settings_body(&settings)
}

/// The visit's live offer and the patient's referral code, with the caller's presets.
#[utoipa::path(
    get,
    path = "/api/v1/visits/{id}/offers",
    operation_id = "getVisitOffers",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = VisitOffers, description = "Codes and presets; `Cache-Control: no-store`"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such visit in this clinic")
    )
)]
pub(crate) async fn visit_offers(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiFailure> {
    let offers = app::visit_offers(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
    )
    .await?;
    Ok(no_store(Json(VisitOffers::from(offers)).into_response()))
}

/// Gives the visit's patient an offer and/or a referral code, within the caller's caps. Asking
/// again returns the live ones (200); 201 when something was created.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/offers",
    operation_id = "issueVisitOffers",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = NewVisitOffers,
    security(("bearer" = [])),
    responses(
        (status = 200, body = VisitOffers, description = "Already given; `Cache-Control: no-store`"),
        (status = 201, body = VisitOffers, description = "Given; `Cache-Control: no-store`"),
        (status = 400, description = "`over_cap`, or a bad field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read or offers.give"),
        (status = 404, description = "No such visit in this clinic"),
        (status = 409, description = "`visit_open` or `offer_disabled`")
    )
)]
pub(crate) async fn issue(
    State(state): State<AppState>,
    RequireBoth { request, .. }: RequireBoth<ClinicalRead, OffersGive>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewVisitOffers>,
) -> Result<Response, ApiFailure> {
    let patient_offer = match body.patient_offer {
        Some(offer) => Some(app::NewPatientOffer {
            kind: match offer.kind.as_deref() {
                Some(text) => Some(DiscountKind::parse(text).ok_or_else(|| {
                    ApiFailure::from(aarogyam_app::error::AppError::invalid(
                        "patient_offer.kind",
                        "must be percent_bps or fixed",
                    ))
                })?),
                None => None,
            },
            value: offer.value,
            valid_days: offer.valid_days,
            plan_item_id: offer.plan_item_id,
        }),
        None => None,
    };
    let (offers, created) = app::issue_visit_offers(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        app::NewVisitOffers {
            patient_offer,
            referral: body.referral,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok(no_store(
        (status, Json(VisitOffers::from(offers))).into_response(),
    ))
}

/// Revokes a code: held uses come off their drafts; final ones stay.
#[utoipa::path(
    post,
    path = "/api/v1/promo-codes/{id}/revoke",
    operation_id = "revokePromoCode",
    tag = "billing",
    params(("id" = String, Path, description = "The code's id")),
    request_body = RevokePromoCode,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Revoked"),
        (status = 400, description = "Bad reason"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks offers.give (own codes) or settings.manage"),
        (status = 404, description = "No such code in this clinic"),
        (status = 409, description = "`already_revoked`")
    )
)]
pub(crate) async fn revoke(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<OffersGive, SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RevokePromoCode>,
) -> Result<StatusCode, ApiFailure> {
    app::revoke(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        &body.reason,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The patient's live offers and rewards for the desk. With `invoice_id`, each says whether
/// the bill's visit recorded its target.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/offers",
    operation_id = "getPatientOffers",
    tag = "billing",
    params(
        ("id" = String, Path, description = "The patient"),
        ("invoice_id" = Option<String>, Query, description = "A draft bill of the patient, for the visit check")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientOffers, description = "Codes; `Cache-Control: no-store`"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.read and payments.collect"),
        (status = 404, description = "No such patient, or bill of theirs, in this clinic")
    )
)]
pub(crate) async fn patient_offers(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<BillingRead, PaymentsCollect>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<PatientOffersQuery>,
) -> Result<Response, ApiFailure> {
    let codes = app::patient_offers(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        query.invoice_id.map(InvoiceId::from_uuid),
        OffsetDateTime::now_utc(),
    )
    .await?;
    let codes = codes
        .into_iter()
        .map(|code| PatientCode {
            offer: code.code.into(),
            eligible: code.eligible,
            reason: code.reason.map(str::to_owned),
        })
        .collect();
    Ok(no_store(Json(PatientOffers { codes }).into_response()))
}

/// Applies a code to a draft bill: the discount comes off every line before GST. A
/// `payments.collect` holder without `billing.write` applies only the patient's own offer or
/// reward. Ten unknown codes in ten minutes from one member get 429.
#[utoipa::path(
    post,
    path = "/api/v1/invoices/{id}/promo",
    operation_id = "applyPromoCode",
    tag = "billing",
    params(("id" = String, Path, description = "The draft bill")),
    request_body = ApplyPromoCode,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Invoice, description = "The bill with the code held"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write and payments.collect, or `hold_elsewhere`"),
        (status = 404, description = "No such bill or code in this clinic"),
        (status = 409, description = "`promo_expired`, `promo_used`, `promo_revoked`, `promo_not_this_patient`, `promo_not_new_patient`, `promo_needs_billing_write`, `promo_no_eligible_line`, `promo_not_for_this_visit`, `not_draft` or `bill_has_promo`"),
        (status = 429, description = "Too many unknown codes")
    )
)]
pub(crate) async fn apply(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<BillingWrite, PaymentsCollect>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ApplyPromoCode>,
) -> Result<Response, ApiFailure> {
    let result = app::apply(
        state.db(),
        &request.actor,
        request.request_id,
        InvoiceId::from_uuid(id),
        &body.code,
        body.r#override,
        OffsetDateTime::now_utc(),
    )
    .await;
    match result {
        Ok(view) => Ok(Json(Invoice::from(view)).into_response()),
        Err(error @ aarogyam_app::error::AppError::NotFound("promo code")) => {
            // A miss counts against the member (m11); the store is per instance.
            if let Some(throttle) = state.throttle() {
                let member = request.actor.membership_id.uuid().to_string();
                if let Err(limited) = throttle.check("member-promo-miss", &member).await {
                    return Ok(limited.into_response());
                }
            }
            Err(error.into())
        }
        Err(error) => Err(error.into()),
    }
}

/// Takes the code off a draft bill; the code can be used again.
#[utoipa::path(
    delete,
    path = "/api/v1/invoices/{id}/promo",
    operation_id = "removePromoCode",
    tag = "billing",
    params(("id" = String, Path, description = "The draft bill")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Invoice, description = "The bill without the code"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write and payments.collect, or `not_applier`"),
        (status = 404, description = "No such bill in this clinic, or it has no code"),
        (status = 409, description = "`not_draft`")
    )
)]
pub(crate) async fn remove(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<BillingWrite, PaymentsCollect>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Invoice>, ApiFailure> {
    let view = app::remove(
        state.db(),
        &request.actor,
        request.request_id,
        InvoiceId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}
