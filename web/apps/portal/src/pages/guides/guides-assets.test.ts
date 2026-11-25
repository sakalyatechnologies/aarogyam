import { describe, expect, it } from "vitest";

import { parseGuideIndex, parsePublishedGuide } from "./types.js";

// The rendered files under public/guides (the size budget is enforced by scripts/render-guides.mjs).
const files = { ...import.meta.glob("../../../public/guides/*/*.webp", { query: "?url" }), ...import.meta.glob("../../../public/guides/*/*.m4a", { query: "?url" }) };
const json = import.meta.glob<unknown>("../../../public/guides/**/*.json", { eager: true, import: "default" });
const has = (path: string) => `../../../public/guides/${path}` in files;
const read = (path: string): unknown => json[`../../../public/guides/${path}`];
const index = parseGuideIndex(read("index.json")) ?? { guides: [] };

describe("rendered guides", () => {
  it("lists at least the six v1 guides", () => {
    expect(index.guides.map((g) => g.id)).toEqual(expect.arrayContaining(["start-here", "book-appointment", "walk-in-queue", "prescription-finish", "bill-payment", "prices-staff-roles"]));
  });

  for (const entry of index.guides) {
    it(`${entry.id}: every file the index and guide.json name exists`, () => {
      expect(has(entry.still)).toBe(true);
      const guide = parsePublishedGuide(read(`${entry.id}/guide.json`));
      if (guide === undefined) throw new Error(`${entry.id}/guide.json is not a guide`);
      expect(guide.steps).toHaveLength(entry.steps);
      expect(guide.steps.length).toBeGreaterThanOrEqual(6);
      expect(guide.steps.length).toBeLessThanOrEqual(12);
      for (const step of guide.steps) {
        expect(has(`${entry.id}/${step.still}`), `${entry.id}/${step.still}`).toBe(true);
        if (step.audio !== undefined) expect(has(`${entry.id}/${step.audio}`), `${entry.id}/${step.audio}`).toBe(true);
        expect(step.seconds).toBeGreaterThan(0);
      }
    });
  }
});
