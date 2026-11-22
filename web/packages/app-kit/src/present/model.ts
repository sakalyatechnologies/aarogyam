// The PresentModel `facts` layer (present-studio-design §5.1, §5.2): a pure projection of the visit's
// `GET /visits/{id}/mouth` snapshot that every Show patient style draws. It adds no fact and infers
// nothing: no shade, no crowding or gum finding, no visit number and no date the snapshot lacks.
// Styles draw from it; they never write patient words or decide provenance.
import type { MouthSnapshot } from "@aarogyam/api-client";

import { toothTypeOf } from "../mouth-art/loaders.js";
import type { Overlay } from "../mouth-art/overlays.js";
import type { ToothType } from "../mouth-art/types.js";
import { findingWord, modelTitle, overlaysFor, problemWords, toothInfo, type SnapTooth } from "../mouth-view/model.js";

export type FactKind = "problem" | "work" | "detail" | "plan" | "recommended" | "in_progress";
export type Origin = "here" | "elsewhere" | "before";

export interface FactItem {
  /** "36:caries", "26:missing", "46:work:filled". */
  id: string;
  tooth?: number;
  kind: FactKind;
  /** Patient words, from the existing word maps. */
  words: string;
  /** Plain place words in the patient's left and right ("Lower left 6-year molar"). */
  where?: string;
  /**
   * The day the snapshot records for this item, from its `*_on` fields only (`problems_on`, `finding_on`,
   * `recommended_on`, `work.done_on`, `details.condition_on`); absent → a bare "Recorded".
   */
  recorded_on?: string;
  origin?: Origin;
  /** A problem recorded on the biting side only: the front picture can't show it ("See biting side"). */
  biting_side?: boolean;
  /** The only badge a fact can carry. */
  badge: "recorded";
}

export type Eruption = "erupted" | "partial" | "impacted" | "unerupted";
export type Angulation = "vertical" | "mesioangular" | "distoangular" | "horizontal";

export interface ToothFacts {
  tooth: number;
  type: ToothType;
  /** Arch position: quadrant 1–4 (milk quadrants folded) and index from the midline. */
  quadrant: 1 | 2 | 3 | 4;
  index: number;
  shown: "tooth" | "sound" | "not_recorded";
  missing: boolean;
  eruption?: Eruption;
  angulation?: Angulation;
  /** What the tooth art draws: the recorded finding and details only. */
  draw: Overlay[];
  /** Ids of this tooth's facts, in list order. */
  facts: string[];
}

export interface PresentModel {
  visit_id?: string;
  dentition: string;
  orientation_default: "mirror";
  /** Shown alone, never next to a step number. */
  next_visit?: string;
  /** Recorded items only: the "What we found" list. */
  facts: FactItem[];
  /** Every arch position, in the patient's right-to-left order per arch (upper, then lower). */
  teeth: ToothFacts[];
}

const ERUPTIONS: readonly Eruption[] = ["erupted", "partial", "impacted", "unerupted"];
const ANGLES: readonly Angulation[] = ["vertical", "mesioangular", "distoangular", "horizontal"];
const asEruption = (v: string | undefined) => ERUPTIONS.find((e) => e === v);
const asAngle = (v: string | undefined) => ANGLES.find((a) => a === v);
const asOrigin = (v: string): Origin | undefined => (v === "here" || v === "elsewhere" || v === "before" ? v : undefined);

const MATERIAL: Readonly<Record<string, string>> = {
  amalgam: "silver", composite: "tooth-coloured", glass_ionomer: "tooth-coloured", gold: "gold", cast_metal: "metal",
  pfm: "metal and porcelain", zirconia: "zirconia", layered_zirconia: "zirconia", emax: "porcelain", temporary: "temporary",
};
const ORIGIN_WORDS: Readonly<Record<Origin, string>> = { here: "done here", elsewhere: "done elsewhere", before: "done before" };
const ERUPTION_WORDS: Readonly<Record<string, string>> = { partial: "Partly through the gum", impacted: "Stuck under the gum", unerupted: "Not through yet" };
const ANGLE_WORDS: Readonly<Record<string, string>> = { vertical: "upright", mesioangular: "tilted forward", distoangular: "tilted back", horizontal: "lying on its side" };

const BITING_ONLY = (t: SnapTooth) => {
  const s = t.surfaces ?? [];
  return s.length > 0 && s.every((x) => x === "O");
};

/** The facts of one recorded tooth, in a fixed order: in progress, problems, details, recommended, planned, work. */
function toothFacts(t: SnapTooth): FactItem[] {
  const out: FactItem[] = [];
  const where = toothInfo(t.tooth).name;
  const base = { tooth: t.tooth, where, badge: "recorded" as const };
  const key = (rest: string) => `${String(t.tooth)}:${rest}`;
  const dated = (on: string | undefined) => (on === undefined ? {} : { recorded_on: on });
  // problems_on runs parallel to problems; finding_on dates the headline finding
  const problemOn = (p: string) => { const i = (t.problems ?? []).indexOf(p); return i < 0 ? undefined : t.problems_on?.[i]; };
  const headlineOn = (finding: string) => (t.finding === finding ? t.finding_on : undefined);
  for (const tr of t.treatments ?? []) {
    if (tr.state !== "in_progress") continue;
    out.push({ ...base, ...dated(headlineOn(tr.model)), id: key(`in_progress:${tr.model}`), kind: "in_progress", words: `${modelTitle(tr.model)} in progress${t.sitting === undefined ? "" : ` · sitting ${String(t.sitting)}`}` });
  }
  const problems = (t.problems ?? []).filter((p) => p !== "missing");
  const words = problemWords({ ...t, problems });
  problems.forEach((p, i) => {
    const biting = p === "caries" && BITING_ONLY(t);
    out.push({ ...base, ...dated(problemOn(p) ?? headlineOn(p)), id: key(p), kind: "problem", words: words[i] ?? findingWord(p), ...(biting ? { biting_side: true } : {}) });
  });
  const missing = t.finding === "missing" || (t.problems ?? []).includes("missing");
  if (missing) {
    const origin = asOrigin(t.work?.find((w) => w.finding === "missing")?.origin ?? "");
    out.push({ ...base, ...dated(problemOn("missing") ?? headlineOn("missing")), id: key("missing"), kind: "detail", words: "Missing tooth", ...(origin === undefined ? {} : { origin }) });
  }
  const d = t.details;
  const on = d?.condition_on === undefined ? {} : { recorded_on: d.condition_on };
  if (d !== undefined && !missing) {
    if (d.infection !== undefined) out.push({ ...base, ...on, id: key("infection"), kind: "problem", words: d.infection === "abscess" ? "Abscess at the root" : "Infection at the root" });
    if (d.mobility !== undefined && d.mobility > 0) out.push({ ...base, ...on, id: key("mobility"), kind: "problem", words: `${toothInfo(t.tooth).primary ? "Loose milk tooth" : "Loose tooth"} (grade ${String(d.mobility)})` });
    if (d.bleeding === true) out.push({ ...base, ...on, id: key("bleeding"), kind: "problem", words: "Gums bleed" });
    if (d.pocket_mm !== undefined) out.push({ ...base, ...on, id: key("pocket"), kind: "detail", words: `Gum pocket ${String(d.pocket_mm)} mm` });
    if (d.eruption !== undefined && d.eruption !== "erupted") {
      const angle = d.angulation === undefined ? "" : `, ${ANGLE_WORDS[d.angulation] ?? d.angulation.replace(/_/g, " ")}`;
      out.push({ ...base, id: key("eruption"), kind: "detail", words: `${ERUPTION_WORDS[d.eruption] ?? d.eruption.replace(/_/g, " ")}${angle}` });
    }
  }
  const recommended = t.recommended === true;
  for (const tr of t.treatments ?? []) {
    if (tr.state !== "planned") continue;
    if (recommended || tr.recommended === true) out.push({ ...base, ...dated(t.recommended_on), id: key(`recommended:${tr.model}`), kind: "recommended", words: `Your dentist recommends: ${modelTitle(tr.model).toLowerCase()}` });
    else out.push({ ...base, id: key(`plan:${tr.model}`), kind: "plan", words: `${modelTitle(tr.model)} planned` });
  }
  for (const w of t.work ?? []) {
    if (w.finding === "missing") continue;
    const origin = asOrigin(w.origin);
    const material = w.material === undefined ? undefined : MATERIAL[w.material];
    const what = `${findingWord(w.finding)}${material === undefined ? "" : ` (${material})`}`;
    const done = origin === undefined ? "" : ` · ${w.today === true ? "done here today" : ORIGIN_WORDS[origin]}`;
    out.push({ ...base, id: key(`work:${w.finding}`), kind: "work", words: `${what}${done}`, ...(origin === undefined ? {} : { origin }), ...dated(w.done_on ?? headlineOn(w.finding)) });
  }
  return out;
}

function fold(q: number): 1 | 2 | 3 | 4 {
  const f = q > 4 ? q - 4 : q;
  return f === 1 || f === 2 || f === 3 ? f : 4;
}

/** Builds the facts layer from the visit's mouth snapshot. Pure: the same snapshot gives the same model. */
export function presentFacts(snap: MouthSnapshot, visitId?: string): PresentModel {
  const byTooth = new Map(snap.teeth.map((t) => [t.tooth, t]));
  const order = (q: number) => snap.positions.filter((p) => fold(p.quadrant) === q);
  // the patient's right to left on each arch: q1 from the back to the midline, then q2 outwards; q4 then q3
  const sorted = [...order(1).sort((a, b) => b.index - a.index), ...order(2).sort((a, b) => a.index - b.index),
    ...order(4).sort((a, b) => b.index - a.index), ...order(3).sort((a, b) => a.index - b.index)];
  const facts: FactItem[] = [];
  const teeth: ToothFacts[] = [];
  for (const p of sorted) {
    const type = toothTypeOf(p.tooth);
    if (type === undefined) continue;
    const shown = p.shown === "tooth" || p.shown === "sound" ? p.shown : "not_recorded";
    const t = shown === "not_recorded" ? undefined : byTooth.get(p.tooth);
    const own = t === undefined ? [] : toothFacts(t);
    facts.push(...own);
    const eruption = asEruption(t?.details?.eruption);
    const angulation = asAngle(t?.details?.angulation);
    teeth.push({
      tooth: p.tooth, type, quadrant: fold(p.quadrant), index: p.index, shown,
      missing: t !== undefined && (t.finding === "missing" || (t.problems ?? []).includes("missing")),
      ...(eruption === undefined ? {} : { eruption }), ...(angulation === undefined ? {} : { angulation }),
      draw: overlaysFor(t), facts: own.map((f) => f.id),
    });
  }
  return {
    ...(visitId === undefined ? {} : { visit_id: visitId }),
    dentition: snap.dentition, orientation_default: "mirror",
    ...(snap.next_visit === undefined ? {} : { next_visit: snap.next_visit }),
    facts, teeth,
  };
}

export type Orientation = "mirror" | "photo";

/**
 * Screen order, left to right, of one arch. Mirror (the default, "As in your mirror"): the patient's
 * right on the screen's right. Photo: the patient's right on the screen's left. Radiographs never use this.
 */
export function screenOrder(model: PresentModel, arch: "upper" | "lower", orientation: Orientation): number[] {
  const row = model.teeth.filter((t) => (arch === "upper" ? t.quadrant <= 2 : t.quadrant >= 3)).map((t) => t.tooth);
  return orientation === "photo" ? row : [...row].reverse();
}

/** The teeth with at least one recorded fact, in list order (the dots on a picture, numbered 1…n). */
export function dottedTeeth(model: PresentModel): number[] {
  const seen: number[] = [];
  for (const f of model.facts) if (f.tooth !== undefined && !seen.includes(f.tooth)) seen.push(f.tooth);
  return seen;
}
