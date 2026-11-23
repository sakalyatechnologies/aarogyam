/** A clinic context over the fake API for hook and component tests, signed in as Asha at Sunrise. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { unwrap, type ApiClient } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";
import { createDevAuth } from "@aarogyam/auth";
import { ToastProvider } from "@sakalya/ui";

import { ClinicProvider } from "../clinic.js";
import { NOW, PEOPLE, fakeApi } from "./render.js";

export async function clinic(prepare?: Parameters<typeof fakeApi>[0], wrap: (client: ApiClient) => ApiClient = (client) => client) {
  const backend = fakeApi(prepare);
  const auth = createDevAuth({ people: backend.users().map((u) => ({ id: u.id, displayName: u.display_name })), tokenFor: fakeTokenFor, storage: null });
  auth.signInAs(PEOPLE.asha);
  const neutral = backend.client({ getToken: auth.getAccessToken, now: () => NOW });
  const me = await unwrap(neutral.getMe());
  const access = me.clinics.find((c) => c.slug === "sunrise") ?? me.clinics[0];
  if (access === undefined) throw new Error("no clinic");
  const api = wrap(backend.client({ host: access.host ?? "sunrise.localtest.me", getToken: auth.getAccessToken, now: () => NOW }));
  const session = await unwrap(api.getSession());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ClinicProvider value={{ me, access, session, api, can: () => true, switchClinic: () => undefined }}>{children}</ClinicProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  const mouthCalls = () => spy.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(["visit-mouth", access.org_id])).length;
  return { wrapper, api, mouthCalls, spy, access };
}
