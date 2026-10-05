/**
 * The doctor's day: a walk-in joins the queue, is seated, and the doctor starts the visit,
 * records vitals, signs a note, and adds to it afterwards with an addendum (a signed note never
 * changes).
 */
import type { Page } from "@playwright/test";
import { button, dialog, field, section, waitForApi } from "@sakalya/e2e";

import { expect, test } from "../src/fixtures.ts";

/** A patient with a booking a little ahead, checked in at the front desk from the queue's "Add to queue". */
async function checkIn(page: Page, patientName: string): Promise<void> {
  await button(page, "Add to queue").click();
  await button(dialog(page, "Add to queue"), /Check in a booking/).click();
  const checkedIn = waitForApi(page, { method: "POST", path: /\/api\/v1\/appointments\/[^/]+\/status$/ });
  await button(dialog(page, "Add to queue"), `Check in ${patientName}`).click();
  await checkedIn;
  await expect(dialog(page, `${patientName} checked in`)).toBeVisible();
}

test("a booked patient is checked in at the front desk and the doctor starts the visit", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  await clinicApi.book(patient.id, new Date(Date.now() + 15 * 60_000));
  const desk = await pageAs(tenant.frontDesk, { path: "/queue" });
  await checkIn(desk, patient.fullName);

  const doctor = await pageAs(tenant.doctor, { path: `/patients/${patient.id}` });
  await button(doctor, "Start visit").click();
  await expect(doctor.getByRole("timer", { name: "Visit time" })).toBeVisible();
});

// App bug (docs/e2e.md, "Product bugs the journeys found"): GET /api/v1/queue sends "welcome_status": null for a
// token with no welcome message, and the api-client's queueToken schema (autoMessageStatus.exactOptional())
// rejects null, so the board shows "Couldn't load the queue" as soon as one token exists.
test.fixme("the queue board lists the checked-in patient and seats them", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  await clinicApi.book(patient.id, new Date(Date.now() + 15 * 60_000));
  const desk = await pageAs(tenant.frontDesk, { path: "/queue" });
  await checkIn(desk, patient.fullName);
  await expect(dialog(desk, `${patient.fullName} checked in`)).toBeHidden();
  const card = desk.getByRole("listitem", { name: new RegExp(patient.fullName) });
  await button(card, "To chair").click();
});

test("a signed note takes an addendum and is never edited", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const visitId = await clinicApi.startVisit(patient.id);
  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}/visits/${visitId}` });

  await button(page, "New note").click();
  await field(page, "Subjective").fill("Pain on chewing, lower left, three days.");
  await field(page, "Assessment").fill("Reversible pulpitis, 36.");
  const signed = waitForApi(page, { method: "POST", path: /\/notes\/[^/]+\/sign$/ });
  await button(page, "Sign").click();
  await signed;
  await expect(page.getByText("Note signed")).toBeVisible();
  await expect(page.getByText("Pain on chewing, lower left, three days.")).toBeVisible();
  await expect(field(page, "Subjective")).toHaveCount(0);

  await button(page, "Add addendum").click();
  const panel = dialog(page, "Add an addendum");
  await field(panel, "Addendum").fill("Patient called: pain settled with the temporary filling.");
  const added = waitForApi(page, { method: "POST", path: /\/notes\/[^/]+\/addenda$/, status: 201 });
  await button(panel, "Save").click();
  await added;
  await expect(page.getByText("Addendum added")).toBeVisible();
  await expect(page.getByRole("list", { name: "Addenda" }).getByText("Patient called: pain settled with the temporary filling.")).toBeVisible();
});

test("vitals are recorded per reading and listed on the visit", async ({ tenant, pageAs, clinicApi, unique }) => {
  const patient = await clinicApi.registerPatient(unique("Patient"));
  const visitId = await clinicApi.startVisit(patient.id);
  const page = await pageAs(tenant.doctor, { path: `/patients/${patient.id}/visits/${visitId}` });
  const vitals = section(page, "Vitals");
  await expect(vitals.getByText("No vitals recorded yet")).toBeVisible();
  for (const [kind, value] of [["Pulse", "76"], ["SpO2", "98"]] as const) {
    await field(vitals, "Reading").selectOption({ label: kind });
    await field(vitals, "Value").fill(value);
    const recorded = waitForApi(page, { method: "POST", path: /\/observations$/, status: 201 });
    await button(vitals, "Add").click();
    await recorded;
    await expect(vitals.getByText(new RegExp(`${kind}: ${value}`))).toBeVisible();
  }
});
