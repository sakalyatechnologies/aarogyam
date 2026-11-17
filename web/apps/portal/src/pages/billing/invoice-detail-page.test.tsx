import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";
import { unwrap, type ApiClient } from "@aarogyam/api-client";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** A ₹500 bill for a Sunrise patient, issued and paid in cash by the owner. */
async function paidBill(backend: ReturnType<typeof fakeApi>) {
  const api = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
  const patient = (await unwrap(api.listPatients({}))).items[0];
  if (patient === undefined) throw new Error("expected a patient");
  const bill = await unwrap(api.createInvoice({ patient_id: patient.id, items: [{ description: "Consultation", quantity: 1, unit_price_paise: 50000 }] }));
  await unwrap(api.issueInvoice(bill.id));
  const payment = await unwrap(api.recordPayment({ patient_id: patient.id, method: "cash", amount_paise: 50000, allocations: [{ invoice_id: bill.id, amount_paise: 50000 }] }, "11111111-1111-4111-8111-111111111111"));
  return { bill, payment };
}

describe("Bill page", () => {
  it("shows one status chip for an issued bill, not Issued beside its payment state", async () => {
    let id = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      id = fixtures.invoices.find((i) => i.clinic_id === sunrise?.id && i.status === "issued")?.id ?? "";
    });
    renderPortal(`/billing/invoices/${id}`, { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { level: 1 });
    // The Void button and the "Paid" amount label aren't chips.
    const chips = (await screen.findAllByText(/^(Paid|Partial|Due|Draft|Void|issued|paid|partial|unpaid)$/)).filter((el) => el.closest("button, dt") === null);
    expect(chips.map((chip) => chip.textContent)).toHaveLength(1);
    expect(["Paid", "Partial", "Due"]).toContain(chips[0]?.textContent);
  });

  it("voids a wrong receipt with a reason: it stays listed as Void and the bill owes the amount again", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const { bill, payment } = await paidBill(backend);
    const reasons: string[] = [];
    renderPortal(`/billing/invoices/${bill.id}`, {
      as: PEOPLE.asha,
      backend,
      wrap: (client: ApiClient) => ({
        ...client,
        voidPayment: (id, body, options) => {
          reasons.push(body.reason);
          return client.voidPayment(id, body, options);
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: `Void receipt ${payment.number}` }));
    const dialog = await screen.findByRole("dialog", { name: `Void receipt ${payment.number}` });
    const confirm = within(dialog).getByRole("button", { name: "Void payment" });
    expect(confirm).toHaveProperty("disabled", true);
    await user.type(within(dialog).getByLabelText(/^Reason/), "Typed 500 for a UPI payment");
    await user.click(confirm);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: `Void receipt ${payment.number}` })).toBeNull();
    });
    expect(reasons).toEqual(["Typed 500 for a UPI payment"]);
    expect(await screen.findByText("Typed 500 for a UPI payment")).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Void receipt ${payment.number}` })).toBeNull();
    expect(await screen.findByRole("button", { name: "Record payment" })).toBeTruthy();
  });

  it("offers no Void on a receipt without billing.write", async () => {
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) {
        membership.role = { key: "collector", name: "Collector", permissions: ["patients.read", "billing.read", "payments.collect"] };
      }
    });
    const { bill, payment } = await paidBill(backend);
    renderPortal(`/billing/invoices/${bill.id}`, { as: PEOPLE.farah, backend });
    expect(await screen.findByRole("link", { name: payment.number })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Void receipt ${payment.number}` })).toBeNull();
  });
});
