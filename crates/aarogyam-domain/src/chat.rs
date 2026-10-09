//! Staff chat: one-to-one and group conversations between members of a clinic, in plain text.
//! Pure rules: the message and title limits, the key that makes a direct conversation unique,
//! and paging. A message may name one patient by id; its text is never logged.

use crate::ids::{ChatMessageId, MembershipId};

text_value! {
    /// One to one, or a named group.
    ConversationKind ("kind") {
        /// Two members; one conversation per pair.
        Direct => "direct",
        /// A named group that admins add members to.
        Group => "group",
    }
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
    }
}
