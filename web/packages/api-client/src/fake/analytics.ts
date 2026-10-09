/**
 * The fake's expenses and Analytics report. Expenses are real fake rows (seeded for twelve
 * months); the rest of the report is synthetic but deterministic, shaped like a busy two-chair
 * dental clinic, so the portal shows full charts in fake mode.
 */

import type * as C from "../contract.js";
import { createRandom } from "./random.js";

export const EXPENSE_NAMES: Readonly<Record<C.ExpenseCategory, string>> = {
  salary: "Salary",
  material: "Material",
  electricity: "Electricity",
  lab: "Lab",
  rent: "Rent",
  other: "Other",
};
const CATEGORIES: readonly C.ExpenseCategory[] = ["salary", "material", "electricity", "lab", "rent", "other"];

export interface FakeExpense {
  id: string;
  clinic_id: string;
  category: C.ExpenseCategory;
  spent_on: string;
  amount_paise: number;
  note: string | null;
  recorded_by: string;
  created_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
}

export const wireExpense = (e: FakeExpense): C.Expense => ({
  id: e.id,
  category: e.category,
  category_name: EXPENSE_NAMES[e.category],
  spent_on: e.spent_on,
  amount_paise: e.amount_paise,
  note: e.note,
  status: e.voided_at == null ? "recorded" : "void",
  recorded_by: e.recorded_by,
  created_at: e.created_at,
  void_reason: e.void_reason ?? null,
  voided_at: e.voided_at ?? null,
});

const DAY = 86_400_000;
const toDay = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => toDay(new Date(parseDay(s).getTime() + n * DAY));
export const daysInclusive = (from: string, to: string) => Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY) + 1;

/** Twelve months of plausible expenses in every category, ending today. */
export function seedExpenses(clinicId: string, recordedBy: string, now: Date, seed = 300): FakeExpense[] {
  const random = createRandom(seed);
  const today = toDay(now);
  const out: FakeExpense[] = [];
  const add = (category: C.ExpenseCategory, day: string, rupees: number, note: string | null) => {
    if (day > today) return;
    const n = out.length;
    out.push({
      id: `00000000-0000-4300-8000-${n.toString(16).padStart(12, "0")}`,
      clinic_id: clinicId,
      category,
      spent_on: day,
      amount_paise: Math.round(rupees) * 100,
      note,
      recorded_by: recordedBy,
      created_at: `${day}T12:00:00Z`,
    });
  };
  for (let back = 11; back >= 0; back -= 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = toDay(month).slice(0, 7);
    const summer = [3, 4, 5].includes(month.getUTCMonth());
    add("salary", `${ym}-01`, 185_000 + (11 - back) * 1_500, "Staff salaries");
    add("rent", `${ym}-05`, 65_000, "Clinic rent");
    add("electricity", `${ym}-10`, (summer ? 13_000 : 8_000) + random.int(0, 2_500), "Electricity bill");
    add("lab", `${ym}-08`, random.int(7_000, 14_000), "Crowns and bridges");
    add("lab", `${ym}-21`, random.int(5_000, 11_000), "Aligners lab");
    add("material", `${ym}-14`, random.int(3_000, 7_500), "Gloves and masks, local shop");
    add("other", `${ym}-18`, random.int(2_000, 6_000), back % 3 === 0 ? "Equipment service" : "Housekeeping");
  }
  return out;
}

export interface AnalyticsInput {
  from: string;
  to: string;
  bucket: C.AnalyticsBucket;
  moneyVisible: boolean;
  chairs: readonly C.AnalyticsChair[];
  expenses: readonly FakeExpense[];
  stockBatches: readonly { received_on: string; received_quantity: number; unit_cost_paise: number }[];
  payments: readonly { received_at: string; amount_paise: number }[];
}

/** A stable 0..1 number for a key, so the same period always gets the same figures. */
function noise(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

function periods(from: string, to: string, bucket: C.AnalyticsBucket): { start: string; first: string; last: string }[] {
  const out: { start: string; first: string; last: string }[] = [];
  const d = parseDay(from);
  let start =
    bucket === "month"
      ? toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))
      : addDays(from, -((d.getUTCDay() + 6) % 7));
  while (start <= to) {
    const s = parseDay(start);
    const next = bucket === "month" ? toDay(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1))) : addDays(start, 7);
    const end = addDays(next, -1);
    out.push({ start, first: start < from ? from : start, last: end > to ? to : end });
    start = next;
  }
  return out;
}

const OPEN_MINUTES = 540;

export function buildAnalytics(input: AnalyticsInput): C.Analytics {
  const { from, to, bucket, moneyVisible } = input;
  const totalDays = daysInclusive(from, to);
  const buckets = periods(from, to, bucket).map(({ start, first, last }): C.AnalyticsBucketRow => {
    const days = daysInclusive(first, last);
    const season = 1 + 0.12 * Math.sin((parseDay(start).getUTCMonth() / 12) * 2 * Math.PI);
    const chair_utilization = input.chairs.map((chair, i): C.ChairUtilization => {
      const bps = Math.round((6200 - i * 1100) * season + (noise(`${chair.id}${start}`) - 0.5) * 1400);
      const open = days * OPEN_MINUTES;
      const booked = Math.round((open * bps) / 10_000);
      return { room_id: chair.id, booked_minutes: booked, open_minutes: open, appointments: Math.round(booked / 40), utilization_bps: bps };
    });
    const inRange = (day: string) => day >= first && day <= last;
    const stock = input.stockBatches.filter((b) => inRange(b.received_on)).reduce((s, b) => s + b.received_quantity * b.unit_cost_paise, 0);
    const spend = CATEGORIES.map((category) => ({
      category,
      amount_paise:
        input.expenses.filter((e) => e.voided_at == null && e.category === category && inRange(e.spent_on)).reduce((s, e) => s + e.amount_paise, 0) +
        (category === "material" ? stock : 0),
    }));
    const paid = input.payments.filter((p) => inRange(p.received_at.slice(0, 10)));
    const income = Math.round(days * 1_650_000 * season * (0.85 + noise(`income${start}`) * 0.3)) + paid.reduce((s, p) => s + p.amount_paise, 0);
    const money = moneyVisible
      ? {
          income_paise: income,
          payments: Math.round(days * 11 * season) + paid.length,
          expenses_paise: spend.reduce((s, c) => s + c.amount_paise, 0),
          expenses: spend,
          stock_purchases_paise: stock,
        }
      : { income_paise: null, payments: null, expenses_paise: null, expenses: null, stock_purchases_paise: null };
    return {
      start,
      first_day: first,
      last_day: last,
      chair_utilization,
      ...money,
      patients: {
        new: Math.round(days * 1.3 * season * (0.8 + noise(`new${start}`) * 0.4)),
        returning: Math.round(days * 3.4 * season * (0.85 + noise(`ret${start}`) * 0.3)),
      },
    };
  });
  const scale = (n: number) => Math.round(n * (totalDays / 365));
  const kc = (entries: [string, number][]): C.KeyCount[] => entries.map(([key, count]) => ({ key, count: scale(count) }));
  const busy_hours: C.BusyHour[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (let hour = 9; hour <= 20; hour += 1) {
      if (weekday === 7 && hour > 13) continue;
      const peak = Math.exp(-((hour - 11) ** 2) / 3) + 1.2 * Math.exp(-((hour - 18) ** 2) / 2.5);
      const day = weekday === 6 ? 1.3 : weekday === 7 ? 0.5 : 1;
      const visits = scale(Math.round(peak * day * 60 * (0.8 + noise(`${String(weekday)}-${String(hour)}`) * 0.4)));
      if (visits > 0) busy_hours.push({ weekday, hour, visits });
    }
  }
  return {
    from,
    to,
    bucket,
    open_minutes_per_day: OPEN_MINUTES,
    money_visible: moneyVisible,
    chairs: [...input.chairs],
    buckets,
    patients: {
      age_bands: kc([["0_12", 140], ["13_17", 95], ["18_34", 420], ["35_49", 360], ["50_64", 240], ["65_plus", 110], ["unknown", 30]]),
      visit_kinds: kc([["new", 470], ["follow_up", 1240], ["procedure", 860], ["emergency", 75]]),
      referral_sources: kc([["patient", 180], ["doctor", 45], ["online", 120], ["walk_in", 70], ["camp", 25], ["insurance", 15], ["other", 10], ["unknown", 5]]),
    },
    busy_hours,
    lab_turnaround: { orders_received: scale(48), average_days: 6.5 },
  };
}
