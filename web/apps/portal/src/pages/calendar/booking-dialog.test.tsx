import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

function isDisabled(element: HTMLElement): boolean {
  if (!(element instanceof HTMLButtonElement)) throw new Error("expected a button");
  return element.disabled;
}

async function openDialog(user: ReturnType<typeof userEvent.setup>, path = "/calendar?from=2026-09-28&to=2026-10-04") {
  const backend = fakeApi();
  renderPortal(path, { as: PEOPLE.farah, backend });
  await screen.findByRole("group", { name: /Appointments from/ });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await user.click(await screen.findByRole("button", { name: "Schedule an appointment" }));
  const dialog = await screen.findByRole("dialog", { name: "New appointment" });
  return { backend, dialog };
}

describe("Calendar: booking dialog", () => {
  it("has a single New appointment button on the page (the top bar's)", async () => {
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", { as: PEOPLE.farah, backend: fakeApi() });
    await screen.findByRole("group", { name: /Appointments from/ });
    expect(screen.queryByRole("button", { name: "New appointment" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Schedule an appointment" })).toHaveLength(1);
  });

  it("opens on the visible date with details collapsed and Date, Start time and Duration together", async () => {
    const user = userEvent.setup();
    const { dialog } = await openDialog(user);
    expect(within(dialog).getByRole("button", { name: /Mon, 28 Sep/ })).toBeTruthy();
    const row = within(dialog).getByLabelText(/^Start time/).closest(".mk-bk-grid3");
    expect(row).not.toBeNull();
    expect(row?.textContent).toMatch(/Date/);
    expect(row?.textContent).toMatch(/Duration/);
    expect(dialog.querySelector("details.mk-bk-more")?.hasAttribute("open")).toBe(false);
  });

  it("shows a chosen patient as a chip with Change, and greys out New patient meanwhile", async () => {
    const user = userEvent.setup();
    const { backend, dialog } = await openDialog(user);
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const patients = await client.listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const target = patients.value.items.find((p) => p.number === "SD-5");
    if (target === undefined) throw new Error("expected SD-5");
    expect(isDisabled(within(dialog).getByRole("button", { name: "New patient" }))).toBe(false);
    await user.type(within(dialog).getByPlaceholderText("Name, clinic number or phone"), "SD-5");
    await user.click(await within(dialog).findByRole("button", { name: new RegExp(target.full_name) }, { timeout: 5000 }));
    expect(within(dialog).getByText(target.full_name)).toBeTruthy();
    expect(isDisabled(within(dialog).getByRole("button", { name: "New patient" }))).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Change" }));
    expect(within(dialog).getByPlaceholderText("Name, clinic number or phone")).toBeTruthy();
  });

  it("registers a new patient inline when nothing matches, then selects them", async () => {
    const user = userEvent.setup();
    const { dialog } = await openDialog(user);
    await user.type(within(dialog).getByPlaceholderText("Name, clinic number or phone"), "Zed Newcomer");
    await user.click(await within(dialog).findByRole("button", { name: /Register “Zed Newcomer”/ }, { timeout: 5000 }));
    await user.type(within(dialog).getByLabelText(/^Age/), "34");
    await user.click(within(dialog).getByRole("button", { name: "Register patient" }));
    expect(await within(dialog).findByText("Zed Newcomer", {}, { timeout: 5000 })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("lists free times for the chosen doctor and fills the start time from one", async () => {
    const user = userEvent.setup();
    const { dialog } = await openDialog(user, "/calendar?from=2027-03-01&to=2027-03-07");
    expect(within(dialog).getByText(/Choose a doctor to see/)).toBeTruthy();
    const doctor = within(dialog).getByLabelText(/^Doctor/);
    await waitFor(() => {
      expect(within(doctor).getAllByRole("option").length).toBeGreaterThan(1);
    }, { timeout: 5000 });
    await user.selectOptions(doctor, "Asha Kulkarni");
    const slots = await within(dialog).findByRole("group", { name: "Free start times" }, { timeout: 5000 });
    const buttons = within(slots).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    const last = buttons.at(-1);
    if (last === undefined) throw new Error("expected a slot");
    await user.click(last);
    expect(last.getAttribute("aria-pressed")).toBe("true");
  });
});
