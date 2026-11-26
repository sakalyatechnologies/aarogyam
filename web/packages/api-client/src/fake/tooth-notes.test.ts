import { describe, expect, it } from "vitest";

import { unwrap, type ApiClient } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";
const CLIENT = "0190a7c2-0000-7000-8000-0000000000c2";

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

describe("fake client: tooth notes", () => {
  it("adds notes, lists them newest first, replays a retry and marks the chart", async () => {
    const { as } = setup();
    const api = as(ASHA);
    const patient = await firstPatient(api);
    const first = await unwrap(api.addToothNote(patient.id, 36, "  sensitive to cold ", { clientId: CLIENT }));
    expect(first.body).toBe("sensitive to cold");
    expect(await unwrap(api.addToothNote(patient.id, 36, "sensitive to cold", { clientId: CLIENT }))).toEqual(first);
    const clash = await api.addToothNote(patient.id, 36, "something else", { clientId: CLIENT });
    expect(clash.ok).toBe(false);
    await unwrap(api.addToothNote(patient.id, 36, "recheck in a month"));
    const list = await unwrap(api.toothNotes(patient.id, 36));
    expect(list.items.map((n) => n.body)).toEqual(["recheck in a month", "sensitive to cold"]);
    expect((await unwrap(api.toothNotes(patient.id, 37))).items).toEqual([]);
    const chart = await unwrap(api.getDentalChart(patient.id));
    expect(chart.tooth_notes).toEqual([{ tooth: 36, latest_note: "recheck in a month" }]);
  });

  it("refuses an empty note and a bad tooth, and hides another clinic's patient", async () => {
    const { as } = setup();
    const api = as(ASHA);
    const patient = await firstPatient(api);
    expect((await api.addToothNote(patient.id, 36, "   ")).ok).toBe(false);
    expect((await api.addToothNote(patient.id, 19, "note")).ok).toBe(false);
    const other = await as(BINA, LOTUS).toothNotes(patient.id, 36);
    expect(other.ok).toBe(false);
  });
});
