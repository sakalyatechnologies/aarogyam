//! `WhatsApp` rules with no I/O (docs/whatsapp.md): the STOP keywords a reply is checked
//! against, what Meta's error codes mean for a message, and template categories and statuses.

use crate::messaging::SkipReason;

/// Replies that opt a phone out of `WhatsApp` from the clinic, compared after
/// [`normalise`]: English, Hindi (Devanagari and Latin) and Marathi. A reply is a STOP only when
/// it is one of these as a whole (`stop`, `Stop!`, ` बंद `), so "please don't stop my
/// treatment" is not. Meta's own "Stop promotions" quick-reply button is included.
pub const STOP_KEYWORDS: &[&str] = &[
    // English.
    "stop",
    "stop all",
    "stop promotions",
    "unsubscribe",
    "cancel",
    "end",
    "quit",
    "opt out",
    "optout",
    // Hindi.
    "रोको",
    "रोकें",
    "रोका",
    "बंद",
    "बंद करो",
    "बंद करें",
    "band",
    "band karo",
    "roko",
    // Marathi.
    "थांबवा",
    "थांबा",
    "बंद करा",
    "thambva",
    "thamba",
];

/// Lower case, with surrounding spaces and punctuation trimmed and inner runs of spaces made one.
#[must_use]
pub fn normalise(text: &str) -> String {
    let trimmed =
        text.trim_matches(|c: char| c.is_whitespace() || c.is_ascii_punctuation() || c == '।');
    trimmed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Whether a reply asks to stop. Long texts never are: only the first 40 characters are read.
#[must_use]
pub fn is_stop(text: &str) -> bool {
    if text.chars().count() > 40 {
        return false;
    }
    let reply = normalise(text);
    STOP_KEYWORDS.contains(&reply.as_str())
}

/// What a Meta error means for the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetaOutcome {
    /// Never send it, for this reason (not a failure: nothing is wrong with the setup).
    Skip(SkipReason),
    /// Try again later with backoff.
    Retry,
    /// Give up: a fault to look at (a bad token, a wrong parameter count).
    Fail,
}

/// Classifies a failed send by HTTP status and Meta's error code.
#[must_use]
pub const fn classify(http_status: u16, code: Option<i64>) -> MetaOutcome {
    match code {
        // The per-user marketing limit: Meta chose not to deliver it.
        Some(131_049) => MetaOutcome::Skip(SkipReason::MarketingLimit),
        // The template is paused for low quality.
        Some(132_015) => MetaOutcome::Skip(SkipReason::TemplatePaused),
        // The number isn't on WhatsApp, or can't receive this message.
        Some(131_026) => MetaOutcome::Skip(SkipReason::Undeliverable),
        // Rate limits (throughput, pair rate, spam) and Meta's own outages.
        Some(4 | 80_007 | 130_429 | 131_056 | 131_000 | 131_016 | 1 | 2) => MetaOutcome::Retry,
        _ if http_status == 429 || http_status >= 500 => MetaOutcome::Retry,
        _ => MetaOutcome::Fail,
    }
}

text_value! {
    /// A template's category, as Meta assigns and returns it; it sets the price.
    TemplateCategory ("category") {
        /// Offers, announcements, invitations.
        Marketing => "marketing",
        /// About something the patient already has: an appointment, a prescription.
        Utility => "utility",
        /// One-time codes.
        Authentication => "authentication",
    }
}

text_value! {
    /// Where a clinic's template is in Meta's review.
    TemplateStatus ("status") {
        /// Being written; not sent.
        Draft => "draft",
        /// Sent to Meta for review.
        Submitted => "submitted",
        /// Approved: may be sent.
        Approved => "approved",
        /// Refused by Meta.
        Rejected => "rejected",
        /// Paused by Meta for low quality.
        Paused => "paused",
    }
}

/// Meta's language code for ours: the primary subtag (`en-IN` is `en`).
#[must_use]
pub fn meta_language(language: &str) -> &str {
    language.split('-').next().unwrap_or(language)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_matches_whole_replies_in_three_languages() {
        for reply in [
            "STOP",
            " stop! ",
            "Unsubscribe.",
            "रोको",
            "बंद",
            " थांबवा ",
            "Stop promotions",
        ] {
            assert!(is_stop(reply), "{reply}");
        }
        for reply in [
            "please don't stop my treatment",
            "stopped",
            "hello",
            "",
            "ok बंद है क्या?",
        ] {
            assert!(!is_stop(reply), "{reply}");
        }
        assert!(!is_stop(&"stop ".repeat(20)));
    }

    #[test]
    fn meta_errors_skip_retry_or_fail() {
        assert_eq!(
            classify(400, Some(131_049)),
            MetaOutcome::Skip(SkipReason::MarketingLimit)
        );
        assert_eq!(
            classify(400, Some(132_015)),
            MetaOutcome::Skip(SkipReason::TemplatePaused)
        );
        assert_eq!(
            classify(400, Some(131_026)),
            MetaOutcome::Skip(SkipReason::Undeliverable)
        );
        assert_eq!(classify(429, None), MetaOutcome::Retry);
        assert_eq!(classify(503, Some(999)), MetaOutcome::Retry);
        assert_eq!(classify(400, Some(130_429)), MetaOutcome::Retry);
        assert_eq!(classify(401, Some(190)), MetaOutcome::Fail);
        assert_eq!(meta_language("hi-IN"), "hi");
    }
}
