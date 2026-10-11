-- Staff to-dos (docs/decisions.md, "Staff operations"): the clinic's recurring tasks and what
-- each day's run of them produced.
--   * task_templates: what is to be done, by whom (one person or everyone holding a role) and
--     when: once, daily, every N days or on chosen weekdays, at a clinic-local time. A template is
--     switched off, never removed; the standard ones (is_default, default_key) cannot even be
--     soft-deleted. activated_at is when the template last started to count (created, switched
--     back on, or its schedule changed): the generator never makes an occurrence due before it.
--   * task_occurrences: one row per template and clinic day, made by app.materialize_task_occurrences
--     (0662). It snapshots the title, action and assignee, so editing a template never rewrites
--     history. A task for a role is one shared row: the first eligible person to finish it closes it.
-- The tables hold no patient data. A note is free text kept out of the change history and the
-- screens warn against putting a patient's name in it; the rows are kept 3 years from the time
-- they fell due (retention class task_occurrences).
-- The foreign key from staff_notifications.task_occurrence_id (0660) is added here.
set local lock_timeout = '5s';

create table aarogyam.task_templates (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  title text not null check (char_length(title) between 1 and 120 and title = btrim(title)),
  description text check (description is null or char_length(description) <= 500),
  assignee_membership_id uuid,
  assignee_role_id uuid,
  schedule_kind text not null check (schedule_kind in ('once', 'daily', 'every_n_days', 'weekdays')),
  -- once: the moment it falls due. The other kinds fall due at due_time, clinic local time.
  once_at timestamptz,
  -- every_n_days: counted from starts_on, which is itself a due day.
  interval_days int check (interval_days between 2 and 365),
  -- weekdays: ISO bitmask, Monday = 1, Tuesday = 2, ... Sunday = 64.
  weekdays smallint check (weekdays between 1 and 127),
  due_time time,
  starts_on date,
  ends_on date,
  -- Empty means the clinic's default (org_settings.staff_ops, 60 minutes).
  remind_every_minutes int check (remind_every_minutes between 15 and 1440),
  -- Reminders sent before the owner is told once more; 0 means never.
  escalate_after int not null default 3 check (escalate_after between 0 and 24),
  action text not null default 'none' check (action in ('none', 'record_usage', 'confirm_photos')),
  active boolean not null default true,
  activated_at timestamptz not null default now(),
  is_default boolean not null default false,
  default_key text check (default_key ~ '^[a-z_]{2,40}$'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  foreign key (org_id, assignee_membership_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, assignee_role_id) references aarogyam.roles (org_id, id),
  check (num_nonnulls(assignee_membership_id, assignee_role_id) = 1),
  check (is_default = (default_key is not null)),
  check (not is_default or deleted_at is null),
  check ((schedule_kind = 'once') = (once_at is not null)),
  check ((schedule_kind = 'once') = (due_time is null)),
  check ((schedule_kind = 'once') = (starts_on is null)),
  check (schedule_kind <> 'once' or ends_on is null),
  check ((schedule_kind = 'every_n_days') = (interval_days is not null)),
  check ((schedule_kind = 'weekdays') = (weekdays is not null)),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index task_templates_default_key on aarogyam.task_templates (org_id, default_key)
  where default_key is not null;
create index task_templates_active on aarogyam.task_templates (org_id, active) where deleted_at is null;
create index task_templates_assignee_membership on aarogyam.task_templates (org_id, assignee_membership_id)
  where assignee_membership_id is not null;
create index task_templates_assignee_role on aarogyam.task_templates (org_id, assignee_role_id)
  where assignee_role_id is not null;
comment on table aarogyam.task_templates is 'sensitivity=internal offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.task_templates', 'soft_delete');
insert into audit.audit_config (table_name, exclude, mask, metadata_only) values
  ('aarogyam.task_templates', '{}', '{}', false);

-- A template that is switched back on, or whose schedule changes, counts from that moment: the
-- generator never makes an occurrence due before activated_at, so editing a time to earlier today
-- or reviving an old task does not fire it for something already past.
create function app.task_template_activated() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if (new.active and not old.active)
       or (row(new.schedule_kind, new.once_at, new.interval_days, new.weekdays, new.due_time,
               new.starts_on)
           is distinct from row(old.schedule_kind, old.once_at, old.interval_days, old.weekdays,
                                old.due_time, old.starts_on)) then
      new.activated_at := now();
    end if;
    return new;
  end
  $$;
create trigger task_template_activated
  before update of active, schedule_kind, once_at, interval_days, weekdays, due_time, starts_on
  on aarogyam.task_templates
  for each row execute function app.task_template_activated();

create table aarogyam.task_occurrences (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  template_id uuid not null,
  -- Snapshots of the template when the occurrence was made.
  title text not null check (char_length(title) between 1 and 120),
  action text not null check (action in ('none', 'record_usage', 'confirm_photos')),
  assignee_membership_id uuid,
  assignee_role_id uuid,
  local_date date not null,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'skipped', 'missed')),
  completed_at timestamptz,
  completed_by uuid,
  note text check (note is null or char_length(note) <= 300),
  reminder_count int not null default 0 check (reminder_count >= 0),
  last_reminded_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, template_id) references aarogyam.task_templates (org_id, id),
  foreign key (org_id, assignee_membership_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, assignee_role_id) references aarogyam.roles (org_id, id),
  foreign key (org_id, completed_by) references aarogyam.memberships (org_id, id),
  check (num_nonnulls(assignee_membership_id, assignee_role_id) = 1),
  -- Finished (done or skipped) means a time and a person; open and missed mean neither.
  check ((status in ('done', 'skipped')) = (completed_at is not null)),
  check ((completed_at is not null) = (completed_by is not null)),
  -- One occurrence per template and clinic day, and per due instant.
  unique (org_id, template_id, local_date),
  unique (org_id, template_id, due_at)
);
create index task_occurrences_membership on aarogyam.task_occurrences (org_id, assignee_membership_id, due_at desc)
  where assignee_membership_id is not null;
create index task_occurrences_role on aarogyam.task_occurrences (org_id, assignee_role_id, due_at desc)
  where assignee_role_id is not null;
create index task_occurrences_open on aarogyam.task_occurrences (org_id, due_at) where status = 'open';
create index task_occurrences_template on aarogyam.task_occurrences (org_id, template_id, due_at desc);
create index task_occurrences_completed_by on aarogyam.task_occurrences (org_id, completed_by)
  where completed_by is not null;
comment on table aarogyam.task_occurrences is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.task_occurrences', 'mutable');
-- The reminder counters change on every nudge and say nothing a reader needs; the note is free
-- text that might name someone.
insert into audit.audit_config (table_name, exclude, mask, metadata_only) values
  ('aarogyam.task_occurrences', '{reminder_count,last_reminded_at,note}', '{}', false);

alter table aarogyam.staff_notifications
  add constraint staff_notifications_task_occurrence_fk
    foreign key (org_id, task_occurrence_id) references aarogyam.task_occurrences (org_id, id)
    not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_task_occurrence_fk;
