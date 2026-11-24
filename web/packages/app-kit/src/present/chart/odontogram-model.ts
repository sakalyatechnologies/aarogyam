/** Pure odontogram model: FDI layout, tooth anatomy, finding styles and the per-tooth state derived from the chart API. */
import type { ChartEntry, ChartFinding, PlanItem, ToothSurface } from "@aarogyam/api-client";

export type Dentition = "adult" | "child";
export type ArchName = "upper" | "lower";
export type ToothKind = "incisor" | "canine" | "premolar" | "molar";

/** Teeth in display order, left to right as the clinician faces the patient (patient's right on the left). */
export const ARCHES: Readonly<Record<Dentition, Readonly<Record<ArchName, readonly number[]>>>> = {
  adult: {
    upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
    lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
  },
  child: {
    upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
    lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
  },
};

export const SURFACES: readonly ToothSurface[] = ["M", "D", "O", "B", "L"];

export function isPrimary(tooth: number): boolean {
  return Math.floor(tooth / 10) >= 5;
}

export function dentitionOf(tooth: number): Dentition {
  return isPrimary(tooth) ? "child" : "adult";
}

export function archOf(tooth: number): ArchName {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6 ? "upper" : "lower";
}

export function kindOf(tooth: number): ToothKind {
  const position = tooth % 10;
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (isPrimary(tooth)) return "molar";
  return position <= 5 ? "premolar" : "molar";
}

/** Patient's right quadrants (1, 4, 5, 8) are drawn on the left, so their mesial side faces right, towards the midline. */
export function mesialFacesRight(tooth: number): boolean {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 4 || quadrant === 5 || quadrant === 8;
}

const KIND_NAME: Readonly<Record<ToothKind, string>> = { incisor: "incisor", canine: "canine", premolar: "premolar", molar: "molar" };
export const kindName = (tooth: number): string => `${isPrimary(tooth) ? "primary " : ""}${KIND_NAME[kindOf(tooth)]}`;

const isAnterior = (tooth: number): boolean => kindOf(tooth) === "incisor" || kindOf(tooth) === "canine";

export function surfaceLabel(tooth: number, surface: ToothSurface): string {
  switch (surface) {
    case "M":
      return "Mesial";
    case "D":
      return "Distal";
    case "O":
      return isAnterior(tooth) ? "Incisal" : "Occlusal";
    case "B":
      return isAnterior(tooth) ? "Facial" : "Buccal";
    case "L":
      return archOf(tooth) === "upper" ? "Palatal" : "Lingual";
  }
}

/** The short code shown on the surface itself: M, D, O/I, B/F, L/P. */
export function surfaceCode(tooth: number, surface: ToothSurface): string {
  return surface === "O" ? (isAnterior(tooth) ? "I" : "O") : surface === "B" ? (isAnterior(tooth) ? "F" : "B") : surface === "L" ? (archOf(tooth) === "upper" ? "P" : "L") : surface;
}

// Findings ---------------------------------------------------------------------------------------

export type PatternName = "none" | "solid" | "stripes" | "cross" | "dots" | "vertical" | "grid" | "bars";

export interface FindingStyle {
  readonly label: string;
  /** CSS custom property (set in odontogram.css) that carries the finding's colour. */
  readonly colour: string;
  readonly pattern: PatternName;
  /** Whole-tooth findings cannot be recorded on one surface (the API refuses it). */
  readonly wholeTooth: boolean;
  readonly description: string;
}

export const FINDING_ORDER: readonly ChartFinding[] = ["sound", "caries", "filled", "crown", "root_canal", "missing", "implant", "bridge", "fractured", "watch"];

export const FINDING_STYLE: Readonly<Record<ChartFinding, FindingStyle>> = {
  sound: { label: "Sound", colour: "--odo-muted", pattern: "none", wholeTooth: false, description: "No finding" },
  caries: { label: "Caries", colour: "--odo-danger", pattern: "solid", wholeTooth: false, description: "Solid fill" },
  filled: { label: "Filled", colour: "--odo-info", pattern: "stripes", wholeTooth: false, description: "Diagonal stripes" },
  crown: { label: "Crown", colour: "--odo-warning", pattern: "solid", wholeTooth: true, description: "Light fill, heavy outline" },
  root_canal: { label: "Root canal", colour: "--odo-warning", pattern: "vertical", wholeTooth: true, description: "Vertical lines, line in root" },
  missing: { label: "Missing", colour: "--odo-muted", pattern: "none", wholeTooth: true, description: "Dashed ghost outline" },
  implant: { label: "Implant", colour: "--odo-primary", pattern: "grid", wholeTooth: true, description: "Grid, screw in root" },
  bridge: { label: "Bridge", colour: "--odo-primary", pattern: "bars", wholeTooth: true, description: "Horizontal bars, joining bar" },
  fractured: { label: "Fractured", colour: "--odo-danger", pattern: "cross", wholeTooth: false, description: "Cross-hatch" },
  watch: { label: "Watch", colour: "--odo-warning", pattern: "dots", wholeTooth: false, description: "Dots" },
};

export const isWholeToothFinding = (finding: ChartFinding): boolean => FINDING_STYLE[finding].wholeTooth;

// Treatment status ------------------------------------------------------------------------------

export type TreatmentState = "planned" | "done";

export interface TreatmentMark {
  readonly id: string;
  readonly name: string;
  readonly state: TreatmentState;
  readonly extraction: boolean;
  readonly surfaces: readonly ToothSurface[];
}

export const TREATMENT_LABEL: Readonly<Record<TreatmentState, string>> = { planned: "Planned", done: "Done" };

/** Plan items on teeth: proposed and accepted are planned, done is done, cancelled is left out. */
export function treatmentsByTooth(items: readonly PlanItem[]): ReadonlyMap<number, readonly TreatmentMark[]> {
  const map = new Map<number, TreatmentMark[]>();
  for (const item of items) {
    if (item.tooth == null || item.status === "cancelled") continue;
    const list = map.get(item.tooth) ?? [];
    list.push({
      id: item.id,
      name: item.name,
      state: item.status === "done" ? "done" : "planned",
      extraction: /extract|removal/i.test(item.name),
      surfaces: item.surfaces,
    });
    map.set(item.tooth, list);
  }
  return map;
}

// Per tooth state -------------------------------------------------------------------------------

export interface ToothState {
  readonly tooth: number;
  /** The current whole-tooth finding, if any. */
  readonly whole: ChartFinding | undefined;
  readonly surfaces: Readonly<Partial<Record<ToothSurface, ChartFinding>>>;
  readonly treatments: readonly TreatmentMark[];
}

export function toothStates(current: readonly ChartEntry[], treatments: ReadonlyMap<number, readonly TreatmentMark[]>): ReadonlyMap<number, ToothState> {
  const wholes = new Map<number, ChartFinding>();
  const surfaces = new Map<number, Partial<Record<ToothSurface, ChartFinding>>>();
  for (const entry of current) {
    if (entry.status !== "current") continue;
    if (entry.surface == null) {
      wholes.set(entry.tooth, entry.finding);
    } else {
      surfaces.set(entry.tooth, { ...surfaces.get(entry.tooth), [entry.surface]: entry.finding });
    }
  }
  const out = new Map<number, ToothState>();
  for (const tooth of new Set([...wholes.keys(), ...surfaces.keys(), ...treatments.keys()])) {
    out.set(tooth, { tooth, whole: wholes.get(tooth), surfaces: surfaces.get(tooth) ?? {}, treatments: treatments.get(tooth) ?? [] });
  }
  return out;
}

export const EMPTY_STATE = (tooth: number): ToothState => ({ tooth, whole: undefined, surfaces: {}, treatments: [] });

/** The most telling single finding of a tooth, for its name and the summary: whole-tooth first, then the worst surface. */
export function headline(state: ToothState): ChartFinding {
  if (state.whole !== undefined && state.whole !== "sound") return state.whole;
  const found = Object.values(state.surfaces).filter((f) => f !== "sound");
  for (const finding of ["caries", "fractured", "watch", "filled"] as const) {
    if (found.includes(finding)) return finding;
  }
  return "sound";
}

/** A plain-language description of a tooth, used as its accessible name and tooltip. */
export function describeTooth(state: ToothState): string {
  const parts: string[] = [];
  if (state.whole !== undefined && state.whole !== "sound") parts.push(FINDING_STYLE[state.whole].label);
  for (const surface of SURFACES) {
    const finding = state.surfaces[surface];
    if (finding !== undefined && finding !== "sound") parts.push(`${FINDING_STYLE[finding].label} on ${surfaceLabel(state.tooth, surface).toLowerCase()}`);
  }
  for (const mark of state.treatments) parts.push(`${mark.name} ${TREATMENT_LABEL[mark.state].toLowerCase()}`);
  return `Tooth ${String(state.tooth)}, ${kindName(state.tooth)}, ${parts.length === 0 ? "sound" : parts.join("; ")}`;
}

export interface Summary {
  readonly present: number;
  readonly total: number;
  readonly caries: number;
  readonly restored: number;
  readonly missing: number;
  readonly planned: number;
}

export function summarise(teeth: readonly number[], states: ReadonlyMap<number, ToothState>): Summary {
  let missing = 0;
  let caries = 0;
  let restored = 0;
  let planned = 0;
  for (const tooth of teeth) {
    const state = states.get(tooth);
    if (state === undefined) continue;
    if (state.whole === "missing") missing += 1;
    if (headline(state) === "caries" || Object.values(state.surfaces).includes("caries")) caries += 1;
    if (state.whole === "crown" || state.whole === "root_canal" || state.whole === "implant" || state.whole === "bridge" || Object.values(state.surfaces).includes("filled")) restored += 1;
    planned += state.treatments.filter((t) => t.state === "planned").length;
  }
  return { present: teeth.length - missing, total: teeth.length, caries, restored, missing, planned };
}

// Geometry --------------------------------------------------------------------------------------

export const CROWN_H = 34;
export const ROOT_H = 30;
export const CELL_H = CROWN_H + ROOT_H;
const WIDTH: Readonly<Record<ToothKind, number>> = { incisor: 28, canine: 30, premolar: 34, molar: 42 };
const GAP = 5;
const CURVE = 16;
const LABEL_H = 22;

export interface Placed {
  readonly tooth: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly rotate: number;
}

export interface ArchLayout {
  readonly width: number;
  readonly height: number;
  readonly teeth: readonly Placed[];
}

/** Lays an arch out on a gentle curve: upper opens upwards, lower downwards, both rotated slightly with the curve. */
export function layoutArch(teeth: readonly number[], arch: ArchName): ArchLayout {
  const widths = teeth.map((t) => WIDTH[kindOf(t)]);
  const total = widths.reduce((a, b) => a + b, 0) + GAP * (teeth.length - 1);
  const pad = 16;
  let cursor = pad;
  const placed = teeth.map((tooth, i): Placed => {
    const w = widths[i] ?? 30;
    const centre = cursor + w / 2;
    cursor += w + GAP;
    const t = (centre - (pad + total / 2)) / (total / 2);
    const lift = CURVE * t * t;
    return { tooth, x: centre - w / 2, y: arch === "upper" ? LABEL_H + CURVE - lift : LABEL_H + lift, w, rotate: (arch === "upper" ? 1 : -1) * t * 9 };
  });
  return { width: total + pad * 2, height: CELL_H + CURVE + LABEL_H * 2, teeth: placed };
}

export { LABEL_H };

export interface ZoneBox {
  readonly surface: ToothSurface;
  readonly points: string;
  readonly labelX: number;
  readonly labelY: number;
}

/** The five surface zones of a crown of width `w`: B on the root side, L on the biting side, M/D left and right, O in the middle. */
export function crownZones(tooth: number, w: number): readonly ZoneBox[] {
  const h = CROWN_H;
  const ix = w * 0.28;
  const iy = h * 0.3;
  const poly = (...pts: [number, number][]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const right: ToothSurface = mesialFacesRight(tooth) ? "M" : "D";
  const left: ToothSurface = mesialFacesRight(tooth) ? "D" : "M";
  return [
    { surface: "B", points: poly([0, 0], [w, 0], [w - ix, iy], [ix, iy]), labelX: w / 2, labelY: iy / 2 },
    { surface: "L", points: poly([0, h], [w, h], [w - ix, h - iy], [ix, h - iy]), labelX: w / 2, labelY: h - iy / 2 },
    { surface: left, points: poly([0, 0], [ix, iy], [ix, h - iy], [0, h]), labelX: ix / 2, labelY: h / 2 },
    { surface: right, points: poly([w, 0], [w - ix, iy], [w - ix, h - iy], [w, h]), labelX: w - ix / 2, labelY: h / 2 },
    { surface: "O", points: poly([ix, iy], [w - ix, iy], [w - ix, h - iy], [ix, h - iy]), labelX: w / 2, labelY: h / 2 },
  ];
}

/** Crown outline with the root side at the top and the biting edge at the bottom. */
export function crownPath(kind: ToothKind, w: number): string {
  const h = CROWN_H;
  switch (kind) {
    case "incisor":
      return `M0,5 Q0,0 5,0 H${String(w - 5)} Q${String(w)},0 ${String(w)},5 L${String(w - 1.5)},${String(h - 6)} Q${String(w - 2)},${String(h)} ${String(w - 8)},${String(h)} H8 Q2,${String(h)} 1.5,${String(h - 6)} Z`;
    case "canine":
      return `M0,5 Q0,0 5,0 H${String(w - 5)} Q${String(w)},0 ${String(w)},5 V${String(h * 0.55)} Q${String(w - 3)},${String(h * 0.8)} ${String(w / 2)},${String(h)} Q3,${String(h * 0.8)} 0,${String(h * 0.55)} Z`;
    case "premolar":
      return `M0,10 Q0,0 10,0 H${String(w - 10)} Q${String(w)},0 ${String(w)},10 V${String(h - 11)} Q${String(w)},${String(h)} ${String(w - 11)},${String(h)} H11 Q0,${String(h)} 0,${String(h - 11)} Z`;
    case "molar":
      return `M0,9 Q0,0 9,0 H${String(w - 9)} Q${String(w)},0 ${String(w)},9 V${String(h - 8)} Q${String(w)},${String(h)} ${String(w - 8)},${String(h)} H${String(w * 0.62)} Q${String(w / 2)},${String(h - 3)} ${String(w * 0.38)},${String(h)} H8 Q0,${String(h)} 0,${String(h - 8)} Z`;
  }
}

/** Root silhouette rising from the crown edge (y = 0) to y = -ROOT_H. */
export function rootPath(kind: ToothKind, w: number): string {
  const r = ROOT_H;
  const s = (n: number) => n.toFixed(1);
  if (kind === "molar") {
    return `M3,1 C4,${s(-r * 0.55)} ${s(w * 0.14)},${s(-r)} ${s(w * 0.24)},${s(-r)} C${s(w * 0.34)},${s(-r)} ${s(w * 0.4)},${s(-r * 0.45)} ${s(w / 2)},${s(-r * 0.3)} C${s(w * 0.6)},${s(-r * 0.45)} ${s(w * 0.66)},${s(-r)} ${s(w * 0.76)},${s(-r)} C${s(w * 0.86)},${s(-r)} ${s(w - 4)},${s(-r * 0.55)} ${s(w - 3)},1 Z`;
  }
  const tip = kind === "canine" ? r * 1.0 : r * 0.92;
  return `M3,1 C${s(w * 0.12)},${s(-r * 0.5)} ${s(w * 0.36)},${s(-tip)} ${s(w / 2)},${s(-tip)} C${s(w * 0.64)},${s(-tip)} ${s(w * 0.88)},${s(-r * 0.5)} ${s(w - 3)},1 Z`;
}
