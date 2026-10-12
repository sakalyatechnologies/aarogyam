//! A clinic's notification switches: which reminders and alerts it wants, and its quiet hours.
//! Stored in `org_settings.notifications` beside keys other features own (the campaign caps), so
//! changes merge into the stored object and never replace it. A key that is missing or not the
//! right type means its default, so clinics that never opened the screen keep today's behaviour.
//! Pure rules.

use serde_json::{Map, Value};
use time::Time;
use time::macros::format_description;

/// Why a change was refused. Messages never contain patient data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PrefsError {
    /// The quiet hours start is not `HH:MM`.
    #[error("must be a time like 21:00")]
    QuietStart,
    /// The quiet hours end is not `HH:MM`.
    #[error("must be a time like 09:00")]
    QuietEnd,
    /// Quiet hours that start and end at the same time cover nothing.
    #[error("must differ from the start; switch quiet hours off instead")]
    QuietSame,
}

impl PrefsError {
    /// The field at fault, as the API names it.
    #[must_use]
    pub const fn field(self) -> &'static str {
        match self {
            Self::QuietStart | Self::QuietSame => "quiet_hours.start",
            Self::QuietEnd => "quiet_hours.end",
        }
    }
}

/// When patient reminders and offers wait instead of going, in the clinic's time zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuietHours {
    /// Whether they apply.
    pub enabled: bool,
    /// When they begin.
    pub start: Time,
    /// When they end; earlier than `start` means they run overnight.
    pub end: Time,
}

impl Default for QuietHours {
    fn default() -> Self {
        Self {
            enabled: true,
            start: Time::from_hms(21, 0, 0).unwrap_or(Time::MIDNIGHT),
            end: Time::from_hms(9, 0, 0).unwrap_or(Time::MIDNIGHT),
        }
    }
}

/// The notification switches of one clinic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch per notification the clinic can turn off"
)]
pub struct NotificationPrefs {
    /// Remind patients a day before their appointment (default on).
    pub reminder_24h: bool,
    /// Remind patients two hours before (default off).
    pub reminder_2h: bool,
    /// Email patients a receipt when a payment is recorded (default off).
    pub receipts: bool,
    /// Tell staff when a patient's follow-up falls due (default on).
    pub recall: bool,
    /// Show low stock on Today (default on).
    pub low_stock: bool,
    /// Tell staff when lab work is overdue (default on).
    pub lab_due: bool,
    /// Quiet hours for reminders and offers.
    pub quiet_hours: QuietHours,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            reminder_24h: true,
            reminder_2h: false,
            receipts: false,
            recall: true,
            low_stock: true,
            lab_due: true,
            quiet_hours: QuietHours::default(),
        }
    }
}

/// Changes to quiet hours; what is left out stays.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QuietHoursChanges {
    /// Switch them on or off.
    pub enabled: Option<bool>,
    /// New start, `HH:MM`.
    pub start: Option<String>,
    /// New end, `HH:MM`.
    pub end: Option<String>,
}

/// Changes to the switches; what is left out stays.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotificationChanges {
    /// A day-before reminder.
    pub reminder_24h: Option<bool>,
    /// A two-hour reminder.
    pub reminder_2h: Option<bool>,
    /// Receipts.
    pub receipts: Option<bool>,
    /// Recalls.
    pub recall: Option<bool>,
    /// Low stock.
    pub low_stock: Option<bool>,
    /// Overdue lab work.
    pub lab_due: Option<bool>,
    /// Quiet hours.
    pub quiet_hours: Option<QuietHoursChanges>,
}

const HHMM: &[time::format_description::BorrowedFormatItem<'static>] =
    format_description!("[hour]:[minute]");

/// `HH:MM` text of a time.
#[must_use]
pub fn hhmm(time: Time) -> String {
    format!("{:02}:{:02}", time.hour(), time.minute())
}

fn parse_time(text: &str, error: PrefsError) -> Result<Time, PrefsError> {
    Time::parse(text.trim(), HHMM).map_err(|_| error)
}

fn flag(object: &Value, key: &str, default: bool) -> bool {
    object.get(key).and_then(Value::as_bool).unwrap_or(default)
}

impl NotificationPrefs {
    /// Reads the stored object, using the default for anything missing or unreadable.
    #[must_use]
    pub fn from_stored(stored: &Value) -> Self {
        let defaults = Self::default();
        let quiet = stored.get("quiet_hours").unwrap_or(&Value::Null);
        let time_of = |key: &str, default: Time| {
            quiet
                .get(key)
                .and_then(Value::as_str)
                .and_then(|text| Time::parse(text, HHMM).ok())
                .unwrap_or(default)
        };
        Self {
            reminder_24h: flag(stored, "reminder_24h", defaults.reminder_24h),
            reminder_2h: flag(stored, "reminder_2h", defaults.reminder_2h),
            receipts: flag(stored, "receipts", defaults.receipts),
            recall: flag(stored, "recall", defaults.recall),
            low_stock: flag(stored, "low_stock", defaults.low_stock),
            lab_due: flag(stored, "lab_due", defaults.lab_due),
            quiet_hours: QuietHours {
                enabled: flag(quiet, "enabled", true),
                start: time_of("start", defaults.quiet_hours.start),
                end: time_of("end", defaults.quiet_hours.end),
            },
        }
    }

    /// Applies `changes`, checking quiet hours.
    ///
    /// # Errors
    /// The [`PrefsError`] for the first bad value; nothing is changed then.
    pub fn apply(&mut self, changes: &NotificationChanges) -> Result<(), PrefsError> {
        let mut next = *self;
        if let Some(quiet) = &changes.quiet_hours {
            if let Some(start) = &quiet.start {
                next.quiet_hours.start = parse_time(start, PrefsError::QuietStart)?;
            }
            if let Some(end) = &quiet.end {
                next.quiet_hours.end = parse_time(end, PrefsError::QuietEnd)?;
            }
            next.quiet_hours.enabled = quiet.enabled.unwrap_or(next.quiet_hours.enabled);
            if next.quiet_hours.enabled && next.quiet_hours.start == next.quiet_hours.end {
                return Err(PrefsError::QuietSame);
            }
        }
        next.reminder_24h = changes.reminder_24h.unwrap_or(next.reminder_24h);
        next.reminder_2h = changes.reminder_2h.unwrap_or(next.reminder_2h);
        next.receipts = changes.receipts.unwrap_or(next.receipts);
        next.recall = changes.recall.unwrap_or(next.recall);
        next.low_stock = changes.low_stock.unwrap_or(next.low_stock);
        next.lab_due = changes.lab_due.unwrap_or(next.lab_due);
        *self = next;
        Ok(())
    }

    /// Writes the switches into the stored object, keeping every other key.
    pub fn merge_into(&self, stored: &mut Value) {
        if !stored.is_object() {
            *stored = Value::Object(Map::new());
        }
        if let Value::Object(map) = stored {
            for (key, value) in [
                ("reminder_24h", self.reminder_24h),
                ("reminder_2h", self.reminder_2h),
                ("receipts", self.receipts),
                ("recall", self.recall),
                ("low_stock", self.low_stock),
                ("lab_due", self.lab_due),
            ] {
                map.insert(key.to_owned(), Value::Bool(value));
            }
            map.insert(
                "quiet_hours".to_owned(),
                serde_json::json!({
                    "enabled": self.quiet_hours.enabled,
                    "start": hhmm(self.quiet_hours.start),
                    "end": hhmm(self.quiet_hours.end),
                }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_keys_mean_the_defaults() {
        let prefs = NotificationPrefs::from_stored(&json!({}));
        assert_eq!(prefs, NotificationPrefs::default());
        assert!(prefs.reminder_24h && !prefs.reminder_2h && !prefs.receipts);
        assert_eq!(hhmm(prefs.quiet_hours.start), "21:00");
        assert_eq!(hhmm(prefs.quiet_hours.end), "09:00");
        let odd = NotificationPrefs::from_stored(&json!({
            "receipts": "yes", "quiet_hours": { "start": "late" }
        }));
        assert_eq!(odd, NotificationPrefs::default());
    }

    #[test]
    fn changes_merge_and_keep_other_keys() {
        let mut stored = json!({ "promo_daily_cap": 50, "quiet_hours": { "start": "22:00" } });
        let mut prefs = NotificationPrefs::from_stored(&stored);
        assert_eq!(hhmm(prefs.quiet_hours.start), "22:00");
        prefs
            .apply(&NotificationChanges {
                receipts: Some(true),
                reminder_2h: Some(true),
                quiet_hours: Some(QuietHoursChanges {
                    end: Some("08:30".into()),
                    ..QuietHoursChanges::default()
                }),
                ..NotificationChanges::default()
            })
            .unwrap();
        prefs.merge_into(&mut stored);
        assert_eq!(stored["promo_daily_cap"], 50);
        assert_eq!(stored["receipts"], true);
        assert_eq!(stored["reminder_2h"], true);
        assert_eq!(stored["quiet_hours"]["start"], "22:00");
        assert_eq!(stored["quiet_hours"]["end"], "08:30");
        assert_eq!(stored["quiet_hours"]["enabled"], true);
    }

    #[test]
    fn bad_quiet_hours_are_refused_and_change_nothing() {
        let mut prefs = NotificationPrefs::default();
        let bad =
            |start: Option<&str>, end: Option<&str>, enabled: Option<bool>| NotificationChanges {
                receipts: Some(true),
                quiet_hours: Some(QuietHoursChanges {
                    enabled,
                    start: start.map(str::to_owned),
                    end: end.map(str::to_owned),
                }),
                ..NotificationChanges::default()
            };
        assert_eq!(
            prefs.apply(&bad(Some("25:00"), None, None)),
            Err(PrefsError::QuietStart)
        );
        assert_eq!(
            prefs.apply(&bad(None, Some("noon"), None)),
            Err(PrefsError::QuietEnd)
        );
        assert_eq!(
            prefs.apply(&bad(Some("09:00"), Some("09:00"), None)),
            Err(PrefsError::QuietSame)
        );
        assert!(!prefs.receipts, "a refused change applies nothing");
        // Equal times are fine once quiet hours are off.
        assert!(
            prefs
                .apply(&bad(Some("09:00"), Some("09:00"), Some(false)))
                .is_ok()
        );
    }
}
