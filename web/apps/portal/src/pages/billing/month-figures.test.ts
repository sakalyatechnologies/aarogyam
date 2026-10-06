import { describe, expect, it } from "vitest";

import type { DayTotal, MethodTotal } from "@aarogyam/api-client";
import { computeMonthFigures } from "./month-figures.js";

function day(date: string, amount_paise: number, payments: number): DayTotal {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return { date, amount_paise: amount_paise as DayTotal["amount_paise"], payments };
}

function method(method: string, share_bps: number): MethodTotal {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return { method, amount_paise: 0 as MethodTotal["amount_paise"], payments: 0, share_bps };
}

describe("computeMonthFigures", () => {
  it("filters days >= monthStart and sums collected_paise and payments", () => {
    const by_day = [day("2026-09-28", 100_00, 1), day("2026-10-01", 300_00, 2), day("2026-10-03", 500_00, 3)];
    const by_method = [method("upi", 6000), method("cash", 4000)];
    const result = computeMonthFigures(by_day, by_method, "2026-10-01");

    expect(result.collected_paise).toBe(800_00);
    expect(result.payments).toBe(5);
    expect(result.by_method).toEqual(by_method);
  });

  it("returns zero figures when no days match the month", () => {
    const by_day = [day("2026-09-28", 100_00, 1), day("2026-09-30", 200_00, 1)];
    const by_method: MethodTotal[] = [];
    const result = computeMonthFigures(by_day, by_method, "2026-10-01");

    expect(result.collected_paise).toBe(0);
    expect(result.payments).toBe(0);
    expect(result.by_method).toEqual([]);
  });

  it("handles empty by_day gracefully", () => {
    const by_method = [method("upi", 10000)];
    const result = computeMonthFigures([], by_method, "2026-10-01");

    expect(result.collected_paise).toBe(0);
    expect(result.payments).toBe(0);
    expect(result.by_method).toEqual(by_method);
  });

  it("includes a payment exactly on the 1st of the month", () => {
    const by_day = [day("2026-10-01", 150_00, 1)];
    const by_method = [method("upi", 10000)];
    const result = computeMonthFigures(by_day, by_method, "2026-10-01");

    expect(result.collected_paise).toBe(150_00);
    expect(result.payments).toBe(1);
  });
});
