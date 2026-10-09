import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** The seeded patient with a severe penicillin allergy. */
function allergicPatient() {
  let path = "";
  let number = "";
  const backend = fakeApi((fixtures) => {
    const allergy = fixtures.allergies[0];
    path = `/patients/${allergy?.patient_id ?? ""}`;
    number = fixtures.patients.find((p) => p.id === allergy?.patient_id)?.number ?? "";
  });
  return { path, backend, number };
}

describe("Patient 360 header", () => {
  it("shows the allergy banner and one row of record tabs, Overview first", async () => {
    const { path, backend } = allergicPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByText("Allergies:")).toBeTruthy();
    expect(screen.getByText("Penicillin")).toBeTruthy();
    const tabs = screen.getByRole("tablist", { name: "Patient record" });
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Chart", "Visits", "Rx", "Files", "Notes", "Consent", "Clinical flags", "Billing"]);
    expect(await screen.findByRole("heading", { name: "Recent clinical history" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to patients" }).getAttribute("href")).toBe("/patients");
  });

  it("shows a name stored in lower case in title case, without changing it", async () => {
    let path = "";
    const backend = fakeApi((fixtures) => {
      const patient = fixtures.patients[0];
      if (patient !== undefined) {
        patient.full_name = "ram kumar";
        path = `/patients/${patient.id}`;
      }
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { level: 1, name: "Ram Kumar" })).toBeTruthy();
  });

  it("names the record by its clinic number above the name, not \"Patient 360\"", async () => {
    const { path, backend, number } = allergicPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const summary = await screen.findByRole("region", { name: "Patient summary" });
    expect(await within(summary).findByText(number)).toBeTruthy();
    expect(within(summary).queryByText("Patient 360")).toBeNull();
  });

  it("keeps clinical tabs and history away from people without clinical access", async () => {
    const { path, backend } = allergicPatient();
    renderPortal(path, { as: PEOPLE.farah, backend });
    const tabs = await screen.findByRole("tablist", { name: "Patient record" });
    expect(within(tabs).queryByRole("tab", { name: "Chart" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent clinical history" })).toBeNull();
  });

  it("lists the patient under Recently viewed, with an Allergy chip, after opening the record", async () => {
    const user = userEvent.setup();
    const { path, backend, number } = allergicPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByText("Allergies:");
    await user.click(screen.getByRole("link", { name: "Back to patients" }));
    const recent = await screen.findByRole("region", { name: "Recently viewed" });
    expect(within(recent).getAllByRole("link")).toHaveLength(1);
    await user.type(screen.getByRole("searchbox", { name: "Search patients" }), number);
    const table = await screen.findByRole("table", { name: "Patients" });
    expect(await within(table).findByText("Allergy")).toBeTruthy();
  });
});
