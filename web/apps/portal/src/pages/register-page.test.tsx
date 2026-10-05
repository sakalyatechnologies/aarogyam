import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderPortal } from "../test/render.js";

describe("Register your clinic", () => {
  it("shows the landing page's two doors when signed out", async () => {
    renderPortal("/");
    expect(await screen.findByRole("heading", { name: /run your clinic/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register your clinic" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Up and running in three steps" })).toBeTruthy();
  });

  it("validates the clinic step before moving on", async () => {
    const user = userEvent.setup();
    renderPortal("/register");
    await user.type(await screen.findByLabelText(/clinic name/i), "A");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Enter the clinic's name.")).toBeTruthy();
    expect(screen.getByText("Enter the clinic's city.")).toBeTruthy();
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("Your clinic");
  });

  it("validates the contact step before sending", async () => {
    const user = userEvent.setup();
    renderPortal("/register");
    await user.type(await screen.findByLabelText(/clinic name/i), "Smile Care Dental");
    await user.type(screen.getByLabelText(/^city/i), "Pune");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("About you");
    await user.type(screen.getByLabelText(/^email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send application" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText(/clinic name/i)).toHaveProperty("value", "Smile Care Dental");
  });

  it("sends the application and shows the thank-you page with what happens next", async () => {
    const user = userEvent.setup();
    renderPortal("/register");
    await user.type(await screen.findByLabelText(/clinic name/i), "Smile Care Dental");
    await user.type(screen.getByLabelText(/^city/i), "Pune");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText(/your name/i), "Rohit Deshmukh");
    await user.type(screen.getByLabelText(/^email/i), "rohit@smilecare.example");
    await user.click(screen.getByRole("button", { name: "Send application" }));

    expect(await screen.findByRole("heading", { name: "Thanks for applying" })).toBeTruthy();
    expect(screen.getByText(/we'll be in touch/i)).toBeTruthy();
    expect(screen.getByText("rohit@smilecare.example")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What happens next" })).toBeTruthy();
  });
});
