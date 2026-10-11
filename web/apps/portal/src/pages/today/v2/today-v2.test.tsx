import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { success, type ApiClient, type DashboardLayout, type Today } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { greeting } from "../today-page.js";
import { SHOW_MONEY_KEY } from "./money.js";
import { salutation } from "./today-v2.js";

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

const asFrontDesk = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = ROLES.frontDesk;
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

/** A backend whose day says it is `asOf`, so the greeting can be tried at any hour of the clinic's day. */
const atTime = (asOf: string) => (client: ApiClient): ApiClient => ({
  ...client,
  getToday: async (options) => {
    const real = await client.getToday(options);
    return real.ok && options?.date === undefined ? success({ ...real.value, as_of: asOf }) : real;
  },
});

/** The text of the key numbers, the next-up hero and the appointments table: everything on the right of the page. */
function rightSide(): string {
  const table = screen.getByRole("table", { name: "Appointments" });
  const numbers = screen.getByRole("list", { name: "Key numbers" });
  const hero = screen.getByRole("region", { name: "Next up" });
  return [numbers, hero, table].map((el) => el.textContent).join("|");
}

describe("greeting", () => {
  it.each([
    ["2026-10-11T04:00:00Z", "Good morning"],
    ["2026-10-11T09:30:00Z", "Good afternoon"],
    ["2026-10-11T15:00:00Z", "Good evening"],
  ])("at %s the clinic is told %s", (asOf, words) => {
    expect(greeting(asOf, "Asia/Kolkata")).toBe(words);
  });

  it("is chosen by the clinic's clock and names the doctor", async () => {
    renderPortal("/today", { as: PEOPLE.asha, wrap: atTime("2026-10-11T15:00:00Z") });
    // 15:00 UTC is 20:30 in the clinic, so it is evening there.
    expect(await screen.findByRole("heading", { level: 1, name: "Good evening, Dr. Asha Kulkarni" })).toBeTruthy();
    expect(screen.getByText(/^Sunday, 11 October · Sunrise Dental/)).toBeTruthy();
  });

  it("calls someone who is not a doctor by their plain name", () => {
    expect(salutation("Farah Sheikh", false)).toBe("Farah Sheikh");
    expect(salutation("Dr Asha Kulkarni", true)).toBe("Dr. Asha Kulkarni");
    expect(salutation("Asha Kulkarni", true)).toBe("Dr. Asha Kulkarni");
  });
});

describe("Today v2", () => {
  it("draws the MedSync layout: greeting, key numbers, the next-up hero, the table and the calendar column", async () => {
    renderPortal("/today", { as: PEOPLE.asha, backend: withLabs() });
    expect(await screen.findByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Dr\. Asha Kulkarni$/ })).toBeTruthy();
    const numbers = await screen.findByRole("list", { name: "Key numbers" });
    for (const label of ["Appointments today", "In chair now", "Waiting", "Collected today", "Lab cases due"]) {
      expect(await within(numbers).findByText(label)).toBeTruthy();
    }
    expect(await screen.findByRole("region", { name: "Next up" })).toBeTruthy();
    expect(await screen.findByRole("table", { name: "Appointments" })).toBeTruthy();
    const side = screen.getByRole("complementary", { name: "Side panel" });
    expect(within(side).getByRole("grid")).toBeTruthy();
    expect(await within(side).findByRole("heading", { name: "Patient queue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Customise" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start next visit" })).toBeTruthy();
  });

  it("shows the lab tile's sent, due and arrived counts", async () => {
    renderPortal("/today", { as: PEOPLE.asha, backend: withLabs() });
    const numbers = await screen.findByRole("list", { name: "Key numbers" });
    const tile = (await within(numbers).findByText("Lab cases due")).closest("li");
    await waitFor(() => { expect(tile?.textContent).toMatch(/\d+ sent · \d+ due · \d+ arrived/); });
  });

  it("gives a front desk member Register walk-in and no collected tile", async () => {
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk() });
    await screen.findByRole("table", { name: "Appointments" });
    expect(screen.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Farah/ })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toMatch(/Dr/);
    expect(screen.getByRole("button", { name: "Register walk-in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start next visit/ })).toBeNull();
  });

  it("puts the calendar column on the left, full height", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const board = (await screen.findByRole("table", { name: "Appointments" })).closest(".tv2");
    expect(board?.getAttribute("data-side")).toBe("left");
    expect(board?.getAttribute("data-density")).toBe("cozy");
    const frame = board?.querySelector(".tv2-frame");
    // The side column is a child of the frame beside the content, not of the key numbers' column.
    expect(frame?.firstElementChild?.classList.contains("tv2-rail")).toBe(true);
  });

  it("lists the appointments with their time, patient, type, visit, chair and status, sortable", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "Appointments" });
    for (const name of ["Time", "Patient", "Type", "Visit", "Chair", "Status"]) {
      expect(within(table).getByRole("button", { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
  });

  it("picking a day changes only the calendar column; the right side stays on today", async () => {
    const day = "2026-10-01";
    const backend = fakeApi();
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
    await screen.findByRole("table", { name: "Appointments" });
    await screen.findByRole("region", { name: "Next up" });
    const before = rightSide();
    const side = screen.getByRole("complementary", { name: "Side panel" });
    await userEvent.setup().click(within(side).getByRole("button", { name: /^[A-Za-z]+,? 1 October 2026/ }));
    await waitFor(() => { expect(dates).toContain(day); });
    // The column now shows that day, and a way back.
    expect(await within(side).findByRole("button", { name: "Back to today" })).toBeTruthy();
    // Nothing on the right moved, and nothing on the right asked for that day.
    expect(rightSide()).toBe(before);
    // Only the column asked for that day; today's key numbers and table did not.
    expect(dates.filter((d) => d === undefined).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Viewing /)).toBeNull();
    // Back to today returns the column.
    await userEvent.setup().click(within(side).getByRole("button", { name: "Back to today" }));
    await waitFor(() => { expect(within(side).queryByRole("button", { name: "Back to today" })).toBeNull(); });
    expect(rightSide()).toBe(before);
  });

  it("opens on a day from the address: that day's completed visits are in the column, the right side is today", async () => {
    const { backend, day, patient } = withClosedVisit();
    renderPortal(`/today?date=${day}`, { as: PEOPLE.asha, backend });
    const side = await screen.findByRole("complementary", { name: "Side panel" });
    expect(await within(side).findByRole("button", { name: "Back to today" })).toBeTruthy();
    const completed = await screen.findByRole("list", { name: "Completed visits" });
    expect(within(completed).getByText(new RegExp(patient.split(" ")[0] ?? "", "i"))).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Appointments" })).queryByText(new RegExp(patient, "i"))).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: /^Good / })).toBeTruthy();
  });

  it("has no axe violations", async () => {
    renderPortal("/today", { as: PEOPLE.asha, backend: withLabs() });
    await screen.findByRole("table", { name: "Appointments" });
    await screen.findByRole("region", { name: "Next up" });
    await screen.findByRole("heading", { name: "Patient queue" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

describe("next up", () => {
  it("moves through the next three with its arrows and stops at each end", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const hero = await screen.findByRole("region", { name: "Next up" });
    const user = userEvent.setup();
    const eyebrow = () => hero.querySelector(".tv2-hero-eyebrow")?.textContent ?? "";
    const name = () => hero.querySelector(".tv2-hero-name span")?.textContent ?? "";
    const first = name();
    expect(eyebrow()).toMatch(/^(In the chair|Next up) · /);
    expect(within(hero).getByRole("button", { name: "Previous patient" }).hasAttribute("disabled")).toBe(true);
    await user.click(within(hero).getByRole("button", { name: "Next patient" }));
    expect(eyebrow()).toMatch(/^Then · #2 · /);
    expect(name()).not.toBe(first);
    await user.click(within(hero).getByRole("button", { name: "Next patient" }));
    expect(eyebrow()).toMatch(/^Then · #3 · /);
    expect(within(hero).getByRole("button", { name: "Next patient" }).hasAttribute("disabled")).toBe(true);
    await user.click(within(hero).getByRole("button", { name: "Previous patient" }));
    await user.click(within(hero).getByRole("button", { name: "Previous patient" }));
    expect(name()).toBe(first);
  });
});

describe("money stays hidden until the eye is pressed", () => {
  const collected = () => screen.queryByText("Collected today")?.closest("li");

  it("hides the collected tile by default, shows it on the eye, and remembers the choice", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    await screen.findByRole("list", { name: "Key numbers" });
    const tile = await waitFor(() => {
      const found = collected();
      if (found == null) throw new Error("no collected tile yet");
      return found;
    });
    expect(tile.textContent).not.toMatch(/₹\s?[\d,]/);
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBeNull();
    const user = userEvent.setup();
    await user.click(within(tile).getByRole("button", { name: "Show collected today" }));
    await waitFor(() => { expect(collected()?.textContent).toMatch(/₹\s?[\d,]+/); });
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBe("1");
    const shown = collected();
    if (shown == null) throw new Error("no collected tile");
    await user.click(within(shown).getByRole("button", { name: "Hide collected today" }));
    await waitFor(() => { expect(collected()?.textContent).not.toMatch(/₹\s?[\d,]+/); });
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBe("0");
  });

  it("starts shown for someone who chose to see money", async () => {
    localStorage.setItem(SHOW_MONEY_KEY, "1");
    renderPortal("/today", { as: PEOPLE.asha });
    await waitFor(() => { expect(collected()?.textContent).toMatch(/₹\s?[\d,]+/); });
  });

  it("gives every money widget the same eye, hidden by default and fetching nothing until it is pressed", async () => {
    const calls = { collections: 0, money: 0 };
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient): ApiClient => ({
        ...client,
        getMyDashboardLayout: async () => {
          const real = await client.getMyDashboardLayout();
          return real.ok
            ? success({
                ...real.value,
                layout: { ...only("collections"), items: ["collections", "revenue_mix", "pending_payments"].map((key) => ({ key, zone: "main", size: "L", opts: {} })) },
              })
            : real;
        },
        getCollections: (range, options?) => {
          calls.collections += 1;
          return client.getCollections(range, options);
        },
        getTodayMoney: (options?) => {
          calls.money += 1;
          return client.getTodayMoney(options);
        },
      }),
    });
    expect(await screen.findByRole("heading", { name: "Collections" })).toBeTruthy();
    expect(screen.getAllByText(/Hidden\. Press the eye/)).toHaveLength(3);
    expect(calls).toEqual({ collections: 0, money: 0 });
    const eyes = screen.getAllByRole("button", { name: /^Show / });
    expect(eyes).toHaveLength(3);
    const [firstEye] = eyes;
    if (firstEye === undefined) throw new Error("no eye");
    await userEvent.setup().click(firstEye);
    // One setting for all of them.
    await waitFor(() => { expect(screen.queryAllByText(/Hidden\. Press the eye/)).toHaveLength(0); });
    expect(screen.getAllByRole("button", { name: /^Hide / })).toHaveLength(3);
    await waitFor(() => { expect(calls.collections).toBeGreaterThan(0); });
  });

  it("shows no money, and no eye, to a role without finance.view even when the setting is on", async () => {
    localStorage.setItem(SHOW_MONEY_KEY, "1");
    renderPortal("/today", { as: PEOPLE.farah, backend: asAssistant() });
    await screen.findByRole("table", { name: "Appointments" });
    const numbers = await screen.findByRole("list", { name: "Key numbers" });
    expect(within(numbers).queryByText("Collected today")).toBeNull();
    expect(within(numbers).getByText("Appointments today")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(Show|Hide) / })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Side panel" }).textContent).not.toMatch(/₹/);
  });

  it("keeps the money widgets off a role without finance.view even when a layout asks for them", async () => {
    renderPortal("/today", {
      as: PEOPLE.farah,
      backend: asAssistant(),
      wrap: (client: ApiClient): ApiClient => ({
        ...client,
        getMyDashboardLayout: async () => {
          const real = await client.getMyDashboardLayout();
          return real.ok
            ? success({
                ...real.value,
                layout: { ...only("pending_payments"), items: ["appointments", "pending_payments", "collections", "revenue_mix"].map((key) => ({ key, zone: "main", size: "L", opts: {} })) },
              })
            : real;
        },
      }),
    });
    await screen.findByRole("table", { name: "Appointments" });
    for (const hidden of ["Collections", "Revenue mix", "Pending payments"]) {
      expect(screen.queryByRole("heading", { name: hidden })).toBeNull();
    }
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
    localStorage.setItem(SHOW_MONEY_KEY, "1");
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
