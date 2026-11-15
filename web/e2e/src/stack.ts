/**
 * Where the suite runs: the isolated end-to-end stack `scripts/e2e-stack.sh up` starts (its own
 * database, API, portal and console on their own ports), never a developer's dev stack or a
 * deployed environment. The kit's host guard refuses anything that isn't local.
 */
import { assertSafeTarget } from "@sakalya/e2e";

const env = (name: string, fallback: string) => {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? fallback : value;
};

/** The API, called directly for setup (never navigated to). */
export const API_URL = assertSafeTarget(env("E2E_API_URL", "http://localhost:8181"), {}, "E2E_API_URL");

/** The Sakalya console (dev sign-in). */
export const CONSOLE_URL = assertSafeTarget(env("E2E_CONSOLE_URL", "http://console.localtest.me:5274"), {}, "E2E_CONSOLE_URL");

/** The port the portal's dev server listens on; every clinic is `http://<slug>.localtest.me:<port>`. */
export const PORTAL_PORT = env("E2E_PORTAL_PORT", "5273");

/** The landing page and registration live on the app host. */
export const APP_URL = assertSafeTarget(`http://app.localtest.me:${PORTAL_PORT}`, {}, "E2E_PORTAL_PORT");

/** A clinic's portal origin. */
export function portalUrl(host: string): string {
  return assertSafeTarget(`http://${host}:${PORTAL_PORT}`, {}, "clinic portal");
}

/** The schema owner's URL: the tenant factory and the inbox read and write with it (bypassing RLS). */
export const OWNER_DB_URL = env("E2E_OWNER_DB_URL", "postgres://aarogyam_owner@localhost:5432/aarogyam_dev_e2e");

/** Sent on every request so the suite's sign-ins don't trip the per-IP limits (local stack only). */
export const THROTTLE_BYPASS = env("E2E_THROTTLE_BYPASS", "local-e2e-throttle-bypass-0123456789abcdef");

/** The header sakalya-throttle reads the bypass token from. */
export const THROTTLE_BYPASS_HEADER = "x-sakalya-throttle-bypass";

/** Clinics work in India's time zone; pages open in it so "today" agrees with the server. */
export const CLINIC_TIME_ZONE = "Asia/Kolkata";
