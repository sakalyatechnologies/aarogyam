/**
 * The golden journey, one step per test, each on its own: the console creates a clinic; the
 * front desk registers a patient, books and arrives them; the doctor records vitals and signs a
 * note, and issues a prescription; the front desk bills and takes a cash payment.
 *
 * Every test creates what it needs (a patient through the API, with a unique name) in this
 * file's own synthetic clinic, so the tests run in any order, in parallel, and again and again.
 */
import { button, dialog, field, nextSlot, section, waitForApi } from "@sakalya/e2e";

import { expect, test } from "../src/fixtures.ts";
import { CLINIC_TIME_ZONE } from "../src/stack.ts";

test("Sakalya Admin creates a clinic from the console", async ({ consolePage: page, unique }) => {
  const name = unique("E2E Clinic");
  await page.goto("/clinics/new");
  await field(page, "Clinic name").fill(name);
  await field(page, "Owner's email").fill(`${name.split(" ").at(-1) ?? "owner"}.owner@e2e.test`);
  const created = waitForApi(page, { method: "POST", path: "/api/v1/console/clinics", status: 201 });
  await button(page, "Create clinic").click();
  await created;
  await expect(page.getByText(/is being set up for its owner/)).toBeVisible();
  await expect(field(page, "Invitation link")).toHaveValue(/\/invite#/);
});

test("front desk registers a patient, books an appointment and marks it arrived", async ({ tenant, pageAs, unique }) => {
  const page = await pageAs(tenant.frontDesk, { path: "/patients/new" });
  const name = unique("Patient");
  await field(page, "Full name").fill(name);
  await page.getByRole("radio", { name: "Female" }).check();
  await page.getByRole("radio", { name: "Age only" }).check();
  await field(page, "Age in years").fill("29");
  await button(page, "Register patient").click();
  // The URL already matches /patients/…, so wait for a patient's own page, not this one.
  await page.waitForURL((url) => /^\/patients\/[^/]+$/.test(url.pathname) && url.pathname !== "/patients/new");

  // Today, at a time still ahead (or the next opening), in the clinic's time zone.
  const slot = nextSlot(CLINIC_TIME_ZONE, { leadMinutes: 5, opens: "08:00", lastStart: "21:00", stepMinutes: 5 });
  await page.goto(`/calendar?date=${slot.date}`);
  await button(page, "Book").click();
  const panel = dialog(page, "New appointment");
  await field(panel, "Find the patient").fill(name);
  await panel.getByRole("button", { name: new RegExp(name) }).click();
  await field(panel, "Doctor").selectOption({ label: tenant.doctor.displayName });
  // The dialog opens on the calendar's date (?date=), which is the slot's.
  await field(panel, "Start time").fill(slot.time);
  const booked = waitForApi(page, { method: "POST", path: "/api/v1/appointments", status: 201 });
  await button(panel, "Book appointment").click();
  await booked;
  await expect(page.getByText("Appointment booked")).toBeVisible();

  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const arrived = waitForApi(page, { method: "POST", path: /\/api\/v1\/appointments\/[^/]+\/status$/ });
  await button(page, "Mark arrived").click();
  await arrived;
  await expect(page.getByText("Marked arrived")).toBeVisible();
});

test("the doctor opens the visit, notes a complaint and ends it with a fee", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}` });
  // The new look runs the visit on the patient's own page: one bar, one main button.
  const started = waitForApi(page, { method: "POST", path: `/api/v1/patients/${patient.id}/visits`, status: 201 });
  await button(page, "Start visit").click();
  await started;
  await expect(page.getByRole("timer", { name: "Visit time" })).toBeVisible();

  const notes = section(page, "Notes");
  await button(notes, "Toothache").click();
  await expect(notes.getByRole("group", { name: "In today's note" })).toContainText(/toothache/i);

  await field(page, "Fee (₹)").fill("500");
  await button(page, "End visit").click();
  await expect(button(page, "Collect payment")).toBeVisible();
  await expect(button(page, "End visit")).toHaveCount(0);
});

test("the doctor prescribes a medicine and issues the prescription", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}/prescriptions` });
  await button(page, "New prescription").click();
  await field(page, "Search a medicine").fill("Paracetamol");
  await page.getByRole("button", { name: /Paracetamol/ }).first().click();
  const issued = waitForApi(page, { method: "POST", path: /\/prescriptions\/[^/]+\/issue$/ });
  await button(page, "Issue prescription").click();
  await issued;
  await expect(page.getByText("Prescription issued")).toBeVisible();
});

test("the front desk creates and issues a bill, and records a cash payment", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const page = await pageAs(tenant.frontDesk, { path: "/billing/invoices/new" });
  await field(page, "Find the patient").fill(patient.fullName);
  await page.getByRole("button", { name: new RegExp(patient.fullName) }).click();
  const item = field(page, "Item");
  const consultation = await item.locator("option", { hasText: "Consultation" }).first().getAttribute("value");
  await item.selectOption(consultation ?? "");
  await button(page, "Save as draft").click();
  await page.waitForURL(/\/billing\/invoices\/(?!new)[^/]+$/);

  await button(page, "Issue bill").click();
  await button(page, "Record payment").click();
  const panel = dialog(page, "Record a payment");
  const paid = waitForApi(page, { method: "POST", path: "/api/v1/payments", status: 201 });
  await button(panel, "Record payment").click();
  await paid;
  await expect(page.getByText(/Receipt .* recorded/)).toBeVisible();
});
