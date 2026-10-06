/** Matching the chart's procedures and materials as the clinician types. The list arrives with the chart, so this runs in the browser: nothing is asked per keystroke. */
import type { DentalTerm, DentalTermKind } from "@aarogyam/api-client";

const fold = (text: string): string => text.trim().toLowerCase();

/**
 * Terms of `kind` matching `text`: labels starting with it first ("Z" → Zirconia), then labels with a word starting with it
 * ("metal" → Metal (cast)), then labels containing it. Ties keep the list's order (seeded, then the clinic's own).
 */
export function matchTerms(terms: readonly DentalTerm[], kind: DentalTermKind, text: string): DentalTerm[] {
  const wanted = fold(text);
  const ofKind = terms.filter((t) => t.kind === kind);
  if (wanted === "") return ofKind;
  const rank = (label: string): number => {
    const folded = fold(label);
    if (folded.startsWith(wanted)) return 0;
    if (folded.split(/[\s(/.-]+/).some((word) => word.startsWith(wanted))) return 1;
    return folded.includes(wanted) ? 2 : 3;
  };
  return ofKind
    .map((term, index) => ({ term, index, rank: rank(term.label) }))
    .filter((m) => m.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((m) => m.term);
}

/** Whether a term of `kind` already has this label, ignoring case and spacing: then "Add new" isn't offered. */
export function hasLabel(terms: readonly DentalTerm[], kind: DentalTermKind, text: string): boolean {
  const wanted = fold(text).split(/\s+/).join(" ");
  return terms.some((t) => t.kind === kind && fold(t.label) === wanted);
}
