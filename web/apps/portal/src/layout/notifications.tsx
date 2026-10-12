import { AlarmClock, Bell, CalendarCheck, CalendarDays, CalendarPlus, CalendarX, Check, FlaskConical, PackageMinus, TriangleAlert, type LucideIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { apiErrorOf, taskOccurrenceId, unwrap, type Notification } from "@aarogyam/api-client";
import { Button, Drawer } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { SCHEDULE } from "../lib/cache-policy.js";
import { useCompleteTask, useMyTasks } from "../pages/today/v2/queries.js";

/** How often the bell's number is asked for again. */
export const BADGE_POLL_MS = 60_000;

/**
 * The unread number for the bell, polled every minute. Falls back to the notification count
 * if the role doesn't have chat access; a role without either shows none.
 */
export function useBadges() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["badges", access.org_id],
    queryFn: async ({ signal }) => {
      // `getBadges` carries the open tasks; the notification count is asked for separately when it is not in it.
      const badges = await api.getBadges({ signal });
      const tasks_open = badges.ok ? badges.value.tasks_open : 0;
      const known = badges.ok ? (badges.value.notifications_unread ?? null) : null;
      if (known !== null) return { chat_unread: badges.ok ? badges.value.chat_unread : 0, notifications_unread: known, tasks_open };
      const count = await api.countUnreadNotifications({ signal });
      return { chat_unread: badges.ok ? badges.value.chat_unread : 0, notifications_unread: count.ok ? count.value.unread : null, tasks_open };
    },
    ...SCHEDULE,
    refetchInterval: BADGE_POLL_MS,
    retry: false,
  });
}

/** The caller's notifications, newest first; asked for only while the drawer is open. */
export function useNotifications(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["notifications", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listNotifications({ limit: 50 }, { signal })),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

function useRefreshBell() {
  const { access } = useClinic();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notifications", access.org_id] }),
      queryClient.invalidateQueries({ queryKey: ["badges", access.org_id] }),
    ]);
}

export function useMarkNotificationRead() {
  const { api } = useClinic();
  const refresh = useRefreshBell();
  return useMutation({ mutationFn: (id: string) => unwrap(api.markNotificationRead(id)), onSuccess: refresh });
}

export function useMarkAllNotificationsRead() {
  const { api } = useClinic();
  const refresh = useRefreshBell();
  return useMutation({ mutationFn: () => unwrap(api.markAllNotificationsRead()), onSuccess: refresh });
}

/** What the bell counts: unread notifications and the tasks still open. `null` when neither is known. */
export function bellCount(badges: { notifications_unread: number | null; tasks_open: number } | undefined): number | null {
  if (badges === undefined) return null;
  return badges.notifications_unread === null && badges.tasks_open === 0 ? null : (badges.notifications_unread ?? 0) + badges.tasks_open;
}

/** The number on the bell: nothing at zero, "99+" past 99. */
export function badgeLabel(count: number | null | undefined): string | undefined {
  if (count === undefined || count === null || count <= 0) {
    return undefined;
  }
  return count > 99 ? "99+" : String(count);
}

interface Described {
  title: string;
  body: string;
  icon: LucideIcon;
  /** Where tapping the row goes; the notification's own `href` when this is left out. */
  to?: string;
}

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

const TIME_OFF_PATH = "/settings?tab=time-off";

function dueText(item: Notification, timeZone: string): string {
  return item.due_at === undefined || item.due_at === null ? "Open Today to see it." : `Due ${new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(item.due_at))}.`;
}

/** What a notification says, from its kind and what it is about. */
export function describeNotification(item: Notification, timeZone: string): Described {
  const slot = item.appointment === null || item.appointment === undefined ? "" : `${when(item.appointment.starts_at, timeZone)} with ${item.appointment.practitioner_name}`;
  switch (item.kind) {
    case "booking_requested":
      return { title: "Booking request", body: slot === "" ? "A patient asked for a visit." : `${slot}. Confirm or decline it.`, icon: CalendarPlus };
    case "booking_confirmed_auto":
      return { title: "Booking confirmed", body: slot === "" ? "A booking was confirmed." : `${slot}.`, icon: CalendarCheck };
    case "booking_cancelled_by_patient":
      return { title: "Booking cancelled", body: slot === "" ? "A patient cancelled." : `${slot}. The patient cancelled it.`, icon: CalendarX };
    case "lab_overdue": {
      const order = item.lab_order;
      return {
        title: "Lab work overdue",
        body: order === null || order === undefined ? "A lab order is late." : `${order.number} from ${order.vendor_name}${order.due_on === null || order.due_on === undefined ? "" : `, due ${order.due_on}`}.`,
        icon: FlaskConical,
      };
    }
    case "task_due":
    case "task_reminder": {
      const name = item.title === undefined || item.title === null || item.title === "" ? "a task" : item.title;
      return { title: `${item.kind === "task_due" ? "Due" : "Reminder"}: ${name}`, body: dueText(item, timeZone), icon: AlarmClock, to: "/today" };
    }
    case "task_escalated": {
      const name = item.title === undefined || item.title === null || item.title === "" ? "A task" : item.title;
      return { title: `${name} not done yet`, body: dueText(item, timeZone), icon: TriangleAlert, to: "/today" };
    }
    case "time_off_requested":
      return { title: "Time off requested", body: "A team member asked for time off. Open Time off to decide.", icon: CalendarDays, to: TIME_OFF_PATH };
    case "time_off_decided":
      return { title: "Time off decided", body: "Your request has an answer. Open Time off to see it.", icon: CalendarDays, to: TIME_OFF_PATH };
    case "stock_alert": {
      const name = item.item_name === undefined || item.item_name === null || item.item_name === "" ? "An item" : item.item_name;
      const days = item.days_cover;
      return {
        title: days === undefined || days === null ? `${name} is running low` : `${name} runs out in about ${String(Math.max(1, Math.round(days)))} ${Math.round(days) <= 1 ? "day" : "days"}`,
        body: "Open Stock to reorder.",
        icon: PackageMinus,
        to: "/stock",
      };
    }
    default:
      return { title: "Update", body: "Something needs a look.", icon: Bell };
  }
}

/** "6 min ago", "2 h ago", then the date. */
export function ago(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const days = Math.round(hours / 24);
  return days < 8 ? `${String(days)} d ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** The notifications drawer: real items, unread ones highlighted, "Mark all read" kept on the server, a link opens what it is about. */
export function NotificationsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { session } = useClinic();
  const navigate = useNavigate();
  const list = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = list.data?.items ?? [];
  const unread = items.filter((item) => !item.read).length;
  const denied = list.isError && apiErrorOf(list.error)?.status === 403;

  const tasks = useMyTasks(open);
  const complete = useCompleteTask();

  const openItem = (item: Notification, to: string | undefined) => {
    if (!item.read) {
      markRead.mutate(item.id);
    }
    const target = to ?? item.href;
    if (target !== undefined && target !== null && target.startsWith("/")) {
      onOpenChange(false);
      void navigate(target);
    }
  };

  /** A task reminder gets a Done button when the task is a plain one still open; unknown (not loaded yet) counts as open. */
  const doneable = (item: Notification): string | null => {
    if ((item.kind !== "task_due" && item.kind !== "task_reminder") || item.task_occurrence_id === undefined || item.task_occurrence_id === null) return null;
    const mine = tasks.data?.items.find((task) => task.id === item.task_occurrence_id);
    if (tasks.data !== undefined && (mine === undefined || mine.status !== "open" || mine.action !== "none")) return null;
    return item.task_occurrence_id;
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Notifications"
      description={list.isPending ? "Loading" : unread > 0 ? `${String(unread)} unread` : "All caught up"}
      footer={
        <Button
          variant="secondary"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => {
            markAll.mutate();
          }}
        >
          Mark all read
        </Button>
      }
    >
      {list.isError ? (
        <p role={denied ? undefined : "alert"} className="text-sm text-muted">
          {denied ? "Your role has no notifications." : "Couldn't load notifications."}{" "}
          {denied ? null : (
            <button
              type="button"
              className="font-semibold text-primary-text underline"
              onClick={() => {
                void list.refetch();
              }}
            >
              Try again
            </button>
          )}
        </p>
      ) : items.length === 0 && !list.isPending ? (
        <p className="text-sm text-muted">Nothing yet. Booking requests, tasks, time off and stock alerts show up here.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Notifications">
          {items.map((item) => {
            const view = describeNotification(item, session.clinic.timezone);
            const Icon = view.icon;
            const taskId = doneable(item);
            return (
              <li
                key={item.id}
                className={`rounded-[28px] border transition-colors ${item.read ? "border-transparent bg-surface text-muted" : "border-primary/30 bg-primary-soft text-text"}`}
              >
                <button
                  type="button"
                  data-unread={item.read ? undefined : "true"}
                  onClick={() => {
                    openItem(item, view.to);
                  }}
                  className="flex w-full items-start gap-3 rounded-[28px] p-3 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-primary-text" aria-hidden="true">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {item.read ? null : <span className="sr-only">Unread. </span>}
                        {view.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{ago(item.created_at)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{view.body}</span>
                  </span>
                  {item.read ? null : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                </button>
                {taskId === null ? null : (
                  <div className="flex items-center gap-2 px-3 pb-3 pl-16">
                    <Button
                      icon={<Check className="size-4" aria-hidden="true" />}
                      disabled={complete.isPending}
                      aria-label={`Done: ${item.title ?? "task"}`}
                      onClick={() => {
                        complete.mutate(
                          { id: taskOccurrenceId.parse(taskId), input: {} },
                          {
                            onSuccess: () => {
                              if (!item.read) markRead.mutate(item.id);
                            },
                          },
                        );
                      }}
                    >
                      Done
                    </Button>
                    {complete.isError ? (
                      <span role="alert" className="text-xs text-muted">
                        Couldn&apos;t finish it. Open Today to try again.
                      </span>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
