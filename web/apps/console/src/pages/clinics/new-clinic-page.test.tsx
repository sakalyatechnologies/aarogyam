import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

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

const slugField = () => screen.getByRole("textbox", { name: /^address/i });

describe("Create clinic", () => {
  it("fills the address from the name until the address is edited", async () => {
    const user = userEvent.setup();
    renderAt("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Asha Dental Care");
    expect(slugField()).toHaveProperty("value", "asha-dental-care");

    await user.clear(slugField());
    await user.type(slugField(), "ashadental");
    await user.type(screen.getByLabelText(/clinic name/i), " Pune");
    expect(slugField()).toHaveProperty("value", "ashadental");
  });

  it("asks for the owner's email or mobile before sending", async () => {
    const user = userEvent.setup();
    renderAt("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Asha Dental Care");
    await user.type(screen.getByLabelText(/owner's name/i), "Dr. Asha Rane");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    expect(await screen.findByText("Give the owner's email or mobile number.")).toBeTruthy();
  });

  it("shows the API's slug error on the address field", async () => {
    const user = userEvent.setup();
    renderAt("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Smile Catchers");
    await user.clear(slugField());
    await user.type(slugField(), "smilecatchers");
    await user.type(screen.getByLabelText(/owner's name/i), "Dr. Asha Rane");
    await user.type(screen.getByLabelText(/owner's email/i), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    expect(await screen.findByText("That address is already taken.")).toBeTruthy();
    expect(slugField().getAttribute("aria-invalid")).toBe("true");
  });

  it("creates the clinic and lists it", async () => {
    const user = userEvent.setup();
    const router = renderAt("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Asha Dental Care");
    await user.type(screen.getByLabelText(/owner's name/i), "Dr. Asha Rane");
    await user.type(screen.getByLabelText(/owner's mobile/i), "98111 22233");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    await screen.findByRole("heading", { name: "Clinics" });
    expect(router.state.location.pathname).toBe("/clinics");
    const table = await screen.findByRole("table", { name: "Clinics" });
    expect(await within(table).findByText("asha-dental-care.aarogyam.example")).toBeTruthy();
  });
});
