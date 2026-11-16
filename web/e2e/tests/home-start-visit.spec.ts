/**
 * Home's visit flow: the doctor checks the patient in on Home, taps Start and lands on that patient's page with the
 * visit in progress (one visit, linked to the appointment), then ends it. Tapping a patient's tile opens the patient too.
 * Set E2E_SHOTS_DIR to keep a screenshot of each step.
 */
import type { Page } from "@playwright/test";
import { button, waitForApi } from "@sakalya/e2e";

import { expect, test } from "../src/fixtures.ts";

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SHOTS_DIR"];
  if (dir !== undefined && dir !== "") await page.screenshot({ path: `${dir}/homestart-${name}.png`, fullPage: true });
}

test("Check in and Start on Home open the patient's page with the visit in progress, then End visit", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  await clinicApi.book(patient.id, new Date(Date.now() + 10 * 60_000));
  const page = await pageAs(tenant.doctor, { path: "/today" });

  const hero = page.getByRole("region", { name: "Next up" });
  await expect(hero.getByText(patient.fullName)).toBeVisible();
  await shot(page, "1-home-booked");
  const arrived = waitForApi(page, { method: "POST", path: /\/api\/v1\/appointments\/[^/]+\/status$/ });
  await button(hero, "Check in").click();
  await arrived;
  await expect(button(hero, "Start")).toBeVisible();
  await shot(page, "2-home-arrived");

  const started = waitForApi(page, { method: "POST", path: /\/api\/v1\/queue\/[^/]+\/start-visit$/ });
  await button(hero, "Start").click();
  await started;

  // It lands on that patient's page, with the visit in progress and one way on.
  await page.waitForURL(new RegExp(`/patients/${patient.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: patient.fullName })).toBeVisible();
  const bar = page.getByRole("region", { name: "Visit actions" });
  await expect(bar.getByText("Visit in progress")).toBeVisible();
  await expect(page.getByRole("timer", { name: "Visit time" })).toBeVisible();
  await expect(button(bar, "End visit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete visit" })).toHaveCount(0);
  await expect(button(bar, "Start visit")).toHaveCount(0);
  await shot(page, "3-patient-visit-in-progress");

  // A reload shows the same: the visit is on the server, not in the page.
  await page.reload();
  await expect(page.getByRole("region", { name: "Visit actions" }).getByText("Visit in progress")).toBeVisible();

  const finished = waitForApi(page, { method: "POST", path: /\/api\/v1\/visits\/[^/]+\/finish$/ });
  await button(bar, "End visit").click();
  await finished;
  await expect(button(bar, "Collect payment")).toBeVisible();
  await expect(button(bar, "Start visit")).toHaveCount(0);
  await shot(page, "4-patient-visit-ended");

  // After a reload the page still knows the visit is finished and payment is next; it never offers a second visit.
  await page.reload();
  const after = page.getByRole("region", { name: "Visit actions" });
  await expect(after.getByText("Visit finished, payment pending")).toBeVisible();
  await expect(button(after, "Collect payment")).toBeVisible();
  await expect(button(after, "Start visit")).toHaveCount(0);
  await shot(page, "6-patient-after-reload-payment-next");
});

test("a patient's tile on Home opens the patient's page", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  await clinicApi.book(patient.id, new Date(Date.now() + 150 * 60_000));
  const page = await pageAs(tenant.doctor, { path: "/today" });
  const table = page.getByRole("table", { name: "Appointments" });
  await table.getByRole("button", { name: new RegExp(patient.fullName) }).click();
  await page.waitForURL(new RegExp(`/patients/${patient.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: patient.fullName })).toBeVisible();
  await shot(page, "5-tile-opens-patient");
});
