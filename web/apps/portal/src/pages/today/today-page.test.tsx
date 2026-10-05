import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PEOPLE, renderPortal } from "../../test/render.js";
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
    expect(within(table).getAllByText(/^(IN|ON LEAVE|ACTIVE)$/).length).toBeGreaterThan(0);
    expect(await within(table).findAllByText("ACTIVE")).not.toHaveLength(0);
  });
});
