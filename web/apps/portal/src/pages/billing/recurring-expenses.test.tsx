import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { failure, parseApiError } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const PATH = "/billing?tab=expenses&month=2026-10";
const AXE = { rules: { "color-contrast": { enabled: false } } };

/** Asha's clinic with one recurring rent of ₹30,000 on the 1st, from 1 October; `finance` makes Farah a finance reader. */
const withRent = ({ finance = false } = {}) =>
  fakeApi((fixtures) => {
    const asha = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha);
    if (asha === undefined) throw new Error("no membership for Asha");
    fixtures.recurringExpenses = [
      {
        id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405170",
        clinic_id: asha.clinic_id,
        category: "rent",
        amount_paise: 3_000_000,
        method: "upi",
        note: "Shop rent",
        cadence: "monthly",
        day_of_month: 1,
        weekday: null,
        starts_on: "2026-10-01",
        ends_on: null,
        next_due_on: "2026-10-01",
        paused_at: null,
        stopped_at: null,
        recorded_by: asha.id,
        created_at: "2026-10-01T04:30:00Z",
      },
    ];
    if (finance) {
      const farah = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (farah !== undefined) farah.role = { ...ROLES.frontDesk, permissions: [...ROLES.frontDesk.permissions, "finance.view"] };
    }
  });

const RENT_LINE = /^Rent · ₹30,000 · monthly on the 1st · next 1 Nov( 2026)? · UPI$/;
const recurringList = () => screen.findByRole("list", { name: "Recurring expenses" });

afterEach(() => {
  vi.useRealTimers();
});

describe("Billing → Expenses → Recurring", () => {
  it("lists a rule, tags the expense it recorded, and pauses, resumes and stops it", async () => {
    const user = userEvent.setup();
    renderPortal(PATH, { as: PEOPLE.asha, backend: withRent() });
    const list = await recurringList();
    expect(await within(list).findByText(RENT_LINE)).toBeTruthy();
    const rent = await screen.findByRole("region", { name: "Rent" });
    expect(await within(rent).findByText("Recurring")).toBeTruthy();

    await user.click(within(list).getByRole("button", { name: "Pause Rent of ₹30,000" }));
    expect(await within(list).findByText("Paused")).toBeTruthy();
    await user.click(await within(list).findByRole("button", { name: "Resume Rent of ₹30,000" }));
    await waitFor(() => {
      expect(within(list).queryByText("Paused")).toBeNull();
    });

    await user.click(within(list).getByRole("button", { name: "Stop Rent of ₹30,000" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop this recurring expense?" });
    expect((await axe.run(dialog, AXE)).violations).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Stop for good" }));
    expect(await within(list).findByText("Stopped")).toBeTruthy();
    expect(within(list).queryByRole("button", { name: /^Edit/ })).toBeNull();
  });

  it("adds a monthly and a weekly rule from the dialog", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const user = userEvent.setup();
    renderPortal(PATH, { as: PEOPLE.asha });
    expect(await screen.findByText("No recurring expenses")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add recurring expense" }));
    let dialog = await screen.findByRole("dialog", { name: "Add recurring expense" });
    expect((await axe.run(dialog, AXE)).violations).toEqual([]);
    await user.type(within(dialog).getByLabelText(/amount/i), "30,000");
    await user.selectOptions(within(dialog).getByLabelText(/^On day/), "1");
    await user.click(within(dialog).getByRole("button", { name: "Add recurring expense" }));
    const list = await recurringList();
    expect(await within(list).findByText(RENT_LINE)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add recurring expense" }));
    dialog = await screen.findByRole("dialog", { name: "Add recurring expense" });
    await user.selectOptions(within(dialog).getByLabelText(/category/i), "salary");
    await user.type(within(dialog).getByLabelText(/amount/i), "5000");
    await user.selectOptions(within(dialog).getByLabelText(/repeats/i), "weekly");
    await user.selectOptions(within(dialog).getByLabelText(/^On/), "1");
    await user.click(within(dialog).getByRole("button", { name: "Add recurring expense" }));
    // The fake's today is Saturday 3 October.
    expect(await within(list).findByText("Salary · ₹5,000 · weekly on Monday · next 5 Oct · UPI")).toBeTruthy();
  });

  it("checks the amount, and edits a rule for later expenses only", async () => {
    const user = userEvent.setup();
    renderPortal(PATH, { as: PEOPLE.asha, backend: withRent() });
    const list = await recurringList();
    await user.click(await within(list).findByRole("button", { name: "Edit Rent of ₹30,000" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit recurring rent" });
    expect((await axe.run(dialog, AXE)).violations).toEqual([]);
    const amount = within(dialog).getByLabelText(/amount/i);
    await user.clear(amount);
    await user.type(amount, "abc");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/Enter an amount in rupees/)).toBeTruthy();
    await user.clear(amount);
    await user.type(amount, "32,000");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(list).findByText(/^Rent · ₹32,000 · monthly on the 1st/)).toBeTruthy();
    // The October rent recorded before the change keeps its amount.
    const rent = await screen.findByRole("region", { name: "Rent" });
    expect(within(rent).getAllByText("₹30,000").length).toBeGreaterThan(0);
  });

  it("lets a finance reader see the rules without changing them", async () => {
    renderPortal(PATH, { as: PEOPLE.farah, backend: withRent({ finance: true }) });
    const list = await recurringList();
    expect(await within(list).findByText(RENT_LINE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add recurring expense" })).toBeNull();
    expect(within(list).queryByRole("button", { name: /^Pause/ })).toBeNull();
  });

  it("says so when the rules can't load", async () => {
    renderPortal(PATH, {
      as: PEOPLE.asha,
      wrap: (client) => ({
        ...client,
        listRecurringExpenses: () => Promise.resolve(failure(parseApiError(500, { code: "internal", message: "down" }, undefined))),
      }),
    });
    expect(await screen.findByText("Couldn't load recurring expenses")).toBeTruthy();
  });
});
