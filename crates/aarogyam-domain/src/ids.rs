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
    /// An entry on the clinic's price list.
    PriceItem, PriceItemId;
    /// A bill to a patient.
    Invoice, InvoiceId;
    /// Money received from a patient.
    Payment, PaymentId;
    /// A medicine in the shared catalogue.
    Drug, DrugId;
    /// A prescription.
    Prescription, PrescriptionId;
    /// A link a patient opens with a PIN.
    ShareLink, ShareLinkId;
    /// A follow-up that falls due.
    Recall, RecallId;
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
    /// An uploaded file being mapped and checked before it is imported.
    ImportSession, ImportSessionId;
    /// A patient imported without some details, on the front desk's to-do list.
    PatientGap, PatientGapId;
    /// Where the clinic buys materials.
    Supplier, SupplierId;
    /// A material or medicine the clinic keeps in stock.
    InventoryItem, InventoryItemId;
    /// A delivery of an item, with its expiry and cost.
    StockBatch, StockBatchId;
    /// What an expense was for: salaries, materials, rent and so on.
    ExpenseCategory, ExpenseCategoryId;
    /// Money the clinic spent.
    Expense, ExpenseId;
}

entities! {
    /// A visit.
    Encounter, EncounterId;
    /// A clinical note in a visit.
    ClinicalNote, ClinicalNoteId;
    /// An addendum to a signed note.
    NoteAddendum, NoteAddendumId;
    /// A measurement such as a blood pressure reading.
    Observation, ObservationId;
    /// A diagnosis on the problem list.
    Condition, ConditionId;
    /// An allergy.
    Allergy, AllergyId;
    /// A specialty record, such as a dental chart entry.
    SpecialtyRecord, SpecialtyRecordId;
    /// A clinic's own dental term: a procedure or material it added to the seeded list.
    DentalTerm, DentalTermId;
    /// A procedure planned or done in a visit.
    Procedure, ProcedureId;
    /// A treatment plan.
    TreatmentPlan, TreatmentPlanId;
    /// A step of a treatment plan.
    TreatmentPlanItem, TreatmentPlanItemId;
    /// A patient file.
    Attachment, AttachmentId;
    /// A person signed in to the patient app.
    PatientAccount, PatientAccountId;
    /// A patient account's link to a clinic's record.
    PatientLink, PatientLinkId;
    /// Something clinic staff are told about, such as an online booking.
    StaffNotification, StaffNotificationId;
    /// A message in the clinic's inbox, such as a reminder about a waiting booking.
    InboxMessage, InboxMessageId;
    /// A clinic's time-limited grant of read access to one Sakalya staff member.
    SupportGrant, SupportGrantId;
    /// A patient app sign-in session.
    PatientSession, PatientSessionId;
}
