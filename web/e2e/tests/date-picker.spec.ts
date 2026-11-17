/**
 * The calendar date picker is styled wherever it is used, not only after the calendar page has loaded its stylesheet,
 * and its pop-up is opaque inside a dialog (portalled outside the portal's colour scope).
 */
import { dialog } from "@sakalya/e2e";

import { expect, test } from "../src/fixtures.ts";

test("the date picker's pop-up is styled and opaque in a dialog on a page other than the calendar", async ({ tenant, pageAs }) => {
  const page = await pageAs(tenant.owner, { path: "/labs" });
  await page.getByRole("button", { name: "Send work", exact: true }).first().click();
  await dialog(page, "Send work to a lab").getByRole("button", { name: /^Due back, / }).click();
  const pop = page.getByRole("dialog", { name: "Choose a date" });
  await expect(pop).toBeVisible();
  const look = await pop.evaluate((el) => ({ position: getComputedStyle(el).position, background: getComputedStyle(el).backgroundColor }));
  expect(look.position).toBe("fixed");
  expect(look.background).not.toBe("rgba(0, 0, 0, 0)");
});
