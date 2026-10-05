import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { DateRange } from "@aarogyam/api-client";

import { PEOPLE, renderPortal } from "../../test/render.js";

describe("Settings: leave", () => {
  it("never asks the API for more than 31 days at once, and shows no range error", async () => {
    const asked: DateRange[] = [];
    renderPortal("/settings", {
      as: PEOPLE.asha,
      wrap: (client) => ({
        ...client,
        listLeave: (range, opts) => {
          asked.push(range);
          return client.listLeave(range, opts);
        },
      }),
    });
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Chairs and doctors" }));
    await screen.findByRole("table", { name: "Doctors" });
    expect(asked.length).toBeGreaterThan(0);
    for (const range of asked) {
      const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThan(31);
    }
    expect(screen.queryByText(/range is at most/)).toBeNull();
  });
});
