import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, NewChartEntries, NewPlan } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";
import { chipsFor } from "./quick-plan.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function patient() {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/patients/${visit?.patient_id ?? ""}`;
    fixtures.chartEntries = fixtures.chartEntries.filter((c) => c.patient_id !== visit?.patient_id);
  });
  return { path, backend };
}

function spy() {
  const chart: NewChartEntries[] = [];
  const plans: NewPlan[] = [];
  const cancelled: string[] = [];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    recordChartEntries: (id, input, options) => {
      chart.push(input);
      return client.recordChartEntries(id, input, options);
    },
    createPlan: (id, input, options) => {
      plans.push(input);
      return client.createPlan(id, input, options);
    },
    setPlanItemStatus: (itemId, status, options) => {
      if (status === "cancelled") cancelled.push(itemId);
      return client.setPlanItemStatus(itemId, status, options);
    },
  });
  return { chart, plans, cancelled, wrap };
}

async function openTooth(user: ReturnType<typeof userEvent.setup>, n: number) {
  await screen.findByRole("radiogroup", { name: "Chart look" });
  await user.click(screen.getByRole("button", { name: new RegExp(`^Tooth ${String(n)},`) }));
  const panel = await screen.findByRole("complementary", { name: `Tooth ${String(n)} panel` });
  const start = screen.queryByRole("button", { name: "Start visit" });
  if (start !== null) await user.click(start);
  await within(panel).findByRole("group", { name: "Plan a treatment" });
  return panel;
}

describe("quick plan", () => {
  it("orders the chips by tooth type, then by the doctor's own use", () => {
    expect(chipsFor("back", {})).toEqual(["root_canal", "crown", "filling", "extraction", "scaling"]);
    expect(chipsFor("front", {})).toEqual(["filling", "crown", "root_canal", "extraction"]);
    expect(chipsFor("missing", {})).toEqual(["implant", "bridge"]);
    expect(chipsFor("back", { back: { extraction: 3, filling: 1 } })[0]).toBe("extraction");
  });

  it("saves Planned in one tap, ticks the chip, asks why, and Undo cancels the item", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    const panel = await openTooth(user, 36);
    const chips = within(within(panel).getByRole("group", { name: "Plan a treatment" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual(["Root canal", "Crown", "Filling", "Extraction", "Cleaning", "More…"]);
    await user.click(chips.getByRole("button", { name: "Root canal" }));
    await waitFor(() => { expect(calls.plans).toHaveLength(1); });
    expect(calls.plans[0]?.items[0]).toMatchObject({ name: "Root canal", tooth: 36 });
    expect(calls.plans[0]?.visit_id).toEqual(expect.any(String));
    await within(panel).findByText("Tooth 36: Root canal planned");
    await waitFor(() => { expect(chips.getByRole("button", { name: /Root canal/ }).getAttribute("aria-pressed")).toBe("true"); });
    // tapping a planned chip does nothing
    await user.click(chips.getByRole("button", { name: /Root canal/ }));
    expect(calls.plans).toHaveLength(1);
    const why = within(within(panel).getByRole("group", { name: "Why" }));
    expect(why.getAllByRole("button").map((b) => b.textContent)).toEqual(["Decay near the nerve", "Infection", "Broken"]);
    await user.click(within(panel).getByRole("button", { name: "Undo" }));
    await waitFor(() => { expect(calls.cancelled).toHaveLength(1); });
    await waitFor(() => { expect(chips.getByRole("button", { name: "Root canal" }).getAttribute("aria-pressed")).toBe("false"); });
  });

  it("records the reason through the chart entries, and More opens the full form", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    const panel = await openTooth(user, 36);
    await user.click(within(panel).getByRole("button", { name: "Root canal" }));
    await user.click(await within(panel).findByRole("button", { name: "Decay near the nerve" }));
    await waitFor(() => { expect(calls.chart).toHaveLength(1); });
    expect(calls.chart[0]?.entries).toEqual([{ tooth: 36, finding: "caries", caries_depth: "near_pulp" }]);
    await user.click(within(panel).getByRole("button", { name: "More…" }));
    expect(await within(panel).findByRole("button", { name: /Save/ })).toBeTruthy();
  });
});
