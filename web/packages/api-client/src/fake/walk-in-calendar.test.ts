import { describe, expect, it } from "vitest";

import { queueTokenId, roomId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const DAY = "2026-10-03";
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("walk-ins on the calendar (fake, same contract as the API)", () => {
  it("lists a visit started from a walk-in token, never one tied to an appointment, and keeps clinics apart", async () => {
    const { as } = setup();
    const walkIn = value(await as(FARAH).registerWalkIn({ patient: { full_name: "Meera Iyer" } }));
    const visit = value(await as(ASHA).startVisitFromQueue(walkIn.token.id)).visit;

    const listed = value(await as(FARAH).listWalkIns({ from: DAY, to: DAY })).items;
    const item = listed.find((w) => w.visit_id === visit.id);
    expect(item?.status).toBe("open");
    expect(item?.patient.full_name).toBe("Meera Iyer");
    expect(item?.token_number).toBe(walkIn.token.token_number);
    expect(item?.starts_at).toBe(NOW.toISOString());
    expect(item && "ends_at" in item).toBe(false);

    // A booked patient who arrived and was started from their token shows as the appointment.
    const appointment = value(await as(FARAH).listAppointments({ from: DAY, to: DAY })).items.find((a) => a.status === "booked" || a.status === "confirmed");
    if (appointment === undefined) throw new Error("the fixtures book someone today");
    const arrived = value(await as(FARAH).setAppointmentStatus(appointment.id, { status: "arrived" }));
    const booked = value(await as(ASHA).startVisitFromQueue(queueTokenId.parse(arrived.queue_token_id))).visit;
    const again = value(await as(FARAH).listWalkIns({ from: DAY, to: DAY })).items;
    expect(again.some((w) => w.visit_id === booked.id)).toBe(false);
    expect(again.some((w) => w.visit_id === visit.id)).toBe(true);

    expect(value(await as(BINA, LOTUS).listWalkIns({ from: DAY, to: DAY })).items.some((w) => w.visit_id === visit.id)).toBe(false);
    const other = await as(FARAH).listWalkIns({ from: DAY, to: DAY, roomId: roomId.parse("not-a-room") });
    expect(value(other).items).toEqual([]);
  });

  it("derives older walk-ins from fixture visits without an appointment, closed with an end", async () => {
    const { as } = setup();
    const items = value(await as(ASHA).listWalkIns({ from: "2026-09-01", to: "2026-09-30" })).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.status).toBe("closed");
      expect(item.ends_at).toBeTruthy();
    }
  });
});
