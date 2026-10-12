import { AlarmClock, Bell, BellRing, CalendarCheck, CalendarDays, CalendarPlus, CalendarX, Check, FlaskConical, Footprints, HandCoins, PackageMinus, TriangleAlert, UserRound, type LucideIcon } from "lucide-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { apiErrorOf, invoiceId, queueTokenId, taskOccurrenceId, unwrap, type Notification } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Button, Drawer } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { SCHEDULE } from "../lib/cache-policy.js";
import { useNotifications } from "../lib/notifications-query.js";
import { useRefreshVisitData } from "../lib/visit-refresh.js";
import { CollectDialog, type CollectTarget } from "../pages/queue/collect-dialog.js";
import { useCallToken } from "../pages/queue/queue-v2-queries.js";
import { useCompleteTask, useMyTasks } from "../pages/today/v2/queries.js";
import { useQueue } from "../queries.js";
import { alertNewPatient, readVisitAlerts } from "./visit-alerts.js";

export { useNotifications };

/** How often the bell's number is asked for again: quickly where the day's patients are, slowly elsewhere. */
export const BADGE_POLL_MS = 60_000;
export const BADGE_POLL_FAST_MS = 20_000;

/** The pages that show who is waiting, where a new patient should reach the bell within seconds. */
export function badgePollMs(pathname: string): number {
  const live = ["/today", "/queue"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  return live ? BADGE_POLL_FAST_MS : BADGE_POLL_MS;
}

/** A waiting-patient notice this recent is worth a sound; an older unread one was there when the page opened. */
const FRESH_MS = 2 * 60_000;

/**
 * The unread number for the bell, polled every 20 s on Today and the queue and every minute elsewhere (not while the tab is
 * hidden). Falls back to the notification count if the role doesn't have chat access; a role without either shows none.
 * When the unread number rises the queue and Today are asked for again, and a new waiting patient sounds the alert if the
 * person switched it on.
 */
export function useBadges() {
  const { api, access, session } = useClinic();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const query = useQuery({
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
    refetchInterval: badgePollMs(pathname),
    refetchIntervalInBackground: false,
    retry: false,
  });

  const before = useRef<number | null>(null);
  const alerted = useRef(new Set<string>());
  const unread = query.data?.notifications_unread ?? null;
  useEffect(() => {
    if (unread === null) return;
    const last = before.current;
    before.current = unread;
    if (last === null || unread <= last) return;
    // Someone arrived or something needs the desk: the board and Today are behind.
    for (const key of ["queue", "today", "notifications"]) void queryClient.invalidateQueries({ queryKey: [key, access.org_id] });
    if (!readVisitAlerts(session.user.id)) return;
    void api.listNotifications({ unreadOnly: true, limit: 20 }).then((result) => {
      if (!result.ok) return;
      const fresh = result.value.items.filter(
        (n) => n.kind === "patient_waiting" && !n.read && n.handled == null && !alerted.current.has(n.id) && Date.now() - new Date(n.created_at).getTime() < FRESH_MS,
      );
      for (const n of result.value.items) if (n.kind === "patient_waiting") alerted.current.add(n.id);
      if (fresh.length > 0) alertNewPatient(session.user.id);
    });
  }, [unread, api, queryClient, access.org_id, session.user.id]);

  return query;
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

/** The kinds that ask someone to act. Once handled they stay in the list, muted, and no longer count as unread. */
const ACTIONABLE = new Set(["patient_waiting", "send_in", "collect_payment", "arrival"]);

/** Whether someone already did what the notification asks. */
export function isSettled(item: Notification): boolean {
  return ACTIONABLE.has(item.kind) && item.handled != null;
}

/** Whether it still counts toward the unread number. */
export function isCounted(item: Notification): boolean {
  return !item.read && !isSettled(item);
}

/** "#7 Neha Rao": the token's number and the patient's name, whichever is known. */
function who(item: Notification, name: string | undefined): string {
  return [item.queue_token == null ? null : `#${String(item.queue_token.number)}`, name === undefined || name === "" ? null : name].filter((part) => part !== null).join(" ");
}

/** The amount left, only when the row carries it: the API sends it to people who may collect, nobody else. */
function amountOf(item: Notification): string | null {
  const balance = item.invoice?.balance_paise;
  return balance === undefined || balance === null ? null : formatRupees(balance);
}

/**
 * What a notification says, from its kind and what it is about. The API never names the patient, so `name` is what the page
 * already knew (the queue, Today or the bill's summary); without it the line is shown without a name.
 */
export function describeNotification(item: Notification, timeZone: string, name?: string): Described {
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
    case "patient_waiting": {
      const label = who(item, name);
      return {
        title: label === "" ? "New patient waiting" : `New patient waiting · ${label}`,
        body: isSettled(item) ? handledText(item) : "Waiting to be called in.",
        icon: UserRound,
      };
    }
    case "send_in": {
      const label = who(item, name);
      return { title: "Patient called in", body: isSettled(item) ? handledText(item) : label === "" ? "The doctor called a patient in." : `${label} is on the way in.`, icon: Footprints };
    }
    case "collect_payment": {
      const amount = amountOf(item);
      const parts = [amount === null ? "Collect payment" : `Collect ${amount}`, name === undefined || name === "" ? null : name].filter((part) => part !== null);
      return { title: parts.join(" · "), body: isSettled(item) ? handledText(item) : item.invoice?.number == null ? "Open the bill to take payment." : `${item.invoice.number}. Take payment at the desk.`, icon: HandCoins };
    }
    case "arrival": {
      return { title: "Patient arrived", body: isSettled(item) ? handledText(item) : slot === "" ? "A patient checked in." : `${slot}.`, icon: BellRing };
    }
    case "payment_due": {
      const amount = amountOf(item);
      return { title: amount === null ? "Payment due" : `Payment due · ${amount}`, body: item.invoice?.number == null ? "A bill is still unpaid." : `${item.invoice.number} is still unpaid.`, icon: HandCoins };
    }
    case "recall_due":
      return { title: "Follow-up due", body: item.recall === null || item.recall === undefined ? "A patient is due for a follow-up." : `A patient is due back on ${item.recall.due_on}.`, icon: CalendarCheck };
    default:
      return { title: "Update", body: "Something needs a look.", icon: Bell };
  }
}

function handledText(item: Notification): string {
  return item.handled?.name == null || item.handled.name === "" ? "Handled" : `Handled by ${item.handled.name}`;
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Patient names by token id, from data the portal already holds: the queue (any day cached) and Today's board. */
function tokenNamesFromCache(queryClient: ReturnType<typeof useQueryClient>, orgId: string): Map<string, string> {
  const names = new Map<string, string>();
  const take = (id: unknown, name: unknown) => {
    if (typeof id === "string" && typeof name === "string" && name !== "") names.set(id, name);
  };
  const fromToken = (token: unknown) => {
    if (isRecord(token) && isRecord(token.patient)) take(token.id, token.patient.full_name);
  };
  for (const [, data] of queryClient.getQueriesData({ queryKey: ["queue", orgId] })) {
    if (isRecord(data) && Array.isArray(data.items)) data.items.forEach(fromToken);
  }
  for (const [, data] of queryClient.getQueriesData({ queryKey: ["today", orgId] })) {
    if (!isRecord(data)) continue;
    if (Array.isArray(data.recent_patients)) data.recent_patients.forEach(fromToken);
    if (Array.isArray(data.attention)) {
      for (const row of data.attention) if (isRecord(row) && isRecord(row.patient)) take(row.queue_token_id, row.patient.full_name);
    }
  }
  return names;
}

/**
 * Who each queue notice is about. The API sends no names, so they come from the queue and Today caches, from the queue itself
 * when the drawer is open and the role may read it, and for a bill from its collect summary (for people who may collect).
 */
function useNoticeNames(items: readonly Notification[], open: boolean) {
  const { api, access, can } = useClinic();
  const queryClient = useQueryClient();
  const needsQueue = open && items.some((n) => n.queue_token != null);
  useQueue(undefined, { enabled: needsQueue && can("appointments.read") });
  const tokens = tokenNamesFromCache(queryClient, access.org_id);
  const mayCollect = can("payments.collect") || can("billing.read");
  const wanted = items.filter((n) => open && mayCollect && n.kind === "collect_payment" && n.handled == null && n.invoice != null && (n.queue_token == null || !tokens.has(n.queue_token.id)));
  const summaries = useQueries({
    queries: wanted.map((n) => ({
      queryKey: ["collect-summary", access.org_id, n.invoice?.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => unwrap(api.getInvoiceCollectSummary(invoiceId.parse(n.invoice?.id), { signal })),
      retry: false,
      staleTime: 30_000,
    })),
  });
  const bills = new Map<string, string>();
  wanted.forEach((n, i) => {
    const found = summaries[i]?.data;
    if (n.invoice !== undefined && n.invoice !== null && found !== undefined) bills.set(n.invoice.id, found.patient.name);
  });
  return (item: Notification): string | undefined =>
    (item.queue_token == null ? undefined : tokens.get(item.queue_token.id)) ?? (item.invoice == null ? undefined : bills.get(item.invoice.id));
}

/** The notifications drawer: real items, unread ones highlighted, "Mark all read" kept on the server, a link opens what it is about. */
export function NotificationsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { session, can } = useClinic();
  const navigate = useNavigate();
  const list = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const refreshVisit = useRefreshVisitData();
  const callIn = useCallToken();
  const [collecting, setCollecting] = useState<CollectTarget | undefined>(undefined);
  const items = list.data?.items ?? [];
  const nameOf = useNoticeNames(items, open);
  const unread = items.filter(isCounted).length;
  const denied = list.isError && apiErrorOf(list.error)?.status === 403;
  const canCall = can("clinical.write");
  const canCollect = can("payments.collect") || can("billing.read");

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

  /** "Call in" on a waiting patient, for people who may call; "Collect" on a bill, for people who may collect. */
  const callable = (item: Notification): string | null =>
    item.kind === "patient_waiting" && !isSettled(item) && canCall && item.queue_token != null ? item.queue_token.id : null;
  const collectable = (item: Notification): string | null =>
    item.kind === "collect_payment" && !isSettled(item) && canCollect && item.invoice != null ? item.invoice.id : null;

  return (
    <>
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
          <p className="text-sm text-muted">Nothing yet. Patients waiting, payments to collect, booking requests, tasks, time off and stock alerts show up here.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Notifications">
            {items.map((item) => {
              const name = nameOf(item);
              const view = describeNotification(item, session.clinic.timezone, name);
              const Icon = view.icon;
              const taskId = doneable(item);
              const callToken = callable(item);
              const collectInvoice = collectable(item);
              const counted = isCounted(item);
              const settled = isSettled(item);
              return (
                <li
                  key={item.id}
                  data-settled={settled ? "true" : undefined}
                  className={`rounded-[28px] border transition-colors ${counted ? "border-primary/30 bg-primary-soft text-text" : "border-transparent bg-surface text-muted"} ${settled ? "opacity-70" : ""}`}
                >
                  <button
                    type="button"
                    data-unread={counted ? "true" : undefined}
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
                        <span className={`text-sm ${settled ? "font-medium" : "font-semibold"}`}>
                          {counted ? <span className="sr-only">Unread. </span> : null}
                          {view.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted">{ago(item.created_at)}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{view.body}</span>
                    </span>
                    {counted ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
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
                  {callToken === null ? null : (
                    <div className="flex items-center gap-2 px-3 pb-3 pl-16">
                      <Button
                        disabled={callIn.isPending}
                        aria-label={`Call in${name === undefined ? "" : `: ${name}`}`}
                        onClick={() => {
                          callIn.mutate(queueTokenId.parse(callToken), {
                            onSuccess: () => {
                              if (!item.read) markRead.mutate(item.id);
                              void refreshVisit();
                            },
                          });
                        }}
                      >
                        Call in
                      </Button>
                      {callIn.isError ? (
                        <span role="alert" className="text-xs text-muted">
                          {apiErrorOf(callIn.error)?.message ?? "Couldn't call them in. Open the queue to try again."}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {collectInvoice === null ? null : (
                    <div className="flex items-center gap-2 px-3 pb-3 pl-16">
                      <Button
                        aria-label={`Collect${name === undefined ? "" : `: ${name}`}`}
                        onClick={() => {
                          if (!item.read) markRead.mutate(item.id);
                          onOpenChange(false);
                          setCollecting({ invoiceId: collectInvoice, patientName: name });
                        }}
                      >
                        Collect
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Drawer>
      <CollectDialog
        target={collecting}
        onClose={() => {
          setCollecting(undefined);
          void refreshVisit();
        }}
      />
    </>
  );
}
