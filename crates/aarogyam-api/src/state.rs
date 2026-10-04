//! What every handler can reach: the database, token checks, short-lived lookups and the
//! host names the API answers on.

use std::sync::Arc;
use std::time::Duration;

use aarogyam_dal::lookups::{self, HostClinic};
use aarogyam_domain::access::Authorization;
use aarogyam_domain::ids::ClinicId;
use axum::http::HeaderMap;
use sakalya_auth::{Claims, JwtVerifier, bearer_token};
use sakalya_db::Db;
use sakalya_http::{ApiError, HttpConfig};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::cache::TtlCache;
use crate::dev::DevTokens;
use crate::failure::ApiFailure;

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
            }),
        }
    }

    /// The database handle.
    #[must_use]
    pub fn db(&self) -> &Db {
        &self.inner.db
    }

    pub(crate) fn http(&self) -> &HttpConfig {
        &self.inner.http
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

    /// The clinic a host belongs to, cached briefly.
    pub(crate) async fn clinic_for_host(
        &self,
        host: &str,
    ) -> Result<Option<HostClinic>, ApiFailure> {
        if let Some(found) = self.inner.host_cache.get(&Box::from(host)) {
            return Ok(found);
        }
        let found = lookups::resolve_host(self.inner.db.pool(), host).await?;
        self.inner.host_cache.insert(host.into(), found.clone());
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
        self.inner.grant_cache.insert(key, found.clone());
        Ok(found)
    }
}
