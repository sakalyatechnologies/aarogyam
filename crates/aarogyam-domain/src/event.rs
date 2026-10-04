//! Business events: one `info` log line each, with the name in the `event` field, so
//! dashboards and queries can count them. Names are `noun.past_tense_verb`.

/// A business event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    /// A patient's details were edited.
    PatientUpdated,
    /// Someone was invited to join a clinic's staff.
    StaffInvited,
    /// A member's role or status changed.
    MembershipChanged,
    /// A clinic's settings changed.
    SettingsChanged,
    /// A person signed one of their sessions out.
    SessionRevoked,
    /// A queued message was delivered.
    MessageSent,
    /// A queued message failed and will be tried again.
    MessageRetried,
    /// A queued message failed for the last time.
    MessageFailed,
}

impl Event {
    /// The name logged in the `event` field.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PatientUpdated => "patient.updated",
            Self::StaffInvited => "staff.invited",
            Self::MembershipChanged => "membership.changed",
            Self::SettingsChanged => "settings.changed",
            Self::SessionRevoked => "session.revoked",
            Self::MessageSent => "message.sent",
            Self::MessageRetried => "message.retried",
            Self::MessageFailed => "message.failed",
        }
    }
}
