import { Check, ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";

import { apiErrorOf, type TaskOccurrence } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";
import { Button, TextArea, TextInput } from "@sakalya/ui";

import { useStock } from "../../stock/queries.js";
import { COPY } from "./copy.js";
import { useCompleteTask, useMyTasks } from "./queries.js";
import { useZone } from "./seeing.js";
import { Body, Empty, WidgetCard, type WidgetProps } from "./widget-parts.js";

/** The longest note the server keeps. */
export const NOTE_MAX = 300;

/** Whether an open task is past its time. */
export function isOverdue(task: Pick<TaskOccurrence, "status" | "due_at">, now: number): boolean {
  return task.status === "open" && new Date(task.due_at).getTime() < now;
}

/** Open tasks as the card lists them: overdue ones first, then the rest; each group soonest first. */
export function sortOpenTasks(tasks: readonly TaskOccurrence[], now: number): TaskOccurrence[] {
  const byDue = (a: TaskOccurrence, b: TaskOccurrence) => a.due_at.localeCompare(b.due_at);
  const open = tasks.filter((task) => task.status === "open");
  return [...open.filter((task) => isOverdue(task, now)).sort(byDue), ...open.filter((task) => !isOverdue(task, now)).sort(byDue)];
}

/** A clock that ticks once a minute, so a task turns overdue while the page stays open. */
function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      window.clearInterval(id);
    };
  }, [everyMs]);
  return now;
}

function failureText(error: unknown): string {
  const status = apiErrorOf(error)?.status;
  if (status === 409) return "That can't be finished right now. Check the stock or whether someone already did it.";
  if (status === 403) return "Your role can't finish this task.";
  return "Couldn't save that. Try again.";
}

/** The stock list for "record usage": a quantity for each item used, or "Nothing used today". */
function UsageForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (usage: { item_id: string; quantity: number }[]) => void; onCancel: () => void }) {
  const stock = useStock(true);
  const [quantities, setQuantities] = useState<Readonly<Record<string, string>>>({});
  const levels = (stock.data?.items ?? []).filter((level) => level.item.active);
  const lines = levels.flatMap((level) => {
    const quantity = Number.parseInt(quantities[level.item.id] ?? "", 10);
    return Number.isInteger(quantity) && quantity > 0 ? [{ item_id: level.item.id, quantity }] : [];
  });
  return (
    <div className="tv2-task-usage" role="group" aria-label="Materials used">
      <p className="tv2-sub">Pick what was used and how many.</p>
      {stock.isPending ? <p className="tv2-sub">Loading stock…</p> : null}
      {stock.isError ? <p role="alert" className="tv2-sub">Couldn&apos;t load the stock list. You can still finish with &ldquo;Nothing used today&rdquo;.</p> : null}
      {levels.length > 0 ? (
        <ul className="tv2-task-items">
          {levels.map((level) => {
            const id = `usage-${level.item.id}`;
            return (
              <li key={level.item.id}>
                <label htmlFor={id} className="tv2-grow">
                  <span className="tv2-name">{level.item.name}</span>
                  <span className="tv2-sub">{String(level.on_hand)} {level.item.unit} on hand</span>
                </label>
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={Math.max(level.on_hand, 0)}
                  placeholder="0"
                  value={quantities[level.item.id] ?? ""}
                  onChange={(event) => {
                    setQuantities({ ...quantities, [level.item.id]: event.target.value });
                  }}
                  className="tv2-qty"
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="tv2-task-actions">
        <Button
          disabled={busy || lines.length === 0}
          onClick={() => {
            onSubmit(lines);
          }}
        >
          Save and finish
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            onSubmit([]);
          }}
        >
          Nothing used today
        </Button>
        <button type="button" className="tv2-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TaskRow({ task, now, zone }: { task: TaskOccurrence; now: number; zone: string }) {
  const complete = useCompleteTask();
  const noteId = useId();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [using, setUsing] = useState(false);
  const overdue = isOverdue(task, now);
  const finish = (usage?: { item_id: string; quantity: number }[]) => {
    const text = note.trim();
    complete.mutate({ id: task.id, input: { ...(text === "" ? {} : { note: text }), ...(usage === undefined ? {} : { usage }) } });
  };
  const missing = task.patients_without_photos_today ?? 0;
  return (
    <li className="tv2-task" data-overdue={overdue ? "true" : undefined}>
      <div className="tv2-task-head">
        <span className="tv2-grow">
          <span className="tv2-name">{task.title}</span>
          <span className={overdue ? "tv2-sub tv2-late" : "tv2-sub"}>
            {overdue ? "Overdue · " : ""}Due {formatTime(task.due_at, zone)}
          </span>
        </span>
        {task.action === "record_usage" ? (
          <Button
            variant="secondary"
            aria-expanded={using}
            onClick={() => {
              setUsing(!using);
            }}
          >
            Record usage
          </Button>
        ) : (
          <Button
            icon={<Check className="size-4" aria-hidden="true" />}
            disabled={complete.isPending}
            aria-label={`Done: ${task.title}`}
            onClick={() => {
              finish();
            }}
          >
            Done
          </Button>
        )}
      </div>
      {task.action === "confirm_photos" ? (
        <p className="tv2-sub">
          {missing === 0 ? "Every patient has a photo." : `${String(missing)} ${missing === 1 ? "patient still needs" : "patients still need"} photos`}
          {" · "}
          <Link to="/patients" className="tv2-link">
            Open patients
          </Link>
        </p>
      ) : null}
      {task.action === "record_usage" && using ? <UsageForm busy={complete.isPending} onSubmit={finish} onCancel={() => { setUsing(false); }} /> : null}
      {noting ? (
        <div className="tv2-task-note">
          <label htmlFor={noteId} className="tv2-sub">
            Note (optional, no patient names)
          </label>
          <TextArea
            id={noteId}
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <span className="tv2-sub" aria-live="polite">{String(note.length)}/{String(NOTE_MAX)}</span>
        </div>
      ) : (
        <button
          type="button"
          className="tv2-link"
          onClick={() => {
            setNoting(true);
          }}
        >
          Add a note
        </button>
      )}
      {complete.isError ? <p role="alert" className="tv2-sub tv2-late">{failureText(complete.error)}</p> : null}
    </li>
  );
}

function DoneList({ tasks, zone }: { tasks: readonly TaskOccurrence[]; zone: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (tasks.length === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="tv2-task-done">
      <button
        type="button"
        className="tv2-link"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Chevron className="mr-1 inline size-3.5" aria-hidden="true" />
        Done today ({tasks.length})
      </button>
      <ul id={listId} hidden={!open} className="tv2-list" aria-label="Done today">
        {tasks.map((task) => (
          <li key={task.id} className="tv2-task-finished">
            <Check className="size-4" aria-hidden="true" />
            <span className="tv2-grow">
              <span className="tv2-name">{task.title}</span>
              <span className="tv2-sub">
                {task.completed_at == null ? "Done" : `Done at ${formatTime(task.completed_at, zone)}`}
                {task.completed_by_name == null ? "" : ` by ${task.completed_by_name}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "My tasks": what is on the signed-in person's plate (theirs and their role's), overdue first, finished in one tap. */
export function MyTasksWidget({ spec }: WidgetProps) {
  const tasks = useMyTasks();
  const zone = useZone();
  const now = useNow();
  return (
    <WidgetCard title={spec.label} subtitle="Today, overdue ones first">
      <Body query={tasks} label={spec.label} isEmpty={(data) => data.items.every((task) => task.status !== "open" && task.status !== "done")} empty={<Empty title={COPY.tasksAllDone} />}>
        {(data) => {
          const open = sortOpenTasks(data.items, now);
          const done = data.items.filter((task) => task.status === "done");
          return (
            <>
              {open.length === 0 ? (
                <p className="tv2-task-clear">
                  <ListChecks className="size-4" aria-hidden="true" /> {COPY.tasksAllDone}
                </p>
              ) : (
                <ul aria-label="My tasks" className="tv2-tasks">
                  {open.map((task) => (
                    <TaskRow key={task.id} task={task} now={now} zone={zone} />
                  ))}
                </ul>
              )}
              <DoneList tasks={done} zone={zone} />
            </>
          );
        }}
      </Body>
    </WidgetCard>
  );
}
