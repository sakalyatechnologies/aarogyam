import type { ClinicStatus, ConsoleClinic } from "@aarogyam/api-client";

export type ClinicStatusFilter = ClinicStatus | "all";
export type ClinicSpecialtyFilter = "all" | "dental" | "general";

export function countClinics(items: readonly ConsoleClinic[]): Record<ClinicStatusFilter, number> {
  const counts: Record<ClinicStatusFilter, number> = { all: items.length, trial: 0, active: 0, suspended: 0, churned: 0 };
  for (const clinic of items) {
    counts[clinic.status] += 1;
  }
  return counts;
}

export function filterClinics(
  items: readonly ConsoleClinic[],
  { status, specialty, query }: { status: ClinicStatusFilter; specialty: ClinicSpecialtyFilter; query: string },
): ConsoleClinic[] {
  const needle = query.trim().toLowerCase();
  return items.filter(
    (clinic) =>
      (status === "all" || clinic.status === status) &&
      (specialty === "all" || clinic.specialty === specialty) &&
      (needle === "" || clinic.name.toLowerCase().includes(needle) || clinic.slug.includes(needle) || (clinic.portal_host ?? "").toLowerCase().includes(needle)),
  );
}

/** What each lifecycle status means, for the clinic's detail page. */
export const STATUS_MEANING: Readonly<Record<ClinicStatus, string>> = {
  trial: "Trying Aarogyam. Everything works; the clinic hasn't started a paid plan.",
  active: "A live clinic using Aarogyam day to day.",
  suspended: "Paused: members can't sign in to the portal until it is reactivated.",
  churned: "Left Aarogyam. Records are kept according to the retention rules.",
};

/** "Expires in 3 days", "Expires today" or "Expired 2 days ago", relative to `now`. */
export function expiryNote(expiresAt: string, now: Date): { text: string; expired: boolean } {
  const days = Math.floor((Date.parse(expiresAt) - now.getTime()) / 86_400_000);
  if (days < 0) {
    const ago = Math.max(1, Math.floor((now.getTime() - Date.parse(expiresAt)) / 86_400_000));
    return { text: `Expired ${ago === 1 ? "yesterday" : `${String(ago)} days ago`}`, expired: true };
  }
  return { text: days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${String(days)} days`, expired: false };
}
