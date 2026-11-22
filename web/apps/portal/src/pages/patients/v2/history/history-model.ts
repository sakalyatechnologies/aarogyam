/**
 * The history's filter and search state, and what each visit card says. Shared by every history style (the full
 * page now; the pop-up and the story later), so the same chips and words find the same visits everywhere.
 */
import type { HistoryVisit } from "@aarogyam/api-client";

import { FINDING_STYLE } from "../../../visits/odontogram/model.js";

export type HistoryKind = "treatments" | "xrays" | "notes" | "medicines" | "bills";

export const HISTORY_FILTERS: readonly { kind: HistoryKind; label: string }[] = [
  { kind: "treatments", label: "Treatments" },
  { kind: "xrays", label: "X-rays" },
  { kind: "notes", label: "Notes and voice" },
  { kind: "medicines", label: "Medicines" },
  { kind: "bills", label: "Bills" },
];

export interface HistoryFilter {
  q: string;
  kinds: ReadonlySet<HistoryKind>;
  /** A clinician's membership id, or "all". */
  doctor: string;
}

export const NO_FILTER: HistoryFilter = { q: "", kinds: new Set(), doctor: "all" };

/** Which chips a visit answers to. */
export function kindsOf(v: HistoryVisit): Set<HistoryKind> {
  const kinds = new Set<HistoryKind>();
  if (v.teeth.length > 0 || v.counts.procedures > 0) kinds.add("treatments");
  if (v.image_count > 0) kinds.add("xrays");
  if (v.note_first_line != null || v.counts.notes > 0 || v.counts.recordings > 0) kinds.add("notes");
  if (v.medicines.length > 0) kinds.add("medicines");
  if ((v.bills ?? []).length > 0) kinds.add("bills");
  return kinds;
}

/** "Root canal treatment" or "Caries": what a tooth chip says (the chart's own finding words). */
export function toothLabel(t: HistoryVisit["teeth"][number]): string {
  if (t.label != null && t.label !== "") return t.label;
  return Object.entries(FINDING_STYLE).find(([key]) => key === t.finding)?.[1].label ?? "Checked";
}

export const WORK_WORDS: Record<string, string> = {
  found: "Found",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  elsewhere: "Done elsewhere",
};

/** The words search looks in: what the card shows. */
export function searchText(v: HistoryVisit): string {
  return [
    v.number,
    v.chief_complaint,
    v.clinician.name,
    v.note_first_line,
    ...v.medicines,
    ...v.teeth.flatMap((t) => [String(t.tooth), toothLabel(t)]),
    ...v.plans.map((p) => p.title),
  ]
    .filter((part): part is string => part != null && part !== "")
    .join(" ")
    .toLowerCase();
}

export function matches(v: HistoryVisit, f: HistoryFilter): boolean {
  if (f.kinds.size > 0) {
    const k = kindsOf(v);
    if (![...f.kinds].some((kind) => k.has(kind))) return false;
  }
  if (f.doctor !== "all" && v.clinician.id !== f.doctor) return false;
  const q = f.q.trim().toLowerCase();
  return q === "" || searchText(v).includes(q);
}

/** The visit's headline: its first treatment, else why the patient came, else the visit number. */
export function titleOf(v: HistoryVisit): string {
  const treated = v.teeth.find((t) => t.label != null && t.work !== "found" && t.work !== "elsewhere");
  if (treated?.label != null) return `${treated.label} on ${String(treated.tooth)}`;
  if (v.teeth.length > 0) return "Check-up";
  if (v.chief_complaint != null && v.chief_complaint !== "") return v.chief_complaint;
  return `Visit ${v.number}`;
}

/** The bill tag: what is still due, or what was paid. Undefined without bills (or without billing.read). */
export function billTag(v: HistoryVisit): { tone: "due" | "paid"; total: number; due: number } | undefined {
  const bills = v.bills ?? [];
  if (bills.length === 0) return undefined;
  const total = bills.reduce((sum, b) => sum + b.total_paise, 0);
  const paid = bills.reduce((sum, b) => sum + b.paid_paise, 0);
  const due = Math.max(0, total - paid);
  return { tone: due > 0 ? "due" : "paid", total, due };
}

/** "2026-11": the month a visit belongs to, in the clinic's (browser's) time. */
export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
