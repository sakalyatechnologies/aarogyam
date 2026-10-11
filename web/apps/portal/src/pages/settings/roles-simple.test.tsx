import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AccessCatalogue } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, renderPortal } from "../../test/render.js";
import { SIMPLE_AREAS, areaState, setArea } from "./roles-panel.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const problems = (result: axe.AxeResults) => result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const area = (id: string) => {
  const found = SIMPLE_AREAS.find((a) => a.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const everyKey = SIMPLE_AREAS.flatMap((a) => a.keys);
const catalogue: AccessCatalogue = {
  permissions: everyKey.map((key) => ({ key, module: key.split(".")[0] ?? key, description: key, scopes: ["all", "own"] })),
  templates: [],
};
const known = new Set(everyKey);

describe("simple roles matrix: the group mapping", () => {
  it("never lists a key in two areas", () => {
    expect(new Set(everyKey).size).toBe(everyKey.length);
  });

  it("round trips: on expands to every key of the group, off removes exactly those", () => {
    const stock = area("stock");
    const start = [{ key: "patients.delete", scope: "all" as const }];
    const on = setArea(start, stock, true, catalogue);
    expect(on.map((p) => p.key).sort()).toEqual(["inventory.manage", "inventory.read", "patients.delete"]);
    expect(areaState(on, stock, known)).toBe("on");
    expect(setArea(on, stock, false, catalogue)).toEqual(start);
  });

  it("is partial when a role holds only some of the group, and turning it on completes the group, keeping scopes", () => {
    const patients = area("patients");
    const held = [{ key: "patients.read", scope: "own" as const }];
    expect(areaState(held, patients, known)).toBe("partial");
    const next = setArea(held, patients, true, catalogue);
    expect(areaState(next, patients, known)).toBe("on");
    expect(next.find((p) => p.key === "patients.read")?.scope).toBe("own");
    expect(next.find((p) => p.key === "patients.write")?.scope).toBe("all");
    expect(areaState([], patients, known)).toBe("off");
  });
});

describe("simple roles matrix (new look)", () => {
  it("shows partial, locks the owner, and passes axe", async () => {
    renderPortal("/settings?tab=team", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "What each role can do" });
    const owner = within(table).getByRole("checkbox", { name: /^Owner: Patients/ });
    expect(owner.getAttribute("aria-checked")).toBe("true");
    expect(owner.getAttribute("aria-disabled")).toBe("true");
    expect(owner.getAttribute("title")).toMatch(/always has full access/);
    // Front desk holds part of the money group by default or none; any partial cell reads "mixed".
    const cells = within(table).getAllByRole("checkbox");
    expect(cells.some((c) => c.getAttribute("aria-checked") === "mixed")).toBe(true);
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  }, 60_000);

  it("does not change the owner when clicked", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=team", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "What each role can do" });
    await user.click(within(table).getByRole("checkbox", { name: /^Owner: Stock/ }));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("saves the expanded keys on a click, confirms with a toast, and Undo puts it back", async () => {
    const user = userEvent.setup();
    const sent: { key: string; keys: string[] }[] = [];
    renderPortal("/settings?tab=team", {
      as: PEOPLE.asha,
      wrap: (client) => ({
        ...client,
        setRolePermissions: (key, update, options) => {
          sent.push({ key, keys: update.permissions.map((p) => p.key) });
          return client.setRolePermissions(key, update, options);
        },
      }),
    });
    const table = await screen.findByRole("table", { name: "What each role can do" });
    const cell = () => within(screen.getByRole("table", { name: "What each role can do" })).getByRole("checkbox", { name: /^Front desk: Money reports/ });
    expect(cell().getAttribute("aria-checked")).toBe("false");
    await user.click(within(table).getByRole("checkbox", { name: /^Front desk: Money reports/ }));
    await waitFor(() => {
      expect(cell().getAttribute("aria-checked")).toBe("true");
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.key).toBe("front_desk");
    expect(sent[0]?.keys).toEqual(expect.arrayContaining([...area("money").keys]));
    expect(await screen.findByText("Saved. Front desk: Money reports on")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(cell().getAttribute("aria-checked")).toBe("false");
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]?.keys).not.toContain("finance.view");
    expect(await screen.findByText(/Undone\. Front desk is back as it was/)).toBeTruthy();
  });

  it("keeps the detailed editor behind Advanced", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=team", { as: PEOPLE.asha });
    await screen.findByRole("table", { name: "What each role can do" });
    expect(screen.queryByRole("table", { name: "Roles and what they can do" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(await screen.findByRole("table", { name: "Roles and what they can do" })).toBeTruthy();
  });
});
