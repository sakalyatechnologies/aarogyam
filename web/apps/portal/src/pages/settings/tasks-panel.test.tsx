import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, Permission } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

type NewTaskBody = Parameters<ApiClient["createTask"]>[0];

async function openTasks() {
  const user = userEvent.setup();
  const created: NewTaskBody[] = [];
  const deleted: string[] = [];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    createTask: (input, options) => {
      created.push(input);
      return client.createTask(input, options);
    },
    deleteTask: (id, options) => {
      deleted.push(id);
      return client.deleteTask(id, options);
    },
  });
  renderPortal("/settings?tab=tasks", { as: PEOPLE.asha, wrap });
  await screen.findByRole("list", { name: "Standard tasks" });
  return { user, created, deleted };
}

describe("Settings → Tasks", () => {
  it("shows the three standard tasks with their schedule, assignee and a switch", async () => {
    await openTasks();
    const list = screen.getByRole("list", { name: "Standard tasks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    for (const title of ["Sterilise instruments", "Record materials used today", "Check today's patients have their photos"]) {
      expect(within(list).getByRole("switch", { name: `${title} on` }).getAttribute("aria-checked")).toBe("true");
    }
    expect(within(list).getByText(/Every day at 8:30 am · Assistant/)).toBeTruthy();
  });

  it("switches a standard task off, and gives no way to delete it", async () => {
    const { user } = await openTasks();
    const list = screen.getByRole("list", { name: "Standard tasks" });
    const toggle = within(list).getByRole("switch", { name: "Sterilise instruments on" });
    await user.click(toggle);
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Standard tasks" })).getByRole("switch", { name: "Sterilise instruments on" }).getAttribute("aria-checked")).toBe("false");
    });
    expect(within(list).queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete Sterilise/ })).toBeNull();
  });

  it("creates a task on chosen weekdays and sends exactly what was chosen", async () => {
    const { user, created } = await openTasks();
    await user.click(screen.getByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/What should be done/), "Order gloves");
    await user.selectOptions(within(dialog).getByLabelText("Role"), "Front desk");
    await user.selectOptions(within(dialog).getByLabelText("How often?"), "Chosen days");
    const days = within(dialog).getByRole("group", { name: "Days of the week" });
    // Mon to Fri start chosen; leave Mon and Wed.
    for (const day of ["Tue", "Thu", "Fri"]) await user.click(within(days).getByRole("button", { name: day }));
    fireEvent.change(within(dialog).getByLabelText("At what time?"), { target: { value: "10:15" } });
    await user.selectOptions(within(dialog).getByLabelText("Remind"), "Every 30 min");
    const escalate = within(dialog).getByLabelText(/Tell the owner after/);
    await user.clear(escalate);
    await user.type(escalate, "2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => { expect(created).toHaveLength(1); });
    expect(created[0]).toEqual({
      title: "Order gloves",
      assignee_role_id: "front_desk",
      schedule: { kind: "weekdays", weekdays: [1, 3], due_time: "10:15" },
      remind_every_minutes: 30,
      escalate_after: 2,
      active: true,
    });
    const own = await screen.findByRole("list", { name: "Your own tasks" });
    expect(within(own).getByText("Order gloves")).toBeTruthy();
    expect(within(own).getByText(/Mon, Wed at 10:15 am · Front desk/)).toBeTruthy();
  });

  it("shows the next five due times when a saved task is edited, and can delete it", async () => {
    const { user, deleted } = await openTasks();
    await user.click(screen.getByRole("button", { name: "New task" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Save the task to see its next five due dates.")).toBeTruthy();
    await user.type(within(dialog).getByLabelText(/What should be done/), "Wipe the chairs");
    await user.selectOptions(within(dialog).getByLabelText("Role"), "Assistant");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Your own tasks" });

    await user.click(await screen.findByRole("button", { name: "Edit Wipe the chairs" }));
    dialog = await screen.findByRole("dialog");
    const preview = within(dialog).getByRole("region", { name: "Next 5 due" });
    await waitFor(() => { expect(within(preview).getAllByRole("listitem")).toHaveLength(5); });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Delete Wipe the chairs" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => { expect(deleted).toHaveLength(1); });
    await waitFor(() => { expect(screen.queryByText("Wipe the chairs")).toBeNull(); });
  });

  it("asks for a role or a person before saving", async () => {
    const { user, created } = await openTasks();
    await user.click(screen.getByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/What should be done/), "Order gloves");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Choose who it is for.")).toBeTruthy();
    expect(created).toHaveLength(0);
  });

  it("filters the history by task and result, and sorts by a header", async () => {
    const { user } = await openTasks();
    const card = screen.getByRole("heading", { name: "History" }).closest("section");
    if (card === null) throw new Error("no history card");
    expect(within(card).getByText(/Don't write patient names here/)).toBeTruthy();
    const table = await within(card).findByRole("table", { name: "Task history" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);

    await user.selectOptions(within(card).getByLabelText("Task"), "Record materials used today");
    await waitFor(() => { expect(within(card).getAllByRole("row")).toHaveLength(2); });
    expect(within(card).getByText("Record materials used today", { selector: "td" })).toBeTruthy();

    await user.selectOptions(within(card).getByLabelText("Result"), "Missed");
    expect(await within(card).findByText("No tasks match these filters in the last 30 days.")).toBeTruthy();
    await user.selectOptions(within(card).getByLabelText("Result"), "Still open");
    await within(card).findByRole("table", { name: "Task history" });

    await user.selectOptions(within(card).getByLabelText("Person"), "Everyone");
    const header = within(card).getByRole("columnheader", { name: /Task/ });
    expect(header.getAttribute("aria-sort")).toBe("none");
    await user.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
  });

  it("has no axe violations, with the dialog open too", async () => {
    const { user } = await openTasks();
    await screen.findByRole("table", { name: "Task history" });
    const rules = { "color-contrast": { enabled: false }, region: { enabled: false } };
    const run = async (root: Element) => {
      const result = await axe.run(root, { rules });
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    };
    expect(await run(document.body)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("How often?"), "Chosen days");
    expect(await run(dialog)).toEqual([]);
  });
});

describe("the Tasks tab and its permission", () => {
  const as = (permissions: Permission[]) =>
    fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions };
    });
  const names = async () => {
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    return [...nav.querySelectorAll("button")].map((b) => b.textContent);
  };

  it("is hidden without tasks.manage", async () => {
    renderPortal("/settings?tab=tasks", { as: PEOPLE.farah, backend: as(["patients.read", "tasks.use"]) });
    expect(await names()).not.toContain("Tasks");
    expect(screen.queryByRole("list", { name: "Standard tasks" })).toBeNull();
  });

  it("shows with tasks.manage alone", async () => {
    renderPortal("/settings?tab=tasks", { as: PEOPLE.farah, backend: as(["tasks.manage"]) });
    expect(await names()).toContain("Tasks");
    expect(await screen.findByRole("list", { name: "Standard tasks" })).toBeTruthy();
  });
});
