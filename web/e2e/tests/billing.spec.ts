/**
 * Money: a bill goes from draft to issued, is paid, prints a receipt, and can be voided only
 * once its payment is voided. Amounts are read from the price list this file's clinic starts
 * with, so nothing depends on seed data.
 */
import { button, dialog, field, waitForApi } from "@sakalya/e2e";

import { text } from "../src/db.ts";
import { expect, test } from "../src/fixtures.ts";

test("a bill is issued, paid in cash, receipted, and voided after its payment", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const page = await pageAs(tenant.frontDesk, { path: "/billing/invoices/new" });
  await field(page, "Find the patient").fill(patient.fullName);
  await page.getByRole("button", { name: new RegExp(patient.fullName) }).click();
  const item = field(page, "Item");
  const scaling = await item.locator("option", { hasText: "Scaling and polishing" }).first().getAttribute("value");
  await item.selectOption(scaling ?? "");
  const drafted = waitForApi(page, { method: "POST", path: "/api/v1/invoices", status: 201 });
  await button(page, "Save as draft").click();
  const invoiceId = text(await (await drafted).json(), "id");
  await page.waitForURL(`**/billing/invoices/${invoiceId}`);
  await expect(page.getByRole("heading", { name: "Draft bill" })).toBeVisible();

  const issued = waitForApi(page, { method: "POST", path: `/api/v1/invoices/${invoiceId}/issue` });
  await button(page, "Issue bill").click();
  await issued;
  // Issuing numbers the bill: the heading changes from "Draft bill" to its number.
  await expect(page.getByRole("heading", { name: "Draft bill" })).toBeHidden();
  await expect(button(page, "Print")).toBeVisible();

  await button(page, "Record payment").click();
  const panel = dialog(page, "Record a payment");
  await expect(field(panel, "Amount (₹)")).toHaveValue(/^1,?500(\.00)?$/);
  const paid = waitForApi(page, { method: "POST", path: "/api/v1/payments", status: 201 });
  await button(panel, "Record payment").click();
  const payment: unknown = await (await paid).json();
  const paymentId = text(payment, "id");
  const receiptNumber = text(payment, "number");
  await expect(page.getByText(`Receipt ${receiptNumber} recorded`)).toBeVisible();
  await expect(button(page, "Record payment")).toBeHidden();

  await page.getByRole("link", { name: receiptNumber }).click();
  await page.waitForURL(`**/billing/payments/${paymentId}/receipt`);
  await expect(page.getByText(receiptNumber).first()).toBeVisible();
  await expect(page.getByText("VOID")).toBeHidden();

  // A paid bill can't be voided: the payment goes first.
  await page.goto(`/billing/invoices/${invoiceId}`);
  await button(page, "Void").click();
  const voidDialog = dialog(page, "Void this bill");
  await field(voidDialog, "Reason").fill("Billed to the wrong patient");
  await button(voidDialog, "Void bill").click();
  await expect(voidDialog.getByRole("alert")).toHaveText("void the payments towards this bill first");
  await button(voidDialog, "Cancel").click();

  // The portal has no screen to void a payment yet (docs/e2e.md), so the owner does it through the API.
  await clinicApi.call("POST", `/api/v1/payments/${paymentId}/void`, { data: { reason: "Refunded in cash" } }, tenant.owner);
  await page.reload();
  await button(page, "Void").click();
  await field(voidDialog, "Reason").fill("Billed to the wrong patient");
  const voided = waitForApi(page, { method: "POST", path: `/api/v1/invoices/${invoiceId}/void` });
  await button(voidDialog, "Void bill").click();
  await voided;
  await expect(page.getByText("Bill voided")).toBeVisible();
  await expect(button(page, "Void")).toBeHidden();
});

test("a bill can't be issued empty, and a draft stays editable", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const id = text(await clinicApi.call("POST", "/api/v1/invoices", { data: { patient_id: patient.id, items: [] } }), "id");
  const page = await pageAs(tenant.frontDesk, { path: `/billing/invoices/${id}` });
  await expect(page.getByRole("heading", { name: "Draft bill" })).toBeVisible();
  await expect(button(page, "Issue bill")).toBeDisabled();
});
