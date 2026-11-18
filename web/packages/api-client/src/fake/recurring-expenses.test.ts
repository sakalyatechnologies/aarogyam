import { describe, expect, it } from "vitest";

import { recurringExpenseId, type ApiClient, type ApiResult, type NewRecurringExpense } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";
import { dueAfter } from "./recurring-expenses.js";

const START = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const clock = { now: START };
  const backend = createFakeBackend(createFixtures({ now: START }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => clock.now });
  return { as, clock };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${String(result.error.status)} ${result.error.message}`);
  return result.value;
}
const status = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);
const RENT: NewRecurringExpense = { category: "rent", amount_paise: 3_000_000, method: "upi", cadence: "monthly", day_of_month: 1, starts_on: "2026-10-01" };

describe("fake client: recurring expenses", () => {
  it("works out due days like the server: a short month uses its last day, weekday 1 is Monday", () => {
    expect(dueAfter("monthly", 31, null, "2026-11-01")).toBe("2026-11-30");
    expect(dueAfter("monthly", 31, null, "2027-01-31")).toBe("2027-02-28");
    expect(dueAfter("monthly", 15, null, "2026-11-14")).toBe("2026-11-15");
    expect(dueAfter("monthly", 1, null, "2026-12-01")).toBe("2027-01-01");
    expect(dueAfter("weekly", null, 1, "2026-11-16")).toBe("2026-11-23");
    expect(dueAfter("weekly", null, 3, "2026-11-16")).toBe("2026-11-18");
  });

  it("records each due day once, catching up missed months", async () => {
    const { as, clock } = setup();
    const owner = as(ASHA);
    const rule = value(await owner.createRecurringExpense(RENT));
    expect(rule).toMatchObject({ next_due_on: "2026-10-01", status: "active", method: "upi", cadence: "monthly" });
    const mine = async () => value(await owner.listExpenses({})).items.filter((e) => e.recurring_expense_id === rule.id);
    expect((await mine()).map((e) => e.spent_on)).toEqual(["2026-10-01"]);
    expect((await mine()).length).toBe(1);
    clock.now = new Date("2027-01-05T05:30:00Z");
    expect((await mine()).map((e) => e.spent_on)).toEqual(["2027-01-01", "2026-12-01", "2026-11-01", "2026-10-01"]);
    const listed = value(await owner.listRecurringExpenses()).items;
    expect(listed.map((r) => [r.id, r.next_due_on])).toEqual([[rule.id, "2027-02-01"]]);
  });

  it("checks a new rule like the server", async () => {
    const owner = setup().as(ASHA);
    const bads: NewRecurringExpense[] = [
      { ...RENT, amount_paise: 0 },
      { ...RENT, day_of_month: 32 },
      { ...RENT, day_of_month: null },
      { ...RENT, weekday: 2 },
      { ...RENT, method: "cheque" },
      { ...RENT, note: "x".repeat(301) },
      { ...RENT, starts_on: "2026-06-01" },
      { ...RENT, cadence: "weekly", day_of_month: null, weekday: 8 },
    ];
    for (const bad of bads) {
      expect(status(await owner.createRecurringExpense(bad))).toBe(400);
    }
  });

  it("pauses, resumes, edits and stops a rule, and keeps clinics and roles apart", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const rule = value(await owner.createRecurringExpense({ ...RENT, starts_on: "2026-10-05" }));
    expect(value(await owner.pauseRecurringExpense(rule.id)).status).toBe("paused");
    expect(status(await owner.pauseRecurringExpense(rule.id))).toBe(409);
    expect(value(await owner.resumeRecurringExpense(rule.id)).status).toBe("active");
    expect(status(await owner.resumeRecurringExpense(rule.id))).toBe(409);
    const edited = value(await owner.updateRecurringExpense(rule.id, { amount_paise: 3_200_000, method: null, day_of_month: 31, ends_on: "2027-03-31" }));
    expect(edited).toMatchObject({ amount_paise: 3_200_000, day_of_month: 31, next_due_on: "2026-10-31", ends_on: "2027-03-31" });
    expect(edited.method).toBeUndefined();
    expect(status(await owner.updateRecurringExpense(rule.id, { ends_on: "2026-01-01" }))).toBe(400);
    expect(status(await owner.updateRecurringExpense(rule.id, { weekday: 3 }))).toBe(400);

    expect(status(await as(BINA, LOTUS).stopRecurringExpense(rule.id))).toBe(404);
    expect(value(await as(BINA, LOTUS).listRecurringExpenses()).items).toEqual([]);
    expect(status(await as(DEV).listRecurringExpenses())).toBe(403);
    expect(status(await as(DEV).createRecurringExpense(RENT))).toBe(403);
    expect(status(await owner.stopRecurringExpense(recurringExpenseId.parse("nope")))).toBe(404);

    expect(value(await owner.stopRecurringExpense(rule.id)).status).toBe("stopped");
    expect(status(await owner.stopRecurringExpense(rule.id))).toBe(409);
    expect(status(await owner.updateRecurringExpense(rule.id, { amount_paise: 5 }))).toBe(409);
  });
});
