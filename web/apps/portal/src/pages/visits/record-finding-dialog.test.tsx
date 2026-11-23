import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { unwrap } from "@aarogyam/api-client";

import { clinic } from "../../test/clinic-wrapper.js";
import { RecordFindingDialog } from "./record-finding-dialog.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const { wrapper: Wrapper, api } = await clinic();
  const patient = (await unwrap(api.listPatients({}))).items[0];
  if (patient === undefined) throw new Error("no patient");
  const record = vi.spyOn(api, "recordChartEntries");
  const closed = vi.fn();
  render(
    <Wrapper>
      <RecordFindingDialog patientId={patient.id} teeth={[36]} terms={[]} initialSurface="O" onOpenChange={closed} />
    </Wrapper>,
  );
  return { record, closed, patientId: patient.id, dialog: within(await screen.findByRole("dialog", { name: /^Record a finding/ })) };
}

describe("record finding: the §1.13 depth chips", () => {
  it("shows Enamel, Dentin and Near nerve only after Caries is picked, and saves the chosen depth", async () => {
    const user = userEvent.setup();
    const { record, closed, patientId, dialog } = await setup();
    expect(dialog.queryByRole("group", { name: "Depth (optional)" })).toBeNull();
    await user.selectOptions(dialog.getByLabelText(/^Finding\b/), "caries");
    const depth = within(dialog.getByRole("group", { name: "Depth (optional)" }));
    expect(depth.getAllByRole("button").map((b) => b.textContent)).toEqual(["Enamel", "Dentin", "Near nerve"]);
    expect(depth.getAllByRole("button").every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    await user.click(depth.getByRole("button", { name: "Dentin" }));
    expect(depth.getByRole("button", { name: "Dentin" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(closed).toHaveBeenCalled(); });
    expect(record).toHaveBeenCalledWith(patientId, { entries: [{ tooth: 36, surface: "O", finding: "caries", caries_depth: "dentin" }] });
  });

  it("skipping the chips sends no depth, and a second tap clears the choice", async () => {
    const user = userEvent.setup();
    const { record, patientId, dialog } = await setup();
    await user.selectOptions(dialog.getByLabelText(/^Finding\b/), "caries");
    const depth = within(dialog.getByRole("group", { name: "Depth (optional)" }));
    await user.click(depth.getByRole("button", { name: "Near nerve" }));
    await user.click(depth.getByRole("button", { name: "Near nerve" }));
    expect(depth.getByRole("button", { name: "Near nerve" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(record).toHaveBeenCalledWith(patientId, { entries: [{ tooth: 36, surface: "O", finding: "caries" }] }); });
  });

  it("drops a picked depth when the finding changes away from Caries", async () => {
    const user = userEvent.setup();
    const { record, patientId, dialog } = await setup();
    await user.selectOptions(dialog.getByLabelText(/^Finding\b/), "caries");
    await user.click(within(dialog.getByRole("group", { name: "Depth (optional)" })).getByRole("button", { name: "Enamel" }));
    await user.selectOptions(dialog.getByLabelText(/^Finding\b/), "watch");
    expect(dialog.queryByRole("group", { name: "Depth (optional)" })).toBeNull();
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(record).toHaveBeenCalledWith(patientId, { entries: [{ tooth: 36, surface: "O", finding: "watch" }] }); });
  });
});
