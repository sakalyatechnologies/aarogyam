import { createDevTokenSource, createHttpClient, type ApiClient } from "@aarogyam/api-client";
import { createDevAuth, createParentDomainStorage, type AuthClient } from "@aarogyam/auth";

import type { PortalEnv } from "./env.js";

export interface PortalServices {
  auth: AuthClient;
  /**
   * `http`: every call goes to this page's own host, which the API reads the clinic from, so
   * opening another clinic means going to its host. `fake`: one page serves every clinic.
   */
  mode: "fake" | "http";
  /** Calls that work on any host: who the user is, accepting invitations. */
  neutral: ApiClient;
  /** A client for one clinic's host. */
  clinic: (host: string) => ApiClient;
}

const LATENCY_MS = 250;

/** In development a sign-in carries across clinic hosts on localtest.me through a parent-domain cookie. */
function devStorage() {
  return window.location.hostname.endsWith(".localtest.me") ? createParentDomainStorage("localtest.me") : undefined;
}

export async function createServices(env: PortalEnv): Promise<PortalServices> {
  if (env.apiMode === "http" && env.supabase !== null) {
    const { createSupabaseAuthClient } = await import("@aarogyam/auth/supabase");
    const auth = createSupabaseAuthClient({ ...env.supabase, storageKey: "aarogyam-portal-auth" });
    const api = createHttpClient(env.apiBaseUrl, auth.getAccessToken);
    return { auth, mode: "http", neutral: api, clinic: () => api };
  }
  if (import.meta.env.PROD && env.apiMode === "http") {
    throw new Error("Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  const { createFakeBackend, createFixtures, fakeTokenFor } = await import("@aarogyam/api-client/fake");
  const backend = createFakeBackend(createFixtures());
  const storage = devStorage();
  const auth = createDevAuth({
    // The API's development seed: the same people sign in through POST /api/v1/dev/token.
    people: backend.users().map((u) => ({ id: u.id, displayName: u.display_name, description: u.description })),
    tokenFor: env.apiMode === "http" ? createDevTokenSource(env.apiBaseUrl) : fakeTokenFor,
    storageKey: "aarogyam.portal.dev-auth",
    ...(storage === undefined ? {} : { storage }),
  });
  if (env.apiMode === "http") {
    const api = createHttpClient(env.apiBaseUrl, auth.getAccessToken);
    return { auth, mode: "http", neutral: api, clinic: () => api };
  }
  const clients = new Map<string, ApiClient>();
  return {
    auth,
    mode: "fake",
    neutral: backend.client({ getToken: auth.getAccessToken, latencyMs: LATENCY_MS }),
    clinic: (host) => {
      const client = clients.get(host) ?? backend.client({ host, getToken: auth.getAccessToken, latencyMs: LATENCY_MS });
      clients.set(host, client);
      return client;
    },
  };
}
