import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** Show patient opens on the painted map; "Chart" in the style switcher draws the doctor's chart look. */
async function showChart(shell: HTMLElement) {
  fireEvent.click(await within(shell).findByRole("button", { name: /^Style/ }, WAIT));
  fireEvent.click(within(shell).getByRole("option", { name: "Chart" }));
}

/** A Sunrise visit; its mouth is the Aarav fixture, with 55's depth left out and a current caries entry on 55. */
function present() {
  let path = "";
  const backend = fakeApi((fixtures: Fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id && v.status === "open") ?? fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/visits/${visit?.id ?? ""}/mouth`;
    const asha = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha && m.clinic_id === sunrise?.id)?.id ?? "";
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

  it("opens on the painted map: dots on the recorded teeth, 'What we found', the dashed painting badge; a dot opens the tooth", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    expect(await within(shell).findByRole("button", { name: /^Style\s*Painted smile/ }, WAIT)).toBeTruthy();
    await waitFor(() => { expect(shell.querySelector("[data-present-style='painted']")).not.toBeNull(); }, WAIT);
    expect([...shell.querySelectorAll(".ps-dot")].map((d) => Number(d.getAttribute("data-tooth")))).toEqual([55, 21, 65, 75]);
    expect(within(shell).getByText("Painting based on your record")).toBeTruthy();
    expect(within(shell).getByRole("region", { name: "What we found" })).toBeTruthy();
    expect(within(shell).queryByRole("group", { name: "Chart look" })).toBeNull();
    const dot = shell.querySelector('.ps-dot[data-tooth="21"]');
    if (dot === null) throw new Error("no dot on 21");
    fireEvent.click(dot);
    await user.click(within(shell).getByRole("button", { name: "Back to all teeth" }));
    expect(shell.querySelector(".mv")?.getAttribute("data-screen")).toBe("overview");
    expect(shell.querySelector("[data-present-style='painted']")).not.toBeNull();
  });

  it("the switcher lists the five styles in order, only Painted ready; Chart shows the chart looks and back", async () => {
    const { path, backend, wrap } = present();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    fireEvent.click(await within(shell).findByRole("button", { name: /^Style/ }, WAIT));
    const names = within(shell).getAllByRole("option").map((o) => [o.textContent, o.getAttribute("aria-disabled")]);
    expect(names).toEqual([
      ["Story cardsComing soon", "true"], ["Painted smile✓", null], ["Own X-rayComing soon", "true"],
      ["3D smileBetaComing soon", "true"], ["Face to toothBetaComing soon", "true"], ["Chart", null],
    ]);
    fireEvent.click(within(shell).getByRole("option", { name: "Chart" }));
    expect(within(shell).getByRole("group", { name: "Chart look" })).toBeTruthy();
    await drawn(shell, 32);
    fireEvent.click(within(shell).getByRole("button", { name: /^Style/ }));
    fireEvent.click(within(shell).getByRole("option", { name: /Painted smile/ }));
    await waitFor(() => { expect(shell.querySelector("[data-present-style='painted']")).not.toBeNull(); }, WAIT);
  });
});
