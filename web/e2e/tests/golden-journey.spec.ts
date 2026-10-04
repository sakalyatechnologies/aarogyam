/**
 * The golden journey, end to end against a real local stack: the console creates a clinic; the
 * portal registers a patient, books and arrives an appointment, then a doctor records vitals and
 * signs a note. Billing is skipped (pending UI; see the last test).
 *
 * Seed-independent: every record this suite creates has a unique name (a run-specific stamp), so
 * it tolerates whatever else the seed or other runs have left behind, and can run again and
 * again against the same database. It signs in through the dev sign-in picker — a seeded
 * person's token, from the real `POST /api/v1/dev/token`, never a fake one — on the seeded
 * Sunrise Dental clinic.
 */
import { expect, test, type Page } from "@playwright/test";

import { API_URL, CONSOLE_URL, PORTAL_URL } from "../src/hosts.js";

const STAMP = Date.now();
const CLINIC_NAME = `E2E Clinic ${STAMP}`;
const PATIENT_NAME = `E2E Patient ${STAMP}`;

/** Clicks a seeded person's button on the dev sign-in picker (`DevSignIn` in `@aarogyam/auth`). */
async function signInAs(page: Page, personName: string): Promise<void> {
  await page.getByRole("button", { name: personName }).click();
}

test.beforeAll(async ({ request }) => {
  const checks = await Promise.allSettled([
    request.get(`${API_URL}/healthz`),
    request.get(CONSOLE_URL),
    request.get(PORTAL_URL),
  ]);
  const down = checks.some((result) => result.status === "rejected" || (result.status === "fulfilled" && !result.value.ok()));
  test.skip(
    down,
    "The local stack isn't up. Start it first: `cargo run -p aarogyam-server -- serve`, then " +
      "`VITE_API_MODE=http pnpm dev:console` and `VITE_API_MODE=http pnpm dev:portal` (no " +
      "VITE_SUPABASE_* set, so both use the dev sign-in).",
  );
});

// One client's state (the new patient's id) crosses from the second test to the third, so they
// share a file-level variable; `describe.serial` keeps them in order on one worker.
let patientId: string | undefined;

test.describe.serial("golden journey", () => {
  test("Sakalya Admin creates a clinic from the console", async ({ page }) => {
    await page.goto(`${CONSOLE_URL}/sign-in`);
    await signInAs(page, "Sakalya Admin");
    await page.waitForURL(/\/health$/);

    await page.goto(`${CONSOLE_URL}/clinics/new`);
    await page.getByLabel("Clinic name").fill(CLINIC_NAME);
    await page.getByLabel("Owner's email").fill(`owner+${STAMP}@e2e.test`);
    await page.getByRole("button", { name: "Create clinic" }).click();

    await expect(page.getByText("is ready for its owner.")).toBeVisible();
    await expect(page.getByLabel("Invitation link")).toHaveValue(/\/invite#/);
  });

  test("Farah registers a patient, books an appointment and marks it arrived", async ({ page }) => {
    await page.goto(`${PORTAL_URL}/sign-in`);
    await signInAs(page, "Farah Shaikh");
    await page.waitForURL(/\/today$/);

    // Register the patient.
    await page.goto(`${PORTAL_URL}/patients/new`);
    await page.getByLabel("Full name").fill(PATIENT_NAME);
    await page.getByRole("radio", { name: "Female" }).check();
    await page.getByRole("radio", { name: "Age only" }).check();
    await page.getByLabel("Age in years").fill("29");
    await page.getByRole("button", { name: "Register patient" }).click();
    // Starting from /patients/new, so the match must exclude it: otherwise waitForURL resolves
    // on the page we're already on, before the submission has gone anywhere.
    await page.waitForURL((url) => /^\/patients\/[^/]+$/.test(url.pathname) && url.pathname !== "/patients/new");
    patientId = new URL(page.url()).pathname.split("/").at(-1);
    expect(patientId).toBeTruthy();

    // Book the appointment with Dr Dev Rao, today, at the default time.
    await page.goto(`${PORTAL_URL}/calendar`);
    await page.getByRole("button", { name: "New appointment" }).click();
    await page.getByLabel("Find the patient").fill(PATIENT_NAME);
    await page.getByRole("button", { name: new RegExp(PATIENT_NAME) }).click();
    await page.getByLabel("Doctor").selectOption({ label: "Dr Dev Rao" });
    await page.getByRole("button", { name: "Book appointment" }).click();
    // Booking still succeeds even with a soft warning (such as the doctor already having
    // something else then, from an earlier run); what matters is the block now exists.
    const block = page.locator("button", { hasText: PATIENT_NAME }).first();
    await expect(block).toBeVisible();

    // Open it on the week grid and mark it arrived.
    await block.click();
    await page.getByRole("button", { name: "Mark arrived" }).click();
    await expect(page.getByText("Marked arrived")).toBeVisible();
  });

  test("Dr Dev opens the visit, records vitals and signs a note", async ({ page }) => {
    test.skip(patientId === undefined, "the previous test didn't register a patient");

    await page.goto(`${PORTAL_URL}/sign-in`);
    await signInAs(page, "Dr Dev Rao");
    await page.waitForURL(/\/today$/);

    await page.goto(`${PORTAL_URL}/patients/${patientId}`);
    await page.getByRole("tab", { name: "Visits" }).click();
    await page.getByRole("button", { name: /Start visit|Continue open visit/ }).click();
    await page.waitForURL(/\/visits\/[^/]+$/);

    // Vitals: one reading (the picker defaults to Pulse). Scoped to the Vitals card, since
    // Procedures has its own "Add" button right below it.
    const vitals = page.locator("section", { has: page.getByRole("heading", { name: "Vitals" }) });
    await vitals.getByLabel("Value").fill("72");
    await vitals.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Reading recorded")).toBeVisible();
    await expect(vitals.getByText(/Pulse: 72/)).toBeVisible();

    // A note, signed. The draft SOAP note needs no content to sign in this product's model.
    await page.getByRole("button", { name: "New note" }).click();
    await expect(page.getByText("SOAP")).toBeVisible();
    await page.getByRole("button", { name: "Sign" }).click();
    await expect(page.getByText("Note signed")).toBeVisible();
  });

  test("front desk creates and issues a bill, records a cash payment", () => {
    // Pending UI: the portal's Billing page is still "Coming soon" (web/apps/portal/src/routes.tsx),
    // so there is nothing yet for this suite to drive. Un-skip once price list, invoice and
    // payment screens land (M5 backend is already built: crates/aarogyam-api/src/v1/billing.rs).
    test.skip(true, "pending UI: the portal has no billing screens yet, only a Coming soon page");
  });
});
