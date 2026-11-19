import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { failure, type ApiClient, type CostInsights } from "@aarogyam/api-client";
import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../../app.js";
import { routes } from "../../routes.js";
import { formatAmount, formatUsd } from "./cost-tab.js";

type Cost = "fake" | "unavailable" | "error";

function renderConsole(path: string, cost: Cost = "fake") {
  const backend = createFakeBackend(createFixtures({ now: new Date("2026-10-16T00:00:00Z") }));
  const team = backend.platformUsers();
  const auth = createDevAuth({ people: team.map((p) => ({ id: p.id, displayName: p.display_name })), tokenFor: fakeTokenFor, storage: null });
  auth.signInAs(team[0]?.id ?? "");
  const client = backend.client({ getToken: auth.getAccessToken, now: () => new Date("2026-10-16T00:00:00Z") });
  const unavailable = async (): ReturnType<ApiClient["getCostInsights"]> => {
    const result = await client.getCostInsights();
    if (!result.ok) {
      return result;
    }
    const value: CostInsights = {
      ...result.value,
      source: "unavailable",
      items: result.value.items.filter((item) => item.provider !== "cloud_run"),
      total_usd: null,
      forecast_usd: null,
      total_inr: null,
      total_gst_inr: null,
      forecast_inr: null,
      forecast_gst_inr: null,
    };
    return { ok: true, value };
  };
  const api: ApiClient =
    cost === "fake"
      ? client
      : {
          ...client,
          getCostInsights: cost === "unavailable" ? unavailable : () => Promise.resolve(failure({ status: 500, code: "internal", message: "Something went wrong." })),
        };
  render(
    <Providers services={{ auth, api }} queryClient={createQueryClient()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </Providers>,
  );
}

describe("cost tab", () => {
  it("prices Cloud Run after the free tier, with totals, the label, the Billing link and free plans", async () => {
    renderConsole("/health?tab=cost");
    expect(await screen.findByText("So far this month")).toBeTruthy();
    expect(screen.getByText("Forecast for the month")).toBeTruthy();
    expect(screen.getByText("Estimate — this project only; the free tier is shared across the billing account")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Google Cloud Billing/ }).getAttribute("href")).toBe("https://console.cloud.google.com/billing");
    expect(screen.getAllByText("API vCPU time").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Drain job memory time").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("progressbar", { name: "API requests: free left" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GST/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Supabase database size").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not read").length).toBeGreaterThan(0);
  });

  it("says plainly when there is no Cloud Run usage to price, and still shows the free plans", async () => {
    renderConsole("/health?tab=cost", "unavailable");
    expect(await screen.findByText("No Cloud Run usage to price here")).toBeTruthy();
    expect(screen.queryByText("So far this month")).toBeNull();
    expect(screen.getAllByText("Supabase database size").length).toBeGreaterThan(0);
  });

  it("offers a retry when the estimate can't be loaded", async () => {
    renderConsole("/health?tab=cost", "error");
    expect(await screen.findByText("Couldn't load the cost estimate")).toBeTruthy();
  });

  it("puts the month's forecast on the overview tile", async () => {
    renderConsole("/health");
    const label = await screen.findByText("Est. cost this month");
    const tile = label.closest("a");
    expect(tile?.getAttribute("href")).toBe("/health?tab=cost&range=1h");
    expect(await within(tile ?? document.body).findByText(/so far/)).toBeTruthy();
  });

  it("says on the tile when usage isn't available", async () => {
    renderConsole("/health", "unavailable");
    expect(await screen.findByText("Cloud Run usage isn't available here")).toBeTruthy();
  });
});

describe("cost formats", () => {
  it("shows amounts in their unit and tiny dollar amounts as under a cent", () => {
    expect(formatAmount(1.25, "GiB")).toBe("1.3 GiB");
    expect(formatAmount(214_000.4, "vCPU-s")).toBe("2,14,000 vCPU-s");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.001)).toBe("< $0.01");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});
