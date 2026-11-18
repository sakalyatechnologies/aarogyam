/**
 * Pure rules behind Explain mode: where an `object-contain` image really sits inside its box (so pins stay on the tooth), and
 * the plain-words summary a patient reads. Nothing here is saved; pins live only for the session.
 */
import type { Attachment, ChartEntry, Plan, PlanItem } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";

import { ARCHES } from "../../../visits/odontogram/model.js";
import { healthByTooth, type StatusLike, type ToothHealthView } from "../tooth-chart/model.js";

/** A rectangle in CSS pixels, relative to its box. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where an image drawn with `object-fit: contain` lands inside a box: scaled to fit whole, centred, with bars on two sides.
 * An image whose size is not known yet fills the box.
 */
export function containedRect(box: { width: number; height: number }, natural: { width: number; height: number }): Rect {
  if (box.width <= 0 || box.height <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  if (natural.width <= 0 || natural.height <= 0) return { left: 0, top: 0, width: box.width, height: box.height };
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

/** A point in the box as fractions of the drawn image (0..1 each way), or undefined when it falls on the bars. */
export function fractionIn(rect: Rect, x: number, y: number): { x: number; y: number } | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return undefined;
  return { x: fx, y: fy };
}

/** Images first by OPG, then newest; only pictures the browser can draw (not PDFs or voice notes). */
export function explainImages<T extends Pick<Attachment, "mime_type" | "kind" | "label" | "created_at">>(files: readonly T[]): T[] {
  return files
    .filter((f) => f.mime_type.startsWith("image/") && f.kind !== "audio" && f.kind !== "consent" && f.kind !== "payment_proof")
    .sort((a, b) => Number(b.label === "OPG") - Number(a.label === "OPG") || b.created_at.localeCompare(a.created_at));
}

/** A tooth number is valid FDI: quadrants 1–4 have teeth 1–8, the child quadrants 5–8 have 1–5. */
export function isFdi(tooth: number): boolean {
  const quadrant = Math.floor(tooth / 10);
  const position = tooth % 10;
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5;
  return false;
}

export interface SummaryLine {
  /** The tooth, or undefined for whole-mouth work such as a cleaning. */
  readonly tooth: number | undefined;
  readonly health: ToothHealthView;
  /** What it needs, in the plan's or the doctor's words. */
  readonly needs: string;
  /** "₹X (estimate; final cost after examination)", or "ask the doctor". */
  readonly cost: string;
  /** "Dr Rao advises treatment within 3 months", when the doctor set it. */
  readonly advice: string | undefined;
}

export interface Summary {
  readonly healthy: number;
  readonly watch: number;
  readonly needsTreatment: number;
  readonly unassessed: number;
  /** "24 healthy · 3 to watch · 2 need treatment". */
  readonly counts: string;
  /** "3 not checked yet", or undefined when every tooth is assessed. */
  readonly notChecked: string | undefined;
  readonly lines: readonly SummaryLine[];
  /** The total of the planned estimates, in paise. */
  readonly totalPaise: number;
}

/** The parts of a treatment plan the summary reads. */
export interface PlanLike {
  readonly status: Plan["status"];
  readonly clinician: { readonly id: string; readonly name: string };
  readonly items: readonly { readonly name: string; readonly tooth?: number | null; readonly estimate_paise: number; readonly status: PlanItem["status"] }[];
}

const ORDER: Readonly<Record<ToothHealthView, number>> = { needs_treatment: 0, watch: 1, healthy: 2, none: 3, unassessed: 4 };

/** "Dr Asha Rao" from "Asha Rao" or "Dr. Asha Rao". */
export const doctorName = (name: string): string => `Dr ${name.replace(/^dr\.?\s+/i, "").trim()}`;

export const estimateText = (paise: number): string => (paise > 0 ? `${formatRupees(paise)} (estimate; final cost after examination)` : "ask the doctor");

/**
 * The summary the patient reads. Teeth are the dentition's plus any other tooth with a record; a missing tooth is not counted,
 * and an unassessed one is never called healthy. One line per tooth to watch or treat, and per planned item elsewhere, so the
 * total adds up. `nameOf` gives a doctor's name from their membership id, when known.
 */
export function explainSummary(args: {
  current: readonly ChartEntry[];
  statuses: readonly StatusLike[];
  plans: readonly PlanLike[];
  dentition: "adult" | "child";
  nameOf?: (membershipId: string) => string | undefined;
}): Summary {
  const { current, statuses, plans, dentition, nameOf = () => undefined } = args;
  const healths = healthByTooth(current, statuses);
  const teeth = new Set<number>([...ARCHES[dentition].upper, ...ARCHES[dentition].lower, ...healths.keys()]);
  let healthy = 0;
  let watch = 0;
  let needsTreatment = 0;
  let unassessed = 0;
  for (const tooth of teeth) {
    const health = healths.get(tooth) ?? "unassessed";
    if (health === "healthy") healthy += 1;
    else if (health === "watch") watch += 1;
    else if (health === "needs_treatment") needsTreatment += 1;
    else if (health === "unassessed") unassessed += 1;
  }

  const live = plans.filter((p) => p.status !== "declined" && p.status !== "completed");
  const planned = live.flatMap((plan) => plan.items.filter((item) => item.status === "proposed" || item.status === "accepted").map((item) => ({ item, plan })));
  const shown = new Set<number>([...teeth].filter((t) => healths.get(t) === "watch" || healths.get(t) === "needs_treatment"));
  for (const { item } of planned) if (item.tooth != null) shown.add(item.tooth);

  const lines: SummaryLine[] = [...shown].map((tooth) => {
    const health = healths.get(tooth) ?? "unassessed";
    const items = planned.filter(({ item }) => item.tooth === tooth);
    const status = statuses.find((s) => s.tooth === tooth);
    const note = status?.note?.trim() ?? "";
    const needs = items.length > 0 ? items.map(({ item }) => item.name).join(", ") : note !== "" ? note : health === "watch" ? "to watch" : "needs treatment";
    const months = status?.treat_within_months ?? undefined;
    const who = (status?.recorded_by == null ? undefined : (nameOf(status.recorded_by) ?? live.find((p) => p.clinician.id === status.recorded_by)?.clinician.name)) ?? items[0]?.plan.clinician.name;
    const advice =
      months === undefined || health === "healthy"
        ? undefined
        : `${who === undefined ? "Your doctor" : doctorName(who)} advises treatment within ${String(months)} ${months === 1 ? "month" : "months"}`;
    return { tooth, health, needs, cost: estimateText(items.reduce((sum, { item }) => sum + item.estimate_paise, 0)), advice };
  });
  lines.sort((a, b) => ORDER[a.health] - ORDER[b.health] || (a.tooth ?? 0) - (b.tooth ?? 0));
  for (const { item } of planned) {
    if (item.tooth == null) lines.push({ tooth: undefined, health: "unassessed", needs: item.name, cost: estimateText(item.estimate_paise), advice: undefined });
  }

  const parts = [`${String(healthy)} healthy`, `${String(watch)} to watch`, `${String(needsTreatment)} ${needsTreatment === 1 ? "needs" : "need"} treatment`];
  return {
    healthy,
    watch,
    needsTreatment,
    unassessed,
    counts: parts.join(" · "),
    notChecked: unassessed > 0 ? `${String(unassessed)} not checked yet` : undefined,
    lines,
    totalPaise: planned.reduce((sum, { item }) => sum + item.estimate_paise, 0),
  };
}
