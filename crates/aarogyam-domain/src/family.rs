//! Family under one mobile number: how two patients of a clinic are related. A link reads "the
//! related patient is this patient's <relation>"; the other side holds the inverse.

use crate::ids::PatientId;

text_value! {
    /// What the related patient is to the patient.
    Relation ("relation") {
        /// Looks after the patient (the patient is their dependant).
        Guardian => "guardian",
        /// The patient's child.
        Child => "child",
        /// The patient's husband or wife.
        Spouse => "spouse",
        /// The patient's mother or father.
        Parent => "parent",
        /// The patient's brother or sister.
        Sibling => "sibling",
        /// Any other tie.
        Other => "other",
    }
}

impl Relation {
    /// What the patient is to the related patient. A guardian's dependant is stored as a
    /// `child` of that guardian, and a child's inverse is `parent`, so only the pairs
    /// parent/child and guardian/child round-trip one way; the rest are symmetric.
    #[must_use]
    pub const fn inverse(self) -> Self {
        match self {
            Self::Guardian | Self::Parent => Self::Child,
            Self::Child => Self::Parent,
            Self::Spouse => Self::Spouse,
            Self::Sibling => Self::Sibling,
            Self::Other => Self::Other,
        }
    }
}

/// Why a link is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkRefusal {
    /// A patient can't be their own relative.
    SelfLink,
}

impl LinkRefusal {
    /// Safe to show; names no one.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::SelfLink => "a patient can't be related to themselves",
        }
    }
}

/// Checks a link between two patients.
///
/// # Errors
/// [`LinkRefusal::SelfLink`] when both are the same patient.
pub fn check_link(patient: PatientId, related: PatientId) -> Result<(), LinkRefusal> {
    if patient == related {
        Err(LinkRefusal::SelfLink)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_relation_parses_back_and_has_an_inverse() {
        for relation in Relation::ALL {
            assert_eq!(Relation::parse(relation.as_str()).ok(), Some(*relation));
            let _ = relation.inverse();
        }
        assert!(Relation::parse("cousin").is_err());
    }

    #[test]
    fn inverses_follow_the_family() {
        assert_eq!(Relation::Parent.inverse(), Relation::Child);
        assert_eq!(Relation::Child.inverse(), Relation::Parent);
        assert_eq!(Relation::Guardian.inverse(), Relation::Child);
        assert_eq!(Relation::Spouse.inverse(), Relation::Spouse);
        assert_eq!(Relation::Sibling.inverse(), Relation::Sibling);
    }

    #[test]
    fn nobody_is_their_own_relative() {
        let a = PatientId::new_v7();
        assert_eq!(check_link(a, a), Err(LinkRefusal::SelfLink));
        assert!(check_link(a, PatientId::new_v7()).is_ok());
    }
}
