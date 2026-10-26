import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, TimeOff } from "@aarogyam/api-client";
import { failure } from "@aarogyam/api-client";
import { fakeTokenFor, type FakeBackend } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";
const DAY = "2026-10-03";

// The panel reads the real clock ("Away soon"); pin it to the fake backend's day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
});

function as(backend: FakeBackend, who: string): ApiClient {
  return backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
}

async function memberOf(backend: FakeBackend, user: string): Promise<string> {
  const staff = await as(backend, PEOPLE.asha).listStaff();
  if (!staff.ok) throw new Error("expected staff");
  const found = staff.value.members.find((m) => m.user_id === user);
  if (found === undefined) throw new Error("no such member");
  return found.id;
}

async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

function setDay(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
}

describe("Settings: Time off", () => {
  it("a team member's request is pending, and shows with its private reason to them", async () => {
    localStorage.setItem(NEW_LOOK_KEY, "1");
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=time-off", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "Request time off" }));
    const dialog = await screen.findByRole("dialog", { name: "Request time off" });
    setDay("First day", "2026-10-20");
    setDay("Last day", "2026-10-21");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Family wedding");
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));
    const mine = await screen.findByRole("list", { name: "My time off" });
    expect(within(mine).getByText("Waiting for approval")).toBeTruthy();
    expect(within(mine).getByText(/Family wedding/)).toBeTruthy();
    expect(within(mine).getByText(/20 Oct – 21 Oct/)).toBeTruthy();
    // A request from someone without manage rights has no approvals section.
    expect(screen.queryByRole("heading", { name: "Approvals" })).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it("the owner approves a request, and declines another with a note", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const farah = as(backend, PEOPLE.farah);
    await farah.requestTimeOff({ kind: "vacation", first_day: "2026-10-20", last_day: "2026-10-21", reason: "Trip" });
    await farah.requestTimeOff({ kind: "personal", first_day: "2026-10-25", last_day: "2026-10-25" });
    let declinedWith: string | null | undefined;
    renderPortal("/settings?tab=time-off", {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        declineTimeOff: (id, decision, opts) => {
          declinedWith = decision?.note;
          return client.declineTimeOff(id, decision, opts);
        },
      }),
    });
    const queue = await screen.findByRole("list", { name: "Requests waiting for approval" });
    expect(within(queue).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(queue).getByRole("button", { name: /^Approve .*20 Oct/ }));
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Requests waiting for approval" })).getAllByRole("listitem")).toHaveLength(1);
    });
    expect(within(await screen.findByRole("list", { name: "Approved time off" })).getByText(/20 Oct – 21 Oct/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Decline .*25 Oct/ }));
    const dialog = await screen.findByRole("dialog", { name: /^Decline/ });
    await user.type(within(dialog).getByLabelText(/^Note/), "Short-staffed that day");
    await user.click(within(dialog).getByRole("button", { name: "Decline request" }));
    await waitFor(() => {
      expect(screen.queryByRole("list", { name: "Requests waiting for approval" })).toBeNull();
    });
    expect(declinedWith).toBe("Short-staffed that day");
  });

  it("time off the owner adds for someone is approved at once, then offers to reassign their appointments", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const dev = await memberOf(backend, PEOPLE.dev);
    const saved: TimeOff[] = [];
    const moved: string[] = [];
    renderPortal("/settings?tab=time-off", {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        requestTimeOff: async (input, opts) => {
          const result = await client.requestTimeOff(input, opts);
          if (result.ok) saved.push(result.value);
          return result;
        },
        changeAppointment: (id, changes, opts) => {
          // The second move fails: a partial result must be reported, not hidden.
          moved.push(id);
          return moved.length === 2 ? Promise.resolve(failure({ status: 409, code: "conflict", message: "Someone else changed this appointment." })) : client.changeAppointment(id, changes, opts);
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Add time off" }));
    const dialog = await screen.findByRole("dialog", { name: "Add time off" });
    await user.selectOptions(within(dialog).getByLabelText(/^Who/), dev);
    setDay("First day", DAY);
    setDay("Last day", DAY);
    await user.click(within(dialog).getByRole("button", { name: "Add time off" }));
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]?.status).toBe("approved");

    const reassign = await screen.findByRole("dialog", { name: /^Reassign \d+ appointments?$/ });
    const rows = within(reassign).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(2);
    // Each row offers a suggested free doctor, and the unassigned ones are flagged.
    for (const row of rows) {
      expect(within(row).getByRole("combobox")).toBeTruthy();
      expect(within(row).getByText("Doctor away")).toBeTruthy();
    }
    expect(await axeViolations()).toEqual([]);
    await user.click(within(reassign).getByRole("button", { name: `Reassign ${String(rows.length)}` }));
    // One call to the usual update per row; the failed one stays flagged.
    await within(reassign).findByText(new RegExp(`Reassigned ${String(rows.length - 1)} of ${String(rows.length)}\\. 1 couldn't be moved`));
    expect(moved).toHaveLength(rows.length);
    expect(within(reassign).getAllByText("Doctor away")).toHaveLength(1);
    expect(within(reassign).getByText("Someone else changed this appointment.")).toBeTruthy();
    expect(within(reassign).getAllByText(/^Moved to /)).toHaveLength(rows.length - 1);
  });

  it("the Needs approval switch reads and writes the clinic's staff-ops setting", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=time-off", { as: PEOPLE.asha, backend });
    const toggle = await screen.findByRole("switch", { name: /Needs approval/ });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await user.click(toggle);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /Needs approval/ }).getAttribute("aria-checked")).toBe("false");
    });
    const settings = await as(backend, PEOPLE.asha).getStaffOpsSettings();
    expect(settings.ok && settings.value.time_off.requires_approval).toBe(false);
    // With approval off, a team member's own request is approved at once.
    const farah = await as(backend, PEOPLE.farah).requestTimeOff({ kind: "sick", first_day: "2026-10-22", last_day: "2026-10-22" });
    expect(farah.ok && farah.value.status).toBe("approved");
  });
});
