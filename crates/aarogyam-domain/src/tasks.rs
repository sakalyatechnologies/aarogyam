//! Recurring staff tasks: schedules, who they are for, and how a template is checked.
//!
//! What "every 3 days" or "weekdays" means, and when a task falls due in a clinic's time zone, is
//! decided in Postgres (`app.task_due_dates`, migration 0662), the one place that makes
//! occurrences; this module holds the types for a template and the checks the table also makes,
//! so a bad request is refused with a message instead of a constraint error.

use time::{Date, OffsetDateTime, Time, Weekday};

use crate::ids::{MembershipId, RoleId};

text_value!(
    /// How a task repeats.
    ScheduleKind("schedule_kind") {
        /// Once, at a moment.
        Once => "once",
        /// Every clinic day.
        Daily => "daily",
        /// Every N days, counted from the start date.
        EveryNDays => "every_n_days",
        /// On chosen days of the week.
        Weekdays => "weekdays",
    }
);

text_value!(
    /// What finishing a task asks of the person.
    TaskAction("action") {
        /// Just mark it done.
        Plain => "none",
        /// Record the materials used (stock usage), then mark it done.
        RecordUsage => "record_usage",
        /// Check that the day's patients have their photos, then mark it done.
        ConfirmPhotos => "confirm_photos",
    }
);

text_value!(
    /// Where one day's run of a task stands.
    OccurrenceStatus("status") {
        /// Not yet done.
        Open => "open",
        /// Done by someone eligible.
        Done => "done",
        /// Set aside on purpose.
        Skipped => "skipped",
        /// Never done and past its time.
        Missed => "missed",
    }
);

/// The longest title.
pub const TITLE_MAX: usize = 120;
/// The longest description.
pub const DESCRIPTION_MAX: usize = 500;
/// The longest note on an occurrence. The screens warn: no patient names.
pub const NOTE_MAX: usize = 300;
/// Reminders before the owner is told once more, by default.
pub const DEFAULT_ESCALATE_AFTER: u8 = 3;
/// The most reminders before escalating.
pub const ESCALATE_AFTER_MAX: u8 = 24;
/// The shortest gap between reminders.
pub const REMIND_EVERY_MIN: u16 = 15;
/// The longest gap between reminders.
pub const REMIND_EVERY_MAX: u16 = 1440;
/// The fewest and most days between a task's occurrences when it repeats every N days.
pub const INTERVAL_DAYS: std::ops::RangeInclusive<u16> = 2..=365;

/// Why a task template was refused. Messages never echo what was sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TaskError {
    /// The title is blank or longer than 120 characters.
    #[error("title must be 1 to 120 characters")]
    Title,
    /// The description is longer than 500 characters.
    #[error("description must be at most 500 characters")]
    Description,
    /// A repeat interval outside 2 to 365 days.
    #[error("interval must be 2 to 365 days")]
    Interval,
    /// No weekday chosen, or a bit outside Monday to Sunday.
    #[error("choose at least one day of the week")]
    Weekdays,
    /// The task ends before it starts.
    #[error("the end date is before the start date")]
    EndsBeforeStart,
    /// A one-off task due at a moment that has passed.
    #[error("the time has already passed")]
    OnceInPast,
    /// A reminder gap outside 15 minutes to a day.
    #[error("reminders must be 15 to 1440 minutes apart")]
    RemindEvery,
    /// More than 24 reminders before escalating.
    #[error("escalate after at most 24 reminders")]
    EscalateAfter,
    /// The note is longer than 300 characters.
    #[error("note must be at most 300 characters")]
    NoteTooLong,
}

/// Days of the week as an ISO bitmask: Monday is 1, Tuesday 2, then 4, 8, 16, 32 and Sunday 64.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Weekdays(u8);

impl Weekdays {
    /// Every day of the week.
    pub const ALL: Self = Self(0b111_1111);

    /// A bitmask as stored.
    ///
    /// # Errors
    /// [`TaskError::Weekdays`] when it is empty or has a bit above Sunday.
    pub const fn new(mask: u8) -> Result<Self, TaskError> {
        if mask == 0 || mask > Self::ALL.0 {
            Err(TaskError::Weekdays)
        } else {
            Ok(Self(mask))
        }
    }

    /// The days listed.
    ///
    /// # Errors
    /// [`TaskError::Weekdays`] when the list is empty.
    pub fn from_days(days: &[Weekday]) -> Result<Self, TaskError> {
        let mask = days.iter().fold(0_u8, |mask, day| mask | Self::bit(*day));
        Self::new(mask)
    }

    /// The bitmask as stored.
    #[must_use]
    pub const fn mask(self) -> u8 {
        self.0
    }

    /// Whether the task runs on `day`.
    #[must_use]
    pub fn contains(self, day: Weekday) -> bool {
        self.0 & Self::bit(day) != 0
    }

    /// The days chosen, Monday first.
    #[must_use]
    pub fn days(self) -> Vec<Weekday> {
        [
            Weekday::Monday,
            Weekday::Tuesday,
            Weekday::Wednesday,
            Weekday::Thursday,
            Weekday::Friday,
            Weekday::Saturday,
            Weekday::Sunday,
        ]
        .into_iter()
        .filter(|day| self.contains(*day))
        .collect()
    }

    const fn bit(day: Weekday) -> u8 {
        1 << day.number_days_from_monday()
    }
}

/// Who a task is for: one person, or whoever holds a role (the first eligible person to finish
/// it closes it for everyone).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assignee {
    /// One member of the clinic.
    Member(MembershipId),
    /// Everyone holding a role.
    Role(RoleId),
}

/// When a task falls due. Times are the clinic's local time, in its own zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Schedule {
    /// Once, at a moment.
    Once {
        /// When it falls due.
        at: OffsetDateTime,
    },
    /// Every clinic day.
    Daily {
        /// The time of day.
        due_time: Time,
        /// The first day.
        starts_on: Date,
        /// The last day, if it stops.
        ends_on: Option<Date>,
    },
    /// Every N days, the first on `starts_on`.
    EveryNDays {
        /// Days between occurrences, 2 to 365.
        interval_days: u16,
        /// The time of day.
        due_time: Time,
        /// The first day, which the count starts from.
        starts_on: Date,
        /// The last day, if it stops.
        ends_on: Option<Date>,
    },
    /// On chosen days of the week.
    Weekdays {
        /// The days.
        days: Weekdays,
        /// The time of day.
        due_time: Time,
        /// The first day.
        starts_on: Date,
        /// The last day, if it stops.
        ends_on: Option<Date>,
    },
}

/// A schedule as the `task_templates` columns hold it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScheduleColumns {
    /// `schedule_kind`.
    pub kind: ScheduleKind,
    /// `once_at`.
    pub once_at: Option<OffsetDateTime>,
    /// `interval_days`.
    pub interval_days: Option<u16>,
    /// `weekdays`, the bitmask.
    pub weekdays: Option<u8>,
    /// `due_time`.
    pub due_time: Option<Time>,
    /// `starts_on`.
    pub starts_on: Option<Date>,
    /// `ends_on`.
    pub ends_on: Option<Date>,
}

impl Schedule {
    /// The kind, as stored.
    #[must_use]
    pub const fn kind(&self) -> ScheduleKind {
        match self {
            Self::Once { .. } => ScheduleKind::Once,
            Self::Daily { .. } => ScheduleKind::Daily,
            Self::EveryNDays { .. } => ScheduleKind::EveryNDays,
            Self::Weekdays { .. } => ScheduleKind::Weekdays,
        }
    }

    /// The columns that hold this schedule; the unused ones are none.
    #[must_use]
    pub const fn columns(&self) -> ScheduleColumns {
        let none = ScheduleColumns {
            kind: self.kind(),
            once_at: None,
            interval_days: None,
            weekdays: None,
            due_time: None,
            starts_on: None,
            ends_on: None,
        };
        match *self {
            Self::Once { at } => ScheduleColumns {
                once_at: Some(at),
                ..none
            },
            Self::Daily {
                due_time,
                starts_on,
                ends_on,
            } => ScheduleColumns {
                due_time: Some(due_time),
                starts_on: Some(starts_on),
                ends_on,
                ..none
            },
            Self::EveryNDays {
                interval_days,
                due_time,
                starts_on,
                ends_on,
            } => ScheduleColumns {
                interval_days: Some(interval_days),
                due_time: Some(due_time),
                starts_on: Some(starts_on),
                ends_on,
                ..none
            },
            Self::Weekdays {
                days,
                due_time,
                starts_on,
                ends_on,
            } => ScheduleColumns {
                weekdays: Some(days.mask()),
                due_time: Some(due_time),
                starts_on: Some(starts_on),
                ends_on,
                ..none
            },
        }
    }

    /// Checks the schedule as the table does. A one-off task must fall due after `now`.
    ///
    /// # Errors
    /// [`TaskError::Interval`], [`TaskError::EndsBeforeStart`] or [`TaskError::OnceInPast`].
    pub fn check(&self, now: OffsetDateTime) -> Result<(), TaskError> {
        match *self {
            Self::Once { at } if at <= now => Err(TaskError::OnceInPast),
            Self::EveryNDays { interval_days, .. } if !INTERVAL_DAYS.contains(&interval_days) => {
                Err(TaskError::Interval)
            }
            Self::Daily {
                starts_on,
                ends_on: Some(ends_on),
                ..
            }
            | Self::EveryNDays {
                starts_on,
                ends_on: Some(ends_on),
                ..
            }
            | Self::Weekdays {
                starts_on,
                ends_on: Some(ends_on),
                ..
            } if ends_on < starts_on => Err(TaskError::EndsBeforeStart),
            _ => Ok(()),
        }
    }
}

/// What a task template is made from, as sent by a person with `tasks.manage`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateInput {
    /// What is to be done.
    pub title: String,
    /// More detail.
    pub description: Option<String>,
    /// Who it is for.
    pub assignee: Assignee,
    /// When it falls due.
    pub schedule: Schedule,
    /// Minutes between reminders; none means the clinic's default.
    pub remind_every_minutes: Option<u16>,
    /// Reminders before the owner is told once more; 0 means never.
    pub escalate_after: u8,
    /// What finishing it asks of the person.
    pub action: TaskAction,
}

/// A template that passed [`TemplateInput::validate`]: trimmed and within the table's checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Template(TemplateInput);

impl Template {
    /// The checked values.
    #[must_use]
    pub const fn get(&self) -> &TemplateInput {
        &self.0
    }

    /// The checked values, by value.
    #[must_use]
    pub fn into_inner(self) -> TemplateInput {
        self.0
    }
}

impl TemplateInput {
    /// Trims and checks the template; `now` is when it is made or changed.
    ///
    /// # Errors
    /// The [`TaskError`] for the first rule broken.
    pub fn validate(mut self, now: OffsetDateTime) -> Result<Template, TaskError> {
        self.title = self.title.trim().to_owned();
        if self.title.is_empty() || self.title.chars().count() > TITLE_MAX {
            return Err(TaskError::Title);
        }
        self.description = match self.description.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(text) if text.chars().count() > DESCRIPTION_MAX => {
                return Err(TaskError::Description);
            }
            Some(text) => Some(text.to_owned()),
        };
        self.schedule.check(now)?;
        if let Some(minutes) = self.remind_every_minutes
            && !(REMIND_EVERY_MIN..=REMIND_EVERY_MAX).contains(&minutes)
        {
            return Err(TaskError::RemindEvery);
        }
        if self.escalate_after > ESCALATE_AFTER_MAX {
            return Err(TaskError::EscalateAfter);
        }
        Ok(Template(self))
    }
}

/// Trims a note on an occurrence; blank becomes none.
///
/// # Errors
/// [`TaskError::NoteTooLong`] past 300 characters.
pub fn check_note(note: Option<&str>) -> Result<Option<String>, TaskError> {
    match note.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) if text.chars().count() > NOTE_MAX => Err(TaskError::NoteTooLong),
        Some(text) => Ok(Some(text.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use time::macros::{date, datetime, time};
    use uuid::Uuid;

    use super::*;

    const NOW: OffsetDateTime = datetime!(2027-03-10 09:00 UTC);

    fn input(schedule: Schedule) -> TemplateInput {
        TemplateInput {
            title: "  Sterilise instruments ".into(),
            description: Some("  ".into()),
            assignee: Assignee::Role(RoleId::from_uuid(Uuid::nil())),
            schedule,
            remind_every_minutes: None,
            escalate_after: DEFAULT_ESCALATE_AFTER,
            action: TaskAction::Plain,
        }
    }

    const DAILY: Schedule = Schedule::Daily {
        due_time: time!(08:30),
        starts_on: date!(2027 - 03 - 10),
        ends_on: None,
    };

    #[test]
    fn a_template_is_trimmed() {
        let template = input(DAILY).validate(NOW).unwrap();
        assert_eq!(template.get().title, "Sterilise instruments");
        assert_eq!(template.get().description, None);
    }

    #[test]
    fn titles_and_descriptions_are_bounded() {
        let mut blank = input(DAILY);
        blank.title = "   ".into();
        assert_eq!(blank.validate(NOW), Err(TaskError::Title));
        let mut long = input(DAILY);
        long.title = "x".repeat(121);
        assert_eq!(long.validate(NOW), Err(TaskError::Title));
        let mut described = input(DAILY);
        described.description = Some("x".repeat(501));
        assert_eq!(described.validate(NOW), Err(TaskError::Description));
    }

    #[test]
    fn schedules_are_checked() {
        let once = |at| input(Schedule::Once { at });
        assert!(once(NOW + time::Duration::hours(1)).validate(NOW).is_ok());
        assert_eq!(once(NOW).validate(NOW), Err(TaskError::OnceInPast));
        let every = |interval_days| {
            input(Schedule::EveryNDays {
                interval_days,
                due_time: time!(09:00),
                starts_on: date!(2027 - 03 - 10),
                ends_on: None,
            })
        };
        assert!(every(2).validate(NOW).is_ok());
        assert!(every(365).validate(NOW).is_ok());
        assert_eq!(every(1).validate(NOW), Err(TaskError::Interval));
        assert_eq!(every(366).validate(NOW), Err(TaskError::Interval));
        let backwards = input(Schedule::Daily {
            due_time: time!(09:00),
            starts_on: date!(2027 - 03 - 10),
            ends_on: Some(date!(2027 - 03 - 09)),
        });
        assert_eq!(backwards.validate(NOW), Err(TaskError::EndsBeforeStart));
    }

    #[test]
    fn reminders_are_bounded() {
        let mut every = input(DAILY);
        every.remind_every_minutes = Some(14);
        assert_eq!(every.clone().validate(NOW), Err(TaskError::RemindEvery));
        every.remind_every_minutes = Some(1441);
        assert_eq!(every.clone().validate(NOW), Err(TaskError::RemindEvery));
        every.remind_every_minutes = Some(15);
        assert!(every.clone().validate(NOW).is_ok());
        every.escalate_after = 25;
        assert_eq!(every.validate(NOW), Err(TaskError::EscalateAfter));
    }

    #[test]
    fn weekdays_are_a_monday_first_bitmask() {
        let days = Weekdays::from_days(&[Weekday::Monday, Weekday::Sunday]).unwrap();
        assert_eq!(days.mask(), 0b100_0001);
        assert!(days.contains(Weekday::Monday) && days.contains(Weekday::Sunday));
        assert!(!days.contains(Weekday::Tuesday));
        assert_eq!(days.days(), [Weekday::Monday, Weekday::Sunday]);
        assert_eq!(Weekdays::new(0), Err(TaskError::Weekdays));
        assert_eq!(Weekdays::new(128), Err(TaskError::Weekdays));
        assert_eq!(Weekdays::from_days(&[]), Err(TaskError::Weekdays));
        assert_eq!(Weekdays::ALL.days().len(), 7);
    }

    #[test]
    fn a_schedule_fills_only_its_own_columns() {
        let columns = Schedule::Weekdays {
            days: Weekdays::new(0b11).unwrap(),
            due_time: time!(07:00),
            starts_on: date!(2027 - 03 - 10),
            ends_on: None,
        }
        .columns();
        assert_eq!(columns.kind, ScheduleKind::Weekdays);
        assert_eq!(columns.weekdays, Some(3));
        assert_eq!(columns.interval_days, None);
        assert_eq!(columns.once_at, None);
        let once = Schedule::Once { at: NOW }.columns();
        assert_eq!(
            (once.once_at, once.due_time, once.starts_on),
            (Some(NOW), None, None)
        );
    }

    #[test]
    fn notes_are_trimmed_and_bounded() {
        assert_eq!(check_note(None), Ok(None));
        assert_eq!(check_note(Some(" ")), Ok(None));
        assert_eq!(check_note(Some(" done ")), Ok(Some("done".into())));
        assert_eq!(
            check_note(Some(&"x".repeat(300))).map(|n| n.is_some()),
            Ok(true)
        );
        assert_eq!(
            check_note(Some(&"x".repeat(301))),
            Err(TaskError::NoteTooLong)
        );
    }

    #[test]
    fn values_round_trip() {
        for kind in ScheduleKind::ALL {
            assert_eq!(ScheduleKind::parse(kind.as_str()), Ok(*kind));
        }
        for action in TaskAction::ALL {
            assert_eq!(TaskAction::parse(action.as_str()), Ok(*action));
        }
        for status in OccurrenceStatus::ALL {
            assert_eq!(OccurrenceStatus::parse(status.as_str()), Ok(*status));
        }
        assert!(ScheduleKind::parse("monthly").is_err());
    }
}
