import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Fixtures } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

function withPatient(email: string | null) {
  let path = "";
  const backend = fakeApi((fixtures: Fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id);
    if (patient !== undefined) {
      patient.email = email;
      path = `/patients/${patient.id}`;
      fixtures.attachments.push({
        id: "f1",
        clinic_id: sunrise?.id ?? "",
        patient_id: patient.id,
        kind: "xray",
        mime_type: "application/pdf",
        label: "OPG",
        size_bytes: 2048,
        sha256: "0".repeat(64),
        url: "blob:x",
        created_at: "2026-10-01T05:00:00Z",
      });
    }
  });
  return { path, backend };
}

describe("Patient 360: patient app", () => {
  it("invites the patient with a one-time code shown as text and a QR code", async () => {
    const user = userEvent.setup();
    const { path, backend } = withPatient("ravi@example.in");
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByText(/Not connected/)).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Invite to patient app" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Patient app link code" })).toBeTruthy();
    expect(within(dialog).getByLabelText("Link code").textContent).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(within(dialog).getByText(/emailed this code/)).toBeTruthy();
  });

  it("asks for an email before inviting", async () => {
    const { path, backend } = withPatient(null);
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByText(/Add the patient's email to invite them/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invite to patient app" })).toBeNull();
  });

  it("shares a file with the patient from the Files tab", async () => {
    const user = userEvent.setup();
    const { path, backend } = withPatient("ravi@example.in");
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Files" }));
    const toggle = await screen.findByRole("switch", { name: "Share with patient" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(await screen.findByText("Shared with the patient's app")).toBeTruthy();
  });
});
