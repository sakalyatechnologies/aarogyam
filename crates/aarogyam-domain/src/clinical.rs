//! Visits and the clinical record: statuses, note sections, who may change a note, and the
//! patient-level facts (conditions and allergies) shown as clinical flags.
//!
//! Clinical records are never edited once final. A signed note takes addenda; a mistaken one is
//! marked entered in error with a reason. Nothing drafted by AI enters the record until a
//! person confirms it.

use std::fmt;

use sakalya_types::Paise;

use crate::ids::MembershipId;

/// Why a clinical value or change was refused. Messages name the field or the rule, never the
/// value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ClinicalError {
    /// A status, kind or other listed value the database doesn't know.
    #[error("unknown value")]
    UnknownValue,
    /// Free text is empty, too long, or contains control characters.
    #[error("must be {min} to {max} characters of text")]
    Text {
        /// Fewest characters.
        min: usize,
        /// Most characters.
        max: usize,
    },
    /// Formatted text uses something outside the allowed Markdown subset (HTML, links, images,
    /// code, deep headings).
    #[error("use only headings, lists, bold and italic; no HTML, links, images or code")]
    Format,
    /// A note can't be signed with every section empty.
    #[error("write at least one section before signing")]
    EmptyNote,
    /// A money amount is negative or implausibly large.
    #[error("must be between 0 and 1,000,000,000 paise")]
    Amount,
}

/// Defines a text-backed status enum with `as_str`, `parse` and `Display`.
macro_rules! text_enum {
    ($(#[$doc:meta])* $name:ident { $($(#[$vdoc:meta])* $variant:ident => $text:literal),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $name {
            $($(#[$vdoc])* $variant,)*
        }

        impl $name {
            /// Every value, in declaration order.
            pub const ALL: &'static [Self] = &[$(Self::$variant,)*];

            /// The value stored in the database and sent over the API.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text,)* }
            }

            /// Parses the stored value.
            ///
            /// # Errors
            /// [`ClinicalError::UnknownValue`] for anything else.
            pub fn parse(text: &str) -> Result<Self, ClinicalError> {
                match text { $($text => Ok(Self::$variant),)* _ => Err(ClinicalError::UnknownValue) }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}
pub(crate) use text_enum;

text_enum!(
    /// Whether a visit is in progress.
    EncounterStatus {
        /// In progress: notes, vitals and procedures can be added.
        Open => "open",
        /// Finished. Addenda and corrections still work.
        Closed => "closed",
    }
);

text_enum!(
    /// What a note is for.
    NoteKind {
        /// Subjective, objective, assessment, plan.
        Soap => "soap",
        /// A follow-up note.
        Progress => "progress",
        /// What was done in a procedure.
        Procedure => "procedure",
        /// Intake by an assistant or nurse.
        Intake => "intake",
        /// A front-desk remark.
        FrontDesk => "front_desk",
    }
);

text_enum!(
    /// How a note was written.
    NoteSource {
        /// Typed.
        Typed => "typed",
        /// Dictated.
        Voice => "voice",
        /// Drafted by AI from a recording, for the doctor to review and sign.
        AiDraft => "ai_draft",
    }
);

text_enum!(
    /// Where a note is in its life.
    NoteStatus {
        /// Editable by its author.
        Draft => "draft",
        /// Signed by its author; never changes again. Corrections go in addenda.
        Signed => "signed",
        /// A version that collided, during sync, with a note already signed on the server.
        Conflict => "conflict",
        /// Kept but marked wrong, with a reason.
        EnteredInError => "entered_in_error",
    }
);

text_enum!(
    /// Who or what a clinical fact came from (provenance).
    RecordSource {
        /// A doctor recorded it.
        Clinician => "clinician",
        /// An assistant or nurse recorded it.
        Assistant => "assistant",
        /// The patient reported it.
        Patient => "patient",
        /// Imported from old software or a document.
        Import => "import",
        /// A connected device measured it.
        Device => "device",
        /// Drafted by AI; enters the record only once a person confirms it.
        AiDraft => "ai_draft",
        /// Received through ABDM.
        Abdm => "abdm",
    }
);

impl RecordSource {
    /// Sources a member may name when they record a fact by hand. Devices, AI drafts and ABDM
    /// arrive through their own flows.
    #[must_use]
    pub const fn recordable_by_staff(self) -> bool {
        matches!(
            self,
            Self::Clinician | Self::Assistant | Self::Patient | Self::Import
        )
    }
}

text_enum!(
    /// How bad an allergic reaction is.
    Severity {
        /// Mild.
        Mild => "mild",
        /// Moderate.
        Moderate => "moderate",
        /// Severe: anaphylaxis or similar.
        Severe => "severe",
    }
);

text_enum!(
    /// Whether a condition or allergy applies now.
    FactStatus {
        /// Applies now.
        Active => "active",
        /// No longer applies.
        Resolved => "resolved",
        /// Recorded by mistake.
        EnteredInError => "entered_in_error",
    }
);

text_enum!(
    /// Optional clinical code systems. Free text always works without one.
    CodeSystem {
        /// ICD-10.
        Icd10 => "icd10",
        /// ICD-11.
        Icd11 => "icd11",
        /// SNOMED CT.
        Snomed => "snomed",
        /// LOINC.
        Loinc => "loinc",
        /// The clinic's own codes.
        Custom => "custom",
    }
);

text_enum!(
    /// Whether a procedure was done.
    ProcedureStatus {
        /// Planned for this visit, not yet done.
        Planned => "planned",
        /// Done; final.
        Done => "done",
        /// Recorded by mistake.
        EnteredInError => "entered_in_error",
    }
);

text_enum!(
    /// A treatment plan's status.
    PlanStatus {
        /// Shown to the patient, not yet accepted.
        Proposed => "proposed",
        /// The patient accepted it.
        Accepted => "accepted",
        /// Some accepted items are done.
        InProgress => "in_progress",
        /// Nothing accepted is left to do.
        Completed => "completed",
        /// The patient declined it.
        Declined => "declined",
    }
);

text_enum!(
    /// A treatment plan item's status.
    PlanItemStatus {
        /// Proposed with the plan.
        Proposed => "proposed",
        /// The patient accepted it.
        Accepted => "accepted",
        /// Its procedure is done.
        Done => "done",
        /// Not going ahead.
        Cancelled => "cancelled",
    }
);

text_enum!(
    /// What a patient file is.
    AttachmentKind {
        /// A clinical photo.
        Photo => "photo",
        /// A radiograph.
        Xray => "xray",
        /// A lab or imaging report.
        Report => "report",
        /// Any other document.
        Document => "document",
        /// A voice recording.
        Audio => "audio",
        /// A signed consent form.
        Consent => "consent",
    }
);

/// Validated free text: trimmed, `min` to `max` characters, no control characters other than
/// line breaks and tabs.
///
/// # Errors
/// [`ClinicalError::Text`] when out of bounds.
pub fn clinical_text(text: &str, min: usize, max: usize) -> Result<String, ClinicalError> {
    let trimmed = text.trim();
    let chars = trimmed.chars().count();
    let bad_control = trimmed
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'));
    if chars < min || chars > max || bad_control {
        Err(ClinicalError::Text { min, max })
    } else {
        Ok(trimmed.to_owned())
    }
}

/// Optional free text: empty or absent means none.
///
/// # Errors
/// [`ClinicalError::Text`] when too long or containing control characters.
pub fn optional_text(text: Option<&str>, max: usize) -> Result<Option<String>, ClinicalError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => clinical_text(text, 1, max).map(Some),
    }
}

/// A reason for marking a record entered in error: 3 to 500 characters.
///
/// # Errors
/// [`ClinicalError::Text`] when out of bounds.
pub fn error_reason(text: &str) -> Result<String, ClinicalError> {
    clinical_text(text, 3, 500)
}

/// A money amount for clinical estimates and fees: 0 to ₹1 crore (10^9 paise).
///
/// # Errors
/// [`ClinicalError::Amount`] when negative or above 1,000,000,000 paise.
pub fn fee(paise: i64) -> Result<Paise, ClinicalError> {
    if (0..=1_000_000_000).contains(&paise) {
        Ok(Paise::new(paise))
    } else {
        Err(ClinicalError::Amount)
    }
}

/// The sections of a note. Each is optional while drafting; signing needs at least one.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct NoteBody {
    /// What the patient reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subjective: Option<String>,
    /// What the clinician found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    /// The clinician's assessment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assessment: Option<String>,
    /// What happens next.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
}

impl NoteBody {
    /// Most characters in one section.
    pub const MAX_SECTION: usize = 10_000;

    /// Validates each section; empty sections become none.
    ///
    /// # Errors
    /// [`ClinicalError::Text`] when a section is too long or contains control characters;
    /// [`ClinicalError::Format`] when it leaves the Markdown subset.
    pub fn new(
        subjective: Option<&str>,
        objective: Option<&str>,
        assessment: Option<&str>,
        plan: Option<&str>,
    ) -> Result<Self, ClinicalError> {
        let section = |text: Option<&str>| -> Result<Option<String>, ClinicalError> {
            let text = optional_text(text, Self::MAX_SECTION)?;
            if let Some(text) = &text {
                crate::richtext::validate(text)?;
            }
            Ok(text)
        };
        Ok(Self {
            subjective: section(subjective)?,
            objective: section(objective)?,
            assessment: section(assessment)?,
            plan: section(plan)?,
        })
    }

    /// Whether every section is empty.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.subjective.is_none()
            && self.objective.is_none()
            && self.assessment.is_none()
            && self.plan.is_none()
    }
}

/// Why a change to a note was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteRefusal {
    /// Only drafts can be edited or signed.
    NotDraft,
    /// Only the author may edit or sign their note.
    NotAuthor,
    /// Addenda are for signed notes; edit a draft instead.
    NotSigned,
    /// Already entered in error.
    AlreadyInError,
    /// The visit is closed; addenda and corrections still work.
    VisitClosed,
    /// Nothing to sign.
    Empty,
}

impl NoteRefusal {
    /// What to tell the person.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::NotDraft => "only draft notes can be changed; add an addendum to a signed note",
            Self::NotAuthor => "only the note's author can edit or sign it",
            Self::NotSigned => "addenda are for signed notes; edit the draft instead",
            Self::AlreadyInError => "the note is already marked entered in error",
            Self::VisitClosed => "the visit is closed",
            Self::Empty => "write at least one section before signing",
        }
    }
}

impl fmt::Display for NoteRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for NoteRefusal {}

/// A note as the rules see it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoteState {
    /// Its status.
    pub status: NoteStatus,
    /// Its author.
    pub author: MembershipId,
}

/// What signing a note comes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signing {
    /// The draft is signed now.
    Sign,
    /// Its author already signed it: repeating the request changes nothing.
    AlreadySigned,
}

impl NoteState {
    /// Whether `actor` may edit the draft.
    ///
    /// # Errors
    /// The [`NoteRefusal`] that applies.
    pub fn check_edit(self, actor: MembershipId) -> Result<(), NoteRefusal> {
        if self.status != NoteStatus::Draft {
            return Err(NoteRefusal::NotDraft);
        }
        if self.author != actor {
            return Err(NoteRefusal::NotAuthor);
        }
        Ok(())
    }

    /// What signing the note with `body` comes to for `actor`. The author signing a note they
    /// already signed is a repeat, not a refusal.
    ///
    /// # Errors
    /// The [`NoteRefusal`] that applies.
    pub fn check_sign(self, actor: MembershipId, body: &NoteBody) -> Result<Signing, NoteRefusal> {
        if self.status == NoteStatus::Signed && self.author == actor {
            return Ok(Signing::AlreadySigned);
        }
        self.check_edit(actor)?;
        if body.is_empty() {
            return Err(NoteRefusal::Empty);
        }
        Ok(Signing::Sign)
    }

    /// Whether an addendum may be added.
    ///
    /// # Errors
    /// [`NoteRefusal::NotSigned`] unless the note is signed.
    pub fn check_addendum(self) -> Result<(), NoteRefusal> {
        match self.status {
            NoteStatus::Signed => Ok(()),
            NoteStatus::EnteredInError => Err(NoteRefusal::AlreadyInError),
            NoteStatus::Draft | NoteStatus::Conflict => Err(NoteRefusal::NotSigned),
        }
    }

    /// Whether `actor` may mark the note entered in error. A draft is withdrawn by its author;
    /// a signed or conflicting note may be marked by any member who records clinical notes, so
    /// a departed doctor's mistake can still be corrected.
    ///
    /// # Errors
    /// The [`NoteRefusal`] that applies.
    pub fn check_entered_in_error(self, actor: MembershipId) -> Result<(), NoteRefusal> {
        match self.status {
            NoteStatus::EnteredInError => Err(NoteRefusal::AlreadyInError),
            NoteStatus::Draft if self.author != actor => Err(NoteRefusal::NotAuthor),
            NoteStatus::Draft | NoteStatus::Signed | NoteStatus::Conflict => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_bodies_drop_empty_sections() {
        let body = NoteBody::new(Some("  pain in 36 "), Some(" "), None, Some("RCT")).unwrap();
        assert_eq!(body.subjective.as_deref(), Some("pain in 36"));
        assert_eq!(body.objective, None);
        assert!(!body.is_empty());
        assert!(
            NoteBody::new(None, Some(""), None, None)
                .unwrap()
                .is_empty()
        );
        let long = "a".repeat(NoteBody::MAX_SECTION + 1);
        assert!(NoteBody::new(Some(&long), None, None, None).is_err());
        assert!(NoteBody::new(Some("a\u{0}b"), None, None, None).is_err());
        assert!(NoteBody::new(Some("line one\nline two"), None, None, None).is_ok());
    }

    #[test]
    fn only_the_author_edits_and_signs_drafts() {
        let author = MembershipId::new_v7();
        let other = MembershipId::new_v7();
        let body = NoteBody::new(Some("pain"), None, None, None).unwrap();
        let draft = NoteState {
            status: NoteStatus::Draft,
            author,
        };
        assert_eq!(draft.check_edit(author), Ok(()));
        assert_eq!(draft.check_edit(other), Err(NoteRefusal::NotAuthor));
        assert_eq!(draft.check_sign(author, &body), Ok(Signing::Sign));
        assert_eq!(
            draft.check_sign(author, &NoteBody::default()),
            Err(NoteRefusal::Empty)
        );
        assert_eq!(draft.check_addendum(), Err(NoteRefusal::NotSigned));
        let signed = NoteState {
            status: NoteStatus::Signed,
            author,
        };
        assert_eq!(signed.check_edit(author), Err(NoteRefusal::NotDraft));
        // The author repeating the signature is fine; anyone else meets a note that isn't a draft.
        assert_eq!(signed.check_sign(author, &body), Ok(Signing::AlreadySigned));
        assert_eq!(signed.check_sign(other, &body), Err(NoteRefusal::NotDraft));
        assert_eq!(signed.check_addendum(), Ok(()));
        assert_eq!(signed.check_entered_in_error(other), Ok(()));
        assert_eq!(
            draft.check_entered_in_error(other),
            Err(NoteRefusal::NotAuthor)
        );
        let voided = NoteState {
            status: NoteStatus::EnteredInError,
            author,
        };
        assert_eq!(
            voided.check_entered_in_error(author),
            Err(NoteRefusal::AlreadyInError)
        );
        assert_eq!(voided.check_sign(author, &body), Err(NoteRefusal::NotDraft));
    }

    #[test]
    fn text_enums_round_trip() {
        for status in NoteStatus::ALL {
            assert_eq!(NoteStatus::parse(status.as_str()), Ok(*status));
        }
        for source in RecordSource::ALL {
            assert_eq!(RecordSource::parse(source.as_str()), Ok(*source));
        }
        assert!(!RecordSource::AiDraft.recordable_by_staff());
        assert!(RecordSource::Patient.recordable_by_staff());
        assert_eq!(Severity::parse("fatal"), Err(ClinicalError::UnknownValue));
    }

    #[test]
    fn reasons_and_fees_are_bounded() {
        assert!(error_reason("no").is_err());
        assert_eq!(error_reason("  wrong patient ").unwrap(), "wrong patient");
        assert_eq!(fee(150_000).unwrap().get(), 150_000);
        assert_eq!(fee(-1), Err(ClinicalError::Amount));
        assert_eq!(fee(1_000_000_001), Err(ClinicalError::Amount));
        assert_eq!(optional_text(Some("  "), 10), Ok(None));
    }
}
