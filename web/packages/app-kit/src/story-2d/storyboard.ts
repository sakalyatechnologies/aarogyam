// The video's storyboard (design §1.7, §1.12 "Video"): a recorded walk through the mouth view.
// Title → overview → zoom to the treated tooth → stepper → back to all teeth (planned) → findings →
// end card. Pure: the same story always gives the same segments and timings.
import type { VisitStory } from "@aarogyam/api-client";

import {
  archStates, dayLabel, hasIssue, mainTreatment, modelTitle, problemWords, stepLabels, toothInfo, withFoundStep,
  conditionChips, type PositionState, type SnapStep, type SnapTooth, type SnapTreatment, type StepLabel,
} from "../mouth-view/model.js";

export const WIDTH = 720;
export const HEIGHT = 1280;
export const FPS = 30;

export type SectionName = "title" | "overview" | "zoom" | "stepper" | "back" | "findings" | "discussed" | "end";

export type Segment =
  | { kind: "title" | "overview" | "findings" | "end"; start: number; end: number }
  | { kind: "zoom" | "back"; start: number; end: number; fdi: number }
  | { kind: "discussed"; start: number; end: number; index: number }
  | { kind: "step"; start: number; end: number; fdi: number; index: number };

/** One line of "What we found today". */
export interface Finding { fdi: number; words: string; extra: string | undefined }
/** One planned tooth for "back to all teeth". */
export interface Planned { fdi: number; words: string }

/** One option on the "Options we discussed" card; `price` is "From ₹X" only when the payload carried one. */
export interface DiscussedWords { label: string; summary: string | undefined; preferred: boolean; price: string | undefined }
/** One ticked "Options we discussed" row. */
export interface DiscussedRow { title: string; tooth: number | undefined; options: DiscussedWords[] }

/** Everything the frames say, worked out once from the story. */
export interface StoryFacts {
  clinic: string;
  /** "Thu 19 Nov 2026". */
  visitDay: string;
  visitNumber: string;
  nextVisit: string | undefined;
  states: { upper: PositionState[]; lower: PositionState[] };
  need: number;
  today: number;
  /** The tooth the stepper walks, with its treatment and step labels. */
  focus: { fdi: number; tooth: SnapTooth; treatment: SnapTreatment; labels: StepLabel[] } | undefined;
  planned: Planned[];
  findings: Finding[];
  discussed: DiscussedRow[];
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11-19" → "Thursday, 19 November 2026" (a calendar day, no time zone shift). */
export function longDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()] ?? ""}, ${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ""} ${String(d.getUTCFullYear())}`;
}

/** The most "Options we discussed" scenes, and options per scene, the video shows. */
export const MAX_DISCUSSED = 3;
export const MAX_DISCUSSED_OPTIONS = 3;

/** Paise as "₹12,500" with Indian digit grouping. */
export function rupees(paise: number): string {
  const n = String(Math.round(paise / 100));
  const last = n.slice(-3), rest = n.slice(0, -3);
  return `₹${rest === "" ? last : `${rest.replace(/\B(?=(\d{2})+$)/g, ",")},${last}`}`;
}

const treatedToday = (t: SnapTooth) => t.today === "treated" || t.today === "in_progress";

export function storyFacts(story: VisitStory): StoryFacts {
  const snap = story.chart;
  const states = archStates(snap);
  const byTooth = new Map(snap.teeth.map((t) => [t.tooth, t]));
  // the walked tooth: the first focus tooth with a treatment, else any tooth treated today
  const candidates = [...snap.focus.map((f) => byTooth.get(f)), ...snap.teeth.filter(treatedToday)];
  let focus: StoryFacts["focus"];
  for (const t of candidates) {
    const tr = withFoundStep(mainTreatment(t), t);
    if (t !== undefined && tr !== undefined && tr.steps.length > 0) {
      focus = { fdi: t.tooth, tooth: t, treatment: tr, labels: stepLabels(tr, t) };
      break;
    }
  }
  const planned: Planned[] = snap.teeth.filter((t) => t.planned === true).map((t) => {
    const tr = (t.treatments ?? []).find((x) => x.state === "planned") ?? mainTreatment(t);
    return { fdi: t.tooth, words: tr === undefined ? "Planned" : modelTitle(tr.model) };
  });
  const findings: Finding[] = [];
  for (const t of snap.teeth) {
    if (t.today !== "found" || !hasIssue(t)) continue;
    const words = problemWords(t)[0] ?? conditionChips(t)[0]?.text.split(" · ")[0];
    if (words === undefined) continue;
    const months = t.treat_within_months;
    findings.push({ fdi: t.tooth, words, extra: months === undefined ? undefined : `Treat within ${String(months)} ${months === 1 ? "month" : "months"}` });
  }
  let need = 0, today = 0;
  for (const t of snap.teeth) {
    if (hasIssue(t) || t.planned === true || (t.treatments ?? []).some((tr) => tr.state === "in_progress")) need += 1;
    if (treatedToday(t)) today += 1;
  }
  const discussed: DiscussedRow[] = (story.discussed ?? []).filter((r) => r.options.length > 0).slice(0, MAX_DISCUSSED).map((r) => ({
    title: r.title,
    tooth: r.tooth ?? undefined,
    options: r.options.slice(0, MAX_DISCUSSED_OPTIONS).map((o) => ({
      label: o.label,
      summary: o.summary === "" ? undefined : o.summary,
      preferred: o.preferred,
      price: o.from_paise === null || o.from_paise === undefined ? undefined : `From ${rupees(o.from_paise)}`,
    })),
  }));
  return {
    clinic: story.clinic_name,
    visitDay: longDay(story.visited_on),
    visitNumber: story.visit_number,
    nextVisit: story.next_visit === undefined ? undefined : dayLabel(story.next_visit),
    states, need, today, focus, planned, findings: findings.slice(0, 3), discussed,
  };
}

/** Section lengths in ms. A stepper step lasts 1.2 to 2 s, about 6 s for the whole stepper. */
export const TIMING = { title: 1800, overview: 3000, zoom: 1400, stepper: 6000, back: 3000, findings: 2200, discussed: 3000, end: 2400 } as const;
/** The video never runs longer than this; extra "discussed" scenes are dropped, the others never shortened. */
export const MAX_MS = 30_000;

export function stepMs(steps: number): number {
  return Math.round(Math.min(2000, Math.max(1200, TIMING.stepper / Math.max(1, steps))));
}

export function storyboard(facts: StoryFacts): Segment[] {
  const out: Segment[] = [];
  let t = 0;
  const push = (seg: Segment) => { out.push(seg); t = seg.end; };
  push({ kind: "title", start: t, end: t + TIMING.title });
  push({ kind: "overview", start: t, end: t + TIMING.overview });
  if (facts.focus !== undefined) {
    const { fdi } = facts.focus;
    push({ kind: "zoom", start: t, end: t + TIMING.zoom, fdi });
    const ms = stepMs(facts.focus.treatment.steps.length);
    facts.focus.treatment.steps.forEach((_, index) => { push({ kind: "step", start: t, end: t + ms, fdi, index }); });
    push({ kind: "back", start: t, end: t + TIMING.back, fdi });
  }
  if (facts.findings.length > 0) push({ kind: "findings", start: t, end: t + TIMING.findings });
  // Each row is one scene, kept only while the whole video stays within MAX_MS.
  for (let index = 0; index < facts.discussed.length && t + TIMING.discussed + TIMING.end <= MAX_MS; index++) {
    push({ kind: "discussed", start: t, end: t + TIMING.discussed, index });
  }
  push({ kind: "end", start: t, end: t + TIMING.end });
  return out;
}

export const sectionOf = (s: Segment): SectionName => (s.kind === "step" ? "stepper" : s.kind);

/** The segment showing at `ms` (clamped to the story). */
export function segmentAt(board: readonly Segment[], ms: number): Segment {
  const first = board[0];
  if (first === undefined) throw new Error("empty storyboard");
  for (const s of board) if (ms < s.end) return s;
  return board[board.length - 1] ?? first;
}

export const stepOf = (facts: StoryFacts, index: number): SnapStep | undefined => facts.focus?.treatment.steps[index];
export const toothName = (fdi: number): string => toothInfo(fdi).name;
