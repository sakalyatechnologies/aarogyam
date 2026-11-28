import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function patient() {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/patients/${visit?.patient_id ?? ""}`;
    fixtures.chartEntries = fixtures.chartEntries.filter((c) => c.patient_id !== visit?.patient_id);
  });
  return { path, backend };
}

/** Records what the panel sends to the notes endpoint; the fake backend stores the notes. */
function notesApi() {
  const posted: string[] = [];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    addToothNote: (id, tooth, body, options) => {
      posted.push(body);
      return client.addToothNote(id, tooth, body, options);
    },
  });
  return { posted, wrap };
}

const ready = () => screen.findByRole("button", { name: "View" });
const tooth = (n: number) => screen.getByRole("button", { name: new RegExp(`^Tooth ${String(n)},`) });

async function pick(user: ReturnType<typeof userEvent.setup>, n: number) {
  await ready();
  await user.click(tooth(n));
  return screen.findByRole("complementary", { name: `Tooth ${String(n)} panel` });
}

describe("tooth notes", () => {
  it("saves a changed note when the panel closes, shows Saved and lists past notes newest first", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const notes = notesApi();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: notes.wrap });
    const first = await pick(user, 36);
    await user.type(within(first).getByRole("textbox", { name: "Notes" }), "Older note");
    await user.click(within(first).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(notes.posted).toEqual(["Older note"]);
    });
    // Same tooth again: the saved note is listed, and the chart shows its dot.
    const panel = await pick(user, 36);
    const history = await within(panel).findByRole("list", { name: "Past notes on tooth 36" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
    expect(tooth(36).hasAttribute("data-noted")).toBe(true);
    await user.type(within(panel).getByRole("textbox", { name: "Notes" }), "Newer note");
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    const again = await pick(user, 36);
    await waitFor(() => {
      expect(within(within(again).getByRole("list", { name: "Past notes on tooth 36" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Newer note"), expect.stringContaining("Older note")]);
    });
    await user.click(within(again).getByRole("button", { name: "Close" }));
    expect(notes.posted).toEqual(["Older note", "Newer note"]);
    expect(within(again).queryByRole("button", { name: /^save/i })).toBeNull();
  });

  it("saves on blur once, and the quiet Saved tick shows", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    const notes = notesApi();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: notes.wrap });
    const panel = await pick(user, 14);
    await user.type(within(panel).getByRole("textbox", { name: "Notes" }), "Recheck in a week");
    await user.tab();
    await within(panel).findByText("Saved");
    expect(notes.posted).toEqual(["Recheck in a week"]);
  });

  it("keeps More details collapsed by default and remembers it once opened", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: notesApi().wrap });
    const panel = await pick(user, 16);
    const toggle = within(panel).getByRole("button", { name: "More details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(panel).queryByRole("group", { name: /^Condition/ })).toBeNull();
    expect(within(panel).getByRole("group", { name: "Health" })).toBeTruthy();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    cleanup();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: notesApi().wrap });
    const again = await pick(user, 16);
    expect(within(again).getByRole("button", { name: "More details" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the Notes box above the Add treatment form, and a status of Planned / In progress / Done", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: notesApi().wrap });
    const panel = await pick(user, 26);
    const start = screen.queryByRole("button", { name: "Start visit" });
    if (start !== null) await user.click(start);
    await user.click(await within(panel).findByRole("button", { name: "Add treatment" }));
    expect(within(panel).getByRole("textbox", { name: "Notes" })).toBeTruthy();
    const status = within(panel).getByRole("group", { name: "Status" });
    expect(within(status).getAllByRole("button").map((b) => b.textContent)).toEqual(["Planned", "In progress", "Done"]);
    expect(within(status).getByRole("button", { name: "Planned" }).getAttribute("aria-pressed")).toBe("true");
    const result = await axe.run(panel, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("changes a planned treatment's status from its row, with no form", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend, wrap: notesApi().wrap });
    const panel = await pick(user, 46);
    const start = screen.queryByRole("button", { name: "Start visit" });
    if (start !== null) await user.click(start);
    await user.click(await within(panel).findByRole("button", { name: "Add treatment" }));
    await user.click(within(panel).getByRole("button", { name: "Crown" }));
    await user.click(within(panel).getByRole("button", { name: "Save treatment" }));
    const chip = await within(panel).findByRole("button", { name: /^Status of Crown: Planned/ });
    await user.click(chip);
    await user.click(within(within(panel).getByRole("group", { name: "Change status of Crown" })).getByRole("button", { name: "Done" }));
    expect(within(panel).queryByRole("form")).toBeNull();
    expect(await within(panel).findByText("Completed")).toBeTruthy();
  });
});
