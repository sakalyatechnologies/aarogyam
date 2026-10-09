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
  await user.click(await screen.findByRole("tab", { name: "Chart" }));
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
    await user.selectOptions(await screen.findByLabelText(/^Finding\b/), "caries");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Tooth 36, molar, Caries" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record a finding for tooth 36 (now Caries)" })).toBeTruthy();
  });

  it("preselects no finding, asks for one, and offers a single way to close", async () => {
    const user = await openChart();
    await user.click(tooth(36));
    await user.click(await screen.findByRole("button", { name: /^Record a finding for tooth 36 /i }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText<HTMLSelectElement>(/^Finding\b/).value).toBe("");
    expect(dialog.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(dialog.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("Choose a finding.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tooth 36, molar, sound", hidden: true })).toBeTruthy();
  });

  it("selects one surface by click, pre-selects it in the dialog and paints just that surface", async () => {
    const user = await openChart();
    fireEvent.click(surfaceOf(46, "O") ?? document.body);
    expect(surfaceOf(46, "O")?.getAttribute("data-selected")).toBe("true");
    expect(surfaceOf(46, "B")?.getAttribute("data-selected")).toBe("false");
    expect(screen.getByRole("button", { name: "Occlusal surface" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /^Record a finding for tooth 46/ }));
    expect(within(await screen.findByRole("dialog")).getByRole("button", { name: "Occlusal" }).getAttribute("aria-pressed")).toBe("true");
    await user.selectOptions(screen.getByLabelText(/^Finding\b/), "caries");
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

  it("records procedure and material on several teeth, with type-ahead and Add new, without a request per keystroke", async () => {
    const user = userEvent.setup();
    const { path, backend } = patientPath();
    let chartReads = 0;
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        getDentalChart: (...args) => {
          chartReads += 1;
          return client.getDentalChart(...args);
        },
      }),
    });
    await user.click(await screen.findByRole("tab", { name: "Chart" }));
    await screen.findByRole("group", { name: "Upper arch" });

    await user.click(screen.getByRole("button", { name: "Select several" }));
    await user.click(tooth(16));
    await user.click(tooth(26));
    expect(await screen.findByRole("heading", { name: "2 teeth selected" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Record for 2 teeth" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.selectOptions(dialog.getByLabelText(/^Finding\b/), "filled");
    await user.click(dialog.getByRole("button", { name: "Occlusal / incisal" }));

    const readsBefore = chartReads;
    const material = dialog.getByLabelText("Material");
    await user.type(material, "Z");
    expect(within(screen.getByRole("listbox", { name: "Materials" })).getAllByRole("option")[0]?.textContent).toBe("Zirconia");
    await user.clear(material);
    await user.type(material, "Lithium silicate");
    await user.click(screen.getByRole("option", { name: 'Add "Lithium silicate"' }));
    await screen.findByDisplayValue("Lithium silicate");
    await user.type(dialog.getByLabelText("Procedure"), "onl");
    await user.keyboard("{Enter}");
    expect(dialog.getByLabelText("Procedure")).toHaveProperty("value", "Onlay");
    expect(chartReads).toBe(readsBefore);
    await user.click(dialog.getByRole("button", { name: "Save" }));

    const details = within(await screen.findByRole("table", { name: "Treatment details by tooth" }));
    const rows = details.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("16");
    expect(rows[0]).toContain("OcclusalFilledOnlayLithium silicate");
    expect(rows[1]).toContain("26");

    // The tooth's history shows the surface, procedure and material.
    await user.click(screen.getByRole("button", { name: "Select several" }));
    await user.click(tooth(16));
    const history = within(await screen.findByRole("list", { name: "History of tooth 16" }));
    expect(await history.findByText("Onlay · Lithium silicate")).toBeTruthy();
    expect(history.getByText(/occlusal/)).toBeTruthy();

    // The clinic's new material is offered next time.
    await user.click(screen.getByRole("button", { name: /^Record a finding for tooth 16/ }));
    await user.type(within(await screen.findByRole("dialog", { name: /^Record a finding/ })).getByLabelText("Material"), "lith");
    expect(within(screen.getByRole("listbox", { name: "Materials" })).getAllByRole("option")[0]?.textContent).toBe("Lithium silicate · this clinic");
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
