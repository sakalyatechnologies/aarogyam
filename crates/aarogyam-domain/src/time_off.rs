//! Staff time off: the kinds, the window a request covers, who sees what, and the clinic's
//! staff-operations settings. Stored in `time_off_requests` and `org_settings.staff_ops`; pure
//! rules.
//!
//! Privacy: other staff learn only that a person is away and when. The kind and the reason are
//! for the requester and for holders of `time_off.manage`; pending and declined requests too.

use serde_json::{Map, Value};
use time::{Date, Duration, OffsetDateTime};

/// The longest a request may last.
pub const MAX_DAYS: i64 = 366;

/// The longest whole-day request, in days. One less than [`MAX_DAYS`] so a window that crosses a
/// daylight-saving change (a 25-hour day) still fits the database's 366-day check.
pub const MAX_ALL_DAY_DAYS: i64 = 365;

/// The longest reason or decision note, in characters.
pub const MAX_TEXT: usize = 200;

/// The generic reason on the leave block an approved request makes. The request's own reason is
/// never copied there: availability and the calendar read `leave_blocks` for everyone.
pub const LEAVE_BLOCK_REASON: &str = "Time off";

text_value! {
    /// Why someone is away.
    Kind ("kind") {
        /// Planned holiday.
        Vacation => "vacation",
        /// Unwell.
        Sick => "sick",
        /// A personal matter.
        Personal => "personal",
        /// Anything else.
        Other => "other",
    }
}

text_value! {
    /// Where a request stands.
    Status ("status") {
        /// Waiting for the owner.
        Pending => "pending",
        /// Approved; blocks bookings for a doctor.
        Approved => "approved",
        /// Declined by the owner.
        Declined => "declined",
        /// Withdrawn by the requester or the owner.
        Cancelled => "cancelled",
    }
}

/// Why a request or setting was refused. Messages never contain a reason or a name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TimeOffError {
    /// The window does not start before it ends.
    #[error("must be before the end")]
    StartNotBeforeEnd,
    /// The window is longer than the limit.
    #[error("can be at most 366 days (365 for whole days)")]
    TooLong,
    /// A reason or note is empty or too long.
    #[error("must be 1 to 200 characters")]
    Text,
}

impl TimeOffError {
    /// The field at fault, as the API names it.
    #[must_use]
    pub const fn field(self) -> &'static str {
        match self {
            Self::StartNotBeforeEnd | Self::TooLong => "starts_at",
            Self::Text => "reason",
        }
    }
}

/// When someone is away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Window {
    /// From one instant to a later one.
    Timed {
        /// Start.
        starts_at: OffsetDateTime,
        /// End, after the start.
        ends_at: OffsetDateTime,
    },
    /// Whole days of the clinic's calendar, the first and the last both included. The database
    /// turns them into local midnights.
    AllDay {
        /// The first day.
        first_day: Date,
        /// The last day, not before the first.
        last_day: Date,
    },
}

impl Window {
    /// Checks the window against the rules.
    ///
    /// # Errors
    /// [`TimeOffError::StartNotBeforeEnd`] or [`TimeOffError::TooLong`].
    pub fn check(&self) -> Result<(), TimeOffError> {
        match *self {
            Self::Timed { starts_at, ends_at } => {
                if starts_at >= ends_at {
                    Err(TimeOffError::StartNotBeforeEnd)
                } else if ends_at - starts_at > Duration::days(MAX_DAYS) {
                    Err(TimeOffError::TooLong)
                } else {
                    Ok(())
                }
            }
            Self::AllDay {
                first_day,
                last_day,
            } => {
                if first_day > last_day {
                    Err(TimeOffError::StartNotBeforeEnd)
                } else if (last_day - first_day).whole_days() + 1 > MAX_ALL_DAY_DAYS {
                    Err(TimeOffError::TooLong)
                } else {
                    Ok(())
                }
            }
        }
    }
}

/// A reason or decision note, trimmed; `None` when left out or blank.
///
/// # Errors
/// [`TimeOffError::Text`] when it is longer than [`MAX_TEXT`] characters.
pub fn clean_text(text: Option<&str>) -> Result<Option<String>, TimeOffError> {
    let Some(trimmed) = text.map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    if trimmed.chars().count() > MAX_TEXT {
        return Err(TimeOffError::Text);
    }
    Ok(Some(trimmed.to_owned()))
}

/// Whether a new request is approved the moment it is made: the owner recording time off for
/// someone else always is; a member's own request is when the clinic does not ask for approval.
#[must_use]
pub const fn approved_at_once(for_someone_else: bool, requires_approval: bool) -> bool {
    for_someone_else || !requires_approval
}

/// Whether a viewer may see a request's kind, reason and decision, and its pending or declined
/// state: the requester and holders of `time_off.manage`.
#[must_use]
pub fn sees_private(viewer_is_requester: bool, viewer_manages: bool) -> bool {
    viewer_is_requester || viewer_manages
}

/// The fewest minutes between task reminders.
pub const MIN_REMIND_MINUTES: u16 = 15;
/// The most minutes between task reminders: one day.
pub const MAX_REMIND_MINUTES: u16 = 1440;

/// A clinic's staff-operations settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaffOpsSettings {
    /// Whether staff time off waits for the owner's approval (default on).
    pub time_off_requires_approval: bool,
    /// Minutes between reminders of a task that is still open (default 60).
    pub tasks_remind_every_minutes: u16,
}

impl Default for StaffOpsSettings {
    fn default() -> Self {
        Self {
            time_off_requires_approval: true,
            tasks_remind_every_minutes: 60,
        }
    }
}

/// Changes to the settings; what is left out stays.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StaffOpsChanges {
    /// Whether time off needs approval.
    pub time_off_requires_approval: Option<bool>,
    /// Minutes between task reminders, 15 to 1440.
    pub tasks_remind_every_minutes: Option<i64>,
}

/// Why a settings change was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    /// The reminder interval is outside 15 to 1440.
    #[error("must be from 15 to 1440 minutes")]
    RemindEvery,
}

impl SettingsError {
    /// The field at fault, as the API names it.
    #[must_use]
    pub const fn field(self) -> &'static str {
        match self {
            Self::RemindEvery => "tasks.remind_every_minutes",
        }
    }
}

impl StaffOpsSettings {
    /// Reads the stored object, using the default for anything missing or unreadable.
    #[must_use]
    pub fn from_stored(stored: &Value) -> Self {
        let defaults = Self::default();
        Self {
            time_off_requires_approval: stored
                .pointer("/time_off/requires_approval")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.time_off_requires_approval),
            tasks_remind_every_minutes: stored
                .pointer("/tasks/remind_every_minutes")
                .and_then(Value::as_u64)
                .and_then(|minutes| u16::try_from(minutes).ok())
                .filter(|minutes| (MIN_REMIND_MINUTES..=MAX_REMIND_MINUTES).contains(minutes))
                .unwrap_or(defaults.tasks_remind_every_minutes),
        }
    }

    /// Applies `changes`.
    ///
    /// # Errors
    /// [`SettingsError::RemindEvery`] for an interval outside 15 to 1440; nothing changes then.
    pub fn apply(&mut self, changes: &StaffOpsChanges) -> Result<(), SettingsError> {
        let minutes = match changes.tasks_remind_every_minutes {
            None => self.tasks_remind_every_minutes,
            Some(minutes) => u16::try_from(minutes)
                .ok()
                .filter(|minutes| (MIN_REMIND_MINUTES..=MAX_REMIND_MINUTES).contains(minutes))
                .ok_or(SettingsError::RemindEvery)?,
        };
        self.tasks_remind_every_minutes = minutes;
        self.time_off_requires_approval = changes
            .time_off_requires_approval
            .unwrap_or(self.time_off_requires_approval);
        Ok(())
    }

    /// Writes the settings into the stored object, keeping every other key.
    pub fn merge_into(&self, stored: &mut Value) {
        if !stored.is_object() {
            *stored = Value::Object(Map::new());
        }
        if let Value::Object(map) = stored {
            put(
                map,
                "time_off",
                "requires_approval",
                Value::Bool(self.time_off_requires_approval),
            );
            put(
                map,
                "tasks",
                "remind_every_minutes",
                Value::from(self.tasks_remind_every_minutes),
            );
        }
    }
}

fn put(map: &mut Map<String, Value>, group: &str, key: &str, value: Value) {
    let entry = map
        .entry(group.to_owned())
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    if let Value::Object(inner) = entry {
        inner.insert(key.to_owned(), value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use time::macros::{date, datetime};

    #[test]
    fn a_timed_window_starts_before_it_ends_and_lasts_a_year_at_most() {
        let start = datetime!(2026-11-02 04:00 UTC);
        let timed = |ends_at| Window::Timed {
            starts_at: start,
            ends_at,
        };
        assert_eq!(timed(start + Duration::hours(8)).check(), Ok(()));
        assert_eq!(timed(start).check(), Err(TimeOffError::StartNotBeforeEnd));
        assert_eq!(
            timed(start - Duration::hours(1)).check(),
            Err(TimeOffError::StartNotBeforeEnd)
        );
        assert_eq!(timed(start + Duration::days(366)).check(), Ok(()));
        assert_eq!(
            timed(start + Duration::days(366) + Duration::seconds(1)).check(),
            Err(TimeOffError::TooLong)
        );
    }

    #[test]
    fn whole_days_include_both_ends() {
        let day = date!(2026 - 11 - 02);
        let days = |last_day| Window::AllDay {
            first_day: day,
            last_day,
        };
        assert_eq!(days(day).check(), Ok(()));
        assert_eq!(
            days(date!(2026 - 11 - 01)).check(),
            Err(TimeOffError::StartNotBeforeEnd)
        );
        assert_eq!(days(day + Duration::days(364)).check(), Ok(()));
        assert_eq!(
            days(day + Duration::days(365)).check(),
            Err(TimeOffError::TooLong)
        );
    }

    #[test]
    fn text_is_trimmed_and_capped() {
        assert_eq!(clean_text(None), Ok(None));
        assert_eq!(clean_text(Some("  ")), Ok(None));
        assert_eq!(clean_text(Some(" flu ")), Ok(Some("flu".into())));
        assert_eq!(
            clean_text(Some(&"x".repeat(200))).map(|t| t.map(|t| t.len())),
            Ok(Some(200))
        );
        assert_eq!(clean_text(Some(&"x".repeat(201))), Err(TimeOffError::Text));
    }

    #[test]
    fn approval_and_privacy_rules() {
        assert!(approved_at_once(true, true));
        assert!(approved_at_once(false, false));
        assert!(!approved_at_once(false, true));
        assert!(sees_private(true, false) && sees_private(false, true));
        assert!(!sees_private(false, false));
    }

    #[test]
    fn missing_settings_mean_the_defaults() {
        assert_eq!(
            StaffOpsSettings::from_stored(&json!({})),
            StaffOpsSettings::default()
        );
        let odd = json!({ "time_off": { "requires_approval": "no" }, "tasks": { "remind_every_minutes": 5 } });
        assert_eq!(
            StaffOpsSettings::from_stored(&odd),
            StaffOpsSettings::default()
        );
        let set = json!({ "time_off": { "requires_approval": false }, "tasks": { "remind_every_minutes": 30 } });
        let read = StaffOpsSettings::from_stored(&set);
        assert!(!read.time_off_requires_approval);
        assert_eq!(read.tasks_remind_every_minutes, 30);
    }

    #[test]
    fn changes_are_checked_and_merged_keeping_other_keys() {
        let mut stored = json!({ "tasks": { "other": 1 }, "future": true });
        let mut settings = StaffOpsSettings::from_stored(&stored);
        for bad in [0, 14, 1441, -60, i64::MAX] {
            let before = settings;
            assert_eq!(
                settings.apply(&StaffOpsChanges {
                    time_off_requires_approval: Some(false),
                    tasks_remind_every_minutes: Some(bad),
                }),
                Err(SettingsError::RemindEvery)
            );
            assert_eq!(settings, before);
        }
        settings
            .apply(&StaffOpsChanges {
                time_off_requires_approval: Some(false),
                tasks_remind_every_minutes: Some(1440),
            })
            .unwrap();
        settings.merge_into(&mut stored);
        assert_eq!(
            stored["tasks"],
            json!({ "other": 1, "remind_every_minutes": 1440 })
        );
        assert_eq!(stored["time_off"], json!({ "requires_approval": false }));
        assert_eq!(stored["future"], true);
    }
}
