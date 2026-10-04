import { defineConfig } from "@playwright/test";

/**
 * The golden-journey E2E suite: console and portal against the local dev stack (API :8080,
 * portal :5173 on `sunrise.localtest.me`, console :5174), started separately
 * (`cargo run -p aarogyam-server -- serve` and `pnpm dev:portal` / `pnpm dev:console` with
 * `VITE_API_MODE=http`). `src/hosts.ts` refuses to run this suite against anything else.
 */
// One stamp for the whole run, shared with the worker Playwright restarts after a failure.
process.env["E2E_STAMP"] ??= String(Date.now());

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  timeout: 30_000,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
