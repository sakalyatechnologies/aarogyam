import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";
import { setSessionHistoryStyle } from "./history-style.js";

const WAIT = { timeout: 5000 };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
  setSessionHistoryStyle(undefined);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  setSessionHistoryStyle(undefined);
});

function setup(saved: string | undefined, opts: { fail?: boolean } = {}) {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/patients/${visit?.patient_id ?? ""}`;
  });
  const puts: string[] = [];
  let current = saved;
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    getUiPrefs: async (o) => {
      const result = await client.getUiPrefs(o);
      return result.ok && current !== undefined ? { ...result, value: { ...result.value, history_view: current } } : result;
    },
    saveUiPrefs: async (input, o) => {
      puts.push(input.history_view ?? "");
      if (opts.fail === true) return { ok: false, error: { status: 500, code: "internal", message: "no" } };
      current = input.history_view ?? current;
      return client.saveUiPrefs(input, o);
    },
  });
  return { path, backend, wrap, puts };
}

describe("History styles", () => {
  it("H opens the saved pop-up, and Esc closes it", async () => {
    const { path, backend, wrap } = setup("popup");
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const button = await screen.findByRole("button", { name: /^History/ });
    await waitFor(() => { expect(button).toBeTruthy(); });
    // wait until the saved choice has loaded
    await new Promise((r) => setTimeout(r, 300));
    fireEvent.keyDown(document.body, { key: "h" });
    const dialog = await screen.findByRole("dialog", { name: "Patient history" }, WAIT);
    expect(await within(dialog).findByRole("listbox", { name: "Visits" }, WAIT)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "Patient history" })).toBeNull(); }, WAIT);
    await waitFor(() => { expect(document.activeElement).toBe(button); }, WAIT);
  });

  it("H opens the full page when nothing is saved", async () => {
    const { path, backend, wrap } = setup(undefined);
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    await screen.findByRole("button", { name: /^History/ });
    fireEvent.keyDown(document.body, { key: "h" });
    expect(await screen.findByRole("heading", { level: 1, name: "History" }, WAIT)).toBeTruthy();
  });

  it("pop-up: Down and Up move between visits, and Esc closes the visit before the dialog", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = setup("popup");
    renderPortal(`${path}?history=1`, { as: PEOPLE.asha, backend, wrap });
    const dialog = await screen.findByRole("dialog", { name: "Patient history" }, WAIT);
    const options = await within(dialog).findAllByRole("option", {}, WAIT);
    const nth = (i: number) => {
      const el = screen.getAllByRole("option")[i];
      if (el === undefined) throw new Error("no such visit");
      return el;
    };
    await user.click(nth(0));
    await waitFor(() => { expect(nth(0).getAttribute("aria-selected")).toBe("true"); }, WAIT);
    if (options.length > 1) {
      fireEvent.keyDown(nth(0), { key: "ArrowDown" });
      await waitFor(() => { expect(nth(1).getAttribute("aria-selected")).toBe("true"); }, WAIT);
      fireEvent.keyDown(nth(1), { key: "ArrowUp" });
      await waitFor(() => { expect(screen.getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe("true"); }, WAIT);
    }
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.getAllByRole("option").every((o) => o.getAttribute("aria-selected") === "false")).toBe(true); }, WAIT);
    expect(screen.getByRole("dialog", { name: "Patient history" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "Patient history" })).toBeNull(); }, WAIT);
  });

  it("story: the 30-second read shows the patient's facts and a row opens a visit", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap } = setup("story");
    renderPortal(`${path}?history=1`, { as: PEOPLE.asha, backend, wrap });
    const dialog = await screen.findByRole("dialog", { name: "Patient story" }, WAIT);
    const read = within(dialog).getByRole("region", { name: "30-second read" });
    for (const label of ["Allergies", "Conditions", "Active plan", "Last visit", "Next visit", "Money due"]) {
      expect(within(read).getByText(label)).toBeTruthy();
    }
    const rows = await within(dialog).findAllByRole("button", { name: /^Treatments: open visit/ }, WAIT);
    const row = rows[0];
    if (row === undefined) throw new Error("no treatment row");
    await user.click(row);
    expect(await within(dialog).findByRole("region", { name: /^Visit / }, WAIT)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(within(dialog).queryByRole("region", { name: /^Visit / })).toBeNull(); }, WAIT);
    expect(screen.getByRole("dialog", { name: "Patient story" })).toBeTruthy();
  });

  it("the header switch changes style for this session without saving", async () => {
    const user = userEvent.setup();
    const { path, backend, wrap, puts } = setup("popup");
    renderPortal(`${path}?history=1`, { as: PEOPLE.asha, backend, wrap });
    const dialog = await screen.findByRole("dialog", { name: "Patient history" }, WAIT);
    await user.click(within(dialog).getByRole("radio", { name: "Story" }));
    expect(await screen.findByRole("dialog", { name: "Patient story" }, WAIT)).toBeTruthy();
    expect(puts).toEqual([]);
  });
});

describe("Settings: History opens as", () => {
  it("saves the choice", async () => {
    const user = userEvent.setup();
    const { backend, wrap, puts } = setup(undefined);
    renderPortal("/settings", { as: PEOPLE.asha, backend, wrap });
    await user.click(await screen.findByRole("radio", { name: "Large pop-up" }, WAIT));
    await waitFor(() => { expect(puts).toEqual(["popup"]); }, WAIT);
    await waitFor(() => { expect(screen.getByRole("radio", { name: "Large pop-up" }).getAttribute("aria-checked")).toBe("true"); }, WAIT);
  });

  it("rolls back and says so when the save fails", async () => {
    const user = userEvent.setup();
    const { backend, wrap, puts } = setup(undefined, { fail: true });
    renderPortal("/settings", { as: PEOPLE.asha, backend, wrap });
    await user.click(await screen.findByRole("radio", { name: "Patient story" }, WAIT));
    await waitFor(() => { expect(puts).toEqual(["story"]); }, WAIT);
    await waitFor(() => { expect(screen.getByRole("radio", { name: "Full page" }).getAttribute("aria-checked")).toBe("true"); }, WAIT);
  });
});
