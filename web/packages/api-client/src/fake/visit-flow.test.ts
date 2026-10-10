import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
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

function errorOf<T>(result: ApiResult<T>): { status: number; code: string } | null {
  return result.ok ? null : { status: result.error.status, code: result.error.code };
}

async function openVisit(as: (who: string, host?: string) => ApiClient, name: string) {
  const walkIn = value(await as(FARAH).registerWalkIn({ patient: { full_name: name } }));
  return value(await as(ASHA).startVisitFromQueue(walkIn.token.id)).visit;
}

const FIRST = { drug_name: "Amoxicillin", strength: "500 mg", form: "capsule", dose: "1 capsule", frequency: "1-1-1", duration_days: 5 };
const SECOND = { drug_name: "Paracetamol", strength: "650 mg", form: "tablet", dose: "1 tablet", frequency: "SOS" };
const SET = {
  label: "Post extraction",
  items: [FIRST, SECOND],
};

describe("finishing a visit (fake, same contract as the API)", () => {
  it("finishes once, then answers 409 visit_closed, and keeps clinics apart", async () => {
    const { as } = setup();
    const visit = await openVisit(as, "Meera Iyer");
    expect(errorOf(await as(FARAH).finishVisit(visit.id))?.status).toBe(403);
    expect(errorOf(await as(BINA, LOTUS).finishVisit(visit.id))?.status).toBe(404);
    expect(errorOf(await as(ASHA).finishVisit(visit.id, { follow_up_on: "soon" }))?.status).toBe(400);
    const done = value(await as(ASHA).finishVisit(visit.id));
    expect(done.visit.status).toBe("closed");
    expect(done.follow_up ?? null).toBeNull();
    expect(errorOf(await as(ASHA).finishVisit(visit.id))).toEqual({ status: 409, code: "visit_closed" });
  });

  it("closing with a follow-up and a fee plans a recall and starts a draft bill", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const visit = await openVisit(as, "Ravi Kumar");
    for (const bad of [{ follow_up_on: "2026-10-01" }, { fee_paise: 0 }, { note: "x".repeat(301) }]) {
      expect(errorOf(await owner.closeVisitWith(visit.id, { ...bad }))?.status).toBe(400);
    }
    expect(errorOf(await as(BINA, LOTUS).closeVisitWith(visit.id, { fee_paise: 100 }))?.status).toBe(404);
    const closed = value(await owner.closeVisitWith(visit.id, { follow_up_on: "2026-10-17", fee_paise: 50_000, note: "Check the filling" }));
    expect(closed.status).toBe("closed");
    expect(closed.follow_up).toMatchObject({ due_on: "2026-10-17", kind: "follow_up", reason: "Check the filling" });
    expect(closed.invoice).toMatchObject({ status: "draft", encounter_id: visit.id, subtotal_paise: 50_000 });
    expect(errorOf(await owner.closeVisitWith(visit.id, { fee_paise: 50_000 }))).toEqual({ status: 409, code: "visit_closed" });
  });
});

describe("share links (fake)", () => {
  it("opens a visit summary with its PIN, for visit links only, and checks hours and channel", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const visit = await openVisit(as, "Sunita Patil");
    for (const hours of [0, 23, 721]) {
      expect(errorOf(await owner.shareVisit(visit.id, { expires_in_hours: hours }))?.status).toBe(400);
    }
    expect(errorOf(await owner.shareVisit(visit.id, { channel: "pager" }))?.status).toBe(400);
    expect(errorOf(await as(BINA, LOTUS).shareVisit(visit.id))?.status).toBe(404);

    const link = value(await owner.shareVisit(visit.id, { expires_in_hours: 24, channel: "qr" }));
    expect(link.channel).toBe("qr");
    expect(new Date(link.expires_at).getTime() - NOW.getTime()).toBe(24 * 3_600_000);
    expect(errorOf(await owner.openSharedVisit(link.token, "000000"))?.status).toBe(403);
    const summary = value(await owner.openSharedVisit(link.token, link.pin));
    expect(summary).toMatchObject({ visit_number: visit.number, patient_name: "Sunita Patil" });
  });

  it("sets a prescription link's expiry and channel", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const visit = await openVisit(as, "Kavita Rao");
    const draft = value(
      await owner.createPrescription(visit.patient_id, { items: [{ drug_name: "Ibuprofen", dose: "1 tablet", frequency: "1-0-1" }] }),
    );
    value(await owner.issuePrescription(draft.id, { notify_patient: false }));
    expect(errorOf(await owner.createShareLinkWith(draft.id, { expires_in_hours: 5 }))?.status).toBe(400);
    const link = value(await owner.createShareLinkWith(draft.id, { expires_in_hours: 720, channel: "whatsapp" }));
    expect(link.channel).toBe("whatsapp");
    expect(link.message?.status).toBe("queued");
    expect(new Date(link.expires_at).getTime() - NOW.getTime()).toBe(720 * 3_600_000);
    expect(value(await owner.createShareLink(draft.id)).channel).toBe("link");
  });
});

describe("medicine sets (fake)", () => {
  it("creates, lists, edits and deletes the clinic's own sets, apart from other clinics", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const made = value(await owner.createMedicineSet(SET));
    expect(made.items).toHaveLength(2);
    expect(errorOf(await owner.createMedicineSet(SET))?.status).toBe(409);
    expect(errorOf(await owner.createMedicineSet({ label: "", items: SET.items }))?.status).toBe(400);
    expect(errorOf(await owner.createMedicineSet({ label: "Empty", items: [] }))?.status).toBe(400);
    expect(errorOf(await as(FARAH).createMedicineSet(SET))?.status).toBe(403);

    expect(value(await owner.listMedicineSets()).items.map((s) => s.label)).toEqual(["Post extraction"]);
    const own = value(await owner.getQuickPicks()).medicine_sets.filter((s) => s.own);
    expect(own.map((s) => s.id)).toEqual([made.id]);

    const lotus = as(BINA, LOTUS);
    expect(value(await lotus.listMedicineSets()).items).toEqual([]);
    expect(errorOf(await lotus.updateMedicineSet(made.id, SET))?.status).toBe(404);
    expect(errorOf(await lotus.deleteMedicineSet(made.id))?.status).toBe(404);

    const edited = value(await owner.updateMedicineSet(made.id, { label: "After extraction", items: [SECOND] }));
    expect(edited).toMatchObject({ id: made.id, label: "After extraction" });
    expect(edited.items).toHaveLength(1);
    value(await owner.deleteMedicineSet(made.id));
    expect(value(await owner.listMedicineSets()).items).toEqual([]);
    expect(errorOf(await owner.deleteMedicineSet(made.id))?.status).toBe(404);
  });
});

describe("root canal entries and client_id replays (fake)", () => {
  it("keeps canals and the sitting, refuses bad ones, and replays a client_id without a duplicate", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const visit = await openVisit(as, "Anil Joshi");
    const patient = visit.patient_id;
    const rootCanal = { tooth: 36, finding: "root_canal", sitting: 2, canals: [{ name: "MB", working_length_mm: 19.5 }, { name: "DB" }] };
    const chart = value(await owner.recordChartEntries(patient, { entries: [rootCanal] }));
    const entry = chart.current.find((c) => c.tooth === 36);
    expect(entry?.sitting).toBe(2);
    expect(entry?.canals.map((c) => c.name)).toEqual(["MB", "DB"]);
    for (const bad of [{ sitting: 0 }, { sitting: 21 }, { canals: [{ name: "MB" }, { name: "mb" }] }]) {
      expect(errorOf(await owner.recordChartEntries(patient, { entries: [{ tooth: 26, finding: "root_canal", ...bad }] }))?.status).toBe(400);
    }
    expect(errorOf(await owner.recordChartEntries(patient, { entries: [{ tooth: 26, finding: "caries", canals: [{ name: "MB" }] }] }))?.status).toBe(400);

    const clientId = "0192f1c4-7a10-7c3e-9b2a-1d2e3f405199";
    const caries = { client_id: clientId, entries: [{ tooth: 46, surface: "O", finding: "caries" }] };
    const first = value(await owner.recordChartEntries(patient, caries));
    const again = value(await owner.recordChartEntries(patient, caries));
    expect(again.current.map((c) => c.id)).toEqual(first.current.map((c) => c.id));
    expect(again.current.filter((c) => c.tooth === 46)).toHaveLength(1);
    expect(errorOf(await owner.recordChartEntries(patient, { client_id: clientId, entries: [{ tooth: 47, finding: "missing" }] }))).toEqual({
      status: 409,
      code: "id_conflict",
    });
  });
});
