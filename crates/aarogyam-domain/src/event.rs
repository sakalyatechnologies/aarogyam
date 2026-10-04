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
    /// A visit was started.
    VisitStarted,
    /// A visit was closed.
    VisitClosed,
    /// A clinical note was signed.
    NoteSigned,
    /// An addendum was added to a signed note.
    NoteAmended,
    /// A clinical record was marked entered in error.
    RecordRetracted,
    /// A treatment plan was accepted.
    TreatmentPlanAccepted,
    /// A procedure was done.
    ProcedureCompleted,
    /// A patient file was uploaded.
    AttachmentUploaded,
    /// A patient file was downloaded.
    AttachmentDownloaded,
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
            Self::VisitStarted => "visit.started",
            Self::VisitClosed => "visit.closed",
            Self::NoteSigned => "note.signed",
            Self::NoteAmended => "note.amended",
            Self::RecordRetracted => "record.retracted",
            Self::TreatmentPlanAccepted => "treatment_plan.accepted",
            Self::ProcedureCompleted => "procedure.completed",
            Self::AttachmentUploaded => "attachment.uploaded",
            Self::AttachmentDownloaded => "attachment.downloaded",
        }
    }
}
