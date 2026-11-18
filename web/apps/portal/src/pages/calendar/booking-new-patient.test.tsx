import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { failure, parseApiError, type ApiClient, type NewAppointmentBody, type NewPatient } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";
const DAY = "2026-10-05";
const WEEK = `/calendar?from=${DAY}&to=2026-10-11`;
const NAME = "Zed Newcomer";
const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

/** Opens the booking dialog, counting the registrations and bookings it sends; `failFirstBooking` refuses the first booking. */
async function open({ failFirstBooking = false } = {}) {
  const backend = fakeApi();
  const api: ApiClient = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
  const doctors = await api.listPractitioners();
  if (!doctors.ok) throw new Error("expected doctors");
  const doctor = doctors.value.items[1];
  if (doctor === undefined) throw new Error("expected a doctor");
  const patients: NewPatient[] = [];
  const bookings: NewAppointmentBody[] = [];
  const sent = { patients, bookings };
  const user = userEvent.setup();
  renderPortal(`${WEEK}&book=1`, {
    as: PEOPLE.farah,
    backend,
    wrap: (client): ApiClient => ({
      ...client,
      createPatient: (input) => {
        sent.patients.push(input);
        return client.createPatient(input);
      },
      bookAppointment: (input) => {
        sent.bookings.push(input);
        if (failFirstBooking && sent.bookings.length === 1) {
          return Promise.resolve(failure(parseApiError(409, { error: { code: "conflict", message: "That time was just taken. Please try again." } }, undefined)));
        }
        return client.bookAppointment(input);
      },
    }),
  });
  const dialog = await screen.findByRole("dialog", { name: "New appointment" }, { timeout: 15_000 });
  return { api, user, dialog, doctor: doctor.display_name, sent };
}

async function searchNobody(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.type(within(dialog).getByPlaceholderText("Name, clinic number or phone"), NAME);
  return within(dialog).findByRole("group", { name: "New patient details" }, { timeout: 15_000 });
}

async function whoAndWhen(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, doctor: string) {
  const select = within(dialog).getByLabelText(/^Doctor/);
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBeGreaterThan(1);
  }, { timeout: 15_000 });
  await user.selectOptions(select, doctor);
  const time = within(dialog).getByLabelText(/^Start time/);
  await user.clear(time);
  await user.type(time, "14:00");
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>, group: HTMLElement) {
  await user.click(within(group).getByRole("radio", { name: "Female" }));
  await user.click(within(group).getByRole("radio", { name: /Age only/ }));
  await user.type(within(group).getByLabelText(/^Age in years/), "34");
  await user.type(within(group).getByLabelText(/^Mobile/), "9811122233");
  await user.type(within(group).getByLabelText(/^Email/), "zed@example.com");
}

async function patientsNamed(api: ApiClient) {
  const found = await api.searchPatients({ q: NAME, limit: 50 });
  if (!found.ok) throw new Error("expected a search");
  return found.value.items.filter((p) => p.full_name === NAME);
}

describe("Booking: a new patient in the same dialog", () => {
  it("shows the full registration fields as soon as nothing matches, with the name carried over", async () => {
    const { user, dialog } = await open();
    const group = await searchNobody(user, dialog);
    const name = within(group).getByLabelText(/^Full name/);
    if (!(name instanceof HTMLInputElement)) throw new Error("expected an input");
    expect(name.value).toBe(NAME);
    expect(within(group).getByRole("radiogroup", { name: /^Sex/ })).toBeTruthy();
    expect(within(group).getByLabelText(/^Date of birth/, { selector: "input[type=date]" })).toBeTruthy();
    expect(within(group).getByLabelText(/^Mobile/)).toBeTruthy();
    expect(within(group).getByLabelText(/^Email/)).toBeTruthy();
    // No separate Register step: the dialog's own button saves the patient and the appointment.
    expect(within(dialog).queryByRole("button", { name: /^Register (patient|“)/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Register and book" })).toBeTruthy();
    expect((await axe.run(dialog, AXE)).violations.map((v) => v.id)).toEqual([]);
  });

  it("registers the patient and books the appointment in one click", async () => {
    const { api, user, dialog, doctor, sent } = await open();
    const group = await searchNobody(user, dialog);
    await fillDetails(user, group);
    await whoAndWhen(user, dialog, doctor);
    await user.click(screen.getByRole("button", { name: "Register and book" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New appointment" })).toBeNull();
    }, { timeout: 15_000 });
    expect(sent.patients).toEqual([{ full_name: NAME, sex: "female", age_years: 34, phone: "+919811122233", email: "zed@example.com", preferred_language: "en-IN" }]);
    const [created] = await patientsNamed(api);
    if (created === undefined) throw new Error("expected the new patient");
    expect(sent.bookings).toHaveLength(1);
    expect(sent.bookings[0]?.patient_id).toBe(created.id);
  });

  it("shows each problem on its field and sends nothing until they are fixed", async () => {
    const { user, dialog, doctor, sent } = await open();
    const group = await searchNobody(user, dialog);
    await whoAndWhen(user, dialog, doctor);
    await user.click(screen.getByRole("button", { name: "Register and book" }));
    expect(await within(group).findByText("Choose the patient's sex.")).toBeTruthy();
    expect(within(group).getByText("Enter the date of birth, or give an age instead.")).toBeTruthy();
    // Errors show once a field is left, like the New patient page.
    await user.type(within(group).getByLabelText(/^Mobile/), "12345");
    await user.type(within(group).getByLabelText(/^Email/), "not-an-email");
    await user.tab();
    expect(await within(group).findByText("Enter a 10-digit mobile number.")).toBeTruthy();
    expect(await within(group).findByText("Enter a valid email address.")).toBeTruthy();
    expect(sent.patients).toHaveLength(0);
    expect(sent.bookings).toHaveLength(0);
  });

  it("keeps the registered patient chosen when the booking fails, so a retry makes no duplicate", async () => {
    const { api, user, dialog, doctor, sent } = await open({ failFirstBooking: true });
    const group = await searchNobody(user, dialog);
    await fillDetails(user, group);
    await whoAndWhen(user, dialog, doctor);
    await user.click(screen.getByRole("button", { name: "Register and book" }));
    expect(await within(dialog).findByText("That time was just taken. Please try again.", {}, { timeout: 15_000 })).toBeTruthy();
    expect(within(dialog).getByText(NAME)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Change" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Book (appointment|anyway)$/ }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New appointment" })).toBeNull();
    }, { timeout: 15_000 });
    expect(sent.patients).toHaveLength(1);
    expect(sent.bookings).toHaveLength(2);
    expect(await patientsNamed(api)).toHaveLength(1);
  });

  it("New patient opens the same fields without the search, and Back to search returns", async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "New patient" }));
    const group = within(dialog).getByRole("group", { name: "New patient details" });
    expect(within(dialog).queryByPlaceholderText("Name, clinic number or phone")).toBeNull();
    expect(within(group).getByLabelText(/^Full name/)).toBeTruthy();
    await user.click(within(group).getByRole("button", { name: "Back to search" }));
    expect(within(dialog).getByPlaceholderText("Name, clinic number or phone")).toBeTruthy();
    expect(within(dialog).queryByRole("group", { name: "New patient details" })).toBeNull();
  });
});
