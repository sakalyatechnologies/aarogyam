import type { DateRange } from "@aarogyam/api-client";

import { addDays } from "./time.js";

/** The API rejects spans of more than 31 dates (30 days apart). */
export const MAX_RANGE_SPAN_DAYS = 30;

/** Cuts `range` into consecutive pieces the API accepts. An empty or backwards range gives none. */
export function splitRange(range: DateRange, maxSpanDays = MAX_RANGE_SPAN_DAYS): DateRange[] {
  const pieces: DateRange[] = [];
  for (let from = range.from; from <= range.to; from = addDays(from, maxSpanDays + 1)) {
    const end = addDays(from, maxSpanDays);
    pieces.push({ from, to: end < range.to ? end : range.to });
  }
  return pieces;
}
