/**
 * Layout maths for the calendar's time grid. Every instant is read on the clinic's wall clock
 * (`timeZone`), never the browser's, so a 13:15 IST visit sits at 1 pm for a viewer in any zone.
 */
import { localDateHour } from "./time.js";

export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 21;
const MINUTES_PER_DAY = 24 * 60;

export interface Placement {
  /** Clinic-local date, `YYYY-MM-DD`. */
  date: string;
  /** Minutes after local midnight. */
  startMin: number;
  /** Minutes after local midnight; capped at midnight so a late visit stays on its day. */
  endMin: number;
}

/** Where an appointment sits on the clinic's clock. A missing or zero duration still gets 15 minutes so it can be seen and clicked. */
export function placementOf(startsAt: string, endsAt: string, timeZone: string): Placement {
  const start = localDateHour(startsAt, timeZone);
  const startMin = Math.round(start.hour * 60);
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  const endMin = Math.min(MINUTES_PER_DAY, startMin + Math.max(15, Number.isFinite(minutes) ? minutes : 15));
  return { date: start.date, startMin, endMin };
}

/** The hours the grid shows: the default working day, widened to include every placement. `end` is exclusive. */
export function gridHours(placements: readonly Pick<Placement, "startMin" | "endMin">[], defaults = { start: DEFAULT_START_HOUR, end: DEFAULT_END_HOUR }): { start: number; end: number } {
  let start = defaults.start;
  let end = defaults.end;
  for (const p of placements) {
    start = Math.min(start, Math.floor(p.startMin / 60));
    end = Math.max(end, Math.ceil(p.endMin / 60));
  }
  return { start: Math.max(0, start), end: Math.min(24, end) };
}

/** `8 am`, `12 pm`, `1 pm`; with minutes when not on the hour (`1:15 pm`). */
export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(h12)}${minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`} ${hour >= 12 ? "pm" : "am"}`;
}

export interface Packed<T> {
  item: T;
  /** Zero-based column within the overlap cluster. */
  column: number;
  /** How many columns the cluster needs; the item is `1 / columns` wide. */
  columns: number;
}

/** Packs overlapping events side by side: each cluster of mutually-chained overlaps shares its columns equally. */
export function packColumns<T extends { startMin: number; endMin: number }>(items: readonly T[]): Packed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result: Packed<T>[] = [];
  let cluster: Packed<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const entry of cluster) entry.columns = columnEnds.length;
    result.push(...cluster);
    cluster = [];
    columnEnds = [];
  };
  for (const item of sorted) {
    if (item.startMin >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.endMin);
    } else {
      columnEnds[column] = item.endMin;
    }
    cluster.push({ item, column, columns: 1 });
    clusterEnd = cluster.length === 1 ? item.endMin : Math.max(clusterEnd, item.endMin);
  }
  flush();
  return result;
}

/** Percentage offset of `minutes` within a grid that shows `startHour` to `endHour`. */
export function offsetPercent(minutes: number, startHour: number, endHour: number): number {
  return ((minutes - startHour * 60) / ((endHour - startHour) * 60)) * 100;
}

/** Minutes after local midnight right now in `timeZone` (for the now-line). */
export function nowMinutes(now: string | Date, timeZone: string): { date: string; minutes: number } {
  const { date, hour } = localDateHour(typeof now === "string" ? now : now.toISOString(), timeZone);
  return { date, minutes: Math.round(hour * 60) };
}
