import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { apiErrorOf, taskId, taskStatus, unwrap, type ApiClient, type Task, type TaskId, type TaskOccurrence, type TaskSchedule } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Button, ChipFilterGroup, DateInput, Dialog, Field, Select, Switch, TextArea, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { Empty, MkCard, Segments, StatusChip, Toggle, type ChipTone } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { SortHeader } from "../../components/sort-header.js";
import { useSortable, type SortColumn } from "../../components/use-sortable.js";
import { localDateHour, localInstant, todayIn } from "../../lib/time.js";
import { useRoles, useStaff } from "../../queries.js";

// ---------------------------------------------------------------------------------------------
// Data

function useTaskKeys() {
  const { access } = useClinic();
  return ["tasks", access.org_id] as const;
}

function useTasks() {
  const { api } = useClinic();
  const key = useTaskKeys();
  return useQuery({ queryKey: [...key, "list"], queryFn: ({ signal }) => unwrap(api.listTasks({ signal })) });
}

function useTaskPreview(id: TaskId | undefined, version: string) {
  const { api } = useClinic();
  const key = useTaskKeys();
  return useQuery({
    queryKey: [...key, "preview", id, version],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no task")) : unwrap(api.previewTask(id, { signal }))),
    enabled: id !== undefined,
  });
}

interface HistoryFilter {
  templateId: string;
  assignee: string;
  status: string;
}

function useTaskHistory(filter: HistoryFilter) {
  const { api } = useClinic();
  const key = useTaskKeys();
  return useQuery({
    queryKey: [...key, "history", filter],
    queryFn: ({ signal }) =>
      unwrap(
        api.listTaskHistory(
          {
            ...(filter.templateId === "" ? {} : { templateId: taskId.parse(filter.templateId) }),
            ...(filter.assignee === "" ? {} : { assignee: filter.assignee }),
            ...(filter.status === "" ? {} : { status: taskStatus.parse(filter.status) }),
          },
          { signal },
        ),
      ),
  });
}

function useTaskMutations() {
  const { api } = useClinic();
  const queryClient = useQueryClient();
  const key = useTaskKeys();
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const create = useMutation({ mutationFn: (input: Parameters<typeof api.createTask>[0]) => unwrap(api.createTask(input)), onSuccess: refresh });
  const change = useMutation({ mutationFn: ({ id, changes }: { id: TaskId; changes: Parameters<ApiClient["updateTask"]>[1] }) => unwrap(api.updateTask(id, changes)), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: TaskId) => unwrap(api.deleteTask(id)), onSuccess: refresh });
  return { create, change, remove };
}

// ---------------------------------------------------------------------------------------------
// Wording

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** `08:30` → `8:30 am`. */
function clock(hm: string | null | undefined): string {
  if (hm === null || hm === undefined || hm === "") return "";
  const [h = 0, m = 0] = hm.split(":").map((p) => Number.parseInt(p, 10));
  return `${String(h % 12 === 0 ? 12 : h % 12)}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function whenOf(iso: string, timeZone: string): string {
  const { date, hour } = localDateHour(iso, timeZone);
  const hm = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
  return `${shortDate(date)}, ${clock(hm)}`;
}

/** A schedule in plain words. */
function describeSchedule(schedule: TaskSchedule, timeZone: string): string {
  const at = clock(schedule.due_time);
  switch (schedule.kind) {
    case "once":
      return schedule.once_at === null || schedule.once_at === undefined ? "Once" : `Once, ${whenOf(schedule.once_at, timeZone)}`;
    case "daily":
      return `Every day at ${at}`;
    case "every_n_days":
      return `Every ${String(schedule.interval_days ?? "")} days at ${at}`;
    case "weekdays": {
      const days = [...(schedule.weekdays ?? [])].sort().map((d) => DAYS[d - 1] ?? "");
      return `${days.join(", ")} at ${at}`;
    }
    default:
      return "No schedule";
  }
}

const assigneeOf = (task: Task): string => task.assignee_name ?? task.assignee_role_name ?? "Nobody yet";

const REMIND_OPTIONS = [
  { value: "", label: "Clinic default" },
  { value: "30", label: "Every 30 min" },
  { value: "60", label: "Every hour" },
  { value: "120", label: "Every 2 hours" },
];

const STATUS_LABEL: Readonly<Record<string, string>> = { done: "Done", missed: "Missed", skipped: "Skipped", open: "Open" };
const STATUS_TONE: Readonly<Record<string, ChipTone>> = { done: "ready", missed: "noshow", skipped: "done", open: "waiting" };

export const NOTE_WARNING = "Don't write patient names here";

// ---------------------------------------------------------------------------------------------
// Panel

/** Settings → Tasks: the clinic's standard tasks, its own recurring tasks, and what happened each day. Needs `tasks.manage`. */
export function TasksPanel() {
  const { session } = useClinic();
  const timeZone = session.clinic.timezone;
  const tasks = useTasks();
  const mutations = useTaskMutations();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ task?: Task } | undefined>(undefined);
  const [removing, setRemoving] = useState<Task | undefined>(undefined);

  if (tasks.isPending) return <SkeletonRows count={5} tall label="Loading tasks" />;
  if (tasks.isError) return <ApiErrorNotice title="Couldn't load tasks" error={tasks.error} onRetry={() => void tasks.refetch()} />;

  const defaults = tasks.data.items.filter((t) => t.is_default);
  const custom = tasks.data.items.filter((t) => !t.is_default);

  const switchTask = (task: Task, active: boolean) => {
    mutations.change.mutate(
      { id: task.id, changes: { active } },
      {
        onSuccess: () => {
          toast.show({ title: `${task.title} is ${active ? "on" : "off"}`, tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't change this task. Please try again.", tone: "danger" });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <MkCard title="Standard tasks" hint="Every clinic gets these. Switch one off if you don't need it.">
        <ul aria-label="Standard tasks" className="mt-2 flex list-none flex-col p-0">
          {defaults.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-4 border-t border-[var(--rule)] py-3 first:border-t-0">
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold text-[var(--ink)]">{task.title}</p>
                <p className="m-0 text-[12.5px] text-[var(--muted)]">
                  {describeSchedule(task.schedule, timeZone)} · {assigneeOf(task)}
                </p>
              </div>
              <Toggle
                label={`${task.title} on`}
                checked={task.active}
                disabled={mutations.change.isPending}
                onChange={(next) => {
                  switchTask(task, next);
                }}
              />
            </li>
          ))}
        </ul>
      </MkCard>

      <MkCard
        title="Your own tasks"
        hint="Anything your team should do on a schedule."
        action={
          <Button
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setDialog({});
            }}
          >
            New task
          </Button>
        }
      >
        {custom.length === 0 ? (
          <Empty art="notes" title="No tasks of your own yet">
            Add one, such as "Order gloves" every Monday.
          </Empty>
        ) : (
          <ul aria-label="Your own tasks" className="mt-2 flex list-none flex-col p-0">
            {custom.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 border-t border-[var(--rule)] py-3 first:border-t-0">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold text-[var(--ink)]">
                    {task.title}
                    {task.active ? null : <span className="ml-2 text-xs font-medium text-[var(--muted)]">Off</span>}
                  </p>
                  <p className="m-0 text-[12.5px] text-[var(--muted)]">
                    {describeSchedule(task.schedule, timeZone)} · {assigneeOf(task)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="secondary"
                    icon={<Pencil aria-hidden="true" className="size-4" />}
                    aria-label={`Edit ${task.title}`}
                    onClick={() => {
                      setDialog({ task });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Trash2 aria-hidden="true" className="size-4" />}
                    aria-label={`Delete ${task.title}`}
                    onClick={() => {
                      setRemoving(task);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </MkCard>

      <HistoryCard tasks={tasks.data.items} />

      <TaskDialog
        dialog={dialog}
        timeZone={timeZone}
        onClose={() => {
          setDialog(undefined);
        }}
      />
      <Dialog
        open={removing !== undefined}
        onOpenChange={(next) => {
          if (!next) setRemoving(undefined);
        }}
        title={`Delete "${removing?.title ?? ""}"?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRemoving(undefined);
              }}
            >
              Keep it
            </Button>
            <Button
              disabled={mutations.remove.isPending}
              onClick={() => {
                if (removing === undefined) return;
                mutations.remove.mutate(removing.id, {
                  onSuccess: () => {
                    toast.show({ title: `Deleted ${removing.title}`, tone: "success" });
                    setRemoving(undefined);
                  },
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't delete this task.", tone: "danger" });
                  },
                });
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="m-0 text-sm">Staff will stop getting it. What was already done stays in the history.</p>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// History

const HISTORY_COLUMNS: readonly SortColumn<TaskOccurrence>[] = [
  { id: "date", kind: "date", value: (o) => o.local_date },
  { id: "task", kind: "text", value: (o) => o.title },
  { id: "who", kind: "text", value: (o) => o.completed_by_name },
  { id: "status", kind: "text", value: (o) => o.status },
  { id: "note", kind: "text", value: (o) => o.note },
];

function HistoryCard({ tasks }: { tasks: readonly Task[] }) {
  const staff = useStaff();
  const [filter, setFilter] = useState<HistoryFilter>({ templateId: "", assignee: "", status: "" });
  const history = useTaskHistory(filter);
  const rows = history.data?.items ?? [];
  const sortable = useSortable(rows, HISTORY_COLUMNS);

  const taskOptions = [{ value: "", label: "All tasks" }, ...tasks.map((t) => ({ value: t.id, label: t.title }))];
  const personOptions = [{ value: "", label: "Everyone" }, ...(staff.data?.members ?? []).map((m) => ({ value: m.id, label: m.display_name }))];
  const statusOptions = [
    { value: "", label: "Any result" },
    { value: "done", label: "Done" },
    { value: "missed", label: "Missed" },
    { value: "skipped", label: "Skipped" },
    { value: "open", label: "Still open" },
  ];

  return (
    <MkCard title="History" hint={`The last 30 days. Notes are written by staff when they finish a task. ${NOTE_WARNING}.`}>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Task" hideLabel>
          <Select
            options={taskOptions}
            value={filter.templateId}
            onValueChange={(templateId) => {
              setFilter((f) => ({ ...f, templateId }));
            }}
          />
        </Field>
        <Field label="Person" hideLabel>
          <Select
            options={personOptions}
            value={filter.assignee}
            onValueChange={(assignee) => {
              setFilter((f) => ({ ...f, assignee }));
            }}
          />
        </Field>
        <Field label="Result" hideLabel>
          <Select
            options={statusOptions}
            value={filter.status}
            onValueChange={(status) => {
              setFilter((f) => ({ ...f, status }));
            }}
          />
        </Field>
      </div>
      <div className="mt-3">
        {history.isError ? (
          <ApiErrorNotice title="Couldn't load the history" error={history.error} onRetry={() => void history.refetch()} />
        ) : history.isPending ? (
          <SkeletonRows count={4} label="Loading the history" />
        ) : rows.length === 0 ? (
          <Empty art="clear" title="Nothing to show">
            No tasks match these filters in the last 30 days.
          </Empty>
        ) : (
          <div className="mk-tablewrap">
            <table className="mk-table">
              <caption className="mk-sr">Task history</caption>
              <thead>
                <tr>
                  <SortHeader id="date" sortable={sortable}>
                    Date
                  </SortHeader>
                  <SortHeader id="task" sortable={sortable}>
                    Task
                  </SortHeader>
                  <SortHeader id="who" sortable={sortable}>
                    Done by
                  </SortHeader>
                  <SortHeader id="status" sortable={sortable}>
                    Result
                  </SortHeader>
                  <SortHeader id="note" sortable={sortable}>
                    Note
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {sortable.rows.map((o) => (
                  <tr key={o.id}>
                    <td>{shortDate(o.local_date)}</td>
                    <td>{o.title}</td>
                    <td>{o.completed_by_name ?? "—"}</td>
                    <td>
                      <StatusChip tone={STATUS_TONE[o.status] ?? "done"}>{STATUS_LABEL[o.status] ?? o.status}</StatusChip>
                    </td>
                    <td>{o.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MkCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Create / edit

type Kind = "once" | "daily" | "every_n_days" | "weekdays";

interface Values {
  title: string;
  description: string;
  who: "person" | "role";
  person: string;
  role: string;
  kind: Kind;
  date: string;
  time: string;
  interval: string;
  weekdays: readonly string[];
  remind: string;
  escalate: string;
  active: boolean;
}

const KIND_OPTIONS = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Every day" },
  { value: "every_n_days", label: "Every few days" },
  { value: "weekdays", label: "Chosen days" },
] as const;

const WEEKDAY_OPTIONS = DAYS.map((label, index) => ({ value: String(index + 1), label }));

function emptyValues(today: string): Values {
  return { title: "", description: "", who: "role", person: "", role: "", kind: "daily", date: today, time: "09:00", interval: "2", weekdays: ["1", "2", "3", "4", "5"], remind: "", escalate: "3", active: true };
}

function toValues(task: Task, timeZone: string, today: string): Values {
  const schedule = task.schedule;
  let date = today;
  let time = schedule.due_time ?? "09:00";
  if (schedule.kind === "once" && schedule.once_at !== null && schedule.once_at !== undefined) {
    const local = localDateHour(schedule.once_at, timeZone);
    date = local.date;
    time = `${String(Math.floor(local.hour)).padStart(2, "0")}:${String(Math.round((local.hour % 1) * 60)).padStart(2, "0")}`;
  }
  const kind = schedule.kind ?? "daily";
  return {
    title: task.title,
    description: task.description ?? "",
    who: task.assignee_membership_id === null || task.assignee_membership_id === undefined ? "role" : "person",
    person: task.assignee_membership_id ?? "",
    role: task.assignee_role_id ?? "",
    kind,
    date,
    time,
    interval: String(schedule.interval_days ?? 2),
    weekdays: (schedule.weekdays ?? [1, 2, 3, 4, 5]).map(String),
    remind: task.remind_every_minutes === null || task.remind_every_minutes === undefined ? "" : String(task.remind_every_minutes),
    escalate: String(task.escalate_after),
    active: task.active,
  };
}

/** The schedule the form describes, or the reason it can't be sent yet. */
function scheduleOf(values: Values, timeZone: string, existing: TaskSchedule | undefined): { schedule: TaskSchedule } | { error: string } {
  if (values.time === "") return { error: "Choose a time." };
  if (values.kind === "once") {
    if (values.date === "") return { error: "Choose a date." };
    return { schedule: { kind: "once", once_at: localInstant(values.date, values.time, timeZone) } };
  }
  // Keep the days the task already runs between, so editing the time doesn't restart it.
  const bounds = { ...(existing?.starts_on === undefined || existing.starts_on === null ? {} : { starts_on: existing.starts_on }), ...(existing?.ends_on === undefined || existing.ends_on === null ? {} : { ends_on: existing.ends_on }) };
  if (values.kind === "daily") return { schedule: { kind: "daily", due_time: values.time, ...bounds } };
  if (values.kind === "every_n_days") {
    const interval = Number.parseInt(values.interval, 10);
    if (!Number.isInteger(interval) || interval < 2 || interval > 365) return { error: "Choose between 2 and 365 days." };
    return { schedule: { kind: "every_n_days", interval_days: interval, due_time: values.time, ...bounds } };
  }
  if (values.weekdays.length === 0) return { error: "Choose at least one day of the week." };
  return { schedule: { kind: "weekdays", weekdays: values.weekdays.map(Number).sort(), due_time: values.time, ...bounds } };
}

function TaskDialog({ dialog, timeZone, onClose }: { dialog: { task?: Task } | undefined; timeZone: string; onClose: () => void }) {
  const mutations = useTaskMutations();
  const toast = useToast();
  const staff = useStaff();
  const roles = useRoles();
  const today = todayIn(timeZone);
  const task = dialog?.task;
  const open = dialog !== undefined;
  const [values, setValues] = useState<Values>(() => emptyValues(today));
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string>();

  // Loads the chosen task into the form each time a different (or a new) one opens.
  const key = task?.id ?? "new";
  if (open && loadedFor !== key) {
    setValues(task === undefined ? emptyValues(today) : toValues(task, timeZone, today));
    setLoadedFor(key);
  }
  const preview = useTaskPreview(task?.id, task?.updated_at ?? "");

  const set = (patch: Partial<Values>) => {
    setValues((prev) => ({ ...prev, ...patch }));
  };
  const close = () => {
    onClose();
    setErrors({});
    setFormError(undefined);
    setLoadedFor(undefined);
  };

  const personOptions = [{ value: "", label: "Choose a person" }, ...(staff.data?.members ?? []).filter((m) => m.status === "active").map((m) => ({ value: m.id, label: m.display_name }))];
  const roleChoices = new Map<string, string>((roles.data?.items ?? []).map((r) => [r.id, r.name]));
  if (task?.assignee_role_id !== undefined && task.assignee_role_id !== null) roleChoices.set(task.assignee_role_id, task.assignee_role_name ?? task.assignee_role_id);
  const roleOptions = [{ value: "", label: "Choose a role" }, ...[...roleChoices].map(([value, label]) => ({ value, label }))];
  const remindOptions = REMIND_OPTIONS.some((o) => o.value === values.remind) ? REMIND_OPTIONS : [...REMIND_OPTIONS, { value: values.remind, label: `Every ${values.remind} min` }];

  const submit = () => {
    const found: Partial<Record<string, string>> = {};
    const title = values.title.trim();
    if (title === "") found.title = "Give the task a name.";
    if (values.who === "person" && values.person === "") found.assignee = "Choose who it is for.";
    if (values.who === "role" && values.role === "") found.assignee = "Choose who it is for.";
    const built = scheduleOf(values, timeZone, task?.schedule);
    if ("error" in built) found.schedule = built.error;
    const escalate = Number.parseInt(values.escalate, 10);
    if (!Number.isInteger(escalate) || escalate < 0 || escalate > 24) found.escalate = "Enter a number from 0 to 24.";
    if (Object.keys(found).length > 0 || !("schedule" in built)) {
      setErrors(found);
      return;
    }
    setErrors({});
    setFormError(undefined);
    const assignee = values.who === "person" ? { assignee_membership_id: values.person } : { assignee_role_id: values.role };
    const remind = values.remind === "" ? null : Number.parseInt(values.remind, 10);
    const onError = (thrown: unknown) => {
      const apiError = apiErrorOf(thrown);
      const field = apiError?.field;
      if (field !== undefined && ["title", "description", "assignee", "escalate_after", "once_at", "due_time", "interval_days", "weekdays", "ends_on"].includes(field)) {
        const slot = field === "escalate_after" ? "escalate" : ["once_at", "due_time", "interval_days", "weekdays", "ends_on"].includes(field) ? "schedule" : field;
        setErrors({ [slot]: apiError?.message ?? "Check this field." });
      } else {
        setFormError(apiError?.message ?? "Couldn't save this task. Please try again.");
      }
    };
    if (task === undefined) {
      mutations.create.mutate(
        {
          title,
          ...(values.description.trim() === "" ? {} : { description: values.description.trim() }),
          ...assignee,
          schedule: built.schedule,
          ...(remind === null ? {} : { remind_every_minutes: remind }),
          escalate_after: escalate,
          active: values.active,
        },
        {
          onSuccess: () => {
            toast.show({ title: `Added ${title}`, tone: "success" });
            close();
          },
          onError,
        },
      );
    } else {
      mutations.change.mutate(
        {
          id: task.id,
          changes: {
            title,
            description: values.description.trim(),
            ...(values.who === "person" ? { assignee_membership_id: values.person } : { assignee_role_id: values.role }),
            schedule: built.schedule,
            remind_every_minutes: remind ?? 0,
            escalate_after: escalate,
            active: values.active,
          },
        },
        {
          onSuccess: () => {
            toast.show({ title: `Saved ${title}`, tone: "success" });
            close();
          },
          onError,
        },
      );
    }
  };

  const pending = mutations.create.isPending || mutations.change.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={task === undefined ? "New task" : "Edit task"}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What should be done?" required error={errors.title}>
          <TextInput
            value={values.title}
            maxLength={120}
            onChange={(event) => {
              set({ title: event.currentTarget.value });
            }}
          />
        </Field>
        <Field label="More detail" hint={`Optional. ${NOTE_WARNING}.`}>
          <TextArea
            value={values.description}
            maxLength={500}
            rows={2}
            onChange={(event) => {
              set({ description: event.currentTarget.value });
            }}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm font-semibold">Who is it for?</p>
          <Segments
            label="Give it to"
            options={[
              { value: "role", label: "A role" },
              { value: "person", label: "A person" },
            ]}
            value={values.who}
            onChange={(who) => {
              set({ who });
            }}
          />
          {values.who === "role" ? (
            <Field label="Role" hint="Whoever in this role finishes it first closes it for everyone." error={errors.assignee}>
              <Select
                options={roleOptions}
                value={values.role}
                onValueChange={(role) => {
                  set({ role });
                }}
              />
            </Field>
          ) : (
            <Field label="Person" error={errors.assignee}>
              <Select
                options={personOptions}
                value={values.person}
                onValueChange={(person) => {
                  set({ person });
                }}
              />
            </Field>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Field label="How often?" error={errors.schedule}>
            <Select
              options={KIND_OPTIONS}
              value={values.kind}
              onValueChange={(kind) => {
                set({ kind });
              }}
            />
          </Field>
          {values.kind === "every_n_days" ? (
            <Field label="Every how many days?">
              <TextInput
                type="number"
                min={2}
                max={365}
                inputMode="numeric"
                value={values.interval}
                onChange={(event) => {
                  set({ interval: event.currentTarget.value });
                }}
              />
            </Field>
          ) : null}
          {values.kind === "weekdays" ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-sm font-semibold">On these days</p>
              <ChipFilterGroup
                multiple
                label="Days of the week"
                options={WEEKDAY_OPTIONS}
                value={values.weekdays}
                onValueChange={(weekdays) => {
                  set({ weekdays });
                }}
              />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {values.kind === "once" ? (
              <Field label="Date">
                <DateInput
                  min={today}
                  value={values.date}
                  onValueChange={(date) => {
                    set({ date });
                  }}
                />
              </Field>
            ) : null}
            <TimeField
              label="At what time?"
              value={values.time}
              onChange={(time) => {
                set({ time });
              }}
            />
          </div>
        </div>

        <section aria-label="Next 5 due" className="rounded-2xl bg-surface-muted px-4 py-3">
          <h3 className="m-0 text-[13px] font-bold text-[var(--ink)]">Next 5 due</h3>
          {task === undefined ? (
            <p className="m-0 mt-1 text-[12.5px] text-[var(--muted)]">Save the task to see its next five due dates.</p>
          ) : preview.isPending ? (
            <p className="m-0 mt-1 text-[12.5px] text-[var(--muted)]" role="status">
              Working it out…
            </p>
          ) : preview.isError ? (
            <p className="m-0 mt-1 text-[12.5px] text-[var(--muted)]">Couldn't work out the dates.</p>
          ) : preview.data.items.length === 0 ? (
            <p className="m-0 mt-1 text-[12.5px] text-[var(--muted)]">Nothing is due. The task is off or has ended.</p>
          ) : (
            <ol className="m-0 mt-1 list-none p-0 text-[13px] text-[var(--ink2)]">
              {preview.data.items.map((item) => (
                <li key={item.due_at}>{whenOf(item.due_at, timeZone)}</li>
              ))}
            </ol>
          )}
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Remind">
            <Select
              options={remindOptions}
              value={values.remind}
              onValueChange={(remind) => {
                set({ remind });
              }}
            />
          </Field>
          <Field label="Tell the owner after this many missed reminders" hint="0 means never" error={errors.escalate}>
            <TextInput
              type="number"
              min={0}
              max={24}
              inputMode="numeric"
              value={values.escalate}
              onChange={(event) => {
                set({ escalate: event.currentTarget.value });
              }}
            />
          </Field>
        </div>

        <Switch
          label="Active"
          checked={values.active}
          onCheckedChange={(active) => {
            set({ active });
          }}
        />
        {formError === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** A native time field, `HH:MM`, in the same look as the settings forms. */
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (time: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        type="time"
        className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-base tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
    </div>
  );
}
