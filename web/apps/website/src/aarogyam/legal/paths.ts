// Aarogyam-owned. Where each legal page lives on the public website.

export type LegalSlug = "privacy" | "terms" | "dpa" | "patient-notice";

/** The path a legal page is served at. */
export function legalPath(slug: LegalSlug): string {
  return `/${slug}`;
}
