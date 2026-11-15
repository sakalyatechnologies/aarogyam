import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, NewSupportGrant, Permission } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const problems = (result: axe.AxeResults) => result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

const SAM = "c1c1c1c1-0000-4000-8000-0000000000a1";
const LIVE = "d1d1d1d1-0000-4000-8000-00000000000a";
const OLD = "d1d1d1d1-0000-4000-8000-00000000000b";
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
  // The page reads the clock for "ends in" and for the end of a new grant; match the fake API's.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

/** One live grant (with two requests made under it) and one that ended, both for Sam, a synthetic staff member. */
function backendWith(farahPermissions?: Permission[]) {
  return fakeApi((fixtures) => {
    fixtures.platformUsers.push({ id: SAM, display_name: "Sam Support", email: "sam@example.com", role: "support", description: "Support." });
    fixtures.platformUsers.push({ id: "c1c1c1c1-0000-4000-8000-0000000000a2", display_name: "Tara Support", email: "tara@example.com", role: "support", description: "Support." });
    const clinic = fixtures.clinics.find((c) => c.host === "sunrise.localtest.me")?.id ?? "";
    const by = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha)?.id ?? "";
    fixtures.supportGrants = [
      { id: LIVE, clinic_id: clinic, staff_user_id: SAM, starts_at: at(-1), ends_at: at(2), reason: "Check the billing screen", granted_by: by },
      { id: OLD, clinic_id: clinic, staff_user_id: SAM, starts_at: at(-72), ends_at: at(-48), reason: "Import help last week", granted_by: by },
    ];
    fixtures.supportActions = [
      { grant_id: LIVE, at: at(-0.5), method: "GET", route: "/api/v1/patients" },
      { grant_id: LIVE, at: at(-0.4), method: "GET", route: "/api/v1/patients/{id}" },
    ];
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined && farahPermissions !== undefined) membership.role = { key: "reader", name: "Reader", permissions: farahPermissions };
  });
}

interface Calls {
  created: NewSupportGrant[];
  revoked: string[];
}

async function openSupport(as: string = PEOPLE.asha, backend = backendWith()) {
  const user = userEvent.setup({ advanceTimers: () => undefined });
  const calls: Calls = { created: [], revoked: [] };
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    createSupportGrant: (input, options) => {
      calls.created.push(input);
      return client.createSupportGrant(input, options);
    },
    revokeSupportGrant: (id, options) => {
      calls.revoked.push(id);
      return client.revokeSupportGrant(id, options);
    },
  });
  renderPortal("/settings?tab=support", { as, backend, wrap });
  await screen.findByRole("list", { name: "Active access" });
  return { user, calls };
}

const sections = () => [...document.querySelectorAll(".st-nl-nav button")].map((b) => b.textContent);

describe("Settings → Support access", () => {
  it("shows the tab only with support.grant", async () => {
    renderPortal("/settings", { as: PEOPLE.farah, backend: backendWith(["settings.manage"]) });
    await screen.findByRole("navigation", { name: "Settings sections" });
    expect(sections()).not.toContain("Support access");
    cleanup();
    renderPortal("/settings", { as: PEOPLE.farah, backend: backendWith(["support.grant"]) });
    await screen.findByRole("navigation", { name: "Settings sections" });
    expect(sections()).toContain("Support access");
  });

  it("lists active access first, in the clinic's time zone, and keeps past access collapsed", async () => {
    await openSupport();
    const active = screen.getByRole("list", { name: "Active access" });
    expect(within(active).getAllByRole("listitem")).toHaveLength(1);
    expect(within(active).getByText("Sam Support")).toBeTruthy();
    expect(within(active).getByText("Check the billing screen")).toBeTruthy();
    // 11:00 in Pune now; two hours on is 1:00 pm.
    expect(within(active).getByText(/Ends in 2 h 0 min · 3 Oct 2026, 1:00 pm/)).toBeTruthy();
    expect(screen.getByText("Past access (1)").closest("details")?.open).toBe(false);
  });

  it("checks the reason length before sending", async () => {
    const { user, calls } = await openSupport();
    await user.type(screen.getByLabelText("Staff email"), "tara@example.com");
    await user.type(screen.getByLabelText("Reason"), "ab");
    await user.click(screen.getByRole("button", { name: "Give access" }));
    expect(await screen.findByText("Give a reason of 3 to 500 characters.")).toBeTruthy();
    expect(calls.created).toEqual([]);
  });

  it("sends the end time computed from the chosen length, and says access is read-only and logged", async () => {
    const { user, calls } = await openSupport();
    expect(screen.getByText(/Read-only\. It starts now\. Every page they open is logged/)).toBeTruthy();
    await user.type(screen.getByLabelText("Staff email"), "tara@example.com");
    await user.type(screen.getByLabelText("Reason"), "Look at the missing invoice");
    await user.click(within(screen.getByRole("group", { name: "How long" })).getByRole("button", { name: "3 days" }));
    await user.click(screen.getByRole("button", { name: "Give access" }));
    await waitFor(() => { expect(calls.created).toHaveLength(1); });
    expect(calls.created[0]).toEqual({ staff_email: "tara@example.com", reason: "Look at the missing invoice", ends_at: at(72) });
    await waitFor(() => { expect(within(screen.getByRole("list", { name: "Active access" })).getByText("Tara Support")).toBeTruthy(); });
  });

  it("shows the API's message when that person already has access", async () => {
    const { user } = await openSupport();
    await user.type(screen.getByLabelText("Staff email"), "sam@example.com");
    await user.type(screen.getByLabelText("Reason"), "A second grant");
    await user.click(screen.getByRole("button", { name: "Give access" }));
    expect(await screen.findByText("That person already has access; revoke it first.")).toBeTruthy();
  });

  it("asks before it revokes, then calls the endpoint and moves the grant to past access", async () => {
    const { user, calls } = await openSupport();
    await user.click(screen.getByRole("button", { name: "Revoke access for Sam Support" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Keep access" }));
    expect(calls.revoked).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Revoke access for Sam Support" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke access" }));
    await waitFor(() => { expect(calls.revoked).toEqual([LIVE]); });
    await waitFor(() => { expect(screen.getByText("Past access (2)")).toBeTruthy(); });
    expect(screen.queryByRole("button", { name: "Revoke access for Sam Support" })).toBeNull();
  });

  it("expands what they looked at, as route templates, newest first", async () => {
    const { user } = await openSupport();
    await user.click(within(screen.getByRole("list", { name: "Active access" })).getByRole("button", { name: "What they looked at (2) for Sam Support" }));
    const list = await screen.findByRole("list", { name: "What Sam Support looked at" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector("code")?.textContent)).toEqual(["/api/v1/patients/{id}", "/api/v1/patients"]);
  });

  it("has no accessibility violations, with the actions and the confirm open", async () => {
    const { user } = await openSupport();
    await user.click(within(screen.getByRole("list", { name: "Active access" })).getByRole("button", { name: "What they looked at (2) for Sam Support" }));
    await screen.findByRole("list", { name: "What Sam Support looked at" });
    fireEvent.click(screen.getByText("Past access (1)"));
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Revoke access for Sam Support" }));
    await screen.findByRole("dialog");
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });
});
