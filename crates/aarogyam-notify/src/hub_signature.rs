//! Checking a webhook signed the Meta way (`X-Hub-Signature-256: sha256=<hex>`): HMAC-SHA256,
//! keyed with the app secret, over the raw body, compared in constant time. Nothing here knows
//! about clinics: it moves to `sakalya-backend` with the `WhatsApp` sender.

use std::fmt::Write as _;

use aws_lc_rs::hmac;
use secrecy::{ExposeSecret, SecretString};

/// Largest body checked. Meta batches up to 1000 updates in one request.
pub const MAX_BODY: usize = 1024 * 1024;

/// Why a webhook was refused. None of these say which part was wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HubSignatureError {
    /// No app secret is configured.
    #[error("the webhook secret is not configured")]
    Secret,
    /// The header is missing or not `sha256=<hex>`, or the body is too large.
    #[error("malformed webhook")]
    Malformed,
    /// The signature doesn't match.
    #[error("webhook signature does not match")]
    Signature,
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if text.len() != 64 {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(text.get(at..at + 2)?, 16).ok())
        .collect()
}

/// Checks `body` (the raw bytes) against the `X-Hub-Signature-256` header value.
///
/// # Errors
/// A [`HubSignatureError`] when the request isn't authentic.
pub fn verify(secret: &SecretString, header: &str, body: &[u8]) -> Result<(), HubSignatureError> {
    if secret.expose_secret().is_empty() {
        return Err(HubSignatureError::Secret);
    }
    if body.len() > MAX_BODY {
        return Err(HubSignatureError::Malformed);
    }
    let given = header
        .trim()
        .strip_prefix("sha256=")
        .and_then(decode_hex)
        .ok_or(HubSignatureError::Malformed)?;
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.expose_secret().as_bytes());
    // hmac::verify compares in constant time.
    hmac::verify(&key, body, &given).map_err(|_| HubSignatureError::Signature)
}

/// Signs like Meta, for tests and for checking a configuration by hand.
#[must_use]
pub fn sign(secret: &SecretString, body: &[u8]) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.expose_secret().as_bytes());
    let tag = hmac::sign(&key, body);
    let hex = tag
        .as_ref()
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            // Writing to a String can't fail.
            let _ = write!(hex, "{byte:02x}");
            hex
        });
    format!("sha256={hex}")
}

/// Whether a `hub.verify_token` matches the configured one, in constant time.
#[must_use]
pub fn token_matches(expected: &SecretString, given: &str) -> bool {
    let expected = expected.expose_secret().as_bytes();
    !expected.is_empty()
        && aws_lc_rs::constant_time::verify_slices_are_equal(expected, given.as_bytes()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A recorded request: HMAC-SHA256 of this body with key "app-secret", computed with
    /// `openssl dgst -sha256 -hmac app-secret`.
    const BODY: &[u8] = br#"{"object":"whatsapp_business_account","entry":[]}"#;
    const SIGNATURE: &str =
        "sha256=d3e4f9da0ce6c71ab3dba55929b8eeeee2455349e534924ead19f98d143e904f";

    #[test]
    fn a_valid_signature_passes_and_tampering_fails() {
        let secret = SecretString::from("app-secret");
        let signed = sign(&secret, BODY);
        assert_eq!(signed, SIGNATURE);
        assert_eq!(verify(&secret, SIGNATURE, BODY), Ok(()));
        assert_eq!(
            verify(
                &secret,
                &SIGNATURE.to_uppercase().replace("SHA256", "sha256"),
                BODY
            ),
            Ok(())
        );
        assert_eq!(
            verify(
                &secret,
                &signed,
                br#"{"object":"whatsapp_business_account","entry":[1]}"#
            ),
            Err(HubSignatureError::Signature)
        );
        assert_eq!(
            verify(&SecretString::from("other"), &signed, BODY),
            Err(HubSignatureError::Signature)
        );
        let flipped = SIGNATURE.replace("d3e4", "d3e5");
        assert_eq!(
            verify(&secret, &flipped, BODY),
            Err(HubSignatureError::Signature)
        );
        assert_eq!(
            verify(&secret, "sha1=abc", BODY),
            Err(HubSignatureError::Malformed)
        );
        assert_eq!(verify(&secret, "", BODY), Err(HubSignatureError::Malformed));
        let huge = vec![b' '; MAX_BODY + 1];
        assert_eq!(
            verify(&secret, &signed, &huge),
            Err(HubSignatureError::Malformed)
        );
        assert_eq!(
            verify(&SecretString::from(""), &signed, BODY),
            Err(HubSignatureError::Secret)
        );
    }

    #[test]
    fn verify_tokens_compare_exactly() {
        let token = SecretString::from("verify-me");
        assert!(token_matches(&token, "verify-me"));
        assert!(!token_matches(&token, "verify-m"));
        assert!(!token_matches(&SecretString::from(""), ""));
    }
}
