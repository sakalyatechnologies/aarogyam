import type { NoteId } from "@aarogyam/api-client";

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

/** What finishing a visit needs from the screen. */
export interface FinishDeps {
  /** Saves note text still on screen (rejects when it cannot, so nothing is signed over it). */
  saveNote: () => Promise<void>;
  /** Saves a prescription draft still being edited. */
  saveRx: () => Promise<void>;
  signNote: (id: NoteId) => Promise<unknown>;
  closeVisit: () => Promise<unknown>;
}

export interface FinishInput {
  /** The doctor's own draft note, when there is one with text in it. Empty drafts are left alone. */
  noteToSign: NoteId | undefined;
  /** Kept for the single call below; today it only travels to the celebration. */
  followUp: FollowUp | null;
}

/**
 * Finishes a visit with the calls that exist today: save what is on screen, sign the note, close the visit.
 *
 * SEAM: another task adds `POST /visits/{id}/finish`, which signs, closes and can issue the prescription in one
 * request with a client id so a retry never repeats. When it lands, replace the body of this function with that one
 * call (`followUp` and the prescription go in its body) and delete `FinishDeps.signNote` / `closeVisit`. Nothing
 * else on the screen changes: the action bar, the confirm for an unissued draft and the celebration all go through here.
 */
export async function finishVisit(input: FinishInput, deps: FinishDeps): Promise<{ noteSigned: boolean }> {
  await deps.saveNote();
  await deps.saveRx();
  if (input.noteToSign !== undefined) {
    await deps.signNote(input.noteToSign);
  }
  await deps.closeVisit();
  return { noteSigned: input.noteToSign !== undefined };
}
