//! Messages to patients: their channels and states, what staff may send, and the send-time
//! decision. The database queues them (`messages`, migration 0370) and reports, when one is
//! due, the patient's consent, opt-outs, state and the clinic's quiet hours
//! (`app.message_dispatch`); [`decide`] turns that into send, skip or wait.

use time::{Duration, OffsetDateTime};

use crate::consent::Purpose;

text_value! {
    /// How a patient message travels.
    Channel ("channel") {
        /// Email, through Resend.
        Email => "email",
        /// `WhatsApp`, with approved templates only (not yet available).
        Whatsapp => "whatsapp",
        /// A text message (not yet available).
        Sms => "sms",
    }
}

text_value! {
    /// Where a message is in its life.
    Status ("status") {
        /// Waiting for its time.
        Queued => "queued",
        /// Claimed by a worker.
        Sending => "sending",
        /// Handed to the provider.
        Sent => "sent",
        /// Given up after its attempts.
        Failed => "failed",
        /// Not sent, for a reason.
        Skipped => "skipped",
    }
}

text_value! {
    /// Why a message was not sent.
    SkipReason ("skip_reason") {
        /// No consent in force for its purpose when it was due.
        NoConsent => "no_consent",
        /// The patient withdrew consent for its purpose while it waited.
        ConsentWithdrawn => "consent_withdrawn",
        /// The patient opted out of the channel for its purpose.
        OptedOut => "opted_out",
        /// No email address or phone number on the record.
        NoAddress => "no_address",
        /// The patient's record was erased.
        PatientErased => "patient_erased",
        /// The record was merged into another.
        PatientMerged => "patient_merged",
        /// The record was deleted.
        PatientDeleted => "patient_deleted",
        /// The patient died.
        PatientDeceased => "patient_deceased",
        /// The appointment a reminder is about was cancelled or has started.
        AppointmentChanged => "appointment_changed",
        /// The channel or template can't be sent yet.
        Unsupported => "unsupported",
    }
}

text_value! {
    /// Which messages an opt-out covers.
    Category ("category") {
        /// Every purpose.
        All => "all",
        /// Care messages (booking answers, prescription links).
        Care => "care",
        /// Reminders and recalls.
        Reminders => "reminders",
        /// Offers and campaigns.
        Promotional => "promotional",
    }
}

text_value! {
    /// Who recorded a contact preference.
    PreferenceSource ("source") {
        /// Clinic staff, on the patient's word.
        Staff => "staff",
        /// The patient, in the app.
        Patient => "patient",
        /// The unsubscribe link in an email.
        UnsubscribeLink => "unsubscribe_link",
        /// The provider reported the address bounced.
        Bounce => "bounce",
        /// The patient marked an email as spam.
        Complaint => "complaint",
        /// The patient replied STOP on `WhatsApp`.
        StopKeyword => "stop_keyword",
    }
}

/// The dedupe key of an appointment's reminder, so a re-run queues it once.
#[must_use]
pub fn reminder_dedupe_key(appointment_id: uuid::Uuid) -> String {
    format!("reminder:appt:{appointment_id}:24h")
}

/// Whether a purpose waits out the clinic's quiet hours. Care messages (a booking answer, a
/// prescription link) go at once; reminders and promotional messages wait.
#[must_use]
pub const fn respects_quiet_hours(purpose: Purpose) -> bool {
    !matches!(purpose, Purpose::Care)
}

/// The patient's state when a message is due, as `app.message_dispatch` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatientState {
    /// Active or inactive: may be messaged.
    Active,
    /// Erased.
    Erased,
    /// Merged into another record.
    Merged,
    /// Deleted.
    Deleted,
    /// Deceased.
    Deceased,
}

impl PatientState {
    /// Parses the reported state; anything unknown is treated as deleted (never sent).
    #[must_use]
    pub fn parse(text: &str) -> Self {
        match text {
            "active" => Self::Active,
            "erased" => Self::Erased,
            "merged" => Self::Merged,
            "deceased" => Self::Deceased,
            _ => Self::Deleted,
        }
    }
}

/// The appointment a reminder is about, as it stands when the reminder is due.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppointmentNow {
    /// Still booked or confirmed.
    pub active: bool,
    /// When it starts.
    pub starts_at: OffsetDateTime,
}

/// What the database reported about a due message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DueCheck {
    /// The consent purpose the message needs.
    pub purpose: Purpose,
    /// The patient's state.
    pub patient: PatientState,
    /// Whether consent allows the purpose now (`app.may_contact`).
    pub may_contact: bool,
    /// Whether the patient opted out of the channel for this purpose.
    pub opted_out: bool,
    /// Whether the record has an address on the message's channel.
    pub has_address: bool,
    /// When the clinic's quiet hours end, if they are on now.
    pub quiet_until: Option<OffsetDateTime>,
    /// What the message is about, when that can change before it is sent.
    pub about: About,
}

/// What a due message is about, when that decides whether it still goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum About {
    /// Nothing that can change: it goes as it is.
    Nothing,
    /// A reminder about an appointment, as the appointment stands now (absent if it is gone).
    Reminder(Option<AppointmentNow>),
}

/// How long before its appointment a reminder goes.
pub const REMINDER_LEAD: Duration = Duration::hours(24);

/// What to do with a due message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Render and send it.
    Send,
    /// Never send it.
    Skip(SkipReason),
    /// Put it back until then (quiet hours, or an appointment moved later).
    Wait(OffsetDateTime),
}

/// Decides a due message at `now`. The patient's state comes first, then consent, opt-outs and
/// the address; a reminder whose appointment was cancelled, has started or moved later is
/// skipped or waits; last, reminders and promotional messages wait out quiet hours.
#[must_use]
pub fn decide(check: &DueCheck, now: OffsetDateTime) -> Verdict {
    let gone = match check.patient {
        PatientState::Active => None,
        PatientState::Erased => Some(SkipReason::PatientErased),
        PatientState::Merged => Some(SkipReason::PatientMerged),
        PatientState::Deleted => Some(SkipReason::PatientDeleted),
        PatientState::Deceased => Some(SkipReason::PatientDeceased),
    };
    if let Some(reason) = gone {
        return Verdict::Skip(reason);
    }
    if !check.may_contact {
        return Verdict::Skip(SkipReason::NoConsent);
    }
    if check.opted_out {
        return Verdict::Skip(SkipReason::OptedOut);
    }
    if !check.has_address {
        return Verdict::Skip(SkipReason::NoAddress);
    }
    if let About::Reminder(appointment) = check.about {
        match appointment {
            Some(appointment) if appointment.active && appointment.starts_at > now => {
                let due = appointment.starts_at - REMINDER_LEAD;
                if due > now + Duration::hours(1) {
                    return Verdict::Wait(due);
                }
            }
            _ => return Verdict::Skip(SkipReason::AppointmentChanged),
        }
    }
    match check.quiet_until {
        Some(until) if respects_quiet_hours(check.purpose) && until > now => Verdict::Wait(until),
        _ => Verdict::Send,
    }
}

text_value! {
    /// A message staff may send (`POST /messages`): its purpose, whether it carries free text
    /// and which variables it takes are fixed here, so nothing else reaches a template.
    Template ("template_key") {
        /// A note from the clinic about the patient's care, in the staff member's words.
        CareNote => "care.note",
        /// A reminder that a follow-up visit is due.
        FollowUpReminder => "reminder.follow_up",
        /// An offer or announcement, in the staff member's words.
        Offer => "promo.offer",
    }
}

/// Longest variable value.
pub const MAX_VARIABLE_CHARS: usize = 120;
/// Longest free text.
pub const MAX_BODY_CHARS: usize = 5000;
/// Most patients one `POST /messages` reaches.
pub const MAX_RECIPIENTS: usize = 50;

/// Why a message staff wrote can't be queued.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TemplateError {
    /// Free text goes by email only.
    #[error("free text can only be sent by email")]
    BodyNeedsEmail,
    /// Only email is available until `WhatsApp` templates are approved.
    #[error("only email is available for now")]
    ChannelUnavailable,
    /// The template needs free text.
    #[error("this template needs a body")]
    BodyRequired,
    /// The template takes no free text.
    #[error("this template takes no body")]
    BodyNotAllowed,
    /// The free text is empty or too long.
    #[error("the body must be 1 to 5000 characters")]
    BodyLength,
    /// A variable the template doesn't take.
    #[error("{0}: not a variable of this template")]
    UnknownVariable(String),
    /// A variable the template needs.
    #[error("{0}: required")]
    MissingVariable(&'static str),
    /// A value that is empty, too long or spans lines.
    #[error("{0}: must be one line of 1 to 120 characters")]
    BadValue(String),
}

impl Template {
    /// The consent purpose its messages need.
    #[must_use]
    pub const fn purpose(self) -> Purpose {
        match self {
            Self::CareNote => Purpose::Care,
            Self::FollowUpReminder => Purpose::Reminders,
            Self::Offer => Purpose::Promotional,
        }
    }

    /// Whether it carries the staff member's free text (and so goes by email only).
    #[must_use]
    pub const fn needs_body(self) -> bool {
        matches!(self, Self::CareNote | Self::Offer)
    }

    /// The variables it takes, with whether each is required.
    #[must_use]
    pub const fn variables(self) -> &'static [(&'static str, bool)] {
        match self {
            Self::CareNote | Self::Offer => &[("subject", true)],
            Self::FollowUpReminder => &[("due_on", false)],
        }
    }

    /// Checks a message staff wrote: the channel, the free text and the variables.
    ///
    /// # Errors
    /// The first [`TemplateError`] found.
    pub fn check(
        self,
        channel: Channel,
        body: Option<&str>,
        variables: &[(String, String)],
    ) -> Result<(), TemplateError> {
        if body.is_some() && channel != Channel::Email {
            return Err(TemplateError::BodyNeedsEmail);
        }
        if channel != Channel::Email {
            return Err(TemplateError::ChannelUnavailable);
        }
        match (self.needs_body(), body) {
            (true, None) => return Err(TemplateError::BodyRequired),
            (false, Some(_)) => return Err(TemplateError::BodyNotAllowed),
            (true, Some(text))
                if text.trim().is_empty() || text.chars().count() > MAX_BODY_CHARS =>
            {
                return Err(TemplateError::BodyLength);
            }
            _ => {}
        }
        let allowed = self.variables();
        for (name, value) in variables {
            if !allowed.iter().any(|(known, _)| known == name) {
                return Err(TemplateError::UnknownVariable(name.clone()));
            }
            let value = value.trim();
            if value.is_empty()
                || value.chars().count() > MAX_VARIABLE_CHARS
                || value.contains('\n')
            {
                return Err(TemplateError::BadValue(name.clone()));
            }
        }
        for (name, required) in allowed {
            if *required && !variables.iter().any(|(given, _)| given == name) {
                return Err(TemplateError::MissingVariable(name));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn due(now: OffsetDateTime) -> DueCheck {
        DueCheck {
            purpose: Purpose::Reminders,
            patient: PatientState::Active,
            may_contact: true,
            opted_out: false,
            has_address: true,
            quiet_until: None,
            about: About::Reminder(Some(AppointmentNow {
                active: true,
                starts_at: now + Duration::hours(24),
            })),
        }
    }

    #[test]
    fn the_patient_and_consent_come_first() {
        let now = OffsetDateTime::UNIX_EPOCH;
        assert_eq!(decide(&due(now), now), Verdict::Send);
        let erased = DueCheck {
            patient: PatientState::parse("erased"),
            may_contact: false,
            ..due(now)
        };
        assert_eq!(
            decide(&erased, now),
            Verdict::Skip(SkipReason::PatientErased)
        );
        assert_eq!(PatientState::parse("galaxy"), PatientState::Deleted);
        let withdrawn = DueCheck {
            may_contact: false,
            opted_out: true,
            ..due(now)
        };
        assert_eq!(
            decide(&withdrawn, now),
            Verdict::Skip(SkipReason::NoConsent)
        );
        let opted = DueCheck {
            opted_out: true,
            ..due(now)
        };
        assert_eq!(decide(&opted, now), Verdict::Skip(SkipReason::OptedOut));
        let no_email = DueCheck {
            has_address: false,
            ..due(now)
        };
        assert_eq!(decide(&no_email, now), Verdict::Skip(SkipReason::NoAddress));
    }

    #[test]
    fn reminders_follow_their_appointment_and_quiet_hours() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let cancelled = DueCheck {
            about: About::Reminder(Some(AppointmentNow {
                active: false,
                starts_at: now + Duration::hours(5),
            })),
            ..due(now)
        };
        assert_eq!(
            decide(&cancelled, now),
            Verdict::Skip(SkipReason::AppointmentChanged)
        );
        let moved = now + Duration::days(3);
        let later = DueCheck {
            about: About::Reminder(Some(AppointmentNow {
                active: true,
                starts_at: moved,
            })),
            ..due(now)
        };
        assert_eq!(decide(&later, now), Verdict::Wait(moved - REMINDER_LEAD));
        let morning = now + Duration::hours(9);
        let quiet = DueCheck {
            quiet_until: Some(morning),
            ..due(now)
        };
        assert_eq!(decide(&quiet, now), Verdict::Wait(morning));
        // Care messages go at once, quiet hours or not.
        let care = DueCheck {
            purpose: Purpose::Care,
            about: About::Nothing,
            ..quiet
        };
        assert_eq!(decide(&care, now), Verdict::Send);
    }

    #[test]
    fn staff_messages_are_checked_against_their_template() {
        let subject = vec![("subject".to_owned(), "Clinic closed Monday".to_owned())];
        let email = Channel::Email;
        assert_eq!(
            Template::CareNote.check(email, Some("Hello"), &subject),
            Ok(())
        );
        assert_eq!(
            Template::Offer.check(Channel::Whatsapp, Some("Hi"), &subject),
            Err(TemplateError::BodyNeedsEmail)
        );
        assert_eq!(
            Template::FollowUpReminder.check(Channel::Sms, None, &[]),
            Err(TemplateError::ChannelUnavailable)
        );
        assert_eq!(
            Template::CareNote.check(email, None, &subject),
            Err(TemplateError::BodyRequired)
        );
        assert_eq!(
            Template::FollowUpReminder.check(email, Some("x"), &[]),
            Err(TemplateError::BodyNotAllowed)
        );
        assert_eq!(
            Template::Offer.check(email, Some("x"), &[]),
            Err(TemplateError::MissingVariable("subject"))
        );
        let name = vec![("patient_name".to_owned(), "Leela".to_owned())];
        assert!(matches!(
            Template::FollowUpReminder.check(email, None, &name),
            Err(TemplateError::UnknownVariable(_))
        ));
        let two_lines = vec![("subject".to_owned(), "a\nb".to_owned())];
        assert!(Template::Offer.check(email, Some("x"), &two_lines).is_err());
        assert_eq!(Template::Offer.purpose(), Purpose::Promotional);
        assert_eq!(
            reminder_dedupe_key(uuid::Uuid::nil()),
            "reminder:appt:00000000-0000-0000-0000-000000000000:24h"
        );
    }
}
