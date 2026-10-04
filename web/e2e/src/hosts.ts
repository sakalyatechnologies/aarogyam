/**
 * Where the golden-journey suite points, and the one rule it never bends: this suite creates and
 * signs in as real (synthetic) people against a live API, so it must never run anywhere but a
 * developer's own machine.
 */

function localOnly(url: string, variable: string): string {
  const hostname = new URL(url).hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localtest.me");
  if (!isLocal) {
    throw new Error(
      `${variable}=${url} is not a local host. This suite signs in as seeded people and writes ` +
        "real rows through a real API: it refuses to run against anything but localhost or " +
        "*.localtest.me, never a deployed environment.",
    );
  }
  return url;
}

/** The Sakalya console, dev sign-in (no VITE_SUPABASE_* set). */
export const CONSOLE_URL = localOnly(process.env["E2E_CONSOLE_URL"] ?? "http://console.localtest.me:5174", "E2E_CONSOLE_URL");

/** Sunrise Dental's portal: the seeded clinic Farah and Dr Dev belong to. */
export const PORTAL_URL = localOnly(process.env["E2E_PORTAL_URL"] ?? "http://sunrise.localtest.me:5173", "E2E_PORTAL_URL");

/** The API itself, checked directly by the suite's setup (never navigated to by a test). */
export const API_URL = localOnly(process.env["E2E_API_URL"] ?? "http://localhost:8080", "E2E_API_URL");
