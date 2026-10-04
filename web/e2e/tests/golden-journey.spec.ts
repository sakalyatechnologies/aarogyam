/**
 * The golden journey, end to end against a real local stack: the console creates a clinic; the
 * portal registers a patient, books and arrives an appointment, then a doctor records vitals and
 * signs a note and issues a prescription; the front desk bills and takes a cash payment.
 *
 * Seed-independent: every record this suite creates has a unique name (a run-specific stamp), so
 * it tolerates whatever else the seed or other runs have left behind, and can run again and
 * again against the same database. It signs in through the dev sign-in picker — a seeded
 * person's token, from the real `POST /api/v1/dev/token`, never a fake one — on the seeded
 * Sunrise Dental clinic.
 */
import { expect, test, type Page } from "@playwright/test";

import { API_URL, CONSOLE_URL, PORTAL_URL } from "../src/hosts.js";

const STAMP = process.env["E2E_STAMP"] ?? String(Date.now());
const CLINIC_NAME = `E2E Clinic ${STAMP}`;
const PATIENT_NAME = `E2E Patient ${STAMP}`;

/** Clicks a seeded person's button on the dev sign-in picker (`DevSignIn` in `@aarogyam/auth`). */
async function signInAs(page: Page, personName: string): Promise<void> {
  await page.getByRole("button", { name: personName }).click();
}

/** Opens the run's patient from the Patients list, found by name: no state crosses tests. */
async function openPatient(page: Page): Promise<void> {
  await page.goto(`${PORTAL_URL}/patients`);
  await page.getByLabel("Search patients").fill(PATIENT_NAME);
  await page.getByRole("link", { name: PATIENT_NAME }).click();
  await page.waitForURL(/\/patients\/(?!new)[^/]+$/);
}

test.beforeAll(async ({ request }) => {
  const checks = await Promise.allSettled([
    request.get(`${API_URL}/healthz`),
    request.get(CONSOLE_URL),
    request.get(PORTAL_URL),
  ]);
  const down = checks.some((result) => result.status === "rejected" || !result.value.ok());
  test.skip(
    down,
    "The local stack isn't up. Start it first: `cargo run -p aarogyam-server -- serve`, then " +
      "`VITE_API_MODE=http pnpm dev:console` and `VITE_API_MODE=http pnpm dev:portal` (no " +
      "VITE_SUPABASE_* set, so both use the dev sign-in).",
  );
});

// Failed API calls become annotations on the test, so a red run says which request failed.
test.beforeEach(async ({ page }, testInfo) => {
  // Browsers only offer crypto.randomUUID on secure origins, and the local hosts are plain http:
  // the portal's billing screens need it, so supply it here (a dev-host quirk, not a product need).
  await page.addInitScript(() => {
    if (typeof crypto.randomUUID !== "function") {
      Object.defineProperty(crypto, "randomUUID", {
        value: () => "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)),
      });
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      testInfo.annotations.push({ type: "api-error", description: `${String(response.status())} ${response.request().method()} ${new URL(response.url()).pathname}` });
    }
  });
});

test.describe("golden journey", () => {
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

    await page.goto(`${PORTAL_URL}/sign-in`);
    await signInAs(page, "Dr Dev Rao");
    await page.waitForURL(/\/today$/);

    await openPatient(page);
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

  test("Dr Dev prescribes a medicine and issues the prescription", async ({ page }) => {
    await page.goto(`${PORTAL_URL}/sign-in`);
    await signInAs(page, "Dr Dev Rao");
    await page.waitForURL(/\/today$/);
    // One catalogue medicine, issued (a new patient has no allergies to block it).
    await openPatient(page);
    await page.goto(`${page.url()}/prescriptions`);
    await page.getByRole("button", { name: "New prescription" }).click();
    await page.waitForURL(/\/prescriptions\/[^/]+$/);
    await page.getByLabel("Search a medicine").fill("Amoxicillin");
    await page.locator("button", { hasText: "Amoxicillin" }).first().click();
    await page.getByRole("button", { name: "Issue prescription" }).click();
    await expect(page.getByText("Prescription issued")).toBeVisible();
  });

  test("front desk creates and issues a bill, records a cash payment", async ({ page }) => {
    await page.goto(`${PORTAL_URL}/sign-in`);
    await signInAs(page, "Farah Shaikh");
    await page.waitForURL(/\/today$/);

    await page.goto(`${PORTAL_URL}/billing/invoices/new`);
    await page.getByLabel("Find the patient").fill(PATIENT_NAME);
    await page.getByRole("button", { name: new RegExp(PATIENT_NAME) }).click();
    // The seeded "Consultation" price item, chosen by value so currency formatting can't matter.
    const item = page.getByLabel("Item");
    const value = await item.locator("option", { hasText: "Consultation" }).first().getAttribute("value");
    await item.selectOption(value ?? "");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await page.waitForURL(/\/billing\/invoices\/(?!new)[^/]+$/);

    await page.getByRole("button", { name: "Issue bill" }).click();
    await page.getByRole("button", { name: "Record payment" }).click();
    // Amount defaults to the balance and method to cash; the dialog's button shares the trigger's name.
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText(/Receipt .* recorded/)).toBeVisible();
  });
});
