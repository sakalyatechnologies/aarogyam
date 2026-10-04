//! One-time secrets for links (invitations, later share links): random, shown once, stored
//! only as a SHA-256.

use std::fmt::Write as _;

use aws_lc_rs::{digest, rand};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use crate::error::AppError;

/// A new 256-bit token (base64url, 43 characters) and its SHA-256 (hex).
///
/// # Errors
/// [`AppError::Internal`] if the system random number generator fails.
pub fn new_token() -> Result<(String, String), AppError> {
    let mut bytes = [0_u8; 32];
    rand::fill(&mut bytes).map_err(|_| AppError::Internal("random number generator failed"))?;
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let hash = hash_token(&token);
    Ok((token, hash))
}

/// The SHA-256 (hex) under which a token is stored and looked up.
#[must_use]
pub fn hash_token(token: &str) -> String {
    let hash = digest::digest(&digest::SHA256, token.trim().as_bytes());
    hash.as_ref()
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            // Writing to a String can't fail.
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_hash_stably() {
        let (first, first_hash) = new_token().unwrap();
        let (second, _) = new_token().unwrap();
        assert_ne!(first, second);
        assert_eq!(first.len(), 43);
        assert_eq!(first_hash, hash_token(&first));
        assert_eq!(first_hash, hash_token(&format!(" {first} ")));
        assert_eq!(first_hash.len(), 64);
    }
}
