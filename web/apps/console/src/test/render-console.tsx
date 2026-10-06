import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createFakeBackend, createFixtures, fakeTokenFor, type FakeBackend } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../app.js";
import { routes } from "../routes.js";

type Client = ReturnType<FakeBackend["client"]>;

/** Renders the console at `path` against the fake backend, signed in as the first platform user unless told otherwise. */
export function renderConsole(path: string, options: { signedIn?: boolean; asClinicMember?: boolean; override?: (client: Client) => Client } = {}) {
  const { signedIn = true, asClinicMember = false, override } = options;
  const backend = createFakeBackend(createFixtures({ now: new Date("2026-10-03T05:30:00Z") }));
  const team = backend.platformUsers();
  const auth = createDevAuth({
    people: team.map((p) => ({ id: p.id, displayName: p.display_name })),
    tokenFor: fakeTokenFor,
    storage: null,
  });
  if (signedIn && asClinicMember) {
    // A clinic member who is not Sakalya staff, holding a session on the console host.
    auth.signInWithToken(fakeTokenFor({ id: backend.users()[0]?.id ?? "" }));
  } else if (signedIn) {
    auth.signInAs(team[0]?.id ?? "");
  }
  const client = backend.client({ getToken: auth.getAccessToken });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers services={{ auth, api: override === undefined ? client : override(client) }} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { router, backend, auth };
}
