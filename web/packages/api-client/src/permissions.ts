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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Whether `granted` (a membership's permission list from the API) includes `permission`. */
export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes(permission);
}
