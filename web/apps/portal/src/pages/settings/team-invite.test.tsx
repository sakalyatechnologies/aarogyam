import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, renderPortal } from "../../test/render.js";
import { looksLikePhone } from "./team-panel.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("looksLikePhone", () => {
  it("tells phones from emails", () => {
    expect(looksLikePhone("+91 98765 43210")).toBe(true);
    expect(looksLikePhone("98765-43210")).toBe(true);
    expect(looksLikePhone("a@b.in")).toBe(false);
    expect(looksLikePhone("")).toBe(false);
  });
});

describe("team invite (new look)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(NEW_LOOK_KEY, "1");
  });

  it("invites by email with a role picker", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=team", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Phone or email/), "new.person@example.in");
    expect(within(dialog).queryByLabelText(/Their email/)).toBeNull();
    await screen.findByRole("option", { name: "Doctor" });
    await user.selectOptions(within(dialog).getByLabelText(/^role/i), "doctor");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText(/Invited new\.person@example\.in/)).toBeTruthy();
  });

  it("invites by phone: asks for their email and offers a WhatsApp link", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=team", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Phone or email/), "+91 98765 43210");
    await user.type(await within(dialog).findByLabelText(/Their email/), "nurse@example.in");
    await screen.findByRole("option", { name: "Doctor" });
    await user.selectOptions(within(dialog).getByLabelText(/^role/i), "doctor");
    expect(await axe.run(document.body, AXE).then((r) => r.violations.map((v) => v.id))).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Create invite" }));
    const link = await screen.findByRole("link", { name: "Send on WhatsApp" });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/919876543210\?text=.*invite/);
  });
});
