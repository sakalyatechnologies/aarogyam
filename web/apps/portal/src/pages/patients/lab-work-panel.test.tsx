import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtures } from "@aarogyam/api-client/fake";

import { layoutKey } from "./v2/use-layout.js";
import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
  localStorage.setItem(layoutKey(PEOPLE.asha), "console");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const fixtures = createFixtures({ now: NOW });
const clinicId = fixtures.clinics[0]?.id;
// The seed sends the first patients' work to the labs, in order (LAB-9 is the first patient's).
const first = fixtures.patients.find((p) => p.clinic_id === clinicId);

describe("Patient 360: lab work", () => {
  it("lists the patient's cases with their tracker, and links to the order on the Lab work page", async () => {
    const user = userEvent.setup();
    if (first === undefined) throw new Error("no patient");
    renderPortal(`/patients/${first.id}`, { as: PEOPLE.asha });
    await user.click(await screen.findByRole("tab", { name: "Records" }));
    await user.click(await screen.findByRole("tab", { name: "Lab work" }));
    const link = await screen.findByRole("link", { name: "LAB-9" });
    expect(screen.getByText(/Zirconia crown/)).toBeTruthy();
    expect(link.getAttribute("href")).toMatch(/^\/labs\?order=/);
  });

  it("sends a case for this patient without asking who it is for", async () => {
    const user = userEvent.setup();
    if (first === undefined) throw new Error("no patient");
    renderPortal(`/patients/${first.id}`, { as: PEOPLE.asha });
    await user.click(await screen.findByRole("tab", { name: "Records" }));
    await user.click(await screen.findByRole("tab", { name: "Lab work" }));
    await user.click(await screen.findByRole("button", { name: "Send to lab" }));
    const dialog = await screen.findByRole("dialog", { name: "Send work to a lab" });
    expect(within(dialog).getByText(first.number, { exact: false })).toBeTruthy();
  });

  it("has no Lab work tab for a role without labs.read", async () => {
    const user = userEvent.setup();
    if (first === undefined) throw new Error("no patient");
    const backend = fakeApi((f) => {
      const m = f.memberships.find((x) => x.user_id === PEOPLE.asha);
      if (m !== undefined) m.role = { ...m.role, permissions: m.role.permissions.filter((p) => p !== "labs.read" && p !== "labs.write") };
    });
    renderPortal(`/patients/${first.id}`, { as: PEOPLE.asha, backend });
    await screen.findByRole("tab", { name: "Records" });
    await user.click(screen.getByRole("tab", { name: "Records" }));
    await screen.findByRole("tab", { name: "Consent" });
    expect(screen.queryByRole("tab", { name: "Lab work" })).toBeNull();
  });
});
