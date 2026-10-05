import { fireEvent, screen, within } from "@testing-library/react";
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

async function openChart(prepare?: (fixtures: Fixtures) => void, as: string = PEOPLE.asha) {
  const user = userEvent.setup();
  const { path, backend } = patientPath(prepare);
  renderPortal(path, { as, backend });
  await user.click(await screen.findByRole("tab", { name: "Dental chart" }));
  await screen.findByRole("group", { name: "Upper arch" });
  return user;
}

const tooth = (n: number) => screen.getByRole("button", { name: new RegExp(`^Tooth ${String(n)},`) });
const surfaceOf = (n: number, s: string) => tooth(n).querySelector<SVGElement>(`[data-surface="${s}"]`);

describe("Dental chart tab", () => {
  it("selects a tooth, records a finding on a surface and shows it on the chart", async () => {
    const user = await openChart();
    await user.click(tooth(36));
    await user.click(await screen.findByRole("button", { name: /^Record a finding for tooth 36 /i }));
    await user.selectOptions(await screen.findByLabelText("Finding"), "caries");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Tooth 36, molar, Caries" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record a finding for tooth 36 (now Caries)" })).toBeTruthy();
  });

  it("selects one surface by click, pre-selects it in the dialog and paints just that surface", async () => {
    const user = await openChart();
    fireEvent.click(surfaceOf(46, "O") ?? document.body);
    expect(surfaceOf(46, "O")?.getAttribute("data-selected")).toBe("true");
    expect(surfaceOf(46, "B")?.getAttribute("data-selected")).toBe("false");
    expect(screen.getByRole("button", { name: "Occlusal surface" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /^Record a finding for tooth 46/ }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("Surface")).toHaveProperty("value", "O");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: /^Tooth 46, molar, Caries on occlusal/ });
    expect(surfaceOf(46, "O")?.getAttribute("data-finding")).toBe("caries");
    expect(surfaceOf(46, "M")?.getAttribute("data-finding")).toBe("");
  });

  it("picks a surface from the side panel and shows the tooth's history", async () => {
    const user = await openChart();
    await user.click(tooth(36));
    expect(await screen.findByText("Nothing recorded yet.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Mesial surface" }));
    expect(surfaceOf(36, "M")?.getAttribute("data-selected")).toBe("true");
  });

  it("lists every finding in the legend with its pattern, and the treatment states", async () => {
    await openChart();
    const legend = within(screen.getByRole("list", { name: "Findings legend" }));
    for (const label of ["Sound", "Caries", "Filled", "Crown", "Root canal", "Missing", "Implant", "Bridge", "Fractured", "Watch"]) {
      expect(legend.getByText(label)).toBeTruthy();
    }
    expect(legend.getByText("Diagonal stripes")).toBeTruthy();
    const treatment = within(screen.getByRole("list", { name: "Treatment legend" }));
    expect(treatment.getByText("Planned")).toBeTruthy();
    expect(treatment.getByText("Extraction planned")).toBeTruthy();
    expect(treatment.getByText("Done")).toBeTruthy();
  });

  it("toggles to primary teeth and back", async () => {
    const user = await openChart();
    expect(screen.queryByRole("button", { name: /^Tooth 55,/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(32);
    await user.click(screen.getByRole("button", { name: "Child (primary)" }));
    expect(screen.getAllByRole("button", { name: /^Tooth \d+,/ })).toHaveLength(20);
    expect(tooth(55)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Tooth 18,/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Adult" }));
    expect(tooth(18)).toBeTruthy();
  });

  it("moves with the arrow keys, selects with Enter and picks a surface with a letter", async () => {
    const user = await openChart();
    await user.click(tooth(18));
    await user.keyboard("{Escape}");
    tooth(18).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tooth(17));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(document.activeElement?.getAttribute("data-tooth")).toBe("47");
    expect(tooth(47).getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("b");
    expect(surfaceOf(47, "B")?.getAttribute("data-selected")).toBe("true");
    await user.keyboard("{End}");
    expect(document.activeElement?.getAttribute("data-tooth")).toBe("38");
    await user.keyboard("{Escape}");
    expect(screen.getByText("No tooth selected")).toBeTruthy();
  });

  it("keeps a single tab stop across the teeth", async () => {
    await openChart();
    const stops = screen.getAllByRole("button", { name: /^Tooth \d+,/ }).filter((el) => el.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
  });

  it("swipes between arches on a phone", async () => {
    await openChart();
    const stage = screen.getByRole("group", { name: /^Adult teeth/ });
    expect(stage.getAttribute("data-active")).toBe("upper");
    fireEvent.touchStart(stage, { touches: [{ clientX: 220, clientY: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 80, clientY: 104 }] });
    expect(stage.getAttribute("data-active")).toBe("lower");
    fireEvent.touchStart(stage, { touches: [{ clientX: 80, clientY: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 220, clientY: 100 }] });
    expect(stage.getAttribute("data-active")).toBe("upper");
  });

  it("lets a reader look at a tooth but not record", async () => {
    const user = await openChart((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions: ["patients.read", "clinical.read"] };
    }, PEOPLE.farah);
    await user.click(tooth(36));
    await screen.findByRole("heading", { name: "Tooth 36" });
    expect(screen.queryByRole("button", { name: /^Record a finding/ })).toBeNull();
  });
});
