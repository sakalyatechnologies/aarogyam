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
    /// A bill was issued.
    InvoiceIssued,
    /// A bill was voided.
    InvoiceVoided,
    /// A payment was recorded.
    PaymentReceived,
    /// A payment was voided.
    PaymentVoided,
    /// A prescription was issued.
    PrescriptionIssued,
    /// A prescription was issued despite an allergy alert.
    PrescriptionAlertOverridden,
    /// A prescription was cancelled.
    PrescriptionCancelled,
    /// A link to a document was made for a patient.
    ShareLinkCreated,
    /// A patient opened a link with the right PIN.
    ShareLinkOpened,
    /// A link locked after too many wrong PINs.
    ShareLinkLocked,
    /// A follow-up was planned.
    RecallCreated,
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
            Self::InvoiceIssued => "invoice.issued",
            Self::InvoiceVoided => "invoice.voided",
            Self::PaymentReceived => "payment.received",
            Self::PaymentVoided => "payment.voided",
            Self::PrescriptionIssued => "prescription.issued",
            Self::PrescriptionAlertOverridden => "prescription.alert_overridden",
            Self::PrescriptionCancelled => "prescription.cancelled",
            Self::ShareLinkCreated => "share_link.created",
            Self::ShareLinkOpened => "share_link.opened",
            Self::ShareLinkLocked => "share_link.locked",
            Self::RecallCreated => "recall.created",
        }
    }
}
