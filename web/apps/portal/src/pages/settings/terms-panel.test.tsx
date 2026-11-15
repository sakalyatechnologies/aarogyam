import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, Permission } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const problems = (result: axe.AxeResults) => result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The clinic's own terms: two procedures and a material, plus one already retired. */
function backendWith(farahPermissions?: Permission[]) {
  return fakeApi((fixtures) => {
    const clinic = fixtures.clinics.find((c) => c.host === "sunrise.localtest.me");
    const at = "2026-09-01T05:30:00Z";
    const mine = (id: string, kind: "procedure" | "material", label: string, retired = false) => ({ id, clinic_id: clinic?.id ?? "", kind, label, added_at: at, ...(retired ? { retired_at: at } : {}) });
    fixtures.dentalTerms = [mine("t1", "procedure", "Laser whitening"), mine("t2", "procedure", "Gum sculpt"), mine("t3", "material", "Bonding agent"), mine("t4", "material", "Old resin", true)];
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined && farahPermissions !== undefined) membership.role = { key: "reader", name: "Reader", permissions: farahPermissions };
  });
}

async function openTerms(as: string = PEOPLE.asha, backend = backendWith(), wrap?: (client: ApiClient) => ApiClient) {
  const user = userEvent.setup();
  renderPortal("/settings?tab=terms", { as, backend, ...(wrap === undefined ? {} : { wrap }) });
  await screen.findByRole("list", { name: "Procedures" });
  return user;
}

const sections = () => [...document.querySelectorAll(".st-nl-nav button")].map((b) => b.textContent);

describe("Settings → Treatment terms", () => {
  it("shows the tab only with settings.manage", async () => {
    renderPortal("/settings", { as: PEOPLE.farah, backend: backendWith(["clinical.read"]) });
    await screen.findByRole("navigation", { name: "Settings sections" });
    expect(sections()).not.toContain("Treatment terms");
    cleanup();
    renderPortal("/settings", { as: PEOPLE.farah, backend: backendWith(["settings.manage"]) });
    await screen.findByRole("navigation", { name: "Settings sections" });
    expect(sections()).toContain("Treatment terms");
  });

  it("groups the clinic's own terms by kind, with retired ones collapsed", async () => {
    await openTerms();
    const procedures = screen.getByRole("list", { name: "Procedures" });
    expect(within(procedures).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Gum sculpt"), expect.stringContaining("Laser whitening")]);
    expect(within(screen.getByRole("list", { name: "Materials" })).getByText("Bonding agent")).toBeTruthy();
    const retired = screen.getByText("Retired (1)").closest("details");
    expect(retired?.open).toBe(false);
    expect(within(screen.getByRole("list", { name: "Retired terms", hidden: true })).getByText(/Old resin/)).toBeTruthy();
  });

  it("renames a term inline and sends the label", async () => {
    const renamed: [string, string][] = [];
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      renameDentalTerm: (id, input, options) => {
        renamed.push([id, input.label]);
        return client.renameDentalTerm(id, input, options);
      },
    });
    const user = await openTerms(PEOPLE.asha, backendWith(), wrap);
    await user.click(screen.getByRole("button", { name: "Rename Laser whitening" }));
    const field = screen.getByLabelText("New name for Laser whitening");
    await user.clear(field);
    await user.type(field, "Laser bleaching");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(screen.getByText("Laser bleaching")).toBeTruthy(); });
    expect(renamed).toEqual([["t1", "Laser bleaching"]]);
    expect(screen.queryByText("Laser whitening")).toBeNull();
  });

  it("shows the message of a 409 for a label already on the list", async () => {
    const user = await openTerms();
    await user.click(screen.getByRole("button", { name: "Rename Laser whitening" }));
    const field = screen.getByLabelText("New name for Laser whitening");
    await user.clear(field);
    await user.type(field, "gum sculpt");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByText("The list already has that label.")).textContent).toBeTruthy();
    // The row stays open with what was typed.
    expect(screen.getByDisplayValue("gum sculpt")).toBeTruthy();
  });

  it("retires a term into Retired, and restores it", async () => {
    const user = await openTerms();
    await user.click(screen.getByRole("button", { name: "Retire Gum sculpt" }));
    await waitFor(() => { expect(within(screen.getByRole("list", { name: "Procedures" })).queryByText("Gum sculpt")).toBeNull(); });
    expect(screen.getByText("Retired (2)")).toBeTruthy();
    await user.click(screen.getByText("Retired (2)"));
    await user.click(screen.getByRole("button", { name: "Restore Gum sculpt" }));
    await waitFor(() => { expect(within(screen.getByRole("list", { name: "Procedures" })).getByText("Gum sculpt")).toBeTruthy(); });
    expect(screen.getByText("Retired (1)")).toBeTruthy();
  });

  it("adds a term per kind with clinical.write, and offers no field without it", async () => {
    const user = await openTerms();
    await user.type(screen.getByLabelText("Add material"), "Zebra paste");
    await user.click(screen.getAllByRole("button", { name: "Add term" })[1] ?? document.body);
    await waitFor(() => { expect(within(screen.getByRole("list", { name: "Materials" })).getByText("Zebra paste")).toBeTruthy(); });
    cleanup();
    await openTerms(PEOPLE.farah, backendWith(["settings.manage"]));
    expect(screen.queryByLabelText("Add material")).toBeNull();
    expect(screen.queryByLabelText("Add procedure")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    await openTerms();
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });
});
