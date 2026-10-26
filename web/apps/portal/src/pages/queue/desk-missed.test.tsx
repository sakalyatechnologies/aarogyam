import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { success, toCollectList, type ApiClient } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Missed today (Today queue)", () => {
  it("keeps no-shows out of the live queue and lists them under Missed today", async () => {
    const backend = fakeApi();
    const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const day = await client.getToday();
    if (!day.ok) throw new Error("expected today");
    const missedName = day.value.appointments.find((a) => a.status === "no_show")?.patient.full_name;
    if (missedName === undefined) throw new Error("expected a no-show in the fixtures");
    renderPortal("/today", { as: PEOPLE.asha, backend });
    const missed = await screen.findByRole("list", { name: "Missed today" });
    expect(within(missed).getByText(missedName)).toBeTruthy();
    const queue = screen.getByRole("list", { name: "Patient queue" });
    expect(within(queue).queryByText(missedName)).toBeNull();
  });

  it("Check in sets the appointment to arrived and Send reminder sends the missed-visit template", async () => {
    const user = userEvent.setup();
    const setStatus = vi.fn();
    const send = vi.fn();
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient) => ({
        ...client,
        setAppointmentStatus: (id, change, options) => {
          setStatus(id, change.status);
          return client.setAppointmentStatus(id, change, options);
        },
        sendMessages: (input, options) => {
          send(input.template_key);
          return client.sendMessages(input, options);
        },
      }),
    });
    const missed = await screen.findByRole("list", { name: "Missed today" });
    await user.click(within(missed).getByRole("button", { name: /^Send reminder to/ }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith("reminder.missed_visit");
    });
    await user.click(within(missed).getByRole("button", { name: /^Check in/ }));
    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith(expect.any(String), "arrived");
    });
    expect(await screen.findByText("Checked in")).toBeTruthy();
  });
});

describe("Queue page: To collect and Follow-ups", () => {
  const owing = {
    token_id: "00000000-0000-4000-8000-000000000001",
    day: "2026-10-02",
    token_number: 4,
    patient_id: "00000000-0000-4000-8000-000000000002",
    patient_number: "SC-1042",
    invoice_id: "inv-1",
    balance_paise: 45_000,
  };

  it("opens the collect dialog from a To collect row", async () => {
    const user = userEvent.setup();
    renderPortal("/queue", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient) => ({ ...client, listQueueToCollect: () => Promise.resolve(success(toCollectList.parse({ items: [owing] }))) }),
    });
    const list = await screen.findByRole("list", { name: "To collect" });
    await user.click(within(list).getByRole("button", { name: "Collect" }));
    expect(await screen.findByRole("dialog", { name: "Collect payment" })).toBeTruthy();
  });

  it("lists follow-ups, missed visits first, and marks one done", async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    renderPortal("/queue", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient) => ({
        ...client,
        markRecallDone: (id, options) => {
          done(id);
          return client.markRecallDone(id, options);
        },
      }),
    });
    const list = await screen.findByRole("list", { name: "Follow-ups" });
    const rows = within(list).getAllByRole("listitem");
    const first = rows[0];
    if (first === undefined) throw new Error("expected a follow-up");
    expect(first.textContent).toMatch(/Missed visit/);
    await user.click(within(first).getByRole("button", { name: /^Done/ }));
    await waitFor(() => {
      expect(done).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Follow-ups" })).getAllByRole("listitem")).toHaveLength(rows.length - 1);
    });
  });
});
