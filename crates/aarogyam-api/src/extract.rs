//! Request extractors that carry the result of every access check. A handler can't reach clinic
//! data without a [`ClinicRequest`] (or [`Require`]), which can't be built unless the host is a
//! clinic, the token is valid, and the person is an active member.

use std::marker::PhantomData;

use aarogyam_dal::lookups::{self, HostClinic, PlatformAccess};
use aarogyam_domain::access::{ClinicActor, ClinicStatus, Denied};
use aarogyam_domain::permission::Required;
use axum::extract::{FromRequestParts, MatchedPath};
use axum::http::header;
use axum::http::request::Parts;
use sakalya_auth::{AssuranceLevel, Claims};
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

/// The host the request was made to, as the edge vouches for it (or the `Host` header
/// locally). For routes that check a host themselves, such as redeeming a sign-in handoff.
#[derive(Debug)]
pub(crate) struct RequestHost(pub(crate) String);

impl FromRequestParts<AppState> for RequestHost {
    type Rejection = ApiFailure;

    fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> impl Future<Output = Result<Self, Self::Rejection>> {
        std::future::ready(edge(parts).map(|edge| Self(edge.host().as_str().to_owned())))
    }
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
        Self::admit(parts, state, false).await
    }
}

impl ClinicRequest {
    /// Checks the host, the token and the membership. With `allow_support`, Sakalya staff with
    /// an active support grant at the clinic are admitted too, read-only: only routes that name
    /// a permission ([`Require`], [`RequireEither`]) allow them, never member-only routes.
    async fn admit(
        parts: &Parts,
        state: &AppState,
        allow_support: bool,
    ) -> Result<Self, ApiFailure> {
        let host = edge(parts)?.host().as_str().to_owned();
        let hosts = state.hosts();
        if host == hosts.console || host == hosts.app {
            return Err(ApiFailure::Error(not_found()));
        }
        let is_open = |clinic: &HostClinic| clinic.status.is_some_and(ClinicStatus::is_open);
        let (clinic, authorization, claims) = if let Some(clinic) = state.cached_host(&host) {
            let clinic = Some(clinic).filter(is_open).ok_or(Denied::UnknownClinic)?;
            let claims = state.claims(&parts.headers).await?;
            let authorization = state.authorization(clinic.clinic_id, &claims).await?;
            (clinic, authorization, claims)
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
            (clinic, authorization, claims)
        };
        let actor = match authorization.map(|found| ClinicActor::admit(clinic.place(), found)) {
            Some(Ok(actor)) => actor,
            Some(Err(Denied::NotAMember)) | None if allow_support => {
                support_actor(parts, state, &clinic, &claims).await?
            }
            Some(Err(denied)) => return Err(denied.into()),
            None => return Err(Denied::NotAMember.into()),
        };
        sakalya_telemetry::record_tenant(actor.clinic_id.uuid());
        sakalya_telemetry::record_user(actor.user_id.uuid());
        Ok(Self {
            actor,
            request_id: request_id(parts),
        })
    }
}

/// Sakalya staff with an active support grant at `clinic`, recording this request under the
/// grant (method and route template only). Anyone else is a non-member (`404`).
async fn support_actor(
    parts: &Parts,
    state: &AppState,
    clinic: &HostClinic,
    claims: &Claims,
) -> Result<ClinicActor, ApiFailure> {
    let session = claims.session_id().ok_or_else(ApiError::unauthenticated)?;
    let expires_at = time::OffsetDateTime::from_unix_timestamp(claims.expires_at())
        .map_err(|_| ApiError::unauthenticated())?;
    let route = parts
        .extensions
        .get::<MatchedPath>()
        .map_or("unknown", MatchedPath::as_str);
    let request_text = request_id(parts).map(|id| id.to_string());
    let action = aarogyam_dal::support::Action {
        method: parts.method.as_str(),
        route,
        request_id: request_text.as_deref(),
    };
    let access = aarogyam_app::support::authorize(
        state.db(),
        clinic.clinic_id,
        claims.subject().uuid(),
        (session, expires_at),
        action,
    )
    .await?
    .ok_or(Denied::NotAMember)?;
    // As in the console: reading a clinic's records needs the second step.
    if state.staff_mfa() && claims.assurance_level() != AssuranceLevel::Aal2 {
        return Err(ApiError::forbidden(
            "mfa_required",
            "Support access needs your authenticator code. Open the console to enter it.",
        )
        .into());
    }
    Ok(ClinicActor::support(clinic.place(), access)?)
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
        let request = ClinicRequest::admit(parts, state, true).await?;
        request.actor.require(P::PERMISSION)?;
        Ok(Self {
            request,
            permission: PhantomData,
        })
    }
}

/// A [`ClinicRequest`] whose role holds permission `A` or permission `B`; otherwise `403`. For the
/// few reads two screens share, such as the list of roles (the team list and the roles editor).
#[derive(Debug)]
pub struct RequireEither<A: Required, B: Required> {
    /// The checked request.
    pub request: ClinicRequest,
    permissions: PhantomData<(A, B)>,
}

impl<A: Required, B: Required> FromRequestParts<AppState> for RequireEither<A, B> {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let request = ClinicRequest::admit(parts, state, true).await?;
        if request.actor.require(A::PERMISSION).is_err() {
            request.actor.require(B::PERMISSION)?;
        }
        Ok(Self {
            request,
            permissions: PhantomData,
        })
    }
}

/// A [`ClinicRequest`] whose role holds at least one of permissions `A`, `B`, `C` and `D`;
/// otherwise `403`. For the notification feed, which each permission fills with its own kind.
#[derive(Debug)]
pub struct RequireAny<A: Required, B: Required, C: Required, D: Required> {
    /// The checked request.
    pub request: ClinicRequest,
    permissions: PhantomData<(A, B, C, D)>,
}

impl<A: Required, B: Required, C: Required, D: Required> FromRequestParts<AppState>
    for RequireAny<A, B, C, D>
{
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let request = ClinicRequest::admit(parts, state, true).await?;
        let held = [A::PERMISSION, B::PERMISSION, C::PERMISSION, D::PERMISSION]
            .into_iter()
            .any(|permission| request.actor.require(permission).is_ok());
        if !held {
            request.actor.require(A::PERMISSION)?;
        }
        Ok(Self {
            request,
            permissions: PhantomData,
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
        // The console sees every clinic: a password or email code alone isn't enough. Checked after
        // the staff lookup so someone who isn't staff learns nothing about the second step.
        // `auth.staff_mfa` turns this off for development and demos only.
        if state.staff_mfa() && claims.assurance_level() != AssuranceLevel::Aal2 {
            return Err(ApiError::forbidden(
                "mfa_required",
                "Console access needs your authenticator code. Open the console to enter it.",
            )
            .into());
        }
        sakalya_telemetry::record_user(staff.user_id.uuid());
        Ok(Self {
            staff,
            request_id: request_id(parts),
        })
    }
}

/// The `If-Match` header: the `row_version` (the `ETag` the API sent) of the record the client
/// last read. `None` when the header is absent or `*`, which keeps the edit unconditional.
#[derive(Debug, Clone, Copy)]
pub struct IfMatch(pub Option<i64>);

impl<S: Send + Sync> FromRequestParts<S> for IfMatch {
    type Rejection = ApiFailure;

    #[expect(
        clippy::unused_async_trait_impl,
        reason = "the trait's method is async; this header needs no await"
    )]
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let Some(value) = parts.headers.get(header::IF_MATCH) else {
            return Ok(Self(None));
        };
        let text = value.to_str().unwrap_or_default().trim();
        if text == "*" {
            return Ok(Self(None));
        }
        let digits = text.strip_prefix("W/").unwrap_or(text).trim_matches('"');
        match digits.parse::<i64>() {
            Ok(version) if version >= 1 && !digits.starts_with('+') => Ok(Self(Some(version))),
            _ => Err(ApiFailure::Error(ApiError::bad_request(
                "invalid_request",
                "If-Match: must be the record's row_version in quotes, such as \"3\"",
            ))),
        }
    }
}

/// Reads the patient account behind a verified token. The token comes first, so a missing one
/// is `401` on any host.
async fn patient_access(
    state: &AppState,
    claims: &Claims,
) -> Result<aarogyam_app::patient_app::PatientAccess, ApiFailure> {
    use aarogyam_app::patient_app::{self as patient_app, AccessRefusal};
    let session = claims.session_id().ok_or_else(ApiError::unauthenticated)?;
    let expires_at = time::OffsetDateTime::from_unix_timestamp(claims.expires_at())
        .map_err(|_| ApiError::unauthenticated())?;
    let found = patient_app::access(
        state.db(),
        claims.subject().uuid(),
        claims.email(),
        (session, expires_at),
    )
    .await?;
    match found {
        Ok(access) => {
            sakalya_telemetry::record_user(access.account_id.uuid());
            Ok(access)
        }
        Err(AccessRefusal::Revoked) => Err(ApiFailure::Error(ApiError::unauthenticated())),
        Err(AccessRefusal::NoEmail) => Err(ApiFailure::Error(ApiError::forbidden(
            "email_required",
            "Sign in with a verified email address.",
        ))),
        Err(AccessRefusal::Disabled) => Err(ApiFailure::Error(ApiError::forbidden(
            "account_disabled",
            "This patient account is disabled.",
        ))),
    }
}

/// A signed-in patient account on the app host: the person's own records, at the clinics that
/// linked them, and nothing else (`docs/patient-access.md`). Other hosts get `404`; the account
/// is made on the first request from the token's verified email.
#[derive(Debug)]
pub struct PatientRequest {
    /// The account and its linked clinics.
    pub access: aarogyam_app::patient_app::PatientAccess,
    /// The sign-in session's provider id (the token's `session_id`).
    pub session_id: Uuid,
    /// The request ID, for the access record.
    pub request_id: Option<Uuid>,
}

impl FromRequestParts<AppState> for PatientRequest {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let claims = state.claims(&parts.headers).await?;
        if edge(parts)?.host().as_str() != state.hosts().app {
            return Err(ApiFailure::Error(not_found()));
        }
        Ok(Self {
            access: patient_access(state, &claims).await?,
            session_id: claims.session_id().ok_or_else(ApiError::unauthenticated)?,
            request_id: request_id(parts),
        })
    }
}

/// A signed-in patient account with an active link at the clinic named by the host, for the
/// few patient actions that change one clinic's records (booking, cancelling) or stream its
/// files. Unknown hosts, closed clinics and clinics that haven't linked the account get `404`.
#[derive(Debug)]
pub struct PatientAtClinic {
    /// The account and its linked clinics.
    pub access: aarogyam_app::patient_app::PatientAccess,
    /// The link at this clinic.
    pub clinic: aarogyam_app::patient_app::LinkedClinic,
    /// The Supabase auth id, which caps open bookings like the public page.
    pub auth_uid: Uuid,
    /// The request ID, for the access record.
    pub request_id: Option<Uuid>,
}

impl FromRequestParts<AppState> for PatientAtClinic {
    type Rejection = ApiFailure;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let claims = state.claims(&parts.headers).await?;
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
        let access = patient_access(state, &claims).await?;
        let linked = access
            .at(clinic.clinic_id)
            .cloned()
            .ok_or_else(|| ApiFailure::Error(not_found()))?;
        sakalya_telemetry::record_tenant(clinic.clinic_id.uuid());
        Ok(Self {
            access,
            clinic: linked,
            auth_uid: claims.subject().uuid(),
            request_id: request_id(parts),
        })
    }
}
