import { afterEach, describe, expect, it, vi } from "vitest";

import { errorClass, installPageTelemetry, MAX_QUEUED, type Observe, type PerfEntry } from "./page-telemetry.js";
import { currentRouteTemplate, routeTemplate, watchRouteTemplate, type RouteMatchLike } from "./route-template.js";

/** The matches react-router gives for a nested route: the root, a pathless layout, the page. */
function matches(path: string): RouteMatchLike[] {
  return [{ route: { path: "/" } }, { route: {} }, { route: { path: path.replace(/^\//, "") } }];
}

function fakeRouter(path: string) {
  const listeners = new Set<(state: { matches: readonly RouteMatchLike[] }) => void>();
  const initial: readonly RouteMatchLike[] = matches(path);
  const router = {
    state: { matches: initial },
    subscribe: (listener: (state: { matches: readonly RouteMatchLike[] }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    go: (next: string) => {
      router.state = { matches: matches(next) };
      for (const listener of listeners) listener(router.state);
    },
  };
  return router;
}

function fakeDocument() {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (_type: "visibilitychange", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) => listeners.delete(listener),
    set: (state: "visible" | "hidden") => {
      doc.visibilityState = state;
      for (const listener of listeners) listener();
    },
  };
  return doc;
}

function fakeObserver() {
  const callbacks = new Map<string, (entries: readonly PerfEntry[]) => void>();
  const observe: Observe = (type, onEntries) => {
    callbacks.set(type, onEntries);
    return () => callbacks.delete(type);
  };
  const emit = (type: string, entries: Partial<PerfEntry>[]) => {
    callbacks.get(type)?.(entries.map((entry) => ({ entryType: type, startTime: 0, duration: 0, ...entry })));
  };
  return { observe, emit };
}

/** One list of a sent batch (`pages`, `vitals` or `errors`). */
function list(body: unknown, key: "pages" | "vitals" | "errors"): unknown[] {
  const value: unknown = typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;
  return Array.isArray(value) ? value : [];
}

function setup(path = "/patients/:id", token: string | null = "token-1") {
  let clock = 1_000;
  const router = fakeRouter(path);
  const doc = fakeDocument();
  const win = new EventTarget();
  const perf = fakeObserver();
  const sent: { url: string; body: unknown; token: string }[] = [];
  const stop = installPageTelemetry({
    router,
    getToken: () => Promise.resolve(token),
    document: doc,
    window: win,
    observe: perf.observe,
    now: () => clock,
    send: (url, body, bearer) => {
      const parsed: unknown = JSON.parse(body);
      sent.push({ url, body: parsed, token: bearer });
    },
  });
  const tick = (ms: number) => {
    clock += ms;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { router, doc, win, perf, sent, stop, tick, settle };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("routeTemplate", () => {
  it("joins the matched patterns and never the URL", () => {
    expect(routeTemplate(matches("/patients/:id/visits/:visitId"))).toBe("/patients/:id/visits/:visitId");
    expect(routeTemplate([{ route: { path: "/" } }, { route: {} }])).toBe("/");
  });

  it("keeps the current template for error reports", () => {
    const router = fakeRouter("/today");
    const stop = watchRouteTemplate(router);
    router.go("/patients/:id");
    expect(currentRouteTemplate()).toBe("/patients/:id");
    stop();
  });
});

describe("installPageTelemetry", () => {
  it("sends nothing while the page is visible and below the limit", async () => {
    const { router, sent, tick, settle } = setup();
    tick(5_000);
    router.go("/queue");
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("sends views and visible time per route template when the tab is hidden", async () => {
    const { router, doc, sent, tick, settle } = setup();
    tick(4_000);
    router.go("/queue");
    tick(1_000);
    doc.set("hidden");
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("/api/v1/telemetry");
    expect(sent[0]?.token).toBe("token-1");
    expect(list(sent[0]?.body, "pages")).toEqual([
      { route: "/patients/:id", views: 1, visible_ms: 4_000 },
      { route: "/queue", views: 1, visible_ms: 1_000 },
    ]);
    // Hidden time is not visible time, and nothing goes out while hidden.
    tick(60_000);
    await settle();
    expect(sent).toHaveLength(1);
    doc.set("visible");
    tick(2_000);
    doc.set("hidden");
    await settle();
    expect(list(sent[1]?.body, "pages")).toEqual([{ route: "/queue", views: 0, visible_ms: 2_000 }]);
  });

  it("sends at fifty queued entries without waiting for the tab to hide", async () => {
    const { router, sent, settle } = setup("/r0");
    for (let i = 1; i < MAX_QUEUED; i += 1) router.go(`/r${String(i)}`);
    await settle();
    expect(sent).toHaveLength(1);
    // Each route left adds its page and its layout-shift reading.
    const body = sent[0]?.body;
    expect(list(body, "pages").length + list(body, "vitals").length + list(body, "errors").length).toBe(MAX_QUEUED);
  });

  it("uses no timer", () => {
    vi.useFakeTimers();
    const { router, doc, stop } = setup();
    router.go("/queue");
    doc.set("hidden");
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("posts with keepalive and the bearer token by default", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    const router = fakeRouter("/today");
    const doc = fakeDocument();
    installPageTelemetry({ router, getToken: () => Promise.resolve("abc"), document: doc, window: new EventTarget(), observe: () => null, apiBase: "" });
    doc.set("hidden");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/telemetry");
    const init = call?.[1];
    expect(init?.keepalive).toBe(true);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer abc");
  });

  it("drops the batch when signed out", async () => {
    const { doc, sent, settle } = setup("/today", null);
    doc.set("hidden");
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("reads page speed with its own observers and counts errors by class only", async () => {
    const { router, doc, win, perf, sent, settle } = setup("/today");
    perf.emit("navigation", [{ responseStart: 180.4 }]);
    perf.emit("largest-contentful-paint", [{ startTime: 900 }, { startTime: 1_400.6 }]);
    perf.emit("layout-shift", [{ value: 0.05, startTime: 100 }, { value: 0.02, startTime: 400 }, { value: 0.5, startTime: 500, hadRecentInput: true }]);
    perf.emit("event", [{ interactionId: 7, duration: 96 }, { interactionId: 0, duration: 400 }]);
    const error = new Event("error");
    Object.assign(error, { error: new TypeError("cannot read 'name' of Asha Rao") });
    win.dispatchEvent(error);
    router.go("/patients/:id");
    doc.set("hidden");
    await settle();
    const body = sent[0]?.body;
    expect(list(body, "vitals")).toEqual(
      expect.arrayContaining([
        { route: "/today", name: "ttfb", value: 180 },
        { route: "/today", name: "lcp", value: 1_401 },
        { route: "/today", name: "cls", value: 0.07 },
        { route: "/today", name: "inp", value: 96 },
        { route: "/patients/:id", name: "cls", value: 0 },
      ]),
    );
    expect(list(body, "errors")).toEqual([{ route: "/today", class: "type_error", count: 1 }]);
    expect(JSON.stringify(body)).not.toContain("Asha");
  });

  it("classifies errors without their messages", () => {
    expect(errorClass(new TypeError("Failed to fetch"), "error")).toBe("network");
    expect(errorClass(new TypeError("Failed to fetch dynamically imported module: /a.js"), "error")).toBe("chunk_load");
    expect(errorClass(new ReferenceError("x"), "error")).toBe("reference_error");
    expect(errorClass({ patient: "Asha" }, "unhandledrejection")).toBe("unhandled_rejection");
    expect(errorClass(null, "error")).toBe("other");
  });

  it("stops listening when uninstalled", async () => {
    const { doc, sent, stop, settle } = setup();
    stop();
    doc.set("hidden");
    await settle();
    expect(sent).toHaveLength(0);
  });
});
