import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult, DashboardLayout } from "../index.js";
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
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

function templateOf(view: { catalogue: { templates: { key: string; layout: DashboardLayout }[] } }, key: string): DashboardLayout {
  const found = view.catalogue.templates.find((t) => t.key === key);
  if (found === undefined) throw new Error(`no template ${key}`);
  return structuredClone(found.layout);
}

function pick(layout: DashboardLayout, index: number): DashboardLayout["items"][number] {
  const found = layout.items[index];
  if (!found) throw new Error(`no item at ${String(index)}`);
  return found;
}

function itemIndex(layout: DashboardLayout, key: string): number {
  const index = layout.items.findIndex((i) => i.key === key);
  if (index < 0) throw new Error(`no item ${key}`);
  return index;
}

describe("fake dashboard layout", () => {
  it("serves MedSync and the catalogue when nothing is saved", async () => {
    const { as } = setup();
    const view = value(await as(ASHA).getMyDashboardLayout());
    expect(view.source).toBe("template");
    expect(view.layout.tpl).toBe("medsync");
    expect(view.catalogue.templates.map((t) => t.key)).toEqual(["medsync", "executive", "care", "focus", "compact", "front_desk"]);
    expect(view.catalogue.widgets).toHaveLength(15);
    expect(view.catalogue.metrics).toHaveLength(8);
  });

  it("lets the member's layout win over the clinic's, and reset fall back", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const desk = as(FARAH);
    const view = value(await owner.getMyDashboardLayout());
    const care = templateOf(view, "care");
    expect(value(await owner.saveDashboardLayout(care)).source).toBe("clinic");
    expect(value(await desk.getMyDashboardLayout()).layout).toEqual(care);

    const mine = templateOf(view, "front_desk");
    pick(mine, itemIndex(mine, "nextup")).opts = { count: 4 };
    expect(value(await desk.saveMyDashboardLayout(mine)).source).toBe("member");
    // The same person on another device.
    const again = value(await as(FARAH).getMyDashboardLayout());
    expect(again).toMatchObject({ source: "member", layout: mine });
    expect(value(await owner.getMyDashboardLayout()).layout).toEqual(care);

    const reset = value(await desk.resetMyDashboardLayout());
    expect(reset).toMatchObject({ source: "clinic", layout: care });
    expect(value(await owner.resetDashboardLayout()).source).toBe("template");
    expect(value(await desk.getMyDashboardLayout()).layout.tpl).toBe("medsync");
  });

  it("fills in options left out and refuses bad layouts with 400", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const base = templateOf(value(await owner.getMyDashboardLayout()), "medsync");
    const saved = value(await owner.saveMyDashboardLayout({ ...base, items: [{ key: "collections", zone: "main", size: "L" }] }));
    expect(saved.layout.items[0]?.opts).toEqual({ weeks: 8 });

    const refused = async (change: (layout: DashboardLayout) => void) => {
      const layout = structuredClone(base);
      change(layout);
      const first = errorOf(await owner.saveMyDashboardLayout(layout));
      const second = errorOf(await owner.saveDashboardLayout(layout));
      expect([first?.status, second?.status]).toEqual([400, 400]);
      return `${first?.field ?? ""}: ${first?.message ?? ""}`;
    };
    const at = (key: string) => itemIndex(base, key);
    await refused((l) => void (pick(l, 1).key = "weather"));
    await refused((l) => void (pick(l, 1).key = "kpis"));
    await refused((l) => void (l.tpl = "zen"));
    await refused((l) => void (l.v = 1));
    await refused((l) => void (l.rail.side = "top"));
    await refused((l) => void (pick(l, at("kpis")).zone = "rail"));
    await refused((l) => void (pick(l, at("collections")).zone = "rail"));
    await refused((l) => void (pick(l, at("chairs")).size = "S"));
    await refused((l) => void (pick(l, at("kpis")).opts = { metrics: ["appointments", "waiting", "completed"] }));
    await refused((l) => void (pick(l, at("kpis")).opts = { metrics: ["appointments", "completed", "waiting", "weather"] }));
    await refused((l) => void (pick(l, at("kpis")).opts = { metrics: ["waiting", "waiting", "completed", "appointments"] }));
    await refused((l) => void (pick(l, at("nextup")).opts = { count: 6 }));
    await refused((l) => void (pick(l, at("appointments")).opts = { view: "grid" }));
    await refused((l) => void (pick(l, at("collections")).opts = { weeks: 6 }));
    await refused((l) => void (pick(l, at("chairs")).opts = { show_chart: "yes" }));
    expect(await refused((l) => void (pick(l, at("chairs")).opts = { colour: "red" }))).toContain("colour");
    // Nothing bad was kept.
    expect(value(await owner.getMyDashboardLayout()).layout.items).toHaveLength(1);
  });

  it("keeps the clinic default behind settings.manage and clinics apart", async () => {
    const { as } = setup();
    const view = value(await as(ASHA).getMyDashboardLayout());
    const care = templateOf(view, "care");
    for (const call of [(c: ApiClient) => c.getDashboardLayout(), (c: ApiClient) => c.saveDashboardLayout(care), (c: ApiClient) => c.resetDashboardLayout()]) {
      expect(errorOf(await call(as(FARAH)))?.status).toBe(403);
    }
    // The desk still has a layout of their own.
    expect(value(await as(FARAH).saveMyDashboardLayout(care)).source).toBe("member");

    value(await as(ASHA).saveDashboardLayout(care));
    // Another clinic's owner is a stranger on Sunrise's host, and sees nothing of Sunrise at home.
    expect(errorOf(await as(BINA).getMyDashboardLayout())?.status).toBe(404);
    expect(errorOf(await as(BINA).saveDashboardLayout(care))?.status).toBe(404);
    expect(value(await as(BINA, LOTUS).getMyDashboardLayout()).source).toBe("template");
  });
});
