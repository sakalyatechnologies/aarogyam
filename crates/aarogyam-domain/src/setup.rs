//! First-run setup: the short wizard that helps a new clinic owner, and a one-screen version
//! for invited doctors. Every step can be skipped; progress is kept per step.

use std::collections::BTreeMap;

/// The owner's steps, in order: the clinic, hours and doctors, look, services and fees, team
/// and patients.
pub const CLINIC_STEPS: [&str; 5] = ["clinic", "hours", "look", "services", "team"];

/// An invited doctor's single step.
pub const MEMBER_STEPS: [&str; 1] = ["profile"];

/// Whose setup it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Track {
    /// The clinic, set up by its owner.
    Clinic,
    /// One member's own profile.
    Member,
}

impl Track {
    /// The step keys of this track, in order.
    #[must_use]
    pub const fn steps(self) -> &'static [&'static str] {
        match self {
            Self::Clinic => &CLINIC_STEPS,
            Self::Member => &MEMBER_STEPS,
        }
    }

    /// Whether `key` is a step of this track.
    #[must_use]
    pub fn has_step(self, key: &str) -> bool {
        self.steps().contains(&key)
    }
}

/// How a step ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepStatus {
    /// The person finished it.
    Done,
    /// The person chose to do it later or never.
    Skipped,
}

impl StepStatus {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Skipped => "skipped",
        }
    }

    /// Parses a stored or submitted value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "done" => Some(Self::Done),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }
}

/// How the clinic practises.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Practice {
    /// One doctor.
    Solo,
    /// One doctor with staff.
    Team,
    /// Several doctors.
    Multi,
}

impl Practice {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Solo => "solo",
            Self::Team => "team",
            Self::Multi => "multi",
        }
    }

    /// Parses a stored or submitted value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "solo" => Some(Self::Solo),
            "team" => Some(Self::Team),
            "multi" => Some(Self::Multi),
            _ => None,
        }
    }
}

/// Where a setup stands overall.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Standing {
    /// Nothing answered yet: show the wizard.
    New,
    /// Some steps are left: show the "Finish setting up" card.
    InProgress,
    /// Every step is done or skipped.
    Complete,
    /// The person closed the card.
    Dismissed,
}

impl Standing {
    /// The value the API returns.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::InProgress => "in_progress",
            Self::Complete => "complete",
            Self::Dismissed => "dismissed",
        }
    }
}

/// Reads stored steps, ignoring keys that are not steps of the track (a retired step must not
/// break the screen).
#[must_use]
pub fn read_steps(track: Track, stored: &serde_json::Value) -> BTreeMap<String, StepStatus> {
    let mut steps = BTreeMap::new();
    if let Some(map) = stored.as_object() {
        for (key, value) in map {
            if let (true, Some(status)) = (
                track.has_step(key),
                value.as_str().and_then(StepStatus::parse),
            ) {
                steps.insert(key.clone(), status);
            }
        }
    }
    steps
}

/// Whether every step of the track has an answer.
#[must_use]
pub fn is_complete(track: Track, steps: &BTreeMap<String, StepStatus>) -> bool {
    track.steps().iter().all(|key| steps.contains_key(*key))
}

/// The overall standing. Dismissing wins over everything else.
#[must_use]
pub fn standing(track: Track, steps: &BTreeMap<String, StepStatus>, dismissed: bool) -> Standing {
    if dismissed {
        Standing::Dismissed
    } else if is_complete(track, steps) {
        Standing::Complete
    } else if steps.is_empty() {
        Standing::New
    } else {
        Standing::InProgress
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn standing_follows_the_steps() {
        let none = BTreeMap::new();
        assert_eq!(standing(Track::Clinic, &none, false), Standing::New);
        let some = read_steps(
            Track::Clinic,
            &json!({ "clinic": "done", "hours": "skipped" }),
        );
        assert_eq!(standing(Track::Clinic, &some, false), Standing::InProgress);
        assert_eq!(standing(Track::Clinic, &some, true), Standing::Dismissed);
        let all = read_steps(
            Track::Clinic,
            &json!({ "clinic": "done", "hours": "done", "look": "skipped", "services": "done", "team": "done" }),
        );
        assert_eq!(standing(Track::Clinic, &all, false), Standing::Complete);
    }

    #[test]
    fn unknown_steps_and_values_are_ignored() {
        let steps = read_steps(
            Track::Member,
            &json!({ "profile": "done", "old": "done", "x": 3 }),
        );
        assert_eq!(steps.len(), 1);
        assert!(read_steps(Track::Member, &json!({ "profile": "maybe" })).is_empty());
        assert!(!Track::Member.has_step("clinic"));
    }

    #[test]
    fn values_round_trip() {
        for status in [StepStatus::Done, StepStatus::Skipped] {
            assert_eq!(StepStatus::parse(status.as_str()), Some(status));
        }
        for practice in [Practice::Solo, Practice::Team, Practice::Multi] {
            assert_eq!(Practice::parse(practice.as_str()), Some(practice));
        }
    }
}
