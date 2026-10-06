import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** A patient of the first clinic who has a visit note in the seed. */
function patientWithNote() {
  let path = "";
  let subjective = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const note = fixtures.notes.find((n) => n.clinic_id === sunrise?.id);
    const visit = fixtures.visits.find((v) => v.id === note?.visit_id);
    path = `/patients/${visit?.patient_id ?? ""}`;
    if (note !== undefined) {
      note.sections = { subjective: "Pain **on chewing**", plan: "- RCT\n- Review" };
      subjective = "on chewing";
    }
  });
  return { path, subjective, backend };
}

describe("Notes on Patient 360", () => {
  it("shows the visit notes formatted, and no summary until one is written", async () => {
    const { path, backend } = patientWithNote();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Notes" }));
    expect(await screen.findByText(/No summary yet/)).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Visit notes" });
    expect(within(list).getByText("on chewing").tagName).toBe("STRONG");
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(1);
  });

  it("writes the summary note with the toolbar, then edits it", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithNote();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Notes" }));
    await user.click(await screen.findByRole("button", { name: "Write summary" }));
    const box = screen.getByLabelText("Summary note");
    await user.type(box, "Diabetic");
    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.click(screen.getByRole("button", { name: "Save summary" }));
    expect(await screen.findByText("Summary note saved")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Edit summary" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit summary" }));
    await user.type(screen.getByLabelText("Summary note"), " and anxious");
    await user.click(screen.getByRole("button", { name: "Save summary" }));
    await screen.findByRole("button", { name: "Edit summary" });
    expect(screen.getByText(/and anxious/)).toBeTruthy();
  });

  it("refuses HTML before it is sent", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithNote();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Notes" }));
    await user.click(await screen.findByRole("button", { name: "Write summary" }));
    await user.type(screen.getByLabelText("Summary note"), "hello <b>there");
    expect((await screen.findByRole("alert")).textContent).toContain("HTML isn't allowed");
    expect(screen.getByRole("button", { name: "Save summary" }).hasAttribute("disabled")).toBe(true);
  });

  it("says when someone else changed the note meanwhile", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientWithNote();
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        // The note moves on after the editor read it.
        savePatientSummaryNote: (id, content, _expected, options) => client.savePatientSummaryNote(id, content, 99, options),
      }),
    });
    await user.click(await screen.findByRole("tab", { name: "Notes" }));
    await user.click(await screen.findByRole("button", { name: "Write summary" }));
    await user.type(screen.getByLabelText("Summary note"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save summary" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Someone else changed this note");
  });
});
