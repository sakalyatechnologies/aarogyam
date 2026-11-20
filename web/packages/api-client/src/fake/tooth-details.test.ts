import { describe, expect, it } from "vitest";

import { unwrap, type ApiClient } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-11-20T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  return (who: string): ApiClient => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
}

async function firstPatient(api: ApiClient) {
  const patient = (await unwrap(api.listPatients())).items[0];
  if (patient === undefined) throw new Error("expected a patient");
  return patient;
}

describe("fake client: tooth details and the mouth snapshot", () => {
  it("merges condition changes, clears with null and marks a row in error", async () => {
    const api = setup()(ASHA);
    const patient = await firstPatient(api);
    await unwrap(api.setToothCondition(patient.id, 31, { bleeding: true }));
    const both = await unwrap(api.setToothCondition(patient.id, 31, { mobility: 2 }));
    expect(both).toMatchObject({ tooth: 31, bleeding: true, mobility: 2 });
    const cleared = await unwrap(api.setToothCondition(patient.id, 31, { bleeding: null }));
    expect(cleared.bleeding).toBeUndefined();
    expect(cleared.mobility).toBe(2);
    const empty = await api.setToothCondition(patient.id, 31, { mobility: null });
    expect(empty.ok ? 200 : empty.error.status).toBe(400);
    await unwrap(api.setToothCondition(patient.id, 75, { mobility: 1 }));
    expect((await unwrap(api.getDentalChart(patient.id))).conditions?.map((c) => c.tooth)).toEqual([31, 75]);
    await unwrap(api.markToothConditionInError(patient.id, 75, { reason: "Wrong tooth" }));
    expect((await unwrap(api.getDentalChart(patient.id))).conditions?.map((c) => c.tooth)).toEqual([31]);
  });

  it("records eruption on permanent teeth only", async () => {
    const api = setup()(ASHA);
    const patient = await firstPatient(api);
    const milk = await api.setToothEruption(patient.id, 55, { eruption: "erupted" });
    expect(milk.ok ? 200 : milk.error.status).toBe(400);
    const angled = await api.setToothEruption(patient.id, 48, { eruption: "erupted", angulation: "vertical" });
    expect(angled.ok ? 200 : angled.error.status).toBe(400);
    const impacted = await unwrap(api.setToothEruption(patient.id, 48, { eruption: "impacted", angulation: "mesioangular" }));
    expect(impacted).toMatchObject({ tooth: 48, eruption: "impacted", angulation: "mesioangular" });
    expect((await unwrap(api.getDentalChart(patient.id))).eruptions?.[0]?.tooth).toBe(48);
  });

  it("serves the golden snapshot for a visit of the clinic", async () => {
    const api = setup()(ASHA);
    const patient = await firstPatient(api);
    const visit = await unwrap(api.startVisit(patient.id, {}));
    const mouth = await unwrap(api.getVisitMouth(visit.id));
    expect(mouth.dentition).toBe("mixed");
    expect(mouth.teeth.find((t) => t.tooth === 21)?.treatments?.[0]?.steps.map((s) => s.state)).toEqual(["done", "current", "next", "usual"]);
  });
});
