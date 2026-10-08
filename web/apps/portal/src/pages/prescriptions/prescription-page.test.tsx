import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi, PEOPLE, renderPortal } from "../../test/render.js";

describe("Prescriptions", () => {
  it("issues a prescription, blocking on an allergy alert until an override reason is given", async () => {
    const user = userEvent.setup();
    let patientPath = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const allergy = fixtures.allergies.find((a) => a.clinic_id === sunrise?.id);
      patientPath = `/patients/${allergy?.patient_id ?? ""}/prescriptions`;
    });

    renderPortal(patientPath, { as: PEOPLE.asha, backend });

    await user.click(await screen.findByRole("button", { name: "New prescription" }));

    await user.click(await screen.findByRole("button", { name: "Add free-text medicine" }));
    const medicineInput = screen.getByPlaceholderText("Medicine name");
    await user.type(medicineInput, "PENICILLIN V");

    await user.click(screen.getByRole("button", { name: "Issue prescription" }));

    expect(await screen.findByRole("heading", { name: "Allergy alert" })).toBeTruthy();
    expect(screen.getByText(/penicillin/i)).toBeTruthy();

    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /issue anyway/i });
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/reason to override/i), "Patient confirmed no reaction on last course");
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    expect(await screen.findByText("issued")).toBeTruthy();
  });

  it.each([
    ["rahul@example.com", "Sent to patient by email", /PIN/],
    [null, "Not sent to the patient", /No email on file/],
  ])("shows what happened to the patient's copy after issuing (email %s)", async (email, heading, detail) => {
    const user = userEvent.setup();
    let patientPath = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id && !fixtures.allergies.some((a) => a.patient_id === p.id));
      if (patient !== undefined) {
        patient.email = email;
        patientPath = `/patients/${patient.id}/prescriptions`;
      }
    });
    renderPortal(patientPath, { as: PEOPLE.asha, backend });

    await user.click(await screen.findByRole("button", { name: "New prescription" }));
    await user.click(await screen.findByRole("button", { name: "Add free-text medicine" }));
    await user.type(screen.getByPlaceholderText("Medicine name"), "Paracetamol");
    await user.click(screen.getByRole("button", { name: "Issue prescription" }));

    expect(await screen.findByText(heading)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    if (email !== null) {
      expect(screen.getByLabelText("Patient PIN").textContent).toMatch(/^\d{6}$/);
    }
  });

  it("starts Quick Rx from the last issued prescription", async () => {
    const user = userEvent.setup();
    let patientPath = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const rx = fixtures.prescriptions.find((p) => p.clinic_id === sunrise?.id && p.status === "issued");
      patientPath = `/patients/${rx?.patient_id ?? ""}/prescriptions`;
    });
    renderPortal(patientPath, { as: PEOPLE.asha, backend });

    await user.click(await screen.findByRole("button", { name: "Quick Rx" }));
    expect(await screen.findByText("draft")).toBeTruthy();
    expect(await screen.findByDisplayValue(/amoxicillin/i)).toBeTruthy();
  });
});

describe("A prescription's navigation", () => {
  it("links back to the patient's Rx tab and shows breadcrumbs", async () => {
    const user = userEvent.setup();
    let path = "";
    let patientId = "";
    let name = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const rx = fixtures.prescriptions.find((r) => r.clinic_id === sunrise?.id);
      patientId = rx?.patient_id ?? "";
      name = fixtures.patients.find((p) => p.id === patientId)?.full_name ?? "";
      path = `/prescriptions/${rx?.id ?? ""}`;
    });
    const { router } = renderPortal(path, { as: PEOPLE.asha, backend });
    const back = await screen.findByRole("link", { name: `${name} · Rx` });
    expect(back.getAttribute("href")).toBe(`/patients/${patientId}?tab=prescriptions`);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Patients" }).getAttribute("href")).toBe("/patients");
    expect(within(crumbs).getByRole("link", { name })).toBeTruthy();
    expect(within(crumbs).getByText(/^(RX-|Draft)/).getAttribute("aria-current")).toBe("page");
    await user.click(back);
    expect(router.state.location.search).toBe("?tab=prescriptions");
    expect(await screen.findByRole("tab", { name: "Rx", selected: true })).toBeTruthy();
  });
});
