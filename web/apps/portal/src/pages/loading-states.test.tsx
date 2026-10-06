import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../test/render.js";

/** Each page's first load shows skeletons shaped like its content, announced by one status region. */
describe("First-load skeletons", () => {
  it.each([
    ["/patients", "Loading patients"],
    ["/calendar", "Loading the schedule"],
    ["/queue", "Loading the queue"],
    ["/billing", "Loading bills"],
    ["/settings?tab=sessions", "Loading sessions"],
  ])("%s shows a skeleton before its data", async (path, label) => {
    renderPortal(path, { as: PEOPLE.asha });
    const region = await screen.findByRole("status", { name: label });
    expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(1);
  });

  it("a patient's page shows a skeleton before the record", async () => {
    const backend = fakeApi();
    const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const patients = await client.listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const first = patients.value.items[0];
    if (first === undefined) throw new Error("expected a patient");
    renderPortal(`/patients/${first.id}`, { as: PEOPLE.asha, backend });
    expect(await screen.findByRole("status", { name: "Loading the patient" })).toBeTruthy();
  });
});
