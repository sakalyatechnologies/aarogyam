// The conformance suite (present-studio-design §14.1): one set of rules, run over every shipped style and
// the fixtures (Aarav, the adult, an empty mouth). Slice 1a starts it with the painted style; each new
// style adds itself to STYLES and must pass unchanged.
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type { Snapshot } from "../mouth-view/model.js";
import { dottedTeeth, presentFacts, type PresentModel } from "./model.js";
import { PaintedStyle } from "./painted.js";
import { SHIPPED_STYLES, type PresentStyleId } from "./styles.js";

afterEach(cleanup);

const STYLES: Partial<Record<PresentStyleId, (m: PresentModel) => ReactElement>> = {
  painted: (m) => <PaintedStyle model={m} orientation="mirror" onOrientation={() => undefined} shade="natural" onShade={() => undefined} theme="light" onOpen={() => undefined} />,
};

const empty = (): Snapshot => ({ ...structuredClone(aaravFixture.snapshot), teeth: [] });
const FIXTURES: Record<string, () => Snapshot> = {
  aarav: () => structuredClone(aaravFixture.snapshot),
  adult: () => structuredClone(adultFixture.snapshot),
  empty,
};

describe("every shipped style has a conformance renderer", () => {
  it.each([...SHIPPED_STYLES])("%s", (id) => { expect(STYLES[id]).toBeDefined(); });
});

describe.each(Object.entries(STYLES))("conformance: %s", (_id, draw) => {
  describe.each(Object.entries(FIXTURES))("%s", (_name, snap) => {
    const setup = () => {
      const model = presentFacts(snap());
      const { container } = render(draw(model));
      return { model, container, text: container.textContent };
    };

    it("'What we found' lists exactly the facts, and nothing about crowding or gums", () => {
      const { model, container } = setup();
      const listed = [...container.querySelectorAll("[data-fact]")].map((el) => el.getAttribute("data-fact"));
      expect(listed).toEqual(model.facts.map((f) => f.id));
      const found = container.querySelector(".ps-found")?.textContent ?? "";
      expect(found).not.toMatch(/crowd|recession|gum line/i);
    });

    it("shows no shade code, no unbacked visit number and no price", () => {
      const { text } = setup();
      expect(text).not.toMatch(/\bA(1|2|3|3\.5)\b/);
      expect(text).not.toMatch(/Visit \d/);
      expect(text).not.toMatch(/₹/);
    });

    it("every recorded item has a solid badge, with its date where the snapshot has one", () => {
      const { model, container } = setup();
      for (const f of model.facts) {
        const el = container.querySelector(`[data-fact="${f.id}"]`);
        const badge = el?.querySelector(".ps-badge-rec")?.textContent;
        // TODO(present 1a-0): every finding gets a date; until then a bare "Recorded" is allowed
        expect(badge, f.id).toMatch(f.recorded_on === undefined ? /^Recorded$/ : /^Recorded \d{1,2} [A-Z][a-z]{2}$/);
      }
    });

    it("the picture carries the dashed 'Painting based on your record' and the provenance footer", () => {
      const { container } = setup();
      const dashed = [...container.querySelectorAll(".ps-badge-ill")].map((b) => b.textContent);
      expect(dashed).toContain("Painting based on your record");
      expect(container.querySelector(".ps-prov")).not.toBeNull();
    });

    it("dots only on recorded items: one per tooth with facts", () => {
      const { model, container } = setup();
      const dots = [...container.querySelectorAll(".ps-dot")].map((d) => Number(d.getAttribute("data-tooth")));
      expect(dots).toEqual(dottedTeeth(model));
      for (const tooth of dots) expect(model.facts.some((f) => f.tooth === tooth)).toBe(true);
    });

    it("a wisdom tooth with no eruption record is badged as an example", () => {
      const { model, container } = setup();
      const unrecorded = model.teeth.some((t) => t.index === 8 && t.shown !== "not_recorded" && !t.missing && t.eruption === undefined);
      const has = [...container.querySelectorAll(".ps-badge-ill")].some((b) => /example, not your tooth/i.test(b.textContent));
      expect(has).toBe(unrecorded);
    });
  });
});
