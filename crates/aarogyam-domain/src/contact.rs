//! The consent matrix: which consent purpose each kind of patient message needs. The database
//! answers whether that consent is in force (`app.may_contact`, migration 0333); this decides
//! which purpose to ask about. With no consent recorded, `care` messages may be sent and
//! `reminders` and `promotional` ones may not.

use crate::consent::Purpose;
use crate::outbox::MessageKind;

/// A kind of message to a patient, as the consent rules see it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatientMessage {
    /// A booking was received, confirmed or declined.
    BookingConfirmation,
    /// A link to a prescription the doctor issued.
    PrescriptionLink,
    /// An invitation to the patient app.
    PatientAppInvite,
    /// A reminder before an appointment.
    AppointmentReminder,
    /// A recall: a follow-up, cleaning or review is due.
    Recall,
    /// A campaign: an offer, a health camp, a tip.
    Campaign,
    /// A birthday greeting.
    Birthday,
}

impl PatientMessage {
    /// Every kind, for tests and documentation.
    pub const ALL: &'static [Self] = &[
        Self::BookingConfirmation,
        Self::PrescriptionLink,
        Self::PatientAppInvite,
        Self::AppointmentReminder,
        Self::Recall,
        Self::Campaign,
        Self::Birthday,
    ];

    /// The consent purpose the message needs.
    #[must_use]
    pub const fn purpose(self) -> Purpose {
        match self {
            Self::BookingConfirmation | Self::PrescriptionLink | Self::PatientAppInvite => {
                Purpose::Care
            }
            Self::AppointmentReminder | Self::Recall => Purpose::Reminders,
            Self::Campaign | Self::Birthday => Purpose::Promotional,
        }
    }

    /// Whether it may be sent when the patient has no consent recorded for its purpose.
    #[must_use]
    pub const fn allowed_without_consent(self) -> bool {
        matches!(self.purpose(), Purpose::Care)
    }

    /// The patient message an outbox message is, if it goes to a patient.
    #[must_use]
    pub const fn of(kind: MessageKind) -> Option<Self> {
        match kind {
            MessageKind::StaffInvited => None,
            MessageKind::PrescriptionShared => Some(Self::PrescriptionLink),
            MessageKind::BookingRequested
            | MessageKind::BookingConfirmed
            | MessageKind::BookingDeclined => Some(Self::BookingConfirmation),
            MessageKind::PatientAppInvited => Some(Self::PatientAppInvite),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_matrix_matches_the_decision() {
        use PatientMessage as M;
        let care = [
            M::BookingConfirmation,
            M::PrescriptionLink,
            M::PatientAppInvite,
        ];
        let reminders = [M::AppointmentReminder, M::Recall];
        let promotional = [M::Campaign, M::Birthday];
        for kind in care {
            assert_eq!(kind.purpose(), Purpose::Care);
            assert!(kind.allowed_without_consent());
        }
        for kind in reminders {
            assert_eq!(kind.purpose(), Purpose::Reminders);
            assert!(!kind.allowed_without_consent());
        }
        for kind in promotional {
            assert_eq!(kind.purpose(), Purpose::Promotional);
            assert!(!kind.allowed_without_consent());
        }
        assert_eq!(
            M::ALL.len(),
            care.len() + reminders.len() + promotional.len()
        );
    }

    #[test]
    fn outbox_messages_map_to_patient_messages() {
        assert_eq!(PatientMessage::of(MessageKind::StaffInvited), None);
        assert_eq!(
            PatientMessage::of(MessageKind::BookingConfirmed),
            Some(PatientMessage::BookingConfirmation)
        );
        assert_eq!(
            PatientMessage::of(MessageKind::PrescriptionShared).map(PatientMessage::purpose),
            Some(Purpose::Care)
        );
    }
}
