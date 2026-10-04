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
  "billing.read",
  /** Fake only, for Today's money tiles, until the API has a finance permission. */
  "finance.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Whether `granted` (a membership's permission list from the API) includes `permission`. */
export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes(permission);
}
