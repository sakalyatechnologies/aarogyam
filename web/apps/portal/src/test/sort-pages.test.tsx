import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NEW_LOOK_KEY } from "../lib/new-look.js";
import { PEOPLE, renderPortal } from "./render.js";

/** The first cell of each body row, in order. */
const firstCells = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.firstElementChild?.textContent ?? "");

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  localStorage.clear();
});

describe("Sorting by column header", () => {
  it("reorders the patients directory and has no separate sort control", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "Patients" });
    expect(screen.queryByLabelText("Sort")).toBeNull();
    await waitFor(() => {
      expect(firstCells(table).length).toBeGreaterThan(1);
    });
    const before = firstCells(table);
    await user.click(within(table).getByRole("button", { name: "Patient ID" }));
    expect(within(table).getByRole("columnheader", { name: "Patient ID" }).getAttribute("aria-sort")).toBe("ascending");
    await user.click(within(table).getByRole("button", { name: "Patient" }));
    const asc = firstCells(table);
    await user.click(within(table).getByRole("button", { name: "Patient" }));
    const desc = firstCells(table);
    // Only the first 20 of the loaded list show, so compare the two ends rather than whole pages.
    expect(before.length).toBe(20);
    expect(asc[0]).toContain("Aakash D'Souza");
    expect(desc[0]).toContain("Zoya Sawant");
    expect((await axe.run(table, AXE)).violations).toEqual([]);
  });

  it("reorders the bills table by amount", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "Invoices" });
    const amounts = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => Number((row.children[2]?.textContent ?? "").replace(/[^0-9.]/g, "")));
    await waitFor(() => {
      expect(amounts().length).toBeGreaterThan(1);
    });
    await user.click(within(table).getByRole("button", { name: "Amount" }));
    expect(amounts()).toEqual([...amounts()].sort((a, b) => a - b));
    await user.click(within(table).getByRole("button", { name: "Amount" }));
    expect(amounts()).toEqual([...amounts()].sort((a, b) => b - a));
    expect((await axe.run(table, AXE)).violations).toEqual([]);
  });

  it("reorders the Today appointments by patient", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "Appointments" });
    const patients = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => (row.children[1]?.textContent ?? "").slice(2)); // drop the two-letter avatar
    await waitFor(() => {
      expect(patients().length).toBeGreaterThan(1);
    });
    await user.click(within(table).getByRole("button", { name: "Patient" }));
    expect(within(table).getByRole("columnheader", { name: "Patient" }).getAttribute("aria-sort")).toBe("ascending");
    const asc = patients();
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, "en-IN", { sensitivity: "base" })));
    await user.click(within(table).getByRole("button", { name: "Patient" }));
    const desc = patients();
    expect(desc).toEqual([...desc].sort((a, b) => b.localeCompare(a, "en-IN", { sensitivity: "base" })));
    expect(desc).not.toEqual(asc);
    expect((await axe.run(table, AXE)).violations).toEqual([]);
  });
});
