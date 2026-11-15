//! Push notifications to the staff app: Apple's APNs directly for iPhones and Firebase Cloud
//! Messaging (HTTP v1) for Android. Off until the founder adds keys: with `ARO_PUSH__ENABLED`
//! false, or a provider's keys missing, that provider's devices are skipped and the step still
//! marks every notification pushed.
//!
//! The job step ([`Push::run`]) claims staff notifications not yet pushed, works out who sees
//! each in their own feed (`aarogyam_app::push`, the feed's rules, not new ones) and sends to
//! those members' staff devices. Reminders and escalations come through [`StaffChannel::Push`]
//! (`staff.rs`), the same way. Only notifications from the last 30 minutes are sent; older ones
//! are marked pushed without sending, so enabling the sender never blasts a backlog.
//!
//! The payload is IDs and kind codes only, never a name (AGENTS.md rule 6). The app renders the
//! text from the `push.<kind>` localisation keys. Delivery is best effort: a failure is logged
//! by device id and not retried; a token the provider says is dead is cleared.
//!
//! Each provider takes its base URL, so tests point it at a local server. Keys and tokens are
//! never logged.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use aarogyam_app::push as recipients;
use aarogyam_dal::devices::{self as dal, Device};
use aarogyam_domain::device::DevicePlatform;
use aarogyam_domain::ids::ClinicId;
use aarogyam_domain::notification::Audience;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use sakalya_db::{Db, DbError};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::NotifyError;
use crate::staff::StaffAlert;

/// Apple's production push host.
pub const APNS_HOST: &str = "https://api.push.apple.com";
/// Apple's sandbox push host, for development builds.
pub const APNS_SANDBOX_HOST: &str = "https://api.sandbox.push.apple.com";
/// Google's FCM host.
pub const FCM_HOST: &str = "https://fcm.googleapis.com";
/// Where a service account's access tokens come from, unless its JSON names another.
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

const TIMEOUT: Duration = Duration::from_secs(10);
/// Apple refuses provider tokens older than an hour and throttles making them too often: one is
/// reused for 50 minutes.
const APNS_TOKEN_REFRESH: Duration = Duration::from_mins(50);
/// Access tokens are renewed this long before they expire.
const FCM_TOKEN_MARGIN: Duration = Duration::from_secs(60);
/// Most staff notifications one run claims.
const BATCH: i32 = 200;
/// The portal path of a notification with none. Reminders and escalations are about booking
/// requests, which carry no `href` in the feed either.
const NO_HREF: &str = "";

/// What a push says: IDs and kind codes only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushMessage {
    /// The notification's kind, such as `collect_payment`, or `booking_reminder`.
    pub kind: String,
    /// The clinic.
    pub org_id: Uuid,
    /// The staff notification.
    pub id: Uuid,
    /// The portal path the feed gives for it; empty when it has none.
    pub href: String,
}

/// The APNs request body.
#[must_use]
pub fn apns_body(message: &PushMessage) -> Value {
    json!({
        "aps": {
            "alert": { "loc-key": format!("push.{}", message.kind), "title-loc-key": "push.title" },
            "thread-id": message.kind,
            "sound": "default",
        },
        "kind": message.kind,
        "org_id": message.org_id.to_string(),
        "id": message.id.to_string(),
        "href": message.href,
    })
}

/// The FCM HTTP v1 request body: data only, every value a string, high priority.
#[must_use]
pub fn fcm_body(token: &str, message: &PushMessage) -> Value {
    json!({
        "message": {
            "token": token,
            "data": {
                "kind": message.kind,
                "org_id": message.org_id.to_string(),
                "id": message.id.to_string(),
                "href": message.href,
            },
            "android": { "priority": "high" },
        }
    })
}

/// What a provider said about one send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    /// Accepted for delivery.
    Sent,
    /// The token is dead (uninstalled or expired): clear it.
    DeadToken,
    /// Anything else: not retried. A short reason without content.
    Failed(String),
}

/// A provider's answer that couldn't be had at all: the network or a timeout.
#[derive(Debug)]
pub struct Unreachable;

/// `text` as one URL path segment: everything but unreserved characters percent-encoded, so a
/// token can never add path segments or a query (registration already allows hex only).
fn path_segment(text: &str) -> String {
    use std::fmt::Write as _;
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn http_client() -> Result<reqwest::Client, NotifyError> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| NotifyError::Configuration("could not build the push HTTP client"))
}

fn pem(text: &str) -> String {
    // A key in an environment variable often has its line breaks written as `\n`.
    text.replace("\\n", "\n")
}

#[derive(Serialize)]
struct ApnsClaims<'a> {
    iss: &'a str,
    iat: i64,
}

/// Apple Push Notification service, with token authentication.
pub struct Apns {
    client: reqwest::Client,
    base: String,
    topic: String,
    key_id: String,
    team_id: String,
    key: EncodingKey,
    token: Mutex<Option<(String, Instant)>>,
}

impl std::fmt::Debug for Apns {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Apns").finish_non_exhaustive()
    }
}

impl Apns {
    /// A client for `base` ([`APNS_HOST`] or [`APNS_SANDBOX_HOST`]), signing with the `.p8` key
    /// text `key_p8`, its `key_id` and the `team_id`, for the app with bundle id `topic`.
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] when the key isn't a P-256 private key or a value is empty.
    pub fn new(
        base: &str,
        key_p8: &SecretString,
        key_id: &str,
        team_id: &str,
        topic: &str,
    ) -> Result<Self, NotifyError> {
        if key_id.is_empty() || team_id.is_empty() || topic.is_empty() {
            return Err(NotifyError::Configuration(
                "push.apns_key_id, apns_team_id and apns_topic are required",
            ));
        }
        let key = EncodingKey::from_ec_pem(pem(key_p8.expose_secret()).as_bytes())
            .map_err(|_| NotifyError::Configuration("push.apns_key_p8 is not a valid .p8 key"))?;
        Ok(Self {
            client: http_client()?,
            base: base.trim_end_matches('/').to_owned(),
            topic: topic.to_owned(),
            key_id: key_id.to_owned(),
            team_id: team_id.to_owned(),
            key,
            token: Mutex::new(None),
        })
    }

    /// The provider token: cached, and made again every 50 minutes.
    fn bearer(&self) -> Option<String> {
        let mut cached = self.token.lock().ok()?;
        if let Some((jwt, made)) = cached.as_ref()
            && made.elapsed() < APNS_TOKEN_REFRESH
        {
            return Some(jwt.clone());
        }
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(self.key_id.clone());
        let claims = ApnsClaims {
            iss: &self.team_id,
            iat: OffsetDateTime::now_utc().unix_timestamp(),
        };
        let jwt = jsonwebtoken::encode(&header, &claims, &self.key).ok()?;
        *cached = Some((jwt.clone(), Instant::now()));
        Some(jwt)
    }

    fn forget_bearer(&self) {
        if let Ok(mut cached) = self.token.lock() {
            *cached = None;
        }
    }

    /// Sends `message` to the device with `token`.
    ///
    /// # Errors
    /// [`Unreachable`] when Apple couldn't be reached.
    pub async fn send(&self, token: &str, message: &PushMessage) -> Result<Delivery, Unreachable> {
        let Some(bearer) = self.bearer() else {
            return Ok(Delivery::Failed("apns provider token".to_owned()));
        };
        let response = self
            .client
            .post(format!("{}/3/device/{}", self.base, path_segment(token)))
            .header("authorization", format!("bearer {bearer}"))
            .header("apns-topic", &self.topic)
            .header("apns-push-type", "alert")
            .header("apns-priority", "10")
            .json(&apns_body(message))
            .send()
            .await
            .map_err(|_| Unreachable)?;
        let status = response.status().as_u16();
        let body = response.bytes().await.unwrap_or_default();
        Ok(apns_outcome(status, &body, || self.forget_bearer()))
    }
}

#[derive(Deserialize)]
struct ApnsError {
    reason: Option<String>,
}

/// What APNs' answer means: 200 sent; 410 a dead token. A 400 `BadDeviceToken` is only logged: a
/// sandbox/production mismatch answers it for every device, and clearing on it would wipe every
/// token on a configuration mistake.
fn apns_outcome(status: u16, body: &[u8], on_auth_failure: impl FnOnce()) -> Delivery {
    let reason = serde_json::from_slice::<ApnsError>(body)
        .ok()
        .and_then(|error| error.reason)
        .filter(|reason| reason.len() <= 64 && reason.chars().all(|c| c.is_ascii_alphanumeric()));
    match (status, reason.as_deref()) {
        (200, _) => Delivery::Sent,
        (410, _) => Delivery::DeadToken,
        (403, Some("ExpiredProviderToken" | "InvalidProviderToken")) => {
            on_auth_failure();
            Delivery::Failed(format!("apns {status} {}", reason.unwrap_or_default()))
        }
        _ => Delivery::Failed(format!("apns {status} {}", reason.unwrap_or_default())),
    }
}

#[derive(Deserialize)]
struct ServiceAccount {
    client_email: String,
    private_key: String,
    token_uri: Option<String>,
}

#[derive(Serialize)]
struct GoogleClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: i64,
    exp: i64,
}

#[derive(Deserialize)]
struct GoogleToken {
    access_token: String,
    expires_in: Option<u64>,
}

/// Firebase Cloud Messaging, HTTP v1, with a service account.
pub struct Fcm {
    client: reqwest::Client,
    base: String,
    project_id: String,
    client_email: String,
    token_uri: String,
    key: EncodingKey,
    token: Mutex<Option<(String, Instant)>>,
}

impl std::fmt::Debug for Fcm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Fcm").finish_non_exhaustive()
    }
}

impl Fcm {
    /// A client for `base` ([`FCM_HOST`]), sending for the Firebase project `project_id` as the
    /// service account in `service_account_json`. Its `token_uri` (Google's by default) is where
    /// access tokens are fetched.
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] when the JSON isn't a service account with an RSA key.
    pub fn new(
        base: &str,
        project_id: &str,
        service_account_json: &SecretString,
    ) -> Result<Self, NotifyError> {
        if project_id.is_empty() {
            return Err(NotifyError::Configuration(
                "push.fcm_project_id is required",
            ));
        }
        let account: ServiceAccount = serde_json::from_str(service_account_json.expose_secret())
            .map_err(|_| {
                NotifyError::Configuration("push.fcm_service_account_json is not a service account")
            })?;
        let key = EncodingKey::from_rsa_pem(account.private_key.as_bytes()).map_err(|_| {
            NotifyError::Configuration("push.fcm_service_account_json has no valid private key")
        })?;
        Ok(Self {
            client: http_client()?,
            base: base.trim_end_matches('/').to_owned(),
            project_id: project_id.to_owned(),
            client_email: account.client_email,
            token_uri: account
                .token_uri
                .unwrap_or_else(|| GOOGLE_TOKEN_URI.to_owned()),
            key,
            token: Mutex::new(None),
        })
    }

    fn cached(&self) -> Option<String> {
        let cached = self.token.lock().ok()?;
        let (token, expires) = cached.as_ref()?;
        (Instant::now() < *expires).then(|| token.clone())
    }

    fn forget_token(&self) {
        if let Ok(mut cached) = self.token.lock() {
            *cached = None;
        }
    }

    /// An access token: cached until a minute before it expires.
    async fn access_token(&self) -> Result<String, Unreachable> {
        if let Some(token) = self.cached() {
            return Ok(token);
        }
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let claims = GoogleClaims {
            iss: &self.client_email,
            scope: FCM_SCOPE,
            aud: &self.token_uri,
            iat: now,
            exp: now + 3600,
        };
        let assertion = jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &self.key)
            .map_err(|_| Unreachable)?;
        let response = self
            .client
            .post(&self.token_uri)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(format!(
                "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={assertion}"
            ))
            .send()
            .await
            .map_err(|_| Unreachable)?;
        if !response.status().is_success() {
            return Err(Unreachable);
        }
        let granted: GoogleToken = response.json().await.map_err(|_| Unreachable)?;
        let lifetime = Duration::from_secs(granted.expires_in.unwrap_or(3600));
        let expires = Instant::now() + lifetime.saturating_sub(FCM_TOKEN_MARGIN);
        if let Ok(mut cached) = self.token.lock() {
            *cached = Some((granted.access_token.clone(), expires));
        }
        Ok(granted.access_token)
    }

    /// Sends `message` to the device with `token`.
    ///
    /// # Errors
    /// [`Unreachable`] when Google couldn't be reached or gave no access token.
    pub async fn send(&self, token: &str, message: &PushMessage) -> Result<Delivery, Unreachable> {
        let access = self.access_token().await?;
        let response = self
            .client
            .post(format!(
                "{}/v1/projects/{}/messages:send",
                self.base, self.project_id
            ))
            .bearer_auth(&access)
            .json(&fcm_body(token, message))
            .send()
            .await
            .map_err(|_| Unreachable)?;
        let status = response.status().as_u16();
        let body = response.bytes().await.unwrap_or_default();
        Ok(fcm_outcome(status, &body, || self.forget_token()))
    }
}

/// What FCM's answer means: 200 sent; error code `UNREGISTERED` a dead token. A plain 404 or
/// `NOT_FOUND` is only logged: a wrong project id answers it for every device.
fn fcm_outcome(status: u16, body: &[u8], on_auth_failure: impl FnOnce()) -> Delivery {
    if status == 200 {
        return Delivery::Sent;
    }
    let value: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let unregistered = value["error"]["details"]
        .as_array()
        .is_some_and(|details| details.iter().any(|d| d["errorCode"] == "UNREGISTERED"));
    if unregistered {
        return Delivery::DeadToken;
    }
    if status == 401 {
        on_auth_failure();
    }
    Delivery::Failed(format!("fcm {status}"))
}

/// The providers configured: a missing one skips its devices.
#[derive(Debug, Default)]
pub struct PushSetup {
    /// For iPhones; `None` skips them.
    pub apns: Option<Apns>,
    /// For Android phones; `None` skips them.
    pub fcm: Option<Fcm>,
}

/// What one run did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PushReport {
    /// Notifications claimed (and marked pushed).
    pub claimed: usize,
    /// Of those, too old to push: marked without sending.
    pub too_old: usize,
    /// Pushes accepted by a provider.
    pub sent: usize,
    /// Tokens a provider reported dead, now cleared.
    pub cleared: usize,
    /// Pushes that failed, not retried.
    pub failed: usize,
}

/// Pushes staff notifications to the staff app. Off unless a provider is configured.
#[derive(Debug, Default)]
pub struct Push {
    setup: PushSetup,
}

impl Push {
    /// No provider: nothing is sent, notifications are still marked pushed.
    #[must_use]
    pub fn off() -> Self {
        Self::default()
    }

    /// Pushes through the providers in `setup`.
    #[must_use]
    pub const fn new(setup: PushSetup) -> Self {
        Self { setup }
    }

    /// Whether any provider is configured.
    #[must_use]
    pub const fn enabled(&self) -> bool {
        self.setup.apns.is_some() || self.setup.fcm.is_some()
    }

    /// The job step: claims new staff notifications, and pushes the recent ones to the devices
    /// of the members who see them.
    ///
    /// # Errors
    /// [`DbError`] when the database fails; notifications already marked stay marked.
    pub async fn run(&self, db: &Db, now: OffsetDateTime) -> Result<PushReport, DbError> {
        let claimed = dal::claim_push(db.pool(), now, BATCH).await?;
        let mut report = PushReport {
            claimed: claimed.len(),
            too_old: claimed.iter().filter(|row| !row.fresh).count(),
            ..PushReport::default()
        };
        if !self.enabled() {
            return Ok(report);
        }
        let mut by_clinic: HashMap<Uuid, Vec<_>> = HashMap::new();
        for row in claimed.into_iter().filter(|row| row.fresh) {
            by_clinic.entry(row.org_id).or_default().push(row);
        }
        let mut down = Down::default();
        for (org_id, rows) in by_clinic {
            self.push_clinic(db, org_id, rows, &mut down, &mut report)
                .await;
        }
        Ok(report)
    }

    /// One clinic's fresh notifications. A failure here is logged and the next clinic goes on:
    /// push never stops the rest of the job.
    async fn push_clinic(
        &self,
        db: &Db,
        org_id: Uuid,
        rows: Vec<dal::Claimed>,
        down: &mut Down,
        report: &mut PushReport,
    ) {
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let devices = match recipients::recipients(
            db,
            ClinicId::from_uuid(org_id),
            &ids,
            Audience::Clinic,
        )
        .await
        {
            Ok(devices) => devices,
            Err(error) => {
                tracing::warn!(org_id = %org_id, error = %error, "could not work out who to push to");
                return;
            }
        };
        for row in rows {
            let message = PushMessage {
                kind: row.kind,
                org_id,
                id: row.id,
                href: row.href.unwrap_or_else(|| NO_HREF.to_owned()),
            };
            for device in devices.get(&row.id).map_or(&[][..], Vec::as_slice) {
                self.send(db, device, &message, down, report).await;
            }
        }
    }

    /// Pushes a reminder or escalation to the members it is addressed to, as part of the
    /// reminder step; the notification it is about is the `id`.
    ///
    /// # Errors
    /// [`DbError`] when the database fails.
    pub(crate) async fn alert(&self, db: &Db, alert: &StaffAlert) -> Result<PushReport, DbError> {
        let mut report = PushReport::default();
        if !self.enabled() {
            return Ok(report);
        }
        let id = alert.notification_id.uuid();
        let org_id = alert.clinic_id.uuid();
        let devices =
            recipients::recipients(db, alert.clinic_id, &[id], alert.kind.audience()).await?;
        let message = PushMessage {
            kind: alert.kind.as_str().to_owned(),
            org_id,
            id,
            href: NO_HREF.to_owned(),
        };
        let mut down = Down::default();
        for device in devices.get(&id).map_or(&[][..], Vec::as_slice) {
            self.send(db, device, &message, &mut down, &mut report)
                .await;
        }
        Ok(report)
    }

    /// Sends to one device, clears its token when the provider says it is dead, and counts.
    async fn send(
        &self,
        db: &Db,
        device: &Device,
        message: &PushMessage,
        down: &mut Down,
        report: &mut PushReport,
    ) {
        let Some(platform) = DevicePlatform::parse(&device.platform) else {
            return;
        };
        let sent = match platform {
            DevicePlatform::Ios if !down.apns => match &self.setup.apns {
                Some(apns) => apns.send(&device.push_token, message).await,
                None => return,
            },
            DevicePlatform::Android if !down.fcm => match &self.setup.fcm {
                Some(fcm) => fcm.send(&device.push_token, message).await,
                None => return,
            },
            _ => return,
        };
        match sent {
            Ok(Delivery::Sent) => {
                report.sent += 1;
                tracing::info!(
                    event = aarogyam_domain::event::Event::PushSent.as_str(),
                    org_id = %message.org_id,
                    notification_id = %message.id,
                    device_id = %device.id,
                    kind = %message.kind,
                    "push sent"
                );
            }
            Ok(Delivery::DeadToken) => {
                if let Err(error) = dal::clear_token(db.pool(), device.id, &device.push_token).await
                {
                    tracing::warn!(device_id = %device.id, error = %error, "could not clear a dead push token");
                    return;
                }
                report.cleared += 1;
                tracing::info!(device_id = %device.id, "push token cleared: the provider says it is unregistered");
            }
            Ok(Delivery::Failed(reason)) => {
                report.failed += 1;
                tracing::warn!(
                    org_id = %message.org_id,
                    notification_id = %message.id,
                    device_id = %device.id,
                    reason = %reason,
                    "push not delivered"
                );
            }
            Err(Unreachable) => {
                report.failed += 1;
                // The rest of this run would only wait out the same timeouts.
                match platform {
                    DevicePlatform::Ios => down.apns = true,
                    DevicePlatform::Android => down.fcm = true,
                }
                tracing::warn!(device_id = %device.id, "push provider unreachable; skipping it for this run");
            }
        }
    }
}

/// Providers that couldn't be reached during this run.
#[derive(Debug, Default)]
struct Down {
    apns: bool,
    fcm: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message() -> PushMessage {
        PushMessage {
            kind: "collect_payment".to_owned(),
            org_id: Uuid::from_u128(1),
            id: Uuid::from_u128(2),
            href: "/billing/9".to_owned(),
        }
    }

    #[test]
    fn the_apns_body_has_ids_and_codes_only() {
        let body = apns_body(&message());
        assert_eq!(
            body,
            json!({
                "aps": {
                    "alert": { "loc-key": "push.collect_payment", "title-loc-key": "push.title" },
                    "thread-id": "collect_payment",
                    "sound": "default",
                },
                "kind": "collect_payment",
                "org_id": "00000000-0000-0000-0000-000000000001",
                "id": "00000000-0000-0000-0000-000000000002",
                "href": "/billing/9",
            })
        );
    }

    #[test]
    fn the_fcm_body_is_data_only_with_string_values() {
        let body = fcm_body("tok", &message());
        assert_eq!(
            body,
            json!({
                "message": {
                    "token": "tok",
                    "data": {
                        "kind": "collect_payment",
                        "org_id": "00000000-0000-0000-0000-000000000001",
                        "id": "00000000-0000-0000-0000-000000000002",
                        "href": "/billing/9",
                    },
                    "android": { "priority": "high" },
                }
            })
        );
        assert!(body["message"].get("notification").is_none());
        assert!(
            body["message"]["data"]
                .as_object()
                .is_some_and(|data| data.values().all(Value::is_string))
        );
    }

    #[test]
    fn apns_answers_are_classified() {
        assert_eq!(apns_outcome(200, b"", || {}), Delivery::Sent);
        assert_eq!(
            apns_outcome(410, br#"{"reason":"Unregistered"}"#, || {}),
            Delivery::DeadToken
        );
        // A configuration mistake (sandbox against production) must not clear tokens.
        assert_eq!(
            apns_outcome(400, br#"{"reason":"BadDeviceToken"}"#, || {}),
            Delivery::Failed("apns 400 BadDeviceToken".to_owned())
        );
        assert_eq!(
            apns_outcome(403, br#"{"reason":"InvalidProviderToken"}"#, || {}),
            Delivery::Failed("apns 403 InvalidProviderToken".to_owned())
        );
        assert_eq!(
            apns_outcome(400, br#"{"reason":"BadTopic"}"#, || {}),
            Delivery::Failed("apns 400 BadTopic".to_owned())
        );
        assert_eq!(
            apns_outcome(500, b"", || {}),
            Delivery::Failed("apns 500 ".to_owned())
        );
        let mut refreshed = false;
        apns_outcome(403, br#"{"reason":"ExpiredProviderToken"}"#, || {
            refreshed = true;
        });
        assert!(refreshed);
    }

    #[test]
    fn fcm_answers_are_classified() {
        assert_eq!(fcm_outcome(200, b"{}", || {}), Delivery::Sent);
        // A wrong project id answers 404 NOT_FOUND for everyone: logged, never cleared.
        assert_eq!(
            fcm_outcome(404, b"{}", || {}),
            Delivery::Failed("fcm 404".to_owned())
        );
        assert_eq!(
            fcm_outcome(404, br#"{"error":{"status":"NOT_FOUND"}}"#, || {}),
            Delivery::Failed("fcm 404".to_owned())
        );
        let unregistered =
            br#"{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}"#;
        assert_eq!(fcm_outcome(400, unregistered, || {}), Delivery::DeadToken);
        assert_eq!(
            fcm_outcome(400, br#"{"error":{"status":"INVALID_ARGUMENT"}}"#, || {}),
            Delivery::Failed("fcm 400".to_owned())
        );
        assert_eq!(
            fcm_outcome(503, b"", || {}),
            Delivery::Failed("fcm 503".to_owned())
        );
    }

    #[test]
    fn a_token_is_one_path_segment() {
        assert_eq!(path_segment("ab12CD"), "ab12CD");
        assert_eq!(path_segment("x/../y?z#w%"), "x%2F..%2Fy%3Fz%23w%25");
    }

    #[test]
    fn a_pem_with_escaped_line_breaks_is_repaired() {
        assert_eq!(pem("a\\nb"), "a\nb");
    }

    #[test]
    fn nothing_is_enabled_without_providers() {
        assert!(!Push::off().enabled());
    }
}
