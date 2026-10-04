import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../../app.js";
import { routes } from "../../routes.js";
import { bucketSeries } from "./metrics-view.js";

function renderConsole(path: string, signedIn: boolean) {
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
  const services = { auth, api: backend.client({ getToken: auth.getAccessToken }) };
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
    expect(screen.getByRole("button", { name: "Aarav Kulkarni" })).toBeTruthy();
  });

  it("shows service health tiles, routes and the database", async () => {
    renderConsole("/health?range=24h&env=production", true);
    expect(await screen.findByText("Requests per minute")).toBeTruthy();
    expect(screen.getByText("Success rate")).toBeTruthy();
    expect(screen.getAllByText("/api/v1/today").length).toBeGreaterThan(0);
    expect(screen.getByText("Cache hit ratio")).toBeTruthy();
    expect(screen.getByText("Core Web Vitals")).toBeTruthy();
  });

  it("says edge analytics are not connected when the API has none", async () => {
    renderConsole("/health?range=1h&env=staging", true);
    expect(await screen.findByText("Not connected yet")).toBeTruthy();
  });
});

describe("bucketSeries", () => {
  it("merges 24 hourly points into 12 two-hour columns, keeping the worst p95", () => {
    const series = Array.from({ length: 24 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 9, 2, i)).toISOString(),
      requests: 10,
      errors: 1,
      p95_ms: i === 5 ? 900 : 200,
    }));
    const buckets = bucketSeries(series, "24h", "Asia/Kolkata");
    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toEqual({ label: "05:30", requests: 20, errors: 2, p95: 200 });
    expect(buckets[2]?.p95).toBe(900);
  });
});
