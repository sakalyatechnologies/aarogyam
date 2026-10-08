//! Local development sign-in: mints tokens shaped like Supabase's for the seeded people, so the
//! whole stack runs without a Supabase project. The route exists only when the server runs in
//! the `local` environment (see `crate::router`); deployed servers verify Supabase tokens.

use axum::Json;
use axum::extract::State;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use sakalya_auth::JwtVerifier;
use sakalya_http::{ApiError, ApiJson};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;
use crate::failure::ApiFailure;

/// How long a development token lasts.
const TOKEN_SECONDS: i64 = 3600;

/// Mints and verifies HS256 development tokens with one local secret.
pub struct DevTokens {
    issuer: String,
    audience: String,
    secret: SecretString,
    verifier: JwtVerifier,
}

impl std::fmt::Debug for DevTokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DevTokens")
            .field("issuer", &self.issuer)
            .finish_non_exhaustive()
    }
}

impl DevTokens {
    /// Tokens for `issuer` and `audience`, signed with `secret`.
    #[must_use]
    pub fn new(issuer: &str, audience: &str, secret: SecretString) -> Self {
        let verifier = JwtVerifier::shared_secret(issuer, audience, &secret);
        Self {
            issuer: issuer.to_owned(),
            audience: audience.to_owned(),
            secret,
            verifier,
        }
    }

    /// The issuer these tokens name.
    #[must_use]
    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    pub(crate) const fn verifier(&self) -> &JwtVerifier {
        &self.verifier
    }

    /// A signed token for `auth_uid` with a fresh session, valid for an hour.
    ///
    /// # Errors
    /// [`ApiError`] (internal) if signing fails.
    pub fn mint(&self, auth_uid: Uuid) -> Result<String, ApiError> {
        self.mint_with_email(auth_uid, None)
    }

    /// A signed token for `auth_uid` that also carries a verified `email` claim, as Supabase's
    /// do after an email code.
    ///
    /// # Errors
    /// [`ApiError`] (internal) if signing fails.
    pub fn mint_with_email(&self, auth_uid: Uuid, email: Option<&str>) -> Result<String, ApiError> {
        // Development sign-in has no second step, so its tokens stand in for one that passed it:
        // the local console works without a Supabase project.
        self.mint_with_level(auth_uid, email, "aal2")
    }

    /// A signed token with the given assurance level (`aal1` one factor, `aal2` two), as Supabase
    /// issues before and after the second step. For tests of what needs the second step.
    ///
    /// # Errors
    /// [`ApiError`] (internal) if signing fails.
    pub fn mint_with_level(
        &self,
        auth_uid: Uuid,
        email: Option<&str>,
        level: &str,
    ) -> Result<String, ApiError> {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let claims = DevClaims {
            iss: &self.issuer,
            aud: &self.audience,
            sub: auth_uid,
            iat: now,
            exp: now + TOKEN_SECONDS,
            role: "authenticated",
            aal: level,
            session_id: Uuid::now_v7(),
            is_anonymous: false,
            email,
        };
        let key = EncodingKey::from_secret(self.secret.expose_secret().as_bytes());
        jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &key)
            .map_err(ApiError::internal)
    }
}

#[derive(Serialize)]
struct DevClaims<'a> {
    iss: &'a str,
    aud: &'a str,
    sub: Uuid,
    iat: i64,
    exp: i64,
    role: &'a str,
    aal: &'a str,
    session_id: Uuid,
    is_anonymous: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<&'a str>,
}

/// Who to sign in as.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DevTokenRequest {
    /// The person's Supabase Auth id (`users.auth_uid`), from the local seed.
    #[schema(value_type = String)]
    pub auth_uid: Uuid,
    /// A verified email to put in the token, for accepting invitations.
    pub email: Option<String>,
}

/// A development token.
#[derive(Debug, Serialize, ToSchema)]
pub struct DevTokenResponse {
    /// Bearer token for the `Authorization` header.
    pub access_token: String,
    /// Seconds until it expires.
    pub expires_in: i64,
}

/// Signs in as a seeded person (local development only).
#[utoipa::path(
    post,
    path = "/api/v1/dev/token",
    operation_id = "createDevToken",
    tag = "development",
    request_body = DevTokenRequest,
    responses((status = 200, description = "A token for that person", body = DevTokenResponse))
)]
pub(crate) async fn token(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<DevTokenRequest>,
) -> Result<Json<DevTokenResponse>, ApiFailure> {
    let dev = state
        .dev_tokens()
        .ok_or_else(|| ApiError::not_found("not_found", "Not found."))?;
    Ok(Json(DevTokenResponse {
        access_token: dev.mint_with_email(request.auth_uid, request.email.as_deref())?,
        expires_in: TOKEN_SECONDS,
    }))
}
