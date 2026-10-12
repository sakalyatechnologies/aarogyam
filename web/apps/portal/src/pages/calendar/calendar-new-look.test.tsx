import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, AppointmentFilter } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, renderPortal } from "../../test/render.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Calendar (New look)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(NEW_LOOK_KEY, "1");
  });

  it("filters by doctor: choosing a chip sends practitioner_id, and the first load sends none", async () => {
    const user = userEvent.setup();
    const filters: AppointmentFilter[] = [];
    renderPortal("/calendar", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient) => ({
        ...client,
        listAppointments: (filter, options) => {
          filters.push(filter);
          return client.listAppointments(filter, options);
        },
      }),
    });
    const group = await screen.findByRole("group", { name: "Filter by doctor" });
    await waitFor(() => {
      expect(group.querySelectorAll("button").length).toBeGreaterThan(1);
    });
    const chips = [...group.querySelectorAll("button")];
    const all = chips[0];
    const doctor = chips.find((c) => c.textContent !== "All doctors");
    if (doctor === undefined) throw new Error("expected a doctor chip");
    expect(filters.every((f) => f.practitionerId === undefined)).toBe(true);

    await user.click(doctor);
    await waitFor(() => {
      expect(filters.some((f) => typeof f.practitionerId === "string")).toBe(true);
    });
    expect(doctor.getAttribute("aria-pressed")).toBe("true");

    if (all === undefined) throw new Error("expected All doctors");
    await user.click(all);
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(doctor.getAttribute("aria-pressed")).toBe("false");
  });

  it("Book opens the existing booking dialog", async () => {
    const user = userEvent.setup();
    renderPortal("/calendar", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Book" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByPlaceholderText("Name, clinic number or phone")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    renderPortal("/calendar", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Filter by doctor" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
