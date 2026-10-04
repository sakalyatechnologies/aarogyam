import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

describe("Note addenda", () => {
  it("adds an addendum to a signed note", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const note = fixtures.notes.find((n) => n.status === "signed");
      const visit = fixtures.visits.find((v) => v.id === note?.visit_id);
      path = `/patients/${visit?.patient_id ?? ""}/visits/${visit?.id ?? ""}`;
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Add addendum" }));
    await user.type(await screen.findByLabelText(/^Addendum/), "Patient called: pain settled.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const list = await screen.findByRole("list", { name: "Addenda" });
    expect(within(list).getByText("Patient called: pain settled.")).toBeTruthy();
  });

  it("offers no addendum to someone without clinical.write", async () => {
    let path = "";
    const backend = fakeApi((fixtures) => {
      const note = fixtures.notes.find((n) => n.status === "signed");
      const visit = fixtures.visits.find((v) => v.id === note?.visit_id);
      path = `/patients/${visit?.patient_id ?? ""}/visits/${visit?.id ?? ""}`;
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions: ["patients.read", "clinical.read"] };
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    await screen.findByText("SOAP");
    expect(screen.queryByRole("button", { name: "Add addendum" })).toBeNull();
  });
});
