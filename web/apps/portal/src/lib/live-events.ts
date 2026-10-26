import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { type LiveEvent } from "@aarogyam/api-client";

import { useClinic } from "../clinic.js";
import { alertedIds, alertNewPatient } from "../layout/visit-alerts.js";

/** Whether the live stream is open right now; the polls slow down while it is and come back to full speed when it isn't. */
let connected = false;
const listeners = new Set<() => void>();
function setConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const listener of listeners) listener();
}
export function useLiveConnected(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => connected,
    () => false,
  );
}

export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** The notice kinds that deserve the optional sound or desktop alert. */
const ALERT_KINDS = new Set(["patient_waiting", "collect_payment"]);

const QUEUE_KEYS = ["queue", "today", "today-money"];
const APPOINTMENT_KEYS = ["appointments", "today", "missed"];

function noticeOf(data: unknown): { kind?: string; id?: string } {
  if (typeof data !== "object" || data === null) return {};
  const kind: unknown = Reflect.get(data, "kind");
  const id: unknown = Reflect.get(data, "id");
  return { ...(typeof kind === "string" ? { kind } : {}), ...(typeof id === "string" ? { id } : {}) };
}

/** Which cached lists an event makes stale. Query keys all start `[name, orgId, ...]`. */
export function applyLiveEvent(queryClient: QueryClient, orgId: string, userId: string, event: LiveEvent): void {
  const invalidate = (keys: string[]) => {
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key, orgId] });
  };
  switch (event.type) {
    case "queue.changed":
    case "visit.changed":
      invalidate(QUEUE_KEYS);
      break;
    case "appointment.changed":
      invalidate(APPOINTMENT_KEYS);
      break;
    case "notification.created": {
      invalidate(["notifications", "badges"]);
      const { kind, id } = noticeOf(event.data);
      if (kind !== undefined && ALERT_KINDS.has(kind) && id !== undefined && !alertedIds.has(id)) {
        alertedIds.add(id);
        alertNewPatient(userId);
      }
      break;
    }
    case "resync":
      void queryClient.invalidateQueries();
      break;
    default:
      break;
  }
}

/** `aborted` read through a call, so the checker does not narrow it across the awaits above. */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

/**
 * One live-event stream for the signed-in shell. Reconnects with a 1 s to 30 s backoff, sends the last event id so
 * nothing is missed, and closes while the tab is hidden (reconnecting when it is shown again).
 */
export function useLiveEvents(): void {
  const { api, access, session } = useClinic();
  const queryClient = useQueryClient();
  const userId = session.user.id;
  const orgId = access.org_id;

  useEffect(() => {
    let stop = new AbortController();
    let lastEventId: string | undefined;
    let disposed = false;

    async function run(signal: AbortSignal): Promise<void> {
      let delay = BACKOFF_START_MS;
      while (!isAborted(signal)) {
        const link = { opened: false };
        const result = await api.subscribeEvents({
          lastEventId,
          signal,
          onOpen: () => {
            link.opened = true;
            delay = BACKOFF_START_MS;
            setConnected(true);
          },
          onEvent: (event) => {
            if (event.id !== undefined) lastEventId = event.id;
            applyLiveEvent(queryClient, orgId, userId, event);
          },
        });
        setConnected(false);
        if (isAborted(signal)) return;
        // A clean close (the server's 8 minutes) reconnects at once; an error backs off.
        if (link.opened && result.ok) continue;
        await sleep(delay, signal);
        delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      }
    }

    const open = () => {
      if (disposed || document.visibilityState === "hidden") return;
      stop.abort();
      stop = new AbortController();
      void run(stop.signal);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop.abort();
        setConnected(false);
      } else {
        open();
      }
    };
    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop.abort();
      setConnected(false);
    };
  }, [api, queryClient, orgId, userId]);
}
