import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";

import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../../app.js";
import { routes } from "../../routes.js";

function renderAt(path: string) {
  const backend = createFakeBackend(createFixtures({ now: new Date("2026-10-03T05:30:00Z") }));
  const admin = backend.platformUsers()[0];
  const auth = createDevAuth({ people: [{ id: admin?.id ?? "", displayName: "Admin" }], tokenFor: fakeTokenFor, storage: null });
  auth.signInAs(admin?.id ?? "");
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers services={{ auth, api: backend.client({ getToken: auth.getAccessToken }) }} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
}

/** The table's row for `name`: `DataTable` also renders a hidden mobile card layout, so scope to
 * the table, and wait for the query to settle rather than catching it mid-loading. */
async function tableRow(name: string) {
  const table = await screen.findByRole("table");
  const cell = await within(table).findByText(name);
  const row = cell.closest("tr");
  if (row === null) {
    throw new Error(`No table row for "${name}"`);
  }
  return within(row);
}

describe("Applications", () => {
  it("lists pending applications by default", async () => {
    renderAt("/applications");
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Smile Care Dental")).toBeTruthy();
    expect(within(table).getByText("Riverside Family Dentistry")).toBeTruthy();
    expect(within(table).queryByText("Wellness General Clinic")).toBeNull();
  });

  it("approves an application and shows the invite link once, to copy", async () => {
    const user = userEvent.setup();
    renderAt("/applications");
    const row = await tableRow("Smile Care Dental");
    await user.click(row.getByRole("button", { name: "Approve" }));

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("heading", { name: "Clinic created" })).toBeTruthy();
    const link = screen.getByLabelText<HTMLInputElement>("Invitation link").value;
    expect(link).toMatch(/^https:\/\/smile-care-dental\.localtest\.me\/invite#[0-9a-f]{32}$/);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("rejects an application with a reason", async () => {
    const user = userEvent.setup();
    renderAt("/applications");
    const row = await tableRow("Riverside Family Dentistry");
    await user.click(row.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText(/reason/i), "Not in the pilot area");
    await user.click(screen.getByRole("button", { name: "Reject" }));

    const table = await screen.findByRole("table");
    await within(table).findByText("Smile Care Dental");
    expect(within(table).queryByText("Riverside Family Dentistry")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Rejected" }));
    const rejectedTable = await screen.findByRole("table");
    expect(await within(rejectedTable).findByText("Riverside Family Dentistry")).toBeTruthy();
  });
});
