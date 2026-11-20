import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chartEntryId, unwrap, type ChartEntry, type Procedure, type ToothCondition, type ToothEruption } from "@aarogyam/api-client";

import { clinic } from "../../../../test/clinic-wrapper.js";
import { DetailChips, treatedToday } from "./detail-chips.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = new Date("2026-11-20T10:00:00Z");
const entry = (over: Partial<ChartEntry>): ChartEntry => ({
  id: chartEntryId.parse("e1"), tooth: 36, finding: "filled", status: "current", effective_at: NOW.toISOString(), in_progress: false, canals: [], ...over,
});

async function setup(props: { tooth: number; condition?: ToothCondition; eruption?: ToothEruption; entries?: ChartEntry[]; procedures?: Procedure[] }) {
  const { wrapper: Wrapper, api } = await clinic();
  const patient = (await unwrap(api.listPatients({}))).items[0];
  if (patient === undefined) throw new Error("no patient");
  const condition = vi.spyOn(api, "setToothCondition");
  const eruption = vi.spyOn(api, "setToothEruption");
  render(
    <Wrapper>
      <DetailChips patientId={patient.id} tooth={props.tooth} entries={props.entries ?? []} procedures={props.procedures ?? []} condition={props.condition} eruption={props.eruption} />
    </Wrapper>,
  );
  return { condition, eruption, patientId: patient.id };
}

describe("§1.13 detail chips", () => {
  it("shows the Condition row on every tooth, milk teeth included, and saves one tap as one merged PUT", async () => {
    const user = userEvent.setup();
    const { condition, patientId } = await setup({ tooth: 75 });
    const row = within(screen.getByRole("group", { name: "Condition" }));
    await user.click(row.getByRole("button", { name: "Mobility 2" }));
    await waitFor(() => { expect(condition).toHaveBeenCalledWith(patientId, 75, { mobility: 2 }); });
    await user.click(row.getByRole("button", { name: "Pocket 7 or more mm" }));
    await waitFor(() => { expect(condition).toHaveBeenLastCalledWith(patientId, 75, { pocket_mm: 7 }); });
    expect(screen.queryByRole("group", { name: "Wisdom tooth position" })).toBeNull();
  });

  it("toggles off with null, shows the recorded date, and hides the row on a missing tooth (DT3)", async () => {
    const user = userEvent.setup();
    const recorded: ToothCondition = { id: "c1", tooth: 36, infection: "abscess", recorded_at: "2026-11-12T09:00:00Z" };
    const { condition, patientId } = await setup({ tooth: 36, condition: recorded });
    const row = within(screen.getByRole("group", { name: "Condition" }));
    expect(row.getByRole("button", { name: "Abscess" }).getAttribute("aria-pressed")).toBe("true");
    expect(row.getByText(/^Recorded /)).toBeTruthy();
    await user.click(row.getByRole("button", { name: "Abscess" }));
    await waitFor(() => { expect(condition).toHaveBeenCalledWith(patientId, 36, { infection: null }); });
    cleanup();
    await setup({ tooth: 36, condition: recorded, entries: [entry({ finding: "missing" })] });
    expect(screen.queryByRole("group", { name: "Condition" })).toBeNull();
  });

  it("offers Infection resolved after a treatment done today, clearing only the infection", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    const recorded: ToothCondition = { id: "c1", tooth: 36, infection: "infection", mobility: 1, recorded_at: "2026-11-12T09:00:00Z" };
    const { condition, patientId } = await setup({ tooth: 36, condition: recorded, entries: [entry({})] });
    await user.click(screen.getByRole("button", { name: "Infection resolved" }));
    await waitFor(() => { expect(condition).toHaveBeenCalledWith(patientId, 36, { infection: null }); });
    expect(treatedToday(36, [entry({ in_progress: true })], [], NOW)).toBe(false);
    expect(treatedToday(36, [entry({ effective_at: "2026-11-01T09:00:00Z" })], [], NOW)).toBe(false);
    vi.useRealTimers();
  });

  it("asks wisdom position on the 8s, then the angle", async () => {
    const user = userEvent.setup();
    const { eruption, patientId } = await setup({ tooth: 48, eruption: { id: "r1", tooth: 48, eruption: "impacted", recorded_at: NOW.toISOString() } });
    const position = within(screen.getByRole("group", { name: "Wisdom tooth position" }));
    expect(position.getByRole("button", { name: "Impacted" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(screen.getByRole("group", { name: "Wisdom tooth angle" })).getByRole("button", { name: "Mesio" }));
    await waitFor(() => { expect(eruption).toHaveBeenCalledWith(patientId, 48, { eruption: "impacted", angulation: "mesioangular" }); });
    await user.click(position.getByRole("button", { name: "Erupted" }));
    await waitFor(() => { expect(eruption).toHaveBeenLastCalledWith(patientId, 48, { eruption: "erupted" }); });
  });
});
