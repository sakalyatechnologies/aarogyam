import { describe, expect, it } from "vitest";

import { appointmentId, patientId, practitionerId, roomId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as };
}

describe("same-patient overlap warning (fake, mirrors the API)", () => {
  it("warns across doctors and chairs, on reschedule too, and ignores cancelled and other clinics", async () => {
    const { as } = setup();
    const desk = as(FARAH);
    const doctors = value(await desk.listPractitioners()).items;
    const [asha, dev] = [practitionerId.parse(doctors[0]?.id), practitionerId.parse(doctors[1]?.id)];
    const rooms = value(await desk.listRooms()).items;
    const [chair1, chair2] = [roomId.parse(rooms[0]?.id), roomId.parse(rooms[1]?.id)];
    const who = patientId.parse(value(await desk.listPatients()).items[0]?.id);
    const at = (start: string, end: string) => ({ starts_at: `2026-10-07T${start}:00+05:30`, ends_at: `2026-10-07T${end}:00+05:30` });

    const first = value(await desk.bookAppointment({ patient_id: who, practitioner_id: asha, room_id: chair1, ...at("10:00", "10:30") }));
    expect(first.patient_overlaps).toBeUndefined();
    const second = value(await desk.bookAppointment({ patient_id: who, practitioner_id: dev, room_id: chair2, ...at("10:15", "10:45") }));
    expect(second.patient_overlaps?.length).toBe(1);
    const noChair = value(await desk.bookAppointment({ patient_id: who, practitioner_id: dev, ...at("10:00", "10:30") }));
    expect(noChair.patient_overlaps?.length).toBe(2);
    const later = value(await desk.bookAppointment({ patient_id: who, practitioner_id: asha, ...at("12:00", "12:30") }));
    expect(later.patient_overlaps).toBeUndefined();
    expect(second.patient_overlaps?.[0]).toMatchObject({ appointment_id: first.appointment.id, practitioner_name: doctors[0]?.display_name, room_name: rooms[0]?.name });
    expect(second.warnings.map((w) => w.code)).not.toContain("patient_overlap");
    const moved = value(await desk.changeAppointment(appointmentId.parse(later.appointment.id), at("10:00", "10:30")));
    expect(moved.patient_overlaps?.length).toBeGreaterThan(0);

    // A note-only edit moved nothing, so it doesn't warn again.
    const noted = value(await desk.changeAppointment(appointmentId.parse(later.appointment.id), { notes: "bring the X-ray" }));
    expect(noted.patient_overlaps).toBeUndefined();

    // Cancelled ones hold nothing.
    for (const saved of [first, second, noChair]) value(await desk.setAppointmentStatus(appointmentId.parse(saved.appointment.id), { status: "cancelled", reason: "test" }));
    const clear = value(await desk.bookAppointment({ patient_id: who, practitioner_id: dev, ...at("10:05", "10:25") }));
    expect(clear.patient_overlaps?.length).toBe(1); // `later`, now moved to 10:00, still holds the time

    // Another clinic's patient and bookings are invisible here.
    const lotus = as(BINA, LOTUS);
    const lotusPatient = patientId.parse(value(await lotus.listPatients()).items[0]?.id);
    const lotusDoctor = practitionerId.parse(value(await lotus.listPractitioners()).items[0]?.id);
    const other = value(await lotus.bookAppointment({ patient_id: lotusPatient, practitioner_id: lotusDoctor, ...at("10:00", "10:30") }));
    expect(other.patient_overlaps).toBeUndefined();
  });

  it("reports the move path's clash, and calls an imported last visit a follow-up (new without any history)", async () => {
    const { as } = setup();
    const desk = as(FARAH);
    const doctors = value(await desk.listPractitioners()).items;
    const [asha, dev] = [practitionerId.parse(doctors[0]?.id), practitionerId.parse(doctors[1]?.id)];
    const patients = value(await desk.listPatients({ limit: 100 })).items;
    const imported = patients.find((p) => p.last_visit_at != null && p.last_visit_at < "2026-10-01");
    const never = patients.find((p) => p.last_visit_at == null);
    if (imported === undefined || never === undefined) throw new Error("expected both kinds of patient in the fixtures");
    const at = (start: string, end: string) => ({ starts_at: `2027-01-11T${start}:00+05:30`, ends_at: `2027-01-11T${end}:00+05:30` });

    const a = value(await desk.bookAppointment({ patient_id: patientId.parse(imported.id), practitioner_id: asha, ...at("10:00", "10:30") }));
    expect(a.appointment.patient_type).toBe("follow_up");
    const fresh = value(await desk.bookAppointment({ patient_id: patientId.parse(never.id), practitioner_id: asha, ...at("11:00", "11:30") }));
    expect(fresh.appointment.patient_type).toBe("new");

    const b = value(await desk.bookAppointment({ patient_id: patientId.parse(imported.id), practitioner_id: dev, ...at("14:00", "14:30") }));
    const moved = value(await desk.moveAppointment(appointmentId.parse(b.appointment.id), { starts_at: `2027-01-11T10:10:00+05:30` }));
    expect(moved.patient_overlaps?.length).toBe(1);
  });
});
