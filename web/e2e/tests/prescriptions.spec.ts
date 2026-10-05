/**
 * Prescriptions: an allergy alert stops the doctor until they give a reason; issuing emails the
 * patient a link (never the PIN); the patient opens it signed out with the PIN shown to the
 * doctor; and the printed QR's link says the prescription is genuine.
 */
import { button, dialog, field, waitForApi } from "@sakalya/e2e";

import { text } from "../src/db.ts";
import { expect, test } from "../src/fixtures.ts";

test("an allergy alert, the patient's email link, the PIN and the verify page", async ({ tenant, pageAs, browser, clinicApi, inbox, unique }) => {
  const name = unique("Patient");
  const email = `${name.toLowerCase().replace(" ", ".")}@e2e.test`;
  const patient = await clinicApi.registerPatient(name, { email });
  await clinicApi.addAllergy(patient.id, "Penicillin");
  const issuedAt = new Date();

  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}/prescriptions` });
  // The new look drafts the prescription on the patient's own page.
  await button(page, "New prescription").click();
  await field(page, "Search a medicine").fill("Amoxicillin");
  await page.getByRole("button", { name: /Amoxicillin/ }).first().click();

  await button(page, "Issue prescription").click();
  const alert = dialog(page, "Allergy alert");
  await expect(alert).toBeVisible();
  await expect(button(alert, "Issue anyway")).toBeDisabled();
  await field(alert, "Reason to override").fill("Tolerated amoxicillin last year without a reaction");
  const issued = waitForApi(page, { method: "POST", path: /\/api\/v1\/prescriptions\/[^/]+\/issue$/ });
  await button(alert, "Issue anyway").click();
  const prescriptionId = new URL((await issued).url()).pathname.split("/").at(-2) ?? "";
  await expect(page.getByText("Prescription issued")).toBeVisible();
  await expect(page.getByText("Sent to patient by email")).toBeVisible();
  const pin = ((await page.getByLabel("Patient PIN").textContent()) ?? "").trim();
  expect(pin).toMatch(/^\d{6}$/);

  // The email carries the link and never the PIN.
  const message = await inbox.waitFor({ to: email, kind: "prescription.shared", since: new Date(issuedAt.getTime() - 60_000) });
  expect(message.text ?? "").not.toContain(pin);
  const link = message.links[0] ?? "";
  expect(link).toMatch(/\/shared\/[^/]+$/);

  // The patient, signed out, on their own device.
  const patientContext = await browser.newContext({ timezoneId: "Asia/Kolkata" });
  const patientPage = await patientContext.newPage();
  await patientPage.goto(link);
  await expect(patientPage.getByRole("heading", { name: "Your prescription" })).toBeVisible();
  await field(patientPage, "PIN").fill(pin === "000000" ? "111111" : "000000");
  await button(patientPage, "View prescription").click();
  await expect(patientPage.getByRole("alert").or(patientPage.getByText(/PIN/).filter({ hasText: /wrong|match|incorrect|try/i })).first()).toBeVisible();
  await field(patientPage, "PIN").fill(pin);
  const opened = waitForApi(patientPage, { method: "POST", path: /\/api\/v1\/shared\/[^/]+\/open$/ });
  await button(patientPage, "View prescription").click();
  await opened;
  await expect(patientPage.getByText("Amoxicillin").first()).toBeVisible();

  // The printed QR code's link: anyone can check the prescription is genuine.
  const rx = await clinicApi.call("GET", `/api/v1/prescriptions/${prescriptionId}`, {}, tenant.doctor);
  const print: unknown = typeof rx === "object" && rx !== null ? Reflect.get(rx, "print") : undefined;
  await patientPage.goto(new URL(text(print, "verify_path"), tenant.baseURL).toString());
  await expect(patientPage.getByRole("heading", { name: "Genuine prescription" })).toBeVisible();
  await patientContext.close();
});
