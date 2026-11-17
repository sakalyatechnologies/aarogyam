import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";

import { PEOPLE, renderPortal } from "../../test/render.js";
import { inviteProblems } from "./team-panel.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("inviteProblems", () => {
  const good = { name: "Neha Joshi", phone: "9876543210", email: "neha@example.in", roleKey: "front_desk" };

  it("passes a full name, a 10-digit mobile, an email and a role", () => {
    expect(Object.values(inviteProblems(good)).filter(Boolean)).toEqual([]);
  });

  it("names each field that is wrong", () => {
    const problems = inviteProblems({ name: " N ", phone: "12345", email: "neha@example", roleKey: "" });
    expect(problems.name).toMatch(/full name/);
    expect(problems.phone).toMatch(/10-digit/);
    expect(problems.email).toMatch(/email address/);
    expect(problems.roleKey).toMatch(/role/);
    expect(inviteProblems({ ...good, phone: "5876543210" }).phone).toBeDefined();
  });
});

async function openInvite() {
  const user = userEvent.setup();
  renderPortal("/settings?tab=team", { as: PEOPLE.asha });
  await user.click(await screen.findByRole("button", { name: "Invite" }));
  const dialog = within(await screen.findByRole("dialog"));
  await screen.findByRole("option", { name: "Doctor" });
  return { user, dialog };
}

describe("team invite", () => {
  it("checks each field as it is left and keeps Send invite off until all are right", async () => {
    const { user, dialog } = await openInvite();
    const send = dialog.getByRole("button", { name: "Send invite" });
    expect(send).toHaveProperty("disabled", true);

    await user.type(dialog.getByLabelText(/Full name/), "N");
    await user.type(dialog.getByLabelText(/Mobile/), "12345");
    expect(dialog.getByText("Enter their full name.")).toBeTruthy();
    await user.type(dialog.getByLabelText(/^Email/), "neha@example");
    expect(dialog.getByText("Enter a 10-digit mobile number.")).toBeTruthy();
    await user.tab();
    expect(dialog.getByText(/Enter an email address/)).toBeTruthy();
    expect(send).toHaveProperty("disabled", true);

    await user.type(dialog.getByLabelText(/Full name/), "eha Joshi");
    await user.clear(dialog.getByLabelText(/Mobile/));
    await user.type(dialog.getByLabelText(/Mobile/), "98765 43210");
    await user.type(dialog.getByLabelText(/^Email/), ".in");
    await user.selectOptions(dialog.getByLabelText(/^role/i), "doctor");
    expect(dialog.queryByText(/Enter /)).toBeNull();
    expect(send).toHaveProperty("disabled", false);
    expect(await axe.run(document.body, AXE).then((r) => r.violations.map((v) => v.id))).toEqual([]);
  });

  it("sends the invite with name and phone, offers WhatsApp, and lists the name as pending", async () => {
    const { user, dialog } = await openInvite();
    await user.type(dialog.getByLabelText(/Full name/), "Neha Joshi");
    await user.type(dialog.getByLabelText(/Mobile/), "9876543210");
    await user.type(dialog.getByLabelText(/^Email/), "neha@example.in");
    await user.selectOptions(dialog.getByLabelText(/^role/i), "doctor");
    await user.click(dialog.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText(/We emailed neha@example\.in/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Also send on WhatsApp" });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/919876543210\?text=Hi%20Neha%20Joshi.*invite/);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Neha Joshi")).toBeTruthy();
  });
});
