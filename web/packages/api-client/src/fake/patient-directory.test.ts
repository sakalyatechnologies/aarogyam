import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { ROLES, createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup(assistant = false) {
  const fixtures = createFixtures({ now: NOW });
  // Farah as an assistant: no billing, no patient writes.
  const farah = fixtures.memberships.find((m) => m.user_id === FARAH);
  if (assistant && farah !== undefined) farah.role = ROLES.assistant;
  const backend = createFakeBackend(fixtures);
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  const anonymous = (host = SUNRISE): ApiClient => backend.client({ host, getToken: () => null, now: () => NOW });
  return { as, anonymous, backend };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function status<T>(result: ApiResult<T>): number {
  return result.ok ? 200 : result.error.status;
}

describe("patient directory (fake)", () => {
  it("leaves the money keys out without billing.read and gates the summary's balance count", async () => {
    const { as } = setup(true);
    const owner = as(ASHA);
    const desk = as(FARAH);
    const [first] = value(await owner.listPatients()).items;
    if (first === undefined) throw new Error("expected a patient");
    expect("balance_paise" in first).toBe(true);
    const seen = value(await desk.getPatient(first.id));
    expect("balance_paise" in seen).toBe(false);
    expect("lifetime_paid_paise" in seen).toBe(false);
    expect(typeof seen.allergy_alert).toBe("boolean");

    const full = value(await owner.getPatientsSummary());
    expect(full.total).toBe(value(await owner.listPatients()).items.length);
    expect(typeof full.with_balance).toBe("number");
    expect("with_balance" in value(await desk.getPatientsSummary())).toBe(false);
    // Another clinic counts only its own patients.
    expect(value(await as(BINA, LOTUS).getPatientsSummary()).total).not.toBe(full.total);
  });

  it("records reported conditions and joins a family at a walk-in, found again by phone", async () => {
    const { as } = setup();
    const desk = as(FARAH);
    const mother = value(
      await desk.registerWalkIn({ patient: { full_name: "Sunita Patil", phone: "+919876522222" }, conditions: ["Diabetes", "diabetes", "High blood pressure"] }),
    );
    expect(mother.conditions_recorded).toBe(2);
    expect(mother.family_linked).toBe(false);
    expect(mother.patient.allergy_alert).toBe(true);
    const again = value(await desk.registerWalkIn({ patient_id: mother.patient.id, conditions: ["Diabetes"] }));
    expect(again.conditions_recorded).toBe(0);

    const child = value(
      await desk.registerWalkIn({
        patient: { full_name: "Aarav Patil", phone: "+919876522222" },
        family_of: { patient_id: mother.patient.id, relation: "guardian" },
      }),
    );
    expect(child.family_linked).toBe(true);
    const found = value(await desk.lookupPatientsByPhone("9876522222")).items;
    const of = (id: string) => found.find((m) => m.id === id);
    expect(of(child.patient.id)?.family.map((f) => [f.id, f.relation])).toEqual([[mother.patient.id, "guardian"]]);
    expect(of(mother.patient.id)?.family.map((f) => [f.id, f.relation])).toEqual([[child.patient.id, "child"]]);

    // Refused whole: bad input is 400, a relative of another clinic is 404.
    expect(status(await desk.registerWalkIn({ patient: { full_name: "X" }, conditions: ["  "] }))).toBe(400);
    expect(status(await desk.registerWalkIn({ patient: { full_name: "X" }, family_of: { patient_id: mother.patient.id, relation: "cousin" } }))).toBe(400);
    const stranger = value(await as(BINA, LOTUS).registerWalkIn({ patient: { full_name: "Bina Patient" } }));
    expect(status(await desk.registerWalkIn({ patient: { full_name: "X" }, family_of: { patient_id: stranger.patient.id, relation: "spouse" } }))).toBe(404);
  });

  it("sets, reads, replaces and removes a photo within the clinic", async () => {
    const { as } = setup();
    const desk = as(FARAH);
    const owner = as(ASHA);
    const patient = value(await desk.registerWalkIn({ patient: { full_name: "Meera Iyer" } })).patient;
    expect(status(await desk.getPatientPhoto(patient.id))).toBe(404);
    const form = (type: string, size = 4) => {
      const f = new FormData();
      f.set("file", new File([new Uint8Array(size)], "me", { type }));
      return f;
    };
    expect(status(await desk.putPatientPhoto(patient.id, form("image/gif")))).toBe(400);
    expect(status(await desk.putPatientPhoto(patient.id, form("image/png", 3 * 1024 * 1024)))).toBe(413);
    value(await desk.putPatientPhoto(patient.id, form("image/png")));
    expect(value(await owner.getPatient(patient.id)).has_photo).toBe(true);
    expect(value(await desk.getPatientPhoto(patient.id)).size).toBe(4);
    value(await desk.putPatientPhoto(patient.id, form("image/jpeg", 9)));
    expect(value(await desk.getPatientPhoto(patient.id)).size).toBe(9);
    // The other clinic can't see it.
    const lotus = as(BINA, LOTUS);
    expect(status(await lotus.getPatientPhoto(patient.id))).toBe(404);
    expect(status(await lotus.putPatientPhoto(patient.id, form("image/png")))).toBe(404);
    expect(status(await lotus.deletePatientPhoto(patient.id))).toBe(404);
    value(await desk.deletePatientPhoto(patient.id));
    expect(value(await owner.getPatient(patient.id)).has_photo).toBe(false);
    expect(status(await desk.deletePatientPhoto(patient.id))).toBe(404);
  });

  it("asks for consent by a one-time link the patient signs without signing in", async () => {
    const { as, anonymous, backend } = setup();
    const desk = as(FARAH);
    const patient = value(await desk.registerWalkIn({ patient: { full_name: "Ravi Kumar", email: "ravi@example.com" } })).patient;
    const phoneOnly = value(await desk.registerWalkIn({ patient: { full_name: "No Email", phone: "+919876533333" } })).patient;
    expect(status(await desk.requestConsent(phoneOnly.id))).toBe(409);
    expect(status(await desk.requestConsent(patient.id, { purposes: ["care", "care"] }))).toBe(400);
    expect(status(await as(BINA, LOTUS).requestConsent(patient.id))).toBe(404);

    const asked = value(await desk.requestConsent(patient.id, { purposes: ["care", "reminders"] }));
    expect(asked.channel).toBe("email");
    expect(value(await desk.getPatient(patient.id)).consent_pending).toBe(true);

    // The API emails the token, so the fake keeps it where a test can read it.
    const token = backend.sentConsentLinks().find((r) => r.patient_id === patient.id)?.token ?? "";
    expect(token).not.toBe("");

    const link = anonymous();
    expect(status(await link.getConsentLink("nope"))).toBe(404);
    expect(status(await anonymous(LOTUS).getConsentLink(token))).toBe(404);
    const shown = value(await link.getConsentLink(token));
    expect(shown.state).toBe("pending");
    expect(shown.purposes).toEqual(["care", "reminders"]);
    expect(status(await link.signConsentLink(token, { agree: false }))).toBe(400);
    expect(status(await link.signConsentLink(token, { agree: true, purposes: ["research"] }))).toBe(400);
    expect(value(await link.signConsentLink(token, { agree: true })).recorded).toEqual(["care", "reminders"]);
    expect(status(await link.signConsentLink(token, { agree: true }))).toBe(409);
    expect(value(await link.getConsentLink(token)).state).toBe("signed");
    expect(value(await desk.getPatient(patient.id)).consent_pending).toBe(false);
  });
});
