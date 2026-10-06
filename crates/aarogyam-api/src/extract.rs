//! Request extractors that carry the result of every access check. A handler can't reach clinic
//! data without a [`ClinicRequest`] (or [`Require`]), which can't be built unless the host is a
//! clinic, the token is valid, and the person is an active member.

use std::marker::PhantomData;

use aarogyam_dal::lookups::{self, HostClinic, PlatformAccess};
use aarogyam_domain::access::{ClinicActor, ClinicStatus, Denied};
use aarogyam_domain::permission::Required;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use sakalya_auth::Claims;
use sakalya_http::{ApiError, Edge, REQUEST_ID_HEADER};
use uuid::Uuid;

use crate::AppState;
use crate::failure::{ApiFailure, not_found};

fn edge(parts: &Parts) -> Result<&Edge, ApiFailure> {
    parts
        .extensions
        .get::<Edge>()
        .ok_or_else(|| ApiFailure::Error(ApiError::internal("the edge layer is not installed")))
}

fn request_id(parts: &Parts) -> Option<Uuid> {
    parts
        .headers
        .get(REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|text| Uuid::parse_str(text).ok())
}

/// A signed-in person whose session wasn't revoked, on any host. For routes that don't belong
/// to one clinic (`/me`).
#[derive(Debug)]
pub struct SignedIn {
    /// The verified token.
    pub claims: Claims,
}

impl FromRequestParts<AppState> for SignedIn {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let claims = state.live_claims(&parts.headers).await?;
        sakalya_telemetry::record_user(claims.subject().uuid());
        Ok(Self { claims })
    }
}

/// An active member acting in the clinic named by the host. Unknown hosts, closed clinics and
/// non-members all get the same `404`; a bad or missing token gets `401`.
#[derive(Debug)]
pub struct ClinicRequest {
    /// Who is acting, where, with what permissions.
    pub actor: ClinicActor,
    /// The request ID, for the change history and access record.
    pub request_id: Option<Uuid>,
}

impl FromRequestParts<AppState> for ClinicRequest {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let host = edge(parts)?.host().as_str().to_owned();
        let hosts = state.hosts();
        if host == hosts.console || host == hosts.app {
            return Err(ApiFailure::Error(not_found()));
        }
        let is_open = |clinic: &HostClinic| clinic.status.is_some_and(ClinicStatus::is_open);
        let (clinic, authorization) = if let Some(clinic) = state.cached_host(&host) {
            let clinic = Some(clinic).filter(is_open).ok_or(Denied::UnknownClinic)?;
            let claims = state.claims(&parts.headers).await?;
            let authorization = state.authorization(clinic.clinic_id, &claims).await?;
            (clinic, authorization)
        } else {
            // Nothing cached: the host and the member in one round trip. An unknown or closed
            // host still answers 404 before a bad token's 401, as when they were two lookups.
            let claims = match state.claims(&parts.headers).await {
                Ok(claims) => claims,
                Err(failure) => {
                    state
                        .clinic_for_host(&host)
                        .await?
                        .filter(is_open)
                        .ok_or(Denied::UnknownClinic)?;
                    return Err(failure);
                }
            };
            let (clinic, authorization) = state
                .host_and_authorization(&host, &claims)
                .await?
                .ok_or(Denied::UnknownClinic)?;
            let clinic = Some(clinic).filter(is_open).ok_or(Denied::UnknownClinic)?;
            (clinic, authorization)
        };
        let authorization = authorization.ok_or(Denied::NotAMember)?;
        let actor = ClinicActor::admit(clinic.place(), authorization)?;
        sakalya_telemetry::record_tenant(actor.clinic_id.uuid());
        sakalya_telemetry::record_user(actor.user_id.uuid());
        Ok(Self {
            actor,
            request_id: request_id(parts),
        })
    }
}

/// The open clinic named by the host, for routes that carry their own proof of access instead
/// of a sign-in token (signed download links). Unknown hosts and closed clinics get `404`.
#[derive(Debug)]
pub struct ClinicHost {
    /// The clinic.
    pub clinic_id: aarogyam_domain::ids::ClinicId,
    /// The clinic with its time zone and number prefix.
    pub place: aarogyam_domain::access::ClinicPlace,
    /// The request ID, for the access record.
    pub request_id: Option<Uuid>,
}

impl FromRequestParts<AppState> for ClinicHost {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let host = edge(parts)?.host().as_str().to_owned();
        let hosts = state.hosts();
        if host == hosts.console || host == hosts.app {
            return Err(ApiFailure::Error(not_found()));
        }
        let clinic = state
            .clinic_for_host(&host)
            .await?
            .filter(|clinic| clinic.status.is_some_and(ClinicStatus::is_open))
            .ok_or_else(|| ApiFailure::Error(not_found()))?;
        sakalya_telemetry::record_tenant(clinic.clinic_id.uuid());
        Ok(Self {
            clinic_id: clinic.clinic_id,
            place: clinic.place(),
            request_id: request_id(parts),
        })
    }
}

/// A [`ClinicRequest`] whose role holds permission `P`; otherwise `403`. Every clinic route takes
/// one of these, so a route can't be written without naming its permission.
#[derive(Debug)]
pub struct Require<P: Required> {
    /// The checked request.
    pub request: ClinicRequest,
    permission: PhantomData<P>,
}

impl<P: Required> FromRequestParts<AppState> for Require<P> {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let request = ClinicRequest::from_request_parts(parts, state).await?;
        request.actor.require(P::PERMISSION)?;
        Ok(Self {
            request,
            permission: PhantomData,
        })
    }
}

/// Active Sakalya staff on the console host. Other hosts get `404`; people who aren't staff get
/// `403`.
#[derive(Debug)]
pub struct PlatformRequest {
    /// The staff member and their console role.
    pub staff: PlatformAccess,
    /// The request ID, for the change history.
    pub request_id: Option<Uuid>,
}

impl FromRequestParts<AppState> for PlatformRequest {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if edge(parts)?.host().as_str() != state.hosts().console {
            return Err(ApiFailure::Error(not_found()));
        }
        let claims = state.live_claims(&parts.headers).await?;
        let staff = lookups::platform_access(state.db().pool(), claims.subject().uuid())
            .await?
            .filter(|staff| staff.role.is_some())
            .ok_or_else(|| ApiError::forbidden("forbidden", "Sakalya staff only."))?;
        sakalya_telemetry::record_user(staff.user_id.uuid());
        Ok(Self {
            staff,
            request_id: request_id(parts),
        })
    }
}
