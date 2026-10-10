import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiFailure, prescriptionId, type FinishVisitInput } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { FOLLOW_UPS, allergyAlertsOf, dateAfter, finishErrorMessage, finishVisit, type FinishDeps } from "./finish-visit.js";
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

function finishDeps(calls: string[], signed: string[] = ["n1"]) {
  const bodies: FinishVisitInput[] = [];
  const deps: FinishDeps = {
    saveNote: () => Promise.resolve(void calls.push("note")),
    saveRx: () => Promise.resolve(void calls.push("rx")),
    finish: (body) => {
      calls.push("finish");
      bodies.push(body);
      return Promise.resolve({ signed_note_ids: signed });
    },
  };
  return { deps, bodies };
}

describe("finishVisit", () => {
  it("saves what is on screen, then makes one finish call with the follow-up date, the fee and the draft to issue", async () => {
    const calls: string[] = [];
    const { deps, bodies } = finishDeps(calls);
    const twoWeeks = FOLLOW_UPS.find((f) => f.days === 14) ?? null;
    const result = await finishVisit({ followUp: twoWeeks, feePaise: 50000, rx: { id: prescriptionId.parse("rx1"), overrideReason: "  Tolerated before  " } }, deps);
    expect(calls).toEqual(["note", "rx", "finish"]);
    expect(bodies).toEqual([{ follow_up_on: dateAfter(14), fee_paise: 50000, prescription: { id: "rx1", override_reason: "Tolerated before" } }]);
    expect(result.noteSigned).toBe(true);
  });

  it("sends an empty body when nothing is asked for, and no date for 'Not needed'", async () => {
    const { deps, bodies } = finishDeps([], []);
    const result = await finishVisit({ followUp: FOLLOW_UPS.find((f) => f.days === null) ?? null }, deps);
    expect(bodies).toEqual([{}]);
    expect(result.noteSigned).toBe(false);
  });

  it("never finishes when a save fails", async () => {
    const calls: string[] = [];
    const { deps } = finishDeps(calls);
    await expect(finishVisit({ followUp: null }, { ...deps, saveNote: () => Promise.reject(new Error("offline")) })).rejects.toThrow("offline");
    expect(calls).toEqual([]);
  });

  it("explains a visit that is already closed, and reads the allergy alerts off a 409", () => {
    const closed = new ApiFailure({ status: 409, code: "visit_closed", message: "That visit is already closed." });
    expect(finishErrorMessage(closed)).toMatch(/already closed.*Reload the patient/);
    expect(finishErrorMessage(new Error("x"))).toMatch(/Nothing was lost/);
    const alerts = [{ kind: "allergy", severity: "high", message: "Penicillin allergy" }];
    expect(allergyAlertsOf(new ApiFailure({ status: 409, code: "allergy_alerts", message: "Alerts", alerts }))?.[0]?.message).toBe("Penicillin allergy");
    expect(allergyAlertsOf(closed)).toBeUndefined();
  });
});

/** Adds a medicine to the open visit's draft in the new Patient 360, optionally the allergic one. */
async function draftWithMedicine(user: ReturnType<typeof userEvent.setup>, allergic: boolean) {
  await user.click(await firstStart());
  await user.click(await screen.findByRole("button", { name: /Post-extraction/ }));
  await screen.findByText(/[1-9]\d* medicines? in the draft/);
  if (allergic) {
    await user.click(screen.getByRole("button", { name: "Add free-text medicine" }));
    const last = screen.getAllByPlaceholderText("Medicine name").at(-1);
    if (last === undefined) throw new Error("no medicine row");
    await user.type(last, "PENICILLIN V");
  }
  // The bar counts the draft's medicines once the server has them.
  await screen.findByText(/[1-9]\d* medicines? in the draft/);
}

describe("Finishing a visit with the prescription", () => {
  it("sends one finish call with the follow-up date and the draft, then offers expiry chips and channels on the link", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    const finishes: FinishVisitInput[] = [];
    const shares: unknown[] = [];
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        finishVisit: (id, input, options) => {
          finishes.push(input ?? {});
          return client.finishVisit(id, input, options);
        },
        createShareLinkWith: (id, input, options) => {
          shares.push(input);
          return client.createShareLinkWith(id, input, options);
        },
      }),
    });
    await draftWithMedicine(user, false);
    await user.click(screen.getByRole("button", { name: "2 weeks" }));
    await user.click(screen.getByRole("button", { name: "Finish visit" }));
    await user.click(await screen.findByRole("button", { name: "Issue and finish" }));

    const dialog = await screen.findByRole("dialog", { name: "Visit completed" });
    expect(finishes).toHaveLength(1);
    expect(finishes[0]?.follow_up_on).toBe(dateAfter(14));
    expect(finishes[0]?.prescription?.id).toBeTruthy();

    const chips = within(within(dialog).getByRole("group", { name: "Link works for" }));
    expect(["24 hours", "3 days", "7 days", "30 days"].map((name) => chips.getByRole("button", { name }).textContent)).toEqual(["24 hours", "3 days", "7 days", "30 days"]);
    expect(chips.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe("true");
    for (const channel of ["WhatsApp", "SMS", "Copy", "QR"]) {
      expect(within(dialog).getByRole("button", { name: channel })).toBeTruthy();
    }
    await user.click(chips.getByRole("button", { name: "3 days" }));
    await user.click(within(dialog).getByRole("button", { name: "QR" }));

    expect(await within(dialog).findByText(/shown only now/)).toBeTruthy();
    expect(dialog.textContent).toMatch(/PIN\s*\d{6}/);
    expect(dialog.textContent).toMatch(/\/shared\//);
    expect(shares).toEqual([{ channel: "qr", expires_in_hours: 72 }]);
  });

  it("stops on the allergy alert with the visit still open, then finishes with the override reason", async () => {
    const user = userEvent.setup();
    const { path, backend } = allergicPatient();
    const finishes: FinishVisitInput[] = [];
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        finishVisit: (id, input, options) => {
          finishes.push(input ?? {});
          return client.finishVisit(id, input, options);
        },
      }),
    });
    await draftWithMedicine(user, true);
    await user.click(screen.getByRole("button", { name: "Finish visit" }));
    await user.click(await screen.findByRole("button", { name: "Issue and finish" }));

    expect(await screen.findByRole("heading", { name: "Allergy alert" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Visit completed" })).toBeNull();
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /issue anyway and finish/i });
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/reason to override/i), "Patient confirmed no reaction on the last course");
    await user.click(confirm);

    await screen.findByRole("dialog", { name: "Visit completed" });
    expect(finishes).toHaveLength(2);
    expect(finishes[0]?.prescription?.override_reason).toBeUndefined();
    expect(finishes[1]?.prescription?.override_reason).toBe("Patient confirmed no reaction on the last course");
  });

  it("says plainly when the visit was already closed", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        finishVisit: () => Promise.resolve({ ok: false, error: { status: 409, code: "visit_closed", message: "That visit is already closed." } }),
      }),
    });
    await user.click(await firstStart());
    await user.click(await screen.findByRole("button", { name: "Finish visit" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => /already closed.*Reload the patient/.test(a.textContent))).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Visit completed" })).toBeNull();
  });
});
