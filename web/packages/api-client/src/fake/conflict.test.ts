import { describe, expect, it } from "vitest";

import { appointmentId, practitionerId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}
const aid = (v: string) => appointmentId.parse(v);
const pid = (v: string | undefined) => practitionerId.parse(v);
const errorOf = <T>(result: ApiResult<T>) => (result.ok ? null : { status: result.error.status, code: result.error.code });

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (id: string): ApiClient => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id }), now: () => NOW });
  const patient = (n: number): ApiClient =>
    backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: `d0d0d0d0-0000-4000-8000-00000000010${String(n)}`, email: `p${String(n)}@example.test` }), now: () => NOW });
  return { as, patient };
}

async function requestTaken(patient: ApiClient) {
  const doctor = value(await patient.getBookingOptions()).doctors[0]?.id ?? "";
  const slot = value(await patient.getAvailability("2026-10-05", doctor)).slots[0] ?? "";
  // Another booking is confirmed there, then a second person asks for the same time.
  return { doctor, slot };
}

describe("fake client: a taken time can be requested", () => {
  it("lists requestable slots, books a request, notifies staff, then confirm 409s until double-booked or moved", async () => {
    const { as, patient } = setup();
    const { doctor, slot } = await requestTaken(patient(1));
    const owner = as(ASHA);
    const first = value(await patient(1).createOnlineBooking({ starts_at: slot, practitioner_id: doctor, full_name: "Priya Nair", phone: "9876543210" }));
    // A held time that is still only a request doesn't block confirming, so confirm the first one.
    value(await owner.setAppointmentStatus(aid(first.id), { status: "confirmed" }));

    const second = patient(2);
    expect(value(await second.getAvailability("2026-10-05", doctor)).requestable_slots).toContain(slot);
    const asked = value(await second.createOnlineBooking({ starts_at: slot, practitioner_id: doctor, full_name: "Meera Iyer", phone: "9876543211" }));
    expect(asked.status).toBe("requested");

    const bell = value(await owner.listNotifications()).items.find((n) => n.kind === "booking_conflict");
    expect(bell?.appointment?.id).toBe(asked.id);

    expect(errorOf(await owner.setAppointmentStatus(aid(asked.id), { status: "confirmed" }))).toEqual({ status: 409, code: "slot_occupied" });
    // Move into a free time confirms in one step; into a held time is refused.
    expect(errorOf(await owner.moveAppointment(aid(asked.id), { starts_at: slot }))).toEqual({ status: 409, code: "slot_occupied" });
    const moved = value(await owner.moveAppointment(aid(asked.id), { starts_at: "2026-10-05T11:00:00+05:30" }));
    expect(moved.appointment.status).toBe("confirmed");
    expect(Date.parse(moved.appointment.starts_at)).toBe(Date.parse("2026-10-05T11:00:00+05:30"));
  });

  it("double_book confirms into the held time", async () => {
    const { as, patient } = setup();
    const { doctor, slot } = await requestTaken(patient(1));
    const owner = as(ASHA);
    const first = value(await patient(1).createOnlineBooking({ starts_at: slot, practitioner_id: doctor, full_name: "Priya Nair", phone: "9876543210" }));
    value(await owner.setAppointmentStatus(aid(first.id), { status: "confirmed" }));
    const asked = value(await patient(2).createOnlineBooking({ starts_at: slot, practitioner_id: doctor, full_name: "Meera Iyer", phone: "9876543211" }));
    const done = value(await owner.setAppointmentStatus(aid(asked.id), { status: "confirmed", double_book: true }));
    expect(done.appointment.status).toBe("confirmed");
  });

  it("a doctor's own policy: strict hides requestable slots; owner edits any, a doctor only their own", async () => {
    const { as, patient } = setup();
    const owner = as(ASHA);
    const practitioners = value(await owner.listPractitioners()).items;
    const ashaDoc = practitioners.find((p) => p.membership_id != null && p.display_name.length > 0);
    const devDoc = practitioners.find((p) => p.id !== ashaDoc?.id && p.membership_id != null);
    expect(ashaDoc && devDoc).toBeTruthy();
    expect(value(await owner.getConflictPolicy(pid(devDoc?.id)))).toEqual({ conflict_policy: null });
    expect(value(await owner.setConflictPolicy(pid(devDoc?.id), { conflict_policy: "strict" }))).toEqual({ conflict_policy: "strict" });
    // The doctor edits their own; not a colleague's; front desk none.
    const dev = as(DEV);
    expect(value(await dev.setConflictPolicy(pid(devDoc?.id), { conflict_policy: null }))).toEqual({ conflict_policy: null });
    expect(errorOf(await dev.setConflictPolicy(pid(ashaDoc?.id), { conflict_policy: "strict" }))?.status).toBe(403);
    expect(errorOf(await as(FARAH).getConflictPolicy(pid(devDoc?.id)))?.status).toBe(403);

    value(await owner.setConflictPolicy(pid(ashaDoc?.id), { conflict_policy: "strict" }));
    const p = patient(3);
    const doctor = ashaDoc?.id ?? "";
    const slot = value(await p.getAvailability("2026-10-05", doctor)).slots[0] ?? "";
    value(await p.createOnlineBooking({ starts_at: slot, practitioner_id: doctor, full_name: "A B", phone: "9876543210" }));
    expect(value(await patient(4).getAvailability("2026-10-05", doctor)).requestable_slots).toEqual([]);
  });
});
