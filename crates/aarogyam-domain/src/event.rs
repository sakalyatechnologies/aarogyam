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
    /// A role was created, removed, or its permissions changed.
    RoleChanged,
    /// A clinic's settings changed.
    SettingsChanged,
    /// A first-run setup step was answered or the card dismissed.
    SetupChanged,
    /// A person signed one of their sessions out.
    SessionRevoked,
    /// A queued message was delivered.
    MessageSent,
    /// A queued message failed and will be tried again.
    MessageRetried,
    /// A queued message failed for the last time.
    MessageFailed,
    /// Staff were reminded of a booking request nobody had answered.
    BookingReminded,
    /// The owners were told of a booking request still unanswered after the reminder.
    BookingEscalated,
    /// A member marked notifications read.
    NotificationsRead,
    /// A central sign-in handed a session over to a clinic or console host.
    HandoffCreated,
    /// A handoff code was redeemed for a session.
    HandoffRedeemed,
    /// A handoff code was refused (unknown, used, expired or for another host).
    HandoffRefused,
    /// A clinic's portal host is served at the edge.
    AddressProvisioned,
    /// Making a portal host work failed and will be tried again.
    AddressRetried,
    /// Making a portal host work failed for the last time.
    AddressFailed,
    /// A taken-down clinic site's address was removed from the edge.
    AddressRemoved,
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
    /// An appointment was booked.
    AppointmentBooked,
    /// An appointment was moved, reassigned or edited.
    AppointmentChanged,
    /// An appointment's status changed.
    AppointmentStatusChanged,
    /// A waiting-room token was issued.
    QueueTokenIssued,
    /// Patients were imported from a file.
    PatientsImported,
    /// A chair, doctor, working hours or leave changed.
    ScheduleSetupChanged,
    /// A visit was started.
    VisitStarted,
    /// A visit was closed.
    VisitClosed,
    /// A clinical note was signed.
    NoteSigned,
    /// An addendum was added to a signed note.
    NoteAmended,
    /// A patient's summary note was saved.
    PatientNoteSaved,
    /// A patient's consent was recorded.
    ConsentRecorded,
    /// A patient withdrew a consent.
    ConsentWithdrawn,
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
    /// A delivery was added to stock.
    StockReceived,
    /// Stock was used.
    StockUsed,
    /// Stock was corrected or written off.
    StockAdjusted,
    /// The website's design or content was changed.
    WebsiteChanged,
    /// The website was published or taken down.
    WebsitePublished,
    /// A website picture was uploaded or removed.
    WebsitePhotoChanged,
    /// A clinic issued a patient-app link code for a patient.
    PatientAppInvited,
    /// A patient account was linked to a clinic's record.
    PatientLinked,
    /// A patient asked a clinic to confirm a match with their record.
    PatientLinkRequested,
    /// A patient link was declined or revoked.
    PatientLinkEnded,
    /// A patient cancelled their own appointment in the app.
    AppointmentCancelledByPatient,
    /// A file's sharing with the patient changed.
    AttachmentSharingChanged,
    /// A clinic expense was recorded.
    ExpenseRecorded,
    /// A clinic expense was voided.
    ExpenseVoided,
    /// A walk-in was registered (or found), checked in and given a token in one step.
    WalkInRegistered,
    /// A clinician confirmed a patient-reported allergy.
    AllergyConfirmed,
    /// A clinic granted a Sakalya staff member read access.
    SupportGranted,
    /// A clinic revoked a support grant.
    SupportRevoked,
    /// A clinic retired one of its own dental terms.
    DentalTermRetired,
    /// A clinic restored a retired dental term.
    DentalTermRestored,
    /// A clinic renamed one of its own dental terms.
    DentalTermRenamed,
    /// A patient signed out one of their own app sessions.
    PatientSessionRevoked,
    /// A patient's legal hold was put on or released.
    LegalHoldChanged,
}

impl Event {
    /// The name logged in the `event` field.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PatientUpdated => "patient.updated",
            Self::StaffInvited => "staff.invited",
            Self::MembershipChanged => "membership.changed",
            Self::RoleChanged => "role.changed",
            Self::SettingsChanged => "settings.changed",
            Self::SetupChanged => "setup.changed",
            Self::SessionRevoked => "session.revoked",
            Self::MessageSent => "message.sent",
            Self::MessageRetried => "message.retried",
            Self::BookingReminded => "booking.reminded",
            Self::BookingEscalated => "booking.escalated",
            Self::NotificationsRead => "notifications.read",
            Self::MessageFailed => "message.failed",
            Self::HandoffCreated => "handoff.created",
            Self::HandoffRedeemed => "handoff.redeemed",
            Self::HandoffRefused => "handoff.refused",
            Self::AddressProvisioned => "address.provisioned",
            Self::AddressRetried => "address.retried",
            Self::AddressFailed => "address.failed",
            Self::AddressRemoved => "address.removed",
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
            Self::AppointmentBooked => "appointment.booked",
            Self::AppointmentChanged => "appointment.changed",
            Self::AppointmentStatusChanged => "appointment.status_changed",
            Self::QueueTokenIssued => "queue_token.issued",
            Self::PatientsImported => "patients.imported",
            Self::ScheduleSetupChanged => "schedule_setup.changed",
            Self::VisitStarted => "visit.started",
            Self::VisitClosed => "visit.closed",
            Self::NoteSigned => "note.signed",
            Self::NoteAmended => "note.amended",
            Self::PatientNoteSaved => "patient_note.saved",
            Self::ConsentRecorded => "consent.recorded",
            Self::ConsentWithdrawn => "consent.withdrawn",
            Self::RecordRetracted => "record.retracted",
            Self::TreatmentPlanAccepted => "treatment_plan.accepted",
            Self::ProcedureCompleted => "procedure.completed",
            Self::AttachmentUploaded => "attachment.uploaded",
            Self::AttachmentDownloaded => "attachment.downloaded",
            Self::StockReceived => "stock.received",
            Self::StockUsed => "stock.used",
            Self::StockAdjusted => "stock.adjusted",
            Self::WebsiteChanged => "website.changed",
            Self::WebsitePublished => "website.published",
            Self::WebsitePhotoChanged => "website.photo_changed",
            Self::PatientAppInvited => "patient_app.invited",
            Self::PatientLinked => "patient_link.linked",
            Self::PatientLinkRequested => "patient_link.requested",
            Self::PatientLinkEnded => "patient_link.ended",
            Self::AppointmentCancelledByPatient => "appointment.cancelled_by_patient",
            Self::AttachmentSharingChanged => "attachment.sharing_changed",
            Self::ExpenseRecorded => "expense.recorded",
            Self::ExpenseVoided => "expense.voided",
            Self::WalkInRegistered => "walk_in.registered",
            Self::AllergyConfirmed => "allergy.confirmed",
            Self::SupportGranted => "support.granted",
            Self::SupportRevoked => "support.revoked",
            Self::DentalTermRetired => "dental_term.retired",
            Self::DentalTermRestored => "dental_term.restored",
            Self::DentalTermRenamed => "dental_term.renamed",
            Self::PatientSessionRevoked => "patient_session.revoked",
            Self::LegalHoldChanged => "legal_hold.changed",
        }
    }
}
