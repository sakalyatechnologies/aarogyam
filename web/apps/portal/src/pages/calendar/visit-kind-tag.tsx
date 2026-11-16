import { Tag } from "@sakalya/ui";
import type { Patient } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";

export type VisitKind = "new" | "follow_up";

/** A patient with no recorded visit at this clinic is new; otherwise the visit is a follow-up. */
export function visitKindOf(patient: Pick<Patient, "last_visit_at">): VisitKind {
  return patient.last_visit_at == null ? "new" : "follow_up";
}

/** The accessible and tooltip wording, kept in one place. */
export function visitKindLabel(kind: VisitKind): string {
  return kind === "new" ? "New patient" : "Follow-up";
}

/** `3 Nov`: the day, no year, for "last seen". */
function shortDay(iso: string, timeZone: string | undefined): string {
  return formatDate(iso, timeZone).replace(/,? \d{4}$/, "");
}

/**
 * "New patient" or "Follow-up", with "· last seen 3 Nov" when the last visit is known.
 * Small and self-contained so the calendar grid, the booking dialog and the detail dialog can place it.
 */
export function VisitKindTag({ kind, lastSeen, timeZone }: { kind: VisitKind; lastSeen?: string | null | undefined; timeZone?: string }) {
  const seen = kind === "follow_up" && lastSeen != null ? ` · last seen ${shortDay(lastSeen, timeZone)}` : "";
  return <Tag tone={kind === "new" ? "warning" : "neutral"}>{`${visitKindLabel(kind)}${seen}`}</Tag>;
}
