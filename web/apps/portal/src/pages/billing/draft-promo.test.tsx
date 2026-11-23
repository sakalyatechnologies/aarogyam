import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { patientId, unwrap } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

afterEach(() => {
  cleanup();
});

/** A ₹1,000 draft for a Sunrise patient, and three of that patient's codes: live ₹100 off, expired, and 10%. */
async function draftWithCodes() {
  let seeded: { clinic: string; patient: string } | undefined;
  const backend = fakeApi((fixtures) => {
    const clinic = fixtures.clinics.find((c) => c.slug === "sunrise");
    const patient = fixtures.patients.find((p) => p.clinic_id === clinic?.id);
    if (clinic === undefined || patient === undefined) throw new Error("no patient");
    seeded = { clinic: clinic.id, patient: patient.id };
    const code = (id: string, text: string, kind: string, value: number, validTo: string) => ({
      id,
      clinic_id: clinic.id,
      visit_id: "none",
      patient_id: patient.id,
      code: text,
      purpose: "patient_offer" as const,
      kind,
      value,
      max_discount_paise: null,
      valid_to: validTo,
      revoked: false,
      used: false,
    });
    fixtures.offerCodes = [code("c1", "AAAA-2222", "fixed", 10000, "2099-12-31"), code("c2", "BBBB-3333", "percent_bps", 1000, "2000-01-01")];
  });
  const api = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
  if (seeded === undefined) throw new Error("not seeded");
  const bill = await unwrap(api.createInvoice({ patient_id: patientId.parse(seeded.patient), items: [{ description: "Crown", quantity: 1, unit_price_paise: 100000 }] }));
  return { backend, api, bill };
}

describe("Draft bill offer", () => {
  it("applies the patient's live code with one tap and removes it again", async () => {
    const user = userEvent.setup();
    const { backend, bill } = await draftWithCodes();
    renderPortal(`/billing/invoices/${bill.id}`, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: /Apply ₹100 offer/ }));
    await screen.findByText(/Offer applied: −₹100/);
    await user.click(screen.getByRole("button", { name: "Remove offer" }));
    await screen.findByRole("button", { name: "Apply code" });
  });

  it("applies a typed code, ignoring case and the hyphen", async () => {
    const user = userEvent.setup();
    const { backend, bill } = await draftWithCodes();
    renderPortal(`/billing/invoices/${bill.id}`, { as: PEOPLE.asha, backend });
    await user.type(await screen.findByLabelText("Enter code"), "aaaa 2222");
    await user.click(screen.getByRole("button", { name: "Apply code" }));
    await screen.findByText(/Offer applied/);
  });

  it("says plainly when a code has expired", async () => {
    const user = userEvent.setup();
    const { backend, bill } = await draftWithCodes();
    renderPortal(`/billing/invoices/${bill.id}`, { as: PEOPLE.asha, backend });
    await user.type(await screen.findByLabelText("Enter code"), "BBBB-3333");
    await user.click(screen.getByRole("button", { name: "Apply code" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("That code has expired.");
    });
  });

  it("says it doesn't know an unknown code", async () => {
    const user = userEvent.setup();
    const { backend, bill } = await draftWithCodes();
    renderPortal(`/billing/invoices/${bill.id}`, { as: PEOPLE.asha, backend });
    await user.type(await screen.findByLabelText("Enter code"), "ZZZZ-9999");
    await user.click(screen.getByRole("button", { name: "Apply code" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("don't know that code");
    });
  });
});
