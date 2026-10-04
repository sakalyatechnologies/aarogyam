import { render, screen } from "@testing-library/react";
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

  it("asks for the owner's email before sending", async () => {
    const user = userEvent.setup();
    renderAt("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Asha Dental Care");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    expect(await screen.findByText("Enter the owner's email address.")).toBeTruthy();
  });

  it("shows a taken address on the address field", async () => {
    const user = userEvent.setup();
    renderAt("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Sunrise");
    await user.clear(slugField());
    await user.type(slugField(), "sunrise");
    await user.type(screen.getByLabelText(/owner's email/i), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    expect(await screen.findByText("That address is already taken.")).toBeTruthy();
    expect(slugField().getAttribute("aria-invalid")).toBe("true");
  });

  it("creates the clinic and hands over the owner's invitation link, token in the fragment", async () => {
    const user = userEvent.setup();
    renderAt("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Asha Dental Care");
    await user.type(screen.getByLabelText(/owner's email/i), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));

    expect(await screen.findByRole("heading", { name: "Clinic created" })).toBeTruthy();
    const link = screen.getByLabelText<HTMLInputElement>("Invitation link").value;
    expect(link).toMatch(/^http:\/\/asha-dental-care\.localtest\.me:5173\/invite#[0-9a-f]{32}$/);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });
});
