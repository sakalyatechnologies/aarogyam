// The mouth view's words and states (design §1.12, §1.13). Pure functions over the server's
// MouthSnapshot: the client renders the JSON, it never builds it. Only recorded facts are said;
// generic text is always labelled "Usually", "Usual steps" or "What to expect".
import type { MouthSnapshot } from "@aarogyam/api-client";

import type { Overlay, Surface } from "../mouth-art/overlays.js";
import type { BrushingBand } from "../mouth-art/stage-steps.js";

export type Snapshot = MouthSnapshot;
export type SnapTooth = MouthSnapshot["teeth"][number];
export type SnapTreatment = NonNullable<SnapTooth["treatments"]>[number];
export type SnapStep = SnapTreatment["steps"][number];
export type SnapPosition = MouthSnapshot["positions"][number];

const POS_NAME: Readonly<Record<number, string>> = { 1: "front tooth", 2: "side front tooth", 3: "eye tooth", 4: "first premolar", 5: "second premolar", 6: "6-year molar", 7: "12-year molar", 8: "wisdom tooth" };
const PRIM_NAME: Readonly<Record<number, string>> = { 1: "front milk tooth", 2: "side front milk tooth", 3: "milk eye tooth", 4: "first milk molar", 5: "back milk tooth" };

export interface ToothInfo {
  fdi: number;
  pos: number;
  primary: boolean;
  upper: boolean;
  right: boolean;
  /** "Upper left front tooth". */
  name: string;
  kind: "milk tooth" | "permanent tooth";
}

export function toothInfo(fdi: number): ToothInfo {
  const q = Math.floor(fdi / 10), pos = fdi % 10, primary = q >= 5;
  const qq = primary ? q - 4 : q;
  const upper = qq <= 2, right = qq === 1 || qq === 4;
  const where = `${upper ? "Upper" : "Lower"} ${right ? "right" : "left"}`;
  const name = `${where} ${(primary ? PRIM_NAME[pos] : POS_NAME[pos]) ?? "tooth"}`;
  return { fdi, pos, primary, upper, right, name, kind: primary ? "milk tooth" : "permanent tooth" };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-26" -> "Thu 26 Nov" (no time zone shift: the date is a calendar day). */
export function dayLabel(iso: string, weekday = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const base = `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ""}`;
  return weekday ? `${DAYS[d.getUTCDay()] ?? ""} ${base}` : base;
}

export const MODEL_TITLE: Readonly<Record<string, string>> = {
  root_canal: "Root canal treatment", filling: "Filling", extraction: "Tooth removal", wisdom_extraction: "Wisdom tooth removal",
  crown: "Crown", scaling: "Cleaning", implant: "Implant", sealant: "Sealant",
};
export const modelTitle = (model: string): string => MODEL_TITLE[model] ?? "Treatment";

export const FINDING_WORDS: Readonly<Record<string, string>> = {
  caries: "Decay", fractured: "Broken tooth", watch: "To watch", missing: "Missing tooth", filled: "Filling", crown: "Crown",
  root_canal: "Root canal", implant: "Implant", bridge: "Bridge", sound: "Healthy",
};
export const findingWord = (f: string): string => FINDING_WORDS[f] ?? "Recorded";

const DEPTH_WORDS: Readonly<Record<string, string>> = { enamel: "Early decay", dentin: "Decay into the tooth", near_pulp: "Decay close to the nerve" };
const ERUPTION_WORDS: Readonly<Record<string, string>> = { partial: "Partly through the gum", impacted: "Impacted", unerupted: "Not through yet" };
const ANGLE_WORDS: Readonly<Record<string, string>> = { vertical: "upright", mesioangular: "tilted forward", distoangular: "tilted back", horizontal: "lying on its side" };

export type Badge = "found" | "here" | "elsewhere" | "before";

export interface PositionState {
  fdi: number;
  arch: "upper" | "lower";
  shown: "tooth" | "sound" | "not_recorded";
  tooth: SnapTooth | undefined;
  /** Treated or in progress today. */
  today: boolean;
  planned: boolean;
  found: boolean;
  badge: Badge | undefined;
  /** Work done here today (Present labels it "Done here · today"). */
  doneToday: boolean;
  other: SnapPosition["other"];
}

/** Something recorded today that needs the patient's attention (a missing tooth or an erupted 8 is not). */
export function hasIssue(t: SnapTooth): boolean {
  const d = t.details;
  return (t.problems ?? []).some((p) => p !== "missing") || d?.infection !== undefined || d?.bleeding === true || (d?.mobility ?? 0) > 0 || (d?.pocket_mm ?? 0) >= 4 ||
    (d?.eruption !== undefined && d.eruption !== "erupted");
}

const isTreatedToday = (t: SnapTooth | undefined) => t?.today === "treated" || t?.today === "in_progress";

function stateOf(p: SnapPosition, arch: "upper" | "lower", teeth: ReadonlyMap<number, SnapTooth>): PositionState {
  const tooth = p.shown === "not_recorded" ? undefined : teeth.get(p.tooth);
  const shown = p.shown === "tooth" || p.shown === "sound" ? p.shown : "not_recorded";
  // Found today: a problem recorded in this visit, or the tooth marked "needs treatment" in it.
  const found = tooth !== undefined && tooth.today === "found" && (hasIssue(tooth) || tooth.health === "needs_treatment");
  const work = tooth?.work?.[0];
  const origin = work?.origin === "here" || work?.origin === "elsewhere" || work?.origin === "before" ? work.origin : undefined;
  return {
    fdi: p.tooth, arch, shown, tooth,
    today: isTreatedToday(tooth), planned: tooth?.planned === true, found,
    badge: found ? "found" : origin,
    doneToday: (tooth?.work ?? []).some((w) => w.origin === "here" && w.today === true),
    other: p.other,
  };
}

/** Positions in arch order as the viewer sees them: upper and lower, from the patient's right to left. */
export function archStates(snap: Snapshot): { upper: PositionState[]; lower: PositionState[] } {
  const teeth = new Map(snap.teeth.map((t) => [t.tooth, t]));
  const quad = (p: SnapPosition) => (p.quadrant > 4 ? p.quadrant - 4 : p.quadrant);
  const side = (q: number, dir: 1 | -1) => snap.positions.filter((p) => quad(p) === q).sort((a, b) => dir * (a.index - b.index));
  return {
    upper: [...side(1, -1), ...side(2, 1)].map((p) => stateOf(p, "upper", teeth)),
    lower: [...side(4, -1), ...side(3, 1)].map((p) => stateOf(p, "lower", teeth)),
  };
}

/** The state of any tooth: its overview position, or (a tooth only named in a row) one built from the snapshot. */
export function stateFor(snap: Snapshot, states: { upper: PositionState[]; lower: PositionState[] }, fdi: number): PositionState {
  const hit = [...states.upper, ...states.lower].find((s) => s.fdi === fdi);
  if (hit !== undefined) return hit;
  const tooth = snap.teeth.find((t) => t.tooth === fdi);
  const arch = toothInfo(fdi).upper ? "upper" : "lower";
  return stateOf({ quadrant: Math.floor(fdi / 10), index: fdi % 10, tooth: fdi, shown: tooth === undefined ? "not_recorded" : "tooth" }, arch, new Map(tooth === undefined ? [] : [[fdi, tooth]]));
}

/** "N teeth need attention · M treated today". */
export function summaryCounts(snap: Snapshot): { need: number; today: number } {
  let need = 0, today = 0;
  for (const t of snap.teeth) {
    if (hasIssue(t) || t.planned === true || (t.treatments ?? []).some((tr) => tr.state === "in_progress")) need += 1;
    if (isTreatedToday(t)) today += 1;
  }
  return { need, today };
}

/** The treatment the stepper walks: in progress first, then planned, then done. */
export function mainTreatment(t: SnapTooth | undefined): SnapTreatment | undefined {
  const list = t?.treatments ?? [];
  return list.find((x) => x.state === "in_progress") ?? list.find((x) => x.state === "planned") ?? list.find((x) => x.state === "done") ?? list[0];
}

export function originWords(origin: string, doneOn: string | undefined, present: boolean, today: boolean): string {
  if (origin === "elsewhere") return "Done elsewhere";
  if (origin === "before") return "Done before";
  if (today) return present ? "Done here · today" : "Done here today";
  return doneOn === undefined ? "Done here" : `Done here · ${dayLabel(doneOn, false)}`;
}

/** The spoken label of an overview tooth: "Upper left front tooth, 21: root canal in progress, sitting 4; crown planned". */
export function spokenLabel(s: PositionState, present = false): string {
  const i = toothInfo(s.fdi);
  if (s.shown === "not_recorded" || s.tooth === undefined) return `${i.name}, ${String(s.fdi)}: not recorded`;
  const t = s.tooth;
  const parts: string[] = [];
  for (const tr of t.treatments ?? []) {
    if (tr.state === "in_progress") parts.push(`${modelTitle(tr.model).toLowerCase()} in progress${t.sitting === undefined ? "" : `, sitting ${String(t.sitting)}`}`);
  }
  if (t.today === "treated") parts.push("treated today");
  if (s.found) parts.push(`${problemWords(t).join(", ").toLowerCase()} found today`);
  for (const w of t.work ?? []) parts.push(`${findingWord(w.finding).toLowerCase()}, ${originWords(w.origin, w.done_on, present, w.today === true).toLowerCase()}`);
  for (const tr of t.treatments ?? []) if (tr.state === "planned") parts.push(`${modelTitle(tr.model).toLowerCase()} planned`);
  if (parts.length === 0) parts.push(s.shown === "sound" ? "nothing to treat" : "recorded");
  return `${i.name}, ${String(s.fdi)}: ${parts.join("; ")}`;
}

const SHORT_DEPTH: Readonly<Record<string, string>> = { enamel: "enamel", dentin: "dentin", near_pulp: "near nerve" };
/** A tooth with something from today: found today, or treated or in progress today. */
export const isToday = (s: PositionState): boolean => s.today || s.found;

/** Present's one line for the doctor: "Today: 46 decay (near nerve), 21 root canal sitting 4". Undefined when nothing is from today. */
export function todayLine(states: readonly PositionState[]): string | undefined {
  const parts = states.filter(isToday).map((s) => {
    const t = s.tooth;
    if (t === undefined) return String(s.fdi);
    const words: string[] = [];
    if (s.today) {
      const tr = mainTreatment(t);
      words.push(`${modelTitle(tr?.model ?? "").toLowerCase().replace(/ treatment$/, "")}${t.sitting === undefined ? "" : ` sitting ${String(t.sitting)}`}`);
    }
    if (s.found) {
      for (const p of (t.problems ?? []).filter((x) => x !== "missing")) {
        const depth = p === "caries" ? t.details?.caries_depth : undefined;
        words.push(`${findingWord(p).toLowerCase()}${depth === undefined ? "" : ` (${SHORT_DEPTH[depth] ?? depth})`}`);
      }
      if (t.details?.infection !== undefined) words.push(t.details.infection);
    }
    return `${String(s.fdi)} ${words.join(", ")}`.trim();
  });
  return parts.length === 0 ? undefined : `Today: ${parts.join(", ")}`;
}

/** Proposed plan work the server marks `recommended` (optional field): a dashed "Recommended" ring, not "Planned". */
export function isRecommended(t: SnapTooth | undefined): boolean {
  if (t === undefined) return false;
  const flag = (o: object) => "recommended" in o && o.recommended === true;
  return flag(t) || (t.treatments ?? []).some(flag);
}

/** Recorded problems in patient words ("Decay into the tooth", "Broken tooth"). */
export function problemWords(t: SnapTooth): string[] {
  return (t.problems ?? []).filter((p) => p !== "missing" || t.finding === "missing").map((p) => {
    if (p === "caries" && t.details?.caries_depth !== undefined) return DEPTH_WORDS[t.details.caries_depth] ?? "Decay";
    return findingWord(p);
  });
}

export type ChipTone = "brand" | "dashed" | "found" | "slate" | "amber";
export interface Chip { tone: ChipTone; text: string }

/** Detail notes with their recorded date (DT3); the server already hides them on a missing tooth. */
export function conditionChips(t: SnapTooth): Chip[] {
  const d = t.details;
  if (d === undefined) return [];
  const on = d.condition_on === undefined ? "" : ` · recorded ${dayLabel(d.condition_on, false)}`;
  const out: Chip[] = [];
  if (d.infection !== undefined) out.push({ tone: "found", text: `${d.infection === "abscess" ? "Abscess at the root" : "Infection at the root"}${on}` });
  if (d.mobility !== undefined && d.mobility > 0) out.push({ tone: "found", text: `${toothInfo(t.tooth).primary ? "Loose milk tooth" : "Loose"} (grade ${String(d.mobility)})${on}` });
  if (d.bleeding === true) out.push({ tone: "found", text: `Gums bleed${on}` });
  if (d.pocket_mm !== undefined) out.push({ tone: "slate", text: `Gum pocket ${String(d.pocket_mm)} mm${on}` });
  if (d.eruption !== undefined && d.eruption !== "erupted") {
    const angle = d.angulation === undefined ? "" : ` (${ANGLE_WORDS[d.angulation] ?? d.angulation})`;
    out.push({ tone: "slate", text: `${ERUPTION_WORDS[d.eruption] ?? d.eruption}${angle}` });
  }
  return out;
}

/** The chips under the tooth detail title. */
export function detailChips(s: PositionState): Chip[] {
  const t = s.tooth;
  if (t === undefined) return [];
  const main = mainTreatment(t);
  const out: Chip[] = [];
  for (const tr of t.treatments ?? []) {
    if (tr.state === "in_progress") out.push({ tone: "brand", text: `In progress${t.sitting === undefined ? "" : ` · sitting ${String(t.sitting)}`}` });
    else if (tr.state === "planned") out.push({ tone: "dashed", text: `${modelTitle(tr.model)} planned` });
    else if (tr.state === "done" && tr === main) out.push({ tone: "brand", text: "Done" });
  }
  if (s.found) out.unshift({ tone: "found", text: "Found today" });
  out.push(...conditionChips(t));
  if (s.other !== undefined) {
    const o = toothInfo(s.other.tooth);
    out.push({ tone: "slate", text: `${o.primary ? "Milk tooth" : "Permanent"} ${String(s.other.tooth)}: ${s.other.finding.replace(/_/g, " ")}` });
  }
  return out;
}

/** The detail title: the treatment walked, else the problem, else the work, else the position's state. */
export function detailTitle(s: PositionState): string {
  const t = s.tooth;
  if (s.shown === "not_recorded" || t === undefined) return "Not recorded";
  const main = mainTreatment(t);
  const problems = problemWords(t);
  if (main !== undefined && !(main.state === "planned" && problems.length > 0)) return modelTitle(main.model);
  if (problems.length > 0) return s.found ? `${problems[0] ?? "Decay"} found today` : (problems[0] ?? "Recorded");
  const work = t.work?.[0];
  if (work !== undefined) return findingWord(work.finding);
  return s.shown === "sound" ? "Nothing to treat" : "Recorded";
}

export interface StepLabel {
  /** Under the bar ("Visit 1", "Today", "Next", "Then"). */
  short: string;
  /** The panel's heading ("Visit 4 (today)", "Next visit: Thu 26 Nov", "Usual step"). */
  heading: string;
  /** The chip under the words, if any. */
  tag: Chip | undefined;
}

export function stepLabels(tr: SnapTreatment, t: SnapTooth | undefined): StepLabel[] {
  const today = isTreatedToday(t);
  let usual = 0;
  return tr.steps.map((s): StepLabel => {
    const visit = s.sitting === undefined ? (s.on === undefined ? undefined : `Visit on ${dayLabel(s.on, false)}`) : `Visit ${String(s.sitting)}`;
    switch (s.state) {
      case "done":
        return { short: s.sitting === undefined ? (s.on === undefined ? "Done" : dayLabel(s.on, false)) : `Visit ${String(s.sitting)}`, heading: visit ?? "Done", tag: { tone: "brand", text: "Done" } };
      case "current":
        if (s.key === FOUND_STEP) return { short: t?.today === "found" ? "Today" : "Now", heading: t?.today === "found" ? "Found today" : "Recorded", tag: undefined };
        return { short: today ? "Today" : (visit ?? "Now"), heading: `${visit ?? "This visit"}${today ? " (today)" : ""}`, tag: undefined };
      case "next":
        return { short: "Next", heading: s.on === undefined ? "Next visit" : `Next visit: ${dayLabel(s.on)}`, tag: { tone: "amber", text: s.on === undefined ? "Next" : `Next visit: ${dayLabel(s.on)}` } };
      default:
        usual += 1;
        return { short: usual === 1 ? "Usually" : "Then", heading: "Usual step", tag: { tone: "dashed", text: "Usual step" } };
    }
  });
}

export const FOUND_STEP = "_found";
const SURFACE_WORDS: Readonly<Record<string, string>> = { O: "chewing", B: "outer", L: "inner", M: "front", D: "back" };

/**
 * When nothing about the treatment is recorded yet (every step `usual`) but a problem is, the stepper
 * opens on what was recorded ("Today: decay found on the chewing and back sides"), drawn as charted.
 */
export function withFoundStep(tr: SnapTreatment | undefined, t: SnapTooth | undefined): SnapTreatment | undefined {
  if (tr === undefined || t === undefined || !tr.steps.every((s) => s.state === "usual")) return tr;
  const problems = problemWords(t);
  if (problems.length === 0) return tr;
  const sides = (t.surfaces ?? []).map((s) => SURFACE_WORDS[s]).filter((s): s is string => s !== undefined);
  const where = sides.length === 0 ? "" : ` on the ${sides.join(" and ")} ${sides.length === 1 ? "side" : "sides"}`;
  const words = `${problems.join(", ")}${where}`;
  return { ...tr, steps: [{ key: FOUND_STEP, scene: "", words, after_words: "", state: "current" }, ...tr.steps] };
}

/** `after_words` start with "Usually"; shown under a "Usually" label (m6), so the word isn't repeated. */
export function usuallyText(afterWords: string): string {
  const rest = afterWords.replace(/^usually,?\s+/i, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

const SURFACES: readonly Surface[] = ["M", "O", "D", "B", "L"];
const OCCLUSAL: readonly Surface[] = ["O"];
const asSurface = (s: string): Surface | undefined => SURFACES.find((x) => x === s);
const depthOf = (d: string | undefined) => (d === "enamel" || d === "dentin" || d === "near_pulp" ? d : undefined);

/** What is drawn on the tooth art: its current finding and the recorded details (nothing unrecorded). */
export function overlaysFor(t: SnapTooth | undefined, withDetails = true): Overlay[] {
  if (t === undefined) return [];
  const out: Overlay[] = [];
  const surfaces = (t.surfaces ?? []).map(asSurface).filter((s): s is Surface => s !== undefined);
  const material = t.material === undefined ? {} : { material: t.material };
  switch (t.finding) {
    case "caries": {
      const depth = depthOf(t.details?.caries_depth);
      for (const surface of surfaces.length === 0 ? OCCLUSAL : surfaces) out.push(depth === undefined ? { kind: "caries", surface } : { kind: "caries", surface, depth });
      break;
    }
    case "filled": out.push({ kind: "filled", surfaces: surfaces.length === 0 ? [...OCCLUSAL] : surfaces, ...material }); break;
    case "crown": out.push({ kind: "crown", ...material }); break;
    case "root_canal": out.push({ kind: "root_canal" }); break;
    case "implant": out.push({ kind: "implant", ...material }); break;
    case "bridge": out.push({ kind: "bridge_abutment", ...material }); break;
    case "missing": out.push({ kind: "missing" }); break;
    case "fractured": out.push({ kind: "fracture" }); break;
    default: break;
  }
  if (withDetails) out.push(...detailOverlays(t));
  return out;
}

export function detailOverlays(t: SnapTooth): Overlay[] {
  const d = t.details;
  if (d === undefined) return [];
  const out: Overlay[] = [];
  if (d.infection === "infection" || d.infection === "abscess") out.push({ kind: "infection", type: d.infection });
  if (d.bleeding === true) out.push({ kind: "bleeding" });
  if (d.pocket_mm !== undefined) out.push({ kind: "pocket", mm: d.pocket_mm });
  if (d.mobility === 1 || d.mobility === 2 || d.mobility === 3) out.push({ kind: "mobility", grade: d.mobility });
  return out;
}

/**
 * A stage step drawn in the tooth's other views (§1.12): what that step looks like from the front or
 * the chewing side, as overlays. Undefined when the kit has no such picture: the view is then hidden
 * for that step rather than showing the tooth as charted.
 */
export function stepOverlays(artKey: string, t: SnapTooth | undefined): Overlay[] | undefined {
  const surfaces = (t?.surfaces ?? []).map(asSurface).filter((s): s is Surface => s !== undefined);
  const material = t?.material === undefined ? {} : { material: t.material };
  const crownMaterial = t?.finding === "crown" ? material : {};
  switch (artKey) {
    case "root_canal.obturation": return [{ kind: "root_canal" }];
    case "root_canal.crown": return [{ kind: "root_canal" }, { kind: "crown", ...crownMaterial }];
    case "filling.decay": return (t === undefined ? [] : overlaysFor(t, false)).filter((o) => o.kind === "caries");
    case "filling.filled": return [{ kind: "filled", surfaces: surfaces.length === 0 ? [...OCCLUSAL] : surfaces, ...(t?.finding === "filled" ? material : {}) }];
    case "crown.crown": return [{ kind: "crown", ...crownMaterial }];
    case "extraction.socket_healing": case "extraction.healed": case "wisdom_extraction.socket_healing": case "wisdom_extraction.healed":
    case "implant.post": case "implant.abutment":
      return [{ kind: "missing" }];
    case "implant.crown": return [{ kind: "implant", ...(t?.finding === "implant" ? material : {}) }];
    default: return undefined;
  }
}

const MATERIAL_WORDS: Readonly<Record<string, string>> = { calcium_hydroxide: "calcium hydroxide", mta: "MTA" };
/** Words for a recorded material in a callout ("calcium hydroxide"); none for unknown or custom ids. */
export const materialWords = (m: string | undefined): string | undefined => (m === undefined ? undefined : MATERIAL_WORDS[m]);

export interface WaitFrame {
  /** "Now" for the recorded frame, "Later" for the usual ones. */
  when: "now" | "later";
  caption: string;
  overlays: Overlay[];
}
const DEPTHS = ["enamel", "dentin", "near_pulp"] as const;
const WAIT_WORDS: Readonly<Record<(typeof DEPTHS)[number], string>> = { enamel: "Early decay", dentin: "Decay into the tooth", near_pulp: "Close to the nerve" };

/**
 * "If you wait" (VS1 B6, DT4): from a recorded decay depth on a tooth with decay, the recorded frame
 * then up to two usual later frames (deeper decay; past `near_pulp`, the nerve and a root canal).
 * Only the first frame is recorded; the caller shows the later frames under "Usually". Undefined
 * without a recorded depth.
 */
export function ifWaitFrames(t: SnapTooth | undefined): { surface: Surface; frames: WaitFrame[] } | undefined {
  if (t === undefined) return undefined;
  const depth = depthOf(t.details?.caries_depth);
  const caries = t.finding === "caries" || (t.problems ?? []).includes("caries");
  if (depth === undefined || !caries) return undefined;
  const surface = (t.surfaces ?? []).map(asSurface).find((s): s is Surface => s !== undefined) ?? "O";
  const at = DEPTHS.indexOf(depth);
  const frames: WaitFrame[] = [{ when: "now", caption: WAIT_WORDS[depth], overlays: [{ kind: "caries", surface, depth }] }];
  for (const d of DEPTHS.slice(at + 1)) frames.push({ when: "later", caption: WAIT_WORDS[d], overlays: [{ kind: "caries", surface, depth: d }] });
  frames.push({ when: "later", caption: "Reaches the nerve: a root canal", overlays: [{ kind: "caries", surface, depth: "near_pulp" }, { kind: "infection", type: "infection" }] });
  return { surface, frames: frames.slice(0, 3) };
}

/** Layer params for a stage scene: the first recorded surface, the recorded depth, the material. */
export function stageParams(t: SnapTooth | undefined): { S?: string; D?: string; M?: string } {
  const out: { S?: string; D?: string; M?: string } = {};
  const s = t?.surfaces?.map(asSurface).find((x) => x !== undefined && x !== "B" && x !== "L");
  if (s !== undefined) out.S = s;
  const d = depthOf(t?.details?.caries_depth);
  if (d !== undefined) out.D = d;
  if (t?.material !== undefined) out.M = t.material;
  return out;
}

/**
 * The brushing band (§1.1 keys, DT6): the aftercare's `general_*` key when the server sent one,
 * else from the dentition (milk teeth only: under 6; mixed: 6 to 12; else adult).
 */
export function brushingBand(snap: Snapshot | undefined, careKeys: readonly string[] = [], age?: number): BrushingBand {
  const key = careKeys.find((k): k is BrushingBand => k === "general_under_6" || k === "general_6_12" || k === "general_teen" || k === "general_adult");
  if (key !== undefined) return key;
  if (age !== undefined) return age < 6 ? "general_under_6" : age <= 12 ? "general_6_12" : age <= 17 ? "general_teen" : "general_adult";
  if (snap?.dentition === "child") return "general_under_6";
  if (snap?.dentition === "mixed") return "general_6_12";
  return "general_adult";
}

/** The tooth to highlight in the brushing band: treated today, when today's care says to brush gently around it. */
export function brushHighlight(snap: Snapshot | undefined, careSteps: readonly string[]): number | undefined {
  if (snap === undefined || !careSteps.some((s) => /gentl/i.test(s))) return undefined;
  return snap.teeth.find((t) => isTreatedToday(t))?.tooth;
}
