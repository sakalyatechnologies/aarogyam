import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Fixtures } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

function patientPath(prepare: (fixtures: Fixtures) => void = () => undefined) {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id && !fixtures.chartEntries.some((c) => c.patient_id === p.id));
    path = `/patients/${patient?.id ?? ""}`;
    prepare(fixtures);
  });
  return { path, backend };
}

describe("Dental chart tab", () => {
  it("clicks a tooth, records a finding and shows it on the chart", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientPath();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Dental chart" }));
    await user.click(await screen.findByRole("button", { name: /^Record a finding for tooth 36 /i }));
    await user.selectOptions(await screen.findByLabelText("Finding"), "caries");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Record a finding for tooth 36 (now Caries)" })).toBeTruthy();
  });

  it("leaves the teeth unclickable without clinical.write", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientPath((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions: ["patients.read", "clinical.read"] };
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("tab", { name: "Dental chart" }));
    await screen.findAllByRole("list", { name: "Teeth" });
    expect(screen.queryByRole("button", { name: /^Record a finding/ })).toBeNull();
  });
});
