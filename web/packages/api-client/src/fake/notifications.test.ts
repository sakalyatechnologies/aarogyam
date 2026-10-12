import { describe, expect, it } from "vitest";

import { unwrap } from "../index.js";
import { knownNotificationKind, notification } from "../schemas.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-03T05:30:00Z");

function client(as: string, backend = createFakeBackend(createFixtures({ now: NOW }))) {
  return backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: as }), now: () => NOW });
}

describe("fake notifications and badges", () => {
  it("lists the bell newest first and counts the same unread ones each method reports", async () => {
    const api = client(ASHA);
    const list = await unwrap(api.listNotifications());
    expect(list.items.length).toBeGreaterThan(2);
    expect(list.items.map((n) => n.id)).toEqual([...list.items.map((n) => n.id)].sort().reverse());
    expect(list.items.every((n) => !n.read)).toBe(true);
    expect((await unwrap(api.countUnreadNotifications())).unread).toBe(list.items.length);
  });

  it("marks one read for the caller only, then all, and keeps the state", async () => {
    const backend = createFakeBackend(createFixtures({ now: NOW }));
    const api = client(ASHA, backend);
    const first = (await unwrap(api.listNotifications())).items[0];
    if (first === undefined) throw new Error("expected a notification");
    await unwrap(api.markNotificationRead(first.id));
    const after = await unwrap(api.listNotifications());
    expect(after.items.find((n) => n.id === first.id)?.read).toBe(true);
    expect((await unwrap(api.listNotifications({ unreadOnly: true }))).items.every((n) => n.id !== first.id)).toBe(true);
    const marked = await unwrap(api.markAllNotificationsRead());
    expect(marked.marked).toBe(after.items.length - 1);
    expect((await unwrap(api.countUnreadNotifications())).unread).toBe(0);
    // A new client over the same backend still sees them read.
    expect((await unwrap(client(ASHA, backend).countUnreadNotifications())).unread).toBe(0);
  });

  it("answers 404 for a notification that is not there", async () => {
    const result = await client(ASHA).markNotificationRead("0192f1c4-7a10-7c3e-9b2a-000000000000");
    expect(result.ok ? null : result.error.status).toBe(404);
  });

  describe("tasks, time off and stock", () => {
    const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
    const DEV = "a1a1a1a1-0000-4000-8000-000000000002";

    function seeded() {
      const fixtures = createFixtures({ now: NOW });
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      if (sunrise === undefined) throw new Error("expected the sunrise clinic");
      const farah = fixtures.memberships.find((m) => m.clinic_id === sunrise.id && m.user_id === FARAH);
      if (farah === undefined) throw new Error("expected Farah's membership");
      const base = { clinic_id: sunrise.id, created_at: NOW.toISOString(), reminded_at: null, escalated_at: null };
      const task = { task_occurrence_id: "0192f1c4-7a10-7c3e-9b2a-0000000000f1", title: "Close up", due_at: NOW.toISOString(), href: "/today" };
      const kinds = ["task_due", "task_reminder", "task_escalated"] as const;
      const rows = [
        { ...base, ...task, id: "0192f1c4-7a10-7c3e-9b2a-000000000a01", kind: kinds[0], step_no: 0, for_role: "front_desk" },
        { ...base, ...task, id: "0192f1c4-7a10-7c3e-9b2a-000000000a02", kind: kinds[1], step_no: 1, for_role: "front_desk" },
        { ...base, ...task, id: "0192f1c4-7a10-7c3e-9b2a-000000000a03", kind: kinds[2], step_no: 1 },
        { ...base, id: "0192f1c4-7a10-7c3e-9b2a-000000000a04", kind: "time_off_requested", time_off_request_id: "0192f1c4-7a10-7c3e-9b2a-0000000000f2", href: "/time-off" },
        { ...base, id: "0192f1c4-7a10-7c3e-9b2a-000000000a05", kind: "time_off_decided", time_off_request_id: "0192f1c4-7a10-7c3e-9b2a-0000000000f3", for_member: farah.id, href: "/time-off" },
        { ...base, id: "0192f1c4-7a10-7c3e-9b2a-000000000a06", kind: "stock_alert", item_id: "0192f1c4-7a10-7c3e-9b2a-0000000000f4", item_name: "Composite A2", days_cover: 3.5, href: "/stock" },
      ];
      fixtures.notifications = [...(fixtures.notifications ?? []), ...rows];
      return createFakeBackend(fixtures);
    }

    const ops = async (as: string, backend: ReturnType<typeof seeded>) =>
      (await unwrap(client(as, backend).listNotifications())).items
        .filter((n) => /^(task_|time_off_|stock_)/.test(n.kind))
        .map((n) => n.id.slice(-2))
        .sort();

    it("sends each kind to its audience and shows a task only at its newest step", async () => {
      const backend = seeded();
      // The front desk: the role's task at its newest step (the reminder), their own decision, stock.
      expect(await ops(FARAH, backend)).toEqual(["02", "05", "06"]);
      // The owner: the escalation, the request to decide, stock.
      expect(await ops(ASHA, backend)).toEqual(["03", "04", "06"]);
      // The doctor: stock only.
      expect(await ops(DEV, backend)).toEqual(["06"]);
    });

    it("counts what it lists and carries the new fields", async () => {
      const backend = seeded();
      const api = client(FARAH, backend);
      const list = await unwrap(api.listNotifications());
      expect((await unwrap(api.countUnreadNotifications())).unread).toBe(list.items.length);
      const reminder = list.items.find((n) => n.kind === "task_reminder");
      expect(reminder).toMatchObject({ title: "Close up", href: "/today" });
      expect(list.items.find((n) => n.kind === "stock_alert")).toMatchObject({ item_name: "Composite A2", days_cover: 3.5 });
    });
  });

  it("accepts a kind and fields from a newer server without failing", () => {
    const future = { id: "n1", kind: "shift_swap_requested", created_at: NOW.toISOString(), read: false, swap_id: "s1" };
    const parsed = notification.safeParse(future);
    expect(parsed.success).toBe(true);
    expect(knownNotificationKind("shift_swap_requested")).toBeNull();
    expect(knownNotificationKind("stock_alert")).toBe("stock_alert");
  });
});
