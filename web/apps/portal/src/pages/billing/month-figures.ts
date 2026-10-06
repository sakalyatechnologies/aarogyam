import type { DayTotal, MethodTotal } from "@aarogyam/api-client";

export interface MonthFigures {
  collected_paise: number;
  payments: number;
  by_method: readonly MethodTotal[];
}

/** Derive this month's collection figures from full-range `by_day` and `by_method`
 *  rows, filtering days >= `monthStart(today)`. When the combined range does
 *  not reach back to the 1st of the month the caller must widen the query. */
export function computeMonthFigures(
  by_day: readonly DayTotal[],
  by_method: readonly MethodTotal[],
  monthStart: string,
): MonthFigures {
  const days = by_day.filter((d) => d.date >= monthStart);
  const collected_paise = days.reduce((sum, d) => sum + d.amount_paise, 0);
  const payments = days.reduce((sum, d) => sum + d.payments, 0);
  return { collected_paise, payments, by_method };
}
