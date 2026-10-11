/**
 * Pure model of the New look tooth chart: the treatment list, how a treatment form becomes chart entries, plan items or a
 * procedure, how the tooth's history is grouped into rows, and how an edit becomes a correction (`supersedes_id`).
 * Nothing here touches React or the network.
 */
import type { ChartEntry, ChartFinding, DentalTerm, NewChartEntry, NewPlan, PlanItem, Procedure, RootCanal, ToothSurface } from "@aarogyam/api-client";

import { FINDING_STYLE, SURFACES, isWholeToothFinding, kindOf, isPrimary, archOf } from "../../../visits/odontogram/model.js";

export type TreatmentKey = "filling" | "root_canal" | "crown" | "extraction" | "implant" | "bridge" | "scaling" | "sealant" | "veneer";

export interface Treatment {
  readonly key: TreatmentKey;
  readonly label: string;
  /** The chart finding it records; scaling has none (it is recorded as a procedure). */
  readonly finding: ChartFinding | undefined;
  /** Seeded procedure term id. */
  readonly procedure: string;
  /** Seeded material term ids offered for it. */
  readonly materials: readonly string[];
}

const FILLING: Treatment = { key: "filling", label: "Filling", finding: "filled", procedure: "filling", materials: ["composite", "glass_ionomer", "amalgam", "flowable_composite", "inlay_onlay"] };

export const TREATMENTS: readonly Treatment[] = [
  FILLING,
  { key: "root_canal", label: "Root canal", finding: "root_canal", procedure: "root_canal", materials: ["gutta_percha", "calcium_hydroxide", "bioceramic_sealer", "mta", "ah_plus_sealer"] },
  { key: "crown", label: "Crown", finding: "crown", procedure: "crown", materials: ["zirconia", "layered_zirconia", "emax", "pfm", "cast_metal"] },
  { key: "extraction", label: "Extraction", finding: "missing", procedure: "extraction", materials: [] },
  { key: "implant", label: "Implant", finding: "implant", procedure: "implant", materials: ["titanium_4_2x10", "titanium_3_5x11_5", "zirconia_abutment"] },
  { key: "bridge", label: "Bridge", finding: "bridge", procedure: "bridge", materials: ["zirconia", "pfm", "emax"] },
  { key: "scaling", label: "Scaling", finding: undefined, procedure: "scaling", materials: ["ultrasonic"] },
  { key: "sealant", label: "Sealant", finding: "filled", procedure: "sealant", materials: ["resin_sealant", "gic_sealant"] },
  { key: "veneer", label: "Veneer", finding: "crown", procedure: "veneer", materials: ["emax", "composite_veneer"] },
];


export const treatmentOf = (key: TreatmentKey): Treatment => TREATMENTS.find((t) => t.key === key) ?? FILLING;

export type TxStatus = "Completed" | "In progress" | "Planned" | "Watch";
export const STATUSES: readonly TxStatus[] = ["Completed", "In progress", "Planned", "Watch"];

/** Statuses a treatment can take: scaling is a procedure, so it is done or planned. */
export const statusesFor = (key: TreatmentKey): readonly TxStatus[] => (key === "scaling" ? ["Completed", "Planned"] : STATUSES);

/** Material choices: the seeded ones for the treatment (in the zip's order) plus the clinic's own, hiding retired ones. */
export function materialChoices(tx: Treatment, terms: readonly DentalTerm[]): readonly DentalTerm[] {
  const materials = terms.filter((t) => t.kind === "material" && !t.retired);
  const seeded = tx.materials.flatMap((id) => materials.filter((m) => m.id === id));
  return [...seeded, ...materials.filter((m) => m.own)];
}

/** The material to start from: the only one that fits, so a treatment with a single choice needs no tap. */
export function defaultMaterial(tx: Treatment, terms: readonly DentalTerm[]): string {
  const choices = materialChoices(tx, terms);
  return choices.length === 1 ? (choices[0]?.id ?? "") : "";
}

/** Whole-tooth treatments cannot be recorded on a surface: the API refuses it. */
export function allowsSurfaces(tx: Treatment, status: TxStatus): boolean {
  if (tx.key === "scaling" || tx.key === "root_canal") return false;
  if (status === "Watch") return tx.finding === "filled";
  return tx.finding !== undefined && !isWholeToothFinding(tx.finding);
}

/** Canal names offered for a root canal, by tooth position (molars have three or four, premolars two, the rest one). */
export function canalOptions(tooth: number): readonly string[] {
  const position = tooth % 10;
  if (isPrimary(tooth)) return position >= 4 ? ["MB", "ML", "D"] : ["Single"];
  if (position >= 6) {
    const quadrant = Math.floor(tooth / 10);
    return archOf(tooth) === "upper" ? (quadrant === 1 || quadrant === 2 ? ["MB1", "MB2", "DB", "P"] : ["MB", "DB", "P"]) : ["MB", "ML", "D", "DL"];
  }
  return kindOf(tooth) === "premolar" ? ["B", "L"] : ["Single"];
}

export interface Draft {
  tx: TreatmentKey;
  /** Material term id, or "" for none. */
  material: string;
  surfaces: readonly ToothSurface[];
  status: TxStatus;
  note: string;
  canals: readonly string[];
  sitting: number;
  /** Working length in mm as typed ("21", "21 mm"). */
  length: string;
}

export const blankDraft = (): Draft => ({ tx: "filling", material: "", surfaces: [], status: "Completed", note: "", canals: [], sitting: 1, length: "" });

/** A working length typed as "21", "21 mm" or "20,5": a number from 0 (exclusive) to 40, or undefined when empty or not valid. */
export function parseLength(text: string): number | undefined {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*$/i.exec(text);
  if (match?.[1] === undefined) return undefined;
  const value = Number(match[1].replace(",", "."));
  return value > 0 && value <= 40 ? Math.round(value * 100) / 100 : undefined;
}

export const lengthProblem = (text: string): string | undefined => (text.trim() === "" || parseLength(text) !== undefined ? undefined : "Enter the length in mm, up to 40.");

/** The chart finding a draft records, or undefined when it is a procedure (scaling). */
export function findingOf(d: Draft): ChartFinding | undefined {
  return d.status === "Watch" ? "watch" : treatmentOf(d.tx).finding;
}

/** The chart entries a Completed, In progress or Watch draft records on a tooth: one per surface, or one for the whole tooth. */
export function buildEntries(tooth: number, d: Draft): NewChartEntry[] {
  const tx = treatmentOf(d.tx);
  const finding = findingOf(d);
  if (finding === undefined) return [];
  const length = parseLength(d.length);
  const rootCanal = finding === "root_canal";
  const detail = {
    finding,
    procedure: tx.procedure,
    ...(d.material === "" ? {} : { material: d.material }),
    ...(d.note.trim() === "" ? {} : { note: d.note.trim() }),
    ...(d.status === "In progress" ? { in_progress: true } : {}),
    ...(rootCanal ? { sitting: d.sitting, ...(d.canals.length === 0 ? {} : { canals: d.canals.map((name): RootCanal => ({ name, ...(length === undefined ? {} : { working_length_mm: length }) })) }) } : {}),
  };
  const surfaces = allowsSurfaces(tx, d.status) ? SURFACES.filter((s) => d.surfaces.includes(s)) : [];
  return surfaces.length === 0 ? [{ tooth, ...detail }] : surfaces.map((surface) => ({ tooth, surface, ...detail }));
}

/**
 * An edit as one batch. Each new entry corrects an old one (`supersedes_id`): the old entry on the same surface when there is
 * one, else a left-over old entry. Old entries nobody takes over are cleared with a `sound` entry that supersedes them.
 * Clears come first so the later entries never find an entry the batch already replaced.
 */
export function correctionBatch(tooth: number, old: readonly ChartEntry[], fresh: readonly NewChartEntry[]): NewChartEntry[] {
  const free = new Map(old.map((entry) => [entry.id, entry]));
  const partner = new Map<number, ChartEntry>();
  fresh.forEach((entry, index) => {
    const same = [...free.values()].find((o) => (o.surface ?? null) === (entry.surface ?? null));
    if (same !== undefined) {
      partner.set(index, same);
      free.delete(same.id);
    }
  });
  fresh.forEach((_entry, index) => {
    if (partner.has(index)) return;
    const next = free.values().next();
    if (next.done === true) return;
    partner.set(index, next.value);
    free.delete(next.value.id);
  });
  const clears: NewChartEntry[] = [...free.values()].map((o) => ({ tooth, ...(o.surface == null ? {} : { surface: o.surface }), finding: "sound", supersedes_id: o.id }));
  return [
    ...clears,
    ...fresh.map((entry, index) => {
      const replaced = partner.get(index);
      return replaced === undefined ? entry : { ...entry, supersedes_id: replaced.id };
    }),
  ];
}

/** A plan with one item for a Planned draft. The estimate is left at 0 for the clinic to price when it presents the plan. */
export function buildPlan(tooth: number, d: Draft, materialLabel: string | undefined): NewPlan {
  const tx = treatmentOf(d.tx);
  const name = materialLabel === undefined ? tx.label : `${tx.label} (${materialLabel})`;
  const surfaces = allowsSurfaces(tx, d.status) ? SURFACES.filter((s) => d.surfaces.includes(s)) : [];
  return { title: `Tooth ${String(tooth)}: ${tx.label}`, items: [{ name, tooth, surfaces: [...surfaces], estimate_paise: 0 }] };
}

// History ----------------------------------------------------------------------------------------

export type RowStatus = TxStatus | "Superseded" | "Entered in error";

export interface HistoryRow {
  readonly key: string;
  readonly kind: "chart" | "plan" | "procedure";
  readonly label: string;
  readonly status: RowStatus;
  /** ISO time; absent for a plan item that is not done yet. */
  readonly date: string | undefined;
  readonly material: string | undefined;
  readonly surfaces: readonly ToothSurface[];
  readonly canals: readonly RootCanal[];
  readonly sitting: number | undefined;
  readonly note: string | undefined;
  readonly recordedBy: string | undefined;
  /** The chart entries behind a chart row (all of them current for an editable row). */
  readonly entries: readonly ChartEntry[];
  readonly planItem: PlanItem | undefined;
  /** Edit is offered for current chart rows and open plan items. */
  readonly editable: boolean;
  readonly treatment: TreatmentKey | undefined;
}

const byProcedure = (id: string | undefined): Treatment | undefined => (id === undefined ? undefined : TREATMENTS.find((t) => t.procedure === id));
const byFinding = (finding: ChartFinding): Treatment | undefined => {
  switch (finding) {
    case "filled":
      return treatmentOf("filling");
    case "root_canal":
      return treatmentOf("root_canal");
    case "crown":
      return treatmentOf("crown");
    case "missing":
      return treatmentOf("extraction");
    case "implant":
      return treatmentOf("implant");
    case "bridge":
      return treatmentOf("bridge");
    default:
      return undefined;
  }
};

/** The treatment a chart entry belongs to: by its procedure, else by its finding. A `watch` finding needs a procedure to be edited. */
export function treatmentOfEntry(entry: ChartEntry): Treatment | undefined {
  return byProcedure(entry.procedure?.id) ?? byFinding(entry.finding);
}

export function statusOfEntry(entry: ChartEntry): RowStatus {
  if (entry.status === "superseded") return "Superseded";
  if (entry.status === "entered_in_error") return "Entered in error";
  if (entry.finding === "watch") return "Watch";
  return entry.in_progress ? "In progress" : "Completed";
}

/** Entries recorded together (same time, finding, procedure, material, remark and state) are one row, one surface each. */
export function groupEntries(history: readonly ChartEntry[], who: (id: string | null | undefined) => string | undefined = () => undefined): HistoryRow[] {
  const rows = new Map<string, ChartEntry[]>();
  for (const entry of history) {
    // `sound` entries only clear a finding; the row they clear already says so.
    if (entry.finding === "sound") continue;
    const key = [entry.effective_at, entry.finding, entry.procedure?.id, entry.material?.id, entry.note, entry.status, entry.in_progress ? 1 : 0, entry.sitting].join("|");
    rows.set(key, [...(rows.get(key) ?? []), entry]);
  }
  return [...rows.entries()].flatMap(([key, entries]): HistoryRow[] => {
    const [first] = entries;
    if (first === undefined) return [];
    const tx = treatmentOfEntry(first);
    const status = statusOfEntry(first);
    return [{
      key,
      kind: "chart",
      label: tx?.label ?? first.procedure?.label ?? FINDING_STYLE[first.finding].label,
      status,
      date: first.effective_at,
      material: first.material?.label,
      surfaces: SURFACES.filter((s) => entries.some((e) => e.surface === s)),
      canals: first.canals,
      sitting: first.sitting ?? undefined,
      note: first.note ?? undefined,
      recordedBy: who(first.recorded_by),
      entries,
      planItem: undefined,
      editable: first.status === "current" && tx !== undefined,
      treatment: tx?.key,
    }];
  });
}

/** Everything known about one tooth, newest first, with open plan items on top as Planned rows. */
export function historyRows(args: {
  history: readonly ChartEntry[];
  planItems: readonly PlanItem[];
  procedures: readonly Procedure[];
  tooth: number;
  who?: (id: string | null | undefined) => string | undefined;
}): HistoryRow[] {
  const { history, planItems, procedures, tooth, who } = args;
  const chart = groupEntries(history, who);
  const planned = planItems
    .filter((item) => item.tooth === tooth && (item.status === "proposed" || item.status === "accepted"))
    .map(
      (item): HistoryRow => ({
        key: `plan-${item.id}`,
        kind: "plan",
        label: item.name,
        status: "Planned",
        date: undefined,
        material: undefined,
        surfaces: item.surfaces,
        canals: [],
        sitting: undefined,
        note: undefined,
        recordedBy: undefined,
        entries: [],
        planItem: item,
        editable: TREATMENTS.some((t) => item.name.toLowerCase().startsWith(t.label.toLowerCase())),
        treatment: TREATMENTS.find((t) => item.name.toLowerCase().startsWith(t.label.toLowerCase()))?.key,
      }),
    );
  // Scaling is a procedure, not a chart finding. Other procedures already show as chart entries or plan items.
  const scaled = procedures
    .filter((p) => p.tooth === tooth && p.status === "done" && /^scaling/i.test(p.name))
    .map(
      (p): HistoryRow => ({
        key: `proc-${p.id}`,
        kind: "procedure",
        label: p.name,
        status: "Completed",
        date: p.performed_at ?? p.created_at,
        material: undefined,
        surfaces: p.surfaces,
        canals: [],
        sitting: undefined,
        note: p.note ?? undefined,
        recordedBy: undefined,
        entries: [],
        planItem: undefined,
        editable: false,
        treatment: "scaling",
      }),
    );
  const dated = [...chart, ...scaled].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return [...planned, ...dated];
}

/** The form's starting values for editing a row. */
export function draftFromRow(row: HistoryRow): Draft {
  const base = blankDraft();
  if (row.treatment === undefined) return base;
  const first = row.entries[0];
  const length = row.canals.find((c) => c.working_length_mm != null)?.working_length_mm;
  const planned = row.kind === "plan";
  return {
    ...base,
    tx: row.treatment,
    material: first?.material?.id ?? "",
    surfaces: row.surfaces,
    // A planned item becomes real work: the form starts at Completed and Planned is not offered again.
    status: planned ? "Completed" : row.status === "In progress" || row.status === "Watch" ? row.status : "Completed",
    note: row.note ?? "",
    canals: row.canals.map((c) => c.name),
    sitting: row.sitting ?? 1,
    length: length == null ? "" : String(length),
  };
}

/** The teeth with a treatment that is started but not finished, for the chart's marker. */
export function inProgressTeeth(current: readonly ChartEntry[]): ReadonlySet<number> {
  return new Set(current.filter((e) => e.status === "current" && e.in_progress).map((e) => e.tooth));
}

const QUADRANT: Readonly<Record<number, string>> = { 1: "Upper right", 2: "Upper left", 3: "Lower left", 4: "Lower right", 5: "Upper right", 6: "Upper left", 7: "Lower left", 8: "Lower right" };
const PERMANENT = ["", "central incisor", "lateral incisor", "canine", "first premolar", "second premolar", "first molar", "second molar", "third molar"];
const PRIMARY = ["", "central incisor", "lateral incisor", "canine", "first molar", "second molar"];

/** "Upper right second premolar" for 15; "Lower left primary canine" for 73. */
export function toothName(tooth: number): string {
  const quadrant = QUADRANT[Math.floor(tooth / 10)] ?? "";
  const position = tooth % 10;
  const name = isPrimary(tooth) ? PRIMARY[position] : PERMANENT[position];
  return `${quadrant} ${isPrimary(tooth) ? "primary " : ""}${name ?? ""}`.replace(/\s+/g, " ").trim();
}
