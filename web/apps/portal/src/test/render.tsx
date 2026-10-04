import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import type { ApiClient } from "@aarogyam/api-client";
import { createFakeBackend, createFixtures, fakeTokenFor, type FakeBackend, type Fixtures } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../app.js";
import { routes } from "../routes.js";

export const NOW = new Date("2026-10-03T05:30:00Z");

/** The API's development seed. */
export const PEOPLE = {
  asha: "a1a1a1a1-0000-4000-8000-000000000001",
  dev: "a1a1a1a1-0000-4000-8000-000000000002",
  farah: "a1a1a1a1-0000-4000-8000-000000000003",
  bina: "b1b1b1b1-0000-4000-8000-000000000001",
  admin: "c1c1c1c1-0000-4000-8000-000000000001",
} as const;

/** A fake API over the seed fixtures, optionally changed first (say, to give someone a narrower role). */
export function fakeApi(prepare: (fixtures: Fixtures) => void = () => undefined): FakeBackend {
  const fixtures = createFixtures({ now: NOW });
  prepare(fixtures);
  return createFakeBackend(fixtures);
}

export interface RenderOptions {
  /** Signed in as this person; signed out when omitted. */
  as?: string;
  backend?: FakeBackend;
  /** Wraps each clinic client, to spy on or stub calls. */
  wrap?: (client: ApiClient) => ApiClient;
}

/** Renders the portal at `path` on fake data. */
export function renderPortal(path: string, { as, backend = fakeApi(), wrap = (client) => client }: RenderOptions = {}) {
  const auth = createDevAuth({
    people: backend.users().map((u) => ({ id: u.id, displayName: u.display_name })),
    tokenFor: fakeTokenFor,
    storage: null,
  });
  if (as !== undefined) {
    auth.signInAs(as);
  }
  const services = {
    auth,
    mode: "fake" as const,
    neutral: backend.client({ getToken: auth.getAccessToken, now: () => NOW }),
    clinic: (host: string) => wrap(backend.client({ host, getToken: auth.getAccessToken, now: () => NOW })),
  };
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers services={services} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { router, auth, backend };
}
