import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, NewPayment, Permission } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

// The page sits behind a fake API with latency; a busy machine makes drawers slow to settle.
vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const PAID = "SD/26-27/000001";
const PARTIAL = "SD/26-27/000002";
const DUE = "SD/26-27/000003";

/** Sunrise's two seeded bills (one paid, one part paid) plus an issued bill nobody has paid. */
function withDueBill() {
  return fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const base = fixtures.invoices.find((i) => i.clinic_id === sunrise?.id && i.number === PARTIAL);
    const other = fixtures.patients.find((p) => p.clinic_id === sunrise?.id && p.id !== base?.patient_id);
    if (base === undefined || other === undefined) throw new Error("expected the seeded bills");
    fixtures.invoices.push({ ...base, id: crypto.randomUUID(), patient_id: other.id, number: DUE, items: base.items.map((l) => ({ ...l })) });
  });
}

const OLDER_DUE = "SD/26-27/000004";

/** The ids of the two bills `withTwoBillsForOnePatient` leaves unpaid, oldest first, and the older one's total. */
const twoBills = { older: "", partial: "", olderTotal: 0 };

/** Sunrise's seeded bills plus an older, unpaid bill for the patient whose bill is part paid. */
function withTwoBillsForOnePatient() {
  return fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const base = fixtures.invoices.find((i) => i.clinic_id === sunrise?.id && i.number === PARTIAL);
    if (base === undefined) throw new Error("expected the seeded bills");
    const older = new Date(Date.parse(base.issued_at ?? base.created_at) - 5 * 86_400_000).toISOString();
    const id = crypto.randomUUID();
    fixtures.invoices.push({ ...base, id, number: OLDER_DUE, created_at: older, issued_at: older, items: base.items.map((l) => ({ ...l })) });
    twoBills.older = id;
    twoBills.partial = base.id;
    twoBills.olderTotal = base.items.reduce((sum, l) => sum + l.total_paise, 0);
  });
}

/** Asha, with her role changed. */
function ashaAs(permissions: readonly Permission[]) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha);
    if (membership !== undefined) membership.role = { ...membership.role, permissions: [...permissions] };
  });
}

/** The first of some elements (a test fails when there are none). */
function first<T extends HTMLElement>(found: readonly T[]): T {
  const one = found[0];
  if (one === undefined) throw new Error("expected at least one element");
  return one;
}

const billList = async () => within(await screen.findByRole("table", { name: "Invoices" }));
const bodyRows = async () => (await billList()).getAllByRole("row").slice(1);

describe("Billing (New look)", () => {
  it("filters the bills by status chip", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha, backend: withDueBill() });
    expect(await screen.findByRole("heading", { level: 1, name: "Billing" })).toBeTruthy();
    await waitFor(async () => {
      expect((await bodyRows()).length).toBe(3);
    });

    const chips = screen.getByRole("group", { name: "Filter by status" });
    await user.click(within(chips).getByRole("button", { name: /^Due/ }));
    expect(within(chips).getByRole("button", { name: /^Due/ }).getAttribute("aria-pressed")).toBe("true");
    let rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain(DUE);

    await user.click(within(chips).getByRole("button", { name: /^Partial/ }));
    rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain(PARTIAL);

    await user.click(within(chips).getByRole("button", { name: /^Paid/ }));
    rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain(PAID);
  });

  it("sorts from the column headers", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha, backend: withDueBill() });
    await waitFor(async () => {
      expect((await bodyRows()).length).toBe(3);
    });
    const header = (await billList()).getByRole("columnheader", { name: /Bill/ });
    await user.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect((await bodyRows())[0]?.textContent).toContain(PAID);
    await user.click(within(header).getByRole("button"));
    expect((await bodyRows())[0]?.textContent).toContain(DUE);
  });

  it("opens a bill in a drawer with its lines, payments and balance", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha, backend: withDueBill() });
    await user.click(await screen.findByRole("button", { name: `Open bill ${PARTIAL}` }));
    const drawer = await screen.findByRole("dialog", { name: new RegExp(PARTIAL) });
    expect(await within(drawer).findByRole("table", { name: "Lines on this bill" })).toBeTruthy();
    expect(within(drawer).getByText("Balance")).toBeTruthy();
    expect(await within(drawer).findByRole("list", { name: "Payments on this bill" })).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "Print" })).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "WhatsApp" })).toBeTruthy();
  });

  it("collects the balance by default and sends one idempotency key with the payment", async () => {
    const user = userEvent.setup();
    const calls: { amount: number; key: string; method: string }[] = [];
    const wrap = (client: ApiClient): ApiClient => {
      const original = client.recordPayment.bind(client);
      client.recordPayment = (input, key, options) => {
        calls.push({ amount: input.amount_paise, key, method: input.method });
        return original(input, key, options);
      };
      return client;
    };
    renderPortal("/billing", { as: PEOPLE.asha, backend: withDueBill(), wrap });
    const pending = await screen.findByRole("list", { name: "Pending bills" });
    const collect = within(pending).getAllByRole("button", { name: /^Collect/ });
    expect(collect.length).toBe(2);
    await user.click(first(collect));

    const form = await screen.findByRole("form", { name: "Collect a payment" });
    const amount = within(form).getByRole<HTMLInputElement>("textbox", { name: /Amount/ });
    // The balance of the biggest unpaid bill, in rupees.
    const balance = Number(amount.value);
    expect(balance).toBeGreaterThan(0);
    expect(within(form).getByText(/^Balance ₹/)).toBeTruthy();

    await user.click(within(form).getByRole("button", { name: "Card" }));
    await user.click(within(form).getByRole("button", { name: /^Record/ }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.amount).toBe(Math.round(balance * 100));
    expect(calls[0]?.method).toBe("card");
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows the UPI QR when UPI is chosen", async () => {
    const user = userEvent.setup();
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const base = fixtures.invoices.find((i) => i.clinic_id === sunrise?.id && i.number === PARTIAL);
      if (sunrise === undefined || base === undefined) throw new Error("expected the seeded bill");
      sunrise.upi_id = "sunrise@upi";
    });
    renderPortal("/billing", { as: PEOPLE.asha, backend });
    await user.click(first(await screen.findAllByRole("button", { name: /^Collect/ })));
    const form = await screen.findByRole("form", { name: "Collect a payment" });
    await user.click(within(form).getByRole("button", { name: "UPI" }));
    expect(await within(form).findByRole("img", { name: /UPI QR for/ })).toBeTruthy();
  });

  it("shows a patient with a due and a part-paid bill as one row with one Collect", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha, backend: withTwoBillsForOnePatient() });
    const pending = await screen.findByRole("list", { name: "Pending bills" });
    const rows = within(pending).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    const row = first(rows);
    expect(row.textContent).toContain("2 bills");
    expect(row.textContent).toContain("Partly paid");
    expect(within(row).getAllByRole("button", { name: /^Collect/ })).toHaveLength(1);

    await user.click(within(row).getByRole("button", { name: /^Show the 2 bills/ }));
    const bills = within(row).getByRole("list", { name: /oldest first/ });
    const open = within(bills).getAllByRole("button", { name: /^Open bill/ });
    expect(open.map((b) => b.textContent)).toEqual([OLDER_DUE, PARTIAL]);

    // The All bills table stays one row per bill.
    await waitFor(async () => {
      expect((await bodyRows()).length).toBe(3);
    });
  });

  it("collects for two bills in one payment, oldest first, and a retry never charges twice", async () => {
    const user = userEvent.setup();
    const calls: { input: NewPayment; key: string; paymentId: string | undefined }[] = [];
    let dropFirstReply = true;
    const wrap = (client: ApiClient): ApiClient => {
      const original = client.recordPayment.bind(client);
      client.recordPayment = async (input, key, options) => {
        const result = await original(input, key, options);
        calls.push({ input, key, paymentId: result.ok ? result.value.id : undefined });
        if (dropFirstReply) {
          dropFirstReply = false;
          return { ok: false, error: { status: 0, code: "network_error", message: "The connection dropped." } };
        }
        return result;
      };
      return client;
    };
    renderPortal("/billing", { as: PEOPLE.asha, backend: withTwoBillsForOnePatient(), wrap });
    const pending = await screen.findByRole("list", { name: "Pending bills" });
    await user.click(within(pending).getByRole("button", { name: /^Collect/ }));

    const drawer = await screen.findByRole("dialog", { name: /^Collect from/ });
    const form = within(drawer).getByRole("form", { name: "Collect a payment" });
    const amount = within(form).getByRole<HTMLInputElement>("textbox", { name: /Amount/ });
    const owed = Math.round(Number(amount.value) * 100);
    const split = within(form).getByRole("list", { name: /oldest bill first/ });
    const shares = within(split).getAllByRole("listitem");
    expect(shares.map((s) => s.textContent.slice(0, OLDER_DUE.length))).toEqual([OLDER_DUE, PARTIAL]);
    const audit = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(audit.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);

    // Pay less than all of it: the oldest bill is settled in full first, the rest goes to the next.
    await user.clear(amount);
    await user.type(amount, String(owed / 100 - 100));
    await user.click(within(form).getByRole("button", { name: /^Record/ }));
    expect(await within(form).findByRole("alert")).toBeTruthy();
    await user.click(within(form).getByRole("button", { name: /^Record/ }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });

    const [firstTry, retry] = calls;
    expect(retry?.key).toBe(firstTry?.key);
    expect(retry?.paymentId).toBe(firstTry?.paymentId);
    expect(firstTry?.input.amount_paise).toBe(owed - 10_000);
    const allocations = firstTry?.input.allocations ?? [];
    expect(allocations).toEqual([
      { invoice_id: twoBills.older, amount_paise: twoBills.olderTotal },
      { invoice_id: twoBills.partial, amount_paise: owed - 10_000 - twoBills.olderTotal },
    ]);
    expect(retry?.input.allocations).toEqual(allocations);
  });

  it("hides Collect without billing.write and the Expenses tab without finance.view", async () => {
    const user = userEvent.setup();
    const backend = ashaAs(["billing.read"]);
    renderPortal("/billing", { as: PEOPLE.asha, backend });
    const pending = await screen.findByRole("list", { name: "Pending bills" });
    expect(within(pending).queryByRole("button", { name: /^Collect/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Expenses" })).toBeNull();
    await user.click(first(within(pending).getAllByRole("button", { name: /^Open bill/ })));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("button", { name: "Collect" })).toBeNull();
  });

  it("has no accessibility violations with the drawer open", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha, backend: withDueBill() });
    await user.click(await screen.findByRole("button", { name: `Open bill ${DUE}` }));
    const drawer = await screen.findByRole("dialog", { name: new RegExp(DUE) });
    await within(drawer).findByRole("table", { name: "Lines on this bill" });
    await within(drawer).findByRole("form", { name: "Collect a payment" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
  });

  it("opens a bill with a balance on the collect form, and shows the receipt in the same drawer after recording", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha, backend: withDueBill() });
    await user.click(await screen.findByRole("button", { name: `Open bill ${DUE}` }));
    const drawer = await screen.findByRole("dialog", { name: new RegExp(DUE) });
    const form = await within(drawer).findByRole("form", { name: "Collect a payment" });
    // The form is the first thing, there is no second Collect toggle, and Print sits with the share buttons.
    expect(drawer.querySelector(".bl2-drawer")?.firstElementChild).toBe(form);
    expect(within(drawer).queryByRole("button", { name: "Collect" })).toBeNull();
    const actions = within(drawer).getByRole("group", { name: "Bill actions" });
    expect(within(actions).getByRole("link", { name: /Print/ })).toBeTruthy();
    expect(within(actions).getByRole("link", { name: /WhatsApp/ })).toBeTruthy();
    await user.click(within(form).getByRole("button", { name: /^Record/ }));
    const done = await within(drawer).findByRole("status", { name: "Payment recorded" });
    expect(within(done).getByRole("link", { name: /Print receipt/ })).toBeTruthy();
    expect(within(done).getByRole("link", { name: /WhatsApp receipt/ })).toBeTruthy();
  });

  it("keeps the classic screen when New look is off", async () => {
    localStorage.setItem(NEW_LOOK_KEY, "0");
    renderPortal("/billing", { as: PEOPLE.asha, backend: withDueBill() });
    expect(await screen.findByText("Weekly collections")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Pending bills" })).toBeNull();
  });
});

