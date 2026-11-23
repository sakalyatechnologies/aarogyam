// Choose your cap (slice 2c).
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import materialsFile from "../../../../../specialties/dental/present/materials.json" with { type: "json" };
import outcomesFile from "../../../../../specialties/dental/present/outcomes.json" with { type: "json" };
import { ART_KEYS } from "../mouth-art/art-map.js";
import { loadShapes, loadToothArt } from "../mouth-art/loaders.js";
import { overlayPart } from "../mouth-art/overlays.js";
import { MaterialChoice, materialGroupFor, materialScene } from "./materials.js";

afterEach(cleanup);

describe("the material data", () => {
  it("every paint resolves to an art key and every outcome exists", () => {
    for (const g of Object.values(materialsFile.groups)) {
      for (const m of g.materials) {
        expect(ART_KEYS.has(`material:${m.look.paint}`), m.look.paint).toBe(true);
        if ("outcome" in m) expect(Object.keys(outcomesFile.outcomes)).toContain(m.outcome);
        expect(m.strength === "" && m.best_for === "").toBe(true);
      }
    }
  });
});

describe("split ceramic paints", () => {
  it("PFM, zirconia, layered zirconia and e.max each paint a different crown", async () => {
    const art = await loadToothArt("u6");
    const names = ["pfm", "zirconia", "layered_zirconia", "emax"].map((m) =>
      overlayPart(art, "front", { kind: "crown", material: m }).add.map((l) => l.n).join(","));
    expect(new Set(names).size).toBe(4);
    const shapes = await loadShapes();
    expect(materialScene(art, shapes, 16, materialsFile.groups.crown, "emax").nodes.length).toBeGreaterThan(0);
  });
});

describe("materialGroupFor", () => {
  it("picks the group from the record or the situation", () => {
    expect(materialGroupFor(["deep_decay"], undefined)).toBe("crown");
    expect(materialGroupFor(["missing"], undefined)).toBe("implant_crown");
    expect(materialGroupFor([], { tooth: 16, finding: "filled" })).toBe("filling");
    expect(materialGroupFor([], undefined)).toBeUndefined();
  });
});

describe("MaterialChoice", () => {
  it("lists the cap materials with words, outcomes, a cost guide and no price", async () => {
    const { container } = render(<MaterialChoice group="crown" tooth={16} />);
    await waitFor(() => { expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(4); });
    expect(container.textContent).toContain("Choose your cap");
    expect(container.querySelector('[data-material="zirconia"]')?.textContent).toContain("Most are still working after 5 years");
    expect(container.querySelector('[data-material="layered_zirconia"]')?.textContent).toContain("No usual figure");
    expect(container.querySelector('[data-row="strength"]')).toBeNull();
    expect(container.textContent).not.toMatch(/₹/);
  });
});
