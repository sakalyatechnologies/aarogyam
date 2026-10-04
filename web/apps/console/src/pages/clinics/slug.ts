/** Clinic addresses: `<slug>.aarogyam.example`. The API has the final say; this guides typing. */

export const SLUG_MAX = 30;
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www", "api", "app", "admin", "console", "status", "mail", "help", "support", "docs", "static", "assets",
]);

/**
 * A slug from a clinic's name: lowercase ASCII letters and digits joined by single hyphens,
 * apostrophes dropped, accents removed, cut at a word boundary to 30 characters.
 * `Dr. Mehta's Dental & Implant Centre` → `dr-mehtas-dental-implant`.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= SLUG_MAX) {
    return slug;
  }
  const cut = slug.slice(0, SLUG_MAX + 1);
  const boundary = cut.lastIndexOf("-");
  return (boundary > 0 ? cut.slice(0, boundary) : slug.slice(0, SLUG_MAX)).replace(/-+$/, "");
}
