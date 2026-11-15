/**
 * Who sees what. Roles come from the clinic's role templates (db/migrations/0006_iam.sql): the
 * front desk handles patients, the calendar and money but no clinical records; a doctor records
 * clinical care and can read bills but not take payments; the owner can do everything. Clinics
 * never see each other's records, through the screen or the API.
 */
import { button, link } from "@sakalya/e2e";

import { callAs } from "../src/clinic-api.ts";
import { expect, test } from "../src/fixtures.ts";
import { portalUrl } from "../src/stack.ts";

test("the front desk works with patients and money but never sees clinical records", async ({ tenant, pageAs, clinicApi, api, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const page = await pageAs(tenant.frontDesk, { path: "/today" });
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Today", "Patients", "Calendar", "Queue", "Billing"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: /^Prescriptions/ })).toHaveCount(0);
  // The API refuses what the screen hides.
  await expect(callAs(api, tenant.frontDesk, tenant.host, "POST", `/api/v1/patients/${patient.id}/visits`, { data: {} })).rejects.toThrow(/answered 403/);
});

test("a doctor reads bills but can't take payments; the owner can", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const invoiceId = await clinicApi.issuedBill(patient.id);

  const doctor = await pageAs(tenant.doctor, { path: `/billing/invoices/${invoiceId}` });
  await expect(button(doctor, "Print")).toBeVisible();
  await expect(button(doctor, "Record payment")).toHaveCount(0);
  await expect(button(doctor, "Void")).toHaveCount(0);

  const owner = await pageAs(tenant.owner, { path: `/billing/invoices/${invoiceId}` });
  await expect(button(owner, "Record payment")).toBeVisible();
  await expect(button(owner, "Void")).toBeVisible();
});

test("a member of another clinic gets nothing of this clinic's", async ({ tenant, newTenant, pageAs, clinicApi, api, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const other = await newTenant();

  // On this clinic's host, the other clinic's front desk is not a member: no record, a way home.
  const stray = await pageAs(other.frontDesk, { tenant: other, path: `${portalUrl(tenant.host)}/patients/${patient.id}` });
  await expect(stray.getByRole("heading", { name: "Choose a clinic" })).toBeVisible();
  await expect(stray.getByText(`You aren't a member of the clinic at ${tenant.host}`)).toBeVisible();
  await expect(stray.getByText(patient.fullName)).toHaveCount(0);
  await expect(link(stray, new RegExp(other.name)).or(button(stray, new RegExp(other.name))).first()).toBeVisible();

  // On their own host, this clinic's patient id finds nothing.
  const own = await pageAs(other.frontDesk, { tenant: other, path: `/patients/${patient.id}` });
  const notice = own.getByRole("alert").filter({ hasText: "Couldn't open this patient" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Not found.");
  await expect(own.getByText(patient.fullName)).toHaveCount(0);

  // And the API answers 404 on their host, and refuses them on this one.
  await expect(callAs(api, other.frontDesk, other.host, "GET", `/api/v1/patients/${patient.id}`)).rejects.toThrow(/answered 404/);
  await expect(callAs(api, other.frontDesk, tenant.host, "GET", `/api/v1/patients/${patient.id}`)).rejects.toThrow(/answered 40[34]/);
});
