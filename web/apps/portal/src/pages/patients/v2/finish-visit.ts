import { apiErrorOf, type Alert, type FinishedVisit, type FinishVisitInput, type PrescriptionId } from "@aarogyam/api-client";

/** A follow-up the doctor picked in "Wrap up". `days` is null for "Not needed". */
export interface FollowUp {
  label: string;
  days: number | null;
}

export const FOLLOW_UPS: readonly FollowUp[] = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "6 months", days: 182 },
  { label: "Not needed", days: null },
];

/** The day `days` from now, as YYYY-MM-DD in the browser's calendar. */
export function dateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** What finishing a visit needs from the screen. */
export interface FinishDeps {
  /** Saves note text still on screen (rejects when it cannot, so nothing is signed over it). */
  saveNote: () => Promise<void>;
  /** Saves a prescription draft still being edited. */
  saveRx: () => Promise<void>;
  /** `POST /visits/{id}/finish`: signs the doctor's notes, issues the draft, plans the follow-up, starts the bill and closes. */
  finish: (body: FinishVisitInput) => Promise<Pick<FinishedVisit, "signed_note_ids">>;
}

export interface FinishInput {
  /** The follow-up the doctor picked; its date goes to the server, the label to the celebration. */
  followUp: FollowUp | null;
  /** What the visit costs, in paise, when the screen asks for it. Starts a draft bill. */
  feePaise?: number | undefined;
  /** The draft prescription to issue with the visit. Leave out to finish and keep it a draft. */
  rx?: { id: PrescriptionId; overrideReason?: string | undefined } | undefined;
}

/**
 * Finishes a visit: saves what is on screen, then one request signs the note, issues the draft prescription, plans the
 * follow-up, starts the bill and closes the visit, all or nothing. A `409 allergy_alerts` leaves the visit open, so the
 * caller asks for an override reason and calls again with it.
 */
export async function finishVisit(input: FinishInput, deps: FinishDeps): Promise<{ noteSigned: boolean }> {
  await deps.saveNote();
  await deps.saveRx();
  const reason = input.rx?.overrideReason?.trim();
  const finished = await deps.finish({
    ...(input.followUp?.days == null ? {} : { follow_up_on: dateAfter(input.followUp.days) }),
    ...(input.feePaise === undefined ? {} : { fee_paise: input.feePaise }),
    ...(input.rx === undefined ? {} : { prescription: { id: input.rx.id, ...(reason === undefined || reason === "" ? {} : { override_reason: reason }) } }),
  });
  return { noteSigned: finished.signed_note_ids.length > 0 };
}

/** The allergy alerts when the server refused to issue the draft without an override reason. */
export function allergyAlertsOf(thrown: unknown): Alert[] | undefined {
  const alerts = apiErrorOf(thrown)?.alerts;
  return alerts !== undefined && alerts.length > 0 ? alerts : undefined;
}

/** What to tell the doctor when finishing failed. A visit that is already closed says so plainly. */
export function finishErrorMessage(thrown: unknown): string {
  const error = apiErrorOf(thrown);
  if (error?.code === "visit_closed") {
    return "This visit is already closed (it may have been finished on another screen). Reload the patient to see the final record.";
  }
  return error?.message ?? "Couldn't finish the visit. Nothing was lost; try again.";
}
