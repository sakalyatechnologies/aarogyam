/**
 * The doctor finishes and is paid without the front desk: what was done today is on the bill, and the payment goes
 * through. The seeded doctor role collects payments (payments.collect) but doesn't write bills (billing.write), so the
 * payment itself issues the visit's draft bill. Set E2E_SHOTS_DIR to keep a screenshot of each step.
 */
import type { Page } from "@playwright/test";
import { button, waitForApi } from "@sakalya/e2e";

import { expect, test } from "../src/fixtures.ts";

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SHOTS_DIR"];
  if (dir !== undefined && dir !== "") await page.screenshot({ path: `${dir}/collect-${name}.png` });
}

test("the doctor ends the visit and collects: the treatment done today is billed and the payment is recorded", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const visitId = await clinicApi.startVisit(patient.id);
  await clinicApi.recordProcedure(visitId, "Composite filling");
  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}` });

  const bar = page.getByRole("region", { name: "Visit actions" });
  const finished = waitForApi(page, { method: "POST", path: /\/api\/v1\/visits\/[^/]+\/finish$/ });
  await button(bar, "End visit").click();
  await finished;
  await button(bar, "Collect payment").click();

  const drawer = page.getByRole("dialog", { name: "Collect payment" });
  await expect(drawer.getByTestId("bill-total")).toHaveText("₹2,500");
  // The lines are editable: the treatment is the value of a description box.
  await expect.poll(() => drawer.locator("input").evaluateAll((boxes) => boxes.map((box) => (box instanceof HTMLInputElement ? box.value : "")))).toContain("Composite filling");
  await shot(page, "1-bill");

  const paid = waitForApi(page, { method: "POST", path: "/api/v1/payments", status: 201 });
  await button(drawer, "Record payment").click();
  await paid;
  await expect(drawer.getByText(/Paid in full/)).toBeVisible();
  await shot(page, "2-paid");
});
