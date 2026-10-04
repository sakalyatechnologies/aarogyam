import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import type { ApiClient } from "@aarogyam/api-client";
import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../app.js";
import { routes } from "../routes.js";

export const NOW = new Date("2026-10-03T05:30:00Z");

/** Users from the fixtures, by first name. */
export const USERS = {
  anika: "0199a000-0000-7000-8000-000000000001",
  sunita: "0199a000-0000-7000-8000-000000000003",
  ravi: "0199a000-0000-7000-8000-000000000004",
  vivek: "0199a000-0000-7000-8000-000000000005",
} as const;

/** Renders the portal at `path`, signed in as `userId`, on fake data; `wrap` can spy on calls. */
export function renderPortal(path: string, userId: string, wrap: (client: ApiClient) => ApiClient = (client) => client) {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const auth = createDevAuth({
    people: backend.users().map((u) => ({ id: u.id, displayName: u.display_name })),
    tokenFor: fakeTokenFor,
    storage: null,
  });
  auth.signInAs(userId);
  const services = {
    auth,
    neutral: backend.client({ getToken: auth.getAccessToken }),
    clinic: (host: string) => wrap(backend.client({ host, getToken: auth.getAccessToken })),
  };
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers services={services} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
}
