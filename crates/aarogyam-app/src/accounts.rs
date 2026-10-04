//! Sign-in accounts in Supabase Auth. Sign-ups are off, so a person can sign in only after
//! the API has created their account: when they are invited to a clinic, or made Sakalya
//! staff. Accounts are created already confirmed, because the person proves the address by
//! entering the code Supabase emails them at sign-in.
//!
//! [`SupabaseAdmin`] calls the Auth Admin API with the project's server-only secret key, which
//! never leaves the server and is never logged. Tests use their own [`SignInAccounts`].

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use aarogyam_domain::patient::Email;
use reqwest::StatusCode;
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use uuid::Uuid;

const TIMEOUT: Duration = Duration::from_secs(10);
/// Users per page when looking an address up.
const PAGE_SIZE: usize = 200;
/// Most pages read when looking an address up.
const MAX_PAGES: usize = 50;

/// A person's Supabase Auth id: the `sub` of their tokens and `users.auth_uid`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AuthUid(Uuid);

impl AuthUid {
    /// Wraps an id from Supabase or a token.
    #[must_use]
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The id.
    #[must_use]
    pub const fn uuid(self) -> Uuid {
        self.0
    }
}

/// Why an account could not be made or found. Carries no address and no key.
#[derive(Debug, thiserror::Error)]
pub enum AccountsError {
    /// The client is misconfigured.
    #[error("sign-in accounts: {0}")]
    Configuration(&'static str),
    /// Supabase could not be reached or answered with an error.
    #[error("sign-in accounts: Supabase answered {0}")]
    Upstream(String),
}

/// A boxed future, so [`SignInAccounts`] can be shared as a trait object.
pub type AccountFuture<'a> =
    Pin<Box<dyn Future<Output = Result<AuthUid, AccountsError>> + Send + 'a>>;

/// Makes sure a person can sign in with an email address.
pub trait SignInAccounts: Send + Sync + fmt::Debug {
    /// The account for `email`, created (confirmed) when there is none.
    fn ensure_user<'a>(&'a self, email: &'a Email) -> AccountFuture<'a>;
}

/// The Supabase Auth Admin API.
pub struct SupabaseAdmin {
    client: reqwest::Client,
    users_url: String,
    secret_key: SecretString,
}

impl fmt::Debug for SupabaseAdmin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SupabaseAdmin")
            .field("users_url", &self.users_url)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct User {
    id: Uuid,
    email: Option<String>,
}

#[derive(Deserialize)]
struct Users {
    users: Vec<User>,
}

#[derive(Deserialize)]
struct Refusal {
    error_code: Option<String>,
    code: Option<serde_json::Value>,
    msg: Option<String>,
}

impl Refusal {
    fn is_existing_user(&self) -> bool {
        let code_says = |code: &str| code == "email_exists" || code == "user_already_exists";
        self.error_code.as_deref().is_some_and(code_says)
            || self
                .code
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .is_some_and(code_says)
            || self
                .msg
                .as_deref()
                .is_some_and(|msg| msg.contains("already been registered"))
    }
}

impl SupabaseAdmin {
    /// A client for the project at `project_url` (`https://<ref>.supabase.co`).
    ///
    /// # Errors
    /// [`AccountsError::Configuration`] for a URL that isn't http(s) or an HTTP client that
    /// can't be built.
    pub fn new(project_url: &str, secret_key: SecretString) -> Result<Self, AccountsError> {
        let base = project_url.trim().trim_end_matches('/');
        if !(base.starts_with("https://") || base.starts_with("http://")) {
            return Err(AccountsError::Configuration(
                "the Supabase URL must start with https://",
            ));
        }
        if secret_key.expose_secret().trim().is_empty() {
            return Err(AccountsError::Configuration(
                "the Supabase secret key is empty",
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|_| AccountsError::Configuration("could not build the HTTP client"))?;
        Ok(Self {
            client,
            users_url: format!("{base}/auth/v1/admin/users"),
            secret_key,
        })
    }

    fn request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        // The secret key goes in `apikey`; Supabase's gateway turns it into service access.
        self.client
            .request(method, url)
            .header("apikey", self.secret_key.expose_secret())
    }

    /// Creates a confirmed account; `None` when the address already has one.
    async fn create(&self, email: &Email) -> Result<Option<AuthUid>, AccountsError> {
        let response = self
            .request(reqwest::Method::POST, &self.users_url)
            .json(&serde_json::json!({ "email": email.as_str(), "email_confirm": true }))
            .send()
            .await
            .map_err(|error| AccountsError::Upstream(transport(&error)))?;
        let status = response.status();
        if status.is_success() {
            let user: User = response.json().await.map_err(|_| {
                AccountsError::Upstream(format!("{status} with an unreadable body"))
            })?;
            return Ok(Some(AuthUid(user.id)));
        }
        if status == StatusCode::UNPROCESSABLE_ENTITY || status == StatusCode::CONFLICT {
            let refusal: Option<Refusal> = response.json().await.ok();
            if refusal.is_some_and(|refusal| refusal.is_existing_user()) {
                return Ok(None);
            }
        }
        Err(AccountsError::Upstream(status.as_u16().to_string()))
    }

    /// Finds the account for an address, reading the user list a page at a time.
    async fn find(&self, email: &Email) -> Result<Option<AuthUid>, AccountsError> {
        for page in 1..=MAX_PAGES {
            let response = self
                .request(reqwest::Method::GET, &self.users_url)
                .query(&[
                    ("page", page.to_string()),
                    ("per_page", PAGE_SIZE.to_string()),
                    // Narrows the list on GoTrue versions that support it; ignored otherwise.
                    ("filter", email.as_str().to_owned()),
                ])
                .send()
                .await
                .map_err(|error| AccountsError::Upstream(transport(&error)))?;
            let status = response.status();
            if !status.is_success() {
                return Err(AccountsError::Upstream(status.as_u16().to_string()));
            }
            let users: Users = response.json().await.map_err(|_| {
                AccountsError::Upstream(format!("{status} with an unreadable body"))
            })?;
            if let Some(user) = users.users.iter().find(|user| {
                user.email
                    .as_deref()
                    .is_some_and(|found| found.eq_ignore_ascii_case(email.as_str()))
            }) {
                return Ok(Some(AuthUid(user.id)));
            }
            if users.users.len() < PAGE_SIZE {
                return Ok(None);
            }
        }
        Ok(None)
    }

    /// The account for `email`, if there is one; never creates one.
    ///
    /// # Errors
    /// [`AccountsError::Upstream`] when Supabase can't be reached or refuses.
    pub async fn find_user(&self, email: &Email) -> Result<Option<AuthUid>, AccountsError> {
        self.find(email).await
    }
}

/// A transport failure without the URL, which is harmless but noisy, or anything else.
fn transport(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "nothing in time".to_owned()
    } else if error.is_connect() {
        "no connection".to_owned()
    } else {
        "a transport error".to_owned()
    }
}

impl SignInAccounts for SupabaseAdmin {
    fn ensure_user<'a>(&'a self, email: &'a Email) -> AccountFuture<'a> {
        Box::pin(async move {
            if let Some(created) = self.create(email).await? {
                return Ok(created);
            }
            self.find(email).await?.ok_or_else(|| {
                AccountsError::Upstream("an existing account that could not be found".to_owned())
            })
        })
    }
}
