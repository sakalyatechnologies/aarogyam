import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, NewChartEntries, NewPlan, NewToothStatus } from "@aarogyam/api-client";
import type { FakeChartEntry, Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";
import { layoutKey, type P360Layout } from "../use-layout.js";
import { FakeRecognition, installVoiceDoubles, removeVoiceDoubles } from "../../../visits/voice/test-doubles.js";
import { dictationLanguageKey } from "../../../../lib/dictation-language.js";
import { chartPrefsKey, moreDetailsKey } from "./use-chart-prefs.js";

const LAYOUTS: readonly P360Layout[] = ["console", "stage", "tabs"];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
  // These tests drive the extras, so More details starts open.
  localStorage.setItem(moreDetailsKey(PEOPLE.asha), "1");
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
/** The look, Adult / Child and the Key sit in one View menu. */
const openView = async (user: ReturnType<typeof userEvent.setup>) => {
  const button = screen.getByRole("button", { name: "View" });
  if (button.getAttribute("aria-expanded") !== "true") await user.click(button);
};
const ready = () => screen.findByRole("button", { name: "View" });

const tooth = (n: number) => screen.getByRole("button", { name: new RegExp(`^Tooth ${String(n)},`) });

/** Opens the chart, picks a tooth and gets an open visit so treatment can be recorded. */
async function openTooth(user: ReturnType<typeof userEvent.setup>, n: number) {
  await ready();
  await user.click(tooth(n));
  const panel = await screen.findByRole("complementary", { name: `Tooth ${String(n)} panel` });
  const start = screen.queryByRole("button", { name: "Start visit" });
  if (start !== null) await user.click(start);
  await within(panel).findByRole("button", { name: "Add treatment" });
  return panel;
}

describe("the chart", () => {
  it("shows Rows or the 3D arch, Adult or Child, and remembers the look per person (not the dentition)", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(32);
    expect(tooth(18)).toBeTruthy();

    await openView(user);
    await user.click(screen.getByRole("radio", { name: "Child" }));
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(20);
    expect(tooth(55)).toBeTruthy();

    await openView(user);
    await user.click(screen.getByRole("radio", { name: "3D arch" }));
    expect(document.querySelector(".tc-arch")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(chartPrefsKey(PEOPLE.asha)) ?? "null")).toEqual({ look: "arch", dentition: "adult", view: "treatment" });

    cleanup();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    await openView(user);
    expect(screen.getByRole("radio", { name: "3D arch" }).getAttribute("aria-checked")).toBe("true");
    // The dentition belongs to the patient: an adult opens on all 32 teeth.
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(32);
  });

  it("keeps the legend inside the View menu, and shows it on demand", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Chart summary" })).toBeNull();
    await openView(user);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Caries")).toBeTruthy();
    expect(within(legend).getByText("Planned")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it.each(LAYOUTS)("is in the %s layout", async (layout) => {
    const user = userEvent.setup();
    localStorage.setItem(layoutKey(PEOPLE.asha), layout);
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    await openView(user);
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
    await openView(user);
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
    const start = screen.queryByRole("button", { name: "Start visit" });
    if (start !== null) await user.click(start);
    await user.click(await within(panel).findByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Done" }));
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
  it("starts Planned, offers Planned / In progress / Done, and hides surfaces for whole-tooth treatments", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    const panel = await openTooth(user, 13);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    expect(within(panel).getByRole("button", { name: "Planned" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).queryByRole("button", { name: "Watch" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Done" }));
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
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    await user.click(within(panel).getByRole("button", { name: "Root canal" }));
    await user.click(within(panel).getByRole("button", { name: "MB1" }));
    await user.click(within(panel).getByRole("button", { name: "MB2" }));
    await user.type(within(panel).getByLabelText(/^Working length/), "20 mm");
    await user.selectOptions(within(panel).getByLabelText("Sitting"), "2");
    await user.selectOptions(within(panel).getByLabelText("Material"), "Gutta percha");
    await user.type(within(panel).getByLabelText("Treatment note"), "obturation done");
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
    expect(within(panel).queryByRole("form", { name: /treatment for tooth/ })).toBeNull();

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
    await user.click(within(panel).getByRole("button", { name: "Filling" }));
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    await user.click(within(panel).getByRole("button", { name: "Mesial" }));
    await user.click(within(panel).getByRole("button", { name: "Occlusal" }));
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    await waitFor(() => {
      expect(calls.chart).toHaveLength(1);
    });
    expect(calls.chart[0]?.entries.map((e) => [e.surface, e.finding, e.procedure])).toEqual([["M", "filled", "filling"], ["O", "filled", "filling"]]);
    // One row for the two surfaces.
    expect(await within(panel).findAllByText("Filling", { selector: "strong" })).toHaveLength(1);
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

  it("records a finding in the open visit: Decay, a surface and the optional depth, then the next tooth just as fast", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    const panel = await openTooth(user, 36);
    await user.click(within(panel).getByRole("button", { name: "Record a finding" }));
    const form = within(panel).getByRole("form", { name: "Record a finding on tooth 36" });
    expect(within(form).queryByRole("group", { name: /Depth/ })).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Decay" }));
    const depth = within(form).getByRole("group", { name: /Depth/ });
    expect(within(depth).getAllByRole("button").map((b) => b.textContent)).toEqual(["Enamel", "Dentin", "Near nerve"]);
    await user.click(within(form).getByRole("button", { name: "Occlusal" }));
    await user.click(within(depth).getByRole("button", { name: "Dentin" }));
    await user.click(within(form).getByRole("button", { name: "Save finding" }));
    await waitFor(() => {
      expect(calls.chart).toHaveLength(1);
    });
    expect(calls.chart[0]?.entries).toEqual([{ tooth: 36, surface: "O", finding: "caries", caries_depth: "dentin" }]);
    expect(calls.chart[0]?.visit_id).toEqual(expect.any(String));
    // Back on the history view; the next tooth: Broken covers the whole tooth, so no surfaces or depth.
    await within(panel).findByRole("button", { name: "Record a finding" });
    await user.click(tooth(46));
    const next = await screen.findByRole("complementary", { name: "Tooth 46 panel" });
    await user.click(within(next).getByRole("button", { name: "Record a finding" }));
    await user.click(within(next).getByRole("button", { name: "Missing" }));
    expect(within(next).queryByRole("group", { name: "Surfaces" })).toBeNull();
    await user.click(within(next).getByRole("button", { name: "Save finding" }));
    await waitFor(() => {
      expect(calls.chart).toHaveLength(2);
    });
    expect(calls.chart[1]?.entries).toEqual([{ tooth: 46, finding: "missing" }]);
    expect(calls.chart[1]?.visit_id).toBe(calls.chart[0]?.visit_id);
  });

  it("without an open visit, offers Add treatment; saving one starts the visit, then records it", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const calls = spy();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: calls.wrap });
    await ready();
    await user.click(tooth(16));
    const panel = await screen.findByRole("complementary", { name: "Tooth 16 panel" });
    expect(within(panel).queryByText("Start the visit from the bar at the top to add treatment.")).toBeNull();
    expect(within(panel).queryByText(/entries$/)).toBeNull();
    await user.click(await within(panel).findByRole("button", { name: "Add treatment" }));
    // Nothing is chosen yet, so Save waits; the statuses read Planned, In progress, Done.
    expect(within(panel).getByRole("button", { name: "Save treatment" }).hasAttribute("disabled")).toBe(true);
    expect(within(panel).getAllByRole("button", { pressed: true })).toHaveLength(1);
    const status = within(panel).getByRole("group", { name: "Status" });
    expect(within(status).getAllByRole("button").map((b) => b.textContent)).toEqual(["Planned", "In progress", "Done"]);
    expect(within(status).getByRole("button", { name: "Planned" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(panel).getByRole("button", { name: "Crown" }));
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    expect(await screen.findByText(/Tooth 16: Crown saved/)).toBeTruthy();
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

/** A patient whose chart is only `seed`'s entries; returns the path, the backend and the calls to the status endpoints. */
function seeded(seed: (patientId: string, clinicId: string) => Omit<FakeChartEntry, "clinic_id" | "patient_id" | "status" | "effective_at">[] = () => []) {
  let path = "";
  const backend = fakeApi((fixtures: Fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    const patientId = visit?.patient_id ?? "";
    const clinicId = sunrise?.id ?? "";
    path = `/patients/${patientId}`;
    fixtures.procedures = fixtures.procedures.filter((p) => p.patient_id !== patientId);
    fixtures.chartEntries = [
      ...fixtures.chartEntries.filter((c) => c.patient_id !== patientId),
      ...seed(patientId, clinicId).map((e): FakeChartEntry => ({ ...e, clinic_id: clinicId, patient_id: patientId, status: "current", effective_at: "2026-10-01T09:00:00Z" })),
    ];
  });
  const statuses: { tooth: number; input: NewToothStatus }[] = [];
  const cleared: number[] = [];
  const chart: NewChartEntries[] = [];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    setToothStatus: (id, tooth, input, options) => {
      statuses.push({ tooth, input });
      return client.setToothStatus(id, tooth, input, options);
    },
    clearToothStatus: (id, tooth, options) => {
      cleared.push(tooth);
      return client.clearToothStatus(id, tooth, options);
    },
    recordChartEntries: (id, input, options) => {
      chart.push(input);
      return client.recordChartEntries(id, input, options);
    },
  });
  return { path, backend, wrap, statuses, cleared, chart };
}

const uuid = (n: number) => `0190a7c2-0000-7000-8000-${String(n).padStart(12, "0")}`;

/** Picks a tooth without starting a visit: health needs none. */
async function pickTooth(user: ReturnType<typeof userEvent.setup>, n: number) {
  await ready();
  await user.click(tooth(n));
  return screen.findByRole("complementary", { name: `Tooth ${String(n)} panel` });
}

describe("tooth health and a quick note", () => {
  afterEach(() => {
    removeVoiceDoubles();
  });

  it("suggests the health from the chart, saves an override in one tap without a visit, and undoes it", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap, statuses, cleared } = seeded(() => [{ id: uuid(1), tooth: 16, finding: "caries", surface: "O" }]);
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const panel = await pickTooth(user, 16);
    const health = within(panel).getByRole("group", { name: "Health" });
    expect(within(panel).getByText("Needs treatment, suggested from the chart.")).toBeTruthy();
    expect(within(health).getByRole("button", { name: /Needs treatment/ }).hasAttribute("data-suggested")).toBe(true);

    await user.click(within(health).getByRole("button", { name: /Watch/ }));
    await waitFor(() => {
      expect(statuses.map((s) => [s.tooth, s.input.health])).toEqual([[16, "watch"]]);
    });
    expect(within(health).getByRole("button", { name: /Watch/ }).getAttribute("aria-pressed")).toBe("true");
    // The doctor may advise how soon to treat it.
    const within3 = within(within(panel).getByRole("group", { name: "Advise treatment within" })).getByRole("button", { name: "3 mo" });
    await user.click(within3);
    await waitFor(() => {
      expect(statuses.at(-1)?.input).toMatchObject({ health: "watch", treat_within_months: 3 });
    });
    await user.click(await within(panel).findByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(statuses.at(-1)?.input).toMatchObject({ health: "watch" });
    });
    expect(cleared).toEqual([]);
  });

  it("clears the override on Undo when there was none before", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap, cleared } = seeded();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const panel = await pickTooth(user, 21);
    expect(within(panel).getByText("Not assessed yet.")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: /Healthy/ }));
    await user.click(await within(panel).findByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(cleared).toEqual([21]);
    });
  });

  it("saves the note on Enter and when dictation stops, never on blur", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    const { path, backend, wrap, statuses } = seeded(() => [{ id: uuid(2), tooth: 26, finding: "watch" }]);
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const panel = await pickTooth(user, 26);
    const note = within(panel).getByRole("textbox", { name: "Quick note" });
    await user.type(note, "Recheck in 3 months");
    await user.tab();
    expect(statuses).toEqual([]);
    await user.click(note);
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(statuses.map((s) => [s.tooth, s.input.health, s.input.note])).toEqual([[26, "watch", "Recheck in 3 months"]]);
    });

    await user.click(within(panel).getByRole("button", { name: "Dictate the note" }));
    const recogniser = FakeRecognition.instances.at(-1);
    expect(recogniser?.started).toBe(1);
    recogniser?.say("distal caries", true);
    await user.click(within(panel).getByRole("button", { name: "Stop dictating" }));
    await waitFor(() => {
      expect(statuses.at(-1)?.input).toMatchObject({ note: "Recheck in 3 months distal caries" });
    });
  });

  it("dictates the tooth note like visit notes: words show as heard, a pause doesn't end it, stopping keeps them", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    const { path, backend, wrap, statuses } = seeded(() => [{ id: uuid(2), tooth: 26, finding: "watch" }]);
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const panel = await pickTooth(user, 26);
    await user.click(within(panel).getByRole("button", { name: "Dictate the note" }));
    const recogniser = FakeRecognition.instances.at(-1);
    act(() => {
      recogniser?.say("deep caries", true);
    });
    // The browser ends recognition after a silence: it starts again rather than stopping.
    act(() => {
      recogniser?.onend?.();
    });
    expect(recogniser?.started).toBe(2);
    expect(statuses).toEqual([]);
    act(() => {
      recogniser?.say("distal", false);
    });
    expect(within(panel).getByText("distal")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Stop dictating" }));
    await waitFor(() => {
      expect(statuses.at(-1)?.input).toMatchObject({ note: "deep caries distal" });
    });
    expect(recogniser?.aborted).toBe(true);
  });

  it("shows the health set for a tooth on the Classic chart too: a coloured dot and the hover text", async () => {
    localStorage.setItem(chartPrefsKey(PEOPLE.asha), JSON.stringify({ look: "classic", dentition: "adult", view: "treatment" }));
    const user = userEvent.setup();
    const { path, backend, wrap } = seeded();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    await ready();
    fireEvent.click(tooth(23));
    const panel = await screen.findByRole("complementary", { name: "Tooth 23 panel" });
    await user.click(within(panel).getByRole("button", { name: /Needs treatment/ }));
    fireEvent.click(tooth(24));
    await waitFor(() => {
      expect(tooth(23).getAttribute("data-health")).toBe("needs_treatment");
    });
    expect(tooth(23).querySelector("title")?.textContent).toMatch(/Needs treatment$/);
    expect(tooth(23).querySelector(".odo-health")).not.toBeNull();
    expect(tooth(24).getAttribute("data-health")).toBeNull();
  });

  it("starts dictating on a long press in the Classic look too", async () => {
    installVoiceDoubles();
    localStorage.setItem(chartPrefsKey(PEOPLE.asha), JSON.stringify({ look: "classic", dentition: "adult", view: "treatment" }));
    const { path, backend, wrap } = seeded();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    await ready();
    fireEvent.pointerDown(tooth(14));
    await new Promise((resolve) => setTimeout(resolve, 600));
    fireEvent.pointerUp(tooth(14));
    fireEvent.click(tooth(14));
    const panel = await screen.findByRole("complementary", { name: "Tooth 14 panel" });
    await waitFor(() => {
      expect(FakeRecognition.instances.at(-1)?.started).toBe(1);
    });
    expect(within(panel).getByRole("button", { name: "Stop dictating" })).toBeTruthy();
  });

  it("dictates the tooth note in the language set under My profile, and can switch for this tooth", async () => {
    installVoiceDoubles();
    localStorage.setItem(dictationLanguageKey(PEOPLE.asha), "hi-IN");
    const user = userEvent.setup();
    const { path, backend, wrap } = seeded();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const panel = await pickTooth(user, 21);
    const language = within(panel).getByRole("combobox", { name: "Dictation language" });
    expect(language).toHaveProperty("value", "hi-IN");
    await user.click(within(panel).getByRole("button", { name: "Dictate the note" }));
    expect(FakeRecognition.instances.at(-1)?.lang).toBe("hi-IN");
    await user.selectOptions(language, "mr-IN");
    await user.click(within(panel).getByRole("button", { name: "Dictate the note" }));
    expect(FakeRecognition.instances.at(-1)?.lang).toBe("mr-IN");
    // Switching for one tooth leaves the profile's choice as it was.
    expect(localStorage.getItem(dictationLanguageKey(PEOPLE.asha))).toBe("hi-IN");
  });

  it("sets the health with keys 1, 2 and 3 on a focused tooth", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap, statuses } = seeded();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    await ready();
    tooth(36).focus();
    await user.keyboard("3");
    await waitFor(() => {
      expect(statuses.map((s) => [s.tooth, s.input.health])).toEqual([[36, "needs_treatment"]]);
    });
    await screen.findByRole("complementary", { name: "Tooth 36 panel" });
  });

  it("shows a tooth's findings, health, note and advice when the mouse rests on it", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = seeded(() => [{ id: uuid(6), tooth: 16, finding: "caries", surface: "O" }]);
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const panel = await pickTooth(user, 16);
    await user.click(within(panel).getByRole("button", { name: /Watch/ }));
    await user.click(within(within(panel).getByRole("group", { name: "Advise treatment within" })).getByRole("button", { name: "3 mo" }));
    const note = within(panel).getByRole("textbox", { name: "Quick note" });
    await user.type(note, "Deep pit, recheck{Enter}");

    await user.hover(tooth(16));
    const card = await screen.findByRole("tooltip");
    expect(card.textContent).toMatch(/Tooth 16/);
    expect(card.textContent).toMatch(/Caries on occlusal/i);
    expect(card.textContent).toMatch(/Watch/);
    expect(card.textContent).toMatch(/Deep pit, recheck/);
    expect(card.textContent).toMatch(/Advise treatment within 3 months/);
    await user.unhover(tooth(16));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("paints the Health view in three colours with glyphs, unassessed as an outline, and remembers it", async () => {
    const user = userEvent.setup();
    const { path, backend } = seeded(() => [
      { id: uuid(3), tooth: 16, finding: "caries", surface: "O" },
      { id: uuid(4), tooth: 26, finding: "filled", surface: "O" },
      { id: uuid(5), tooth: 11, finding: "watch" },
    ]);
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(tooth(16).hasAttribute("data-health")).toBe(false);
    await user.click(screen.getByRole("radio", { name: "Health" }));
    expect(tooth(16).getAttribute("data-health")).toBe("needs_treatment");
    expect(tooth(16).querySelector(".tc-glyph")?.textContent).toBe("✕");
    expect(tooth(16).getAttribute("aria-label")).toMatch(/Needs treatment$/);
    expect(tooth(26).querySelector(".tc-glyph")?.textContent).toBe("✓");
    expect(tooth(11).querySelector(".tc-glyph")?.textContent).toBe("!");
    expect(tooth(18).getAttribute("data-health")).toBe("unassessed");
    expect(tooth(18).querySelector(".tc-glyph")).toBeNull();
    expect(JSON.parse(localStorage.getItem(chartPrefsKey(PEOPLE.asha)) ?? "null")).toMatchObject({ view: "health" });
    await openView(user);
    expect(within(screen.getByRole("list", { name: "Legend" })).getByText("Not assessed")).toBeTruthy();
  });

  it("has no axe violations with the health row and the Health view", async () => {
    const user = userEvent.setup();
    const { path, backend } = seeded(() => [{ id: uuid(6), tooth: 16, finding: "caries", surface: "O" }]);
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    await user.click(screen.getByRole("radio", { name: "Health" }));
    await pickTooth(user, 16);
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

describe("work done elsewhere, and progress", () => {
  it("offers Done elsewhere for completed work only, sends it, draws it dashed and remembers it on the tooth", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap, chart } = seeded();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const panel = await openTooth(user, 46);
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    await user.click(within(panel).getByRole("button", { name: "Crown" }));
    const away = within(panel).getByRole("switch", { name: "Done elsewhere" });
    await user.click(within(panel).getByRole("button", { name: "In progress" }));
    expect(within(panel).queryByRole("switch", { name: "Done elsewhere" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    await user.click(within(panel).getByRole("switch", { name: "Done elsewhere" }));
    expect(away).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    await waitFor(() => {
      expect(chart.at(-1)?.entries.map((e) => [e.tooth, e.finding, e.elsewhere])).toEqual([[46, "crown", true]]);
    });
    await waitFor(() => {
      expect(tooth(46).hasAttribute("data-elsewhere")).toBe(true);
    });
    expect(tooth(46).getAttribute("aria-label")).toMatch(/done elsewhere/);
    expect(await within(panel).findByText("Done elsewhere")).toBeTruthy();
    // The next treatment on this tooth starts with the switch on.
    await user.click(within(panel).getByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Crown" }));
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    expect(within(panel).getByRole("switch", { name: "Done elsewhere" }).getAttribute("aria-checked")).toBe("true");
    await openView(user);
    expect(within(screen.getByRole("list", { name: "Legend" })).getByText("dashed = done elsewhere")).toBeTruthy();
  });

  it("shows progress since joining: teeth treated here by treatment, and work from before", async () => {
    const { path, backend } = seeded(() => [
      { id: uuid(7), tooth: 36, finding: "filled", surface: "O", procedure: "filling" },
      { id: uuid(8), tooth: 36, finding: "filled", surface: "D", procedure: "filling" },
      { id: uuid(9), tooth: 46, finding: "root_canal", procedure: "root_canal" },
      { id: uuid(10), tooth: 26, finding: "crown", elsewhere: true },
      { id: uuid(11), tooth: 47, finding: "filled", source: "import" },
    ]);
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    const line = await screen.findByLabelText("Progress");
    expect(line.textContent).toMatch(/2 teeth treated here — 1 filling, 1 root canal\./);
    expect(line.textContent).toMatch(/Before: 2 teeth with work from elsewhere\./);
  });

  it("hides the progress line when there is nothing to say", async () => {
    const { path, backend } = seeded();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await ready();
    expect(screen.queryByLabelText("Progress")).toBeNull();
  });
});
