import { createDevTokenSource, createHttpClient, type ApiClient } from "@aarogyam/api-client";
import { createDevAuth, type AuthClient } from "@aarogyam/auth";

import type { ConsoleEnv } from "./env.js";

export interface ConsoleServices {
  api: ApiClient;
  auth: AuthClient;
}

async function supabaseAuth(config: { url: string; anonKey: string }): Promise<AuthClient> {
  const { createSupabaseAuthClient } = await import("@aarogyam/auth/supabase");
  return createSupabaseAuthClient({ ...config, storageKey: "aarogyam-console-auth" });
}

/**
 * Chooses the sign-in (Supabase email codes when configured, otherwise the development picker)
 * and the API (fake in-memory data, or the real API).
 */
export async function createServices(env: ConsoleEnv): Promise<ConsoleServices> {
  if (env.apiMode === "http" && env.supabase !== null) {
    const auth = await supabaseAuth(env.supabase);
    return { auth, api: createHttpClient(env.apiBaseUrl, auth.getAccessToken) };
  }
  if (import.meta.env.PROD && env.apiMode === "http") {
    throw new Error("Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  const { createFakeBackend, createFixtures, fakeTokenFor } = await import("@aarogyam/api-client/fake");
  const backend = createFakeBackend(createFixtures());
  const team = backend.platformUsers();
  const auth =
    env.supabase === null
      ? createDevAuth({
          people: team.map((p) => ({ id: p.id, displayName: p.display_name, email: p.email, description: p.description })),
          // Against a local API, seeded people sign in through POST /api/v1/dev/token.
          tokenFor: env.apiMode === "http" ? createDevTokenSource(env.apiBaseUrl) : fakeTokenFor,
          storageKey: "aarogyam.console.dev-auth",
        })
      : await supabaseAuth(env.supabase);
  if (env.apiMode === "http") {
    return { auth, api: createHttpClient(env.apiBaseUrl, auth.getAccessToken) };
  }
  // A real Supabase session stands in for the first seeded team member, so fake data still loads.
  const standIn = team[0]?.id ?? "";
  const getToken =
    auth.kind === "dev" ? auth.getAccessToken : async () => ((await auth.getAccessToken()) === null ? null : fakeTokenFor(standIn));
  return { auth, api: backend.client({ getToken, latencyMs: 250 }) };
}
