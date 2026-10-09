import { describe, expect, it } from "vitest";

import type { DentalTerm } from "@aarogyam/api-client";

import { hasLabel, matchTerms } from "./terms.js";

const term = (id: string, kind: DentalTerm["kind"], label: string, own = false): DentalTerm => ({ id, kind, label, own, retired: false });
const TERMS: DentalTerm[] = [
  term("crown", "procedure", "Crown"),
  term("zirconia", "material", "Zirconia"),
  term("pfm", "material", "PFM (porcelain fused to metal)"),
  term("cast_metal", "material", "Metal (cast)"),
  term("composite", "material", "Composite"),
  term("emax", "material", "e.max (lithium disilicate)"),
  term("0190a7c2-0000-7000-8000-000000000001", "material", "Lithium silicate", true),
];

describe("matchTerms", () => {
  it("offers every term of the list for empty text", () => {
    expect(matchTerms(TERMS, "material", " ").map((t) => t.id)).toHaveLength(6);
    expect(matchTerms(TERMS, "procedure", "").map((t) => t.id)).toEqual(["crown"]);
  });

  it("puts labels starting with the text first, then word starts, then anything containing it", () => {
    expect(matchTerms(TERMS, "material", "z").map((t) => t.label)).toEqual(["Zirconia"]);
    expect(matchTerms(TERMS, "material", "metal").map((t) => t.id)).toEqual(["cast_metal", "pfm"]);
    expect(matchTerms(TERMS, "material", "LITH").map((t) => t.label)).toEqual(["Lithium silicate", "e.max (lithium disilicate)"]);
    expect(matchTerms(TERMS, "material", "posit").map((t) => t.id)).toEqual(["composite"]);
    expect(matchTerms(TERMS, "material", "crown")).toEqual([]);
  });
});

describe("hasLabel", () => {
  it("ignores case and spacing", () => {
    expect(hasLabel(TERMS, "material", "  lithium   SILICATE ")).toBe(true);
    expect(hasLabel(TERMS, "procedure", "Zirconia")).toBe(false);
  });
});
