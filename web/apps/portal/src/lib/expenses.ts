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
