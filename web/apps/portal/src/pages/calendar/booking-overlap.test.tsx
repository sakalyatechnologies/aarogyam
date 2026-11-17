import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { patientId, practitionerId, roomId, type ApiClient, type Patient } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";
const DAY = "2026-10-05";
const WEEK = `/calendar?from=${DAY}&to=2026-10-11`;

/** The clinic, a booked 10:00 appointment for one patient, and the calendar open on that day. */
async function setup() {
  const backend = fakeApi();
  const api: ApiClient = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
  const patients = await api.listPatients();
  const doctors = await api.listPractitioners();
  const rooms = await api.listRooms();
  if (!patients.ok || !doctors.ok || !rooms.ok) throw new Error("expected fixtures");
  const seen = patients.value.items.find((p) => p.last_visit_at != null);
  const fresh = patients.value.items.find((p) => p.last_visit_at == null);
  if (seen === undefined || fresh === undefined) throw new Error("expected a seen and a new patient");
  const [asha, dev] = doctors.value.items;
  const chair = rooms.value.items[0];
  if (asha === undefined || dev === undefined || chair === undefined) throw new Error("expected doctors and a chair");
  const held = await api.bookAppointment({ patient_id: patientId.parse(seen.id), practitioner_id: practitionerId.parse(asha.id), room_id: roomId.parse(chair.id), starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30`, kind: "follow_up" });
  if (!held.ok) throw new Error("expected the first booking");
  return { backend, api, seen, fresh, asha, dev, chair };
}

async function openBooking(backend: ReturnType<typeof fakeApi>) {
  const user = userEvent.setup();
  renderPortal(WEEK, { as: PEOPLE.farah, backend });
  await screen.findByRole("group", { name: /Appointments from/ });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await user.click(await screen.findByRole("button", { name: "Schedule an appointment" }));
  const dialog = await screen.findByRole("dialog", { name: "New appointment" }, { timeout: 15_000 });
  return { user, dialog };
}

async function pick(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, patient: Patient) {
  await user.type(within(dialog).getByPlaceholderText("Name, clinic number or phone"), patient.number);
  await user.click(await within(dialog).findByRole("button", { name: new RegExp(patient.full_name) }, { timeout: 15_000 }));
}

async function setTime(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, time: string) {
  const field = within(dialog).getByLabelText(/^Start time/);
  await user.clear(field);
  await user.type(field, time);
}

async function chooseDoctor(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: string) {
  const doctor = within(dialog).getByLabelText(/^Doctor/);
  await waitFor(() => {
    expect(within(doctor).getAllByRole("option").length).toBeGreaterThan(1);
  }, { timeout: 15_000 });
  await user.selectOptions(doctor, name);
}

async function appointmentsOf(api: ApiClient, patient: Patient) {
  const day = await api.listAppointments({ from: DAY, to: DAY });
  if (!day.ok) throw new Error("expected the day");
  return day.value.items.filter((a) => a.patient.id === patient.id);
}

describe("Calendar: same-patient overlap warning", () => {
  it("warns before saving when the patient is already booked then, and Book anyway saves", async () => {
    const { backend, api, seen, dev } = await setup();
    const { user, dialog } = await openBooking(backend);
    await pick(user, dialog, seen);
    await chooseDoctor(user, dialog, dev.display_name);
    await setTime(user, dialog, "10:15");
    const alert = await within(dialog).findByText(/already has an appointment 10:00 am–10:30 am with/);
    expect(alert.textContent).toContain(`${seen.full_name.split(" ")[0] ?? ""} already has an appointment`);
    expect(alert.textContent).toMatch(/\(Chair 1\)/);
    expect(within(dialog).getByRole("button", { name: "Book anyway" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Book anyway" }));
    await waitFor(async () => {
      expect(await appointmentsOf(api, seen)).toHaveLength(2);
    }, { timeout: 15_000 });
    // The toast says it was booked, then carries the server's specific sentence, not a generic one.
    expect(await screen.findByText(/already has an appointment 10:00 am–10:30 am with .*\(Chair 1\)/, {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText("Appointment booked")).toBeTruthy();
  });

  it("shows the server's clash in the toast when this page could not see it", async () => {
    const { backend, api, fresh, asha, dev } = await setup();
    const { user, dialog } = await openBooking(backend);
    await pick(user, dialog, fresh);
    await chooseDoctor(user, dialog, dev.display_name);
    await setTime(user, dialog, "16:00");
    expect(within(dialog).queryByText(/already has an appointment/)).toBeNull();
    // Another desk books the same patient meanwhile; this page's list is now stale.
    const other = await api.bookAppointment({ patient_id: patientId.parse(fresh.id), practitioner_id: practitionerId.parse(asha.id), starts_at: `${DAY}T16:00:00+05:30`, ends_at: `${DAY}T16:30:00+05:30`, kind: "follow_up" });
    if (!other.ok) throw new Error("expected the other desk's booking");
    await user.click(within(dialog).getByRole("button", { name: "Book appointment" }));
    expect(await screen.findByText(/already has an appointment 4:00 pm–4:30 pm with/, {}, { timeout: 15_000 })).toBeTruthy();
  });

  it("shows no warning for a different time", async () => {
    const { backend, seen, dev } = await setup();
    const { user, dialog } = await openBooking(backend);
    await pick(user, dialog, seen);
    await chooseDoctor(user, dialog, dev.display_name);
    await setTime(user, dialog, "11:00");
    expect(within(dialog).queryByText(/already has an appointment/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Book appointment" })).toBeTruthy();
  });

  it("warns on reschedule in the appointment dialog and says Move anyway", async () => {
    const { backend, api, seen, asha } = await setup();
    const second = await api.bookAppointment({ patient_id: patientId.parse(seen.id), practitioner_id: practitionerId.parse(asha.id), starts_at: `${DAY}T13:00:00+05:30`, ends_at: `${DAY}T13:30:00+05:30`, kind: "follow_up" });
    if (!second.ok) throw new Error("expected a second booking");
    const user = userEvent.setup();
    renderPortal(WEEK, { as: PEOPLE.farah, backend });
    const chips = await screen.findAllByRole("button", { name: new RegExp(`^${seen.full_name}, .* at 1:00`) }, { timeout: 15_000 });
    const chip = chips[0];
    if (chip === undefined) throw new Error("expected a chip");
    await user.click(chip);
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    const time = within(dialog).getByLabelText(/start time/i);
    await user.clear(time);
    await user.type(time, "10:10");
    expect(await within(dialog).findByText(/already has an appointment 10:00 am–10:30 am/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Move appointment anyway" })).toBeTruthy();
  });
});

describe("Calendar: reschedule warning only after a change", () => {
  it("does not warn about a clash that already existed until the time or doctor changes", async () => {
    const { backend, api, seen, asha } = await setup();
    const twin = await api.bookAppointment({ patient_id: patientId.parse(seen.id), practitioner_id: practitionerId.parse(asha.id), starts_at: `${DAY}T10:15:00+05:30`, ends_at: `${DAY}T10:45:00+05:30`, kind: "follow_up" });
    if (!twin.ok) throw new Error("expected an overlapping booking");
    const user = userEvent.setup();
    renderPortal(WEEK, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: new RegExp(`^${seen.full_name}, .* at 10:15`) }, { timeout: 15_000 }));
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    await within(dialog).findByLabelText(/start time/i);
    expect(within(dialog).queryByText(/already has an appointment/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Move appointment" })).toBeTruthy();
    const time = within(dialog).getByLabelText(/start time/i);
    await user.clear(time);
    await user.type(time, "10:20");
    expect(await within(dialog).findByText(/already has an appointment 10:00 am–10:30 am/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Move appointment anyway" })).toBeTruthy();
  });
});

describe("Calendar: new patient or follow-up", () => {
  it("tags the chosen patient: Follow-up with the last visit, or New patient", async () => {
    const { backend, seen, fresh } = await setup();
    const { user, dialog } = await openBooking(backend);
    await pick(user, dialog, seen);
    expect(within(dialog).getByText(/^Follow-up · last seen \d{1,2} \w+$/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Change" }));
    await pick(user, dialog, fresh);
    expect(within(dialog).getByText("New patient", { selector: "span" })).toBeTruthy();
  });

  it("a patient registered in the dialog is a New patient", async () => {
    const { backend } = await setup();
    const { user, dialog } = await openBooking(backend);
    await user.type(within(dialog).getByPlaceholderText("Name, clinic number or phone"), "Zed Newcomer");
    await user.click(await within(dialog).findByRole("button", { name: /Register “Zed Newcomer”/ }, { timeout: 15_000 }));
    await user.type(within(dialog).getByLabelText(/^Age/), "34");
    await user.click(within(dialog).getByRole("button", { name: "Register patient" }));
    expect(await within(dialog).findByText("New patient", { selector: "span" }, { timeout: 15_000 })).toBeTruthy();
  });

  it("tags the appointment in the calendar and in its detail dialog", async () => {
    const { backend, seen } = await setup();
    const user = userEvent.setup();
    renderPortal(WEEK, { as: PEOPLE.farah, backend });
    const chip = await screen.findByRole("button", { name: new RegExp(`^${seen.full_name}, .*, (new patient|follow-up), [a-z -]+$`) }, { timeout: 15_000 });
    expect(chip.getAttribute("aria-label")).toMatch(/, (new patient|follow-up), [a-z -]+$/);
    await user.click(chip);
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    expect(within(dialog).getByText(/^(New patient|Follow-up)/, { selector: "span" })).toBeTruthy();
  });
});

describe("Calendar: optional chair", () => {
  it("books without a chair by default, and with one after the switch is turned on", async () => {
    const { backend, api, fresh, dev } = await setup();
    const { user, dialog } = await openBooking(backend);
    const toggle = within(dialog).getByRole("switch", { name: "Assign a chair" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(within(dialog).queryByLabelText("Chair")).toBeNull();
    await pick(user, dialog, fresh);
    await chooseDoctor(user, dialog, dev.display_name);
    await setTime(user, dialog, "14:00");
    await user.click(within(dialog).getByRole("button", { name: "Book appointment" }));
    await waitFor(async () => {
      expect(await appointmentsOf(api, fresh)).toHaveLength(1);
    }, { timeout: 15_000 });
    expect((await appointmentsOf(api, fresh))[0]?.room_id ?? null).toBeNull();
  });

  it("sends the chair after the switch is turned on with the keyboard", async () => {
    const { backend, api, seen, dev, chair } = await setup();
    const { user, dialog } = await openBooking(backend);
    const toggle = within(dialog).getByRole("switch", { name: "Assign a chair" });
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await user.selectOptions(within(dialog).getByLabelText("Chair"), chair.name);
    await pick(user, dialog, seen);
    await chooseDoctor(user, dialog, dev.display_name);
    await setTime(user, dialog, "15:00");
    await user.click(within(dialog).getByRole("button", { name: /^Book (appointment|anyway)$/ }));
    await waitFor(async () => {
      expect((await appointmentsOf(api, seen)).some((a) => a.room_id === chair.id && a.starts_at.startsWith(`${DAY}T09:30`))).toBe(true);
    }, { timeout: 15_000 });
  });

  it("the edit dialog's switch is on when the appointment has a chair", async () => {
    const { backend, seen } = await setup();
    const user = userEvent.setup();
    renderPortal(WEEK, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: new RegExp(`^${seen.full_name}, `) }, { timeout: 15_000 }));
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    expect(within(dialog).getByRole("switch", { name: "Assign a chair" }).getAttribute("aria-checked")).toBe("true");
  });

  it("has no axe violations in the booking dialog", async () => {
    const { backend, seen } = await setup();
    const { user, dialog } = await openBooking(backend);
    await pick(user, dialog, seen);
    await user.click(within(dialog).getByRole("switch", { name: "Assign a chair" }));
    const result = await axe.run(dialog, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

describe("Calendar: changing an appointment's details", () => {
  it("changes the length, visit kind and reason without moving it", async () => {
    const { backend, api, seen } = await setup();
    const user = userEvent.setup();
    renderPortal(WEEK, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: new RegExp(`^${seen.full_name}, .* at 10:00`) }, { timeout: 15_000 }));
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    await user.selectOptions(within(dialog).getByLabelText(/^Length/), "45 min");
    await user.selectOptions(within(dialog).getByLabelText(/^Visit kind/), "Procedure");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Crown fitting");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Appointment updated")).toBeTruthy();
    const list = await api.listAppointments({ from: DAY, to: DAY });
    if (!list.ok) throw new Error("expected appointments");
    const saved = list.value.items.find((a) => a.patient.id === seen.id && a.starts_at.includes("04:30:00"));
    expect(saved === undefined ? undefined : [(Date.parse(saved.ends_at) - Date.parse(saved.starts_at)) / 60_000, saved.kind, saved.reason]).toEqual([45, "procedure", "Crown fitting"]);
  });
});

describe("Calendar: the appointment window's phone", () => {
  it("shows the patient's phone masked, and in full on asking", async () => {
    const { backend, api, asha } = await setup();
    const listed = await api.listPatients();
    if (!listed.ok) throw new Error("expected patients");
    let full: Patient | undefined;
    for (const p of listed.value.items) {
      const one = await api.getPatient(patientId.parse(p.id));
      if (one.ok && one.value.phone != null) {
        full = one.value;
        break;
      }
    }
    if (full?.phone == null) throw new Error("expected a patient with a phone");
    const booked = await api.bookAppointment({ patient_id: patientId.parse(full.id), practitioner_id: practitionerId.parse(asha.id), starts_at: `${DAY}T15:00:00+05:30`, ends_at: `${DAY}T15:30:00+05:30`, kind: "follow_up" });
    if (!booked.ok) throw new Error("expected a booking");
    const user = userEvent.setup();
    renderPortal(WEEK, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: new RegExp(`^${full.full_name}, .* at 3:00`) }, { timeout: 15_000 }));
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    const show = await within(dialog).findByRole("button", { name: "Show phone" });
    const digits = full.phone.replace(/\D/g, "");
    expect(within(dialog).getByText("Phone").parentElement?.textContent.replace(/\D/g, "")).not.toContain(digits.slice(-10));
    await user.click(show);
    expect(within(dialog).getByText("Phone").parentElement?.textContent.replace(/\D/g, "")).toContain(digits.slice(-10));
  });
});
