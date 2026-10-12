import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";
import { fakeTokenFor, type FakeBackend } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";
const AWAY_DAY = "2026-09-30";
const WEEK = "/calendar?from=2026-09-28&to=2026-10-04";

afterEach(cleanup);

function as(backend: FakeBackend, who: string): ApiClient {
  return backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
}

/** The owner puts Dev away for a whole day, with a private kind and reason. Returns Dev's practitioner id and name. */
async function sendDevAway(backend: FakeBackend): Promise<{ id: string; name: string }> {
  const owner = as(backend, PEOPLE.asha);
  const staff = await owner.listStaff();
  const doctors = await owner.listPractitioners();
  if (!staff.ok || !doctors.ok) throw new Error("expected staff and doctors");
  const member = staff.value.members.find((m) => m.user_id === PEOPLE.dev);
  const doctor = doctors.value.items.find((p) => p.membership_id === member?.id);
  if (member === undefined || doctor === undefined) throw new Error("expected Dev");
  const saved = await owner.requestTimeOff({ kind: "sick", first_day: AWAY_DAY, last_day: AWAY_DAY, reason: "Dental surgery", membership_id: member.id });
  if (!saved.ok || saved.value.status !== "approved") throw new Error("expected approved time off");
  return { id: doctor.id, name: doctor.display_name };
}

async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("Calendar: time off", () => {
  it("draws approved time off as an Away band in the week and month, and never shows the kind or reason", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const dev = await sendDevAway(backend);
    // Front desk holds no time_off.manage, so what they get is what every other member sees.
    renderPortal(WEEK, { as: PEOPLE.farah, backend });
    expect((await screen.findByRole("note", { name: `Away · ${dev.name}` }, { timeout: 5000 })).textContent).toBe(`Away · ${dev.name}`);
    expect(document.body.textContent).not.toMatch(/Dental surgery|sick/i);
    expect(await axeViolations()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Month" }));
    const month = await screen.findByRole("group", { name: /Appointments in 2026-09/ });
    expect((await within(month).findByText(`Away · ${dev.name}`)).className).toContain("mk-away");
    expect(document.body.textContent).not.toMatch(/Dental surgery|sick/i);
  });

  it("marks the doctor who is away in the booking form's picker", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const dev = await sendDevAway(backend);
    renderPortal(`/calendar?from=${AWAY_DAY}&to=${AWAY_DAY}&book=1`, { as: PEOPLE.farah, backend });
    const dialog = await screen.findByRole("dialog", { name: "New appointment" });
    const picker = within(dialog).getByLabelText(/^Doctor/);
    await waitFor(() => {
      expect(within(picker).getByRole("option", { name: `${dev.name} (Away)` })).toBeTruthy();
    }, { timeout: 5000 });
    // The other doctor is not marked.
    expect(within(picker).getAllByRole("option").filter((o) => /\(Away\)/.test(o.textContent))).toHaveLength(1);
    await user.selectOptions(picker, dev.id);
    const notice = await within(dialog).findByRole("status");
    expect(notice.textContent).toMatch(/away at the chosen time/);
    expect(within(notice).getByRole("group", { name: "Free doctors" })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it("explains a refused booking (422 practitioner_on_leave) and suggests free doctors", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const dev = await sendDevAway(backend);
    const patients = await as(backend, PEOPLE.farah).listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const patient = patients.value.items[0];
    if (patient === undefined) throw new Error("expected a patient");
    renderPortal(`/calendar?from=${AWAY_DAY}&to=${AWAY_DAY}&patient=${patient.id}&book=1`, {
      as: PEOPLE.farah,
      backend,
      // The form does not know about the leave, so the server's refusal is what the person meets.
      wrap: (client) => ({ ...client, listTimeOff: () => Promise.resolve({ ok: true as const, value: { items: [] } }) }),
    });
    const dialog = await screen.findByRole("dialog", { name: "New appointment" });
    const picker = within(dialog).getByLabelText(/^Doctor/);
    await waitFor(() => {
      expect(within(picker).getAllByRole("option").length).toBeGreaterThan(2);
    }, { timeout: 5000 });
    await user.selectOptions(picker, dev.id);
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Book appointment" }).hasAttribute("disabled")).toBe(false);
    }, { timeout: 5000 });
    await user.click(within(dialog).getByRole("button", { name: "Book appointment" }));
    const alert = await within(dialog).findByRole("alert", {}, { timeout: 5000 });
    expect(alert.textContent).toMatch(/away at this time/);
    expect(alert.textContent).not.toMatch(/practitioner_on_leave/);
    const free = within(dialog).getByRole("group", { name: "Free doctors" });
    const other = within(free).getAllByRole("button");
    expect(other.length).toBeGreaterThan(0);
    expect(other.map((b) => b.textContent)).not.toContain(dev.name);
    // Choosing a suggestion switches the doctor and clears the refusal.
    const suggestion = other[0];
    if (suggestion === undefined) throw new Error("expected a suggestion");
    await user.click(suggestion);
    await waitFor(() => {
      expect(within(dialog).queryByRole("alert")).toBeNull();
    });
  });
});
