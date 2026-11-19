import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResult, CalendarWalkInPage } from "@aarogyam/api-client";
import { fakeTokenFor, type Fixtures } from "@aarogyam/api-client/fake";

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
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04&book=1", { as: PEOPLE.farah, backend });
    await user.type(await screen.findByPlaceholderText("Name, clinic number or phone"), "SD-5");
    await user.click(await screen.findByRole("button", { name: new RegExp(target.full_name) }));
    await chooseOption(user, screen.getByLabelText(/^Doctor/), "Asha Kulkarni");
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    expect(await screen.findByText("Appointment booked")).toBeTruthy();
  });

  it("opens booking with the patient from ?patient= already chosen", async () => {
    const backend = fakeApi();
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const patients = await client.listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const target = patients.value.items.find((p) => p.number === "SD-5");
    if (target === undefined) throw new Error("expected SD-5 in fixtures");

    renderPortal(`/calendar?from=2026-09-28&to=2026-10-04&book=1&patient=${target.id}`, { as: PEOPLE.farah, backend });
    const dialog = await screen.findByRole("dialog", { name: "New appointment" });
    expect(await within(dialog).findByText(target.full_name)).toBeTruthy();
    expect(within(dialog).queryByPlaceholderText("Name, clinic number or phone")).toBeNull();
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
    // Opened from the URL (`?book=1`, what the top bar's button navigates to), so nothing races the page's URL rewrite.
    renderPortal("/calendar?from=2026-10-03&to=2026-10-03&book=1", { as: PEOPLE.farah, backend });
    await user.type(await screen.findByPlaceholderText("Name, clinic number or phone", {}, { timeout: 15_000 }), "SD-1");
    await user.click(await screen.findByRole("button", { name: new RegExp(target.full_name) }));
    await chooseOption(user, screen.getByLabelText(/^Doctor/), "Dr Dev Rao");
    await user.click(screen.getByRole("switch", { name: "Assign a chair" }));
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

describe("Calendar: online requests", () => {
  async function requestOnline(backend: ReturnType<typeof fakeApi>) {
    const patient = backend.client({
      host: SUNRISE,
      getToken: () => fakeTokenFor({ id: "d0d0d0d0-0000-4000-8000-000000000001", email: "priya@example.test" }),
      now: () => NOW,
    });
    const options = await patient.getBookingOptions();
    if (!options.ok) throw new Error("expected options");
    const doctor = options.value.doctors[0]?.id ?? "";
    const slots = await patient.getAvailability("2026-10-05", doctor);
    if (!slots.ok) throw new Error("expected slots");
    const booked = await patient.createOnlineBooking({
      starts_at: slots.value.slots[0] ?? "",
      practitioner_id: doctor,
      full_name: "Priya Nair",
      phone: "9876543210",
    });
    if (!booked.ok) throw new Error("expected a booking");
    return booked.value;
  }

  it("shows a requested booking distinctly and lets the front desk confirm it", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const booked = await requestOnline(backend);
    renderPortal("/calendar?from=2026-10-05&to=2026-10-05", { as: PEOPLE.farah, backend });

    const chip = await screen.findByRole("button", { name: /Requested: Priya Nair/ });
    expect(chip.className).toContain(" q");
    await user.click(chip);
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    expect(within(dialog).getByText("Requested")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Mark arrived" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Marked confirmed")).toBeTruthy();

    const after = await backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW }).listAppointments({ from: "2026-10-05", to: "2026-10-05" });
    if (!after.ok) throw new Error("expected the calendar");
    expect(after.value.items.find((a) => a.id === booked.id)?.status).toBe("confirmed");
  });

  it("declines a request only with a reason", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const booked = await requestOnline(backend);
    renderPortal("/calendar?from=2026-10-05&to=2026-10-05", { as: PEOPLE.farah, backend });

    await user.click(await screen.findByRole("button", { name: /Requested: Priya Nair/ }));
    const dialog = await screen.findByRole("dialog", { name: "Appointment" });
    await user.click(within(dialog).getByRole("button", { name: "Decline" }));
    const send = within(dialog).getByRole("button", { name: "Decline request" });
    expect(send.hasAttribute("disabled")).toBe(true);
    await user.type(within(dialog).getByLabelText(/reason for declining/i), "Doctor unavailable");
    await user.click(send);
    expect(await screen.findByText("Request declined")).toBeTruthy();

    const after = await backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW }).listAppointments({ from: "2026-10-05", to: "2026-10-05" });
    if (!after.ok) throw new Error("expected the calendar");
    expect(after.value.items.find((a) => a.id === booked.id)?.status).toBe("cancelled");
  });
});

describe("Calendar: time grid", () => {
  it("places every appointment at its own clinic-time position, not in one bucket", async () => {
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", { as: PEOPLE.farah });
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-09-28/ });
    await waitFor(() => {
      expect(grid.querySelectorAll(".mk-tg-ev").length).toBeGreaterThan(1);
    });
    const hourLabels = [...grid.querySelectorAll(".mk-tg-hours span")].map((n) => n.textContent);
    expect(hourLabels[0]).toBe("8 am");
    const startHour = 8;
    const endHour = startHour + hourLabels.length;
    const tops = new Set<string>();
    for (const el of grid.querySelectorAll<HTMLElement>(".mk-tg-ev")) {
      const match = /at (\d{1,2}):(\d{2}) (am|pm)/.exec(el.getAttribute("aria-label") ?? "");
      if (match === null) throw new Error("expected a time in the label");
      const hour = (Number(match[1]) % 12) + (match[3] === "pm" ? 12 : 0);
      const minutes = hour * 60 + Number(match[2]);
      const expected = ((minutes - startHour * 60) / ((endHour - startHour) * 60)) * 100;
      expect(Number.parseFloat(el.style.top)).toBeCloseTo(expected, 3);
      tops.add(el.style.top);
    }
    expect(tops.size).toBeGreaterThan(1);
  });

  it("opens an appointment from the grid", async () => {
    const user = userEvent.setup();
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", { as: PEOPLE.farah });
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-09-28/ });
    await waitFor(() => {
      expect(grid.querySelector(".mk-tg-ev")).not.toBeNull();
    });
    const first = grid.querySelector<HTMLElement>(".mk-tg-ev");
    if (first === null) throw new Error("expected an appointment");
    await user.click(first);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("Calendar: month view", () => {
  it("shows the month with counts and opens a day in the Day view", async () => {
    const user = userEvent.setup();
    renderPortal("/calendar?from=2026-10-01&to=2026-10-01", { as: PEOPLE.farah });
    await user.click(await screen.findByRole("button", { name: "Month" }));
    const month = await screen.findByRole("group", { name: "Appointments in 2026-10" });
    expect(screen.getByText("October 2026")).toBeTruthy();
    const day = await within(month).findByRole("button", { name: /^2026-10-03, \d+ appointments?\. Open day/ });
    expect(day.textContent).toMatch(/\d+$/);
    await user.click(day);
    expect(screen.getByRole("button", { name: "Day" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByRole("group", { name: "Appointments from 2026-10-03 to 2026-10-03" })).toBeTruthy();
  });
});

type FakeVisit = Fixtures["visits"][number];

/** Three walk-ins in Sunrise:closed this morning with no chair, open now in Chair 1 from a token, and one left open on 30 Sep. */
function withWalkIns(fixtures: Fixtures) {
  const base = fixtures.visits.find((v) => v.appointment_id == null);
  if (base === undefined) throw new Error("expected a fixture visit");
  const room = fixtures.rooms.find((r) => r.clinic_id === base.clinic_id && r.name === "Chair 1");
  const [closed, open, stale] = fixtures.patients.filter((p) => p.clinic_id === base.clinic_id).slice(-3);
  if (room === undefined || closed === undefined || open === undefined || stale === undefined) throw new Error("expected fixture patients and Chair 1");
  fixtures.queueTokens.push({ id: "walk-in-token", clinic_id: base.clinic_id, branch_id: room.branch_id, day: "2026-10-03", token_number: 41, patient_id: open.id, appointment_id: null, status: "in_chair", issued_at: "2026-10-03T04:50:00Z", room_id: room.id });
  const visit = (id: string, patient: string, startedAt: string, extra: Partial<FakeVisit>): FakeVisit => ({ ...base, id, number: id, patient_id: patient, appointment_id: null, queue_token_id: null, status: "open", started_at: startedAt, ended_at: null, ...extra });
  fixtures.visits.push(
    visit("visit-closed", closed.id, "2026-10-03T03:00:00Z", { status: "closed", ended_at: "2026-10-03T03:45:00Z" }),
    visit("visit-open", open.id, "2026-10-03T05:00:00Z", { queue_token_id: "walk-in-token" }),
    visit("visit-stale", stale.id, "2026-09-30T05:00:00Z", {}),
  );
  return { closed: closed.full_name, open: open.full_name, stale: stale.full_name };
}

function walkInChips(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".mk-tg-ev[data-walk-in]")];
}

function walkInChip(container: HTMLElement, name: string): HTMLElement {
  const found = walkInChips(container).find((el) => (el.getAttribute("aria-label") ?? "").startsWith(`${name}, walk-in`));
  if (found === undefined) throw new Error(`expected a walk-in for ${name}`);
  return found;
}

/** The chip's height as a share of the grid, from its `calc(N% - 2px)`. */
function heightOf(el: HTMLElement): number {
  return Number.parseFloat(/calc\(([\d.]+)%/.exec(el.style.height)?.[1] ?? "0");
}

describe("Calendar: walk-ins", () => {
  // The calendar's "today" comes from the clock: pin it to the fixtures' day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws walk-ins in the week with a dashed outline: closed green, open today in the chair, an older open one neutral", async () => {
    let names = { closed: "", open: "", stale: "" };
    const backend = fakeApi((f) => {
      names = withWalkIns(f);
    });
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", { as: PEOPLE.farah, backend });
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-09-28/ });
    await waitFor(() => {
      expect(walkInChips(grid)).toHaveLength(3);
    });
    const closed = walkInChip(grid, names.closed);
    expect(closed.classList.contains("g")).toBe(true);
    expect(closed.classList.contains("walkin")).toBe(true);
    expect(closed.dataset.status).toBe("completed");
    expect(closed.textContent).toContain("Walk-in");
    const open = walkInChip(grid, names.open);
    expect(open.dataset.status).toBe("in_chair");
    expect(open.classList.contains("b")).toBe(true);
    expect(open.getAttribute("aria-label")).toContain("Chair 1");
    // Closed: start to end (45 minutes); open: the default 30-minute visit.
    expect(heightOf(closed) / heightOf(open)).toBeCloseTo(1.5, 1);
    const stale = walkInChip(grid, names.stale);
    expect(stale.classList.contains("n")).toBe(true);
    expect(stale.dataset.status).toBeUndefined();
    expect(grid.querySelectorAll(".mk-tg-ev:not([data-walk-in])").length).toBeGreaterThan(0);
  });

  it("opens the patient when a walk-in is chosen, not an appointment dialog", async () => {
    const user = userEvent.setup();
    let name = "";
    const backend = fakeApi((f) => {
      name = withWalkIns(f).closed;
    });
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", { as: PEOPLE.farah, backend });
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-09-28/ });
    await waitFor(() => {
      expect(walkInChips(grid).length).toBeGreaterThan(0);
    });
    await user.click(walkInChip(grid, name));
    await waitFor(() => {
      expect(screen.queryByRole("group", { name: /Appointments from 2026-09-28/ })).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await screen.findAllByText(name)).length).toBeGreaterThan(0);
  });

  it("puts a walk-in with no chair in an Unassigned lane in the day by chair", async () => {
    const user = userEvent.setup();
    let names = { closed: "", open: "", stale: "" };
    const backend = fakeApi((f) => {
      names = withWalkIns(f);
    });
    renderPortal("/calendar?from=2026-10-03&to=2026-10-03", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "Day" }));
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-10-03/ });
    await waitFor(() => {
      expect(walkInChips(grid)).toHaveLength(2);
    });
    const heads = [...grid.querySelectorAll(".mk-tg-head .mk-dh")].map((n) => n.firstChild?.textContent);
    expect(heads.at(-1)).toBe("Unassigned");
    const columns = [...grid.querySelectorAll<HTMLElement>(".mk-tg-body .mk-tg-col")];
    expect(columns.at(-1)?.querySelector(`[aria-label^="${names.closed}, walk-in"]`)).not.toBeNull();
    expect(columns[heads.indexOf("Chair 1")]?.querySelector(`[aria-label^="${names.open}, walk-in"]`)).not.toBeNull();
  });

  it("counts walk-ins in the month's day numbers", async () => {
    const user = userEvent.setup();
    const backend = fakeApi((f) => {
      withWalkIns(f);
    });
    renderPortal("/calendar?from=2026-10-01&to=2026-10-01", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "Month" }));
    const month = await screen.findByRole("group", { name: "Appointments in 2026-10" });
    expect(await within(month).findByRole("button", { name: /^2026-10-03, \d+ appointments? and 2 walk-ins\. Open day/ })).toBeTruthy();
    expect(within(month).getByRole("button", { name: /^2026-09-30, \d+ appointments? and 1 walk-in\. Open day/ })).toBeTruthy();
  });

  it("keeps the appointments when walk-ins fail", async () => {
    const backend = fakeApi((f) => {
      withWalkIns(f);
    });
    const failed: ApiResult<CalendarWalkInPage> = { ok: false, error: { status: 500, code: "internal", message: "Something went wrong" } };
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", {
      as: PEOPLE.farah,
      backend,
      wrap: (client) => ({ ...client, listWalkIns: () => Promise.resolve(failed) }),
    });
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-09-28/ });
    await waitFor(() => {
      expect(grid.querySelectorAll(".mk-tg-ev").length).toBeGreaterThan(0);
    });
    expect(walkInChips(grid)).toHaveLength(0);
    expect(await screen.findByText("Walk-ins couldn't be loaded. Appointments are shown.")).toBeTruthy();
  });

  it("shows the appointments while walk-ins are still loading", async () => {
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", {
      as: PEOPLE.farah,
      wrap: (client) => ({ ...client, listWalkIns: () => new Promise<never>(() => undefined) }),
    });
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-09-28/ });
    await waitFor(() => {
      expect(grid.querySelectorAll(".mk-tg-ev").length).toBeGreaterThan(0);
    });
    expect(walkInChips(grid)).toHaveLength(0);
  });
});
