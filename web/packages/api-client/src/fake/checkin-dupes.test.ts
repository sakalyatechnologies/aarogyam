import { describe, expect, it } from "vitest";

import { appointmentId, patientId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor, type FakePatient, type Fixtures } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function must<T>(found: T | undefined): T {
  if (found === undefined) throw new Error("expected a fixture");
  return found;
}

const patient = (id: string) => patientId.parse(id);

function status<T>(result: ApiResult<T>): number | undefined {
  return result.ok ? undefined : result.error.status;
}

/** A sign-up with only a name and phone, booked for today, and an existing patient with the same phone. */
function seed(fixtures: Fixtures) {
  const base = must(fixtures.patients.find((p) => p.clinic_id === fixtures.clinics[0]?.id));
  const signup: FakePatient = { ...base, id: "d1d1d1d1-0000-4000-8000-000000000001", number: "SD-901", full_name: "Test Signup", sex: "unknown", date_of_birth: null, phone: "+919800000001", registration_incomplete: true };
  fixtures.patients.push(signup);
  const booking = { ...must(fixtures.appointments.find((a) => a.patient_id === base.id)), id: "e1e1e1e1-0000-4000-8000-000000000001", patient_id: signup.id, status: "booked" as const };
  fixtures.appointments.push(booking);
  (fixtures.patientDuplicates ??= []).push({ id: "f1f1f1f1-0000-4000-8000-000000000001", clinic_id: signup.clinic_id, patient_id: signup.id, candidate_id: base.id, reason: "phone", flagged_at: NOW.toISOString() });
  return { signup, appt: booking, existing: base };
}

function setup() {
  const fixtures = createFixtures({ now: NOW });
  const seeded = seed(fixtures);
  const backend = createFakeBackend(fixtures);
  const as = (who: string): ApiClient => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as, ...seeded };
}

describe("check-in (fake)", () => {
  it("arrives the appointment once, records the details and clears registration_incomplete", async () => {
    const { as, appt } = setup();
    const desk = as(FARAH);
    const done = value(await desk.checkInAppointment(appointmentId.parse(appt.id), { sex: "female", age_years: 31, no_known_allergies: true, consents: [{ purpose: "care", method: "verbal" }] }));
    expect(done.appointment.status).toBe("arrived");
    expect(done.appointment.patient.registration_incomplete).toBe(false);
    expect(done.appointment.patient.sex).toBe("female");
    expect(done.consents_recorded).toEqual(["care"]);
    expect(done.queue_token_id).toBeTruthy();
    const again = value(await desk.checkInAppointment(appointmentId.parse(appt.id), { allergies: ["Penicillin"] }));
    expect(again.queue_token_id).toBe(done.queue_token_id);
    expect(again.allergies_recorded).toBe(1);
    expect(value(await desk.listQueue(undefined)).items.filter((t) => t.appointment_id === appt.id)).toHaveLength(1);
  });

  it("stays incomplete without an age, and refuses bad input and the wrong status", async () => {
    const { as, appt } = setup();
    const desk = as(FARAH);
    expect(status(await desk.checkInAppointment(appointmentId.parse(appt.id), { sex: "robot" }))).toBe(400);
    expect(status(await desk.checkInAppointment(appointmentId.parse(appt.id), { age_years: 3, date_of_birth: "2020-01-01" }))).toBe(400);
    expect(status(await desk.checkInAppointment(appointmentId.parse(appt.id), { allergies: ["Latex"], no_known_allergies: true }))).toBe(400);
    const half = value(await desk.checkInAppointment(appointmentId.parse(appt.id), { sex: "male" }));
    expect(half.appointment.patient.registration_incomplete).toBe(true);
    value(await desk.setAppointmentStatus(appointmentId.parse(appt.id), { status: "completed" }));
    expect(status(await desk.checkInAppointment(appointmentId.parse(appt.id), { sex: "male" }))).toBe(409);
    expect(status(await desk.checkInAppointment(appointmentId.parse("nope"), {}))).toBe(404);
  });

  it("refuses No known allergies when an allergy is on record", async () => {
    const { as, appt } = setup();
    const desk = as(FARAH);
    value(await desk.checkInAppointment(appointmentId.parse(appt.id), { allergies: ["Latex"] }));
    expect(status(await desk.checkInAppointment(appointmentId.parse(appt.id), { no_known_allergies: true }))).toBe(409);
  });
});

describe("possible duplicates (fake)", () => {
  it("lists the flag with both records, and dismiss takes it off", async () => {
    const { as, signup, existing } = setup();
    const desk = as(FARAH);
    const [row] = value(await desk.listPatientDuplicates()).items;
    expect(row?.patient.id).toBe(signup.id);
    expect(row?.candidate.id).toBe(existing.id);
    value(await desk.dismissPatientDuplicate(must(row).id));
    expect(value(await desk.listPatientDuplicates()).items).toEqual([]);
    expect(status(await desk.dismissPatientDuplicate(must(row).id))).toBe(404);
  });

  it("merges the sign-up into the existing patient, moving its appointments and clearing the flag", async () => {
    const { as, signup, existing, appt } = setup();
    const desk = as(FARAH);
    const done = value(await desk.mergePatient(patient(signup.id), { into_patient_id: existing.id }));
    expect(done.patient_id).toBe(existing.id);
    expect(done.appointments_moved).toBe(1);
    expect(value(await desk.listPatientDuplicates()).items).toEqual([]);
    expect(value(await desk.listAppointments({ from: "2026-01-01", to: "2026-12-31" })).items.find((a) => a.id === appt.id)?.patient.id).toBe(existing.id);
    expect(status(await desk.mergePatient(patient(signup.id), { into_patient_id: existing.id }))).toBe(409);
  });

  it("refuses a merge of a record with clinical data, or into one already merged", async () => {
    const { as, signup, existing } = setup();
    const desk = as(FARAH);
    value(await desk.checkInAppointment(appointmentId.parse("e1e1e1e1-0000-4000-8000-000000000001"), { no_known_allergies: true }));
    const clinical = await desk.mergePatient(patient(signup.id), { into_patient_id: existing.id });
    expect(status(clinical)).toBe(409);
    expect(!clinical.ok && clinical.error.message).toMatch(/clinical or billing/);
    const other = setup();
    const kept = value(await other.as(FARAH).mergePatient(patient(other.signup.id), { into_patient_id: other.existing.id }));
    expect(kept.appointments_moved).toBe(1);
    expect(status(await other.as(FARAH).mergePatient(patient(other.existing.id), { into_patient_id: other.signup.id }))).toBe(409);
  });

  it("refuses a merge into itself, and of a record that isn't a sign-up", async () => {
    const { as, signup, existing } = setup();
    expect(status(await as(FARAH).mergePatient(patient(signup.id), { into_patient_id: signup.id }))).toBe(400);
    expect(status(await as(FARAH).mergePatient(patient(existing.id), { into_patient_id: signup.id }))).toBe(400);
    expect(status(await as(FARAH).mergePatient(patient(signup.id), { into_patient_id: "nope" }))).toBe(404);
  });
});
