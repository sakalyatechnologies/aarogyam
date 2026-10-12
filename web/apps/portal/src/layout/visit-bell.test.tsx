import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectSummary, notification, payment, practitionerId, success, type ApiClient, type Notification } from "@aarogyam/api-client";
import { fakeTokenFor, type Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../test/render.js";
import { BADGE_POLL_FAST_MS, BADGE_POLL_MS, badgePollMs, describeNotification, isCounted } from "./notifications.js";
import { readVisitAlerts } from "./visit-alerts.js";

const SUNRISE = "sunrise.localtest.me";
const AT = "2026-10-03T05:00:00Z";
const TOKEN = "0192f1c4-7a10-7c3e-9b2a-0000000000a1";
const BILL = "0192f1c4-7a10-7c3e-9b2a-0000000000b1";
const PATIENT = "0192f1c4-7a10-7c3e-9b2a-0000000000c1";
const SUMMARY = collectSummary.parse({ invoice_id: BILL, number: "INV-9", patient: { id: PATIENT, name: "Neha Rao", number: "SD-1" }, status: "issued", total_paise: 50000, balance_paise: 50000 });
const base = { created_at: AT, read: false };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

const waiting = (extra: object = {}) => notification.parse({ ...base, id: "w1", kind: "patient_waiting", audience: "doctor", href: "/queue", queue_token: { id: TOKEN, number: 7 }, ...extra });
const collect = (extra: object = {}) =>
  notification.parse({ ...base, id: "c1", kind: "collect_payment", audience: "front_desk", href: `/billing/invoices/${BILL}`, invoice: { id: BILL, number: "INV-9", total_paise: 50000, balance_paise: 50000 }, ...extra });

function stubBell(items: Notification[], more: Partial<ApiClient> = {}) {
  const counted = items.filter(isCounted).length;
  return (client: ApiClient): ApiClient => ({
    ...client,
    listNotifications: () => Promise.resolve(success({ items })),
    countUnreadNotifications: () => Promise.resolve(success({ unread: counted })),
    getBadges: () => Promise.resolve(success({ chat_unread: 0, notifications_unread: counted, tasks_open: 0 })),
    markNotificationRead: () => Promise.resolve(success(undefined)),
    ...more,
  });
}

/** Someone who works at two clinics is asked which one first. */
async function openClinic(user: ReturnType<typeof userEvent.setup>) {
  const pick = await screen.findByRole("button", { name: /^(Notifications|Sunrise Dental)/ });
  if (pick.textContent.includes("Sunrise Dental")) await user.click(pick);
}

async function openBell(path: string, who: string, wrap: (client: ApiClient) => ApiClient) {
  const user = userEvent.setup();
  const view = renderPortal(path, { as: who, wrap });
  await openClinic(user);
  await user.click(await screen.findByRole("button", { name: /^Notifications/ }));
  const dialog = await screen.findByRole("dialog", { name: "Notifications" });
  await within(dialog).findByRole("list", { name: "Notifications" });
  return { user, dialog: within(dialog), ...view };
}

describe("copy for the visit kinds", () => {
  it("says each kind in its own words, and never shows money the row does not carry", () => {
    expect(describeNotification(waiting(), "Asia/Kolkata", "Neha Rao").title).toBe("New patient waiting · #7 Neha Rao");
    expect(describeNotification(waiting(), "Asia/Kolkata").title).toBe("New patient waiting · #7");
    expect(describeNotification(notification.parse({ ...base, id: "x", kind: "patient_waiting" }), "Asia/Kolkata").title).toBe("New patient waiting");
    expect(describeNotification(notification.parse({ ...base, id: "s", kind: "send_in", queue_token: { id: TOKEN, number: 7 } }), "Asia/Kolkata").title).toBe("Patient called in");
    expect(describeNotification(collect(), "Asia/Kolkata", "Neha Rao").title).toBe("Collect ₹500 · Neha Rao");
    expect(describeNotification(collect(), "Asia/Kolkata").title).toBe("Collect ₹500");
    const noMoney = collect({ invoice: { id: BILL } });
    expect(describeNotification(noMoney, "Asia/Kolkata", "Neha Rao").title).toBe("Collect payment · Neha Rao");
    expect(describeNotification(notification.parse({ ...base, id: "a", kind: "arrival" }), "Asia/Kolkata").title).toBe("Patient arrived");
    expect(describeNotification(notification.parse({ ...base, id: "p", kind: "payment_due", invoice: { id: BILL, balance_paise: 12000 } }), "Asia/Kolkata").title).toBe("Payment due · ₹120");
    expect(describeNotification(notification.parse({ ...base, id: "r", kind: "recall_due", recall: { id: "r1", kind: "follow_up", due_on: "2026-10-20" } }), "Asia/Kolkata").title).toBe("Follow-up due");
  });

  it("counts a handled actionable notice as read, and a handled booking notice as before", () => {
    const handled = { at: AT, name: "Dr Dev" };
    expect(isCounted(waiting())).toBe(true);
    expect(isCounted(waiting({ handled }))).toBe(false);
    expect(isCounted(collect({ handled }))).toBe(false);
    expect(isCounted(notification.parse({ ...base, id: "b", kind: "booking_requested", handled }))).toBe(true);
  });
});

describe("the bell shows them", () => {
  it("lists each kind with names found in the queue, muted when handled, and counts only the open ones", async () => {
    const backend = fakeApi();
    const queue = await backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW }).listQueue(undefined);
    if (!queue.ok) throw new Error("expected a queue");
    const [first, second] = queue.value.items;
    if (first === undefined || second === undefined) throw new Error("expected tokens");
    const items = [
      waiting({ id: "w1", queue_token: { id: first.id, number: first.token_number } }),
      waiting({ id: "w2", queue_token: { id: second.id, number: second.token_number }, handled: { at: AT, name: "Dr Dev" } }),
      notification.parse({ ...base, id: "s1", kind: "send_in", queue_token: { id: first.id, number: first.token_number } }),
      collect({ id: "c1", queue_token: { id: second.id, number: second.token_number } }),
    ];
    const { dialog } = await openBell("/queue", PEOPLE.asha, stubBell(items, { getInvoiceCollectSummary: () => Promise.resolve(success(SUMMARY)) }));
    await dialog.findByRole("button", { name: new RegExp(`New patient waiting · #${String(first.token_number)} ${first.patient.full_name}`) });
    expect(dialog.getByRole("button", { name: /Patient called in/ })).toBeTruthy();
    expect(dialog.getByRole("button", { name: new RegExp(`Collect ₹500 · ${second.patient.full_name}`) })).toBeTruthy();
    const muted = dialog.getByRole("button", { name: new RegExp(`#${String(second.token_number)} ${second.patient.full_name}`) }).closest("li");
    if (muted === null) throw new Error("expected the handled row");
    expect(muted.getAttribute("data-settled")).toBe("true");
    expect(within(muted).getByText("Handled by Dr Dev")).toBeTruthy();
    expect(muted.querySelector("[data-unread]")).toBeNull();
    // Three rows are open (waiting, called in, collect); the handled one is not counted.
    await waitFor(() => {
      expect(screen.getByText("3 unread")).toBeTruthy();
    });
  });
});

describe("actions in the bell", () => {
  it("Call in calls the queue's call for the token, for someone who may call", async () => {
    const call = vi.fn();
    const wrap = (client: ApiClient) => stubBell([waiting()], {
      // The token is not in the fake's queue: the call is made and answered 404, which is enough to see what was asked.
      callQueueToken: (id, options) => {
        call(id);
        return client.callQueueToken(id, options);
      },
    })(client);
    const { user, dialog } = await openBell("/today", PEOPLE.dev, wrap);
    await user.click(await dialog.findByRole("button", { name: /^Call in/ }));
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(TOKEN);
    });
  });

  it("offers no Call in to someone without clinical.write, and no Collect to someone who may not collect", async () => {
    const first = await openBell("/today", PEOPLE.farah, stubBell([waiting(), collect({ id: "c2" })]));
    expect(first.dialog.queryByRole("button", { name: /^Call in/ })).toBeNull();
    expect(first.dialog.getByRole("button", { name: /^Collect/ })).toBeTruthy();
    cleanup();
    const second = await openBell("/today", PEOPLE.dev, stubBell([waiting(), collect({ id: "c3" })]));
    expect(second.dialog.getByRole("button", { name: /^Call in/ })).toBeTruthy();
  });

  it("Collect opens the dialog on the bill's summary and records the payment against that bill", async () => {
    const paid = vi.fn();
    const wrap = stubBell([collect()], {
      getInvoiceCollectSummary: () => Promise.resolve(success(SUMMARY)),
      recordPayment: (input) => {
        paid(input);
        return Promise.resolve(
          success(
            payment.parse({
              id: "0192f1c4-7a10-7c3e-9b2a-0000000000d1",
              number: "PAY-1",
              status: "recorded",
              patient: SUMMARY.patient,
              method: input.method,
              amount_paise: input.amount_paise,
              allocated_paise: input.amount_paise,
              unallocated_paise: 0,
              allocations: input.allocations ?? [],
              received_at: AT,
            }),
          ),
        );
      },
    });
    const { user, dialog } = await openBell("/today", PEOPLE.farah, wrap);
    await user.click(await dialog.findByRole("button", { name: /^Collect/ }));
    const collecting = await screen.findByRole("dialog", { name: "Collect payment" });
    await user.click(await within(collecting).findByRole("button", { name: /^Record/ }));
    await within(collecting).findByText("Paid in full");
    expect(paid).toHaveBeenCalledWith(expect.objectContaining({ patient_id: PATIENT, amount_paise: 50000, method: "cash", allocations: [{ invoice_id: BILL, amount_paise: 50000 }] }));
  });
});

describe("the whole visit, on the fake API", () => {
  it("walk-in, the doctor's bell, call in, send for payment, the desk's bell, collect", async () => {
    // Asha is the owner and a doctor: the one who may both call and bill.
    let doctor = "";
    const backend = fakeApi((fixtures: Fixtures) => {
      const clinic = fixtures.clinics.find((c) => c.slug === "sunrise");
      const member = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha && m.clinic_id === clinic?.id);
      doctor = fixtures.practitioners.find((p) => p.membership_id === member?.id)?.id ?? "";
    });
    const as = (who: string): ApiClient => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
    const made = await as(PEOPLE.farah).registerWalkIn({ patient: { full_name: "Neha Rao" }, practitioner_id: practitionerId.parse(doctor) });
    if (!made.ok) throw new Error("expected a walk-in");

    // The doctor's bell: who is waiting, then Call in.
    const first = userEvent.setup();
    renderPortal("/queue", { as: PEOPLE.asha, backend });
    await openClinic(first);
    await first.click(await screen.findByRole("button", { name: /^Notifications/ }));
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await first.click(await drawer.findByRole("button", { name: /^Call in/ }));
    await waitFor(() => {
      expect(drawer.getByRole("button", { name: /New patient waiting.*Neha Rao/ }).closest("li")?.getAttribute("data-settled")).toBe("true");
    });
    cleanup();

    // The doctor sends the patient for payment with a fee (the visit's own screen does the same call).
    const started = await as(PEOPLE.asha).startVisitFromQueue(made.value.token.id);
    if (!started.ok) throw new Error("expected a visit");
    const closed = await as(PEOPLE.asha).closeVisitWith(started.value.visit.id, { fee_paise: 50000, queue_status: "ready_to_bill" });
    expect(closed.ok ? "ok" : closed.error.message).toBe("ok");

    // The desk's bell shows the amount and the name, and Collect takes it.
    const second = userEvent.setup();
    renderPortal("/queue", { as: PEOPLE.farah, backend });
    await openClinic(second);
    await second.click(await screen.findByRole("button", { name: /^Notifications/ }));
    const desk = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await desk.findByRole("button", { name: /Collect ₹500 · Neha Rao/ });
    await second.click(desk.getByRole("button", { name: /^Collect: Neha Rao/ }));
    const collecting = await screen.findByRole("dialog", { name: "Collect payment" });
    await second.click(await within(collecting).findByRole("button", { name: /^Record/ }));
    await within(collecting).findByText("Paid in full");
    const feed = await as(PEOPLE.farah).listNotifications();
    expect(feed.ok && feed.value.items.find((n) => n.kind === "collect_payment")?.handled).toBeTruthy();
  });
});

describe("polling", () => {
  it("asks every 20 s on Today and the queue and every minute elsewhere", () => {
    expect(badgePollMs("/today")).toBe(BADGE_POLL_FAST_MS);
    expect(badgePollMs("/queue")).toBe(BADGE_POLL_FAST_MS);
    expect(badgePollMs("/queue/anything")).toBe(BADGE_POLL_FAST_MS);
    expect(badgePollMs("/patients")).toBe(BADGE_POLL_MS);
    expect(badgePollMs("/settings")).toBe(BADGE_POLL_MS);
    expect(BADGE_POLL_FAST_MS).toBe(20_000);
    expect(BADGE_POLL_MS).toBe(60_000);
  });

  it("schedules the badge poll at 20 s on Today and at 60 s on Settings", async () => {
    const delays = async (path: string) => {
      const spy = vi.spyOn(globalThis, "setInterval");
      renderPortal(path, { as: PEOPLE.asha });
      await screen.findByRole("button", { name: /^Notifications/ });
      await waitFor(() => {
        expect(spy.mock.calls.length).toBeGreaterThan(0);
      });
      const seen = spy.mock.calls.map((call) => call[1]);
      spy.mockRestore();
      cleanup();
      return seen;
    };
    expect(await delays("/today")).toContain(20_000);
    const elsewhere = await delays("/settings");
    expect(elsewhere).toContain(60_000);
    expect(elsewhere).not.toContain(20_000);
  });
});

describe("the sound and desktop alert switch", () => {
  it("is off by default, asks for permission only when switched on, and is remembered for this person", async () => {
    const ask = vi.fn((): Promise<NotificationPermission> => Promise.resolve("granted"));
    vi.stubGlobal("Notification", Object.assign(function Notice() {}, { permission: "default", requestPermission: ask }));
    const user = userEvent.setup();
    renderPortal("/settings", { as: PEOPLE.asha });
    const toggle = await screen.findByRole("switch", { name: /Sound and desktop alert/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(ask).not.toHaveBeenCalled();
    expect(readVisitAlerts(PEOPLE.asha)).toBe(false);
    await user.click(toggle);
    await waitFor(() => { expect(ask).toHaveBeenCalledTimes(1); });
    expect(readVisitAlerts(PEOPLE.asha)).toBe(true);
    expect(readVisitAlerts(PEOPLE.dev)).toBe(false);
    await user.click(toggle);
    expect(readVisitAlerts(PEOPLE.asha)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
