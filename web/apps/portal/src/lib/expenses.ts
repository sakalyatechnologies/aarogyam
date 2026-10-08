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
