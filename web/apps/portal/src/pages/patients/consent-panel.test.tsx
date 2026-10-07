import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

function firstPatientPath() {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    path = `/patients/${fixtures.patients.find((p) => p.clinic_id === sunrise?.id)?.id ?? ""}`;
  });
  return { path, backend };
}

describe("Consent on Patient 360", () => {
  it("shows no consent at first, records one, and the header follows", async () => {
    const user = userEvent.setup();
    const { path, backend } = firstPatientPath();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByText("No consent recorded")).toBeTruthy();
    await user.click(await screen.findByRole("tab", { name: "Consent" }));
    expect(await screen.findByText("No consent recorded yet")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Record consent" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Purpose/), "care");
    await user.type(within(dialog).getByLabelText(/Notice version/), "v1 2026-10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const list = await screen.findByRole("list", { name: "Consent records" });
    expect(within(list).getByText("Care and records")).toBeTruthy();
    expect(within(list).getByText(/Notice v1 2026-10/)).toBeTruthy();
    expect(screen.getAllByText("Consent recorded").length).toBeGreaterThan(0);
    expect(screen.queryByText("No consent recorded")).toBeNull();
  });

  it("withdraws a consent and keeps it as history", async () => {
    const user = userEvent.setup();
    const { path, backend } = firstPatientPath();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Consent" }));
    await user.click(await screen.findByRole("button", { name: "Record consent" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Notice version/), "v1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Withdraw consent: Care and records" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record withdrawal" }));
    expect(await screen.findByText("Withdrawn")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Withdraw consent/ })).toBeNull();
    expect(screen.getByText("No consent recorded")).toBeTruthy();
  });
});
