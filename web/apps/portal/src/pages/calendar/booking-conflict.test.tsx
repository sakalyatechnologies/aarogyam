import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { appointmentId } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

/** One confirmed booking at the first slot, then a second patient asking for the same time. */
async function askForTakenTime(backend: ReturnType<typeof fakeApi>) {
  const as = (id: string, email?: string) => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id, ...(email === undefined ? {} : { email }) }), now: () => NOW });
  const first = as("d0d0d0d0-0000-4000-8000-000000000001", "priya@example.test");
  const options = await first.getBookingOptions();
  if (!options.ok) throw new Error("expected options");
  const doctor = options.value.doctors[0]?.id ?? "";
  const slots = await first.getAvailability("2026-10-05", doctor);
  if (!slots.ok) throw new Error("expected slots");
  const slot = slots.value.slots[0] ?? "";
  const held = await first.createOnlineBooking({ starts_at: slot, practitioner_id: doctor, full_name: "Priya Nair", phone: "9876543210" });
  if (!held.ok) throw new Error("expected a booking");
  await as(PEOPLE.farah).setAppointmentStatus(appointmentId.parse(held.value.id), { status: "confirmed" });
  const asked = await as("d0d0d0d0-0000-4000-8000-000000000002", "meera@example.test").createOnlineBooking({ starts_at: slot, practitioner_id: doctor, full_name: "Meera Iyer", phone: "9876543211" });
  if (!asked.ok) throw new Error("expected a request");
  return { id: asked.value.id, list: () => as(PEOPLE.farah).listAppointments({ from: "2026-10-05", to: "2026-10-05" }) };
}

async function openRequest() {
  const user = userEvent.setup();
  const backend = fakeApi();
  const asked = await askForTakenTime(backend);
  renderPortal("/calendar?from=2026-10-05&to=2026-10-05", { as: PEOPLE.farah, backend });
  await user.click(await screen.findByRole("button", { name: /Requested: Meera Iyer/ }));
  const dialog = await screen.findByRole("dialog", { name: "Appointment" });
  return { user, dialog, asked };
}

describe("Calendar: a request for a taken time", () => {
  it("Confirm says the time is taken, then Move picks a free time and confirms in one step", async () => {
    const { user, dialog, asked } = await openRequest();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByText("That time is taken.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Double-book" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    const time = within(dialog).getByLabelText(/start time/i);
    await user.clear(time);
    await user.type(time, "11:00");
    await user.click(within(dialog).getByRole("button", { name: "Move and confirm" }));
    expect(await screen.findByText("Moved and confirmed")).toBeTruthy();
    const after = await asked.list();
    if (!after.ok) throw new Error("expected the calendar");
    const moved = after.value.items.find((a) => a.id === asked.id);
    expect(moved?.status).toBe("confirmed");
    expect(Date.parse(moved?.starts_at ?? "")).toBe(Date.parse("2026-10-05T11:00:00+05:30"));
  });

  it("Double-book confirms into the taken time", async () => {
    const { user, dialog, asked } = await openRequest();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await user.click(await within(dialog).findByRole("button", { name: "Double-book" }));
    expect(await screen.findByText("Confirmed, double-booked")).toBeTruthy();
    const after = await asked.list();
    if (!after.ok) throw new Error("expected the calendar");
    expect(after.value.items.find((a) => a.id === asked.id)?.status).toBe("confirmed");
  });
});
