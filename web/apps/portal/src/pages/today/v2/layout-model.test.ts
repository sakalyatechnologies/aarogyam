import { describe, expect, it } from "vitest";

import type { DashboardCatalogue, DashboardLayout } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi } from "../../../test/render.js";

import { RAIL_KEYS, adoptTemplates, railOnly, zoneAllowed, addWidget, allowed, canStep, dropInZone, dropOn, nearestSize, stepSize, stepWidget, moveInZone, removeAt, sameLayout, setOpt, setZone, shownItems, shownLayout, specOf, templateLayout, offeredCards, offeredTemplates } from "./layout-model.js";

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
  widgets: [spec("calendar", ["main", "rail"], ["S", "M"]), spec("b", ["main"], ["L", "full"]), spec("queue", ["main", "rail"], ["S", "M"], "finance.view"), spec("completed", ["rail"], ["S"])],
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
    { key: "calendar", zone: "main", size: "M" },
    { key: "completed", zone: "rail", size: "S" },
    { key: "b", zone: "main", size: "L" },
    { key: "queue", zone: "main", size: "S" },
  ],
};
const keys = (l: DashboardLayout) => l.items.map((i) => i.key);

describe("layout edits", () => {
  it("moves within a zone past items of other zones", () => {
    expect(keys(moveInZone(layout, 0, 1))).toEqual(["b", "completed", "calendar", "queue"]);
    expect(keys(moveInZone(layout, 3, -1))).toEqual(["calendar", "completed", "queue", "b"]);
    // First and last of a zone stay put.
    expect(moveInZone(layout, 0, -1)).toBe(layout);
    expect(moveInZone(layout, 1, 1)).toBe(layout);
  });

  it("drops one widget on another, taking its zone, and refuses a zone the widget may not use", () => {
    const moved = dropOn(layout, 2, 1, catalogue);
    expect(moved).toBe(layout); // b may not sit in the rail
    const next = dropOn(layout, 0, 1, catalogue);
    expect(keys(next)).toEqual(["calendar", "completed", "b", "queue"]);
    expect(next.items.find((i) => i.key === "calendar")?.zone).toBe("rail");
    expect(next.items.find((i) => i.key === "calendar")?.size).toBe("M");
  });

  it("keeps a size valid when the zone changes, adds with defaults, removes and sets options", () => {
    expect(setZone(layout, 0, "rail", catalogue).items[0]).toEqual({ key: "calendar", zone: "rail", size: "M" });
    expect(setZone(layout, 2, "rail", catalogue)).toBe(layout);
    const added = addWidget({ ...layout, items: [] }, specOf(catalogue, "b") ?? spec("b", [], []));
    expect(added.items).toEqual([{ key: "b", zone: "main", size: "L", opts: {} }]);
    expect(addWidget(added, specOf(catalogue, "b") ?? spec("b", [], []))).toBe(added);
    expect(keys(removeAt(layout, 1))).toEqual(["calendar", "b", "queue"]);
    expect(setOpt(layout, 0, "count", 2).items[0]?.opts).toEqual({ count: 2 });
  });

  it("hides what the member may not see, and compares layouts by meaning", () => {
    const can = (permission: string) => permission !== "finance.view";
    expect(allowed("finance.view", can)).toBe(false);
    expect(allowed(null, can)).toBe(true);
    expect(shownItems(layout, catalogue, can, () => true).map((s) => s.item.key)).toEqual(["calendar", "completed", "b"]);
    expect(shownItems(layout, catalogue, () => true, (key) => key !== "calendar").map((s) => s.item.key)).toEqual(["completed", "b", "queue"]);
    expect(sameLayout(layout, { ...layout, items: layout.items.map((i) => ({ ...i, opts: {} })) })).toBe(true);
    expect(sameLayout(layout, { ...layout, density: "compact" })).toBe(false);
  });
});

describe("edits on the preview", () => {
  const a = specOf(catalogue, "calendar");
  const b = specOf(catalogue, "b");

  it("drops into a zone at a place, and hands back the same layout for a zone the widget may not use or no change", () => {
    expect(keys(dropInZone(layout, "queue", { zone: "main", anchor: "calendar", side: "before" }, catalogue))).toEqual(["queue", "calendar", "completed", "b"]);
    expect(keys(dropInZone(layout, "calendar", { zone: "main", anchor: "b", side: "after" }, catalogue))).toEqual(["completed", "b", "calendar", "queue"]);
    const intoRail = dropInZone(layout, "calendar", { zone: "rail" }, catalogue);
    expect(intoRail.items.find((item) => item.key === "calendar")?.zone).toBe("rail");
    expect(keys(intoRail)).toEqual(["completed", "calendar", "b", "queue"]);
    expect(dropInZone(layout, "b", { zone: "rail" }, catalogue)).toBe(layout);
    expect(dropInZone(layout, "completed", { zone: "main" }, catalogue)).toBe(layout);
    expect(dropInZone(layout, "calendar", { zone: "main", anchor: "completed", side: "before" }, catalogue)).toBe(layout);
    expect(dropInZone(layout, "calendar", { zone: "main", anchor: "calendar", side: "before" }, catalogue)).toBe(layout);
  });

  it("keeps the size valid when a widget changes zone", () => {
    const sized = { ...layout, items: layout.items.map((item) => (item.key === "queue" ? { ...item, size: "M" } : item)) };
    expect(dropInZone(sized, "calendar", { zone: "rail" }, catalogue).items.find((item) => item.key === "calendar")?.size).toBe("M");
  });

  it("steps left and right between the main area and the rail, by the rail's side", () => {
    expect(canStep(layout, "calendar", "right", catalogue)).toBe(true);
    expect(canStep(layout, "calendar", "left", catalogue)).toBe(false);
    expect(canStep(layout, "b", "right", catalogue)).toBe(false);
    expect(canStep(layout, "completed", "left", catalogue)).toBe(false);
    expect(stepWidget(layout, "b", "right", catalogue)).toBe(layout);
    const leftRail = { ...layout, rail: { ...layout.rail, side: "left" } };
    expect(canStep(leftRail, "calendar", "left", catalogue)).toBe(true);
    expect(canStep(leftRail, "calendar", "right", catalogue)).toBe(false);
    expect(stepWidget(leftRail, "calendar", "left", catalogue).items.find((item) => item.key === "calendar")?.zone).toBe("rail");
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

describe("retired choices", () => {
  const saved = (tpl: string, card: string): DashboardLayout => ({ v: 2, tpl, density: "cozy", card, rail: { side: "right", width: "medium" }, items: [] });

  it("shows a saved flat card as soft and a saved focus template as medsync, and leaves the rest alone", () => {
    expect(shownLayout(saved("focus", "flat"))).toMatchObject({ tpl: "medsync", card: "soft" });
    expect(shownLayout(saved("care", "flat"))).toMatchObject({ tpl: "care", card: "soft" });
    expect(shownLayout(saved("focus", "outline"))).toMatchObject({ tpl: "medsync", card: "outline" });
    const plain = saved("executive", "soft");
    expect(shownLayout(plain)).toBe(plain);
  });

  it("offers neither Focus nor Flat, and a template's own flat card reads as soft", () => {
    const entry = (key: string) => ({ key, label: key, description: key, layout: saved(key, "flat") });
    const catalogue = { templates: [entry("focus"), entry("compact")], cards: ["flat", "soft", "outline"] };
    expect(offeredTemplates(catalogue).map((t) => t.key)).toEqual(["compact"]);
    expect(offeredCards(catalogue)).toEqual(["soft", "outline"]);
    expect(templateLayout(catalogue, "compact")?.card).toBe("soft");
  });
});

describe("the portal's templates", () => {
  const server = async () => {
    const api = fakeApi().client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const got = await api.getMyDashboardLayout();
    if (!got.ok) throw new Error("expected a layout");
    return got.value;
  };

  it("draws a stock MedSync as the key numbers, the next-up hero and the appointments table beside the calendar column", async () => {
    const view = adoptTemplates(await server());
    expect(view.layout.rail.side).toBe("left");
    const where = (key: string) => view.layout.items.find((item) => item.key === key);
    expect(where("kpis")).toMatchObject({ zone: "top", opts: { metrics: ["appointments", "chairs_busy", "waiting", "collected", "lab_due"] } });
    expect(where("nextup")).toMatchObject({ zone: "main", size: "full" });
    expect(where("appointments")).toMatchObject({ zone: "main", size: "full", opts: { view: "table" } });
    expect(where("calendar")?.zone).toBe("rail");
    expect(where("queue")?.zone).toBe("rail");
    expect(where("timeline")).toBeUndefined();
  });

  it("puts the calendar column on the left in every template, with the calendar and the queue in it", async () => {
    const view = adoptTemplates(await server());
    for (const template of view.catalogue.templates) {
      const rail = template.layout.items.filter((item) => item.zone === "rail").map((item) => item.key);
      expect(template.layout.rail.side, template.key).toBe("left");
      expect(rail, template.key).toContain("calendar");
      if (template.layout.items.some((item) => item.key === "queue")) expect(rail, template.key).toContain("queue");
      // Every widget of the server's own template is still there.
      const original = (await server()).catalogue.templates.find((t) => t.key === template.key);
      if (template.key !== "medsync") expect(template.layout.items.map((item) => item.key).sort(), template.key).toEqual(expect.arrayContaining((original?.layout.items ?? []).map((item) => item.key)));
    }
  });

  it("leaves a layout somebody changed as saved, except for anything the calendar column may not hold", async () => {
    const view = await server();
    const density: DashboardLayout["density"] = "compact";
    const tidy = { ...view.layout, density, items: view.layout.items.filter((item) => item.zone !== "rail" || RAIL_KEYS.includes(item.key)) };
    const changed = { ...view, layout: tidy };
    expect(adoptTemplates(changed).layout).toBe(changed.layout);
    const stray = { ...view, layout: { ...view.layout, density } };
    expect(adoptTemplates(stray).layout).toEqual(railOnly(stray.layout));
    expect(adoptTemplates(stray).layout.density).toBe("compact");
  });
});

describe("the calendar column holds only the calendar, the queue and the completed visits", () => {
  const wide = (key: string) => spec(key, ["top", "main", "rail"], ["S", "M", "L", "full"]);
  const open: DashboardCatalogue = { ...catalogue, widgets: [...catalogue.widgets, wide("nextup"), wide("recent_patients")] };

  it("accepts only those three in the rail zone", () => {
    expect(RAIL_KEYS).toEqual(["calendar", "queue", "completed"]);
    for (const key of RAIL_KEYS) expect(specOf(open, key) === undefined || zoneAllowed(open, key, "rail"), key).toBe(true);
    // The server's catalogue lets these sit in the rail; the portal does not.
    expect(zoneAllowed(open, "nextup", "rail")).toBe(false);
    expect(zoneAllowed(open, "recent_patients", "rail")).toBe(false);
    expect(zoneAllowed(open, "nextup", "main")).toBe(true);
    const base: DashboardLayout = { ...layout, items: [{ key: "nextup", zone: "main", size: "full" }] };
    expect(dropInZone(base, "nextup", { zone: "rail" }, open)).toBe(base);
    expect(setZone(base, 0, "rail", open)).toBe(base);
    expect(addWidget({ ...base, items: [] }, specOf(open, "nextup") ?? wide("nextup")).items[0]?.zone).not.toBe("rail");
  });

  it("drops Next up and Recent patients from the rail of an old saved layout, and nothing else", () => {
    const old: DashboardLayout = {
      ...layout,
      items: [
        { key: "calendar", zone: "rail", size: "S" },
        { key: "nextup", zone: "rail", size: "M" },
        { key: "queue", zone: "rail", size: "M" },
        { key: "recent_patients", zone: "rail", size: "M" },
        { key: "b", zone: "main", size: "L" },
      ],
    };
    expect(railOnly(old).items.map((i) => i.key)).toEqual(["calendar", "queue", "b"]);
    expect(shownLayout(old).items.map((i) => i.key)).toEqual(["calendar", "queue", "b"]);
    expect(railOnly(layout.items.every((i) => i.zone !== "rail" || RAIL_KEYS.includes(i.key)) ? layout : old)).toBe(layout);
    // Nor are they drawn if a layout still holds them.
    const shown = shownItems(old, open, () => true, () => true).map((entry) => entry.item.key);
    expect(shown).not.toContain("nextup");
    expect(shown).not.toContain("recent_patients");
  });

  it("loads a saved server layout with Next up in the rail without it, and keeps Next up in the main area of a template that has it", async () => {
    const server = await (async () => {
      const api = fakeApi().client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
      const got = await api.getMyDashboardLayout();
      if (!got.ok) throw new Error("expected a layout");
      return got.value;
    })();
    const saved = { ...server, layout: { ...server.layout, density: "compact" as const, items: [...server.layout.items.filter((i) => i.key !== "nextup"), { key: "nextup", zone: "rail", size: "M" }] } };
    const adopted = adoptTemplates(saved);
    expect(adopted.layout.items.some((i) => i.key === "nextup")).toBe(false);
    for (const template of adopted.catalogue.templates) {
      for (const item of template.layout.items.filter((i) => i.zone === "rail")) expect(RAIL_KEYS, `${template.key}: ${item.key}`).toContain(item.key);
    }
    const medsync = adopted.catalogue.templates.find((t) => t.key === "medsync");
    expect(medsync?.layout.items.find((i) => i.key === "nextup")?.zone).toBe("main");
    const care = adopted.catalogue.templates.find((t) => t.key === "care");
    expect(care?.layout.items.find((i) => i.key === "nextup")?.zone).toBe("main");
  });
});
