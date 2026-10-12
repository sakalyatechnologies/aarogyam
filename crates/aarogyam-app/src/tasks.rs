//! Recurring staff tasks: what a person has to do today and finishing it (with the materials
//! used, when the task asks for them), and the manager's screens (the tasks themselves, their
//! next dates and the history). Which days a task falls due is decided in Postgres
//! (`app.task_due_dates`), the same function the generator uses.

use aarogyam_dal::tasks::{self as dal, OccurrenceRow, TemplateRow, TemplateValues};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::InventoryItemId;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::tasks::{
    Assignee, OccurrenceStatus, Schedule, ScheduleKind, TaskAction, TaskError, TemplateInput,
    Weekdays, check_note,
};
use sakalya_db::{Db, ScopedTx};
use time::{Date, Duration, OffsetDateTime, Time};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::inventory::use_stock_in;
use crate::scope::staff_scope as scope;

/// Why stock used when finishing a task is recorded.
pub const USAGE_REASON: &str = "end-of-day usage";
/// The most lines of materials used in one completion.
pub const MAX_USAGE_LINES: usize = 50;
/// The longest range the history shows, in days.
pub const HISTORY_DAYS: i64 = 92;
/// The most rows the history returns.
pub const HISTORY_LIMIT: i64 = 500;
/// How many next dates the preview lists.
pub const PREVIEW_COUNT: i64 = 5;

fn invalid(field: &'static str) -> impl Fn(TaskError) -> AppError {
    move |error| AppError::invalid(field, error)
}

/// The field a template check failed on, as the API names it.
fn template_error(error: TaskError) -> AppError {
    let field = match error {
        TaskError::Title => "title",
        TaskError::Description => "description",
        TaskError::Interval => "interval_days",
        TaskError::Weekdays => "weekdays",
        TaskError::EndsBeforeStart => "ends_on",
        TaskError::OnceInPast => "once_at",
        TaskError::RemindEvery => "remind_every_minutes",
        TaskError::EscalateAfter => "escalate_after",
        TaskError::NoteTooLong => "note",
    };
    AppError::invalid(field, error)
}

// ------------------------------------------------------------------ views

/// One day's run of a task, as the API shows it.
#[derive(Debug, Clone)]
pub struct OccurrenceView {
    /// Identifier.
    pub id: Uuid,
    /// The task it came from.
    pub template_id: Uuid,
    /// The title.
    pub title: String,
    /// What finishing it asks of the person.
    pub action: TaskAction,
    /// The person it is for, when it is for one.
    pub assignee_membership_id: Option<Uuid>,
    /// The role it is for, when it is for one.
    pub assignee_role_id: Option<Uuid>,
    /// The clinic's calendar day.
    pub local_date: Date,
    /// When it falls due.
    pub due_at: OffsetDateTime,
    /// Where it stands.
    pub status: OccurrenceStatus,
    /// When it was finished.
    pub completed_at: Option<OffsetDateTime>,
    /// Who finished it.
    pub completed_by: Option<Uuid>,
    /// That person's name.
    pub completed_by_name: Option<String>,
    /// What they wrote.
    pub note: Option<String>,
    /// For a `confirm_photos` task: the patients seen that day with a visit that has no photo.
    pub patients_without_photos_today: Option<i64>,
}

impl OccurrenceView {
    fn new(row: OccurrenceRow) -> Result<Self, AppError> {
        Ok(Self {
            id: row.id,
            template_id: row.template_id,
            title: row.title,
            action: TaskAction::parse(&row.action)
                .map_err(|_| AppError::Internal("unknown task action"))?,
            assignee_membership_id: row.assignee_membership_id,
            assignee_role_id: row.assignee_role_id,
            local_date: row.local_date,
            due_at: row.due_at,
            status: OccurrenceStatus::parse(&row.status)
                .map_err(|_| AppError::Internal("unknown task status"))?,
            completed_at: row.completed_at,
            completed_by: row.completed_by,
            completed_by_name: row.completed_by_name,
            note: row.note,
            patients_without_photos_today: None,
        })
    }
}

/// A person's tasks for a day.
#[derive(Debug, Clone)]
pub struct Mine {
    /// The clinic day.
    pub date: Date,
    /// Their tasks and their role's, soonest first, plus any still open from earlier.
    pub items: Vec<OccurrenceView>,
}

/// A task as the manager sees it.
#[derive(Debug, Clone)]
pub struct TemplateView {
    /// The stored row.
    pub row: TemplateRow,
}

impl TemplateView {
    /// The schedule columns as a domain schedule.
    ///
    /// # Errors
    /// [`AppError::Internal`] when the row breaks its own checks.
    pub fn schedule(&self) -> Result<Schedule, AppError> {
        schedule_of(&self.row)
    }
}

fn schedule_of(row: &TemplateRow) -> Result<Schedule, AppError> {
    let bad = || AppError::Internal("task schedule columns disagree");
    let kind = ScheduleKind::parse(&row.schedule_kind).map_err(|_| bad())?;
    let due_time = row.due_time.ok_or_else(bad);
    let starts_on = row.starts_on.ok_or_else(bad);
    Ok(match kind {
        ScheduleKind::Once => Schedule::Once {
            at: row.once_at.ok_or_else(bad)?,
        },
        ScheduleKind::Daily => Schedule::Daily {
            due_time: due_time?,
            starts_on: starts_on?,
            ends_on: row.ends_on,
        },
        ScheduleKind::EveryNDays => Schedule::EveryNDays {
            interval_days: u16::try_from(row.interval_days.ok_or_else(bad)?).map_err(|_| bad())?,
            due_time: due_time?,
            starts_on: starts_on?,
            ends_on: row.ends_on,
        },
        ScheduleKind::Weekdays => Schedule::Weekdays {
            days: Weekdays::new(u8::try_from(row.weekdays.ok_or_else(bad)?).map_err(|_| bad())?)
                .map_err(|_| bad())?,
            due_time: due_time?,
            starts_on: starts_on?,
            ends_on: row.ends_on,
        },
    })
}

/// When a task falls due, as received. Which fields apply depends on `kind`; the others are
/// ignored.
#[derive(Debug, Clone, Default)]
pub struct ScheduleInput {
    /// `once`, `daily`, `every_n_days` or `weekdays`.
    pub kind: Option<ScheduleKind>,
    /// `once`: the moment.
    pub once_at: Option<OffsetDateTime>,
    /// `every_n_days`: the gap, 2 to 365.
    pub interval_days: Option<u16>,
    /// `weekdays`: the ISO bitmask, Monday = 1.
    pub weekdays: Option<u8>,
    /// The clinic-local time of day.
    pub due_time: Option<Time>,
    /// The first day; today when left out.
    pub starts_on: Option<Date>,
    /// The last day.
    pub ends_on: Option<Date>,
}

fn build_schedule(input: &ScheduleInput, today: Date) -> Result<Schedule, AppError> {
    let kind = input
        .kind
        .ok_or_else(|| AppError::invalid("schedule", "kind is required"))?;
    let due_time = || {
        input
            .due_time
            .ok_or_else(|| AppError::invalid("due_time", "is required"))
    };
    let starts_on = input.starts_on.unwrap_or(today);
    Ok(match kind {
        ScheduleKind::Once => Schedule::Once {
            at: input
                .once_at
                .ok_or_else(|| AppError::invalid("once_at", "is required"))?,
        },
        ScheduleKind::Daily => Schedule::Daily {
            due_time: due_time()?,
            starts_on,
            ends_on: input.ends_on,
        },
        ScheduleKind::EveryNDays => Schedule::EveryNDays {
            interval_days: input
                .interval_days
                .ok_or_else(|| AppError::invalid("interval_days", "is required"))?,
            due_time: due_time()?,
            starts_on,
            ends_on: input.ends_on,
        },
        ScheduleKind::Weekdays => Schedule::Weekdays {
            days: Weekdays::new(
                input
                    .weekdays
                    .ok_or_else(|| AppError::invalid("weekdays", "is required"))?,
            )
            .map_err(invalid("weekdays"))?,
            due_time: due_time()?,
            starts_on,
            ends_on: input.ends_on,
        },
    })
}

/// Who a task is for, as received: exactly one of the two.
#[derive(Debug, Clone, Copy, Default)]
pub struct AssigneeInput {
    /// One member of the clinic.
    pub membership_id: Option<Uuid>,
    /// Everyone holding a role.
    pub role_id: Option<Uuid>,
}

impl AssigneeInput {
    const fn is_set(self) -> bool {
        self.membership_id.is_some() || self.role_id.is_some()
    }

    fn assignee(self) -> Result<Assignee, AppError> {
        match (self.membership_id, self.role_id) {
            (Some(member), None) => Ok(Assignee::Member(
                aarogyam_domain::ids::MembershipId::from_uuid(member),
            )),
            (None, Some(role)) => Ok(Assignee::Role(aarogyam_domain::ids::RoleId::from_uuid(
                role,
            ))),
            _ => Err(AppError::invalid(
                "assignee",
                "give exactly one of a member or a role",
            )),
        }
    }
}

/// A new task as received.
#[derive(Debug, Clone)]
pub struct NewTask {
    /// What is to be done.
    pub title: String,
    /// More detail.
    pub description: Option<String>,
    /// Who it is for.
    pub assignee: AssigneeInput,
    /// When it falls due.
    pub schedule: ScheduleInput,
    /// Minutes between reminders; none means the clinic's default.
    pub remind_every_minutes: Option<u16>,
    /// Reminders before the owner is told once more; 3 when left out.
    pub escalate_after: Option<u8>,
    /// What finishing it asks of the person; none when left out.
    pub action: Option<TaskAction>,
    /// Switched on; true when left out.
    pub active: Option<bool>,
}

/// A change to a task: fields left out stay as they are.
#[derive(Debug, Clone, Default)]
pub struct TaskChange {
    /// Title.
    pub title: Option<String>,
    /// Description; an empty one clears it.
    pub description: Option<String>,
    /// A new assignee (replaces the old one when either is given).
    pub assignee: AssigneeInput,
    /// A new schedule, replacing the old one entirely.
    pub schedule: Option<ScheduleInput>,
    /// Minutes between reminders; 0 goes back to the clinic's default.
    pub remind_every_minutes: Option<u16>,
    /// Reminders before escalating.
    pub escalate_after: Option<u8>,
    /// Action.
    pub action: Option<TaskAction>,
    /// Switch on or off. A standard task can only be switched off, never deleted.
    pub active: Option<bool>,
}

/// One line of materials used.
#[derive(Debug, Clone, Copy)]
pub struct UsageLine {
    /// The item.
    pub item_id: InventoryItemId,
    /// Units used.
    pub quantity: i64,
}

/// What finishing a task sends.
#[derive(Debug, Clone, Default)]
pub struct CompleteInput {
    /// A note, at most 300 characters, without patient names.
    pub note: Option<String>,
    /// The materials used; none (or an empty list) is allowed.
    pub usage: Vec<UsageLine>,
}

/// The history's filters.
#[derive(Debug, Clone, Copy, Default)]
pub struct HistoryFilter {
    /// First clinic day; 30 days before `to` when left out.
    pub from: Option<Date>,
    /// Last clinic day; today when left out.
    pub to: Option<Date>,
    /// A member: tasks given to them or their role, or that they finished.
    pub assignee: Option<Uuid>,
    /// One status.
    pub status: Option<OccurrenceStatus>,
    /// One task.
    pub template_id: Option<Uuid>,
}

/// A due date from the preview.
#[derive(Debug, Clone, Copy)]
pub struct DueDate {
    /// The clinic day.
    pub local_date: Date,
    /// The instant it falls due.
    pub due_at: OffsetDateTime,
}

// ------------------------------------------------------------------ the person's tasks

/// A person's tasks for `date` (the clinic's today when left out): given to them or to their
/// role, plus any still open from earlier days. A `confirm_photos` task carries the number of
/// patients seen that day whose visit has no photo.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.use`.
pub async fn mine(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    date: Option<Date>,
    now: OffsetDateTime,
) -> Result<Mine, AppError> {
    actor.require(Permission::TasksUse)?;
    let me = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        let day = match date {
            Some(day) => day,
            None => dal::clinic_day(tx.conn(), now).await?,
        };
        let role = dal::role_of(tx.conn(), me).await?;
        let rows = dal::mine(tx.conn(), me, role, day).await?;
        let mut items = Vec::with_capacity(rows.len());
        // The count is per clinic day, and almost always one day.
        let mut counted: Vec<(Date, i64)> = Vec::new();
        for row in rows {
            let wants_count = row.action == TaskAction::ConfirmPhotos.as_str();
            let local_date = row.local_date;
            let mut view = OccurrenceView::new(row)?;
            if wants_count {
                let count = if let Some((_, count)) = counted.iter().find(|(d, _)| *d == local_date)
                {
                    *count
                } else {
                    let count = dal::patients_without_photos(tx.conn(), local_date).await?;
                    counted.push((local_date, count));
                    count
                };
                view.patients_without_photos_today = Some(count);
            }
            items.push(view);
        }
        Ok(Mine { date: day, items })
    })
    .await
}

/// What finishing a task did.
#[derive(Debug, Clone)]
pub struct Completed {
    /// The occurrence as it is now.
    pub occurrence: OccurrenceView,
    /// True when this member had already finished it (nothing was recorded again).
    pub already_done: bool,
}

/// Finishes an occurrence for the caller, who must be the person it is for or hold the role it
/// is for. The first to finish closes it for everyone; finishing it again as the same person
/// changes nothing; anyone else then gets a conflict. Materials in `usage` come off the shelf
/// first-expiry-first-out in the same transaction, so a shortage cancels the whole completion,
/// and the occurrence's notices are marked handled.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.use`; [`AppError::NotFound`] for an unknown occurrence;
/// [`AppError::Forbidden`] when it is not the caller's; [`AppError::Conflict`] when someone else
/// finished it or it is no longer open, or the usable stock is short; [`AppError::Invalid`] for
/// a long note or a bad quantity.
pub async fn complete(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
    input: CompleteInput,
    now: OffsetDateTime,
) -> Result<Completed, AppError> {
    actor.require(Permission::TasksUse)?;
    let note = check_note(input.note.as_deref()).map_err(template_error)?;
    if input.usage.len() > MAX_USAGE_LINES {
        return Err(AppError::invalid("usage", "too many lines"));
    }
    let me = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::occurrence(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("task"))?;
        let role = dal::role_of(tx.conn(), me).await?;
        let mine = row.assignee_membership_id == Some(me)
            || (row.assignee_role_id.is_some() && row.assignee_role_id == role);
        if !mine {
            return Err(AppError::Forbidden("this task is not yours to complete"));
        }
        if row.status != OccurrenceStatus::Open.as_str() {
            return settled(row, me);
        }
        if !dal::complete(tx.conn(), id, me, note.as_deref(), now).await? {
            // Someone finished it between the read and the update.
            let row = dal::occurrence(tx.conn(), id)
                .await?
                .ok_or(AppError::NotFound("task"))?;
            return settled(row, me);
        }
        record_usage(tx, actor, id, &input.usage, now).await?;
        dal::handle_notices(tx.conn(), id, me, now).await?;
        let row = dal::occurrence(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("task"))?;
        Ok(Completed {
            occurrence: OccurrenceView::new(row)?,
            already_done: false,
        })
    })
    .await
}

/// The answer for an occurrence that is not open: done by the caller already is fine, anything
/// else conflicts.
fn settled(row: OccurrenceRow, me: Uuid) -> Result<Completed, AppError> {
    if row.status == OccurrenceStatus::Done.as_str() {
        if row.completed_by == Some(me) {
            return Ok(Completed {
                occurrence: OccurrenceView::new(row)?,
                already_done: true,
            });
        }
        return Err(AppError::Conflict("this task is already done"));
    }
    Err(AppError::Conflict("this task is no longer open"))
}

async fn record_usage(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    occurrence_id: Uuid,
    usage: &[UsageLine],
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let today = clinic_today(&actor.timezone, now);
    for line in usage {
        use_stock_in(
            tx,
            line.item_id,
            line.quantity,
            Some(USAGE_REASON),
            today,
            Some(occurrence_id),
        )
        .await?;
    }
    Ok(())
}

/// Opens a done or skipped occurrence again (a mistake, say). Stock already recorded for it
/// stays recorded. Opening one that is open already changes nothing.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`; [`AppError::NotFound`] for an unknown
/// occurrence; [`AppError::Conflict`] for one that was missed.
pub async fn reopen(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<OccurrenceView, AppError> {
    actor.require(Permission::TasksManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::occurrence(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("task"))?;
        if row.status == OccurrenceStatus::Missed.as_str() {
            return Err(AppError::Conflict("a missed task cannot be reopened"));
        }
        if row.status != OccurrenceStatus::Open.as_str() {
            dal::reopen(tx.conn(), id).await?;
        }
        let row = dal::occurrence(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("task"))?;
        OccurrenceView::new(row)
    })
    .await
}

// ------------------------------------------------------------------ the manager's tasks

/// The clinic's tasks, switched-on first.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`.
pub async fn templates(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<TemplateView>, AppError> {
    actor.require(Permission::TasksManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::templates(tx.conn()).await?;
        Ok(rows.into_iter().map(|row| TemplateView { row }).collect())
    })
    .await
}

/// One task.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`; [`AppError::NotFound`] for an unknown task.
pub async fn template(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<TemplateView, AppError> {
    actor.require(Permission::TasksManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::template(tx.conn(), id)
            .await?
            .map(|row| TemplateView { row })
            .ok_or(AppError::NotFound("task"))
    })
    .await
}

async fn check_assignee(tx: &mut ScopedTx, assignee: Assignee) -> Result<(), AppError> {
    let found = match assignee {
        Assignee::Member(member) => dal::active_member_exists(tx.conn(), member.uuid()).await?,
        Assignee::Role(role) => dal::role_exists(tx.conn(), role.uuid()).await?,
    };
    if found {
        Ok(())
    } else {
        Err(AppError::invalid(
            "assignee",
            "no such active member or role in this clinic",
        ))
    }
}

fn values<'a>(
    input: &'a TemplateInput,
    description: Option<&'a str>,
    active: bool,
) -> TemplateValues<'a> {
    let columns = input.schedule.columns();
    let (membership, role) = match input.assignee {
        Assignee::Member(member) => (Some(member.uuid()), None),
        Assignee::Role(role) => (None, Some(role.uuid())),
    };
    TemplateValues {
        title: &input.title,
        description,
        assignee_membership_id: membership,
        assignee_role_id: role,
        schedule_kind: columns.kind.as_str(),
        once_at: columns.once_at,
        interval_days: columns.interval_days.map(i32::from),
        weekdays: columns.weekdays.map(i16::from),
        due_time: columns.due_time,
        starts_on: columns.starts_on,
        ends_on: columns.ends_on,
        remind_every_minutes: input.remind_every_minutes.map(i32::from),
        escalate_after: i32::from(input.escalate_after),
        action: input.action.as_str(),
        active,
    }
}

/// Makes a task.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`; [`AppError::Invalid`] for a field that fails its
/// check (a one-off task in the past, a missing member, ...).
pub async fn create_template(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    new: NewTask,
    now: OffsetDateTime,
) -> Result<TemplateView, AppError> {
    actor.require(Permission::TasksManage)?;
    let assignee = new.assignee.assignee()?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = dal::clinic_day(tx.conn(), now).await?;
        let input = TemplateInput {
            title: new.title.clone(),
            description: new.description.clone(),
            assignee,
            schedule: build_schedule(&new.schedule, today)?,
            remind_every_minutes: new.remind_every_minutes.filter(|minutes| *minutes != 0),
            escalate_after: new
                .escalate_after
                .unwrap_or(aarogyam_domain::tasks::DEFAULT_ESCALATE_AFTER),
            action: new.action.unwrap_or(TaskAction::Plain),
        }
        .validate(now)
        .map_err(template_error)?
        .into_inner();
        check_assignee(tx, assignee).await?;
        let id = Uuid::now_v7();
        dal::insert_template(
            tx.conn(),
            id,
            &values(
                &input,
                input.description.as_deref(),
                new.active.unwrap_or(true),
            ),
        )
        .await?;
        dal::template(tx.conn(), id)
            .await?
            .map(|row| TemplateView { row })
            .ok_or(AppError::NotFound("task"))
    })
    .await
}

/// Changes a task. Switching it back on, or changing when it falls due, makes it count from
/// that moment: nothing is made for a time already past.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`; [`AppError::NotFound`] for an unknown task;
/// [`AppError::Invalid`] for a field that fails its check.
pub async fn update_template(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
    change: TaskChange,
    now: OffsetDateTime,
) -> Result<TemplateView, AppError> {
    actor.require(Permission::TasksManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::template(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("task"))?;
        let today = dal::clinic_day(tx.conn(), now).await?;
        let current = schedule_of(&row)?;
        let (schedule, check_at) = match &change.schedule {
            Some(input) => (build_schedule(input, today)?, now),
            // The schedule is not being changed, so a one-off task that has fallen due is not
            // "in the past" for the purpose of renaming or switching it off.
            None => (
                current,
                match current {
                    Schedule::Once { at } => now.min(at - Duration::seconds(1)),
                    _ => now,
                },
            ),
        };
        let assignee = if change.assignee.is_set() {
            let assignee = change.assignee.assignee()?;
            check_assignee(tx, assignee).await?;
            assignee
        } else if let Some(member) = row.assignee_membership_id {
            Assignee::Member(aarogyam_domain::ids::MembershipId::from_uuid(member))
        } else if let Some(role) = row.assignee_role_id {
            Assignee::Role(aarogyam_domain::ids::RoleId::from_uuid(role))
        } else {
            return Err(AppError::Internal("task has no assignee"));
        };
        let remind = match change.remind_every_minutes {
            Some(0) => None,
            Some(minutes) => Some(minutes),
            None => row
                .remind_every_minutes
                .and_then(|minutes| u16::try_from(minutes).ok()),
        };
        let input = TemplateInput {
            title: change.title.clone().unwrap_or(row.title.clone()),
            description: match &change.description {
                Some(text) => Some(text.clone()),
                None => row.description.clone(),
            },
            assignee,
            schedule,
            remind_every_minutes: remind,
            escalate_after: change
                .escalate_after
                .or_else(|| u8::try_from(row.escalate_after).ok())
                .unwrap_or(aarogyam_domain::tasks::DEFAULT_ESCALATE_AFTER),
            action: match change.action {
                Some(action) => action,
                None => TaskAction::parse(&row.action)
                    .map_err(|_| AppError::Internal("unknown task action"))?,
            },
        }
        .validate(check_at)
        .map_err(template_error)?
        .into_inner();
        let active = change.active.unwrap_or(row.active);
        dal::update_template(
            tx.conn(),
            id,
            &values(&input, input.description.as_deref(), active),
        )
        .await?;
        dal::template(tx.conn(), id)
            .await?
            .map(|row| TemplateView { row })
            .ok_or(AppError::NotFound("task"))
    })
    .await
}

/// Deletes a task; the days already made stay in the history. A standard task cannot be
/// deleted, only switched off.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`; [`AppError::NotFound`] for an unknown task;
/// [`AppError::Conflict`] for a standard task.
pub async fn delete_template(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<(), AppError> {
    actor.require(Permission::TasksManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::delete_template(tx.conn(), id).await? {
            return Ok(());
        }
        match dal::template(tx.conn(), id).await? {
            None => Err(AppError::NotFound("task")),
            Some(_) => Err(AppError::Conflict(
                "a standard task cannot be deleted, only switched off",
            )),
        }
    })
    .await
}

/// The next five times a task falls due, from the same function the generator uses.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`; [`AppError::NotFound`] for an unknown task.
pub async fn preview(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
    now: OffsetDateTime,
) -> Result<Vec<DueDate>, AppError> {
    actor.require(Permission::TasksManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::template(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("task"))?;
        let rows = dal::preview(tx.conn(), id, now, PREVIEW_COUNT).await?;
        Ok(rows
            .into_iter()
            .map(|(local_date, due_at)| DueDate { local_date, due_at })
            .collect())
    })
    .await
}

/// Occurrences by clinic day, newest first.
///
/// # Errors
/// [`AppError::Denied`] without `tasks.manage`; [`AppError::Invalid`] for a range that is
/// backwards or longer than 92 days.
pub async fn history(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    filter: HistoryFilter,
    now: OffsetDateTime,
) -> Result<Vec<OccurrenceView>, AppError> {
    actor.require(Permission::TasksManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let to = match filter.to {
            Some(day) => day,
            None => dal::clinic_day(tx.conn(), now).await?,
        };
        let from = filter.from.unwrap_or(to - Duration::days(30));
        if from > to {
            return Err(AppError::invalid("from", "is after to"));
        }
        if (to - from).whole_days() > HISTORY_DAYS {
            return Err(AppError::invalid("from", "the range is at most 92 days"));
        }
        let rows = dal::history(
            tx.conn(),
            from,
            to,
            filter.assignee,
            filter.status.map(OccurrenceStatus::as_str),
            filter.template_id,
            HISTORY_LIMIT,
        )
        .await?;
        rows.into_iter().map(OccurrenceView::new).collect()
    })
    .await
}
