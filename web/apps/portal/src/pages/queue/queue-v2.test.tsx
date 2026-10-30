import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, QueueToken } from "@aarogyam/api-client";
import { fakeTokenFor, type FakeBackend } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const asha = (backend: FakeBackend) => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });

async function tokens(backend: FakeBackend): Promise<readonly QueueToken[]> {
  const queue = await asha(backend).listQueue(undefined);
  if (!queue.ok) throw new Error("expected a queue");
  return queue.value.items;
}

/** The card for a patient, wherever it sits on the board. */
function cardOf(name: string): HTMLElement {
  const card = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-label")?.endsWith(`, ${name}`));
  if (card === undefined) throw new Error(`expected a card for ${name}`);
  return card;
}
const columnOf = (name: string) => cardOf(name).closest("section")?.querySelector("h2")?.textContent ?? "";

describe("Front desk (New look)", () => {
  it("shows the five columns", async () => {
    renderPortal("/queue", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: "Front desk" });
    for (const title of ["Waiting", "Called", "In chair", "Ready to bill", "Done"]) {
      expect(await screen.findByRole("heading", { name: new RegExp(`^${title}`) })).toBeTruthy();
    }
  });

  it("moves a card along: Call, To chair (asks which chair), Ready to bill, Done, each on its endpoint", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const waiting = (await tokens(backend)).find((t) => t.status === "waiting");
    if (waiting === undefined) throw new Error("expected a waiting token");
    const name = waiting.patient.full_name;
    const status: { id: string; status: string; room_id: string | null | undefined }[] = [];
    const call = vi.fn();
    renderPortal("/queue", {
      as: PEOPLE.asha,
      backend,
      wrap: (client: ApiClient) => ({
        ...client,
        setQueueStatus: (id, change, options) => {
          status.push({ id, status: change.status, room_id: change.room_id });
          return client.setQueueStatus(id, change, options);
        },
        callQueueToken: (id, options) => {
          call(id);
          return client.callQueueToken(id, options);
        },
      }),
    });

    await screen.findByRole("heading", { name: "Front desk" });
    await waitFor(() => {
      expect(columnOf(name)).toMatch(/^Waiting/);
    });
    await user.click(within(cardOf(name)).getByRole("button", { name: "Call" }));
    await waitFor(() => {
      expect(columnOf(name)).toMatch(/^Called/);
    });
    expect(call).toHaveBeenCalledWith(waiting.id);

    await user.click(within(cardOf(name)).getByRole("button", { name: "To chair" }));
    const chairs = await screen.findByRole("group", { name: "Chairs" });
    const chair = within(chairs).getAllByRole("button")[0];
    if (chair === undefined) throw new Error("expected chairs");
    const chairName = chair.textContent;
    await user.click(chair);
    await waitFor(() => {
      expect(columnOf(name)).toMatch(/^In chair/);
    });
    expect(status.at(-1)).toMatchObject({ id: waiting.id, status: "in_chair" });
    expect(typeof status.at(-1)?.room_id).toBe("string");
    expect(within(cardOf(name)).getByText(chairName)).toBeTruthy();

    await user.click(within(cardOf(name)).getByRole("button", { name: "Ready to bill" }));
    await waitFor(() => {
      expect(columnOf(name)).toMatch(/^Ready to bill/);
    });
    expect(status.at(-1)).toEqual({ id: waiting.id, status: "ready_to_bill", room_id: undefined });

    await user.click(within(cardOf(name)).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(columnOf(name)).toMatch(/^Done/);
    });
    expect(status.at(-1)).toEqual({ id: waiting.id, status: "done", room_id: undefined });
  });

  it("labels a walk-in 'Walk-in (no booking)' and a booking 'Booked'", async () => {
    const backend = fakeApi((fixtures) => {
      const token = fixtures.queueTokens.find((t) => t.status === "waiting" && t.clinic_id === fixtures.clinics[0]?.id);
      if (token !== undefined) token.appointment_id = null;
    });
    const all = await tokens(backend);
    const walkIn = all.find((t) => t.appointment_id == null);
    const booked = all.find((t) => t.appointment_id != null);
    if (walkIn === undefined || booked === undefined) throw new Error("expected both kinds of token");
    renderPortal("/queue", { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { name: "Front desk" });
    await waitFor(() => {
      expect(within(cardOf(walkIn.patient.full_name)).getByText("Walk-in (no booking)")).toBeTruthy();
    });
    expect(within(cardOf(walkIn.patient.full_name)).queryByText("Booked")).toBeNull();
    expect(within(cardOf(booked.patient.full_name)).getByText("Booked")).toBeTruthy();
    expect(within(cardOf(booked.patient.full_name)).queryByText("Walk-in (no booking)")).toBeNull();
  });

  it("Add to queue offers both paths: check in a booking, or register a walk-in in three steps", async () => {
    const user = userEvent.setup();
    renderPortal("/queue", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Add to queue" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to queue" });
    expect(within(dialog).getByRole("button", { name: /Check in a booking/ })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /Register a walk-in/ }));

    const wizard = await screen.findByRole("dialog", { name: "Walk-in (no booking)" });
    expect(within(wizard).getByText("Details")).toBeTruthy();
    await user.click(within(wizard).getByRole("button", { name: "Next" }));
    expect(await within(wizard).findByRole("alert")).toHaveProperty("textContent", "Enter the patient's name.");
    await user.type(within(wizard).getByLabelText(/^Name/), "Ramesh Pawar");
    await user.click(within(wizard).getByRole("button", { name: "Next" }));
    await user.click(await within(wizard).findByRole("button", { name: "No known allergies" }));
    await user.click(within(wizard).getByRole("button", { name: "Next" }));
    expect(await within(wizard).findByText(/Agrees to visit reminders/)).toBeTruthy();
    await user.click(within(wizard).getByRole("button", { name: "Add to queue" }));
    expect(await screen.findByText(/Ramesh Pawar: token #/)).toBeTruthy();
    await waitFor(() => {
      expect(columnOf("Ramesh Pawar")).toMatch(/^Waiting/);
    });
    expect(within(cardOf("Ramesh Pawar")).getByText("Walk-in (no booking)")).toBeTruthy();
  });

  it("checks in today's booking from a search", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = asha(backend);
    const queue = await client.listQueue(undefined);
    if (!queue.ok) throw new Error("expected a queue");
    const appts = await client.listAppointments({ from: queue.value.date, to: queue.value.date });
    if (!appts.ok) throw new Error("expected appointments");
    const target = appts.value.items.find((a) => (a.status === "booked" || a.status === "confirmed") && a.token_number == null);
    if (target === undefined) throw new Error("expected a booking not yet arrived");

    renderPortal("/queue", { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Add to queue" }));
    await user.click(await screen.findByRole("button", { name: /Check in a booking/ }));
    await user.type(await screen.findByLabelText("Search today's bookings"), target.patient.full_name.slice(0, 5));
    await user.click(await screen.findByRole("button", { name: `Check in ${target.patient.full_name}` }));
    expect(await screen.findByText(`${target.patient.full_name} checked in`)).toBeTruthy();
    await waitFor(() => {
      expect(columnOf(target.patient.full_name)).toMatch(/^Waiting/);
    });
  });

  it("Collect shows the UPI QR and records the payment with an idempotency key", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = asha(backend);
    const waiting = (await tokens(backend)).find((t) => t.status === "waiting");
    if (waiting === undefined) throw new Error("expected a waiting token");
    const draft = await client.createInvoice({ patient_id: waiting.patient.id, items: [{ description: "Consultation", quantity: 1, unit_price_paise: 50000 }] });
    if (!draft.ok) throw new Error("expected a draft bill");
    const issued = await client.issueInvoice(draft.value.id);
    if (!issued.ok) throw new Error("expected an issued bill");
    for (const status of ["in_chair", "ready_to_bill"]) await client.setQueueStatus(waiting.id, { status });

    const paid: { method: string; amount_paise: number; allocations: readonly { invoice_id: string }[]; key: string }[] = [];
    renderPortal("/queue", {
      as: PEOPLE.asha,
      backend,
      wrap: (c: ApiClient) => ({
        ...c,
        recordPayment: (input, key, options) => {
          paid.push({ method: input.method, amount_paise: input.amount_paise, allocations: input.allocations ?? [], key });
          return c.recordPayment(input, key, options);
        },
      }),
    });
    await screen.findByRole("heading", { name: "Front desk" });
    await waitFor(() => {
      expect(columnOf(waiting.patient.full_name)).toMatch(/^Ready to bill/);
    });
    await user.click(within(cardOf(waiting.patient.full_name)).getByRole("button", { name: "Collect" }));
    const dialog = await screen.findByRole("dialog", { name: "Collect payment" });
    await user.click(await within(dialog).findByRole("button", { name: "UPI" }));
    expect(await within(dialog).findByRole("img", { name: /UPI QR for/ })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /^Record/ }));
    await within(dialog).findByText("Paid in full");
    expect(paid).toHaveLength(1);
    expect(paid[0]?.method).toBe("upi");
    expect(paid[0]?.amount_paise).toBe(issued.value.balance_paise);
    expect(paid[0]?.allocations[0]?.invoice_id).toBe(issued.value.id);
    expect(paid[0]?.key).toMatch(/^[0-9a-f-]{36}$/);

    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await waitFor(() => {
      expect(columnOf(waiting.patient.full_name)).toMatch(/^Done/);
    });
  });

  it("Collect attaches a payment proof and takes a part amount", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = asha(backend);
    const waiting = (await tokens(backend)).find((t) => t.status === "waiting");
    if (waiting === undefined) throw new Error("expected a waiting token");
    const draft = await client.createInvoice({ patient_id: waiting.patient.id, items: [{ description: "Consultation", quantity: 1, unit_price_paise: 50000 }] });
    if (!draft.ok) throw new Error("expected a draft bill");
    const issued = await client.issueInvoice(draft.value.id);
    if (!issued.ok) throw new Error("expected an issued bill");
    for (const status of ["in_chair", "ready_to_bill"]) await client.setQueueStatus(waiting.id, { status });

    const paid: { amount_paise: number; attachment_id: string | null | undefined }[] = [];
    const kinds: unknown[] = [];
    renderPortal("/queue", {
      as: PEOPLE.asha,
      backend,
      wrap: (c: ApiClient) => ({
        ...c,
        uploadAttachment: (id, form, options) => {
          kinds.push(form.get("kind"));
          return c.uploadAttachment(id, form, options);
        },
        recordPayment: (input, key, options) => {
          paid.push({ amount_paise: input.amount_paise, attachment_id: input.attachment_id });
          return c.recordPayment(input, key, options);
        },
      }),
    });
    await waitFor(() => {
      expect(columnOf(waiting.patient.full_name)).toMatch(/^Ready to bill/);
    });
    await user.click(within(cardOf(waiting.patient.full_name)).getByRole("button", { name: "Collect" }));
    const dialog = await screen.findByRole("dialog", { name: "Collect payment" });
    await user.click(await within(dialog).findByRole("button", { name: "UPI" }));
    // A part amount above the balance is refused inline before anything is sent.
    await user.type(await within(dialog).findByLabelText(/Part amount/), "999999");
    expect(within(dialog).getByRole("button", { name: /^Record/ }).hasAttribute("disabled")).toBe(true);
    await user.clear(within(dialog).getByLabelText(/Part amount/));
    await user.type(within(dialog).getByLabelText(/Part amount/), "100");
    await user.upload(within(dialog).getByLabelText("Payment proof file"), new File(["x"], "proof.png", { type: "image/png" }));
    await user.click(within(dialog).getByRole("button", { name: /^Record/ }));
    await within(dialog).findByText("Part payment recorded");
    expect(kinds).toEqual(["payment_proof"]);
    expect(paid).toHaveLength(1);
    expect(paid[0]?.amount_paise).toBe(10000);
    expect(paid[0]?.attachment_id).toBeTruthy();
  });

  it("has no axe violations, with the board and with the Add to queue choice open", async () => {
    const user = userEvent.setup();
    renderPortal("/queue", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: /^Waiting/ });
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
    const rules = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
    const board = await axe.run(document.body, rules);
    expect(board.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Add to queue" }));
    await screen.findByRole("dialog", { name: "Add to queue" });
    const open = await axe.run(document.body, rules);
    expect(open.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
