import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

interface Ids {
  invoice: string;
  payment: string;
  prescription: string;
}

/** Sunrise with a distinctive letterhead, and the ids of one issued bill, receipt and prescription. */
function setup() {
  const ids: Ids = { invoice: "", payment: "", prescription: "" };
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    if (sunrise === undefined) throw new Error("expected Sunrise");
    sunrise.letterhead = { template: "two_doctor", footer: "Thank you for visiting Sunrise", local_name: "सनराइज़ डेंटल" };
    ids.invoice = fixtures.invoices.find((i) => i.clinic_id === sunrise.id && i.status === "issued")?.id ?? "";
    ids.payment = fixtures.payments.find((p) => p.clinic_id === sunrise.id)?.id ?? "";
    ids.prescription = fixtures.prescriptions.find((p) => p.clinic_id === sunrise.id && p.status === "issued")?.id ?? "";
  });
  return { backend, ids };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Printed documents use the clinic letterhead", () => {
  it("prints a prescription under the letterhead", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { backend, ids } = setup();
    renderPortal(`/prescriptions/${ids.prescription}/print`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
    expect(screen.getByText("Thank you for visiting Sunrise")).toBeTruthy();
    expect(screen.getByText(/Dental caries, 46/)).toBeTruthy();
    await waitFor(() => {
      expect(print).toHaveBeenCalled();
    });
  });

  it("prints a bill under the letterhead", async () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { backend, ids } = setup();
    renderPortal(`/billing/invoices/${ids.invoice}/print`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
    expect(screen.getByText("Thank you for visiting Sunrise")).toBeTruthy();
    expect(screen.getByText("Tax invoice")).toBeTruthy();
    expect(screen.getByText("Billed to")).toBeTruthy();
  });

  it("prints a receipt under the letterhead", async () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { backend, ids } = setup();
    renderPortal(`/billing/payments/${ids.payment}/receipt`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
    expect(screen.getByText("Thank you for visiting Sunrise")).toBeTruthy();
    expect(screen.getByText("Payment receipt")).toBeTruthy();
  });
});
