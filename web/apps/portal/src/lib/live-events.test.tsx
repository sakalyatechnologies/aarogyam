import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failure, practitionerId, success, type ApiClient, type LiveEvent, type SubscribeEventsOptions } from "@aarogyam/api-client";

import { fakeTokenFor, type Fixtures } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../test/render.js";
import { BADGE_POLL_FAST_MS, BADGE_POLL_LIVE_MS, badgePollMs } from "../layout/notifications.js";
import { NEW_LOOK_KEY } from "./new-look.js";
import { QUEUE_POLL_LIVE_MS } from "../queries.js";
import { applyLiveEvent } from "./live-events.js";

/** Someone who works at two clinics is asked which one first. */
async function openClinic() {
  const pick = await screen.findByRole("button", { name: /^(Notifications|Sunrise Dental)/ });
  if (pick.textContent.includes("Sunrise Dental")) await userEvent.setup().click(pick);
  await screen.findByRole("button", { name: /^Notifications/ });
}

beforeEach(() => {
  localStorage.setItem(NEW_LOOK_KEY, "1");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const invalidated = (event: LiveEvent) => {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  applyLiveEvent(client, "org", "user", event);
  return spy.mock.calls.map(([filter]) => filter?.queryKey?.[0] ?? "ALL");
};

describe("applyLiveEvent", () => {
  it("refreshes the queue and Today on queue and visit changes", () => {
    expect(invalidated({ type: "queue.changed", data: {} })).toEqual(["queue", "today", "today-money"]);
    expect(invalidated({ type: "visit.changed", data: {} })).toEqual(["queue", "today", "today-money"]);
  });
  it("refreshes appointments, Today and missed on appointment changes", () => {
    expect(invalidated({ type: "appointment.changed", data: {} })).toEqual(["appointments", "today", "missed"]);
  });
  it("refreshes notifications and the badges on a new notification", () => {
    expect(invalidated({ type: "notification.created", data: { kind: "send_in", id: "n", branch_id: null } })).toEqual(["notifications", "badges"]);
  });
  it("refreshes everything on resync and nothing on ready", () => {
    expect(invalidated({ type: "resync", data: {} })).toEqual(["ALL"]);
    expect(invalidated({ type: "ready", data: {} })).toEqual([]);
  });
});

/** A client whose stream the test drives: each call is recorded and stays open until `end` or abort. */
function controlled() {
  const calls: SubscribeEventsOptions[] = [];
  const ends: Array<() => void> = [];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    subscribeEvents: (opts) => {
      calls.push(opts);
      return new Promise((resolve) => {
        opts.onOpen?.();
        const done = () => {
          resolve(success(undefined));
        };
        ends.push(done);
        opts.signal.addEventListener("abort", done, { once: true });
      });
    },
  });
  return { calls, ends, wrap };
}

describe("useLiveEvents", () => {
  it("reconnects after the server closes the stream, sending the last event id, and slows the polls while open", async () => {
    const stream = controlled();
    const spy = vi.spyOn(globalThis, "setInterval");
    renderPortal("/today", { as: PEOPLE.asha, wrap: stream.wrap });
    await openClinic();
    await waitFor(() => { expect(stream.calls.length).toBe(1); });
    expect(stream.calls[0]?.lastEventId).toBeUndefined();
    stream.calls[0]?.onEvent({ type: "queue.changed", id: "42", data: {} });
    stream.ends[0]?.();
    await waitFor(() => { expect(stream.calls.length).toBe(2); });
    expect(stream.calls[1]?.lastEventId).toBe("42");
    // Connected: the badge and the board poll at 120 s, not 20 s.
    await waitFor(() => { expect(spy.mock.calls.map((c) => c[1])).toContain(BADGE_POLL_LIVE_MS); });
    expect(BADGE_POLL_LIVE_MS).toBe(QUEUE_POLL_LIVE_MS);
    expect(badgePollMs("/today", true)).toBe(120_000);
    expect(badgePollMs("/today", false)).toBe(BADGE_POLL_FAST_MS);
  });

  it("backs off and polls at the old speed while the stream is down", async () => {
    const calls: number[] = [];
    const spy = vi.spyOn(globalThis, "setInterval");
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client) => ({ ...client, subscribeEvents: () => { calls.push(Date.now()); return Promise.resolve(failure({ status: 0, code: "network_error", message: "down" })); } }),
    });
    await openClinic();
    await waitFor(() => { expect(calls.length).toBe(1); });
    await waitFor(() => { expect(spy.mock.calls.map((c) => c[1])).toContain(20_000); });
    expect(spy.mock.calls.map((c) => c[1])).not.toContain(BADGE_POLL_LIVE_MS);
    await waitFor(() => { expect(calls.length).toBe(2); }, { timeout: 3000 });
  });

  it("in fake mode a walk-in made elsewhere reaches the doctor's bell without a poll", async () => {
    let doctor = "";
    const backend = fakeApi((fixtures: Fixtures) => {
      const clinic = fixtures.clinics.find((c) => c.slug === "sunrise");
      const member = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha && m.clinic_id === clinic?.id);
      doctor = fixtures.practitioners.find((p) => p.membership_id === member?.id)?.id ?? "";
    });
    renderPortal("/today", { as: PEOPLE.asha, backend });
    await openClinic();
    const bell = await screen.findByRole("button", { name: /^Notifications/ });
    const count = (label: string | null) => Number(/(\d+) unread/.exec(label ?? "")?.[1] ?? 0);
    const before = count(bell.getAttribute("aria-label"));
    // The front desk, on another client of the same fake backend, adds a walk-in.
    const desk = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const made = await desk.registerWalkIn({ patient: { full_name: "Neha Rao" }, practitioner_id: practitionerId.parse(doctor) });
    expect(made.ok).toBe(true);
    // No timer is advanced: only the stream can have told the bell.
    await waitFor(() => { expect(count(screen.getByRole("button", { name: /^Notifications/ }).getAttribute("aria-label"))).toBe(before + 1); });
  });
});
