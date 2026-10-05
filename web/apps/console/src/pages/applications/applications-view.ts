import type { Application } from "@aarogyam/api-client";

export type StatusFilter = "pending" | "approved" | "rejected" | "all";
export type SpecialtyFilter = "all" | "dental" | "general";

export interface ApplicationFilters {
  status: StatusFilter;
  specialty: SpecialtyFilter;
  query: string;
}

export function countByStatus(items: readonly Application[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { pending: 0, approved: 0, rejected: 0, all: items.length };
  for (const item of items) {
    if (item.status === "pending" || item.status === "approved" || item.status === "rejected") {
      counts[item.status] += 1;
    }
  }
  return counts;
}

/** Applications matching the status, specialty and a search over clinic, city, contact and email. */
export function filterApplications(items: readonly Application[], { status, specialty, query }: ApplicationFilters): Application[] {
  const needle = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      (specialty === "all" || item.specialty === specialty) &&
      (needle === "" || [item.clinic_name, item.city, item.contact_name, item.email].some((text) => text.toLowerCase().includes(needle))),
  );
}

/** Reasons offered as one-tap starting points when rejecting. */
export const REJECT_REASONS: readonly string[] = [
  "Outside the pilot area",
  "Incomplete details",
  "Duplicate application",
  "Not a clinic",
];

export const REASON_MIN = 3;

export function reasonProblem(reason: string): string | undefined {
  return reason.trim().length < REASON_MIN ? "Give a reason so the decision can be reviewed later." : undefined;
}
