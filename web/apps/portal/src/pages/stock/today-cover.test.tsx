import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { success, type ApiClient } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, renderPortal } from "../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** A board with only the "Needs attention" widget, whose stock lines are the low-stock tile. */
function attentionOnly(client: ApiClient, cover: number | undefined): ApiClient {
  return {
    ...client,
    getMyDashboardLayout: async () => {
      const real = await client.getMyDashboardLayout();
      return real.ok
        ? success({
            ...real.value,
            layout: { v: 2, tpl: "medsync", density: "cozy", card: "soft", rail: { side: "right", width: "medium" }, items: [{ key: "attention", zone: "main", size: "L", opts: {} }] },
          })
        : real;
    },
    listLowStock: async (options) => {
      const real = await client.listLowStock(options);
      if (!real.ok || cover === undefined) return real;
      return success({ items: real.value.items.map((l) => ({ ...l, days_cover: cover, runs_out_on: "2026-10-06" })) });
    },
  };
}

describe("Today's low-stock tile (New look)", () => {
  it("shows days of cover for a low item when the projection knows it", async () => {
    renderPortal("/today", { as: PEOPLE.asha, wrap: (client) => attentionOnly(client, 3) });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/is running low[^]*Runs out in about 3 days/);
    });
  });

  it("says nothing about cover when it is unknown", async () => {
    renderPortal("/today", { as: PEOPLE.asha, wrap: (client) => attentionOnly(client, undefined) });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/is running low/);
    });
    expect(document.body.textContent).not.toMatch(/Runs out in about/);
  });
});
