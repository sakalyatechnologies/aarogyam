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

describe("walk-in fast path (fake)", () => {
  it("registers a walk-in with reported allergies and desk consents, then finds them by phone", async () => {
    const { as } = setup();
    const desk = as(FARAH);
    const walkIn = value(
      await desk.registerWalkIn({
        patient: { full_name: "Sunita Patil", age_years: 34, sex: "female", phone: "+919876511111" },
        allergies: ["Penicillin", "penicillin"],
        consents: [{ purpose: "care", method: "verbal" }],
      }),
    );
    expect(walkIn.registered).toBe(true);
    expect(walkIn.allergies_recorded).toBe(1);
    expect(walkIn.consents_recorded).toEqual(["care"]);
    expect(walkIn.token.status).toBe("waiting");

    const found = value(await desk.lookupPatientsByPhone("98765 11111"));
    expect(found.items.map((m) => m.id)).toEqual([walkIn.patient.id]);
    expect(Object.keys(found.items[0] ?? {}).sort()).toEqual(["age_years", "full_name", "id", "number", "sex"]);

    // The desk can't read the allergies; the doctor sees them unconfirmed and confirms one.
    expect((await desk.listAllergies(walkIn.patient.id)).ok).toBe(false);
    const owner = as(ASHA);
    const [allergy] = value(await owner.listAllergies(walkIn.patient.id)).items;
    expect(allergy?.confirmed).toBe(false);
    expect(allergy?.source).toBe("patient");
    if (allergy === undefined) throw new Error("expected an allergy");
    expect(value(await owner.confirmAllergy(walkIn.patient.id, allergy.id)).confirmed).toBe(true);
    expect((await desk.confirmAllergy(walkIn.patient.id, allergy.id)).ok).toBe(false);
  });

  it("records No known allergies and refuses it when an allergy is on record", async () => {
    const { as } = setup();
    const desk = as(FARAH);
    const first = value(await desk.registerWalkIn({ patient: { full_name: "Ramesh Jadhav" }, no_known_allergies: true }));
    const flags = value(await desk.getClinicalFlags(first.patient.id));
    expect(flags.allergies_reviewed).toBe("none_known");
    const second = value(await desk.registerWalkIn({ patient_id: first.patient.id, allergies: ["Latex"] }));
    expect(second.registered).toBe(false);
    const refused = await desk.registerWalkIn({ patient_id: first.patient.id, no_known_allergies: true });
    expect(refused.ok ? 0 : refused.error.status).toBe(409);
    const both = await desk.registerWalkIn({ patient: { full_name: "A" }, patient_id: first.patient.id });
    expect(both.ok ? 0 : both.error.status).toBe(400);
  });

  it("starts the visit from the queue once, and closing it finishes the token", async () => {
    const { as } = setup();
    const walkIn = value(await as(FARAH).registerWalkIn({ patient: { full_name: "Meera Iyer" } }));
    const owner = as(ASHA);
    const started = value(await owner.startVisitFromQueue(walkIn.token.id));
    expect(started.created).toBe(true);
    expect(started.token.status).toBe("in_chair");
    const again = value(await owner.startVisitFromQueue(walkIn.token.id));
    expect(again.created).toBe(false);
    expect(again.visit.id).toBe(started.visit.id);
    expect((await as(FARAH).startVisitFromQueue(walkIn.token.id)).ok).toBe(false);
    value(await owner.closeVisit(started.visit.id));
    const queue = value(await owner.listQueue(undefined));
    expect(queue.items.find((t) => t.id === walkIn.token.id)?.status).toBe("done");
  });

  it("keeps clinics apart and serves the quick picks to desk and doctor", async () => {
    const { as } = setup();
    const walkIn = value(await as(FARAH).registerWalkIn({ patient: { full_name: "Sunil Rao", phone: "+919876555555" } }));
    const lotus = as(BINA, LOTUS);
    expect((await lotus.startVisitFromQueue(walkIn.token.id)).ok).toBe(false);
    expect(value(await lotus.lookupPatientsByPhone("9876555555")).items).toEqual([]);
    for (const who of [FARAH, ASHA]) {
      const picks = value(await as(who).getQuickPicks());
      expect(picks.allergies.some((a) => a.label === "Penicillin")).toBe(true);
      expect(picks.medicine_sets.find((s) => s.id === "post_extraction")?.items.length).toBe(3);
    }
  });
});
