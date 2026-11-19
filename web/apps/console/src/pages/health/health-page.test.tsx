import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../../app.js";
import { routes } from "../../routes.js";
import { alignPoints, funnelCounts, timeFormatter, timelineView } from "./metrics-view.js";

function renderConsole(path: string, signedIn: boolean, cloud = true) {
  const backend = createFakeBackend(createFixtures({ now: new Date("2026-10-03T05:30:00Z") }));
  const team = backend.platformUsers();
  const auth = createDevAuth({
    people: team.map((p) => ({ id: p.id, displayName: p.display_name })),
    tokenFor: fakeTokenFor,
    storage: null,
  });
  if (signedIn) {
    auth.signInAs(team[0]?.id ?? "");
  }
  const client = backend.client({ getToken: auth.getAccessToken });
  const api = cloud
    ? client
    : {
        ...client,
        getMetrics: async (...args: Parameters<typeof client.getMetrics>) => {
          const result = await client.getMetrics(...args);
          return result.ok ? { ...result, value: { ...result.value, source: "instance" as const, cloud: null, cloud_error: "Cloud Monitoring: 403" } } : result;
        },
      };
  const services = { auth, api };
  render(
    <Providers services={services} queryClient={createQueryClient()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </Providers>,
  );
}

describe("console", () => {
  it("sends signed-out visitors to sign-in", async () => {
    renderConsole("/health", false);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sakalya Admin" })).toBeTruthy();
  });

  it("opens on the overview with tiles that link to each tab", async () => {
    renderConsole("/health", true);
    expect(await screen.findByRole("heading", { name: "Insights" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveProperty("ariaSelected", "true");
    expect(await screen.findByText("API success rate")).toBeTruthy();
    expect(screen.getByText("Source: Cloud Monitoring")).toBeTruthy();
    expect(screen.queryAllByText("Coming soon")).toHaveLength(0);
    expect(await screen.findByText("Pages shown within 2.5 s")).toBeTruthy();
    expect(await screen.findByText("Est. cost this month")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "30 days" })).toBeTruthy();
  });

  it("shows Cloud Run charts, then this instance's tiles, charts and routes", async () => {
    renderConsole("/health?tab=api&range=24h", true);
    expect(await screen.findByText("Requests by class")).toBeTruthy();
    expect(screen.getByText("Outbox job runs")).toBeTruthy();
    expect(screen.getByText("Success rate")).toBeTruthy();
    for (const title of ["Requests per minute", "Errors per minute", "Error rate", "Errors by class", "Latency"]) {
      expect(screen.getAllByRole("heading", { name: title }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("p95 budget 300 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/api/v1/today").length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: "24 hours" })).toHaveProperty("checked", true);
  });

  it("says the numbers are this instance's when Cloud Monitoring can't be read", async () => {
    renderConsole("/health?tab=api&range=1h", true, false);
    expect(await screen.findByText("This instance only")).toBeTruthy();
    expect(screen.getByText(/Cloud Monitoring: 403/)).toBeTruthy();
    expect(screen.queryByText("Requests by class")).toBeNull();
  });

  it("draws the database history and the database now", async () => {
    renderConsole("/health?tab=database&range=24h", true);
    expect(await screen.findByText("Database now")).toBeTruthy();
    for (const title of ["Connections", "Database size", "Cache hit ratio", "Transactions per minute", "Rows per minute", "Deadlocks and spills"]) {
      expect(screen.getAllByRole("heading", { name: title }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/select p.id, p.number/).length).toBeGreaterThan(0);
  });

  it("shows clinic usage, roles only from three people, and the onboarding funnel", async () => {
    renderConsole("/health?tab=usage&range=7d", true);
    expect(await screen.findByText("Clinics reporting")).toBeTruthy();
    expect(screen.getByText("Visits and bookings")).toBeTruthy();
    expect(screen.getByText("Typical timings")).toBeTruthy();
    expect(screen.getAllByText("Doctors 3, Front desk 3").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Onboarding funnel" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Sunrise Dental/ }).length).toBeGreaterThan(0);
  });

  it("links the overview's front-end tile to the Front end tab", async () => {
    renderConsole("/health?range=7d", true);
    const tile = await screen.findByText("Pages shown within 2.5 s");
    expect(tile.closest("a")?.getAttribute("href")).toBe("/health?tab=frontend&range=7d");
    expect(screen.queryByText("Front end coming soon")).toBeNull();
  });
});

describe("timelineView", () => {
  const point = (minute: number, over: Partial<{ requests: number; errors_4xx: number; errors_429: number; errors_5xx: number }> = {}) => ({
    at: new Date(Date.UTC(2026, 9, 3, 5, minute)).toISOString(),
    requests: 100,
    errors_4xx: 0,
    errors_429: 0,
    errors_5xx: 0,
    p50_ms: 20,
    p95_ms: 90,
    p99_ms: 200,
    ...over,
  });
  const api = (timeline: ReturnType<typeof point>[], seconds: number): Parameters<typeof timelineView>[0] => ({
    requests: 0,
    success_rate: 1,
    rate_4xx: 0,
    rate_5xx: 0,
    p50_ms: 0,
    p95_ms: 0,
    p99_ms: 0,
    series: [],
    routes: [],
    timeline,
    timeline_interval_seconds: seconds,
  });

  it("turns counts into per-minute rates and the failure percentage", () => {
    const view = timelineView(api([point(0), point(5, { requests: 500, errors_5xx: 10, errors_429: 5, errors_4xx: 20 })], 300));
    expect(view.requests).toEqual([20, 100]);
    expect(view.errors).toEqual([0, 3]);
    expect(view.errors4xx).toEqual([0, 4]);
    expect(view.errorRate[1]).toBeCloseTo(3);
    expect(view.total).toBe(600);
    expect(view.minutes).toBe(5);
  });

  it("gives a zero rate for an interval with no requests", () => {
    expect(timelineView(api([point(0, { requests: 0 })], 60)).errorRate).toEqual([0]);
  });

  it("labels the axis in the clinic's time zone", () => {
    expect(timeFormatter("1h", "Asia/Kolkata")(Date.UTC(2026, 9, 3, 5, 0))).toBe("10:30");
  });
});

describe("alignPoints", () => {
  it("puts series on one time axis with gaps where a series has no point", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 19, 9, minute)).toISOString();
    const aligned = alignPoints([
      [{ at: at(1), value: 2 }, { at: at(0), value: 1 }],
      [{ at: at(1), value: 5 }],
    ]);
    expect(aligned.times).toEqual([Date.UTC(2026, 10, 19, 9, 0), Date.UTC(2026, 10, 19, 9, 1)]);
    expect(aligned.values).toEqual([[1, 2], [null, 5]]);
  });
});

describe("funnelCounts", () => {
  it("counts clinics that reached each step", () => {
    const counts = funnelCounts([
      { owner_joined_at: "2026-11-01T00:00:00Z", first_patient_at: "2026-11-02T00:00:00Z", first_busy_week: null },
      { owner_joined_at: null },
    ]);
    expect(counts.map((step) => step.count)).toEqual([2, 1, 0, 1, 0, 0, 0]);
  });
});
