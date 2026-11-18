import type { ExpenseCategory } from "@aarogyam/api-client";

/** Expense category names, in the API's fixed order (which is also the charts' colour order). */
export const CATEGORY_LABEL: Readonly<Record<ExpenseCategory, string>> = {
  salary: "Salary",
  material: "Material",
  electricity: "Electricity",
  lab: "Lab",
  rent: "Rent",
  other: "Other",
};

/** How an expense was paid, as the API takes it (the same set as a patient's payment); UPI first, the usual one. */
export const PAID_BY_VALUES = ["upi", "cash", "card", "bank"] as const;
export type PaidBy = (typeof PAID_BY_VALUES)[number];
const PAID_BY_LABEL: Readonly<Record<PaidBy, string>> = { upi: "UPI", cash: "Cash", card: "Card", bank: "Bank transfer" };
export const PAID_BY = PAID_BY_VALUES.map((value) => ({ value, label: PAID_BY_LABEL[value] }));
export const paidByLabel = (method: string): string => PAID_BY.find((m) => m.value === method)?.label ?? method;

/** What a bill may be, and how large: the same as a patient's file. Checked before sending; the server checks the content. */
export const BILL_TYPES: readonly string[] = ["image/jpeg", "image/png", "application/pdf"];
export const BILL_ACCEPT = BILL_TYPES.join(",");
const MAX_BILL_BYTES = 10 * 1024 * 1024;

/** Why a file can't be a bill, or `undefined` when it can. */
export function billProblem(file: File): string | undefined {
  if (!BILL_TYPES.includes(file.type)) return "Choose a JPEG or PNG photo, or a PDF.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BILL_BYTES) return "Choose a file of at most 10 MB.";
  return undefined;
}

/** Weekdays as the API numbers them: Monday is 1. */
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** `1` → `1st`, `22` → `22nd`. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${String(n)}${suffix}`;
}

/** When a recurring expense falls: "monthly on the 1st" or "weekly on Monday". */
export function scheduleLabel(rule: { cadence: string; day_of_month?: number | null; weekday?: number | null }): string {
  if (rule.cadence === "weekly") return `weekly on ${WEEKDAYS[(rule.weekday ?? 1) - 1] ?? "Monday"}`;
  return `monthly on the ${ordinal(rule.day_of_month ?? 1)}`;
}

/** `2026-12-01` → `1 Dec`, with the year when it isn't this year's. */
export function shortDay(day: string, today: string): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC", ...(sameYear ? {} : { year: "numeric" }) });
}
