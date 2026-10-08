import { describe, expect, it } from "vitest";

import { expenseId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  return (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${String(result.error.status)} ${result.error.message}`);
  return result.value;
}
function at<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) throw new Error(`nothing at ${String(index)}`);
  return item;
}
const status = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);

describe("fake client: expenses", () => {
  it("lists a year of expenses in every category, records and voids one", async () => {
    const owner = setup()(ASHA);
    const list = value(await owner.listExpenses({}));
    expect(new Set(list.items.map((e) => e.category))).toEqual(new Set(["salary", "material", "electricity", "lab", "rent", "other"]));
    expect(at(list.items, 0).spent_on >= at(list.items, -1).spent_on).toBe(true);
    const october = value(await owner.listExpenses({ from: "2026-10-01", to: "2026-10-31" }));
    expect(october.items.every((e) => e.spent_on.startsWith("2026-10"))).toBe(true);

    const made = value(await owner.recordExpense({ category: "rent", spent_on: "2026-10-02", amount_paise: 120_000, note: " Parking " }));
    expect(made).toMatchObject({ category_name: "Rent", status: "recorded", note: "Parking" });
    expect(status(await owner.recordExpense({ category: "rent", spent_on: "2026-10-09", amount_paise: 100 }))).toBe(400);
    expect(status(await owner.recordExpense({ category: "rent", spent_on: "2026-10-01", amount_paise: 0 }))).toBe(400);

    expect(status(await owner.voidExpense(made.id, { reason: "x" }))).toBe(400);
    const voided = value(await owner.voidExpense(made.id, { reason: "Entered twice" }));
    expect(voided).toMatchObject({ status: "void", void_reason: "Entered twice" });
    expect(status(await owner.voidExpense(made.id, { reason: "Entered twice" }))).toBe(409);
  });

  it("needs finance.view to list and expenses.write to record, and keeps clinics apart", async () => {
    const as = setup();
    const doctor = as(DEV);
    expect(status(await doctor.listExpenses({}))).toBe(403);
    expect(status(await doctor.recordExpense({ category: "lab", spent_on: "2026-10-01", amount_paise: 100 }))).toBe(403);
    const ours = at(value(await as(ASHA).listExpenses({})).items, 0);
    expect(status(await as(BINA, LOTUS).voidExpense(ours.id, { reason: "Not ours" }))).toBe(404);
    expect(status(await as(ASHA).voidExpense(expenseId.parse("nope"), { reason: "Missing" }))).toBe(404);
  });
});

describe("fake client: analytics", () => {
  it("reports twelve months for two chairs with money for the owner", async () => {
    const report = value(await setup()(ASHA).getAnalytics({}));
    expect(report).toMatchObject({ from: "2025-11-01", to: "2026-10-03", bucket: "month", money_visible: true });
    expect(report.buckets).toHaveLength(12);
    expect(report.chairs.map((c) => c.name)).toEqual(["Chair 1", "Chair 2"]);
    const last = at(report.buckets, -1);
    expect(last.last_day).toBe("2026-10-03");
    expect(last.chair_utilization).toHaveLength(2);
    expect(last.expenses).toHaveLength(6);
    expect(report.buckets.every((b) => (b.income_paise ?? 0) > 0)).toBe(true);
    expect(report.busy_hours.every((h) => h.weekday >= 1 && h.weekday <= 7)).toBe(true);
    expect(report.patients.age_bands.map((k) => k.key)).toContain("65_plus");
  });

  it("groups by week, caps the range, and hides money without finance.view", async () => {
    const as = setup();
    const owner = as(ASHA);
    const weeks = value(await owner.getAnalytics({ from: "2026-09-01", to: "2026-09-30", bucket: "week" }));
    expect(weeks.buckets[0]).toMatchObject({ start: "2026-08-31", first_day: "2026-09-01" });
    expect(status(await owner.getAnalytics({ from: "2023-01-01", to: "2026-01-01" }))).toBe(400);
    expect(status(await as(DEV).getAnalytics({}))).toBe(403);

    const doctorRole = value(await owner.getRole("doctor"));
    value(await owner.setRolePermissions("doctor", { permissions: [...doctorRole.permissions, { key: "analytics.view", scope: "all" }] }));
    const hidden = value(await as(DEV).getAnalytics({}));
    expect(hidden.money_visible).toBe(false);
    expect(hidden.buckets.every((b) => b.income_paise === null && b.expenses === null)).toBe(true);
    expect(at(hidden.buckets, 0).chair_utilization).toHaveLength(2);
  });
});
