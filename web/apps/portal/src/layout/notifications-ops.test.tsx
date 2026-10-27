import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { notification, success, taskOccurrence, type ApiClient, type Notification } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../lib/new-look.js";
import { PEOPLE, renderPortal } from "../test/render.js";
import { bellCount, describeNotification } from "./notifications.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const TASK_ID = "0192f1c4-7a10-7c3e-9b2a-0000000000f1";
const AT = "2026-10-03T05:00:00Z";
const base = { created_at: AT, read: false };

const ITEMS: Notification[] = [
  { ...base, id: "n1", kind: "task_due", task_occurrence_id: TASK_ID, title: "Sterilise instruments", due_at: AT, href: "/today" },
  { ...base, id: "n2", kind: "task_reminder", task_occurrence_id: "0192f1c4-7a10-7c3e-9b2a-0000000000f9", title: "Record materials", due_at: AT, href: "/today" },
  { ...base, id: "n3", kind: "task_escalated", task_occurrence_id: TASK_ID, title: "Close up", due_at: AT, href: "/today" },
  { ...base, id: "n4", kind: "time_off_requested", time_off_request_id: "r1", href: "/time-off" },
  { ...base, id: "n5", kind: "time_off_decided", time_off_request_id: "r2", href: "/time-off" },
  { ...base, id: "n6", kind: "stock_alert", item_id: "i1", item_name: "Composite A2", days_cover: 3.6, href: "/stock" },
  { ...base, id: "n7", kind: "shift_swap_requested", swap_id: "s1" },
].map((raw) => notification.parse(raw));

const OCCURRENCES = [
  { id: TASK_ID, template_id: "t1", title: "Sterilise instruments", action: "none", local_date: "2026-10-03", due_at: AT, status: "open" },
  { id: "0192f1c4-7a10-7c3e-9b2a-0000000000f9", template_id: "t2", title: "Record materials", action: "record_usage", local_date: "2026-10-03", due_at: AT, status: "open" },
].map((raw) => taskOccurrence.parse(raw));
const [PLAIN_TASK] = OCCURRENCES;

function withBell(items: Notification[] = ITEMS, completed: { id: string; input: unknown }[] = []) {
  return (client: ApiClient): ApiClient => ({
    ...client,
    listNotifications: () => Promise.resolve(success({ items })),
    countUnreadNotifications: () => Promise.resolve(success({ unread: items.length })),
    getBadges: () => Promise.resolve(success({ chat_unread: 0, notifications_unread: items.length, tasks_open: 2 })),
    markNotificationRead: () => Promise.resolve(success(undefined)),
    listMyTasks: () => Promise.resolve(success({ date: "2026-10-03", items: OCCURRENCES })),
    completeTask: (id, input) => {
      completed.push({ id, input });
      if (PLAIN_TASK === undefined) throw new Error("no task");
      return Promise.resolve(success({ ...PLAIN_TASK, status: "done" as const }));
    },
  });
}

async function openBell(wrap: (client: ApiClient) => ApiClient, path = "/today") {
  const user = userEvent.setup();
  const view = renderPortal(path, { as: PEOPLE.asha, wrap });
  await user.click(await screen.findByRole("button", { name: /^Notifications, / }));
  const dialog = await screen.findByRole("dialog", { name: "Notifications" });
  await within(dialog).findByRole("list", { name: "Notifications" });
  return { user, dialog: within(dialog), ...view };
}

describe("bell: tasks, time off and stock", () => {
  it("renders each new kind, and a kind it does not know as a generic row", async () => {
    const { dialog } = await openBell(withBell());
    expect(dialog.getByRole("button", { name: /Due: Sterilise instruments/ })).toBeTruthy();
    expect(dialog.getByRole("button", { name: /Reminder: Record materials/ })).toBeTruthy();
    expect(dialog.getByRole("button", { name: /Close up not done yet/ })).toBeTruthy();
    expect(dialog.getByRole("button", { name: /Time off requested/ })).toBeTruthy();
    expect(dialog.getByRole("button", { name: /Time off decided/ })).toBeTruthy();
    expect(dialog.getByRole("button", { name: /Composite A2 runs out in about 4 days/ })).toBeTruthy();
    expect(dialog.getByRole("button", { name: /Update/ })).toBeTruthy();
  });

  it("finishes a task from its row with Done, but only a plain one", async () => {
    const completed: { id: string; input: unknown }[] = [];
    const { user, dialog } = await openBell(withBell(ITEMS, completed));
    // The reminder is for a usage task: no Done, the row opens Today instead.
    expect(dialog.getAllByRole("button", { name: /^Done: / })).toHaveLength(1);
    await user.click(dialog.getByRole("button", { name: "Done: Sterilise instruments" }));
    await waitFor(() => {
      expect(completed).toEqual([{ id: TASK_ID, input: {} }]);
    });
  });

  it("opens Settings → Time off, Stock and Today from their rows", async () => {
    const first = await openBell(withBell());
    await first.user.click(first.dialog.getByRole("button", { name: /Time off requested/ }));
    await waitFor(() => {
      expect(first.router.state.location.pathname + first.router.state.location.search).toBe("/settings?tab=time-off");
    });
    cleanup();
    const second = await openBell(withBell());
    await second.user.click(second.dialog.getByRole("button", { name: /Composite A2/ }));
    await waitFor(() => {
      expect(second.router.state.location.pathname).toBe("/stock");
    });
  });

  it("counts the tasks still open in the badge", async () => {
    renderPortal("/today", { as: PEOPLE.asha, wrap: withBell() });
    // 7 unread notifications and 2 open tasks.
    expect(await screen.findByRole("button", { name: "Notifications, 9 unread" })).toBeTruthy();
  });

  it("an unknown kind, or one missing its fields, does not crash", () => {
    const odd = notification.parse({ id: "x", kind: "something_new", created_at: AT, read: false });
    expect(describeNotification(odd, "Asia/Kolkata").title).toBe("Update");
    for (const kind of ["task_due", "task_reminder", "task_escalated", "stock_alert", "time_off_requested", "time_off_decided"]) {
      expect(describeNotification({ ...odd, kind }, "Asia/Kolkata").title.length).toBeGreaterThan(0);
    }
    expect(bellCount(undefined)).toBeNull();
    expect(bellCount({ notifications_unread: null, tasks_open: 0 })).toBeNull();
    expect(bellCount({ notifications_unread: 2, tasks_open: 3 })).toBe(5);
  });

  it("words a booking conflict and links to the appointment's day", () => {
    const item = notification.parse({
      id: "c1",
      kind: "booking_conflict",
      created_at: AT,
      read: false,
      appointment: { id: "a1", starts_at: "2026-10-05T03:30:00Z", ends_at: "2026-10-05T04:00:00Z", status: "requested", practitioner_id: "p1", practitioner_name: "Dr Asha Rao" },
    });
    const view = describeNotification(item, "Asia/Kolkata");
    expect(view.title).toBe("Time already booked");
    expect(view.body).toContain("A patient asked for a time that's taken — confirm, move or decline.");
    expect(view.body).toContain("Dr Asha Rao");
    expect(view.to).toBe("/calendar?from=2026-10-05");
  });

  it("has no axe violations with the new rows open", async () => {
    await openBell(withBell());
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
