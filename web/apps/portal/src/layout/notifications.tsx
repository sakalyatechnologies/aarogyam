import { CalendarCheck, CalendarPlus, CalendarX, FlaskConical, Bell, type LucideIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { apiErrorOf, unwrap, type Notification } from "@aarogyam/api-client";
import { Button, Drawer } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { SCHEDULE } from "../lib/cache-policy.js";

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
      const count = await api.countUnreadNotifications({ signal });
      return { chat_unread: 0, notifications_unread: count.ok ? count.value.unread : null };
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
}

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
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

  const openItem = (item: Notification) => {
    if (!item.read) {
      markRead.mutate(item.id);
    }
    if (item.href !== undefined && item.href !== null && item.href.startsWith("/")) {
      onOpenChange(false);
      void navigate(item.href);
    }
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
        <p className="text-sm text-muted">Nothing yet. Booking requests and late lab work show up here.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Notifications">
          {items.map((item) => {
            const view = describeNotification(item, session.clinic.timezone);
            const Icon = view.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  data-unread={item.read ? undefined : "true"}
                  onClick={() => {
                    openItem(item);
                  }}
                  className={`flex w-full items-start gap-3 rounded-[28px] border p-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    item.read ? "border-transparent bg-surface text-muted" : "border-primary/30 bg-primary-soft text-text"
                  }`}
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
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
