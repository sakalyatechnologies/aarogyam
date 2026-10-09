/**
 * Permission keys the apps check to hide what a member can't use. The API enforces them on
 * every route; hiding is only courtesy, never protection.
 */
export const PERMISSIONS = [
  "patients.read",
  "patients.write",
  "patients.contact",
  "appointments.read",
  "appointments.write",
  "clinical.read",
  "clinical.write",
  "billing.read",
  "billing.write",
  "prescriptions.issue",
  /** Revenue and money totals (Today's money tiles, reports). */
  "finance.view",
  "settings.manage",
  "staff.manage",
  "roles.manage",
  "reports.export",
  "audit.view",
  "inventory.read",
  "inventory.manage",
  /** Record clinic expenses (listing and voiding them need finance.view). */
  "expenses.write",
  /** The owner's Analytics page; its money figures also need finance.view. */
  "analytics.view",
  /** Record patient-reported allergies and "No known allergies" at a walk-in; reads nothing clinical. */
  "intake.write",
  /** Labs, their contacts and lab orders (costs also need finance.view). */
  "labs.read",
  /** Keep labs and contacts, record and move lab orders, remind a lab. */
  "labs.write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Whether `granted` (a membership's permission list from the API) includes `permission`. */
export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes(permission);
}
