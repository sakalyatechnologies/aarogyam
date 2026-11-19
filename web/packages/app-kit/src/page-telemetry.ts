/**
 * Page counters, page speed and error classes for the Sakalya console's Insights page
 * (docs/plans/console-insights-design.md, 2b), sent to `POST /api/v1/telemetry`.
 *
 * Per route template (the router's matched pattern, never the URL) it counts page views and the
 * time the page was visible (Page Visibility API), takes page-speed readings with its own
 * PerformanceObserver code (LCP and TTFB once per load, INP and CLS per visit to a route), and
 * counts uncaught errors by class only. Nothing names a person, a patient or a record.
 *
 * It sends **only** when the tab becomes hidden or MAX_QUEUED entries have queued while the page
 * is visible: no timer, nothing while hidden. It uses `fetch` with `keepalive`, which outlives the
 * page like `sendBeacon` but can carry the bearer token; signed out, the batch is dropped.
 * Sending never throws and never blocks the page.
 */

import { routeTemplate, type TemplateRouter } from "./route-template.js";

/** Entries (pages, readings and error classes together) that make a batch go out. */
export const MAX_QUEUED = 50;

/** The parts of a PerformanceEntry the readings use. */
export interface PerfEntry {
  entryType: string;
  startTime: number;
  duration: number;
  /** layout-shift */
  value?: number;
  /** layout-shift */
  hadRecentInput?: boolean;
  /** event, first-input */
  interactionId?: number;
  /** navigation */
  responseStart?: number;
}

/** Starts observing `type` (buffered); returns a function that stops, or null when unsupported. */
export type Observe = (type: string, onEntries: (entries: readonly PerfEntry[]) => void) => (() => void) | null;

/** The part of `document` this needs. */
export interface VisibilityTarget {
  readonly visibilityState: string;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

/** The part of `window` this needs, for uncaught errors. */
export interface ErrorEventTarget {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
}

export interface PageTelemetryOptions {
  /** The app's data router (`createBrowserRouter`). */
  router: TemplateRouter;
  /** The bearer token; `null` when signed out. */
  getToken: () => Promise<string | null>;
  /** Where the API is; defaults to this page's own host, where the Worker proxies `/api`. */
  apiBase?: string;
  /** For tests. */
  document?: VisibilityTarget;
  /** For tests. */
  window?: ErrorEventTarget;
  /** For tests. */
  observe?: Observe;
  /** For tests; milliseconds. */
  now?: () => number;
  /** For tests. */
  send?: (url: string, body: string, token: string) => void;
}

export type ErrorClassName =
  | "type_error"
  | "reference_error"
  | "range_error"
  | "syntax_error"
  | "chunk_load"
  | "network"
  | "unhandled_rejection"
  | "other";

/** The class of an uncaught error; its message never leaves the page this way. */
export function errorClass(reason: unknown, kind: "error" | "unhandledrejection"): ErrorClassName {
  if (!(reason instanceof Error)) return kind === "unhandledrejection" ? "unhandled_rejection" : "other";
  const { name, message } = reason;
  if (name === "ChunkLoadError" || /dynamically imported module|importing a module script failed|loading chunk/i.test(message)) {
    return "chunk_load";
  }
  if (name === "TypeError" && /failed to fetch|networkerror|load failed/i.test(message)) return "network";
  switch (name) {
    case "TypeError":
      return "type_error";
    case "ReferenceError":
      return "reference_error";
    case "RangeError":
      return "range_error";
    case "SyntaxError":
      return "syntax_error";
    default:
      return "other";
  }
}

function observePerformance(type: string, onEntries: (entries: readonly PerfEntry[]) => void): (() => void) | null {
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes.includes(type)) return null;
  try {
    const observer = new PerformanceObserver((list) => {
      onEntries(list.getEntries());
    });
    const init: PerformanceObserverInit & { durationThreshold?: number } = { type, buffered: true };
    // Interactions of 40 ms or more: the browser's lowest threshold that is widely supported.
    if (type === "event") init.durationThreshold = 40;
    observer.observe(init);
    return () => {
      observer.disconnect();
    };
  } catch {
    return null;
  }
}

function sendWithKeepalive(url: string, body: string, token: string): void {
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
}

interface PageEntry {
  route: string;
  views: number;
  visible_ms: number;
}

interface VitalEntry {
  route: string;
  name: "lcp" | "inp" | "cls" | "ttfb";
  value: number;
}

interface ErrorEntry {
  route: string;
  class: ErrorClassName;
  count: number;
}

/** Starts collecting. Returns a function that stops it (without sending). */
export function installPageTelemetry(options: PageTelemetryOptions): () => void {
  const doc = options.document ?? document;
  const win = options.window ?? window;
  const observe = options.observe ?? observePerformance;
  const now = options.now ?? (() => performance.now());
  const send = options.send ?? sendWithKeepalive;
  const url = `${options.apiBase ?? ""}/api/v1/telemetry`;

  const pages = new Map<string, PageEntry>();
  const vitals: VitalEntry[] = [];
  const errors = new Map<string, ErrorEntry>();
  const queued = (): number => pages.size + vitals.length + errors.size;
  const hidden = (): boolean => doc.visibilityState === "hidden";

  let route = routeTemplate(options.router.state.matches);
  const firstRoute = route;
  let visibleSince: number | null = hidden() ? null : now();

  function flush(): void {
    if (queued() === 0) return;
    const body = JSON.stringify({ pages: [...pages.values()], vitals: [...vitals], errors: [...errors.values()] });
    pages.clear();
    vitals.length = 0;
    errors.clear();
    options
      .getToken()
      .then((token) => {
        if (token !== null) send(url, body, token);
      })
      .catch(() => undefined);
  }

  /** While hidden nothing goes out, so a full queue takes no new keys until the next hide. */
  function room(isNewKey: boolean): boolean {
    return !isNewKey || queued() < MAX_QUEUED;
  }

  function afterAdd(): void {
    if (!hidden() && queued() >= MAX_QUEUED) flush();
  }

  function page(template: string): PageEntry | null {
    const existing = pages.get(template);
    if (existing !== undefined) return existing;
    if (!room(true)) return null;
    const entry = { route: template, views: 0, visible_ms: 0 };
    pages.set(template, entry);
    return entry;
  }

  function addVital(template: string, name: VitalEntry["name"], value: number): void {
    if (!Number.isFinite(value) || value < 0 || !room(true)) return;
    vitals.push({ route: template, name, value: name === "cls" ? Math.round(value * 10_000) / 10_000 : Math.round(value) });
    afterAdd();
  }

  function addView(template: string): void {
    const entry = page(template);
    if (entry !== null) entry.views += 1;
    afterAdd();
  }

  function closeVisible(): void {
    if (visibleSince === null) return;
    const elapsed = Math.max(0, Math.round(now() - visibleSince));
    visibleSince = null;
    const entry = page(route);
    if (entry !== null) entry.visible_ms += elapsed;
  }

  // LCP and TTFB belong to the page load, so to the first route.
  let lcp = 0;
  let lcpDone = false;
  const stopLcp = observe("largest-contentful-paint", (entries) => {
    const last = entries.at(-1);
    if (last !== undefined && !lcpDone) lcp = last.startTime;
  });
  function finishLcp(): void {
    if (lcpDone) return;
    lcpDone = true;
    stopLcp?.();
    if (lcp > 0) addVital(firstRoute, "lcp", lcp);
  }

  let ttfbDone = false;
  const stopTtfb = observe("navigation", (entries) => {
    const start = entries[0]?.responseStart ?? 0;
    if (ttfbDone || start <= 0) return;
    ttfbDone = true;
    addVital(firstRoute, "ttfb", start);
  });

  // INP and CLS per visit to a route: the slowest interaction, and the largest burst of shifts.
  let inp = 0;
  let interacted = false;
  const onInteractions = (entries: readonly PerfEntry[]): void => {
    for (const entry of entries) {
      if ((entry.interactionId ?? 0) > 0 || entry.entryType === "first-input") {
        interacted = true;
        inp = Math.max(inp, entry.duration);
      }
    }
  };
  const stopEvents = observe("event", onInteractions);
  const stopFirstInput = observe("first-input", onInteractions);

  let cls = 0;
  let burst = 0;
  let burstFirst = 0;
  let burstLast = 0;
  const stopShifts = observe("layout-shift", (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput === true) continue;
      const value = entry.value ?? 0;
      if (burst > 0 && entry.startTime - burstLast < 1000 && entry.startTime - burstFirst < 5000) {
        burst += value;
      } else {
        burst = value;
        burstFirst = entry.startTime;
      }
      burstLast = entry.startTime;
      cls = Math.max(cls, burst);
    }
  });

  function finishVisit(): void {
    if (interacted) addVital(route, "inp", inp);
    if (stopShifts !== null) addVital(route, "cls", cls);
    inp = 0;
    interacted = false;
    cls = 0;
    burst = 0;
  }

  addView(route);

  const unsubscribe = options.router.subscribe((state) => {
    const next = routeTemplate(state.matches);
    if (next === route) return;
    closeVisible();
    finishLcp();
    finishVisit();
    route = next;
    if (!hidden()) visibleSince = now();
    addView(route);
  });

  const onVisibility = (): void => {
    if (hidden()) {
      closeVisible();
      finishLcp();
      finishVisit();
      flush();
    } else if (visibleSince === null) {
      visibleSince = now();
    }
  };
  doc.addEventListener("visibilitychange", onVisibility);

  function countError(reason: unknown, kind: "error" | "unhandledrejection"): void {
    try {
      const errorClassName = errorClass(reason, kind);
      const key = `${route}|${errorClassName}`;
      const existing = errors.get(key);
      if (existing !== undefined) {
        existing.count += 1;
      } else if (room(true)) {
        errors.set(key, { route, class: errorClassName, count: 1 });
        afterAdd();
      }
    } catch {
      // Counting must never break the page.
    }
  }
  const onError = (event: Event): void => {
    countError(Reflect.get(event, "error"), "error");
  };
  const onRejection = (event: Event): void => {
    countError(Reflect.get(event, "reason"), "unhandledrejection");
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);

  return () => {
    unsubscribe();
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
    for (const stop of [stopLcp, stopTtfb, stopEvents, stopFirstInput, stopShifts]) stop?.();
  };
}
