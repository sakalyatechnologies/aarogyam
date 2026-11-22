import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, NewChartEntries } from "@aarogyam/api-client";
import type { Fixtures } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { chartPrefsKey } from "../../patients/v2/tooth-chart/use-chart-prefs.js";
import { ARCHES } from "../odontogram/model.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The doctor's saved chart look and dentition, as the chart stores them. */
const savePrefs = (look: string, dentition: string) => {
  localStorage.setItem(chartPrefsKey(PEOPLE.asha), JSON.stringify({ look, dentition, view: "treatment" }));
};

/** The tooth numbers Present draws, in screen order, once the chart has loaded. */
async function drawn(shell: HTMLElement, count: number): Promise<number[]> {
  await waitFor(() => { expect(shell.querySelectorAll(".pc [data-tooth]")).toHaveLength(count); }, WAIT);
  return [...shell.querySelectorAll(".pc [data-tooth]")].map((el) => Number(el.getAttribute("data-tooth")));
}

const toothEl = (shell: HTMLElement, n: number): HTMLElement | SVGElement => {
  const el = shell.querySelector<HTMLElement | SVGElement>(`.pc [data-tooth="${String(n)}"]`);
  if (el === null) throw new Error(String(n));
  return el;
};

const WAIT = { timeout: 20_000 };
const XRAY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Show patient opens on story cards (painted is one pick away); "Chart" in the style switcher draws the doctor's chart look. */
async function showChart(shell: HTMLElement) {
  fireEvent.click(await within(shell).findByRole("button", { name: /^Style/ }, WAIT));
  fireEvent.click(within(shell).getByRole("option", { name: "Chart" }));
}

/** A Sunrise visit; its mouth is the Aarav fixture, with 55's depth left out and a current caries entry on 55. */
function present(withXray = false) {
  let path = "";
  const backend = fakeApi((fixtures: Fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id && v.status === "open") ?? fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/visits/${visit?.id ?? ""}/mouth`;
    const asha = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha && m.clinic_id === sunrise?.id)?.id ?? "";
    if (withXray) fixtures.attachments.push({ id: "pm-xray", clinic_id: sunrise?.id ?? "", patient_id: visit?.patient_id ?? "", visit_id: visit?.id ?? null, kind: "xray", mime_type: "image/png", size_bytes: 70, sha256: "0".repeat(64), label: "OPG", created_at: "2026-10-03T05:00:00Z", url: XRAY_PNG });
    fixtures.chartEntries.push({ id: "pm-55", clinic_id: sunrise?.id ?? "", patient_id: visit?.patient_id ?? "", tooth: 55, surface: "O", finding: "caries", status: "current", recorded_by: asha, effective_at: "2026-10-03T05:00:00Z" });
  });
  const recorded: NewChartEntries[] = [];
  let mouthFetches = 0;
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    getVisitMouth: async (id, opts) => {
      mouthFetches += 1;
      const result = await client.getVisitMouth(id, opts);
      if (!result.ok) return result;
      const snap = structuredClone(result.value);
      const t55 = snap.teeth.find((t) => t.tooth === 55);
      if (t55 !== undefined && recorded.length === 0) delete t55.details;
      return { ...result, value: snap };
    },
    recordChartEntries: (id, input, opts) => {
      recorded.push(input);
      return client.recordChartEntries(id, input, opts);
    },
  });
  return { path, backend, wrap, recorded, fetches: () => mouthFetches };
}

describe("Present mode (§1.12)", () => {
  it("shows the mouth view full screen; Esc goes back to the overview without leaving; a tap on Exit does nothing", async () => {
    const { path, backend, wrap } = present();
    const { router } = renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    expect(await within(shell).findByRole("heading", { name: /teeth$/ }, WAIT)).toBeTruthy();
    expect(within(shell).getByRole("button", { name: "How to brush" })).toBeTruthy();
    await showChart(shell);
    await drawn(shell, 32);
    fireEvent.click(toothEl(shell, 21));
    expect(within(shell).getByRole("button", { name: "Back to all teeth" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(shell.querySelector(".mv")?.getAttribute("data-screen")).toBe("overview");
    fireEvent.keyDown(window, { key: "Escape" });
    const exit = within(shell).getByRole("button", { name: "Exit" });
    fireEvent.pointerDown(exit);
    fireEvent.pointerUp(exit);
    expect(router.state.location.pathname).toBe(path);
    expect(screen.getByRole("dialog", { name: "Present mode" })).toBeTruthy();
  });

  it("offers Add depth on caries without a depth, saves it in one tap and refetches the snapshot", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap, recorded, fetches } = present();
    savePrefs("rows", "child");
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await within(shell).findByRole("heading", { name: /teeth$/ }, WAIT);
    await showChart(shell);
    await drawn(shell, 20);
    fireEvent.click(toothEl(shell, 55));
    const group = await within(shell).findByRole("group", { name: "Add depth" }, WAIT);
    const before = fetches();
    await user.click(within(group).getByRole("button", { name: "Dentin" }));
    await waitFor(() => { expect(recorded).toHaveLength(1); }, WAIT);
    expect(recorded[0]?.entries).toEqual([{ tooth: 55, finding: "caries", caries_depth: "dentin", supersedes_id: "pm-55", surface: "O" }]);
    await waitFor(() => { expect(fetches()).toBeGreaterThan(before); }, WAIT);
  });

  it("opens How to brush over the mouth view", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await user.click(within(shell).getByRole("button", { name: "How to brush" }));
    const panel = await screen.findByRole("dialog", { name: /How to brush/ }, WAIT);
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /How to brush/ })).toBeNull();
  });

  it("one mode: Teeth and X-rays tabs; X-rays shows Explain mode's image, chart and summary with an upload", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    const tabs = within(within(shell).getByRole("tablist", { name: "Show" }));
    expect(tabs.getByRole("tab", { name: "Teeth" }).getAttribute("aria-selected")).toBe("true");
    await user.click(tabs.getByRole("tab", { name: "X-rays" }));
    expect(await within(shell).findByRole("region", { name: "Image" }, WAIT)).toBeTruthy();
    expect(within(shell).getByRole("region", { name: "Chart" })).toBeTruthy();
    expect(within(shell).queryByRole("button", { name: "How to brush" })).toBeNull();
    await user.click(within(shell).getByRole("button", { name: "Add X-ray or OPG" }));
    expect(await screen.findByRole("dialog", { name: /upload|X-ray/i }, WAIT)).toBeTruthy();
  });

  it("Today: one line for the doctor, and the chip dims every tooth without today's work or findings", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    expect(await within(shell).findByText(/^Today: /, undefined, WAIT)).toBeTruthy();
    await showChart(shell);
    await user.click(within(shell).getByRole("button", { name: "Today" }));
    expect(within(shell).getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
    await drawn(shell, 32);
    expect(toothEl(shell, 21).hasAttribute("data-dim")).toBe(false);
    expect(toothEl(shell, 11).hasAttribute("data-dim")).toBe(true);
  });

  it("draws the doctor's chart look with the chart's numbers: Rows, 3D arch and Classic, switchable in the bar", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    const adult = [...ARCHES.adult.upper, ...ARCHES.adult.lower];
    await showChart(shell);
    const looks = within(within(shell).getByRole("group", { name: "Chart look" }));
    // No saved choice: Rows and adult teeth, as the chart opens. No milk-tooth number on an adult layout.
    expect(looks.getByRole("button", { name: "Rows" }).getAttribute("aria-pressed")).toBe("true");
    expect(await drawn(shell, 32)).toEqual(adult);
    for (const look of ["3D arch", "Classic"]) {
      await user.click(looks.getByRole("button", { name: look }));
      expect(await drawn(shell, 32)).toEqual(adult);
    }
    expect(shell.querySelector(".pc")?.getAttribute("data-look")).toBe("classic");
    // The marks: 21 is treated today in the fixture.
    expect(shell.querySelector(".pc-classic .mv-tag-today")).not.toBeNull();
  });

  it("opens in the saved look and dentition; a tooth opens its detail and Back returns to the same look", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = present();
    savePrefs("classic", "child");
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await showChart(shell);
    expect(await drawn(shell, 20)).toEqual([...ARCHES.child.upper, ...ARCHES.child.lower]);
    expect(within(within(shell).getByRole("group", { name: "Dentition" })).getByRole("button", { name: "Child" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toothEl(shell, 55));
    await user.click(within(shell).getByRole("button", { name: "Back to all teeth" }));
    expect(shell.querySelector(".mv")?.getAttribute("data-screen")).toBe("overview");
    expect(shell.querySelector(".pc")?.getAttribute("data-look")).toBe("classic");
    await user.click(within(within(shell).getByRole("group", { name: "Dentition" })).getByRole("button", { name: "Adult" }));
    expect(await drawn(shell, 32)).toEqual([...ARCHES.adult.upper, ...ARCHES.adult.lower]);
  });

  it("opens on story cards: the map card first, the dots open the tooth sheet; Painted smile is one pick away", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    expect(await within(shell).findByRole("button", { name: /^Style\s*Story cards/ }, WAIT)).toBeTruthy();
    await waitFor(() => { expect(shell.querySelector("[data-present-style='story']")).not.toBeNull(); }, WAIT);
    expect(shell.querySelector("[data-story-card='mouth']")).not.toBeNull();
    await waitFor(() => { expect([...shell.querySelectorAll(".ps-dot")].map((d) => Number(d.getAttribute("data-tooth")))).toEqual([55, 21, 65, 75]); }, WAIT);
    expect(within(shell).getByText("Painting based on your record")).toBeTruthy();
    expect(within(shell).queryByRole("group", { name: "Chart look" })).toBeNull();
    await user.click(within(shell).getByRole("button", { name: "Next card" }));
    expect(within(shell).getByRole("region", { name: "What we found" })).toBeTruthy();
    fireEvent.click(within(shell).getByRole("button", { name: "Previous card" }));
    const dot = shell.querySelector('.ps-dot[data-tooth="21"]');
    if (dot === null) throw new Error("no dot on 21");
    fireEvent.click(dot);
    expect(shell.querySelector("[data-tooth-sheet='21'], [data-story-card^='tooth:']")).not.toBeNull();
    fireEvent.click(within(shell).getByRole("button", { name: /^Style/ }));
    fireEvent.click(within(shell).getByRole("option", { name: /Painted smile/ }));
    await waitFor(() => { expect(shell.querySelector("[data-present-style='painted']")).not.toBeNull(); }, WAIT);
    expect(shell.querySelector(".ps-dot[data-tooth='21']")).not.toBeNull();
  });

  it("the switcher lists the five styles in order, Story cards and Painted ready; Chart shows the chart looks and back", async () => {
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    fireEvent.click(await within(shell).findByRole("button", { name: /^Style/ }, WAIT));
    await waitFor(() => { expect(within(shell).getByRole("option", { name: /Own X-ray/ }).textContent).toContain("No X-ray yet"); }, WAIT);
    const names = within(shell).getAllByRole("option").map((o) => [o.textContent, o.getAttribute("aria-disabled")]);
    expect(names).toEqual([
      ["Story cardsDefault✓", null], ["Painted smile", null], ["Own X-rayNo X-ray yet", "true"],
      ["3D smileBetaComing soon", "true"], ["Face to toothBetaComing soon", "true"], ["Chart", null],
    ]);
    fireEvent.click(within(shell).getByRole("option", { name: "Chart" }));
    expect(within(shell).getByRole("group", { name: "Chart look" })).toBeTruthy();
    await drawn(shell, 32);
    fireEvent.click(within(shell).getByRole("button", { name: /^Style/ }));
    fireEvent.click(within(shell).getByRole("option", { name: /Painted smile/ }));
    await waitFor(() => { expect(shell.querySelector("[data-present-style='painted']")).not.toBeNull(); }, WAIT);
  });

  it("the story cards and the open switcher have no axe violations", async () => {
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await waitFor(() => { expect(shell.querySelector("[data-present-style='story']")).not.toBeNull(); }, WAIT);
    const run = async () => (await axe.run(shell, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(await run()).toEqual([]);
    fireEvent.click(within(shell).getByRole("button", { name: /^Style/ }));
    expect(await run()).toEqual([]);
  });

  it("Own X-ray: with an X-ray on file it is enabled, shows the image unflipped with Your right on the left, and a finding opens the tooth sheet", async () => {
    const { path, backend, wrap } = present(true);
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    fireEvent.click(await within(shell).findByRole("button", { name: /^Style/ }, WAIT));
    await waitFor(() => { expect(within(shell).getByRole("option", { name: /Own X-ray/ }).getAttribute("aria-disabled")).toBeNull(); }, WAIT);
    fireEvent.click(within(shell).getByRole("option", { name: /Own X-ray/ }));
    await waitFor(() => { expect(shell.querySelector("[data-present-style='xray']")).not.toBeNull(); }, WAIT);
    await waitFor(() => { expect(shell.querySelector(".ps-xray img")).not.toBeNull(); }, WAIT);
    const img = shell.querySelector(".ps-xray img");
    expect(img?.getAttribute("src")).toContain("data:image/png");
    for (const el of shell.querySelectorAll(".ps-xray .xp-stage, .ps-xray .xp-stage *")) expect(el.getAttribute("style") ?? "").not.toMatch(/scale|matrix/i);
    expect(shell.querySelector('.ps-xr-edge[data-side="left"]')?.textContent).toBe("Your right");
    expect(shell.querySelector('.ps-xr-edge[data-side="right"]')?.textContent).toBe("Your left");
    expect(shell.querySelectorAll(".ps-found .ps-badge-rec").length).toBeGreaterThan(0);
    const open = shell.querySelector(".ps-found-open");
    if (open === null) throw new Error("no finding");
    fireEvent.click(open);
    await waitFor(() => { expect(shell.querySelector("[data-tooth-sheet]")).not.toBeNull(); }, WAIT);
  });

  it("story cards add a 'Your X-ray' card only when an X-ray exists", async () => {
    const without = present();
    renderPortal(without.path, { as: PEOPLE.asha, backend: without.backend, wrap: without.wrap });
    const first = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await waitFor(() => { expect(first.querySelector("[data-present-style='story']")).not.toBeNull(); }, WAIT);
    await new Promise((r) => setTimeout(r, 300));
    expect(within(first).queryByRole("button", { name: /Your X-ray/ })).toBeNull();
    cleanup();
    const withIt = present(true);
    renderPortal(withIt.path, { as: PEOPLE.asha, backend: withIt.backend, wrap: withIt.wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await waitFor(() => { expect(within(shell).getByRole("button", { name: /Card \d+ of \d+: Your X-ray/ })).toBeTruthy(); }, WAIT);
  });
});
