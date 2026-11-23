/**
 * The visit page's `chart` (the server's mouth snapshot, design §1.12), read by hand like the rest
 * of the page: no zod in this entry. Unknown fields are dropped; a malformed snapshot is no chart.
 */
import type { MouthSnapshot } from "@aarogyam/api-client";

type Obj = Record<string, unknown>;
type Tooth = MouthSnapshot["teeth"][number];
type Treatment = NonNullable<Tooth["treatments"]>[number];
type Step = Treatment["steps"][number];
type Work = NonNullable<Tooth["work"]>[number];
type Details = NonNullable<Tooth["details"]>;
type Position = MouthSnapshot["positions"][number];

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
/** `{ key: value }` when the value is there, else `{}` (the snapshot's optional fields are left out, never undefined). */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  const out: { [P in K]?: V } = {};
  if (value !== undefined) out[key] = value;
  return out;
}

function step(o: Obj): Step | undefined {
  const key = str(o["key"]), scene = str(o["scene"]), words = str(o["words"]), state = str(o["state"]);
  if (key === undefined || scene === undefined || words === undefined || state === undefined) return undefined;
  return { key, scene, words, state, after_words: str(o["after_words"]) ?? "", ...opt("sitting", num(o["sitting"])), ...opt("on", str(o["on"])) };
}

function treatment(o: Obj): Treatment | undefined {
  const model = str(o["model"]), state = str(o["state"]);
  if (model === undefined || state === undefined) return undefined;
  const steps = objs(o["steps"]).map(step).filter((s): s is Step => s !== undefined);
  return { model, state, typical_visits: num(o["typical_visits"]) ?? steps.length, steps, recovery: strs(o["recovery"]) };
}

function work(o: Obj): Work | undefined {
  const finding = str(o["finding"]), origin = str(o["origin"]);
  if (finding === undefined || origin === undefined) return undefined;
  return { finding, origin, ...opt("material", str(o["material"])), ...opt("done_on", str(o["done_on"])), ...opt("today", o["today"] === true ? true : undefined) };
}

function details(o: Obj): Details {
  return {
    ...opt("caries_depth", str(o["caries_depth"])), ...opt("infection", str(o["infection"])), ...opt("bleeding", typeof o["bleeding"] === "boolean" ? o["bleeding"] : undefined),
    ...opt("pocket_mm", num(o["pocket_mm"])), ...opt("mobility", num(o["mobility"])), ...opt("condition_on", str(o["condition_on"])),
    ...opt("eruption", str(o["eruption"])), ...opt("angulation", str(o["angulation"])),
  };
}

function tooth(o: Obj): Tooth | undefined {
  const fdi = num(o["tooth"]);
  if (fdi === undefined) return undefined;
  const list = <T,>(v: unknown, f: (o: Obj) => T | undefined): T[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    return objs(v).map(f).filter((x): x is T => x !== undefined);
  };
  return {
    tooth: fdi,
    ...opt("finding", str(o["finding"])), ...opt("surfaces", Array.isArray(o["surfaces"]) ? strs(o["surfaces"]) : undefined), ...opt("material", str(o["material"])),
    ...opt("health", str(o["health"])), ...opt("treat_within_months", num(o["treat_within_months"])), ...opt("today", str(o["today"])),
    ...opt("planned", o["planned"] === true ? true : undefined), ...opt("sitting", num(o["sitting"])),
    ...opt("work", list(o["work"], work)), ...opt("problems", Array.isArray(o["problems"]) ? strs(o["problems"]) : undefined),
    ...opt("details", isObj(o["details"]) ? details(o["details"]) : undefined), ...opt("treatments", list(o["treatments"], treatment)),
  };
}

function position(o: Obj): Position | undefined {
  const quadrant = num(o["quadrant"]), index = num(o["index"]), fdi = num(o["tooth"]), shown = str(o["shown"]);
  if (quadrant === undefined || index === undefined || fdi === undefined || shown === undefined) return undefined;
  const other = isObj(o["other"]) ? o["other"] : undefined;
  const otherTooth = num(other?.["tooth"]), otherFinding = str(other?.["finding"]);
  return { quadrant, index, tooth: fdi, shown, ...opt("other", otherTooth === undefined || otherFinding === undefined ? undefined : { tooth: otherTooth, finding: otherFinding }) };
}

/** The snapshot, or undefined when there is none or it can't be read. */
export function parseChart(body: unknown): MouthSnapshot | undefined {
  if (!isObj(body)) return undefined;
  const dentition = str(body["dentition"]);
  const positions = objs(body["positions"]).map(position).filter((p): p is Position => p !== undefined);
  if (dentition === undefined || positions.length === 0) return undefined;
  return {
    story_version: num(body["story_version"]) ?? 1,
    dentition,
    positions,
    teeth: objs(body["teeth"]).map(tooth).filter((t): t is Tooth => t !== undefined),
    focus: Array.isArray(body["focus"]) ? body["focus"].filter((f): f is number => typeof f === "number") : [],
    ...opt("next_visit", str(body["next_visit"])),
  };
}
