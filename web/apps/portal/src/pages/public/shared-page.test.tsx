import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

/** An issued prescription of Sunrise's, shared; returns the link's token. */
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
  return { token: link.value.token, patientName: patient.full_name };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Shared prescription page", () => {
  it("opens straight away with no PIN, shows the prescription on the clinic's letterhead, and prints or saves as PDF", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const backend = fakeApi();
    const { token, patientName } = await sharedLink(backend);
    renderPortal(`/shared/${token}`, { backend });

    expect(await screen.findByText(patientName)).toBeTruthy();
    // No PIN step, and no portal around it: no sidebar, no sign-in prompt, no dialog.
    expect(screen.queryByLabelText(/^PIN/)).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Metronidazole 400 mg/)).toBeTruthy();
    expect(screen.getByText(/1 tablet · 1-1-1 · After food · 5 days/)).toBeTruthy();
    expect(screen.getByText("Diagnosis: Pericoronitis 38")).toBeTruthy();
    expect(screen.getByText("Advice: Warm saline rinses")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Print / Save as PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("explains a link that doesn't exist, on a plain page", async () => {
    renderPortal("/shared/not-a-real-token");
    expect(await screen.findByText("This link isn't available")).toBeTruthy();
    expect(screen.queryByLabelText(/^PIN/)).toBeNull();
  });
});
