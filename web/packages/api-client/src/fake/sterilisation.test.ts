import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const START = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

const as = (who: string, host = SUNRISE): ApiClient =>
  createFakeBackend(createFixtures({ now: START })).client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => START });

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${String(result.error.status)} ${result.error.message}`);
  return result.value;
}

describe("fake client: sterilisation cycles", () => {
  it("records a cycle and lists it, latest first, with the count on Today", async () => {
    const owner = as(ASHA);
    const first = value(await owner.recordSterilisationCycle({ load_note: "  Handpieces " }));
    expect(first).toMatchObject({ load_note: "Handpieces", run_at: START.toISOString() });
    value(await owner.recordSterilisationCycle({}));
    const list = value(await owner.listSterilisationCycles());
    expect(list.items).toHaveLength(2);
    expect(value(await owner.listSterilisationCycles("2026-10-02")).items).toHaveLength(0);
    expect(value(await owner.getToday({})).sterilisation_cycles_today).toBe(2);
  });

  it("refuses a long note and a bad date", async () => {
    const owner = as(ASHA);
    const long = await owner.recordSterilisationCycle({ load_note: "x".repeat(121) });
    expect(long.ok ? 200 : long.error.status).toBe(400);
    const bad = await owner.listSterilisationCycles("yesterday");
    expect(bad.ok ? 200 : bad.error.status).toBe(400);
  });

  it("keeps each clinic's cycles to itself", async () => {
    const backend = createFakeBackend(createFixtures({ now: START }));
    const client = (who: string, host: string) => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => START });
    value(await client(ASHA, SUNRISE).recordSterilisationCycle({}));
    expect(value(await client(BINA, LOTUS).listSterilisationCycles()).items).toHaveLength(0);
  });
});
