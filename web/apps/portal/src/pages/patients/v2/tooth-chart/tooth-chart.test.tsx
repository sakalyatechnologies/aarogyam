import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, NewChartEntries, NewPlan } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";
import { layoutKey, type P360Layout } from "../use-layout.js";
import { chartPrefsKey } from "./use-chart-prefs.js";

const LAYOUTS: readonly P360Layout[] = ["console", "stage", "tabs"];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** A seeded patient with no chart entries on the teeth the tests use, so every row in the panel is the test's own. */
function patient() {
  let path = "";
  let userId = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/patients/${visit?.patient_id ?? ""}`;
    fixtures.chartEntries = fixtures.chartEntries.filter((c) => c.patient_id !== visit?.patient_id);
    userId = PEOPLE.asha;
  });
  return { path, backend, userId };
}

function spy() {
  const chart: NewChartEntries[] = [];
  const plans: NewPlan[] = [];
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
  });
  return { chart, plans, wrap };
}

/** The chart has loaded: its Rows / 3D arch switch is there. */
const ready = () => screen.findByRole("radiogroup", { name: "Chart look" });

const tooth = (n: number) => screen.getByRole("button", { name: new RegExp(`^Tooth ${String(n)},`) });

/** Opens the chart, picks a tooth and gets an open visit so treatment can be recorded. */
async function openTooth(user: ReturnType<typeof userEvent.setup>, n: number) {
  await ready();
  await user.click(tooth(n));
  const panel = await screen.findByRole("complementary", { name: `Tooth ${String(n)} panel` });
  const start = within(panel).queryByRole("button", { name: "Start visit" });
  if (start !== null) await user.click(start);
  await within(panel).findByRole("button", { name: "Add treatment" });
  return panel;
}

describe("the chart", () => {
  it("shows Rows or the 3D arch, Adult or Child, and remembers the choice per person", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(32);
    expect(tooth(18)).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: "Child" }));
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(20);
    expect(tooth(55)).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: "3D arch" }));
    expect(document.querySelector(".tc-arch")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(chartPrefsKey(PEOPLE.asha)) ?? "null")).toEqual({ look: "arch", dentition: "child" });

    cleanup();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(screen.getByRole("radio", { name: "3D arch" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(20);
  });

  it("keeps the legend behind a Key button, and shows it on demand", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Chart summary" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Key" }));
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Caries")).toBeTruthy();
    expect(within(legend).getByText("Planned")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it.each(LAYOUTS)("is in the %s layout", async (layout) => {
    localStorage.setItem(layoutKey(PEOPLE.asha), layout);
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(screen.getByRole("radio", { name: "Rows" })).toBeTruthy();
    expect(tooth(16)).toBeTruthy();
  });
});

describe("the Classic view", () => {
  it("is the existing odontogram, and a tooth opens the same panel and Add form as the other views", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    await ready();
    await user.click(screen.getByRole("radio", { name: "Classic" }));
    expect(JSON.parse(localStorage.getItem(chartPrefsKey(PEOPLE.asha)) ?? "null")).toMatchObject({ look: "classic" });
    // The odontogram's zoom and Select several sit in its overflow menu; no summary strip or legend under the chart.
    expect(screen.getByRole("group", { name: "Zoom" }).closest("details.odo-more")).not.toBeNull();
    expect(screen.queryByRole("list", { name: "Chart summary" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Findings legend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record a finding" })).toBeNull();

    const surface = document.querySelector('[data-tooth="16"]');
    if (surface === null) throw new Error("tooth 16 is not in the odontogram");
    await user.click(surface);
    const panel = await screen.findByRole("complementary", { name: "Tooth 16 panel" });
    const start = within(panel).queryByRole("button", { name: "Start visit" });
    if (start !== null) await user.click(start);
    await user.click(await within(panel).findByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Crown" }));
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    await waitFor(() => {
      expect(calls.chart).toHaveLength(1);
    });
    expect(calls.chart[0]?.entries[0]).toMatchObject({ tooth: 16, finding: "crown" });
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Tooth 16 panel" })).toBeNull();
  });
});

describe("the Add form saves in few taps", () => {
  it("starts Completed with the only fitting material chosen, and hides surfaces for whole-tooth treatments", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    const panel = await openTooth(user, 13);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    expect(within(panel).getByRole("button", { name: "Completed" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(panel).getByRole("button", { name: "Implant" }));
    expect(within(panel).queryByRole("button", { name: "Mesial" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Scaling" }));
    expect(within(panel).getByRole<HTMLOptionElement>("option", { name: "Ultrasonic" }).selected).toBe(true);
    await user.click(within(panel).getByRole("button", { name: "Extraction" }));
    expect(within(panel).queryByLabelText("Material")).toBeNull();
    // Extraction is one tap away from saving.
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    await waitFor(() => {
      expect(calls.chart).toHaveLength(1);
    });
    expect(calls.chart[0]?.entries).toEqual([{ tooth: 13, finding: "missing", procedure: "extraction" }]);
  });
});

describe("the tooth panel", () => {
  it("opens empty, adds a root canal with canals and working length, then edits it as a correction", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    await ready();
    await user.click(tooth(26));
    const first = await screen.findByRole("complementary", { name: "Tooth 26 panel" });
    expect(await within(first).findByText("No treatment on this tooth yet.")).toBeTruthy();
    const panel = await openTooth(user, 26);

    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Root canal" }));
    await user.click(within(panel).getByRole("button", { name: "MB1" }));
    await user.click(within(panel).getByRole("button", { name: "MB2" }));
    await user.type(within(panel).getByLabelText(/^Working length/), "20 mm");
    await user.selectOptions(within(panel).getByLabelText("Sitting"), "2");
    await user.selectOptions(within(panel).getByLabelText("Material"), "Gutta percha");
    await user.type(within(panel).getByLabelText("Note"), "obturation done");
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));

    await waitFor(() => {
      expect(calls.chart).toHaveLength(1);
    });
    expect(calls.chart[0]?.entries).toEqual([
      {
        tooth: 26,
        finding: "root_canal",
        procedure: "root_canal",
        material: "gutta_percha",
        note: "obturation done",
        sitting: 2,
        canals: [{ name: "MB1", working_length_mm: 20 }, { name: "MB2", working_length_mm: 20 }],
      },
    ]);
    expect(calls.chart[0]?.client_id).toBeTruthy();
    const row = await within(panel).findByText("Root canal, sitting 2");
    expect(row).toBeTruthy();
    expect(within(panel).getByText("MB1 20 mm")).toBeTruthy();
    expect(within(panel).queryByRole("form")).toBeNull();

    // Edit: a correction that supersedes the entry it replaces; the old row stays in the history.
    await user.click(within(panel).getByRole("button", { name: /^Edit Root canal/ }));
    await user.click(within(panel).getByRole("button", { name: "In progress" }));
    await user.click(within(panel).getByRole("button", { name: "Update treatment" }));
    await waitFor(() => {
      expect(calls.chart).toHaveLength(2);
    });
    const correction = calls.chart[1]?.entries[0];
    expect(correction).toMatchObject({ tooth: 26, finding: "root_canal", in_progress: true });
    expect(correction?.supersedes_id).toBeTruthy();
    await waitFor(() => {
      expect(within(panel).getAllByText("Superseded")).toHaveLength(1);
    });
    expect(within(panel).getAllByText("In progress").length).toBeGreaterThan(0);
  });

  it("offers only the materials that suit the treatment, and Back and Close from the form", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const panel = await openTooth(user, 16);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    const options = () => within(within(panel).getByLabelText("Material")).getAllByRole("option").map((o) => o.textContent);
    expect(options()).toContain("Composite");
    expect(options()).not.toContain("Zirconia");
    await user.click(within(panel).getByRole("button", { name: "Crown" }));
    expect(options()).toContain("Zirconia");
    expect(options()).not.toContain("Composite");
    // A crown covers the whole tooth, so there are no surfaces to pick.
    expect(within(panel).queryByRole("button", { name: "Mesial" })).toBeNull();

    await user.click(within(panel).getByRole("button", { name: "Back" }));
    expect(within(panel).getByRole("button", { name: "Add treatment" })).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Tooth 16 panel" })).toBeNull();
  });

  it("records a filling on two surfaces as two entries in one batch", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    const panel = await openTooth(user, 14);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Mesial" }));
    await user.click(within(panel).getByRole("button", { name: "Occlusal" }));
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    await waitFor(() => {
      expect(calls.chart).toHaveLength(1);
    });
    expect(calls.chart[0]?.entries.map((e) => [e.surface, e.finding, e.procedure])).toEqual([["M", "filled", "filling"], ["O", "filled", "filling"]]);
    // One row for the two surfaces.
    expect(await within(panel).findAllByText("Filling")).toHaveLength(1);
  });

  it("adds a planned treatment to the patient's plan", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    const panel = await openTooth(user, 46);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Crown" }));
    await user.click(within(panel).getByRole("button", { name: "Planned" }));
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    await waitFor(() => {
      expect(calls.plans).toHaveLength(1);
    });
    expect(calls.plans[0]?.items[0]).toMatchObject({ name: "Crown", tooth: 46, estimate_paise: 0 });
    expect(calls.chart).toHaveLength(0);
    expect(await within(panel).findByText("Planned")).toBeTruthy();
  });

  it("asks for an open visit before recording, and offers Start visit", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    await user.click(tooth(16));
    const panel = await screen.findByRole("complementary", { name: "Tooth 16 panel" });
    expect(await within(panel).findByText("Start a visit to record treatment.")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Add treatment" })).toBeNull();
  });

  it("has no axe violations with the panel and the form open", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const panel = await openTooth(user, 46);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Root canal" }));
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

describe("the tooth panel title, buttons and root canal alignment", () => {
  it("names the tooth by position, says Add treatment, and has only a text Close (no x)", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const panel = await openTooth(user, 15);
    expect(within(panel).getByRole("heading", { name: "15 · Upper right second premolar" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Add treatment" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Close tooth" })).toBeNull();
    expect(within(panel).getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(within(panel).queryByText("Start with it")).toBeNull();
    // Every button is text: the only icon-only control a panel used to have was the x.
    for (const button of within(panel).getAllByRole("button")) expect(button.textContent.trim()).not.toBe("");
  });

  it("names teeth in every quadrant and in the child dentition", async () => {
    const { toothName } = await import("./model.js");
    expect([11, 26, 38, 47, 18].map(toothName)).toEqual(["Upper right central incisor", "Upper left first molar", "Lower left third molar", "Lower right second molar", "Upper right third molar"]);
    expect([51, 64, 73, 85].map(toothName)).toEqual(["Upper right primary central incisor", "Upper left primary first molar", "Lower left primary canine", "Lower right primary second molar"]);
  });

  it("lines up Sitting and Working length: two equal columns, same label row, hint under the input", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const panel = await openTooth(user, 26);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Root canal" }));
    const sitting = within(panel).getByLabelText("Sitting");
    const length = within(panel).getByLabelText(/^Working length \(mm\)/);
    const row = length.closest(".tc-two");
    expect(row).not.toBeNull();
    expect(row?.contains(sitting)).toBe(true);
    // Two fields, side by side as direct children of the two-column row.
    expect(row?.children).toHaveLength(2);
    const [left, right] = Array.from(row?.children ?? []);
    expect(left?.querySelector("label")?.textContent).toBe("Sitting");
    expect(right?.querySelector("label")?.textContent).toBe("Working length (mm)");
    // Nothing sits between a label and its input; the hint comes after the input.
    expect(right?.querySelector("label")?.nextElementSibling?.contains(length)).toBe(true);
    const hint = within(panel).getByText("For every canal chosen");
    expect(length.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(length.getAttribute("aria-describedby")).toBe(hint.id);
    // The panel stacks them when narrow: the stylesheet has a container rule for it.
    expect(row?.closest(".tc-rct")).not.toBeNull();
  });

  it("has no axe violations on the root canal form", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const panel = await openTooth(user, 26);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Root canal" }));
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
