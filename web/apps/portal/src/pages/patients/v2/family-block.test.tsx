import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { layoutKey } from "./use-layout.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
  // Tabs layout shows the Details card (with Family) on the first screen.
  localStorage.setItem(layoutKey(PEOPLE.asha), "console");
  localStorage.setItem(layoutKey(PEOPLE.farah), "console");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function twoPatients(prepare: (fixtures: Fixtures, ids: { a: string; b: string }) => void = () => undefined) {
  const ids: { a: string; b: string; aName: string; bName: string } = { a: "", b: "", aName: "", bName: "" };
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const [a, b] = fixtures.patients.filter((p) => p.clinic_id === sunrise?.id);
    if (a === undefined || b === undefined) throw new Error("need two patients");
    ids.a = a.id;
    ids.b = b.id;
    ids.aName = a.full_name;
    ids.bName = b.full_name;
    prepare(fixtures, ids);
  });
  return { ids, backend };
}

const RULES = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

async function familyBlock() {
  // Clinical members reach Details under its tab; others see it directly.
  // Wait for the page (either the tabs or the block itself), then open the tab if there is one.
  await waitFor(() => {
    if (screen.queryByRole("tab", { name: "Details & flags" }) === null && screen.queryByRole("heading", { name: "Family" }) === null) throw new Error("page not ready");
  }, { timeout: 10_000 });
  const tab = screen.queryByRole("tab", { name: "Details & flags" });
  if (tab !== null) await userEvent.click(tab);
  const heading = await screen.findByRole("heading", { name: "Family" }, { timeout: 10_000 });
  const block = heading.closest("section");
  if (block === null) throw new Error("no family block");
  return block;
}

describe("Patient 360 Family block", () => {
  it("shows the empty state, adds a relative, lists them as a link, then removes with a confirm", async () => {
    const user = userEvent.setup();
    const { ids, backend } = twoPatients();
    renderPortal(`/patients/${ids.a}`, { as: PEOPLE.asha, backend });
    const block = await familyBlock();
    expect(await within(block).findByText("No family linked yet.")).toBeTruthy();

    await user.click(within(block).getByRole("button", { name: /Add family/ }));
    await user.type(within(block).getByLabelText("Find a patient"), ids.bName.slice(0, 4));
    await user.click(within(block).getByRole("button", { name: "Sibling" }));
    await user.click(await within(block).findByRole("button", { name: new RegExp(`${ids.bName}.*Add as sibling`) }));

    const link = await within(block).findByRole("link", { name: ids.bName });
    expect(link.getAttribute("href")).toBe(`/patients/${ids.b}`);
    expect(within(block).getByText("Sibling")).toBeTruthy();
    const result = await axe.run(block, RULES);
    expect(result.violations.map((v) => v.id)).toEqual([]);

    await user.click(within(block).getByRole("button", { name: `Remove ${ids.bName}` }));
    const confirm = await screen.findByRole("dialog", { name: "Remove family link?" });
    await user.click(within(confirm).getByRole("button", { name: "Keep" }));
    expect(within(block).queryByText("No family linked yet.")).toBeNull();
    await user.click(within(block).getByRole("button", { name: `Remove ${ids.bName}` }));
    await user.click(within(await screen.findByRole("dialog", { name: "Remove family link?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(within(block).getByText("No family linked yet.")).toBeTruthy();
    });
  });

  it("lists existing family but offers no add or remove without patients.write", async () => {
    const { ids, backend } = twoPatients((fixtures, ids) => {
      const farah = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (farah === undefined) throw new Error("no farah");
      farah.role = { key: "custom", name: "Custom", permissions: ["patients.read"] };
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      (fixtures.patientRelations ??= []).push({
        id: "f0f0f0f0-0000-4000-8000-000000000001",
        clinic_id: sunrise?.id ?? "",
        patient_id: ids.a,
        related_patient_id: ids.b,
        relation: "spouse",
        is_primary_contact: false,
      });
    });
    renderPortal(`/patients/${ids.a}`, { as: PEOPLE.farah, backend });
    const block = await familyBlock();
    expect(await within(block).findByRole("link", { name: ids.bName })).toBeTruthy();
    expect(within(block).queryByRole("button", { name: /Add family/ })).toBeNull();
    expect(within(block).queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
});
