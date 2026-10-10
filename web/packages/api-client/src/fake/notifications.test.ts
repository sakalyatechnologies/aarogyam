import { describe, expect, it } from "vitest";

import { unwrap } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-03T05:30:00Z");

function client(as: string, backend = createFakeBackend(createFixtures({ now: NOW }))) {
  return backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: as }), now: () => NOW });
}

describe("fake notifications and badges", () => {
  it("lists the bell newest first and counts the same unread ones the badges poll reports", async () => {
    const api = client(ASHA);
    const list = await unwrap(api.listNotifications());
    expect(list.items.length).toBeGreaterThan(2);
    expect(list.items.map((n) => n.id)).toEqual([...list.items.map((n) => n.id)].sort().reverse());
    expect(list.items.every((n) => !n.read)).toBe(true);
    const badges = await unwrap(api.getBadges());
    expect((await unwrap(api.countUnreadNotifications())).unread).toBe(list.items.length);
    expect(badges.notifications_unread).toBe(list.items.length);
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
    expect((await unwrap(client(ASHA, backend).getBadges())).notifications_unread).toBe(0);
  });

  it("answers 404 for a notification that is not there", async () => {
    const result = await client(ASHA).markNotificationRead("0192f1c4-7a10-7c3e-9b2a-000000000000");
    expect(result.ok ? null : result.error.status).toBe(404);
  });
});
