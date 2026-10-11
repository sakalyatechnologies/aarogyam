import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { success, type ApiClient, type DashboardLayout, type Today } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const asAssistant = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = ROLES.assistant;
  });

/** The fakes' owner role has no `labs.read` yet; this one does, so the lab widget can be seen. */
const withLabs = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha);
    if (membership !== undefined) membership.role = { ...ROLES.owner, permissions: [...ROLES.owner.permissions, "labs.read"] };
  });

/** A backend, with the day a seeded visit was closed (in the clinic's time, 5.5 hours ahead of UTC) and its patient. */
function withClosedVisit() {
  const found = { day: "", patient: "" };
  const backend = fakeApi((fixtures) => {
    const visit = fixtures.visits.find((v) => v.status === "closed" && v.ended_at != null);
    if (visit?.ended_at == null) throw new Error("fixtures hold no closed visit");
    found.day = new Date(new Date(visit.ended_at).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    found.patient = fixtures.patients.find((p) => p.id === visit.patient_id)?.full_name ?? "";
  });
  return { backend, ...found };
}

describe("Today v2", () => {
  it("draws the saved layout for an owner: key numbers, the table, labs and the money widgets", async () => {
    renderPortal("/today", { as: PEOPLE.asha, backend: withLabs() });
    expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Key numbers" })).toBeTruthy();
    expect(await screen.findByRole("table", { name: "Appointments" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Lab work" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Collections" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Side panel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Customise" })).toBeNull();
  });

  it("shows no money or lab widgets to an assistant, who lacks finance.view and labs.read", async () => {
    renderPortal("/today", { as: PEOPLE.farah, backend: asAssistant() });
    await screen.findByRole("table", { name: "Appointments" });
    const numbers = await screen.findByRole("list", { name: "Key numbers" });
    expect(within(numbers).queryByText("Collected")).toBeNull();
    expect(within(numbers).getByText("Appointments")).toBeTruthy();
    for (const hidden of ["Collections", "Revenue mix", "Pending payments", "Lab work"]) {
      expect(screen.queryByRole("heading", { name: hidden })).toBeNull();
    }
  });

  it("takes the layout's density, card style and rail side", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const board = (await screen.findByRole("table", { name: "Appointments" })).closest(".tv2");
    expect(board?.getAttribute("data-side")).toBe("right");
    expect(board?.getAttribute("data-density")).toBe("cozy");
  });

  it("shows a picked day's queue and completed visits, and Back to today returns", async () => {
    const { backend, day, patient } = withClosedVisit();
    renderPortal(`/today?date=${day}`, { as: PEOPLE.asha, backend });
    expect(await screen.findByText(/Viewing /)).toBeTruthy();
    const completed = await screen.findByRole("list", { name: "Completed visits" });
    expect(within(completed).getByText(new RegExp(patient.split(" ")[0] ?? "", "i"))).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back to today" }));
    await waitFor(() => { expect(screen.queryByText(/Viewing /)).toBeNull(); });
    expect(screen.queryByRole("list", { name: "Completed visits" })?.children.length ?? 0).toBeLessThanOrEqual(0);
  });

  it("picking a day on the calendar refetches that day", async () => {
    const { backend } = withClosedVisit();
    const day = "2026-10-01";
    const dates: (string | undefined)[] = [];
    renderPortal("/today", {
      as: PEOPLE.asha,
      backend,
      wrap: (client: ApiClient): ApiClient => ({
        ...client,
        getToday: (options) => {
          dates.push(options?.date);
          return client.getToday(options);
        },
      }),
    });
    const grid = await screen.findByRole("grid");
    await userEvent.setup().click(within(grid).getByRole("button", { name: /^[A-Za-z]+,? 1 October 2026/ }));
    await waitFor(() => { expect(dates).toContain(day); });
    expect(await screen.findByText(/Viewing /)).toBeTruthy();
  });

  it("has no axe violations", async () => {
    renderPortal("/today", { as: PEOPLE.asha, backend: withLabs() });
    await screen.findByRole("heading", { name: "Lab work" });
    await screen.findByRole("table", { name: "Appointments" });
    await screen.findByRole("heading", { name: "Collections" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

// Loading, empty and error states, one widget at a time -------------------------------------------

function only(key: string, zone: "top" | "main" | "rail" = "main"): DashboardLayout {
  return {
    v: 2,
    tpl: "medsync",
    density: "cozy",
    card: "soft",
    rail: { side: "right", width: "medium" },
    items: [{ key, zone, size: zone === "top" ? "full" : "L", opts: key === "kpis" ? { metrics: ["appointments", "completed", "waiting", "chairs_busy"] } : {} }],
  };
}

const never = <T,>() => new Promise<T>(() => undefined);

function wrapOnly(key: string, patch: (client: ApiClient) => Partial<ApiClient>) {
  return (client: ApiClient): ApiClient => ({
    ...client,
    getMyDashboardLayout: async () => {
      const real = await client.getMyDashboardLayout();
      return real.ok ? success({ ...real.value, layout: only(key, key === "kpis" ? "top" : "main") }) : real;
    },
    ...patch(client),
  });
}

const KEYS = ["kpis", "nextup", "chairs", "appointments", "attention", "labs", "calendar", "queue", "collections", "timeline", "recent_patients", "team_today", "revenue_mix", "pending_payments", "busy_hours"];

function emptyDay(real: Today): Today {
  return {
    ...real,
    counts: { ...real.counts, total: 0, booked: 0, arrived: 0, in_chair: 0, done: 0, cancelled: 0, no_shows: 0, waiting: 0, called: 0, ready_to_bill: 0 },
    appointments: [],
    by_hour: [],
    chairs: [],
    attention: [],
    recent_patients: [],
    team: [],
    low_stock: [],
    completed_visits: [],
  };
}

describe("every widget has a loading state", () => {
  it.each(KEYS)("%s", async (key) => {
    renderPortal("/today", {
      as: PEOPLE.asha,
      backend: withLabs(),
      wrap: wrapOnly(key, () => ({
        getToday: () => never(),
        listOpenLabOrders: () => never(),
        getCollections: () => never(),
        getTodayMoney: () => never(),
        getMonthSummary: () => never(),
      })),
    });
    const loading = await screen.findAllByRole("status", { name: /^Loading / });
    expect(loading.length).toBeGreaterThan(0);
  });
});

const EMPTY_TEXT: Readonly<Record<string, RegExp>> = {
  nextup: /No one is waiting/,
  chairs: /No chairs set up yet/,
  appointments: /No appointments/,
  attention: /Nothing needs attention/,
  labs: /No open lab work/,
  queue: /Nobody in the queue/,
  collections: /Nothing collected yet/,
  timeline: /No appointments/,
  team_today: /No one on the roster/,
  busy_hours: /No appointments/,
};

describe("widgets with nothing to show say so", () => {
  it.each(Object.entries(EMPTY_TEXT))("%s", async (key, text) => {
    renderPortal("/today", {
      as: PEOPLE.asha,
      backend: withLabs(),
      wrap: wrapOnly(key, (client) => ({
        getToday: async (options) => {
          const real = await client.getToday(options);
          return real.ok ? success(emptyDay(real.value)) : real;
        },
        listOpenLabOrders: () => Promise.resolve(success({ items: [] })),
        getCollections: async (range, options?) => {
          const real = await client.getCollections(range, options);
          return real.ok ? success({ ...real.value, by_week: [] }) : real;
        },
      })),
    });
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe("a widget whose data fails shows an error with a retry", () => {
  it("labs", async () => {
    const { failure, parseApiError } = await import("@aarogyam/api-client");
    renderPortal("/today", {
      as: PEOPLE.asha,
      backend: withLabs(),
      wrap: wrapOnly("labs", () => ({ listOpenLabOrders: () => Promise.resolve(failure(parseApiError(500, { code: "internal", message: "boom" }, undefined))) })),
    });
    expect(await screen.findByText(/Couldn't load Lab work/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeTruthy();
  });
});
