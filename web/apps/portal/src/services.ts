import { createDevTokenSource, createHttpClient, type ApiClient } from "@aarogyam/api-client";
import { createDevAuth, type AuthClient } from "@aarogyam/auth";

import type { PortalEnv } from "./env.js";

export interface PortalServices {
  auth: AuthClient;
  /** The neutral host: who the user is and which clinics they belong to. */
  neutral: ApiClient;
  /** A client for one clinic's host; the API resolves the clinic from that host name. */
  clinic: (host: string) => ApiClient;
}

const LATENCY_MS = 250;

/** `""` (same origin) when the portal is served from the clinic's own host, as in production. */
function originFor(host: string): string {
  return host === window.location.host ? "" : `${window.location.protocol}//${host}`;
}

function memo(make: (host: string) => ApiClient): (host: string) => ApiClient {
  const clients = new Map<string, ApiClient>();
  return (host) => {
    const existing = clients.get(host);
    if (existing !== undefined) {
      return existing;
    }
    const client = make(host);
    clients.set(host, client);
    return client;
  };
}

export async function createServices(env: PortalEnv): Promise<PortalServices> {
  if (env.apiMode === "http" && env.supabase !== null) {
    const { createSupabaseAuthClient } = await import("@aarogyam/auth/supabase");
    const auth = createSupabaseAuthClient({ ...env.supabase, storageKey: "aarogyam-portal-auth" });
    return {
      auth,
      neutral: createHttpClient(env.apiBaseUrl, auth.getAccessToken),
      clinic: memo((host) => createHttpClient(originFor(host), auth.getAccessToken)),
    };
  }
  if (import.meta.env.PROD && env.apiMode === "http") {
    throw new Error("Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  const { createFakeBackend, createFixtures, fakeTokenFor } = await import("@aarogyam/api-client/fake");
  const backend = createFakeBackend(createFixtures());
  const auth = createDevAuth({
    people: backend.users().map((u) => ({ id: u.id, displayName: u.display_name, email: u.email, description: u.description })),
    tokenFor: env.apiMode === "http" ? createDevTokenSource(env.apiBaseUrl) : fakeTokenFor,
    storageKey: "aarogyam.portal.dev-auth",
  });
  if (env.apiMode === "http") {
    return {
      auth,
      neutral: createHttpClient(env.apiBaseUrl, auth.getAccessToken),
      clinic: memo((host) => createHttpClient(originFor(host), auth.getAccessToken)),
    };
  }
  return {
    auth,
    neutral: backend.client({ getToken: auth.getAccessToken, latencyMs: LATENCY_MS }),
    clinic: memo((host) => backend.client({ host, getToken: auth.getAccessToken, latencyMs: LATENCY_MS })),
  };
}
