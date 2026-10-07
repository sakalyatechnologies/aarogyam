//! Formatted clinical text: a strict Markdown subset, stored as plain text.
//!
//! Allowed: headings (`#`, `##`, `###` and a space), bullet lists (`- ` or `* `), numbered lists
//! (`1. `), `**bold**` and `*italic*` (or `_italic_`). Everything else is plain text. Raw HTML,
//! links, images and code are refused on save, so every renderer (web, phone) only has to
//! understand this small set and can treat anything else as literal text.

use crate::clinical::ClinicalError;

/// Most characters in a patient's summary note.
pub const MAX_SUMMARY: usize = 20_000;

/// A patient summary note's text, trimmed and checked; empty is allowed (the note is cleared).
///
/// # Errors
/// [`ClinicalError::Text`] when too long or containing control characters;
/// [`ClinicalError::Format`] when outside the subset.
pub fn summary(text: &str) -> Result<String, ClinicalError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(String::new());
    }
    let text = crate::clinical::clinical_text(text, 1, MAX_SUMMARY)?;
    validate(&text)?;
    Ok(text)
}

/// Checks that `text` stays within the subset.
///
/// # Errors
/// [`ClinicalError::Format`] for raw HTML (`<` before a letter, `/`, `!` or `?`), images
/// (`![`), links (`](`), code (a backtick) or headings deeper than level 3.
pub fn validate(text: &str) -> Result<(), ClinicalError> {
    let bytes = text.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        let next = bytes.get(index + 1).copied().unwrap_or(b' ');
        let bad = match byte {
            b'<' => next.is_ascii_alphabetic() || matches!(next, b'/' | b'!' | b'?'),
            b'!' => next == b'[',
            b']' => next == b'(',
            b'`' => true,
            _ => false,
        };
        if bad {
            return Err(ClinicalError::Format);
        }
    }
    for line in text.lines() {
        let hashes = line.trim_start().bytes().take_while(|b| *b == b'#').count();
        if hashes > 3 && line.trim_start().as_bytes().get(hashes) == Some(&b' ') {
            return Err(ClinicalError::Format);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_subset_passes() {
        let text = "## Plan\n- **RCT** on 36\n- *review* in 1 week\n1. First\n2. BP < 120 and x<3";
        assert!(validate(text).is_ok());
    }

    #[test]
    fn html_links_images_and_code_are_refused() {
        for bad in [
            "<script>alert(1)</script>",
            "a <b>bold</b>",
            "<!-- x -->",
            "</p>",
            "![x](http://e)",
            "[x](javascript:alert(1))",
            "`code`",
            "#### too deep",
        ] {
            assert_eq!(validate(bad), Err(ClinicalError::Format), "{bad}");
        }
    }
}
