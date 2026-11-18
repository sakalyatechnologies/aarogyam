import { screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

vi.setConfig({ testTimeout: 60_000 });

interface Ids {
  invoice: string;
  payment: string;
  prescription: string;
  /** The doctor the bill's visit names, as the bill should print it. */
  doctor: string;
}

const REGISTRATION = "KDC-4242";

/**
 * Sunrise with a distinctive letterhead, and the ids of one issued bill, receipt and prescription. The bill is linked to
 * the seeded past visit (whose filling is on tooth 46), and that visit's doctor has a registration number.
 */
function setup() {
  const ids: Ids = { invoice: "", payment: "", prescription: "", doctor: "" };
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    if (sunrise === undefined) throw new Error("expected Sunrise");
    sunrise.letterhead = { template: "two_doctor", footer: "Thank you for visiting Sunrise", local_name: "सनराइज़ डेंटल" };
    const invoice = fixtures.invoices.find((i) => i.clinic_id === sunrise.id && i.status === "issued");
    const procedure = fixtures.procedures.find((p) => p.clinic_id === sunrise.id && p.tooth != null);
    const visit = fixtures.visits.find((v) => v.id === procedure?.visit_id);
    const line = invoice?.items[0];
    if (invoice === undefined || procedure === undefined || visit === undefined || line === undefined) throw new Error("expected a bill and a visit");
    invoice.encounter_id = visit.id;
    invoice.patient_id = visit.patient_id;
    line.procedure_id = procedure.id;
    const practitioner =
      fixtures.practitioners.find((p) => p.clinic_id === sunrise.id && p.membership_id === visit.clinician_membership_id) ?? fixtures.practitioners.find((p) => p.clinic_id === sunrise.id);
    if (practitioner === undefined) throw new Error("expected a practitioner");
    practitioner.membership_id = visit.clinician_membership_id;
    practitioner.display_name = "Dr Kavya Menon";
    practitioner.registration_number = REGISTRATION;
    ids.doctor = practitioner.display_name;
    ids.invoice = invoice.id;
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

  it("prints a bill with the clinic header, doctor, patient, treatment, totals and a signature line", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { backend, ids } = setup();
    renderPortal(`/billing/invoices/${ids.invoice}/print`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { level: 1, name: "Sunrise Dental" })).toBeTruthy();
    const sheet = screen.getByRole("article", { name: /^Tax invoice/ });
    expect(within(sheet).getByText("सनराइज़ डेंटल")).toBeTruthy();
    expect(within(sheet).getByText("Tax invoice")).toBeTruthy();
    expect(within(sheet).getByText("Billed to")).toBeTruthy();

    // The treating doctor, from the bill's visit, with the registration number.
    const parties = within(sheet).getByRole("region", { name: "Patient and doctor" });
    expect(await within(parties).findByText(ids.doctor)).toBeTruthy();
    expect(within(parties).getByText(new RegExp(REGISTRATION))).toBeTruthy();
    expect(within(parties).getByText(/Patient no\./)).toBeTruthy();

    // The treatment done, with the tooth from the visit.
    const lines = within(sheet).getByRole("table", { name: "Treatment and charges" });
    expect(within(lines).getByRole("columnheader", { name: "Tooth" })).toBeTruthy();
    expect(within(lines).getByRole("cell", { name: "46" })).toBeTruthy();

    expect(within(sheet).getByText("Subtotal")).toBeTruthy();
    expect(within(sheet).getByText("Total")).toBeTruthy();
    expect(within(sheet).getByText("Paid")).toBeTruthy();
    expect(within(sheet).getByText("Balance due")).toBeTruthy();
    expect(within(sheet).getByRole("table", { name: "Payments received" })).toBeTruthy();

    expect(within(sheet).getByText("Authorised signatory")).toBeTruthy();
    expect(within(sheet).getAllByText(ids.doctor).length).toBe(2);
    expect(within(sheet).getByText("Thank you for visiting Sunrise")).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();

    await waitFor(() => {
      expect(print).toHaveBeenCalled();
    });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
  });

  it("prints a receipt in the same style", async () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { backend, ids } = setup();
    renderPortal(`/billing/payments/${ids.payment}/receipt`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { level: 1, name: "Sunrise Dental" })).toBeTruthy();
    const sheet = screen.getByRole("article", { name: /^Payment receipt/ });
    expect(within(sheet).getByText("Payment receipt")).toBeTruthy();
    expect(within(sheet).getByText("Received from")).toBeTruthy();
    expect(within(sheet).getByText("Authorised signatory")).toBeTruthy();
    expect(within(sheet).getByText("Thank you for visiting Sunrise")).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });
});
