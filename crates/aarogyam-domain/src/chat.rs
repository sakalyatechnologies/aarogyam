//! Staff chat: one-to-one, group and clinic-wide conversations between members of a clinic, in
//! plain text. Pure rules: the message and title limits, the key that makes a direct
//! conversation unique, paging, and what a message's file may be. A message may name one patient
//! by id; its text is never logged.

use crate::files::FileType;
use crate::ids::{ChatMessageId, MembershipId};

text_value! {
    /// One to one, a named group, or a channel the system keeps for the whole clinic.
    ConversationKind ("kind") {
        /// Two members; one conversation per pair.
        Direct => "direct",
        /// A named group that admins add members to.
        Group => "group",
        /// A clinic-wide conversation, such as "Everyone": its members are the clinic's active
        /// staff, kept by the system.
        Channel => "channel",
    }
}

/// The key of the channel every clinic has: all of its active staff.
pub const EVERYONE_CHANNEL: &str = "everyone";

/// Largest file in a chat message: 5 MB.
pub const MAX_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024;
/// Longest file name kept, in characters.
pub const MAX_FILE_NAME_CHARS: usize = 120;

/// Why a chat file was refused. Messages never echo the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AttachmentError {
    /// Nothing was sent.
    #[error("must not be empty")]
    Empty,
    /// Over 5 MB.
    #[error("must be at most 5 MB")]
    TooLarge,
    /// Not a JPEG, PNG or PDF, judged by its content.
    #[error("must be a JPEG, PNG or PDF")]
    Type,
}

/// Checks a chat file: not empty, at most 5 MB, and a JPEG, PNG or PDF by its content (never by
/// its name or the type the sender claims).
///
/// # Errors
/// What is wrong with it.
pub fn check_attachment(bytes: &[u8]) -> Result<FileType, AttachmentError> {
    if bytes.is_empty() {
        return Err(AttachmentError::Empty);
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AttachmentError::TooLarge);
    }
    match FileType::sniff(bytes) {
        Some(kind @ (FileType::Jpeg | FileType::Png | FileType::Pdf)) => Ok(kind),
        _ => Err(AttachmentError::Type),
    }
}

/// The name a sender's device gave a file, made safe to show: the last path component, control
/// characters dropped, trimmed, at most 120 characters. `None` when nothing is left. Never used
/// as a path: the bytes are stored under an id.
#[must_use]
pub fn tidy_file_name(name: &str) -> Option<String> {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last.chars().filter(|c| !c.is_control()).collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return None;
    }
    Some(cleaned.chars().take(MAX_FILE_NAME_CHARS).collect())
}

text_value! {
    /// A member's place in a conversation.
    MemberRole ("role") {
        /// Reads and posts.
        Member => "member",
        /// Also adds and removes members (groups only).
        Admin => "admin",
    }
}

/// Longest message, in characters.
pub const MAX_BODY_CHARS: usize = 4000;
/// Longest group title, in characters.
pub const MAX_TITLE_CHARS: usize = 80;
/// Most members a group may have, its creator included.
pub const MAX_GROUP_MEMBERS: usize = 100;
/// Unread counts stop here: a badge shows "99+" above 99.
pub const UNREAD_CAP: i64 = 100;
/// Default page of messages.
pub const DEFAULT_PAGE: i64 = 50;
/// Largest page of messages or conversations.
pub const MAX_PAGE: i64 = 100;

/// The page size asked for, within 1 to [`MAX_PAGE`]; [`DEFAULT_PAGE`] when absent.
#[must_use]
pub fn page_size(asked: Option<u32>) -> i64 {
    asked.map_or(DEFAULT_PAGE, |n| i64::from(n).clamp(1, MAX_PAGE))
}

/// Checks a message: 1 to 4000 characters, not only spaces, plain text (no control characters
/// other than new lines and tabs). Kept as written.
///
/// # Errors
/// What is wrong, without echoing the text.
pub fn message_body(text: &str) -> Result<&str, &'static str> {
    if text.trim().is_empty() {
        return Err("must not be empty");
    }
    if text.chars().count() > MAX_BODY_CHARS {
        return Err("must be at most 4000 characters");
    }
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("must be plain text");
    }
    Ok(text)
}

/// Checks a group title: 1 to 80 characters once trimmed, on one line.
///
/// # Errors
/// What is wrong.
pub fn group_title(text: &str) -> Result<String, &'static str> {
    let text = text.trim();
    let chars = text.chars().count();
    if chars == 0 || chars > MAX_TITLE_CHARS {
        return Err("must be 1 to 80 characters");
    }
    if text.chars().any(char::is_control) {
        return Err("must be one line of plain text");
    }
    Ok(text.to_owned())
}

/// The key of the direct conversation between two members, the same whichever starts it:
/// both membership ids, smaller first, as the database orders them.
#[must_use]
pub fn direct_key(a: MembershipId, b: MembershipId) -> String {
    let (low, high) = if a.uuid() <= b.uuid() { (a, b) } else { (b, a) };
    format!("{}:{}", low.uuid(), high.uuid())
}

/// Which messages a poll asks for. Ids are version 7 UUIDs, so they sort by time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cursor {
    /// The newest page.
    Latest,
    /// Messages newer than this one (polling for new ones).
    After(ChatMessageId),
    /// Messages older than this one (scrolling back).
    Before(ChatMessageId),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bodies_are_plain_text_within_the_limit() {
        assert_eq!(
            message_body("Chair 2 free?\nThanks"),
            Ok("Chair 2 free?\nThanks")
        );
        assert!(message_body("   \n").is_err());
        assert!(message_body(&"a".repeat(4000)).is_ok());
        assert!(message_body(&"अ".repeat(4001)).is_err());
        assert!(message_body("bell\u{7}").is_err());
    }

    #[test]
    fn chat_files_are_small_images_or_pdfs_by_content() {
        let png = b"\x89PNG\r\n\x1a\nrest".to_vec();
        assert_eq!(check_attachment(&png), Ok(FileType::Png));
        assert_eq!(check_attachment(b"%PDF-1.7"), Ok(FileType::Pdf));
        assert_eq!(
            check_attachment(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Ok(FileType::Jpeg)
        );
        assert_eq!(check_attachment(b""), Err(AttachmentError::Empty));
        assert_eq!(check_attachment(b"MZ\x90\x00"), Err(AttachmentError::Type));
        assert_eq!(check_attachment(b"OggS...."), Err(AttachmentError::Type));
        let mut big = b"%PDF-".to_vec();
        big.resize(MAX_ATTACHMENT_BYTES + 1, 0);
        assert_eq!(check_attachment(&big), Err(AttachmentError::TooLarge));
        big.truncate(MAX_ATTACHMENT_BYTES);
        assert_eq!(check_attachment(&big), Ok(FileType::Pdf));
    }

    #[test]
    fn file_names_lose_paths_and_control_characters() {
        assert_eq!(
            tidy_file_name("C:\\scans\\opg.png").as_deref(),
            Some("opg.png")
        );
        assert_eq!(
            tidy_file_name("../../etc/passwd").as_deref(),
            Some("passwd")
        );
        assert_eq!(tidy_file_name(" a\nb.pdf ").as_deref(), Some("ab.pdf"));
        assert_eq!(tidy_file_name("dir/"), None);
        assert_eq!(tidy_file_name(&"x".repeat(300)).map(|n| n.len()), Some(120));
    }

    #[test]
    fn titles_are_trimmed_single_lines() {
        assert_eq!(group_title("  Front desk  ").unwrap(), "Front desk");
        assert!(group_title(" ").is_err());
        assert!(group_title("a\nb").is_err());
        assert!(group_title(&"x".repeat(81)).is_err());
    }

    #[test]
    fn the_direct_key_ignores_who_starts() {
        let a = MembershipId::new_v7();
        let b = MembershipId::new_v7();
        assert_eq!(direct_key(a, b), direct_key(b, a));
        assert!(direct_key(a, b).starts_with(&a.uuid().to_string()));
    }

    #[test]
    fn page_sizes_stay_in_range() {
        assert_eq!(page_size(None), 50);
        assert_eq!(page_size(Some(0)), 1);
        assert_eq!(page_size(Some(500)), 100);
        assert_eq!(
            ConversationKind::parse("group"),
            Ok(ConversationKind::Group)
        );
        assert_eq!(MemberRole::Admin.as_str(), "admin");
        assert_eq!(
            ConversationKind::parse("channel"),
            Ok(ConversationKind::Channel)
        );
    }
}
