import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, NewChartEntries } from "@aarogyam/api-client";
import type { Fixtures } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WAIT = { timeout: 20_000 };

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
    const tooth21 = shell.querySelector<SVGGElement>('.mv-tooth[data-fdi="21"]');
    if (tooth21 === null) throw new Error("21");
    fireEvent.click(tooth21);
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
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const shell = await screen.findByRole("dialog", { name: "Present mode" }, WAIT);
    await within(shell).findByRole("heading", { name: /teeth$/ }, WAIT);
    const tooth55 = shell.querySelector<SVGGElement>('.mv-tooth[data-fdi="55"]');
    if (tooth55 === null) throw new Error("55");
    fireEvent.click(tooth55);
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
    await user.click(within(shell).getByRole("button", { name: "Today" }));
    expect(within(shell).getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
    expect(shell.querySelector('.mv-tooth[data-fdi="21"]')?.classList.contains("mv-dim")).toBe(false);
    expect(shell.querySelector('.mv-tooth[data-fdi="65"]')?.classList.contains("mv-dim")).toBe(true);
  });
});
