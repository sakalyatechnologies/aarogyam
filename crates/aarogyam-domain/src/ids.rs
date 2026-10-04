//! Typed identifiers. An `Id<Patient>` can't be passed where an `Id<Clinic>` is expected.

use sakalya_types::{Entity, Id};

macro_rules! entities {
    ($($(#[$doc:meta])* $name:ident, $alias:ident;)*) => {
        $(
            $(#[$doc])*
            #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
            pub enum $name {}

            impl Entity for $name {
                const NAME: &'static str = stringify!($name);
            }

            #[doc = concat!("Identifier of a [`", stringify!($name), "`].")]
            pub type $alias = Id<$name>;
        )*
    };
}

entities! {
    /// A clinic business: the tenant.
    Clinic, ClinicId;
    /// A location of a clinic.
    Branch, BranchId;
    /// A person who signs in.
    User, UserId;
    /// A user's place in a clinic.
    Membership, MembershipId;
    /// A named bundle of permissions in a clinic.
    Role, RoleId;
    /// A clinic's own record of a patient.
    Patient, PatientId;
    /// A pending invitation to join a clinic.
    Invitation, InvitationId;
    /// A message queued in the outbox.
    Message, MessageId;
    /// A sign-in session.
    Session, SessionId;
    /// A chair, room or lab that appointments are booked into.
    Room, RoomId;
    /// A doctor who sees patients.
    Practitioner, PractitionerId;
    /// A time a doctor is away.
    LeaveBlock, LeaveBlockId;
    /// A booked slot.
    Appointment, AppointmentId;
    /// A waiting-room token.
    QueueToken, QueueTokenId;
    /// Another number a patient is known by.
    PatientIdentifier, PatientIdentifierId;
    /// A data import.
    Import, ImportId;
}
