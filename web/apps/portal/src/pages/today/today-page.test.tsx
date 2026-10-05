import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PEOPLE, renderPortal } from "../../test/render.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
}

describe.each(["UTC", "America/Los_Angeles"])("Today's schedule with the browser in %s", (browserZone) => {
  it("scrolls to the now marker and labels it with the clinic's time", async () => {
    vi.stubEnv("TZ", browserZone);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("mk-tlwrap")) return rect(0, 400);
      if (this.classList.contains("mk-now")) return rect(1000, 22);
      return rect(0, 0);
    });
    renderPortal("/today", { as: PEOPLE.farah });
    const region = await screen.findByRole("region", { name: /Today's schedule/ });
    // The fixture clock is 05:30 UTC, which is 11:00 am at the clinic.
    expect(within(region).getByLabelText("Now, 11:00 am")).toBeTruthy();
    await waitFor(() => {
      expect(region.scrollTop).toBe(1000 - 200 + 11);
    });
  });

  it("puts the marker between earlier and later appointments by clinic time", async () => {
    vi.stubEnv("TZ", browserZone);
    renderPortal("/today", { as: PEOPLE.farah });
    const region = await screen.findByRole("region", { name: /Today's schedule/ });
    const items = [...region.querySelectorAll("li")];
    const at = items.findIndex((li) => li.classList.contains("mk-now"));
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(items.length - 1);
    const minutes = (li: Element | undefined) => {
      const m = /(\d{1,2}):(\d{2}) (am|pm)/.exec(li?.querySelector(".mk-t")?.textContent ?? "");
      if (m === null) throw new Error("expected a time");
      return ((Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2]);
    };
    expect(minutes(items[at - 1])).toBeLessThanOrEqual(11 * 60);
    expect(minutes(items[at + 1])).toBeGreaterThan(11 * 60);
  });

  it("can be focused and scrolled from the keyboard", async () => {
    renderPortal("/today", { as: PEOPLE.farah });
    const region = await screen.findByRole("region", { name: /Today's schedule/ });
    expect(region.getAttribute("tabindex")).toBe("0");
  });
});
