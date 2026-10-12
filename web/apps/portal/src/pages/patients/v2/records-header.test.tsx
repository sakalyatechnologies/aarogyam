import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { SHOW_MONEY_KEY } from "../../today/v2/money.js";
import { layoutKey, type P360Layout } from "./use-layout.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error("nothing found");
  return head;
}

const LAYOUTS: readonly P360Layout[] = ["console", "stage", "tabs"];

/** The seeded patient with one closed visit (a note, a filling on 46, a prescription); `tweak` can empty it or change a role. */
function visited(tweak?: (fixtures: Fixtures) => void) {
  let path = "";
  let number = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    const patient = fixtures.patients.find((p) => p.id === visit?.patient_id);
    path = `/patients/${patient?.id ?? ""}`;
    number = patient?.number ?? "";
    tweak?.(fixtures);
  });
  return { path, number, backend };
}

async function openRecords(user: ReturnType<typeof userEvent.setup>, layout: P360Layout) {
  if (layout === "stage") await user.click(within(await screen.findByRole("toolbar", { name: "Open a panel" })).getByRole("button", { name: "Records" }));
  if (layout === "tabs") await user.click(await screen.findByRole("tab", { name: "Records" }));
  const heading = await screen.findByRole("heading", { level: 2, name: "Records" });
  const card = heading.closest("section");
  if (card === null) throw new Error("the Records card is missing");
  return card;
}

describe("Records: one card, small tabs", () => {
  it.each(LAYOUTS)("%s switches between History, Plans, Prescriptions, Images and Consent", async (layout) => {
    const user = userEvent.setup();
    localStorage.setItem(layoutKey(PEOPLE.asha), layout);
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const card = await openRecords(user, layout);

    expect(within(card).getAllByRole("tab").map((t) => t.textContent)).toEqual(["History", "Plans", "Prescriptions", "Images", "Consent"]);
    expect(within(card).getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect((await within(card).findAllByRole("button", { name: /^Open visit / })).length).toBeGreaterThan(0);

    await user.click(within(card).getByRole("tab", { name: "Prescriptions" }));
    expect(within(card).getByRole("tab", { name: "Prescriptions" }).getAttribute("aria-selected")).toBe("true");
    expect(await within(card).findByRole("list", { name: "Past prescriptions" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^Open visit / })).toBeNull();

    await user.click(within(card).getByRole("tab", { name: "Images" }));
    expect(await within(card).findByRole("button", { name: "Add X-ray or photo" })).toBeTruthy();
    await user.click(within(card).getByRole("tab", { name: "Consent" }));
    expect(await within(card).findByText("No consent recorded yet")).toBeTruthy();
    await user.click(within(card).getByRole("tab", { name: "Plans" }));
    expect(within(card).getByRole("tab", { name: "Plans" }).getAttribute("aria-selected")).toBe("true");
  });

  it("is the only card besides the chart, Today and Wrap up (which is there only while a visit is open)", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { level: 2, name: "Records" });
    // "Procedures" is the heading of the list inside Done today, not a block of its own; the folds under More are closed.
    const titles = () => screen.getAllByRole("heading", { level: 2 }).filter((h) => h.closest("details") === null).map((h) => h.textContent).filter((text) => text !== "Procedures");
    expect(titles()).toEqual(["Dental chart", "Records", "Today"]);
    expect(screen.queryByText("Visit history", { selector: "summary" })).toBeNull();
    expect(screen.queryByText("Past prescriptions", { selector: "summary" })).toBeNull();
    await user.click(first(await screen.findAllByRole("button", { name: "Start visit" })));
    await screen.findByRole("heading", { level: 2, name: "Wrap up" });
    expect(titles()).toEqual(["Dental chart", "Records", "Today", "Wrap up"]);
  });

  it("opens in the Prescriptions tab from ?tab=prescriptions", async () => {
    const { path, backend } = visited();
    renderPortal(`${path}?tab=prescriptions`, { as: PEOPLE.asha, backend });
    const heading = await screen.findByRole("heading", { level: 2, name: "Records" });
    const card = heading.closest("section");
    if (card === null) throw new Error("the Records card is missing");
    expect(within(card).getByRole("tab", { name: "Prescriptions" }).getAttribute("aria-selected")).toBe("true");
  });

  it("has no axe violations with the Records card on each tab", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const card = await openRecords(user, "console");
    for (const name of ["History", "Plans", "Prescriptions", "Images", "Consent"]) {
      await user.click(within(card).getByRole("tab", { name }));
      await waitFor(() => {
        expect(card.querySelector('[role="tabpanel"]')?.textContent.length ?? 0).toBeGreaterThan(0);
      });
      const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(result.violations.map((v) => `${name} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  });
});

describe("Visit detail shows what was done", () => {
  it("lists the treatments with their tooth, the notes, the prescription items and the images", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const card = await openRecords(user, "console");
    await user.click(first(await within(card).findAllByRole("button", { name: /^Open visit / })));
    const detail = await screen.findByRole("dialog", { name: /^Visit / });

    const treatments = await within(detail).findByRole("region", { name: "Treatments" });
    expect(await within(treatments).findByText("Filling")).toBeTruthy();
    expect(within(treatments).getAllByText("Tooth 46").length).toBeGreaterThan(0);
    expect(within(treatments).getByText(/Distal/)).toBeTruthy();
    expect(await within(detail).findByText(/Pain on chewing/)).toBeTruthy();
    const rx = within(detail).getByRole("region", { name: "Prescriptions" });
    expect(await within(rx).findByText(/AMOXICILLIN|Amoxicillin/i)).toBeTruthy();
    expect(within(detail).getByRole("region", { name: "Images" })).toBeTruthy();
    expect(within(detail).getByRole("region", { name: "Payment" })).toBeTruthy();
    expect(within(detail).queryByText("Nothing was recorded in this visit")).toBeNull();
  });

  it("opens from a timeline event too, so 'Visit closed' is never a dead end", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const card = await openRecords(user, "console");
    const link = first(await within(card).findAllByRole("button", { name: /^Show what was done/ }));
    await user.click(link);
    const detail = await screen.findByRole("dialog", { name: /^Visit / });
    expect(await within(detail).findByRole("region", { name: "Treatments" })).toBeTruthy();
  });

  it("shows voice notes with their time, one line each", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited((fixtures) => {
      const note = fixtures.notes[0];
      if (note !== undefined) note.sections = { ...note.sections, subjective: "[10:05] Pain on the right side\n[10:12] Sensitive to cold" };
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    const card = await openRecords(user, "console");
    await user.click(first(await within(card).findAllByRole("button", { name: /^Open visit / })));
    const detail = await screen.findByRole("dialog", { name: /^Visit / });
    const list = await within(detail).findByRole("list", { name: "Voice notes" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["10:05Pain on the right side", "10:12Sensitive to cold"]);
  });

  it("says warmly that nothing was recorded when the visit is empty", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited((fixtures) => {
      fixtures.notes = [];
      fixtures.chartEntries = [];
      fixtures.prescriptions = [];
      fixtures.procedures = [];
      fixtures.invoices = [];
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    const card = await openRecords(user, "console");
    await user.click(first(await within(card).findAllByRole("button", { name: /^Open visit / })));
    const detail = await screen.findByRole("dialog", { name: /^Visit / });
    expect(await within(detail).findByText("Nothing was recorded in this visit")).toBeTruthy();
  });
});

describe("The patient header", () => {
  it("shows contact, date of birth, file number and the care stats, with money hidden by default behind the eye", async () => {
    const user = userEvent.setup();
    const { path, number, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const summary = await screen.findByRole("region", { name: "Patient summary" });
    const facts = await within(summary).findByRole("group", { name: "Contact and care" });
    for (const label of ["Mobile", "Email", "Date of birth", "File number", "Visits", "Last visit", "Next appointment", "Collected", "Pending"]) {
      expect(within(facts).getByText(label), label).toBeTruthy();
    }
    expect(within(facts).getByText(number)).toBeTruthy();
    await waitFor(() => {
      expect(within(facts).getByText("Visits").nextElementSibling?.textContent).toMatch(/^\d+$/);
    });
    // Hidden until the eye is opened, and remembered in the same setting as Today.
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBeNull();
    expect(within(facts).getByText("Collected").nextElementSibling?.textContent).toBe("₹ ••••");
    expect(within(facts).getByText("Pending").nextElementSibling?.textContent).toContain("₹ ••••");
    await user.click(within(facts).getByRole("button", { name: "Show patient money" }));
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBe("1");
    expect(within(facts).getByText("Collected").nextElementSibling?.textContent).not.toContain("••••");
    await user.click(within(facts).getByRole("button", { name: "Hide patient money" }));
    expect(within(facts).getByText("Collected").nextElementSibling?.textContent).toBe("₹ ••••");
  });

  it("shows no money and no eye without billing.read, but still the contacts and visit stats", async () => {
    localStorage.setItem(SHOW_MONEY_KEY, "1");
    const { path, backend } = visited((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "assistant", name: "Assistant", permissions: ["patients.read", "patients.contact", "clinical.read", "appointments.read"] };
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    const summary = await screen.findByRole("region", { name: "Patient summary" });
    const facts = await within(summary).findByRole("group", { name: "Contact and care" });
    expect(within(facts).getByText("Mobile")).toBeTruthy();
    expect(within(facts).getByText("Visits")).toBeTruthy();
    expect(within(facts).queryByText("Collected")).toBeNull();
    expect(within(facts).queryByText("Pending")).toBeNull();
    expect(within(summary).queryByRole("button", { name: /patient money/ })).toBeNull();
    expect(summary.textContent).not.toMatch(/₹/);
  });
});

describe("The patients directory", () => {
  it("shows the mobile number and the last visit on every row", async () => {
    const { backend } = visited();
    renderPortal("/patients", { as: PEOPLE.asha, backend });
    const table = await screen.findByRole("table", { name: "Patients" });
    expect(within(table).getByRole("columnheader", { name: "Mobile" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: /Last visit/ })).toBeTruthy();
    const mobile = within(table).getAllByRole("columnheader").findIndex((h) => h.textContent === "Mobile");
    const cells = within(table).getAllByRole("row").slice(1).map((row) => row.querySelectorAll("th, td")[mobile]?.textContent ?? "");
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((text) => /\d{5}/.test(text))).toBe(true);
  });
});
