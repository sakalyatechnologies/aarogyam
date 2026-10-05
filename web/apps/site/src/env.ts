export interface SiteEnv {
  apiMode: "fake" | "http";
  apiBaseUrl: string;
  bookingUrlTemplate: string;
}

/** Reads the build's `VITE_*` settings. Production builds talk to the API unless told otherwise. */
export function readEnv(): SiteEnv {
  const mode = import.meta.env.VITE_API_MODE ?? (import.meta.env.PROD ? "http" : "fake");
  if (mode !== "fake" && mode !== "http") {
    throw new Error("VITE_API_MODE must be fake or http.");
  }
  return {
    apiMode: mode,
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
    bookingUrlTemplate: import.meta.env.VITE_BOOKING_URL_TEMPLATE ?? "",
  };
}

/**
 * The clinic's slug from the address it is served on: `sunrise-site.example.com` is `sunrise`.
 * A custom domain has no slug; the booking address then comes from the template's own host.
 */
export function slugFromHost(hostname: string): string | null {
  const first = hostname.split(".")[0] ?? "";
  return first.endsWith("-site") && first.length > 5 ? first.slice(0, -5) : null;
}

/** Where the booking page is for this visit, or `null` when it cannot be worked out. */
export function bookingUrl(template: string, hostname: string): string | null {
  if (template === "") {
    return null;
  }
  if (!template.includes("{slug}")) {
    return template;
  }
  const slug = slugFromHost(hostname);
  return slug === null ? null : template.replace("{slug}", slug);
}
