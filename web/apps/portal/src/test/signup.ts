import type { FakePatient, Fixtures } from "@aarogyam/api-client/fake";

import { NOW } from "./render.js";

function must<T>(found: T | undefined): T {
  if (found === undefined) throw new Error("expected a fixture");
  return found;
}

export const SIGNUP_ID = "d1d1d1d1-0000-4000-8000-000000000001";
export const FLAG_ID = "f1f1f1f1-0000-4000-8000-000000000001";

/**
 * Today's bookings for two synthetic patients, one signed up online (name and phone only) and one complete, plus a
 * duplicate flag tying the sign-up to an existing patient with the same phone.
 */
export function seedOnlineSignup(fixtures: Fixtures) {
  const existing = must(fixtures.patients.find((p) => p.status === "active"));
  const template = must(fixtures.appointments.find((a) => a.patient_id === existing.id));
  const signup: FakePatient = { ...existing, id: SIGNUP_ID, number: "SD-901", full_name: "Test Signup", sex: "unknown", date_of_birth: null, phone: "+919800000001", registration_incomplete: true };
  const complete: FakePatient = { ...existing, id: "d1d1d1d1-0000-4000-8000-000000000002", number: "SD-902", full_name: "Test Complete", phone: "+919800000002" };
  // An exact birth date on record, only the sex missing.
  const dated: FakePatient = { ...existing, id: "d1d1d1d1-0000-4000-8000-000000000003", number: "SD-903", full_name: "Test Dated", sex: "unknown", date_of_birth: "2019-04-12", phone: "+919800000003", registration_incomplete: true };
  fixtures.patients.push(signup, complete, dated);
  const startsAt = new Date(NOW.getTime() + 3_600_000);
  const booking = (id: string, patient: FakePatient) => ({
    ...template,
    id,
    patient_id: patient.id,
    status: "booked" as const,
    token_number: null,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + 1_800_000).toISOString(),
  });
  fixtures.appointments.push(booking("e1e1e1e1-0000-4000-8000-000000000001", signup), booking("e1e1e1e1-0000-4000-8000-000000000002", complete), booking("e1e1e1e1-0000-4000-8000-000000000003", dated));
  (fixtures.patientDuplicates ??= []).push({ id: FLAG_ID, clinic_id: signup.clinic_id, patient_id: signup.id, candidate_id: existing.id, reason: "phone", flagged_at: NOW.toISOString() });
  return { signup, complete, dated, existing };
}
