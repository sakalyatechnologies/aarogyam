import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { success, taskOccurrence, type ApiClient, type TaskOccurrence } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { sortOpenTasks } from "./my-tasks.js";
import type { CompleteTaskInput } from "./queries.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const asFrontDesk = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = ROLES.frontDesk;
  });

/** The fake clock is 2026-10-03 11:00 in the clinic. */
function task(id: string, title: string, dueUtc: string, extra: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return taskOccurrence.parse({
    id: `0192f1c4-7a10-7c3e-9b2a-0000000000${id}`,
    template_id: "0192f1c4-7a10-7c3e-9b2a-0000000000aa",
    title,
    action: "none",
    local_date: "2026-10-03",
    due_at: `2026-10-03T${dueUtc}:00Z`,
    status: "open",
    ...extra,
  });
}

/** The item at `index`; a test that reaches for one that is not there fails with a clear message. */
function nth<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`expected an item at ${String(index)}`);
  return found;
}

/** A client whose "my tasks" is the given list, and which records what was sent to finish a task. */
function withTasks(items: TaskOccurrence[]) {
  const sent: { id: string; input: CompleteTaskInput }[] = [];
  const state = [...items];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    listMyTasks: () => Promise.resolve(success({ date: "2026-10-03", items: state.map((t) => ({ ...t })) })),
    completeTask: (id, input) => {
      sent.push({ id, input });
      const found = state.find((t) => t.id === id);
      if (found === undefined) throw new Error("no such task");
      found.status = "done";
      found.completed_at = "2026-10-03T05:30:00Z";
      return Promise.resolve(success({ ...found }));
    },
  });
  return { wrap, sent };
}

const card = async () => within(await screen.findByRole("region", { name: "My tasks" }));

describe("sorting", () => {
  it("lists overdue tasks first, then the rest, each soonest first", () => {
    const now = new Date("2026-10-03T05:30:00Z").getTime();
    const list = [task("01", "Later", "14:00"), task("02", "Late B", "03:30"), task("03", "Soon", "08:00"), task("04", "Late A", "02:00"), task("05", "Finished", "01:00", { status: "done" })];
    expect(sortOpenTasks(list, now).map((t) => t.title)).toEqual(["Late A", "Late B", "Soon", "Later"]);
  });
});

describe("My tasks on Today", () => {
  it("shows tasks with due times, overdue first, and finishes one in a tap", async () => {
    const user = userEvent.setup();
    const { wrap, sent } = withTasks([task("01", "Evening clean-up", "14:00"), task("02", "Sterilise instruments", "03:00")]);
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap });
    const list = within(await (await card()).findByRole("list", { name: "My tasks" }));
    const rows = list.getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/Sterilise|Evening/).textContent)).toEqual(["Sterilise instruments", "Evening clean-up"]);
    expect(within(nth(rows, 0)).getByText(/Overdue · Due 8:30/)).toBeTruthy();
    expect(within(nth(rows, 1)).getByText(/Due 7:30/)).toBeTruthy();
    await user.click(list.getByRole("button", { name: "Done: Sterilise instruments" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.input).toEqual({});
    await waitFor(() => {
      expect(list.queryByText("Sterilise instruments")).toBeNull();
    });
    // The finished one moves under "Done today (1)", collapsed until opened.
    const done = (await card()).getByRole("button", { name: /Done today \(1\)/ });
    expect(done.getAttribute("aria-expanded")).toBe("false");
    await user.click(done);
    expect(within((await card()).getByRole("list", { name: "Done today" })).getByText("Sterilise instruments")).toBeTruthy();
  });

  it("sends an optional note of at most 300 characters, with the no-patient-names hint", async () => {
    const user = userEvent.setup();
    const { wrap, sent } = withTasks([task("01", "Wipe the chairs", "03:00")]);
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap });
    const mine = await card();
    await user.click(await mine.findByRole("button", { name: "Add a note" }));
    const box = mine.getByLabelText(/no patient names/i);
    expect(box.getAttribute("maxlength")).toBe("300");
    await user.type(box, "Ran out of wipes");
    await user.click(mine.getByRole("button", { name: "Done: Wipe the chairs" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.input).toEqual({ note: "Ran out of wipes" });
  });

  it("records usage: picks items, sends their quantities", async () => {
    const user = userEvent.setup();
    const { wrap, sent } = withTasks([task("01", "Record materials used today", "14:00", { action: "record_usage" })]);
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap });
    const mine = await card();
    expect(mine.queryByRole("button", { name: /^Done/ })).toBeNull();
    await user.click(await mine.findByRole("button", { name: "Record usage" }));
    const group = within(await mine.findByRole("group", { name: "Materials used" }));
    const inputs = await group.findAllByRole("spinbutton");
    expect(inputs.length).toBeGreaterThan(1);
    expect(group.getByRole("button", { name: "Save and finish" }).hasAttribute("disabled")).toBe(true);
    await user.type(nth(inputs, 0), "2");
    await user.type(nth(inputs, 1), "5");
    await user.click(group.getByRole("button", { name: "Save and finish" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    const usage = sent[0]?.input.usage ?? [];
    expect(usage.map((line) => line.quantity).sort()).toEqual([2, 5]);
    expect(usage.every((line) => line.item_id.length > 0)).toBe(true);
  });

  it("finishes a usage task with 'Nothing used today' and sends no materials", async () => {
    const user = userEvent.setup();
    const { wrap, sent } = withTasks([task("01", "Record materials used today", "14:00", { action: "record_usage" })]);
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap });
    const mine = await card();
    await user.click(await mine.findByRole("button", { name: "Record usage" }));
    await user.click(await mine.findByRole("button", { name: "Nothing used today" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.input).toEqual({ usage: [] });
  });

  it("shows how many patients still need photos, with a link to the patients list", async () => {
    const user = userEvent.setup();
    const { wrap, sent } = withTasks([task("01", "Check today's patients have their photos", "14:00", { action: "confirm_photos", patients_without_photos_today: 3 })]);
    const { router } = renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap });
    const mine = await card();
    expect(await mine.findByText(/3 patients still need photos/)).toBeTruthy();
    await user.click(mine.getByRole("button", { name: /^Done/ }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.input).toEqual({});
    cleanup();
    const again = renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap: withTasks([task("02", "Photos", "14:00", { action: "confirm_photos", patients_without_photos_today: 1 })]).wrap });
    const link = await (await card()).findByRole("link", { name: "Open patients" });
    expect((await (await card()).findByText(/1 patient still needs photos/)).textContent).toBeTruthy();
    await user.click(link);
    await waitFor(() => {
      expect(again.router.state.location.pathname).toBe("/patients");
    });
    expect(router).toBeTruthy();
  });

  it("says so warmly when everything is done", async () => {
    const { wrap } = withTasks([task("01", "Sterilise", "03:00", { status: "done", completed_at: "2026-10-03T03:10:00Z", completed_by_name: "Farah Sheikh" })]);
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap });
    const mine = await card();
    expect(await mine.findByText("All your tasks are done — nice work ✨")).toBeTruthy();
    expect(mine.getByRole("button", { name: /Done today \(1\)/ })).toBeTruthy();
  });

  it("works against the fake server: finishes a task of the person's role", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk() });
    const mine = await card();
    const done = await mine.findAllByRole("button", { name: /^Done: / });
    const before = mine.getAllByRole("listitem").length;
    expect(before).toBeGreaterThan(0);
    await user.click(nth(done, 0));
    await waitFor(() => {
      expect(mine.getAllByRole("listitem").length).toBeLessThan(before);
    });
  });

  it("has no axe violations, with a usage list open", async () => {
    const user = userEvent.setup();
    const { wrap } = withTasks([task("01", "Overdue one", "03:00"), task("02", "Record materials", "14:00", { action: "record_usage" }), task("03", "Photos", "14:00", { action: "confirm_photos", patients_without_photos_today: 2 })]);
    renderPortal("/today", { as: PEOPLE.farah, backend: asFrontDesk(), wrap });
    const mine = await card();
    await user.click(await mine.findByRole("button", { name: "Record usage" }));
    await user.click(nth(await mine.findAllByRole("button", { name: "Add a note" }), 0));
    await mine.findByRole("group", { name: "Materials used" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
