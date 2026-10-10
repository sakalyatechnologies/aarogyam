import { describe, expect, it } from "vitest";

import { practitionerId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";

function setup() {
  const fixtures = createFixtures({ now: NOW });
  const backend = createFakeBackend(fixtures);
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as, fixtures };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const status = <T>(result: ApiResult<T>): number | undefined => (result.ok ? undefined : result.error.status);

describe("fake client: Today for a chosen day", () => {
  it("returns the new counts and an empty completed list for today", async () => {
    const { as } = setup();
    const today = value(await as(ASHA).getToday());
    expect(today.counts.called).toBe(0);
    expect(today.counts.ready_to_bill).toBe(0);
    expect(Array.isArray(today.completed_visits)).toBe(true);
  });

  it("shows a past day's appointments and a future day's bookings, and refuses a bad date", async () => {
    const { as } = setup();
    const past = value(await as(ASHA).getToday({ date: "2026-10-01" }));
    expect(past.date).toBe("2026-10-01");
    expect(past.attention).toEqual([]);
    const future = value(await as(ASHA).getToday({ date: "2026-10-09" }));
    expect(future.date).toBe("2026-10-09");
    expect(status(await as(ASHA).getToday({ date: "10/01/2026" }))).toBe(400);
  });

  it("lists a day's completed visits, with bill figures only for finance.view", async () => {
    const { as, fixtures } = setup();
    const visit = fixtures.visits.find((v) => v.status === "closed" && v.ended_at != null);
    if (visit?.ended_at == null) throw new Error("fixtures hold no closed visit");
    const day = new Date(new Date(visit.ended_at).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

    const owner = value(await as(ASHA).getToday({ date: day }));
    const mine = owner.completed_visits.find((v) => v.visit_id === visit.id);
    expect(mine).toBeDefined();
    expect(mine?.billed_paise).toBeDefined();
    expect(owner.money).toBeDefined();

    const doctor = value(await as(DEV).getToday({ date: day }));
    expect(doctor.completed_visits.find((v) => v.visit_id === visit.id)?.billed_paise).toBeUndefined();
    expect(doctor.money).toBeUndefined();
  });

  it("gives a month's days with their load", async () => {
    const { as } = setup();
    const month = value(await as(ASHA).getMonthSummary("2026-10"));
    expect(month.month).toBe("2026-10");
    expect(month.days).toHaveLength(31);
    expect(month.days.some((d) => d.total > 0)).toBe(true);
    expect(status(await as(ASHA).getMonthSummary("2026-13"))).toBe(400);
  });

  it("needs labs.read, which no fake role holds yet because the fake keeps no lab orders", async () => {
    const { as } = setup();
    expect(status(await as(ASHA).listOpenLabOrders())).toBe(403);
  });
});

describe("fake client: queue call and states", () => {
  it("lets the doctor call a waiting patient, then seat, bill and finish, and filters by doctor", async () => {
    const { as } = setup();
    const waiting = value(await as(FARAH).listQueue(undefined)).items.find((t) => t.status === "waiting");
    if (waiting === undefined) throw new Error("fixtures hold no waiting token");

    expect(status(await as(FARAH).callQueueToken(waiting.id))).toBe(403);
    const called = value(await as(DEV).callQueueToken(waiting.id));
    expect(called.status).toBe("called");
    expect(value(await as(DEV).callQueueToken(waiting.id)).status).toBe("called");
    expect(value(await as(FARAH).getToday()).counts.called).toBe(1);

    expect(status(await as(FARAH).setQueueStatus(waiting.id, { status: "ready_to_bill" }))).toBe(409);
    expect(value(await as(FARAH).setQueueStatus(waiting.id, { status: "in_chair" })).status).toBe("in_chair");
    expect(value(await as(FARAH).setQueueStatus(waiting.id, { status: "ready_to_bill" })).status).toBe("ready_to_bill");
    expect(value(await as(FARAH).getToday()).counts.ready_to_bill).toBe(1);
    expect(value(await as(FARAH).setQueueStatus(waiting.id, { status: "done" })).status).toBe("done");
    expect(status(await as(DEV).callQueueToken(waiting.id))).toBe(409);

    const none = value(await as(FARAH).listQueue(undefined, { practitionerId: practitionerId.parse("00000000-0000-4000-8000-00000000ffff") }));
    expect(none.items).toEqual([]);
  });
});

describe("fake client: weekly collections", () => {
  it("covers exactly the asked weeks, Monday to Monday, and refuses a bad count", async () => {
    const { as } = setup();
    const report = value(await as(ASHA).getCollections({ weeks: 8 }));
    expect(report.by_week).toHaveLength(8);
    expect(report.from).toBe("2026-08-10");
    expect(report.to).toBe("2026-10-03");
    expect(status(await as(ASHA).getCollections({ weeks: 0 }))).toBe(400);
    expect(status(await as(ASHA).getCollections({ weeks: 53 }))).toBe(400);
    expect(status(await as(ASHA).getCollections({ weeks: 4, from: "2026-09-01" }))).toBe(400);
    expect(status(await as(FARAH).getCollections({ weeks: 4 }))).toBe(403);
  });
});
