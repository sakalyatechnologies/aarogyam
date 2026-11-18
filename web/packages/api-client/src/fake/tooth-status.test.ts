import { describe, expect, it } from "vitest";

import { unwrap, type ApiClient } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";
const CLIENT = "0190a7c2-0000-7000-8000-0000000000c1";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as };
}

async function firstPatient(api: ApiClient) {
  const patient = (await unwrap(api.listPatients())).items[0];
  if (patient === undefined) throw new Error("expected a patient");
  return patient;
}

describe("fake client: tooth health statuses", () => {
  it("sets, overrides, replays and clears a status, and the chart carries it", async () => {
    const { as } = setup();
    const api = as(ASHA);
    const patient = await firstPatient(api);
    const body = { health: "needs_treatment", note: " Deep caries ", treat_within_months: 3, client_id: CLIENT } as const;
    const first = await unwrap(api.setToothStatus(patient.id, 36, body));
    expect(first).toMatchObject({ tooth: 36, health: "needs_treatment", note: "Deep caries", treat_within_months: 3 });
    expect(await unwrap(api.setToothStatus(patient.id, 36, body))).toEqual(first);
    const clash = await api.setToothStatus(patient.id, 36, { health: "watch", client_id: CLIENT });
    expect(clash.ok ? 200 : clash.error.status).toBe(409);

    await unwrap(api.setToothStatus(patient.id, 36, { health: "healthy" }));
    const chart = await unwrap(api.getDentalChart(patient.id));
    expect(chart.statuses?.map((s) => [s.tooth, s.health])).toEqual([[36, "healthy"]]);

    await unwrap(api.clearToothStatus(patient.id, 36));
    expect((await unwrap(api.getDentalChart(patient.id))).statuses).toBeUndefined();
  });

  it("refuses what the server refuses, naming the field", async () => {
    const { as } = setup();
    const api = as(ASHA);
    const patient = await firstPatient(api);
    const refused = async (tooth: number, input: Parameters<ApiClient["setToothStatus"]>[2]) => {
      const result = await api.setToothStatus(patient.id, tooth, input);
      return result.ok ? "saved" : `${String(result.error.status)} ${result.error.field ?? ""}`;
    };
    expect(await refused(19, { health: "watch" })).toBe("400 tooth");
    expect(await refused(36, { health: "watch", treat_within_months: 2 })).toBe("400 treat_within_months");
    expect(await refused(36, { health: "healthy", treat_within_months: 3 })).toBe("400 treat_within_months");
    expect(await refused(36, { health: "watch", note: "x".repeat(501) })).toBe("400 note");
  });

  it("refuses done elsewhere on caries and with in progress, and keeps it on finished work", async () => {
    const { as } = setup();
    const api = as(ASHA);
    const patient = await firstPatient(api);
    const caries = await api.recordChartEntries(patient.id, { entries: [{ tooth: 36, surface: "O", finding: "caries", elsewhere: true }] });
    expect(caries.ok ? "saved" : caries.error.field).toBe("elsewhere");
    const busy = await api.recordChartEntries(patient.id, { entries: [{ tooth: 46, finding: "crown", elsewhere: true, in_progress: true }] });
    expect(busy.ok ? "saved" : busy.error.field).toBe("elsewhere");
    const chart = await unwrap(api.recordChartEntries(patient.id, { entries: [{ tooth: 46, finding: "crown", elsewhere: true }] }));
    expect(chart.current.find((e) => e.tooth === 46)?.elsewhere).toBe(true);
  });

  it("hides another clinic's patient", async () => {
    const { as } = setup();
    const patient = await firstPatient(as(ASHA));
    const result = await as(BINA, LOTUS).setToothStatus(patient.id, 36, { health: "watch" });
    expect(result.ok ? 200 : result.error.status).toBe(404);
  });
});
