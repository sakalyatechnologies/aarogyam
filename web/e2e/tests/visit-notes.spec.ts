/**
 * Visit notes on the patient page (the founder's 16 Nov reports): a typed note joins the visit's transcript and is kept
 * after a reload; a past visit's notes can be edited, which saves a correction and keeps the original; and a visit is one
 * entry in the patient's records, however many notes it has. Voice can't be driven headless; the unit tests cover it.
 * Set E2E_SHOTS_DIR to keep a screenshot of each step.
 */
import type { Page } from "@playwright/test";
import { button, waitForApi } from "@sakalya/e2e";

import { expect, test } from "../src/fixtures.ts";

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SHOTS_DIR"];
  if (dir !== undefined && dir !== "") await page.screenshot({ path: `${dir}/notes-${name}.png`, fullPage: true });
}

test("a typed note joins the visit's transcript and is still there after a reload", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  await clinicApi.startVisit(patient.id);
  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}` });
  await expect(page.getByText("Visit in progress")).toBeVisible();

  const saved = waitForApi(page, { path: /\/api\/v1\/(visits\/[^/]+\/notes|notes\/[^/]+)$/ });
  await page.getByRole("textbox", { name: "Type a note" }).fill("Allergic to penicillin");
  await page.getByRole("textbox", { name: "Type a note" }).press("Enter");
  const transcript = page.getByRole("list", { name: "Voice notes" });
  await expect(transcript.getByText("Allergic to penicillin")).toBeVisible();
  // Right where the doctor typed it, not below the quick picks at the bottom of the scrolling side panel.
  await expect(transcript.getByText("Allergic to penicillin")).toBeInViewport();
  await saved;
  await shot(page, "1-typed");

  await page.reload();
  await expect(page.getByRole("list", { name: "Voice notes" }).getByText("Allergic to penicillin")).toBeVisible();
  await shot(page, "2-after-reload");
});

test("editing a past visit's notes saves a correction, keeps the original, and the visit stays one entry", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  await clinicApi.pastVisitWithNote(patient.id, "Pain on the right side");
  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}` });

  const records = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Records" }) });
  const visits = records.getByRole("button", { name: /^Open visit / });
  await expect(visits).toHaveCount(1);
  await visits.first().click();
  const detail = page.getByRole("dialog", { name: /^Visit / });
  await expect(detail.getByText("Pain on the right side")).toBeVisible();
  await shot(page, "3-past-visit");

  await button(detail, "Edit notes").click();
  await detail.getByLabel("Subjective").fill("Pain on the left side");
  const amended = waitForApi(page, { method: "POST", path: /\/api\/v1\/notes\/[^/]+\/amend$/ });
  await button(detail, "Save correction").click();
  await amended;
  await expect(detail.getByText("Pain on the left side")).toBeVisible();
  await expect(detail.getByText(/Edited .* by /)).toBeVisible();
  await detail.getByText(/^See earlier versions/).click();
  await expect(detail.getByRole("list", { name: "Earlier versions" }).getByText("Pain on the right side")).toBeVisible();
  await shot(page, "4-corrected");

  // The correction is a new version of the same visit's note, not another visit or another timeline entry.
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(records.getByRole("button", { name: /^Open visit / })).toHaveCount(1);
});
