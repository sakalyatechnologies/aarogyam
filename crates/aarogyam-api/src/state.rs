//! What every handler can reach: the database, token checks, short-lived lookups and the
//! host names the API answers on.

use std::sync::Arc;
use std::time::Duration;

use aarogyam_app::files::Files;
use aarogyam_app::prescriptions::{AllergiesNotWiredYet, AllergySource};
use aarogyam_dal::lookups::{self, HostClinic};
use aarogyam_dal::sessions;
use aarogyam_domain::access::Authorization;
use aarogyam_domain::ids::{ClinicId, MembershipId};
use aarogyam_notify::{Notifier, PortalLinks};
use axum::http::HeaderMap;
use sakalya_auth::{Claims, JwtVerifier, bearer_token};
use sakalya_db::Db;
use sakalya_http::{ApiError, HttpConfig};
use sakalya_throttle::Throttle;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::cache::TtlCache;
use crate::dev::DevTokens;
use crate::failure::ApiFailure;
use crate::metrics::ServiceMetrics;

/// How long a host lookup or a member's permissions are reused before asking the database again.
const CACHE_TTL: Duration = Duration::from_secs(30);
/// Most cached entries of each kind.
const CACHE_CAPACITY: usize = 10_000;

/// The host names the API serves, besides clinic portals.
#[derive(Debug, Clone)]
pub struct Hosts {
    /// Clinic portals are `<slug>.<portal_domain>`, such as `sunrise.localtest.me`.
    pub portal_domain: String,
    /// The Sakalya console, such as `console.localtest.me`.
    pub console: String,
    /// The neutral host the phone apps use before a clinic is chosen, such as `app.localtest.me`.
    pub app: String,
}

/// How sign-in tokens are checked.
#[derive(Debug)]
pub enum TokenCheck {
    /// Supabase Auth tokens, verified against its published keys.
    Supabase(JwtVerifier),
    /// Local development only: tokens minted by `POST /api/v1/dev/token`.
    Dev(DevTokens),
}

impl TokenCheck {
    fn verifier(&self) -> &JwtVerifier {
        match self {
            Self::Supabase(verifier) => verifier,
            Self::Dev(dev) => dev.verifier(),
        }
    }
}

#[derive(Debug)]
struct Inner {
    db: Db,
    http: HttpConfig,
    tokens: TokenCheck,
    hosts: Hosts,
    host_cache: TtlCache<Box<str>, Option<HostClinic>>,
    grant_cache: TtlCache<(Uuid, Uuid, Uuid), Option<Authorization>>,
    metrics: Arc<ServiceMetrics>,
    throttle: Option<Throttle>,
    notifier: Notifier,
    allergies: Arc<dyn AllergySource>,
    files: Option<Files>,
}

/// Shared state; cheap to clone.
#[derive(Debug, Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

impl AppState {
    /// Creates the state.
    #[must_use]
    pub fn new(db: Db, http: HttpConfig, tokens: TokenCheck, hosts: Hosts) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                http,
                tokens,
                hosts,
                host_cache: TtlCache::new(CACHE_TTL, CACHE_CAPACITY),
                grant_cache: TtlCache::new(CACHE_TTL, CACHE_CAPACITY),
                metrics: Arc::new(ServiceMetrics::new()),
                throttle: None,
                notifier: Notifier::log(PortalLinks::default()),
                allergies: Arc::new(AllergiesNotWiredYet),
                files: None,
            }),
        }
    }

    /// Adds request throttling, applied before any token is checked. Call before the state is
    /// shared (cloned); afterwards it has no effect.
    #[must_use]
    pub fn with_throttle(mut self, throttle: Throttle) -> Self {
        if let Some(inner) = Arc::get_mut(&mut self.inner) {
            inner.throttle = Some(throttle);
        }
        self
    }

    /// Replaces the notifier, which by default records email to the log only. Call before the
    /// state is shared (cloned); afterwards it has no effect.
    #[must_use]
    pub fn with_notifier(mut self, notifier: Notifier) -> Self {
        if let Some(inner) = Arc::get_mut(&mut self.inner) {
            inner.notifier = notifier;
        }
        self
    }

    /// Replaces where the prescription allergy check reads a patient's allergies. Call before
    /// the state is shared (cloned); afterwards it has no effect.
    #[must_use]
    pub fn with_allergy_source(mut self, source: Arc<dyn AllergySource>) -> Self {
        if let Some(inner) = Arc::get_mut(&mut self.inner) {
            inner.allergies = source;
        }
        self
    }

    /// Sets where patient files are stored and how their download links are signed. Without
    /// it, file routes answer `500`. Call before the state is shared (cloned).
    #[must_use]
    pub fn with_files(mut self, files: Files) -> Self {
        if let Some(inner) = Arc::get_mut(&mut self.inner) {
            inner.files = Some(files);
        }
        self
    }

    pub(crate) fn allergies(&self) -> &dyn AllergySource {
        self.inner.allergies.as_ref()
    }

    pub(crate) fn files(&self) -> Result<&Files, ApiFailure> {
        self.inner
            .files
            .as_ref()
            .ok_or_else(|| ApiFailure(ApiError::internal("file storage is not configured")))
    }

    pub(crate) fn notifier(&self) -> &Notifier {
        &self.inner.notifier
    }

    pub(crate) fn throttle(&self) -> Option<&Throttle> {
        self.inner.throttle.as_ref()
    }

    /// The database handle.
    #[must_use]
    pub fn db(&self) -> &Db {
        &self.inner.db
    }

    pub(crate) fn http(&self) -> &HttpConfig {
        &self.inner.http
    }

    /// This instance's request metrics, for the console's service health page.
    #[must_use]
    pub fn metrics(&self) -> &Arc<ServiceMetrics> {
        &self.inner.metrics
    }

    pub(crate) fn hosts(&self) -> &Hosts {
        &self.inner.hosts
    }

    pub(crate) fn dev_tokens(&self) -> Option<&DevTokens> {
        match &self.inner.tokens {
            TokenCheck::Dev(dev) => Some(dev),
            TokenCheck::Supabase(_) => None,
        }
    }

    /// Verifies the request's bearer token.
    pub(crate) async fn claims(&self, headers: &HeaderMap) -> Result<Claims, ApiFailure> {
        let token = bearer_token(headers).ok_or_else(ApiError::unauthenticated)?;
        Ok(self.inner.tokens.verifier().verify(token).await?)
    }

    /// Verifies the bearer token and refuses a revoked session. For routes that don't go through
    /// [`Self::authorization`], which reports revocation itself.
    pub(crate) async fn live_claims(&self, headers: &HeaderMap) -> Result<Claims, ApiFailure> {
        let claims = self.claims(headers).await?;
        let session = claims.session_id().ok_or_else(ApiError::unauthenticated)?;
        if sessions::is_revoked(self.inner.db.pool(), claims.subject().uuid(), session).await? {
            return Err(ApiFailure(ApiError::unauthenticated()));
        }
        Ok(claims)
    }

    /// Forgets what was cached for a sign-in session, so its revocation applies to the next
    /// request rather than when the cache entry expires.
    ///
    /// The cache is per instance: another instance may serve its own entry for up to
    /// [`CACHE_TTL`]. Locally and with one instance that is never the case.
    pub(crate) fn forget_session(&self, provider_session_id: Uuid) {
        self.inner
            .grant_cache
            .remove_where(|(_, _, session), _| *session == provider_session_id);
    }

    /// Forgets what was cached for a membership, so a role or status change applies to the
    /// member's next request. Per instance, like [`Self::forget_session`].
    pub(crate) fn forget_membership(&self, clinic_id: ClinicId, membership_id: MembershipId) {
        self.inner
            .grant_cache
            .remove_where(|(clinic, _, _), found| {
                *clinic == clinic_id.uuid()
                    && found
                        .as_ref()
                        .is_some_and(|grant| grant.membership_id == membership_id)
            });
    }

    /// The clinic a host belongs to, cached briefly.
    pub(crate) async fn clinic_for_host(
        &self,
        host: &str,
    ) -> Result<Option<HostClinic>, ApiFailure> {
        if let Some(found) = self.inner.host_cache.get(&Box::from(host)) {
            return Ok(found);
        }
        let found = lookups::resolve_host(self.inner.db.pool(), host).await?;
        // Only answers that grant something are cached: a clinic created a moment ago must be
        // reachable at once. Floods of unknown hosts are the throttle's job.
        if found.is_some() {
            self.inner.host_cache.insert(host.into(), found.clone());
        }
        Ok(found)
    }

    /// What a token's subject may do in a clinic, cached briefly per sign-in session.
    pub(crate) async fn authorization(
        &self,
        clinic_id: ClinicId,
        claims: &Claims,
    ) -> Result<Option<Authorization>, ApiFailure> {
        let session = claims.session_id().ok_or_else(ApiError::unauthenticated)?;
        let subject = claims.subject().uuid();
        let key = (clinic_id.uuid(), subject, session);
        if let Some(found) = self.inner.grant_cache.get(&key) {
            return Ok(found);
        }
        let expires_at = OffsetDateTime::from_unix_timestamp(claims.expires_at())
            .map_err(|_| ApiError::unauthenticated())?;
        let found = lookups::authorize(
            self.inner.db.pool(),
            clinic_id,
            subject,
            session,
            expires_at,
        )
        .await?;
        // Only memberships are cached, so someone who just accepted an invitation gets in at once.
        if found.is_some() {
            self.inner.grant_cache.insert(key, found.clone());
        }
        Ok(found)
    }
}
