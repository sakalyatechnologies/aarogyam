/** Clinic addresses, such as `<slug>.aarogyam.example`. The API has the final say; this guides typing. */

/** The portal host pattern, the same as the API's `hosts.portal_host_template`. */
const HOST_TEMPLATE = import.meta.env.VITE_PORTAL_HOST_TEMPLATE ?? "{slug}.aarogyam.example";

/** The text around the slug in a portal host: `["", ".aarogyam.example"]`. */
export const HOST_AFFIXES: readonly [string, string] = (() => {
  const [before = "", after = ""] = HOST_TEMPLATE.split("{slug}");
  return [before, after];
})();

/** The portal host a slug gets: `sunrise` → `sunrise.aarogyam.example`. */
export function portalHost(slug: string): string {
  return `${HOST_AFFIXES[0]}${slug}${HOST_AFFIXES[1]}`;
}

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
