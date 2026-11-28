import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiFailure, prescriptionId, type FinishVisitInput } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { FOLLOW_UPS, allergyAlertsOf, dateAfter, finishErrorMessage, finishVisit, type FinishDeps } from "./finish-visit.js";
import { layoutKey, type P360Layout } from "./use-layout.js";
import { handoff } from "./whatsapp-summary.js";

/** The first "Start visit" button on the page (the blocks and the bar each offer one). */
async function firstStart(): Promise<HTMLElement> {
  const [first] = await screen.findAllByRole("button", { name: "Start visit" });
  if (first === undefined) throw new Error("no Start visit button");
  return first;
}

/** After End visit the bar offers payment; sending it for payment opens the celebration. */
async function sendForPayment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Send for payment" }));
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
    const { path, backend, number } = visitedPatient();
    choose(layout);
    renderPortal(path, { as: PEOPLE.asha, backend });

    const summary = await screen.findByRole("region", { name: "Patient summary" });
    expect(await within(summary).findByText(number)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Dental chart" })).toBeTruthy();

    // Records: one card with small tabs, reached directly, from the toolbar, or from a tab, depending on the layout.
    if (layout === "stage") {
      await user.click(within(screen.getByRole("toolbar", { name: "Open a panel" })).getByRole("button", { name: "Records" }));
    } else {
      await user.click(screen.getByRole("tab", { name: "Records" }));
    }
    const records = await screen.findByRole("heading", { level: 2, name: "Records" });
    const card = records.closest("section");
    if (card === null) throw new Error("the Records card is missing");
    expect(within(card).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Plans", "Prescriptions", "Images", "Lab work", "Consent"]);
    // The visits live on the history page, one click away.
    expect((await screen.findByRole("button", { name: /^History/, hidden: true })).textContent).toMatch(/\d+ visits?/);

    // Consent is a tab of the same card.
    await user.click(within(card).getByRole("tab", { name: "Consent" }));
    expect(await screen.findByText("No consent recorded yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record consent" })).toBeTruthy();
  });

  it.each(LAYOUTS)("%s shows the allergy as a tag in the header", async (layout) => {
    const { path, backend } = allergicPatient();
    choose(layout);
    renderPortal(path, { as: PEOPLE.asha, backend });
    const summary = await screen.findByRole("region", { name: "Patient summary" });
    expect((await within(summary).findByRole("status", { name: "Allergies" })).textContent).toMatch(/Allergy: .*Penicillin/);
  });
});

describe("The layout choice", () => {
  it("is not on the patient page, and the layout chosen in My profile still applies", async () => {
    const { path, backend } = visitedPatient();
    choose("tabs");
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("tablist", { name: "Patient record" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Layout" })).toBeNull();
  });

  it("is remembered per person from My profile, and still works when storage is blocked", async () => {
    const user = userEvent.setup();
    renderPortal("/settings", { as: PEOPLE.asha });
    const group = await screen.findByRole("radiogroup", { name: "Patient page layout" });
    expect(within(group).getByRole("radio", { name: "Console" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(group).getByRole("radio", { name: "Tabs + ribbon" }));
    expect(localStorage.getItem(layoutKey(PEOPLE.asha))).toBe("tabs");
    expect(localStorage.getItem(layoutKey(PEOPLE.dev))).toBeNull();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await user.click(within(group).getByRole("radio", { name: "Stage + drawers" }));
    expect(within(group).getByRole("radio", { name: "Stage + drawers" }).getAttribute("aria-checked")).toBe("true");
    spy.mockRestore();
  });
});

describe("The account menu", () => {
  it("has no New look switch", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByRole("region", { name: "Patient summary" });
    await user.click(screen.getByRole("button", { name: /^Account:/ }));
    expect(screen.queryByRole("switch", { name: /New look/ })).toBeNull();
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
    expect(await screen.findByRole("tab", { name: "Consent" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
    expect(await screen.findByText("No consent recorded yet")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Dental chart" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Prescription" })).toBeNull();
    expect(screen.queryByText("Billing", { selector: "summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End visit" })).toBeNull();
  });

  it("shows the owner the chart, the prescription block, billing and the pinned bar", async () => {
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { name: "Dental chart" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Prescription" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Billing" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Visit actions" })).toBeTruthy();
  });
});

describe("A visit, from the new Patient 360", () => {
  it("takes a quick pick into the note, ends the visit, sends it for payment and celebrates", async () => {
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
    await user.click(screen.getByRole("button", { name: "End visit" }));
    await sendForPayment(user);

    const dialog = await screen.findByRole("dialog", { name: "Visit completed" });
    expect(within(dialog).getByText(/closed and the note signed/)).toBeTruthy();
    expect(within(dialog).getByText(/follow-up in 2 weeks/)).toBeTruthy();
    // The patient's summary goes from the doctor's own WhatsApp: the full text through WhatsApp Desktop, only the
    // short text (no clinical words) through a WhatsApp Web URL. The screen says "prepared", never "sent".
    const opened: string[] = [];
    const copied: string[] = [];
    const { open, copy } = handoff;
    handoff.open = (url) => {
      opened.push(url);
    };
    handoff.copy = (text) => {
      copied.push(text);
      return Promise.resolve();
    };
    try {
      // The ticks are on the Done screen with a live preview, but Send stays one tap.
      const ticks = await within(dialog).findByRole("group", { name: "What goes in the message" });
      for (const box of within(ticks).getAllByRole("checkbox")) {
        expect(box).toHaveProperty("checked", true);
      }
      expect((await within(dialog).findByTestId("message-preview")).textContent).toContain("XXXXXX");
      await user.click(within(dialog).getByRole("button", { name: "Send on WhatsApp" }));
      expect(await within(dialog).findByText(/Summary prepared/)).toBeTruthy();
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatch(/^whatsapp:\/\/send\?phone=\d+&text=.*Done%20today/);
      const web = within(dialog).getByRole("link", { name: "Use WhatsApp Web" }).getAttribute("href") ?? "";
      expect(web).toMatch(/^https:\/\/web\.whatsapp\.com\/send\?phone=\d+&text=/);
      expect(decodeURIComponent(web)).not.toMatch(/Done today/);
      // WhatsApp Web gets the full text by paste: "Copy full summary" puts it on this computer's clipboard only.
      await user.click(within(dialog).getByRole("button", { name: "Copy full summary" }));
      expect(copied).toHaveLength(1);
      expect(copied[0]).toMatch(/Done today/);
      expect(await within(dialog).findByText(/Copied\. Paste it/)).toBeTruthy();
      expect(within(dialog).queryByText(/sent/i)).toBeNull();
    } finally {
      handoff.open = open;
      handoff.copy = copy;
    }
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Visit completed" })).toBeNull();
    });
    // The visit is closed on the server: the bar offers to start another.
    expect((await screen.findAllByRole("button", { name: "Start visit" })).length).toBeGreaterThan(0);
  });

  it("says there is no connection and does not end the visit offline, and never claims a save", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await firstStart());
    const finish = await screen.findByRole("button", { name: "End visit" });
    expect(finish).toHaveProperty("disabled", false);

    const online = vi.spyOn(globalThis.navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(/No connection/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "End visit" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/saved on this device/i)).toBeNull();
    online.mockRestore();
    act(() => {
      globalThis.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "End visit" })).toHaveProperty("disabled", false);
    });
  });

  it("offers Gujarati beside the other dictation languages", async () => {
    const user = userEvent.setup();
    const { path, backend } = visitedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await firstStart());
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
    // Nothing here edits or deletes an entry in place: Edit (in the tooth panel) records a correction that supersedes it.
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
    await user.click(await screen.findByRole("button", { name: "End visit" }));
    await sendForPayment(user);
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
  await screen.findAllByPlaceholderText("Medicine name");
  if (allergic) {
    await user.click(screen.getByRole("button", { name: "Add free-text medicine" }));
    const last = screen.getAllByPlaceholderText("Medicine name").at(-1);
    if (last === undefined) throw new Error("no medicine row");
    await user.type(last, "PENICILLIN V");
  }
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
    await user.click(screen.getByRole("button", { name: "End visit" }));
    await user.click(await screen.findByRole("button", { name: "Issue and end" }));
    await sendForPayment(user);

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
    await user.click(screen.getByRole("button", { name: "End visit" }));
    await user.click(await screen.findByRole("button", { name: "Issue and end" }));

    expect(await screen.findByRole("heading", { name: "Allergy alert" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Visit completed" })).toBeNull();
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /issue anyway and end/i });
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/reason to override/i), "Patient confirmed no reaction on the last course");
    await user.click(confirm);
    await sendForPayment(user);

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
    await user.click(await screen.findByRole("button", { name: "End visit" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => /already closed.*Reload the patient/.test(a.textContent))).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Visit completed" })).toBeNull();
  });
});
