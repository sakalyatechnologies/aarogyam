import { describe, expect, it } from "vitest";

import { chartEntryId, paise, procedure, type ChartEntry, type DentalTerm, type PlanItem } from "@aarogyam/api-client";

import { allowsElsewhere, blankDraft, buildEntries, buildPlan, canalOptions, correctionBatch, countLabel, derivedHealth, draftFromRow, elsewhereTeeth, groupEntries, healthByTooth, healthOf, historyRows, lengthProblem, materialChoices, parseLength, progress, statusesFor, treatmentOf } from "./model.js";

const term = (kind: DentalTerm["kind"], id: string, label: string, own = false): DentalTerm => ({ id, kind, label, own, retired: false });
const entry = (over: Partial<Omit<ChartEntry, "id">> & Pick<ChartEntry, "tooth" | "finding"> & { id: string }): ChartEntry => ({ status: "current", effective_at: "2026-10-01T09:00:00Z", canals: [], in_progress: false, ...over, id: chartEntryId.parse(over.id) });

describe("the treatment form becomes chart entries", () => {
  it("records one entry per surface for a filling, with its material and note", () => {
    const entries = buildEntries(16, { ...blankDraft(), material: "composite", surfaces: ["O", "M"], note: " Class II " });
    expect(entries).toEqual([
      { tooth: 16, surface: "M", finding: "filled", procedure: "filling", material: "composite", note: "Class II" },
      { tooth: 16, surface: "O", finding: "filled", procedure: "filling", material: "composite", note: "Class II" },
    ]);
  });

  it("sends no surface for whole-tooth treatments, even when one was chosen before switching", () => {
    const crown = buildEntries(16, { ...blankDraft(), tx: "crown", material: "zirconia", surfaces: ["O"] });
    expect(crown).toEqual([{ tooth: 16, finding: "crown", procedure: "crown", material: "zirconia" }]);
    expect(buildEntries(38, { ...blankDraft(), tx: "extraction" })).toEqual([{ tooth: 38, finding: "missing", procedure: "extraction" }]);
  });

  it("maps the other treatments to their finding and procedure", () => {
    const pairs = (["implant", "bridge", "veneer", "sealant"] as const).map((tx) => buildEntries(21, { ...blankDraft(), tx })[0]);
    expect(pairs.map((e) => [e?.finding, e?.procedure])).toEqual([["implant", "implant"], ["bridge", "bridge"], ["crown", "veneer"], ["filled", "sealant"]]);
  });

  it("carries canals with one working length and the sitting for a root canal, and flags in progress", () => {
    const [root] = buildEntries(46, { ...blankDraft(), tx: "root_canal", canals: ["MB", "ML"], length: "21 mm", sitting: 2, status: "In progress" });
    expect(root).toEqual({
      tooth: 46,
      finding: "root_canal",
      procedure: "root_canal",
      in_progress: true,
      sitting: 2,
      canals: [{ name: "MB", working_length_mm: 21 }, { name: "ML", working_length_mm: 21 }],
    });
  });

  it("records Watch as the watch finding with the procedure, and never sends canals with it", () => {
    const [watch] = buildEntries(46, { ...blankDraft(), tx: "root_canal", status: "Watch", canals: ["MB"] });
    expect(watch).toEqual({ tooth: 46, finding: "watch", procedure: "root_canal" });
    const [filling] = buildEntries(14, { ...blankDraft(), status: "Watch", surfaces: ["D"] });
    expect(filling).toEqual({ tooth: 14, surface: "D", finding: "watch", procedure: "filling" });
  });

  it("scaling is a procedure, not a finding", () => {
    expect(buildEntries(11, { ...blankDraft(), tx: "scaling" })).toEqual([]);
    expect(statusesFor("scaling")).toEqual(["Completed", "Planned"]);
  });

  it("a planned treatment is a plan item with no estimate", () => {
    expect(buildPlan(14, { ...blankDraft(), surfaces: ["M", "O"], status: "Planned" }, "Composite")).toEqual({
      title: "Tooth 14: Filling",
      items: [{ name: "Filling (Composite)", tooth: 14, surfaces: ["M", "O"], estimate_paise: 0 }],
    });
  });
});

describe("working length and canals", () => {
  it("accepts mm text, rejects the rest", () => {
    expect(parseLength("21")).toBe(21);
    expect(parseLength(" 20,5 mm ")).toBe(20.5);
    expect(parseLength("0")).toBeUndefined();
    expect(parseLength("41")).toBeUndefined();
    expect(parseLength("abc")).toBeUndefined();
    expect(lengthProblem("")).toBeUndefined();
    expect(lengthProblem("abc")).toMatch(/mm/);
  });

  it("offers canals by tooth", () => {
    expect(canalOptions(26)).toEqual(["MB1", "MB2", "DB", "P"]);
    expect(canalOptions(46)).toEqual(["MB", "ML", "D", "DL"]);
    expect(canalOptions(14)).toEqual(["B", "L"]);
    expect(canalOptions(11)).toEqual(["Single"]);
  });
});

describe("materials are filtered by treatment", () => {
  const terms = [term("material", "zirconia", "Zirconia"), term("material", "composite", "Composite"), term("material", "gutta_percha", "Gutta percha"), term("material", "11111111", "Our resin", true), term("procedure", "crown", "Crown")];
  it("offers the treatment's own materials plus the clinic's, in the zip's order", () => {
    expect(materialChoices(treatmentOf("crown"), terms).map((m) => m.id)).toEqual(["zirconia", "11111111"]);
    expect(materialChoices(treatmentOf("root_canal"), terms).map((m) => m.id)).toEqual(["gutta_percha", "11111111"]);
  });
});

describe("an edit is a correction", () => {
  const m = entry({ id: "e-m", tooth: 16, surface: "M", finding: "filled" });
  const o = entry({ id: "e-o", tooth: 16, surface: "O", finding: "filled" });
  const next = (surfaces: ("M" | "D" | "O")[]) => buildEntries(16, { ...blankDraft(), surfaces, note: "redone" });

  it("supersedes the old entry on the same surface", () => {
    const batch = correctionBatch(16, [m, o], next(["M", "O"]));
    expect(batch.map((e) => [e.surface, e.supersedes_id])).toEqual([["M", "e-m"], ["O", "e-o"]]);
  });

  it("clears a surface that was removed with a sound entry that supersedes it", () => {
    const batch = correctionBatch(16, [m, o], next(["M"]));
    expect(batch).toEqual([
      { tooth: 16, surface: "O", finding: "sound", supersedes_id: "e-o" },
      expect.objectContaining({ surface: "M", finding: "filled", supersedes_id: "e-m" }),
    ]);
  });

  it("lets a new surface take over a left-over old entry instead of adding a clear", () => {
    const batch = correctionBatch(16, [m, o], next(["M", "D"]));
    expect(batch.map((e) => [e.surface, e.finding, e.supersedes_id])).toEqual([["M", "filled", "e-m"], ["D", "filled", "e-o"]]);
  });

  it("a whole-tooth treatment replaces a surface one and clears the others first", () => {
    const crown = buildEntries(16, { ...blankDraft(), tx: "crown" });
    const batch = correctionBatch(16, [m, o], crown);
    expect(batch[0]).toMatchObject({ finding: "sound", supersedes_id: "e-o" });
    expect(batch[1]).toMatchObject({ finding: "crown", supersedes_id: "e-m" });
  });

  it("adds without supersedes when nothing was there", () => {
    expect(correctionBatch(16, [], next(["M"]))[0]?.supersedes_id).toBeUndefined();
  });
});

describe("the tooth's history", () => {
  const filling = (id: string, surface: "M" | "O", over: Partial<ChartEntry> = {}) =>
    entry({ id, tooth: 16, surface, finding: "filled", procedure: term("procedure", "filling", "Filling"), material: term("material", "composite", "Composite"), ...over });

  it("groups entries recorded together into one row with their surfaces", () => {
    const rows = groupEntries([filling("a", "O"), filling("b", "M")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Filling", status: "Completed", surfaces: ["M", "O"], material: "Composite", editable: true, treatment: "filling" });
  });

  it("labels in progress and watch, keeps superseded rows but not editable, and hides sound clears", () => {
    const rows = groupEntries([
      filling("a", "M", { in_progress: true, effective_at: "2026-10-05T09:00:00Z" }),
      filling("b", "M", { status: "superseded", effective_at: "2026-09-01T09:00:00Z" }),
      entry({ id: "w", tooth: 16, finding: "watch", effective_at: "2026-08-01T09:00:00Z" }),
      entry({ id: "s", tooth: 16, finding: "sound", status: "superseded" }),
    ]);
    expect(rows.map((r) => [r.status, r.editable])).toEqual([["In progress", true], ["Superseded", false], ["Watch", false]]);
  });

  it("puts open plan items on top as Planned rows and leaves done or cancelled ones out", () => {
    const item = (id: string, status: PlanItem["status"], tooth = 16): PlanItem => ({ id, name: "Crown (Zirconia)", tooth, surfaces: [], phase: 1, estimate_paise: paise.parse(0), status });
    const rows = historyRows({ history: [filling("a", "M")], planItems: [item("p1", "accepted"), item("p2", "done"), item("p3", "cancelled"), item("p4", "proposed", 17)], procedures: [], tooth: 16 });
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["plan", "Planned"], ["chart", "Completed"]]);
    expect(rows[0]).toMatchObject({ editable: true, treatment: "crown" });
  });

  it("starts the edit form from the row, and does not offer Planned again for a planned item", () => {
    const [row] = groupEntries([filling("a", "M", { in_progress: true, note: "shade A2" })]);
    expect(row && draftFromRow(row)).toMatchObject({ tx: "filling", material: "composite", surfaces: ["M"], status: "In progress", note: "shade A2" });
  });
});

describe("tooth health", () => {
  it("is derived from the findings, the worst surface winning, and an explicit status overrides it", () => {
    expect(healthOf([])).toBe("unassessed");
    expect(healthOf([entry({ id: "s", tooth: 16, finding: "sound" })])).toBe("healthy");
    for (const finding of ["filled", "crown", "implant", "root_canal", "bridge"] as const) {
      expect(derivedHealth([entry({ id: finding, tooth: 16, finding })])).toBe("healthy");
    }
    expect(healthOf([entry({ id: "w", tooth: 16, finding: "watch" })])).toBe("watch");
    expect(healthOf([entry({ id: "f", tooth: 16, finding: "fractured" })])).toBe("needs_treatment");
    expect(healthOf([entry({ id: "m", tooth: 16, finding: "missing" })])).toBe("none");
    const mixed = [entry({ id: "o", tooth: 36, surface: "O", finding: "filled" }), entry({ id: "d", tooth: 36, surface: "D", finding: "caries" })];
    expect(healthOf(mixed)).toBe("needs_treatment");
    expect(healthOf(mixed, { health: "healthy" })).toBe("healthy");
    // Only current entries count.
    expect(healthOf([entry({ id: "old", tooth: 36, finding: "caries", status: "superseded" })])).toBe("unassessed");
  });

  it("maps every tooth for the Health view, statuses winning", () => {
    const map = healthByTooth([entry({ id: "a", tooth: 16, finding: "caries" }), entry({ id: "b", tooth: 26, finding: "crown" })], [{ tooth: 26, health: "watch", recorded_at: "2026-11-01T09:00:00Z" }, { tooth: 11, health: "healthy", recorded_at: "2026-11-01T09:00:00Z" }]);
    expect([...map.entries()].sort((x, y) => x[0] - y[0])).toEqual([[11, "healthy"], [16, "needs_treatment"], [26, "watch"]]);
  });

  it("offers Done elsewhere only for completed work, and sends it only then", () => {
    expect(allowsElsewhere({ ...blankDraft(), tx: "crown" })).toBe(true);
    expect(allowsElsewhere({ ...blankDraft(), tx: "crown", status: "In progress" })).toBe(false);
    expect(allowsElsewhere({ ...blankDraft(), status: "Watch" })).toBe(false);
    expect(allowsElsewhere({ ...blankDraft(), tx: "scaling" })).toBe(false);
    expect(buildEntries(16, { ...blankDraft(), tx: "crown", elsewhere: true })).toEqual([{ tooth: 16, finding: "crown", procedure: "crown", elsewhere: true }]);
    expect(buildEntries(16, { ...blankDraft(), tx: "crown", status: "In progress", elsewhere: true })).toEqual([{ tooth: 16, finding: "crown", procedure: "crown", in_progress: true }]);
    expect([...elsewhereTeeth([entry({ id: "e", tooth: 26, finding: "crown", elsewhere: true }), entry({ id: "h", tooth: 16, finding: "crown" })])]).toEqual([26]);
  });
});

describe("progress", () => {
  it("counts distinct teeth, not surfaces; keeps superseded work; skips errors, sound and watch", () => {
    const counted = progress([
      entry({ id: "1", tooth: 36, surface: "O", finding: "filled" }),
      entry({ id: "2", tooth: 36, surface: "D", finding: "filled" }),
      entry({ id: "3", tooth: 46, finding: "root_canal", status: "superseded" }),
      entry({ id: "4", tooth: 46, finding: "crown" }),
      entry({ id: "5", tooth: 11, finding: "filled", status: "entered_in_error" }),
      entry({ id: "6", tooth: 21, finding: "sound" }),
      entry({ id: "7", tooth: 22, finding: "watch" }),
    ]);
    expect(counted.here).toBe(2);
    expect(counted.before).toBe(0);
    expect(counted.byTreatment.map(countLabel)).toEqual(["1 filling", "1 root canal", "1 crown"]);
  });

  it("counts elsewhere and imported work as before, and cleanings from procedures", () => {
    const scaling = procedure.parse({ id: "p1", visit_id: "v1", clinician: { id: "m1", name: "Dr A" }, name: "Scaling", surfaces: [], status: "done", created_at: "2026-11-01T09:00:00Z" });
    const counted = progress(
      [
        entry({ id: "a", tooth: 26, finding: "crown", elsewhere: true }),
        entry({ id: "b", tooth: 47, finding: "filled", source: "import" }),
        entry({ id: "c", tooth: 16, finding: "filled", surface: "O" }),
        entry({ id: "d", tooth: 17, finding: "filled", surface: "M" }),
      ],
      [scaling],
    );
    expect(counted).toMatchObject({ here: 2, before: 2 });
    expect(counted.byTreatment.map(countLabel)).toEqual(["2 fillings", "1 cleaning"]);
  });
});
