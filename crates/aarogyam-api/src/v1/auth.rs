//! Central sign-in's session handoff (`aarogyam_app::handoff`): the public site asks for a
//! one-time code for the host the person is going to, and that host redeems it for a session
//! of its own.

use aarogyam_app::handoff as app;
use aarogyam_domain::event::Event;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rfc3339;
use crate::AppState;
use crate::extract::{RequestHost, SignedIn};
use crate::failure::ApiFailure;

/// Where the signed-in person is going.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewHandoff {
    /// A clinic portal host they are an active member of, or the console host for Sakalya
    /// staff, such as `sunrise-aarogyam.sakalyatechnologies.com`.
    pub host: String,
}

/// A one-time code for that host. Send the person to `redirect_url`: the code is in the URL
/// fragment, which browsers never send to a server.
#[derive(Debug, Serialize, ToSchema)]
pub struct Handoff {
    /// The code; works once, on `host` only.
    pub code: String,
    /// The host it is for.
    pub host: String,
    /// When it stops working (RFC 3339), at most 60 seconds away.
    pub expires_at: String,
    /// `https://<host>/auth/handoff#code=<code>`.
    pub redirect_url: String,
}

/// Every reply here carries a credential: never cache it anywhere.
fn no_store(status: StatusCode, body: impl Serialize) -> Response {
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Makes a one-time code that signs the caller in on another Aarogyam host.
#[utoipa::path(
    post,
    path = "/api/v1/auth/handoff",
    operation_id = "createHandoff",
    tag = "session",
    request_body = NewHandoff,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Handoff),
        (status = 400, description = "Not a host name"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a host this person may go to")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    signed_in: SignedIn,
    ApiJson(body): ApiJson<NewHandoff>,
) -> Result<Response, ApiFailure> {
    let user = signed_in.claims.subject().uuid();
    let handoff = app::create(state.db(), user, &body.host, &state.hosts().console).await?;
    tracing::info!(event = Event::HandoffCreated.as_str(), auth_uid = %user, host = %handoff.host, "handoff created");
    let redirect_url = format!(
        "https://{}/auth/handoff#code={}",
        handoff.host, handoff.code
    );
    Ok(no_store(
        StatusCode::CREATED,
        Handoff {
            expires_at: rfc3339(handoff.expires_at),
            redirect_url,
            host: handoff.host,
            code: handoff.code,
        },
    ))
}

/// A code to redeem on the host it was made for.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RedeemHandoff {
    /// The code from the URL fragment.
    pub code: String,
}

/// What signs the person in on this host. `kind` says which fields are set: `supabase` gives
/// `email` and `token_hash` for `supabase.auth.verifyOtp({ type: "magiclink", token_hash })`;
/// `dev` (local only) gives a development `access_token`.
#[derive(Debug, Serialize, ToSchema)]
pub struct HandoffSession {
    /// `supabase` or `dev`.
    pub kind: &'static str,
    /// The person's sign-in address (`supabase`).
    pub email: Option<String>,
    /// A one-time magic-link token hash (`supabase`).
    pub token_hash: Option<String>,
    /// A development access token (`dev`).
    pub access_token: Option<String>,
}

/// Redeems a handoff code on this host for a session. Unknown, used, expired and other hosts'
/// codes all get `404`, and the first attempt uses a code up. Throttled per IP.
#[utoipa::path(
    post,
    path = "/api/v1/auth/handoff/redeem",
    operation_id = "redeemHandoff",
    tag = "session",
    request_body = RedeemHandoff,
    responses(
        (status = 200, body = HandoffSession),
        (status = 404, description = "The code doesn't sign anyone in here"),
        (status = 429, description = "Too many attempts")
    )
)]
pub(crate) async fn redeem(
    State(state): State<AppState>,
    RequestHost(host): RequestHost,
    ApiJson(body): ApiJson<RedeemHandoff>,
) -> Result<Response, ApiFailure> {
    let redeemed = match app::redeem(state.db(), &body.code, &host).await {
        Ok(redeemed) => redeemed,
        Err(error) => {
            if matches!(error, aarogyam_app::error::AppError::NotFound(_)) {
                tracing::warn!(event = Event::HandoffRefused.as_str(), host = %host, "handoff refused");
            }
            return Err(error.into());
        }
    };
    let session = if let Some(accounts) = state.accounts() {
        let email = redeemed
            .email
            .as_ref()
            .ok_or_else(|| ApiError::internal("the person has no sign-in address"))?;
        let token = accounts.sign_in_token(email).await.map_err(|error| {
            tracing::error!(error = %error, "could not issue a sign-in token");
            ApiError::internal("could not sign in; try again")
        })?;
        HandoffSession {
            kind: "supabase",
            email: Some(email.as_str().to_owned()),
            token_hash: Some(token.expose().to_owned()),
            access_token: None,
        }
    } else if let Some(dev) = state.dev_tokens() {
        HandoffSession {
            kind: "dev",
            email: None,
            token_hash: None,
            access_token: Some(
                dev.mint_with_email(
                    redeemed.auth_uid,
                    redeemed
                        .email
                        .as_ref()
                        .map(aarogyam_domain::patient::Email::as_str),
                )?,
            ),
        }
    } else {
        return Err(ApiError::internal("sign-in handoff is not configured").into());
    };
    tracing::info!(event = Event::HandoffRedeemed.as_str(), auth_uid = %redeemed.auth_uid, host = %host, "handoff redeemed");
    Ok(no_store(StatusCode::OK, session))
}
