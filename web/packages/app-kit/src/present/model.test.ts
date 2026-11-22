import { describe, expect, it } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type { Snapshot } from "../mouth-view/model.js";
import { FRONT_ATLAS } from "../mouth-art/gen/front-atlas.js";
import { dottedTeeth, presentFacts, screenOrder } from "./model.js";
import { dotAt, smileScene } from "./painter.js";

const aarav = (): Snapshot => structuredClone(aaravFixture.snapshot);
const adult = (): Snapshot => structuredClone(adultFixture.snapshot);
const ids = (snap: Snapshot) => presentFacts(snap).facts.map((f) => f.id);

describe("present facts: a pure projection of the mouth snapshot (§5.1)", () => {
  it("lists Aarav's recorded items only, each with the 'recorded' badge", () => {
    const m = presentFacts(aarav(), "v1");
    expect(m.visit_id).toBe("v1");
    expect(m.next_visit).toBe("2026-11-26");
    expect(m.facts.map((f) => [f.id, f.words])).toEqual([
      ["55:caries", "Decay into the tooth"],
      ["55:plan:filling", "Filling planned"],
      ["21:in_progress:root_canal", "Root canal treatment in progress · sitting 4"],
      ["21:infection", "Abscess at the root"],
      ["21:plan:crown", "Crown planned"],
      ["65:work:filled", "Filling (tooth-coloured) · done here"],
      ["75:work:filled", "Filling (silver) · done elsewhere"],
    ]);
    expect(new Set(m.facts.map((f) => f.badge))).toEqual(new Set(["recorded"]));
  });

  it("dates each item from the snapshot's *_on fields only (slice 1a-0)", () => {
    const m = presentFacts(aarav());
    const on = Object.fromEntries(m.facts.map((f) => [f.id, f.recorded_on]));
    expect(on["21:infection"]).toBe("2026-10-20");
    expect(on["65:work:filled"]).toBe("2026-10-20");
    expect(on["55:caries"]).toBe("2026-11-20");
    expect(on["75:work:filled"]).toBe("2026-10-20");
    expect(on["21:in_progress:root_canal"]).toBe("2026-11-20");
    // a planned item carries no day in the snapshot: no date is made up
    expect(on["21:plan:crown"]).toBeUndefined();
    const a = Object.fromEntries(presentFacts(adult()).facts.map((f) => [f.id, f.recorded_on]));
    expect(a["14:missing"]).toBe("2025-06-11");
    expect(a["14:recommended:implant"]).toBe("2026-11-12");
    expect(a["37:caries"]).toBe("2026-11-20");
  });

  it("an old snapshot without the *_on fields gives a bare 'Recorded', never a made-up date", () => {
    const snap = aarav();
    for (const t of snap.teeth) { delete t.finding_on; delete t.problems_on; delete t.recommended_on; }
    const on = Object.fromEntries(presentFacts(snap).facts.map((f) => [f.id, f.recorded_on]));
    expect(on["55:caries"]).toBeUndefined();
    expect(on["75:work:filled"]).toBeUndefined();
  });

  it("an adult: missing, loose with bleeding, impacted wisdom, work today, recommended", () => {
    const snap = adult();
    const t36 = snap.teeth.find((t) => t.tooth === 36);
    if (t36?.treatments?.[0] !== undefined) t36.treatments.push({ ...t36.treatments[0], model: "crown", state: "planned", recommended: true, steps: [] });
    const m = presentFacts(snap);
    const words = Object.fromEntries(m.facts.map((f) => [f.id, f.words]));
    expect(words["14:missing"]).toBe("Missing tooth");
    expect(words["31:mobility"]).toBe("Loose tooth (grade 2)");
    expect(words["31:bleeding"]).toBe("Gums bleed");
    expect(words["37:caries"]).toBe("Decay close to the nerve");
    expect(words["38:eruption"]).toBe("Stuck under the gum, tilted forward");
    expect(words["16:work:filled"]).toBe("Filling (tooth-coloured) · done here today");
    expect(words["36:recommended:crown"]).toBe("Your dentist recommends: crown");
    expect(words["14:recommended:implant"]).toBe("Your dentist recommends: implant");
    expect(m.facts.find((f) => f.id === "37:caries")?.biting_side).toBe(true);
    const t38 = m.teeth.find((t) => t.tooth === 38);
    expect([t38?.eruption, t38?.angulation]).toEqual(["impacted", "mesioangular"]);
    expect(m.teeth.find((t) => t.tooth === 14)?.missing).toBe(true);
  });

  it("invents nothing: no shade code, no visit number, no crowding or gum finding", () => {
    for (const snap of [aarav(), adult()]) {
      const text = JSON.stringify(presentFacts(snap).facts);
      expect(text).not.toMatch(/\bA(1|2|3|3\.5)\b/);
      expect(text).not.toMatch(/Visit \d/);
      expect(text).not.toMatch(/crowd/i);
      expect(text).not.toMatch(/recession/i);
    }
  });

  it("an empty mouth has no facts and no dots", () => {
    const snap = aarav();
    snap.teeth = [];
    const m = presentFacts(snap);
    expect(m.facts).toEqual([]);
    expect(dottedTeeth(m)).toEqual([]);
  });

  it("an unrecorded position adds no fact, even if the snapshot carries that tooth", () => {
    const snap = aarav();
    const pos = snap.positions.find((p) => p.tooth === 55);
    if (pos !== undefined) pos.shown = "not_recorded";
    expect(ids(snap).some((id) => id.startsWith("55:"))).toBe(false);
  });

  it("is pure: the same snapshot gives the same model", () => {
    expect(presentFacts(adult())).toEqual(presentFacts(adult()));
  });
});

describe("orientation (§14.2): as in a mirror by default", () => {
  it("mirror puts 16 to the right of 11, photo the reverse; the words don't change", () => {
    const m = presentFacts(adult());
    const mirror = screenOrder(m, "upper", "mirror"), photo = screenOrder(m, "upper", "photo");
    expect(mirror.indexOf(16)).toBeGreaterThan(mirror.indexOf(11));
    expect(photo.indexOf(16)).toBeLessThan(photo.indexOf(11));
    expect(m.orientation_default).toBe("mirror");
  });

  it("the painted dots follow: 16 is right of 11 in mirror, left in photo; lower 46 right of 36 in mirror", () => {
    const m = presentFacts(adult());
    const x = (o: "mirror" | "photo", fdi: number) => dotAt(smileScene(m, FRONT_ATLAS, o), fdi)?.x ?? NaN;
    expect(x("mirror", 16)).toBeGreaterThan(x("mirror", 21));
    expect(x("photo", 16)).toBeLessThan(x("photo", 21));
    expect(x("mirror", 46)).toBeGreaterThan(x("mirror", 36));
  });

  it("names use the patient's own left and right", () => {
    const m = presentFacts(adult());
    expect(m.facts.find((f) => f.tooth === 16)?.where).toBe("Upper right 6-year molar");
    expect(m.facts.find((f) => f.tooth === 37)?.where).toBe("Lower left 12-year molar");
  });
});

describe("painted scene (§6.2)", () => {
  it("puts each dot on its own tooth, inside the frame, never on the cheek", () => {
    const m = presentFacts(adult());
    for (const o of ["mirror", "photo"] as const) {
      const s = smileScene(m, FRONT_ATLAS, o);
      const [bx, by, bw, bh] = s.box;
      for (const fdi of dottedTeeth(m)) {
        const d = dotAt(s, fdi);
        expect(d, `dot for ${String(fdi)}`).toBeDefined();
        if (d === undefined) continue;
        const t = s.teeth.find((x) => x.fdi === fdi);
        if (t === undefined) throw new Error("no tooth");
        const mx = o === "mirror" ? -1 : 1;
        const [a, b] = [t.xl * mx, t.xr * mx].sort((p, q) => p - q);
        expect(d.x).toBeGreaterThanOrEqual((a ?? 0) - .01);
        expect(d.x).toBeLessThanOrEqual((b ?? 0) + .01);
        expect(d.x > bx && d.x < bx + bw && d.y > by && d.y < by + bh).toBe(true);
        expect(Math.abs(d.x)).toBeLessThan(s.frame.Xc);
      }
    }
  });

  it("draws the wisdom tooth from its record: impacted 38 is a ghost, unrecorded-eruption 8s are 'example'", () => {
    const s = smileScene(presentFacts(adult()), FRONT_ATLAS, "mirror");
    const t = (fdi: number) => s.teeth.find((x) => x.fdi === fdi);
    expect(t(38)?.ghost).toBeGreaterThan(0);
    expect(t(38)?.example).toBe(false);
    expect(t(18)?.example).toBe(true);
    expect(t(14)?.missing).toBe(true);
  });

  it("hides an unrecorded wisdom position and fades unrecorded teeth (Aarav)", () => {
    const snap = adult();
    const p18 = snap.positions.find((p) => p.tooth === 18);
    if (p18 !== undefined) p18.shown = "not_recorded";
    const s = smileScene(presentFacts(snap), FRONT_ATLAS, "mirror");
    expect(s.teeth.find((x) => x.fdi === 18)?.hidden).toBe(true);
    const k = smileScene(presentFacts(aarav()), FRONT_ATLAS, "mirror");
    expect(k.teeth.find((x) => x.fdi === 16)?.faded).toBe(true);
    expect(k.teeth.find((x) => x.fdi === 55)?.faded).toBe(false);
    expect(k.teeth.find((x) => x.fdi === 55)?.primary).toBe(true);
  });
});
