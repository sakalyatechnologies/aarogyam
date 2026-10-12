import { describe, expect, it } from "vitest";

import { inventoryItemId, taskId, taskOccurrenceId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

// 11:00 in Pune.
const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  let now = NOW;
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => now });
  return { as, advance: (to: string) => (now = new Date(to)) };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const statusOf = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);

describe("fake client: staff tasks", () => {
  it("lists the standard tasks, which can be switched off but not deleted", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const list = value(await asha.listTasks());
    expect(list.items.filter((t) => t.is_default)).toHaveLength(3);
    const first = list.items.find((t) => t.is_default);
    const id = taskId.parse(first?.id);
    expect(statusOf(await asha.deleteTask(id))).toBe(409);
    expect(value(await asha.updateTask(id, { active: false })).active).toBe(false);
    expect(value(await asha.previewTask(id)).items).toEqual([]);
    expect(value(await asha.updateTask(id, { active: true })).active).toBe(true);
    expect(value(await asha.previewTask(id)).items).toHaveLength(5);
  });

  it("answers by permission and keeps clinics apart", async () => {
    const { as } = setup();
    expect(statusOf(await as(DEV).listTasks())).toBe(200);
    expect(statusOf(await as(FARAH).listTasks())).toBe(403);
    expect(statusOf(await as(FARAH).listMyTasks())).toBe(200);
    expect(statusOf(await as(BINA, SUNRISE).listMyTasks())).toBe(404);
    const id = taskId.parse(value(await as(ASHA).listTasks()).items[0]?.id);
    expect(statusOf(await as(BINA, LOTUS).getTask(id))).toBe(404);
    expect(statusOf(await as(BINA, LOTUS).previewTask(id))).toBe(404);
  });

  it("makes a role task, closes it once for the person who finishes it, and takes the materials off the shelf", async () => {
    const { as, advance } = setup();
    const asha = as(ASHA);
    const farah = as(FARAH);
    const item = value(await asha.addInventoryItem({ name: "Gloves", unit: "box", reorder_level: 1 }));
    value(await asha.receiveStock({ item_id: item.id, quantity: 10 }));
    value(
      await asha.createTask({
        title: "Record materials",
        assignee_role_id: "front_desk",
        action: "record_usage",
        schedule: { kind: "daily", due_time: "12:00" },
      }),
    );
    expect(value(await farah.listMyTasks()).items.filter((i) => i.title === "Record materials")).toEqual([]);
    advance("2026-10-03T07:00:00Z");
    const mine = value(await farah.listMyTasks());
    const occurrence = mine.items.find((i) => i.title === "Record materials");
    const id = taskOccurrenceId.parse(occurrence?.id);
    // Yesterday's end-of-day standard tasks are still open, so count against the list.
    const open = value(await farah.listMyTasks()).items.filter((i) => i.status === "open").length;
    expect(value(await farah.getBadges()).tasks_open).toBe(open);

    const stock = inventoryItemId.parse(item.id);
    expect(statusOf(await farah.completeTask(id, { usage: [{ item_id: stock, quantity: 100 }] }))).toBe(409);
    expect(value(await farah.listMyTasks()).items.find((i) => i.id === id)?.status).toBe("open");
    const done = value(await farah.completeTask(id, { note: "all counted", usage: [{ item_id: stock, quantity: 4 }] }));
    expect(done.status).toBe("done");
    expect(value(await asha.getInventoryItem(stock)).stock.on_hand).toBe(6);
    // Again: fine, and nothing is taken twice.
    expect(value(await farah.completeTask(id, { usage: [{ item_id: stock, quantity: 4 }] })).completed_at).toBe(done.completed_at);
    expect(value(await asha.getInventoryItem(stock)).stock.on_hand).toBe(6);
    // The owner does not hold the role.
    expect(statusOf(await asha.completeTask(id, {}))).toBe(403);
    expect(statusOf(await farah.completeTask(id, { note: "n".repeat(301) }))).toBe(400);
    expect(value(await farah.getBadges()).tasks_open).toBe(open - 1);
    expect(value(await asha.reopenTask(id)).status).toBe("open");
    expect(value(await asha.listTaskHistory()).items.some((i) => i.id === id)).toBe(true);
    expect(statusOf(await asha.listTaskHistory({ from: "2026-01-01", to: "2026-10-03" }))).toBe(400);
  });

  it("refuses a bad task", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const base = { title: "x", assignee_role_id: "front_desk", schedule: { kind: "daily" as const, due_time: "08:00" } };
    expect(statusOf(await asha.createTask({ ...base, title: "" }))).toBe(400);
    expect(statusOf(await asha.createTask({ title: "x", schedule: base.schedule }))).toBe(400);
    expect(statusOf(await asha.createTask({ ...base, schedule: { kind: "every_n_days", due_time: "08:00" } }))).toBe(400);
    expect(statusOf(await asha.createTask({ ...base, schedule: { kind: "weekdays", weekdays: [8], due_time: "08:00" } }))).toBe(400);
    expect(statusOf(await asha.createTask({ ...base, schedule: { kind: "once", once_at: "2001-01-01T00:00:00Z" } }))).toBe(400);
  });
});
