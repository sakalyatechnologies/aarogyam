import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

/** Waits for a `Select`'s options to load, then chooses one by its visible text. */
async function chooseOption(user: ReturnType<typeof userEvent.setup>, select: HTMLElement, label: string) {
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBeGreaterThan(1);
  });
  await user.selectOptions(select, label);
}

describe("Calendar: booking", () => {
  it("books an appointment for a patient found by search", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const patients = await client.listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const target = patients.value.items.find((p) => p.number === "SD-5");
    if (target === undefined) throw new Error("expected SD-5 in fixtures");

    // 28 Sep has no fixture appointments, so this booking can't collide with anything.
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "New appointment" }));
    await user.type(await screen.findByPlaceholderText("Name, clinic number or phone"), "SD-5");
    await user.click(await screen.findByRole("button", { name: new RegExp(target.full_name) }));
    await chooseOption(user, screen.getByLabelText(/^Doctor/), "Asha Kulkarni");
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    expect(await screen.findByText("Appointment booked")).toBeTruthy();
  });

  it("refuses a second booking in the same chair at the same time", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const patients = await client.listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const target = patients.value.items.find((p) => p.number === "SD-1");
    if (target === undefined) throw new Error("expected SD-1 in fixtures");

    // The fixture's morning schedule already has Chair 1 booked at 09:00 on 3 Oct.
    renderPortal("/calendar?from=2026-10-03&to=2026-10-03", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "New appointment" }));
    await user.type(await screen.findByPlaceholderText("Name, clinic number or phone"), "SD-1");
    await user.click(await screen.findByRole("button", { name: new RegExp(target.full_name) }));
    await chooseOption(user, screen.getByLabelText(/^Doctor/), "Dr Dev Rao");
    await chooseOption(user, screen.getByLabelText(/^Chair/), "Chair 1");
    const startTime = screen.getByLabelText(/^Start time/);
    await user.clear(startTime);
    await user.type(startTime, "09:00");
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    expect(await screen.findByText(/already booked/)).toBeTruthy();
  });
});

describe("Calendar: status actions", () => {
  it("moves a booked appointment to confirmed from its detail dialog", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const today = await client.listAppointments({ from: "2026-10-03", to: "2026-10-03" });
    if (!today.ok) throw new Error("expected today's appointments");
    const booked = today.value.items.find((a) => a.status === "booked");
    if (booked === undefined) throw new Error("expected a booked appointment in the fixture day");

    renderPortal("/calendar?from=2026-10-03&to=2026-10-03", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: new RegExp(booked.patient.full_name) }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Marked confirmed")).toBeTruthy();

    const after = await client.listAppointments({ from: "2026-10-03", to: "2026-10-03" });
    if (!after.ok) throw new Error("expected today's appointments");
    expect(after.value.items.find((a) => a.id === booked.id)?.status).toBe("confirmed");
  });

  it("requires a reason to cancel", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const today = await client.listAppointments({ from: "2026-10-03", to: "2026-10-03" });
    if (!today.ok) throw new Error("expected today's appointments");
    const cancellable = today.value.items.find((a) => a.status === "booked" || a.status === "confirmed");
    if (cancellable === undefined) throw new Error("expected a cancellable appointment in the fixture day");

    renderPortal("/calendar?from=2026-10-03&to=2026-10-03", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: new RegExp(cancellable.patient.full_name) }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    const confirmButton = await screen.findByRole("button", { name: "Confirm cancellation" });
    expect(confirmButton).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText(/^Reason for cancelling/), "Patient asked to reschedule");
    expect(confirmButton).toHaveProperty("disabled", false);
    await user.click(confirmButton);
    expect(await screen.findByText("Marked cancelled")).toBeTruthy();
  });
});
