//! Patient files: which kinds are accepted, decided from the bytes themselves (never from the
//! file name or the type the browser claims), and how large they may be.

/// Largest file accepted: 10 MB.
pub const MAX_BYTES: usize = 10 * 1024 * 1024;

/// A file type Aarogyam accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileType {
    /// JPEG image.
    Jpeg,
    /// PNG image.
    Png,
    /// PDF document.
    Pdf,
    /// DICOM file (an X-ray from a sensor), stored as a file, not parsed.
    Dicom,
    /// `WebM` audio (Chrome, Edge, Firefox recordings).
    Webm,
    /// `MP4` audio (Safari recordings).
    Mp4Audio,
    /// `Ogg` audio (Firefox recordings).
    Ogg,
}

/// Longest voice recording: ten minutes.
pub const MAX_VOICE_SECONDS: i32 = 600;

/// A language a recording is spoken in, as the browser names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceLanguage {
    /// English (India).
    EnIn,
    /// Hindi.
    HiIn,
    /// Marathi.
    MrIn,
    /// Gujarati.
    GuIn,
}

impl VoiceLanguage {
    /// The BCP 47 tag.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EnIn => "en-IN",
            Self::HiIn => "hi-IN",
            Self::MrIn => "mr-IN",
            Self::GuIn => "gu-IN",
        }
    }

    /// Parses a tag.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        [Self::EnIn, Self::HiIn, Self::MrIn, Self::GuIn]
            .into_iter()
            .find(|language| language.as_str() == text)
    }
}

impl FileType {
    /// Recognises a file from its first bytes.
    #[must_use]
    pub fn sniff(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(Self::Jpeg)
        } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some(Self::Png)
        } else if bytes.starts_with(b"%PDF-") {
            Some(Self::Pdf)
        } else if bytes.get(128..132) == Some(b"DICM") {
            Some(Self::Dicom)
        } else if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
            Some(Self::Webm)
        } else if bytes.get(4..8) == Some(b"ftyp") {
            Some(Self::Mp4Audio)
        } else if bytes.starts_with(b"OggS") {
            Some(Self::Ogg)
        } else {
            None
        }
    }

    /// The media type stored and served.
    #[must_use]
    pub const fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Pdf => "application/pdf",
            Self::Dicom => "application/dicom",
            Self::Webm => "audio/webm",
            Self::Mp4Audio => "audio/mp4",
            Self::Ogg => "audio/ogg",
        }
    }

    /// Whether this is a recording.
    #[must_use]
    pub const fn is_audio(self) -> bool {
        matches!(self, Self::Webm | Self::Mp4Audio | Self::Ogg)
    }

    /// Parses a stored media type.
    #[must_use]
    pub fn from_mime_type(text: &str) -> Option<Self> {
        [
            Self::Jpeg,
            Self::Png,
            Self::Pdf,
            Self::Dicom,
            Self::Webm,
            Self::Mp4Audio,
            Self::Ogg,
        ]
        .into_iter()
        .find(|kind| kind.mime_type() == text)
    }

    /// The extension used in the download's file name.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Pdf => "pdf",
            Self::Dicom => "dcm",
            Self::Webm => "webm",
            Self::Mp4Audio => "m4a",
            Self::Ogg => "ogg",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_are_recognised_by_content() {
        assert_eq!(
            FileType::sniff(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]),
            Some(FileType::Jpeg)
        );
        assert_eq!(
            FileType::sniff(b"\x89PNG\r\n\x1a\n...."),
            Some(FileType::Png)
        );
        assert_eq!(FileType::sniff(b"%PDF-1.7\n"), Some(FileType::Pdf));
        let mut dicom = vec![0_u8; 128];
        dicom.extend_from_slice(b"DICM\x02\x00");
        assert_eq!(FileType::sniff(&dicom), Some(FileType::Dicom));
        assert_eq!(
            FileType::sniff(&[0x1A, 0x45, 0xDF, 0xA3, 1]),
            Some(FileType::Webm)
        );
        assert_eq!(
            FileType::sniff(b"\0\0\0\x18ftypM4A "),
            Some(FileType::Mp4Audio)
        );
        assert_eq!(FileType::sniff(b"OggS\0"), Some(FileType::Ogg));
        assert!(FileType::Webm.is_audio() && !FileType::Pdf.is_audio());
        assert_eq!(VoiceLanguage::parse("mr-IN"), Some(VoiceLanguage::MrIn));
        assert_eq!(VoiceLanguage::parse("gu-IN"), Some(VoiceLanguage::GuIn));
        assert_eq!(VoiceLanguage::parse("fr-FR"), None);
        assert_eq!(FileType::sniff(b"<html><script>"), None);
        assert_eq!(FileType::sniff(b""), None);
        assert_eq!(
            FileType::from_mime_type("application/pdf"),
            Some(FileType::Pdf)
        );
        assert_eq!(FileType::from_mime_type("text/html"), None);
    }
}
