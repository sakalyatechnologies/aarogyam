//! A staff member's avatar: one of the apps' preset pictures, named by an id, or their own
//! photo. The server knows no preset list; the apps ship the pictures, so an id is only checked
//! for shape.

use crate::files::FileType;
use crate::letterhead::MAX_IMAGE_BYTES;

/// Why an avatar was rejected. Messages name the field, never the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AvatarError {
    /// Not 1 to 32 lower-case letters, digits or `_`, starting with a letter.
    #[error(
        "preset must be 1 to 32 lower-case letters, digits or underscores, starting with a letter"
    )]
    Preset,
    /// An image that is too large, empty or not PNG or JPEG.
    #[error("file must be a PNG or JPEG of at most 2 MB")]
    Photo,
    /// Neither or both of `preset` and `file`.
    #[error("send exactly one of preset or file")]
    Choice,
}

impl AvatarError {
    /// The request field the error concerns.
    #[must_use]
    pub const fn field(self) -> &'static str {
        match self {
            Self::Preset => "preset",
            Self::Photo => "file",
            Self::Choice => "avatar",
        }
    }
}

/// Checks a preset id.
///
/// # Errors
/// [`AvatarError::Preset`] unless it is 1 to 32 lower-case letters, digits or `_`, starting with
/// a letter.
pub fn check_preset(text: &str) -> Result<&str, AvatarError> {
    let mut chars = text.chars();
    let shaped = chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && text.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    shaped.then_some(text).ok_or(AvatarError::Preset)
}

/// Checks a photo from its bytes: 1 byte to 2 MB, PNG or JPEG by content.
///
/// # Errors
/// [`AvatarError::Photo`] otherwise.
pub fn check_photo(bytes: &[u8]) -> Result<FileType, AvatarError> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(AvatarError::Photo);
    }
    match FileType::sniff(bytes) {
        Some(kind @ (FileType::Jpeg | FileType::Png)) => Ok(kind),
        _ => Err(AvatarError::Photo),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_short_ids() {
        assert_eq!(check_preset("tooth_3"), Ok("tooth_3"));
        for bad in ["", "Tooth", "3tooth", "has space", "a-b", &"a".repeat(33)] {
            assert_eq!(check_preset(bad), Err(AvatarError::Preset), "{bad}");
        }
    }

    #[test]
    fn photos_are_png_or_jpeg_by_content() {
        assert_eq!(check_photo(b""), Err(AvatarError::Photo));
        assert_eq!(check_photo(b"GIF89a....."), Err(AvatarError::Photo));
        assert_eq!(
            check_photo(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]),
            Ok(FileType::Png)
        );
    }
}
