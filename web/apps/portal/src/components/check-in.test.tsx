import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failure, type ApiClient, type CheckInRequest, type Permission } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../test/render.js";
import { seedOnlineSignup } from "../test/signup.js";

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

function spies() {
  const checkIn = vi.fn<(id: string, input: CheckInRequest) => void>();
  const status = vi.fn<(id: string, status: string) => void>();
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    checkInAppointment: (id, input, options) => {
      checkIn(id, input);
      return client.checkInAppointment(id, input, options);
    },
    setAppointmentStatus: (id, change, options) => {
      status(id, change.status);
      return client.setAppointmentStatus(id, change, options);
    },
  });
  return { checkIn, status, wrap };
}

async function openList(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("button", { name: "Add to queue" }));
  await user.click(await screen.findByRole("button", { name: /Check in a booking/ }));
  await user.type(await screen.findByLabelText("Search today's bookings"), name);
}

describe("Check in a booking", () => {
  it("checks a complete patient in with one click and no form", async () => {
    const user = userEvent.setup();
    const { checkIn, status, wrap } = spies();
    renderPortal("/queue", { as: PEOPLE.asha, backend: fakeApi(seedOnlineSignup), wrap });
    await openList(user, "Test Complete");
    await user.click(await screen.findByRole("button", { name: "Check in Test Complete" }));
    expect(await screen.findByText("Test Complete checked in")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /^Check in Test/ })).toBeNull();
    expect(status).toHaveBeenCalledWith("e1e1e1e1-0000-4000-8000-000000000002", "arrived");
    expect(checkIn).not.toHaveBeenCalled();
  });

  it("asks an online sign-up for sex, age, allergies and consent, then arrives them", async () => {
    const user = userEvent.setup();
    const { checkIn, status, wrap } = spies();
    const backend = fakeApi(seedOnlineSignup);
    renderPortal("/queue", { as: PEOPLE.asha, backend, wrap });
    await openList(user, "Test Signup");
    await user.click(await screen.findByRole("button", { name: "Check in Test Signup" }));
    const dialog = await screen.findByRole("dialog", { name: "Check in Test" });
    expect(status).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/^Age/), "31");
    await user.click(within(dialog).getByRole("button", { name: "Female" }));
    await user.click(within(dialog).getByRole("button", { name: "No known allergies" }));
    const reminders = within(dialog).getByRole("checkbox", { name: /visit reminders/ });
    expect(reminders).toHaveProperty("checked", false);
    await user.click(reminders);
    await user.click(within(dialog).getByRole("button", { name: "Check in" }));
    expect(await screen.findByText("Test Signup checked in")).toBeTruthy();
    expect(checkIn).toHaveBeenCalledWith("e1e1e1e1-0000-4000-8000-000000000001", {
      sex: "female",
      age_years: 31,
      allergies: [],
      no_known_allergies: true,
      consents: [
        { purpose: "care", method: "verbal" },
        { purpose: "reminders", method: "verbal" },
      ],
    });
    expect(status).not.toHaveBeenCalled();
    const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const queue = await client.listQueue(undefined);
    expect(queue.ok && queue.value.items.some((t) => t.patient.full_name === "Test Signup")).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Check in/ })).toBeNull();
    });
  });

  it("asks for consent to reminders without pre-ticking it, and sends only care when left unticked", async () => {
    const user = userEvent.setup();
    const { checkIn, wrap } = spies();
    renderPortal("/queue", { as: PEOPLE.asha, backend: fakeApi(seedOnlineSignup), wrap });
    await openList(user, "Test Signup");
    await user.click(await screen.findByRole("button", { name: "Check in Test Signup" }));
    const dialog = await screen.findByRole("dialog", { name: "Check in Test" });
    await user.click(within(dialog).getByRole("button", { name: "Check in" }));
    await waitFor(() => {
      expect(checkIn).toHaveBeenCalledTimes(1);
    });
    expect(checkIn.mock.calls[0]?.[1].consents).toEqual([{ purpose: "care", method: "verbal" }]);
  });

  it("doesn't send an age for a patient whose birth date is on record, so it isn't replaced by an estimate", async () => {
    const user = userEvent.setup();
    const { checkIn, wrap } = spies();
    renderPortal("/queue", { as: PEOPLE.asha, backend: fakeApi(seedOnlineSignup), wrap });
    await openList(user, "Test Dated");
    await user.click(await screen.findByRole("button", { name: "Check in Test Dated" }));
    const dialog = await screen.findByRole("dialog", { name: "Check in Test" });
    expect(within(dialog).getByLabelText(/^Age/)).toHaveProperty("value", "7");
    await user.click(within(dialog).getByRole("button", { name: "Male" }));
    await user.click(within(dialog).getByRole("button", { name: "Check in" }));
    await waitFor(() => {
      expect(checkIn).toHaveBeenCalledTimes(1);
    });
    expect(checkIn.mock.calls[0]?.[1]).toHaveProperty("sex", "male");
    expect(checkIn.mock.calls[0]?.[1]).not.toHaveProperty("age_years");
  });

  it("sends the age when the desk changes it", async () => {
    const user = userEvent.setup();
    const { checkIn, wrap } = spies();
    renderPortal("/queue", { as: PEOPLE.asha, backend: fakeApi(seedOnlineSignup), wrap });
    await openList(user, "Test Dated");
    await user.click(await screen.findByRole("button", { name: "Check in Test Dated" }));
    const dialog = await screen.findByRole("dialog", { name: "Check in Test" });
    await user.type(within(dialog).getByLabelText(/^Age/), "0");
    await user.click(within(dialog).getByRole("button", { name: "Check in" }));
    await waitFor(() => {
      expect(checkIn).toHaveBeenCalledTimes(1);
    });
    expect(checkIn.mock.calls[0]?.[1]).toHaveProperty("age_years", 70);
  });

  it("shows the API's message when the check-in is refused", async () => {
    const user = userEvent.setup();
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      checkInAppointment: () => Promise.resolve(failure({ code: "conflict", status: 409, message: "That appointment can't arrive from its status." })),
    });
    renderPortal("/queue", { as: PEOPLE.asha, backend: fakeApi(seedOnlineSignup), wrap });
    await openList(user, "Test Signup");
    await user.click(await screen.findByRole("button", { name: "Check in Test Signup" }));
    const dialog = await screen.findByRole("dialog", { name: "Check in Test" });
    await user.click(within(dialog).getByRole("button", { name: "Check in" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("That appointment can't arrive from its status.");
    expect(screen.getByRole("dialog", { name: "Check in Test" })).toBeTruthy();
  });

  it("has no axe violations on the check-in form", async () => {
    const user = userEvent.setup();
    renderPortal("/queue", { as: PEOPLE.asha, backend: fakeApi(seedOnlineSignup) });
    await openList(user, "Test Signup");
    await user.click(await screen.findByRole("button", { name: "Check in Test Signup" }));
    await screen.findByRole("dialog", { name: "Check in Test" });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("offers no check-in, and no form, without appointments.write", async () => {
    const backend = fakeApi((fixtures) => {
      seedOnlineSignup(fixtures);
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha && m.clinic_id === fixtures.clinics[0]?.id);
      if (membership !== undefined) {
        const permissions = membership.role.permissions.filter((p: Permission) => p !== "appointments.write");
        membership.role = { ...membership.role, permissions };
      }
    });
    renderPortal("/today", { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { name: /Today/ });
    expect(screen.queryByRole("button", { name: /^Check in/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
