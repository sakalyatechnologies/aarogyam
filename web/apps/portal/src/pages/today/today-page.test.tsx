import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { failure } from "@aarogyam/api-client";
import type { Fixtures } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import { PX_PER_HOUR, TIMELINE_HEIGHT, scrollTopForNow } from "./day-timeline.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** jsdom does no layout, so give scroll areas the height their CSS would. */
function fakeLayout() {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("mk-tlwrap") ? TIMELINE_HEIGHT : 0;
  });
}

describe("scrollTopForNow", () => {
  it("centres now, and stays inside the scrollable range", () => {
    // 11:00 in a day that starts at 8: 3 hours down, minus half the viewport.
    expect(scrollTopForNow(11 * 60, 8, 440, 1248)).toBe(3 * PX_PER_HOUR - 220);
    expect(scrollTopForNow(8 * 60, 8, 440, 1248)).toBe(0);
    expect(scrollTopForNow(21 * 60, 8, 440, 1248)).toBe(1248 - 440);
  });
});

describe.each(["UTC", "America/Los_Angeles"])("Today's schedule with the browser in %s", (browserZone) => {
  it("is a fixed-height scroll area spanning the day, opened on now in the clinic's time", async () => {
    vi.stubEnv("TZ", browserZone);
    fakeLayout();
    renderPortal("/today", { as: PEOPLE.farah });
    const region = await screen.findByRole("region", { name: /Today's schedule/ });
    // The fixture clock is 05:30 UTC, which is 11:00 am at the clinic.
    expect(within(region).getByLabelText("Now, 11:00 am")).toBeTruthy();
    // A fixed viewport over a taller day (8 am to 9 pm), so it scrolls.
    expect(region.style.height).toBe(`${String(TIMELINE_HEIGHT)}px`);
    const day = region.querySelector<HTMLElement>(".mk-tl");
    expect(day).not.toBeNull();
    expect(Number.parseInt(day?.style.height ?? "0", 10)).toBeGreaterThan(TIMELINE_HEIGHT);
    expect(day?.dataset.startHour).toBe("8");
    expect(Number(day?.dataset.endHour)).toBeGreaterThanOrEqual(21);
    // It starts at now, not at the top.
    expect(region.scrollTop).toBe(scrollTopForNow(11 * 60, 8, TIMELINE_HEIGHT, Number.parseInt(day?.style.height ?? "0", 10)));
    expect(region.scrollTop).toBeGreaterThan(0);
  });

  it("places earlier visits above the now line and later ones below it, so both are reachable by scrolling", async () => {
    vi.stubEnv("TZ", browserZone);
    renderPortal("/today", { as: PEOPLE.farah });
    const region = await screen.findByRole("region", { name: /Today's schedule/ });
    const nowTop = Number.parseFloat(region.querySelector<HTMLElement>(".mk-now")?.style.top ?? "NaN");
    const tops = [...region.querySelectorAll<HTMLElement>(".mk-tl-ev")].map((li) => Number.parseFloat(li.style.top));
    expect(tops.length).toBeGreaterThan(1);
    expect(tops.some((top) => top < nowTop)).toBe(true);
    expect(tops.some((top) => top > nowTop)).toBe(true);
  });

  it("can be focused and scrolled from the keyboard", async () => {
    renderPortal("/today", { as: PEOPLE.farah });
    const region = await screen.findByRole("region", { name: /Today's schedule/ });
    expect(region.getAttribute("tabindex")).toBe("0");
  });
});

describe("Team today", () => {
  it("lists the doctors on duty with role and status, and the clinic's staff for those who manage staff", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "Team today" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Role", "Status"]);
    expect(within(table).getAllByText(/^(In|On leave|Active)$/).length).toBeGreaterThan(0);
    expect(await within(table).findAllByText("Active")).not.toHaveLength(0);
  });
});

describe("Today's hero", () => {
  it("gives a clinician the next consultation with a progress ring and Open patient record", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const hero = await screen.findByRole("region", { name: /(Next|Current) consultation/ });
    expect(within(hero).getByRole("img", { name: /of \d+ appointments completed/ })).toBeTruthy();
    expect(within(hero).getByRole("link", { name: /Open patient record/ }).getAttribute("href")).toMatch(/^\/patients\//);
  });

  it("gives the front desk the next arrival and checks them in", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.farah });
    const hero = await screen.findByRole("region", { name: "Next arrival" });
    await user.click(within(hero).getByRole("button", { name: "Check in" }));
    expect(await screen.findByText("Checked in")).toBeTruthy();
  });

  it("lists who is coming up with colour-coded status chips", async () => {
    renderPortal("/today", { as: PEOPLE.farah });
    const list = await screen.findByRole("list", { name: "Coming up" });
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(list).getAllByText(/^(Waiting|In chair|Booked|Confirmed|Requested)$/).length).toBeGreaterThan(0);
  });
});

/** Sunrise's day reduced to the given statuses, earliest first; every other appointment is cancelled. */
function sunriseDay(fixtures: Fixtures, statuses: readonly Fixtures["appointments"][number]["status"][], minutesAgo = 0) {
  const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
  const mine = fixtures.appointments.filter((a) => a.clinic_id === sunrise?.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  mine.forEach((appointment, index) => {
    const status = statuses[index];
    appointment.status = status ?? "cancelled";
    appointment.cancel_reason = status === undefined ? "Test" : null;
    appointment.arrived_at = status === "arrived" || status === "in_chair" ? appointment.starts_at : null;
    appointment.seated_at = status === "in_chair" ? appointment.starts_at : null;
    appointment.completed_at = null;
    if (index === 0 && minutesAgo > 0) {
      const start = new Date(NOW_MS - minutesAgo * 60_000);
      appointment.starts_at = start.toISOString();
      appointment.ends_at = new Date(start.getTime() + 30 * 60_000).toISOString();
    }
  });
  return { mine, fixtures };
}
const NOW_MS = Date.parse("2026-10-03T05:30:00Z");

const heroOf = () => screen.findByRole("region", { name: /(Next|Current) (consultation|arrival)/ });

describe("The visit flow on Today's hero", () => {
  it("offers Check in, then Start consultation, then Complete visit, and moves on to the next patient", async () => {
    const user = userEvent.setup();
    let first = "";
    let second = "";
    const backend = fakeApi((fixtures) => {
      const { mine } = sunriseDay(fixtures, ["confirmed", "booked"]);
      first = fixtures.patients.find((p) => p.id === mine[0]?.patient_id)?.full_name ?? "";
      second = fixtures.patients.find((p) => p.id === mine[1]?.patient_id)?.full_name ?? "";
    });
    renderPortal("/today", { as: PEOPLE.asha, backend });
    let hero = await heroOf();
    expect(within(hero).getByRole("heading", { name: first })).toBeTruthy();
    await user.click(within(hero).getByRole("button", { name: "Check in" }));
    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: /consultation/ })).getByRole("button", { name: "Start consultation" })).toBeTruthy();
    });
    hero = await heroOf();
    await user.click(within(hero).getByRole("button", { name: "Start consultation" }));
    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "Current consultation" })).getByRole("button", { name: "Complete visit" })).toBeTruthy();
    });
    hero = await heroOf();
    expect(within(hero).queryByRole("button", { name: "Check in" })).toBeNull();
    await user.click(within(hero).getByRole("button", { name: "Complete visit" }));
    await waitFor(() => {
      const next = screen.getByRole("region", { name: /consultation/ });
      expect(within(next).getByRole("heading", { name: second })).toBeTruthy();
      expect(within(next).getByRole("button", { name: "Check in" })).toBeTruthy();
    });
  });

  it("shows the change at once and puts it back when the API refuses", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend = fakeApi((fixtures) => {
      sunriseDay(fixtures, ["confirmed"]);
    });
    renderPortal("/today", {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        setAppointmentStatus: async () => {
          await gate;
          return failure({ status: 409, code: "conflict", message: "That appointment is already finished." });
        },
      }),
    });
    const hero = await heroOf();
    await user.click(within(hero).getByRole("button", { name: "Check in" }));
    // Optimistic: the next step is already offered while the request is still out.
    await within(await heroOf()).findByRole("button", { name: "Start consultation" });
    release();
    expect((await screen.findByRole("alert")).textContent).toBe("That appointment is already finished.");
    await within(await heroOf()).findByRole("button", { name: "Check in" });
  });

  it("offers the same next step on Patient 360", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const { mine } = sunriseDay(fixtures, ["arrived"]);
      path = `/patients/${mine[0]?.patient_id ?? ""}`;
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Start consultation" }));
    await screen.findByRole("button", { name: "Complete visit" });
    expect(screen.queryByRole("button", { name: "Start consultation" })).toBeNull();
  });
});

describe("Alerts on Today", () => {
  it("says in plain words who hasn't arrived, with the actions to settle it", async () => {
    const user = userEvent.setup();
    let name = "";
    const backend = fakeApi((fixtures) => {
      const { mine } = sunriseDay(fixtures, ["booked"], 40);
      const patient = fixtures.patients.find((p) => p.id === mine[0]?.patient_id);
      name = patient?.full_name ?? "";
      if (patient !== undefined) patient.phone = "+919876543210";
    });
    renderPortal("/today", { as: PEOPLE.asha, backend });
    const alert = (await screen.findAllByText(/hasn't arrived/))[0]?.closest(".mk-alert");
    if (!(alert instanceof HTMLElement)) throw new Error("expected an alert");
    expect(alert.textContent).toContain(`${name} hasn't arrived — appointment 10:20 am, 40 min late`);
    const call = await within(alert).findByRole("link", { name: `Call ${name}` });
    expect(call.getAttribute("href")).toBe("tel:+919876543210");
    expect(within(alert).getByRole("button", { name: "No-show" })).toBeTruthy();
    await user.click(within(alert).getByRole("button", { name: "Mark arrived" }));
    expect(await screen.findByText(`${name} marked as arrived`)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/hasn't arrived/)).toBeNull();
    });
  });

  it("marks a late patient as a no-show", async () => {
    const user = userEvent.setup();
    const backend = fakeApi((fixtures) => {
      sunriseDay(fixtures, ["booked"], 40);
    });
    renderPortal("/today", { as: PEOPLE.asha, backend });
    const alert = (await screen.findAllByText(/hasn't arrived/))[0]?.closest(".mk-alert");
    if (!(alert instanceof HTMLElement)) throw new Error("expected an alert");
    await user.click(within(alert).getByRole("button", { name: "No-show" }));
    expect(await screen.findByText(/marked as no-show/)).toBeTruthy();
  });
});
