import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../../app.js";
import { routes } from "../../routes.js";
import { timeFormatter, timelineView } from "./metrics-view.js";

function renderConsole(path: string, signedIn: boolean, edgeConnected = true) {
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
  const api = edgeConnected
    ? client
    : {
        ...client,
        getMetrics: async (...args: Parameters<typeof client.getMetrics>) => {
          const result = await client.getMetrics(...args);
          return result.ok ? { ...result, value: { ...result.value, edge: null } } : result;
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

  it("shows service health tiles, routes and the database", async () => {
    renderConsole("/health?range=24h", true);
    expect(await screen.findByText("Success rate")).toBeTruthy();
    expect(screen.getAllByText("Requests per minute").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/api/v1/today").length).toBeGreaterThan(0);
    expect(screen.getByText("Cache hit ratio")).toBeTruthy();
    expect(screen.getByText("Core Web Vitals")).toBeTruthy();
  });

  it("draws the five line charts with a latency budget and a 1h/6h/24h toggle", async () => {
    renderConsole("/health", true);
    await screen.findByText("Success rate");
    for (const title of ["Requests per minute", "Errors per minute", "Error rate", "Errors by class", "Latency"]) {
      expect(screen.getAllByRole("heading", { name: title }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("p95 budget 300 ms").length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: /split into 4xx client errors, 5xx server errors and 429/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "1 hour" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "6 hours" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "7 days" })).toBeNull();
  });

  it("says edge analytics are not connected when the API has none", async () => {
    renderConsole("/health?range=1h", true, false);
    expect(await screen.findByText("Not connected yet")).toBeTruthy();
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
