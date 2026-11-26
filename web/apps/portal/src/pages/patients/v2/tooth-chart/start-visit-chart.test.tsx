import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";
import { layoutKey, type P360Layout } from "../use-layout.js";
import { chartPrefsKey } from "./use-chart-prefs.js";

const LAYOUTS: readonly P360Layout[] = ["console", "stage", "tabs"];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function adult() {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    path = `/patients/${visit?.patient_id ?? ""}`;
    const patient = fixtures.patients.find((p) => p.id === visit?.patient_id);
    if (patient !== undefined) patient.age_years = 34;
  });
  return { path, backend };
}

const teeth = () => screen.getAllByRole("button", { name: /^Tooth \d+,/ });

describe("starting a visit", () => {
  for (const layout of LAYOUTS) {
    it(`shows the full adult chart before and after Start visit (${layout})`, async () => {
      const user = userEvent.setup();
      const { path, backend } = adult();
      localStorage.setItem(layoutKey(PEOPLE.asha), layout);
      renderPortal(path, { as: PEOPLE.asha, backend });
      await screen.findByRole("radiogroup", { name: "Chart look" }, { timeout: 20_000 });
      expect(teeth()).toHaveLength(32);
      await user.click(await screen.findByRole("button", { name: "Start visit" }));
      await screen.findByText("Visit in progress", undefined, { timeout: 20_000 });
      expect(teeth()).toHaveLength(32);
    });
  }

  it("shows 32 teeth for an adult even when Child was chosen on another patient", async () => {
    const { path, backend } = adult();
    localStorage.setItem(chartPrefsKey(PEOPLE.asha), JSON.stringify({ look: "rows", dentition: "child", view: "treatment" }));
    renderPortal(path, { as: PEOPLE.asha, backend });
    await screen.findByRole("radiogroup", { name: "Chart look" }, { timeout: 20_000 });
    expect(teeth()).toHaveLength(32);
  });
});
