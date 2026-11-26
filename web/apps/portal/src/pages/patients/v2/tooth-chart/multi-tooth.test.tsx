import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, NewPlan } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";

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
  const plans: NewPlan[] = [];
  const cancelled: string[] = [];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    createPlan: (id, input, options) => {
      plans.push(input);
      return client.createPlan(id, input, options);
    },
    setPlanItemStatus: (itemId, status, options) => {
      if (status === "cancelled") cancelled.push(itemId);
      return client.setPlanItemStatus(itemId, status, options);
    },
  });
  return { plans, cancelled, wrap };
}

const tooth = (n: number) => screen.getByRole("button", { name: new RegExp(`^Tooth ${String(n)},`) });

/** Opens tooth 36 once so the visit is started. */
async function ready(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("radiogroup", { name: "Chart look" });
  await user.click(tooth(36));
  await screen.findByRole("complementary", { name: "Tooth 36 panel" });
  const start = screen.queryByRole("button", { name: "Start visit" });
  if (start !== null) await user.click(start);
  await screen.findByRole("group", { name: "Plan a treatment" });
}

async function longPress(n: number) {
  fireEvent.pointerDown(tooth(n));
  await new Promise((resolve) => setTimeout(resolve, 600));
  fireEvent.pointerUp(tooth(n));
  fireEvent.click(tooth(n));
}

describe("select several teeth", () => {
  it("long press starts select mode, taps toggle, one chip plans every tooth, Undo cancels them, Clear exits", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    await ready(user);

    await longPress(36);
    await screen.findByText("1 tooth selected");
    expect(tooth(36).getAttribute("aria-pressed")).toBe("true");
    await user.click(tooth(37));
    await user.click(tooth(46));
    await screen.findByText("3 teeth selected");
    // tapping again removes a tooth
    await user.click(tooth(46));
    await screen.findByText("2 teeth selected");
    await user.click(tooth(46));
    await screen.findByText("3 teeth selected");

    const panel = screen.getByRole("complementary", { name: "Selected teeth panel" });
    await user.click(within(panel).getByRole("button", { name: "Filling" }));
    await waitFor(() => { expect(calls.plans).toHaveLength(3); });
    expect(calls.plans.map((p) => p.items[0]?.tooth).sort()).toEqual([36, 37, 46]);
    expect(calls.plans.every((p) => p.items[0]?.name === "Filling")).toBe(true);
    await within(panel).findByText("Filling planned on 3 teeth");

    await user.click(within(panel).getByRole("button", { name: "Undo" }));
    await waitFor(() => { expect(calls.cancelled).toHaveLength(3); });

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => { expect(screen.queryByText(/selected$/)).toBeNull(); });
    expect(tooth(36).getAttribute("aria-pressed")).toBe("false");
  });

  it("Shift+click starts select mode and Esc exits", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByRole("radiogroup", { name: "Chart look" });
    await user.keyboard("{Shift>}");
    await user.click(tooth(15));
    await user.keyboard("{/Shift}");
    await screen.findByText("1 tooth selected");
    await user.keyboard("{Escape}");
    await waitFor(() => { expect(screen.queryByText(/selected$/)).toBeNull(); });
  });
});
