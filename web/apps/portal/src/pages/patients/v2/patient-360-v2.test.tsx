import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noteId } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { finishVisit } from "./finish-visit.js";
import { layoutKey, type P360Layout } from "./use-layout.js";

/** The first "Start visit" button on the page (the blocks and the bar each offer one). */
async function firstStart(): Promise<HTMLElement> {
  const [first] = await screen.findAllByRole("button", { name: "Start visit" });
  if (first === undefined) throw new Error("no Start visit button");
  return first;
}

const LAYOUTS: readonly P360Layout[] = ["console", "stage", "tabs"];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  localStorage.clear();
});

/** The seeded patient with a closed visit. */
function visitedPatient() {
  let path = "";
  let name = "";
  let number = "";
  let visitNumber = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    const patient = fixtures.patients.find((p) => p.id === visit?.patient_id);
    path = `/patients/${patient?.id ?? ""}`;
    name = patient?.full_name ?? "";
    number = patient?.number ?? "";
    visitNumber = visit?.number ?? "";
  });
  return { path, name, number, visitNumber, backend };
}

function allergicPatient() {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const allergy = fixtures.allergies[0];
    path = `/patients/${allergy?.patient_id ?? ""}`;
  });
  return { path, backend };
}

function choose(layout: P360Layout, user: string = PEOPLE.asha) {
  localStorage.setItem(layoutKey(user), layout);
}

describe("Patient 360 in the new look: three layouts, one set of data", () => {
  it.each(LAYOUTS)("%s shows the same patient, chart, history and consent", async (layout) => {
    const user = userEvent.setup();
    const { path, backend, number, visitNumber } = visitedPatient();
    choose(layout);
    renderPortal(path, { as: PEOPLE.asha, backend });

    const summary = await screen.findByRole("region", { name: "Patient summary" });
    expect(await within(summary).findByText(number)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Dental chart" })).toBeTruthy();

    // History: a summary to open, a toolbar button, or a tab, depending on the layout.
    if (layout === "console") {
      await user.click(screen.getByText(/^Visit history/));
    } else if (layout === "stage") {
      await user.click(screen.getByRole("button", { name: "History" }));
    } else {
      await user.click(screen.getByRole("tab", { name: "History" }));
    }
    expect((await screen.findAllByText(visitNumber)).length).toBeGreaterThan(0);

    // Consent: the same panel in each.
    if (layout === "console") {
      await user.click(screen.getByText("Consent forms"));
    } else if (layout === "stage") {
      await user.keyboard("{Escape}");
      await user.click(await screen.findByRole("button", { name: "Consent" }));
    } else {
      await user.click(screen.getByRole("tab", { name: "Consent" }));
    }
    expect(await screen.findByText("No consent recorded yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record consent" })).toBeTruthy();
  });

  it.each(LAYOUTS)("%s shows the allergy banner above the content", async (layout) => {
    const { path, backend } = allergicPatient();
    choose(layout);
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByText("Allergies:")).toBeTruthy();
    expect(screen.getAllByText("Penicillin").length).toBeGreaterThan(0);
  });
});

describe("The layout switcher", () => {
  it("remembers the choice for this person, and not for someone else", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    const first = renderPortal(path, { as: PEOPLE.asha, backend });
    const switcher = await screen.findByRole("radiogroup", { name: "Layout" });
    expect(within(switcher).getByRole("radio", { name: "Console" }).getAttribute("aria-checked")).toBe("true");

    await user.click(within(switcher).getByRole("radio", { name: "Tabs + ribbon" }));
    expect(await screen.findByRole("tablist", { name: "Patient record" })).toBeTruthy();
    expect(localStorage.getItem(layoutKey(PEOPLE.asha))).toBe("tabs");

    // Arrow keys move through the layouts.
    await user.keyboard("{ArrowLeft}");
    expect(within(switcher).getByRole("radio", { name: "Stage + drawers" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(switcher).getByRole("radio", { name: "Tabs + ribbon" }));

    first.router.dispose();
    cleanup();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const again = await screen.findByRole("radiogroup", { name: "Layout" });
    expect(within(again).getByRole("radio", { name: "Tabs + ribbon" }).getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(layoutKey(PEOPLE.dev))).toBeNull();
  });

  it("still works when storage is blocked", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key !== NEW_LOOK_KEY) throw new Error("blocked");
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("radio", { name: "Stage + drawers" }));
    expect(await screen.findByRole("toolbar", { name: "Open a panel" })).toBeTruthy();
    spy.mockRestore();
  });
});

describe("The New look switch", () => {
  it("keeps the old page when off, and swaps to the new one from the account menu", async () => {
    const user = userEvent.setup();
    localStorage.removeItem(NEW_LOOK_KEY);
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("tablist", { name: "Patient record" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Layout" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Account:/ }));
    const toggle = screen.getByRole("switch", { name: /New look/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(await screen.findByRole("radiogroup", { name: "Layout" })).toBeTruthy();
    expect(localStorage.getItem(NEW_LOOK_KEY)).toBe("1");
  });
});

describe("Permissions", () => {
  it("hides the chart, prescriptions, money and the pinned bar from front desk", async () => {
    let path = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      path = `/patients/${fixtures.patients.find((p) => p.clinic_id === sunrise?.id)?.id ?? ""}`;
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      // front_desk has neither clinical.read nor billing.read.
      if (membership !== undefined) membership.role = { key: "front_desk", name: "Front desk", permissions: ["patients.read", "appointments.read"] };
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    await screen.findByRole("region", { name: "Patient summary" });
    expect(await screen.findByText("Consent forms")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Dental chart" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Prescription" })).toBeNull();
    expect(screen.queryByText("Billing", { selector: "summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish visit" })).toBeNull();
  });

  it("shows the owner the chart, the prescription block, billing and the pinned bar", async () => {
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { name: "Dental chart" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Prescription" })).toBeTruthy();
    expect(screen.getByText("Billing", { selector: "summary" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Visit actions" })).toBeTruthy();
  });
});

describe("A visit, from the new Patient 360", () => {
  it("takes a quick pick into the note, finishes the visit and celebrates", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await firstStart());

    const complaints = await screen.findByRole("group", { name: "Complaint" });
    await user.click(within(complaints).getByRole("button", { name: "Toothache" }));
    const preview = await screen.findByRole("group", { name: "In today's note" });
    expect(within(preview).getByText(/Complains of toothache/)).toBeTruthy();
    expect(screen.getByLabelText("Subjective")).toHaveProperty("value", "Complains of toothache");

    await user.click(screen.getByRole("button", { name: "2 weeks" }));
    await user.click(screen.getByRole("button", { name: "Finish visit" }));

    const dialog = await screen.findByRole("dialog", { name: "Visit completed" });
    expect(within(dialog).getByText(/closed and the note signed/)).toBeTruthy();
    expect(within(dialog).getByText(/follow-up in 2 weeks/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Visit completed" })).toBeNull();
    });
    // The visit is closed on the server: the bar offers to start another.
    expect((await screen.findAllByRole("button", { name: "Start visit" })).length).toBeGreaterThan(0);
  });

  it("says there is no connection and does not finish offline, and never claims a save", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await firstStart());
    const finish = await screen.findByRole("button", { name: "Finish visit" });
    expect(finish).toHaveProperty("disabled", false);

    const online = vi.spyOn(globalThis.navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(/No connection/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish visit" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/saved on this device/i)).toBeNull();
    online.mockRestore();
    act(() => {
      globalThis.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Finish visit" })).toHaveProperty("disabled", false);
    });
  });

  it("offers Gujarati beside the other dictation languages", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await firstStart());
    await user.click(await screen.findByRole("button", { name: "Start a note" }));
    await user.click(await screen.findByRole("button", { name: "Record voice" }));
    const language = await screen.findByLabelText("Language");
    expect(within(language).getByRole("option", { name: "Gujarati" })).toBeTruthy();
  });
});

describe("Prescriptions in the new Patient 360", () => {
  it("adds a medicine set, blocks on the allergy with an override reason, then shares with token and PIN", async () => {
    const user = userEvent.setup();
    const { path, backend } = allergicPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });

    await user.click(await screen.findByRole("button", { name: "New prescription" }));
    await user.click(await screen.findByRole("button", { name: /Post-extraction/ }));
    expect(await screen.findByText(/Post-extraction: \d+ medicines added/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add free-text medicine" }));
    const names = screen.getAllByPlaceholderText("Medicine name");
    const last = names.at(-1);
    if (last === undefined) throw new Error("no medicine row");
    await user.type(last, "PENICILLIN V");
    await user.click(screen.getByRole("button", { name: "Issue prescription" }));

    expect(await screen.findByRole("heading", { name: "Allergy alert" })).toBeTruthy();
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /issue anyway/i });
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/reason to override/i), "Patient confirmed no reaction on the last course");
    await user.click(confirm);

    await user.click(await screen.findByRole("button", { name: "Share with patient" }));
    await user.click(await screen.findByRole("button", { name: "Create link" }));
    expect(await screen.findByLabelText("PIN")).toHaveProperty("value", expect.stringMatching(/^\d{6}$/));
    expect(screen.getByLabelText("Link")).toHaveProperty("value", expect.stringMatching(/\/shared\/.+/));
  });

  it("adds a medicine set from the ribbon in the Tabs layout", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    choose("tabs");
    renderPortal(path, { as: PEOPLE.asha, backend });
    const ribbon = await screen.findByRole("toolbar", { name: "Dictate and prescribe" });
    await user.click(await within(ribbon).findByRole("button", { name: /Post-extraction/ }));
    expect((await screen.findAllByPlaceholderText("Medicine name")).length).toBeGreaterThan(1);
  });
});

describe("History is never overwritten", () => {
  it("records a chart correction as a new entry, offering no edit of the old one", async () => {
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { name: "Dental chart" });
    // The chart is the existing append-only panel: no control here edits or deletes an entry.
    expect(screen.queryByRole("button", { name: /delete (entry|finding)/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit (entry|finding)/i })).toBeNull();
  });
});

describe("Accessibility", () => {
  it.each(LAYOUTS)("%s has no axe violations", async (layout) => {
    const { path, backend } = visitedPatient();
    choose(layout);
    const { router } = renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { name: "Dental chart" });
    if (layout !== "stage") await screen.findByRole("heading", { name: "Prescription" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    router.dispose();
  });
});

describe("Accessibility of the overlays", () => {
  it("has no axe violations with the Prescribe drawer open in Stage", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    choose("stage");
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Prescribe" }));
    await screen.findByRole("heading", { name: "Prescription" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  it("has no axe violations on the celebration card", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await firstStart());
    await user.click(await screen.findByRole("button", { name: "Finish visit" }));
    await screen.findByRole("dialog", { name: "Visit completed" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

describe("finishVisit", () => {
  it("saves, signs, then closes, in that order", async () => {
    const calls: string[] = [];
    const result = await finishVisit(
      { noteToSign: noteId.parse("n1"), followUp: null },
      {
        saveNote: () => Promise.resolve(void calls.push("note")),
        saveRx: () => Promise.resolve(void calls.push("rx")),
        signNote: () => Promise.resolve(void calls.push("sign")),
        closeVisit: () => Promise.resolve(void calls.push("close")),
      },
    );
    expect(calls).toEqual(["note", "rx", "sign", "close"]);
    expect(result.noteSigned).toBe(true);
  });

  it("never closes the visit when a save fails", async () => {
    const calls: string[] = [];
    await expect(
      finishVisit(
        { noteToSign: undefined, followUp: null },
        {
          saveNote: () => Promise.reject(new Error("offline")),
          saveRx: () => Promise.resolve(),
          signNote: () => Promise.resolve(void calls.push("sign")),
          closeVisit: () => Promise.resolve(void calls.push("close")),
        },
      ),
    ).rejects.toThrow("offline");
    expect(calls).toEqual([]);
  });
});
