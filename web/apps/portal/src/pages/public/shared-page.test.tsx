import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

/** An issued prescription of Sunrise's, shared; returns the link's token and PIN. */
async function sharedLink(backend: ReturnType<typeof fakeApi>) {
  const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
  const patients = await client.listPatients({});
  if (!patients.ok) throw new Error("expected patients");
  const patient = patients.value.items.find((p) => p.status === "active");
  if (patient === undefined) throw new Error("expected a patient");
  const draft = await client.createPrescription(patient.id, {
    diagnosis_text: "Pericoronitis 38",
    advice: "Warm saline rinses",
    items: [{ drug_name: "Metronidazole", strength: "400 mg", dose: "1 tablet", frequency: "1-1-1", timing: "after_food", duration_days: 5 }],
  });
  if (!draft.ok) throw new Error("expected a draft");
  const issued = await client.issuePrescription(draft.value.id, {});
  if (!issued.ok) throw new Error("expected it to issue");
  const link = await client.createShareLink(draft.value.id);
  if (!link.ok) throw new Error("expected a link");
  return { token: link.value.token, pin: link.value.pin, patientName: patient.full_name };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Shared prescription page", () => {
  it("is a full page of its own with the clinic's letterhead on top, before the PIN", async () => {
    const backend = fakeApi();
    const { token } = await sharedLink(backend);
    renderPortal(`/shared/${token}`, { backend });
    expect(await screen.findByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
    expect(screen.getByLabelText(/^PIN/)).toBeTruthy();
    // No portal around it: no sidebar, no sign-in prompt, no dialog.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
  });

  it("opens with the PIN, shows the prescription on the sheet, and prints or saves as PDF", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const backend = fakeApi();
    const { token, pin, patientName } = await sharedLink(backend);
    renderPortal(`/shared/${token}`, { backend });
    await user.type(await screen.findByLabelText(/^PIN/), pin);
    await user.click(screen.getByRole("button", { name: "View prescription" }));

    expect(await screen.findByText(patientName)).toBeTruthy();
    expect(screen.getByText(/Metronidazole 400 mg/)).toBeTruthy();
    expect(screen.getByText(/1 tablet · 1-1-1 · After food · 5 days/)).toBeTruthy();
    expect(screen.getByText("Diagnosis: Pericoronitis 38")).toBeTruthy();
    expect(screen.getByText("Advice: Warm saline rinses")).toBeTruthy();
    // The letterhead stays on top of the opened prescription.
    expect(screen.getByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Print / Save as PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("says how a wrong PIN went and keeps the letterhead", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const { token, pin } = await sharedLink(backend);
    renderPortal(`/shared/${token}`, { backend });
    const wrong = pin === "000000" ? "111111" : "000000";
    await user.type(await screen.findByLabelText(/^PIN/), wrong);
    await user.click(screen.getByRole("button", { name: "View prescription" }));
    expect(await screen.findByText(/Wrong PIN\. 4 tries left\./)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
  });

  it("locks after five wrong PINs", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const { token, pin } = await sharedLink(backend);
    renderPortal(`/shared/${token}`, { backend });
    const wrong = pin === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const input = await screen.findByLabelText(/^PIN/);
      await waitFor(() => {
        expect(input).toHaveProperty("value", "");
      });
      await user.type(input, wrong);
      await user.click(screen.getByRole("button", { name: "View prescription" }));
    }
    expect(await screen.findByText("This link is locked")).toBeTruthy();
  });

  it("explains a link that doesn't exist, on a plain page", async () => {
    renderPortal("/shared/not-a-real-token");
    expect(await screen.findByText("This link isn't available")).toBeTruthy();
    expect(screen.queryByLabelText(/^PIN/)).toBeNull();
  });
});
