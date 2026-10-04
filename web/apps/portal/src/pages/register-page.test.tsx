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
  });

  it("validates before sending", async () => {
    const user = userEvent.setup();
    renderPortal("/register");
    await user.type(await screen.findByLabelText(/clinic name/i), "A");
    await user.click(screen.getByRole("button", { name: "Send application" }));
    expect(await screen.findByText("Enter the clinic's name.")).toBeTruthy();
  });

  it("sends the application and shows the one thank-you message", async () => {
    const user = userEvent.setup();
    renderPortal("/register");
    await user.type(await screen.findByLabelText(/clinic name/i), "Smile Care Dental");
    await user.type(screen.getByLabelText(/^city/i), "Pune");
    await user.type(screen.getByLabelText(/your name/i), "Rohit Deshmukh");
    await user.type(screen.getByLabelText(/^email/i), "rohit@smilecare.example");
    await user.click(screen.getByRole("button", { name: "Send application" }));

    expect(await screen.findByRole("heading", { name: "Thanks for applying" })).toBeTruthy();
    expect(screen.getByText(/we'll be in touch/i)).toBeTruthy();
  });
});
