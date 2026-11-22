import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { historyVisit } from "@aarogyam/api-client";
import type { Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";
import { matches, NO_FILTER } from "./history-model.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The seeded patient with one closed visit: a signed note, a filling on 46, a prescription. */
function visited(tweak?: (fixtures: Fixtures) => void) {
  let path = "";
  let visitId = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/patients/${visit?.patient_id ?? ""}`;
    visitId = visit?.id ?? "";
    tweak?.(fixtures);
  });
  return { path, visitId, backend };
}

const cards = () => screen.getAllByRole("button", { name: /^(Open|Close) visit / });

describe("The full-page history", () => {
  it("shows each visit as a rich card: teeth, note line and medicines, with no axe violations", async () => {
    const { path, backend } = visited();
    renderPortal(`${path}/history`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("heading", { level: 1, name: "History" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Visits" });
    const teeth = await within(list).findAllByRole("list", { name: "Teeth" });
    expect(teeth[0]?.textContent).toMatch(/46/);
    expect(within(list).getAllByText(/AMOXICILLIN|Amoxicillin/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/visits? · newest first/)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Jump to month" })).toBeTruthy();
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  it("filters by chip and finds words, and says so kindly when nothing matches", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(`${path}/history`, { as: PEOPLE.asha, backend });
    await screen.findByRole("list", { name: "Visits" });
    const all = cards().length;
    await user.click(screen.getByRole("button", { name: /^Medicines/ }));
    expect(screen.getByRole("button", { name: /^Medicines/ }).getAttribute("aria-pressed")).toBe("true");
    expect(cards().length).toBeLessThanOrEqual(all);
    await user.click(screen.getByRole("button", { name: /^Medicines/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search the history" }), "amoxi");
    expect(cards().length).toBeGreaterThan(0);
    expect(document.querySelector("mark")?.textContent.toLowerCase()).toBe("amoxi");
    await user.clear(screen.getByRole("searchbox", { name: "Search the history" }));
    await user.type(screen.getByRole("searchbox", { name: "Search the history" }), "no such words");
    expect(await screen.findByText("No visit has that")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(cards().length).toBe(all);
  });

  it("expands a visit in place and closes it again; Esc closes it first, then returns to the patient", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(`${path}/history`, { as: PEOPLE.asha, backend });
    await screen.findByRole("list", { name: "Visits" });
    const toggle = cards()[0];
    if (toggle === undefined) throw new Error("no visit");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    const detail = await screen.findByRole("region", { name: /^Visit .* detail$/ });
    expect(await within(detail).findByRole("region", { name: "Treatments" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Close visit / }).getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /^Visit .* detail$/ })).toBeNull();
    });
    await user.keyboard("{Escape}");
    const button = await screen.findByRole("button", { name: /^History/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });
  });

  it("Back returns to the patient page with focus on the History button", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(`${path}/history`, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Back to patient" }));
    const button = await screen.findByRole("button", { name: /^History/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });
  });

  it("works with the old look too: the route doesn't depend on the new patient page", async () => {
    localStorage.removeItem(NEW_LOOK_KEY);
    const { path, backend } = visited();
    renderPortal(`${path}/history`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("list", { name: "Visits" })).toBeTruthy();
  });

  it("hides money from a role without billing.read", async () => {
    const { path, backend } = visited((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "assistant", name: "Assistant", permissions: ["patients.read", "clinical.read", "appointments.read"] };
    });
    renderPortal(`${path}/history`, { as: PEOPLE.farah, backend });
    await screen.findByRole("heading", { level: 1, name: "History" });
    expect(screen.queryByRole("region", { name: "Money" })).toBeNull();
    expect(screen.queryByText(/ due$|^Paid ₹/)).toBeNull();
  });
});

describe("Opening the history", () => {
  it("the header's History button shows the visit count and opens the page", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const button = await screen.findByRole("button", { name: /^History/ });
    await waitFor(() => {
      expect(button.textContent).toMatch(/\d+ visits?/);
    });
    await user.click(button);
    expect(await screen.findByRole("heading", { level: 1, name: "History" })).toBeTruthy();
  });

  it("H opens it, but not while typing", async () => {
    const user = userEvent.setup();
    const { path, backend } = visited();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByRole("button", { name: /^History/ });
    const box = document.createElement("textarea");
    box.setAttribute("aria-label", "scratch");
    document.body.append(box);
    box.focus();
    await user.keyboard("h");
    expect(screen.queryByRole("heading", { level: 1, name: "History" })).toBeNull();
    box.remove();
    await user.keyboard("{Control>}h{/Control}");
    expect(screen.queryByRole("heading", { level: 1, name: "History" })).toBeNull();
    await user.keyboard("h");
    expect(await screen.findByRole("heading", { level: 1, name: "History" })).toBeTruthy();
  });
});

describe("History filters", () => {
  it("match on kind, doctor and words together", () => {
    const visit = historyVisit.parse({
      id: "v1",
      number: "V-1",
      status: "closed",
      started_at: "2026-11-14T12:10:00Z",
      clinician: { id: "m1", name: "Dr Dev Rao" },
      teeth: [{ tooth: 26, finding: "caries", work: "found" }],
      images: [],
      image_count: 0,
      note_first_line: "Old filling leaking",
      medicines: ["Potassium nitrate toothpaste"],
      plans: [],
      counts: { notes: 1, recordings: 0, files: 0, procedures: 0 },
    });
    expect(matches(visit, NO_FILTER)).toBe(true);
    expect(matches(visit, { ...NO_FILTER, q: "nitrate" })).toBe(true);
    expect(matches(visit, { ...NO_FILTER, q: "26" })).toBe(true);
    expect(matches(visit, { ...NO_FILTER, kinds: new Set(["bills"]) })).toBe(false);
    expect(matches(visit, { ...NO_FILTER, kinds: new Set(["bills", "medicines"]) })).toBe(true);
    expect(matches(visit, { ...NO_FILTER, doctor: "m2" })).toBe(false);
  });
});
