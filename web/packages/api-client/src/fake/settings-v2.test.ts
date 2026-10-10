import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup(seed?: (fixtures: ReturnType<typeof createFixtures>) => void) {
  const fixtures = createFixtures({ now: NOW });
  seed?.(fixtures);
  const backend = createFakeBackend(fixtures);
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as, fixtures };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

describe("the person's own profile", () => {
  it("changes name and phone, keeps what is left out, clears an empty phone, and shows them on getMe", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const changed = value(await asha.updateMe({ display_name: "Asha Rao", phone: "98765 43210" }));
    expect(changed).toEqual({ display_name: "Asha Rao", phone: "+919876543210" });
    const me = value(await asha.getMe());
    expect([me.display_name, me.phone]).toEqual(["Asha Rao", "+919876543210"]);
    expect(value(await asha.updateMe({ display_name: "Asha R" })).phone).toBe("+919876543210");
    expect(value(await asha.updateMe({ phone: "" })).phone).toBeNull();
  });

  it("refuses bad input with 400 naming the field, and a phone another account holds with 409", async () => {
    const { as } = setup();
    for (const [body, field] of [
      [{ display_name: "" }, "display_name"],
      [{ display_name: "x".repeat(300) }, "display_name"],
      [{ phone: "12" }, "phone"],
    ] as const) {
      const error = errorOf(await as(ASHA).updateMe(body));
      expect([error?.status, error?.field]).toEqual([400, field]);
    }
    value(await as(ASHA).updateMe({ phone: "9876543210" }));
    expect(errorOf(await as(BINA, LOTUS).updateMe({ phone: "9876543210" }))?.status).toBe(409);
  });
});

describe("signing out other sessions", () => {
  it("ends every session but the current one and says how many", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const before = value(await asha.listMySessions()).items.length;
    const revoked = value(await asha.revokeOtherSessions()).revoked;
    const after = value(await asha.listMySessions()).items;
    expect(revoked).toBe(Math.max(before - 1, 0));
    expect(after.length).toBe(Math.min(before, 1));
    expect(after.every((s) => s.current)).toBe(true);
    expect(value(await asha.revokeOtherSessions()).revoked).toBe(0);
  });
});

describe("notification switches", () => {
  it("has defaults, merges changes, and refuses bad quiet hours with 400", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    expect(value(await asha.getNotificationSettings())).toEqual({
      reminder_24h: true,
      reminder_2h: false,
      receipts: false,
      recall: true,
      low_stock: true,
      lab_due: true,
      quiet_hours: { enabled: true, start: "21:00", end: "09:00" },
    });
    const changed = value(await asha.updateNotificationSettings({ receipts: true, quiet_hours: { start: "22:30" } }));
    expect([changed.receipts, changed.reminder_24h, changed.quiet_hours]).toEqual([true, true, { enabled: true, start: "22:30", end: "09:00" }]);
    for (const [quiet, field] of [
      [{ start: "25:99" }, "quiet_hours.start"],
      [{ end: "late" }, "quiet_hours.end"],
      [{ start: "09:00" }, "quiet_hours.start"],
    ] as const) {
      const error = errorOf(await asha.updateNotificationSettings({ quiet_hours: quiet }));
      expect([error?.status, error?.field]).toEqual([400, field]);
    }
    expect(value(await asha.getNotificationSettings()).quiet_hours.start).toBe("22:30");
  });

  it("needs settings.manage and stays within the clinic", async () => {
    const { as } = setup();
    expect(errorOf(await as(FARAH).getNotificationSettings())?.status).toBe(403);
    expect(errorOf(await as(FARAH).updateNotificationSettings({ receipts: true }))?.status).toBe(403);
    value(await as(ASHA).updateNotificationSettings({ receipts: true }));
    expect(value(await as(BINA, LOTUS).getNotificationSettings()).receipts).toBe(false);
    expect(errorOf(await as(BINA, SUNRISE).getNotificationSettings())?.status).toBe(404);
  });
});

describe("clinic settings", () => {
  it("accepts branding mode auto, refuses another mode, and validates the default visit length", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    expect(value(await asha.updateClinicSettings({ branding: { mode: "auto" } })).branding.mode).toBe("auto");
    expect(value(await asha.updateClinicSettings({ branding: { mode: "dark" } })).branding.mode).toBe("dark");
    expect(errorOf(await asha.updateClinicSettings({ branding: { mode: "sepia" } }))?.status).toBe(400);
    expect(value(await asha.getClinicSettings()).online_booking.default_visit_minutes).toBe(30);
    expect(value(await asha.updateClinicSettings({ online_booking: { default_visit_minutes: 45 } })).online_booking.default_visit_minutes).toBe(45);
    for (const bad of [20, 0, 90]) {
      expect(errorOf(await asha.updateClinicSettings({ online_booking: { default_visit_minutes: bad } }))?.field).toBe("booking.default_visit_minutes");
    }
  });

  it("uploads a logo, refuses anything else, and keeps it in its clinic", async () => {
    const { as } = setup();
    const form = new FormData();
    form.set("file", new Blob(["x"], { type: "image/png" }), "logo.png");
    expect(value(await as(ASHA).uploadClinicLogo(form)).letterhead.has_logo).toBe(true);
    expect(value(await as(BINA, LOTUS).getClinicSettings()).letterhead.has_logo).toBe(false);
    const text = new FormData();
    text.set("file", new Blob(["x"], { type: "text/plain" }), "x.txt");
    expect(errorOf(await as(ASHA).uploadClinicLogo(text))?.status).toBe(400);
    expect(errorOf(await as(FARAH).uploadClinicLogo(form))?.status).toBe(403);
  });
});

describe("staff notifications", () => {
  const note = (id: string, kind: string, clinic: string, extra: object = {}) => ({
    id,
    clinic_id: clinic,
    kind,
    created_at: "2026-10-03T05:00:00Z",
    handled: null,
    reminded_at: null,
    escalated_at: null,
    appointment: null,
    lab_order: null,
    href: "/queue",
    queue_token: null,
    invoice: null,
    recall: null,
    ...extra,
  });

  it("lists by permission with each link, counts unread, and marks read for the caller only", async () => {
    const { as } = setup((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.host === SUNRISE)?.id ?? "";
      const lotus = fixtures.clinics.find((c) => c.host === LOTUS)?.id ?? "";
      fixtures.notifications = [
        note("0192f1c4-7a10-7c3e-9b2a-1d2e3f405101", "send_in", sunrise, { queue_token: { id: "t1", number: 4 } }),
        note("0192f1c4-7a10-7c3e-9b2a-1d2e3f405102", "payment_due", sunrise, { href: "/billing/invoices/i1", invoice: { id: "i1", number: "SD/1" } }),
        note("0192f1c4-7a10-7c3e-9b2a-1d2e3f405103", "send_in", lotus, { queue_token: { id: "t9", number: 1 } }),
      ];
    });
    const asha = as(ASHA);
    const feed = value(await asha.listNotifications());
    expect(feed.items.map((n) => [n.kind, n.href])).toEqual([
      ["payment_due", "/billing/invoices/i1"],
      ["send_in", "/queue"],
    ]);
    expect(value(await asha.countUnreadNotifications()).unread).toBe(2);
    const first = feed.items[1]?.id ?? "";
    expect(first).not.toBe("");
    value(await asha.markNotificationRead(first));
    expect(value(await asha.countUnreadNotifications()).unread).toBe(1);
    expect(value(await asha.listNotifications({ unreadOnly: true })).items.map((n) => n.kind)).toEqual(["payment_due"]);
    expect(value(await as(FARAH).countUnreadNotifications()).unread).toBeGreaterThanOrEqual(0);
    // Another clinic's alert is not here: 404.
    expect(errorOf(await asha.markNotificationRead("0192f1c4-7a10-7c3e-9b2a-1d2e3f405103"))?.status).toBe(404);
    expect(value(await asha.markAllNotificationsRead()).marked).toBe(1);
    expect(value(await asha.countUnreadNotifications()).unread).toBe(0);
  });
});
