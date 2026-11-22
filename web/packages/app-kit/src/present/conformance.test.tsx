// The conformance suite (present-studio-design §14.1): one set of rules, run over every shipped style and
// the fixtures (Aarav, the adult, an empty mouth). Slice 1a starts it with the painted style; each new
// style adds itself to STYLES and must pass unchanged.
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type { Snapshot } from "../mouth-view/model.js";
import { dottedTeeth, presentFacts, type PresentModel } from "./model.js";
import { PaintedStyle } from "./painted.js";
import { StoryStyle } from "./story.js";
import { ToothSheet } from "./tooth-sheet.js";
import { XrayStyle } from "./xray.js";
import { SHIPPED_STYLES, type PresentStyleId } from "./styles.js";

afterEach(cleanup);

const STYLES: Partial<Record<PresentStyleId, (m: PresentModel) => ReactElement>> = {
  story: (m) => <StoryStyle model={m} orientation="mirror" onOrientation={() => undefined} theme="light" stacked />,
  painted: (m) => <PaintedStyle model={m} orientation="mirror" onOrientation={() => undefined} shade="natural" onShade={() => undefined} theme="light" onOpen={() => undefined} />,
  xray: (m) => <XrayStyle model={m} image={{ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", alt: "X-ray" }} />,
};
/** Shared blocks a style can switch to; each must pass the same rules (slice 1b: Open wide, inside painted). */
const BLOCKS: Record<string, (m: PresentModel) => ReactElement> = {
  "painted, open wide": (m) => <PaintedStyle model={m} orientation="mirror" onOrientation={() => undefined} shade="natural" onShade={() => undefined} theme="light" onOpen={() => undefined} view="wide" />,
};

const empty = (): Snapshot => ({ ...structuredClone(aaravFixture.snapshot), teeth: [] });
const FIXTURES: Record<string, () => Snapshot> = {
  aarav: () => structuredClone(aaravFixture.snapshot),
  adult: () => structuredClone(adultFixture.snapshot),
  empty,
};

/**
 * The day the snapshot itself records for a fact id, read straight from its `*_on` fields (slice 1a-0),
 * independently of the model: a fact must show it whenever it exists, and never a day that isn't there.
 */
function snapshotDay(snap: Snapshot, id: string): string | undefined {
  const [toothText, kind = "", rest = ""] = id.split(":");
  const t = snap.teeth.find((x) => String(x.tooth) === toothText);
  if (t === undefined) return undefined;
  const headline = (finding: string) => (t.finding === finding ? t.finding_on : undefined);
  const problem = (p: string) => { const i = (t.problems ?? []).indexOf(p); return (i < 0 ? undefined : t.problems_on?.[i]) ?? headline(p); };
  if (kind === "recommended") return t.recommended_on;
  if (kind === "plan" || kind === "eruption") return undefined;
  if (kind === "in_progress") return headline(rest);
  if (kind === "work") return t.work?.find((w) => w.finding === rest)?.done_on ?? headline(rest);
  if (["infection", "mobility", "bleeding", "pocket"].includes(kind)) return t.details?.condition_on;
  return problem(kind);
}

describe("every shipped style has a conformance renderer", () => {
  it.each([...SHIPPED_STYLES])("%s", (id) => { expect(STYLES[id]).toBeDefined(); });
});

describe.each([...Object.entries(STYLES), ...Object.entries(BLOCKS)])("conformance: %s", (_id, draw) => {
  describe.each(Object.entries(FIXTURES))("%s", (_name, snap) => {
    const setup = () => {
      const model = presentFacts(snap());
      const { container } = render(draw(model));
      return { model, container, text: container.textContent };
    };

    it("'What we found' lists exactly the facts, and nothing about crowding or gums", () => {
      const { model, container } = setup();
      const listed = [...container.querySelectorAll(".ps-found [data-fact]")].map((el) => el.getAttribute("data-fact"));
      expect(listed).toEqual(model.facts.map((f) => f.id));
      const found = container.querySelector(".ps-found")?.textContent ?? "";
      expect(found).not.toMatch(/crowd|recession|gum line/i);
    });

    it("shows no shade code, no unbacked visit number and no price", () => {
      const { text, container } = setup();
      expect(text).not.toMatch(/\bA(1|2|3|3\.5)\b/);
      // "Visit N" only inside a record-backed step row (the story's tooth cards hold tooth sheets)
      const outside = [...container.querySelectorAll("*")].filter((el) => el.closest("[data-step-state]") === null && el.children.length === 0).map((el) => el.textContent).join(" ");
      expect(outside).not.toMatch(/Visit \d/);
      expect(text).not.toMatch(/₹/);
    });

    it("every recorded item has a solid badge, dated whenever the snapshot carries its *_on field", () => {
      const s = snap();
      const { model, container } = setup();
      for (const f of model.facts) {
        const el = container.querySelector(`.ps-found [data-fact="${f.id}"]`);
        const badge = el?.querySelector(".ps-badge-rec")?.textContent;
        const day = snapshotDay(s, f.id);
        expect(f.recorded_on, f.id).toBe(day);
        expect(badge, f.id).toMatch(day === undefined ? /^Recorded$/ : /^Recorded \d{1,2} [A-Z][a-z]{2}$/);
      }
    });

    // the drawn styles only: the X-ray is the patient's own image, with no painting and no dots
    it.skipIf(_id === "xray")("the picture carries the dashed 'Painting based on your record' and the provenance footer", () => {
      const { container } = setup();
      const dashed = [...container.querySelectorAll(".ps-badge-ill")].map((b) => b.textContent);
      expect(dashed).toContain("Painting based on your record");
      expect(container.querySelector(".ps-prov")).not.toBeNull();
    });

    it.skipIf(_id === "xray")("dots only on recorded items: one per tooth with facts", () => {
      const { model, container } = setup();
      const dots = [...container.querySelectorAll(".ps-dot")].map((d) => Number(d.getAttribute("data-tooth")));
      expect(dots).toEqual(dottedTeeth(model));
      for (const tooth of dots) expect(model.facts.some((f) => f.tooth === tooth)).toBe(true);
    });

    it.skipIf(_id === "xray")("a wisdom tooth with no eruption record is badged as an example", () => {
      const { model, container } = setup();
      const unrecorded = model.teeth.some((t) => t.index === 8 && t.shown !== "not_recorded" && !t.missing && t.eruption === undefined);
      const has = [...container.querySelectorAll(".ps-badge-ill")].some((b) => /example, not your tooth/i.test(b.textContent));
      expect(has).toBe(unrecorded);
    });
  });
});

/** X-ray (§14.1): no negative scale on the image or its overlays; edge labels on the radiograph's convention sides; a provenance footer, and no illustration claimed. */
describe.each(Object.entries(FIXTURES))("conformance: X-ray orientation and provenance, %s", (_name, snap) => {
  it("is never transformed and reads Your right on the left edge", () => {
    const { container } = render(STYLES.xray?.(presentFacts(snap())) ?? <></>);
    expect(container.querySelector("img")).not.toBeNull();
    for (const el of container.querySelectorAll("[data-xray-stage], [data-xray-stage] *")) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/scale\(-|scaleX|scale3d|matrix/i);
    }
    expect(container.querySelector('.ps-xr-edge[data-side="left"]')?.textContent).toBe("Your right");
    expect(container.querySelector('.ps-xr-edge[data-side="right"]')?.textContent).toBe("Your left");
    expect(container.querySelector(".ps-prov")).not.toBeNull();
    expect(container.querySelectorAll(".ps-badge-ill").length).toBe(0);
  });
});

/** The tooth sheet (slice 1c) holds the same rules for every recorded tooth of every fixture. */
describe.each(Object.entries(FIXTURES))("conformance: tooth sheet, %s", (_name, snap) => {
  const teethOf = () => dottedTeeth(presentFacts(snap()));
  it("shows no shade code, price or unbacked visit number; usual steps carry no number or date", async () => {
    const model = presentFacts(snap());
    for (const tooth of teethOf()) {
      const { container, unmount } = render(<ToothSheet model={model} tooth={tooth} onBack={() => undefined} />);
      await waitFor(() => { expect(container.querySelector("[data-pair] svg, [data-art-failed]")).not.toBeNull(); });
      const text = container.textContent;
      expect(text, String(tooth)).not.toMatch(/\bA(1|2|3|3\.5)\b|₹/);
      // "Visit N" only inside a record-backed step row
      const outside = [...container.querySelectorAll("*")].filter((el) => el.closest("[data-step-state]") === null && el.children.length === 0).map((el) => el.textContent).join(" ");
      expect(outside, String(tooth)).not.toMatch(/Visit \d/);
      expect(container.querySelector(".ps-sheet-usual")?.textContent ?? "", String(tooth)).not.toMatch(/\d|Visit/);
      unmount();
    }
  });

  it("every fact has a solid badge with the snapshot's own day; every picture a dashed one", async () => {
    const model = presentFacts(snap());
    for (const tooth of teethOf()) {
      const { container, unmount } = render(<ToothSheet model={model} tooth={tooth} onBack={() => undefined} />);
      await waitFor(() => { expect(container.querySelector("[data-pair] svg, [data-art-failed]")).not.toBeNull(); });
      for (const f of model.facts.filter((x) => x.tooth === tooth)) {
        const badge = container.querySelector(`[data-fact="${f.id}"] .ps-badge-rec`)?.textContent;
        expect(badge, f.id).toMatch(f.recorded_on === undefined ? /^Recorded$/ : /^Recorded \d{1,2} [A-Z][a-z]{2}$/);
      }
      if (container.querySelector("[data-pair] svg") !== null) expect([...container.querySelectorAll(".ps-badge-ill")].map((b) => b.textContent)).toContain("Painting based on your record");
      unmount();
    }
  });

  it("the before/after slider, when present, shares one viewBox", async () => {
    const model = presentFacts(snap());
    for (const tooth of teethOf()) {
      const { container, unmount } = render(<ToothSheet model={model} tooth={tooth} onBack={() => undefined} />);
      await waitFor(() => { expect(container.querySelector("[data-pair] svg, [data-art-failed]")).not.toBeNull(); });
      const boxes = [...container.querySelectorAll("[data-compare] svg[role=img]")].map((s) => s.getAttribute("viewBox"));
      expect(boxes.length === 0 || (boxes.length === 2 && boxes[0] === boxes[1]), String(tooth)).toBe(true);
      unmount();
    }
  });
});
