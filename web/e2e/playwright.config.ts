import { defineE2EConfig } from "@sakalya/e2e";

import { API_URL, CLINIC_TIME_ZONE, CONSOLE_URL, THROTTLE_BYPASS, THROTTLE_BYPASS_HEADER } from "./src/stack.ts";

/**
 * Aarogyam's end-to-end journeys against the isolated e2e stack (`scripts/e2e-stack.sh up`):
 * its own database, API (:8181), portal (:5273, one host per clinic) and console (:5274). Each
 * test file gets a fresh synthetic clinic, so files run in parallel and in any order.
 */
export default defineE2EConfig({
  testDir: "./tests",
  projects: [{ name: "chromium", baseURL: CONSOLE_URL, use: { browserName: "chromium" } }],
  targets: [API_URL],
  use: {
    timezoneId: CLINIC_TIME_ZONE,
    locale: "en-IN",
    // The suite signs in far more often than a person: the e2e API accepts this token from
    // loopback and skips its per-IP limits (ARO_THROTTLE__BYPASS_TOKEN).
    extraHTTPHeaders: { [THROTTLE_BYPASS_HEADER]: THROTTLE_BYPASS },
  },
  quality: { suite: "journeys (Playwright)" },
  globalSetup: "./src/global-setup.ts",
});
