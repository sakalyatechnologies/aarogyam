/** Free start times for booking: working hours minus what is already booked. Minutes after local midnight. */

export interface Span {
  startMin: number;
  endMin: number;
}

export const DEFAULT_SHIFT: Span = { startMin: 9 * 60, endMin: 18 * 60 };

/** `09:30` to 570; `NaN` when it is not a valid 24-hour time. */
export function parseHm(text: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::\d\d)?$/.exec(text.trim());
  return match === null ? Number.NaN : Number(match[1]) * 60 + Number(match[2]);
}

/** 570 to `09:30`. */
export function formatHm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** ISO weekday of a `YYYY-MM-DD` date: Monday 1 to Sunday 7. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * The doctor's working spans on a date. No hours set up at all means the default day; hours set up
 * but none for this weekday means a day off (no spans).
 */
export function shiftsOn(shifts: readonly { weekday: number; starts: string; ends: string }[] | undefined, date: string): Span[] {
  if (shifts === undefined || shifts.length === 0) return [DEFAULT_SHIFT];
  const weekday = isoWeekday(date);
  return shifts
    .filter((s) => s.weekday === weekday)
    .map((s) => ({ startMin: parseHm(s.starts), endMin: parseHm(s.ends) }))
    .filter((s) => Number.isFinite(s.startMin) && Number.isFinite(s.endMin) && s.endMin > s.startMin);
}

/** Start times (minutes) on a `step` grid where `duration` fits inside a shift and clear of every busy span and `notBefore`. */
export function freeSlots({ shifts, busy, duration, step, notBefore = 0 }: { shifts: readonly Span[]; busy: readonly Span[]; duration: number; step: number; notBefore?: number }): number[] {
  const out = new Set<number>();
  for (const shift of shifts) {
    const first = Math.ceil(Math.max(shift.startMin, notBefore) / step) * step;
    for (let start = first; start + duration <= shift.endMin; start += step) {
      if (!busy.some((b) => start < b.endMin && b.startMin < start + duration)) out.add(start);
    }
  }
  return [...out].sort((a, b) => a - b);
}
