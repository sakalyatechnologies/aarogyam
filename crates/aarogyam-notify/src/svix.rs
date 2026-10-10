//! Checking a webhook signed the Svix way (Resend's webhooks): HMAC-SHA256, keyed with the
//! endpoint's secret (`whsec_` and base64), over `{svix-id}.{svix-timestamp}.{raw body}`, sent
//! base64-encoded in `svix-signature` as one or more space-separated `v1,<signature>`. The
//! timestamp must be within five minutes of now, so a captured request can't be replayed later.
//! Nothing here knows about clinics: it moves to `sakalya-backend` with the email sender.

use aws_lc_rs::hmac;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use secrecy::{ExposeSecret, SecretString};
use time::OffsetDateTime;

/// How far a webhook's timestamp may be from now, in seconds.
pub const TOLERANCE_SECONDS: i64 = 5 * 60;
/// Largest body checked; providers' events are a few kilobytes.
pub const MAX_BODY: usize = 64 * 1024;

/// Why a webhook was refused. None of these say which part of the signature was wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SvixError {
    /// The configured secret isn't `whsec_` and base64.
    #[error("the webhook secret is not valid")]
    Secret,
    /// A header is missing or malformed, or the body is too large.
    #[error("malformed webhook")]
    Malformed,
    /// The timestamp is too far from now.
    #[error("webhook timestamp out of tolerance")]
    Stale,
    /// No signature matches.
    #[error("webhook signature does not match")]
    Signature,
}

/// The three Svix headers of a request.
#[derive(Debug, Clone, Copy)]
pub struct SvixHeaders<'a> {
    /// `svix-id`: the message id, also the event's idempotency key.
    pub id: &'a str,
    /// `svix-timestamp`: seconds since the epoch.
    pub timestamp: &'a str,
    /// `svix-signature`: `v1,<base64>` entries separated by spaces.
    pub signature: &'a str,
}

/// Checks `body` (the raw bytes, before any parsing) against `headers` and `secret` at `now`.
///
/// # Errors
/// An [`SvixError`] when the request isn't authentic or is too old or too new.
pub fn verify(
    secret: &SecretString,
    headers: SvixHeaders<'_>,
    body: &[u8],
    now: OffsetDateTime,
) -> Result<(), SvixError> {
    let encoded = secret
        .expose_secret()
        .strip_prefix("whsec_")
        .ok_or(SvixError::Secret)?;
    let key_bytes = STANDARD.decode(encoded).map_err(|_| SvixError::Secret)?;
    if body.len() > MAX_BODY || headers.id.is_empty() || headers.id.len() > 200 {
        return Err(SvixError::Malformed);
    }
    let sent: i64 = headers
        .timestamp
        .trim()
        .parse()
        .map_err(|_| SvixError::Malformed)?;
    if (now.unix_timestamp() - sent).abs() > TOLERANCE_SECONDS {
        return Err(SvixError::Stale);
    }
    let key = hmac::Key::new(hmac::HMAC_SHA256, &key_bytes);
    let mut signed = Vec::with_capacity(headers.id.len() + body.len() + 24);
    signed.extend_from_slice(headers.id.as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(headers.timestamp.trim().as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(body);
    let matched = headers
        .signature
        .split_whitespace()
        .filter_map(|entry| entry.strip_prefix("v1,"))
        .filter_map(|candidate| STANDARD.decode(candidate).ok())
        // hmac::verify compares in constant time.
        .any(|candidate| hmac::verify(&key, &signed, &candidate).is_ok());
    if matched {
        Ok(())
    } else {
        Err(SvixError::Signature)
    }
}

/// Signs like Svix, for tests and for checking a configuration by hand.
///
/// # Errors
/// [`SvixError::Secret`] when the secret isn't `whsec_` and base64.
pub fn sign(
    secret: &SecretString,
    id: &str,
    timestamp: i64,
    body: &[u8],
) -> Result<String, SvixError> {
    let encoded = secret
        .expose_secret()
        .strip_prefix("whsec_")
        .ok_or(SvixError::Secret)?;
    let key_bytes = STANDARD.decode(encoded).map_err(|_| SvixError::Secret)?;
    let key = hmac::Key::new(hmac::HMAC_SHA256, &key_bytes);
    let mut signed = format!("{id}.{timestamp}.").into_bytes();
    signed.extend_from_slice(body);
    Ok(format!("v1,{}", STANDARD.encode(hmac::sign(&key, &signed))))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Svix's published test vector: a recorded, validly signed request.
    const SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const ID: &str = "msg_p5jXN8AQM9LWM0D4loKWxJek";
    const TIMESTAMP: i64 = 1_614_265_330;
    const BODY: &[u8] = br#"{"test": 2432232314}"#;
    const SIGNATURE: &str = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

    fn at(seconds: i64) -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(seconds).unwrap()
    }

    fn headers<'a>(timestamp: &'a str, signature: &'a str) -> SvixHeaders<'a> {
        SvixHeaders {
            id: ID,
            timestamp,
            signature,
        }
    }

    #[test]
    fn the_recorded_request_passes_and_tampering_fails() {
        let secret = SecretString::from(SECRET);
        let stamp = TIMESTAMP.to_string();
        let now = at(TIMESTAMP + 10);
        assert_eq!(
            verify(&secret, headers(&stamp, SIGNATURE), BODY, now),
            Ok(())
        );
        // Several signatures (a rotated secret): any one matching is enough.
        let rotated = format!("v1,bm9wZQ== {SIGNATURE}");
        assert_eq!(
            verify(&secret, headers(&stamp, &rotated), BODY, now),
            Ok(())
        );
        assert_eq!(sign(&secret, ID, TIMESTAMP, BODY).unwrap(), SIGNATURE);

        let tampered = br#"{"test": 2432232315}"#;
        assert_eq!(
            verify(&secret, headers(&stamp, SIGNATURE), tampered, now),
            Err(SvixError::Signature)
        );
        let other_id = SvixHeaders {
            id: "msg_other",
            ..headers(&stamp, SIGNATURE)
        };
        assert_eq!(
            verify(&secret, other_id, BODY, now),
            Err(SvixError::Signature)
        );
        let wrong_secret = SecretString::from("whsec_c2VjcmV0");
        assert_eq!(
            verify(&wrong_secret, headers(&stamp, SIGNATURE), BODY, now),
            Err(SvixError::Signature)
        );
    }

    #[test]
    fn old_future_and_malformed_requests_are_refused() {
        let secret = SecretString::from(SECRET);
        let stamp = TIMESTAMP.to_string();
        let late = at(TIMESTAMP + TOLERANCE_SECONDS + 1);
        assert_eq!(
            verify(&secret, headers(&stamp, SIGNATURE), BODY, late),
            Err(SvixError::Stale)
        );
        let early = at(TIMESTAMP - TOLERANCE_SECONDS - 1);
        assert_eq!(
            verify(&secret, headers(&stamp, SIGNATURE), BODY, early),
            Err(SvixError::Stale)
        );
        let now = at(TIMESTAMP);
        assert_eq!(
            verify(&secret, headers("soon", SIGNATURE), BODY, now),
            Err(SvixError::Malformed)
        );
        let huge = vec![b'x'; MAX_BODY + 1];
        assert_eq!(
            verify(&secret, headers(&stamp, SIGNATURE), &huge, now),
            Err(SvixError::Malformed)
        );
        assert_eq!(
            verify(
                &SecretString::from("plain"),
                headers(&stamp, SIGNATURE),
                BODY,
                now
            ),
            Err(SvixError::Secret)
        );
        assert_eq!(
            verify(&secret, headers(&stamp, "v2,abc"), BODY, now),
            Err(SvixError::Signature)
        );
    }
}
