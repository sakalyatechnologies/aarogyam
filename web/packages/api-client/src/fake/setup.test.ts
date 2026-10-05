import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";
import { freshSetup } from "./setup.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";

function world() {
  const fixtures = createFixtures({ now: NOW });
  const clinic = fixtures.clinics.find((c) => c.host === SUNRISE);
  if (clinic === undefined) throw new Error("expected Sunrise");
  fixtures.setups = [freshSetup(`clinic:${clinic.id}`)];
  const backend = createFakeBackend(fixtures);
  const as = (who: string): ApiClient => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as, fixtures };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

describe("fake setup", () => {
  it("keeps the owner's progress per step and reopens it", async () => {
    const { as } = world();
    const owner = as(ASHA);
    expect(value(await owner.getSetup()).standing).toBe("new");
    const first = value(await owner.updateSetup({ step: "clinic", status: "done", practice: "solo" }));
    expect(first).toMatchObject({ standing: "in_progress", practice: "solo" });
    for (const step of ["hours", "look", "services", "team"]) {
      await owner.updateSetup({ step, status: "skipped" });
    }
    expect(value(await owner.getSetup()).standing).toBe("complete");
    expect(value(await owner.updateSetup({ step: "look", status: "todo" })).standing).toBe("in_progress");
    expect(value(await owner.updateSetup({ dismissed: true })).standing).toBe("dismissed");
    expect(errorOf(await owner.updateSetup({ step: "profile", status: "done" }))?.status).toBe(400);
    expect(errorOf(await owner.updateSetup({ practice: "chain" }))?.status).toBe(400);
  });

  it("needs settings.manage for the clinic, and counts older clinics as set up", async () => {
    const { as } = world();
    expect(errorOf(await as(FARAH).getSetup())?.status).toBe(403);
    // Dev has no entry of their own: a person from before the wizard.
    expect(value(await as(DEV).getMySetup()).standing).toBe("dismissed");
  });

  it("lets a doctor edit only their own record and hours", async () => {
    const { as, fixtures } = world();
    const dev = as(DEV);
    const doctor = fixtures.practitioners.find((p) => p.membership_id !== undefined && p.membership_id !== null && fixtures.memberships.some((m) => m.id === p.membership_id && m.user_id === DEV));
    if (doctor === undefined) throw new Error("expected Dev's doctor record");
    const changed = value(await dev.changeMyPractitioner({ qualifications: "BDS", registration_number: "MH-1", calendar_color: "#000000" }));
    expect(changed).toMatchObject({ qualifications: "BDS", registration_number: "MH-1" });
    expect(changed.calendar_color).toBe(doctor.calendar_color);
    expect(errorOf(await as(FARAH).getMyPractitioner())?.status).toBe(404);
    const hours = { shifts: [{ weekday: 1, starts: "09:00", ends: "13:00" }, { weekday: 1, starts: "17:00", ends: "20:00" }] };
    expect(value(await dev.setMyWorkingHours(hours)).shifts).toHaveLength(2);
    expect(errorOf(await dev.setMyWorkingHours({ shifts: [{ weekday: 2, starts: "09:00", ends: "13:00" }, { weekday: 2, starts: "12:00", ends: "14:00" }] }))?.status).toBe(400);
    expect(value(await dev.getMyWorkingHours()).shifts).toHaveLength(2);
  });

  it("makes a doctor record on first save for someone who can issue prescriptions", async () => {
    const { as, fixtures } = world();
    // Asha is the owner; drop her record to start from a member with none.
    fixtures.practitioners = fixtures.practitioners.filter((p) => !fixtures.memberships.some((m) => m.id === p.membership_id && m.user_id === ASHA));
    const owner = as(ASHA);
    expect(errorOf(await owner.getMyPractitioner())?.status).toBe(404);
    const made = value(await owner.changeMyPractitioner({ qualifications: "BDS, MDS" }));
    expect(made).toMatchObject({ qualifications: "BDS, MDS", display_name: "Asha Kulkarni" });
    expect(value(await owner.getMyPractitioner()).id).toBe(made.id);
    // The front desk cannot be a doctor.
    expect(errorOf(await as(FARAH).changeMyPractitioner({ qualifications: "BDS" }))?.status).toBe(404);
  });
});
