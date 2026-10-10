import { describe, expect, it } from "vitest";

import type { DashboardCatalogue, DashboardLayout } from "@aarogyam/api-client";

import { addWidget, allowed, canStep, dropInZone, dropOn, nearestSize, stepSize, stepWidget, moveInZone, removeAt, sameLayout, setOpt, setZone, shownItems, specOf } from "./layout-model.js";

const spec = (key: string, zones: string[], sizes: string[], requires: string | null = null) => ({
  key,
  label: key,
  description: "",
  zones,
  sizes,
  default_zone: zones[0] ?? "main",
  default_size: sizes[0] ?? "M",
  requires,
  options: [],
});

const catalogue: DashboardCatalogue = {
  version: 2,
  templates: [],
  widgets: [spec("a", ["main", "rail"], ["S", "M"]), spec("b", ["main"], ["L", "full"]), spec("c", ["main", "rail"], ["S", "M"], "finance.view"), spec("d", ["rail"], ["S"])],
  metrics: [],
  densities: [],
  cards: [],
  rail_sides: [],
  rail_widths: [],
  zones: [],
  sizes: [],
};

const layout: DashboardLayout = {
  v: 2,
  tpl: "medsync",
  density: "cozy",
  card: "soft",
  rail: { side: "right", width: "medium" },
  items: [
    { key: "a", zone: "main", size: "M" },
    { key: "d", zone: "rail", size: "S" },
    { key: "b", zone: "main", size: "L" },
    { key: "c", zone: "main", size: "S" },
  ],
};
const keys = (l: DashboardLayout) => l.items.map((i) => i.key);

describe("layout edits", () => {
  it("moves within a zone past items of other zones", () => {
    expect(keys(moveInZone(layout, 0, 1))).toEqual(["b", "d", "a", "c"]);
    expect(keys(moveInZone(layout, 3, -1))).toEqual(["a", "d", "c", "b"]);
    // First and last of a zone stay put.
    expect(moveInZone(layout, 0, -1)).toBe(layout);
    expect(moveInZone(layout, 1, 1)).toBe(layout);
  });

  it("drops one widget on another, taking its zone, and refuses a zone the widget may not use", () => {
    const moved = dropOn(layout, 2, 1, catalogue);
    expect(moved).toBe(layout); // b may not sit in the rail
    const next = dropOn(layout, 0, 1, catalogue);
    expect(keys(next)).toEqual(["a", "d", "b", "c"]);
    expect(next.items.find((i) => i.key === "a")?.zone).toBe("rail");
    expect(next.items.find((i) => i.key === "a")?.size).toBe("M");
  });

  it("keeps a size valid when the zone changes, adds with defaults, removes and sets options", () => {
    expect(setZone(layout, 0, "rail", catalogue).items[0]).toEqual({ key: "a", zone: "rail", size: "M" });
    expect(setZone(layout, 2, "rail", catalogue)).toBe(layout);
    const added = addWidget({ ...layout, items: [] }, specOf(catalogue, "b") ?? spec("b", [], []));
    expect(added.items).toEqual([{ key: "b", zone: "main", size: "L", opts: {} }]);
    expect(addWidget(added, specOf(catalogue, "b") ?? spec("b", [], []))).toBe(added);
    expect(keys(removeAt(layout, 1))).toEqual(["a", "b", "c"]);
    expect(setOpt(layout, 0, "count", 2).items[0]?.opts).toEqual({ count: 2 });
  });

  it("hides what the member may not see, and compares layouts by meaning", () => {
    const can = (permission: string) => permission !== "finance.view";
    expect(allowed("finance.view", can)).toBe(false);
    expect(allowed(null, can)).toBe(true);
    expect(shownItems(layout, catalogue, can, () => true).map((s) => s.item.key)).toEqual(["a", "d", "b"]);
    expect(shownItems(layout, catalogue, () => true, (key) => key !== "a").map((s) => s.item.key)).toEqual(["d", "b", "c"]);
    expect(sameLayout(layout, { ...layout, items: layout.items.map((i) => ({ ...i, opts: {} })) })).toBe(true);
    expect(sameLayout(layout, { ...layout, density: "compact" })).toBe(false);
  });
});

describe("edits on the preview", () => {
  const a = specOf(catalogue, "a");
  const b = specOf(catalogue, "b");

  it("drops into a zone at a place, and hands back the same layout for a zone the widget may not use or no change", () => {
    expect(keys(dropInZone(layout, "c", { zone: "main", anchor: "a", side: "before" }, catalogue))).toEqual(["c", "a", "d", "b"]);
    expect(keys(dropInZone(layout, "a", { zone: "main", anchor: "b", side: "after" }, catalogue))).toEqual(["d", "b", "a", "c"]);
    const intoRail = dropInZone(layout, "a", { zone: "rail" }, catalogue);
    expect(intoRail.items.find((item) => item.key === "a")?.zone).toBe("rail");
    expect(keys(intoRail)).toEqual(["d", "a", "b", "c"]);
    expect(dropInZone(layout, "b", { zone: "rail" }, catalogue)).toBe(layout);
    expect(dropInZone(layout, "d", { zone: "main" }, catalogue)).toBe(layout);
    expect(dropInZone(layout, "a", { zone: "main", anchor: "d", side: "before" }, catalogue)).toBe(layout);
    expect(dropInZone(layout, "a", { zone: "main", anchor: "a", side: "before" }, catalogue)).toBe(layout);
  });

  it("keeps the size valid when a widget changes zone", () => {
    const sized = { ...layout, items: layout.items.map((item) => (item.key === "c" ? { ...item, size: "M" } : item)) };
    expect(dropInZone(sized, "a", { zone: "rail" }, catalogue).items.find((item) => item.key === "a")?.size).toBe("M");
  });

  it("steps left and right between the main area and the rail, by the rail's side", () => {
    expect(canStep(layout, "a", "right", catalogue)).toBe(true);
    expect(canStep(layout, "a", "left", catalogue)).toBe(false);
    expect(canStep(layout, "b", "right", catalogue)).toBe(false);
    expect(canStep(layout, "d", "left", catalogue)).toBe(false);
    expect(stepWidget(layout, "b", "right", catalogue)).toBe(layout);
    const leftRail = { ...layout, rail: { ...layout.rail, side: "left" } };
    expect(canStep(leftRail, "a", "left", catalogue)).toBe(true);
    expect(canStep(leftRail, "a", "right", catalogue)).toBe(false);
    expect(stepWidget(leftRail, "a", "left", catalogue).items.find((item) => item.key === "a")?.zone).toBe("rail");
  });

  it("steps through only the sizes a widget allows", () => {
    if (a === undefined || b === undefined) throw new Error("no spec");
    expect(stepSize(a, "S", 1)).toBe("M");
    expect(stepSize(a, "M", 1)).toBe("M");
    expect(stepSize(b, "L", 1)).toBe("full");
    expect(stepSize(b, "L", -1)).toBe("L");
    expect(nearestSize(b, 5)).toBe("L");
    expect(nearestSize(b, 11)).toBe("full");
    expect(nearestSize(a, 12)).toBe("M");
  });
});
