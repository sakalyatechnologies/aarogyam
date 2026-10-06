// Aarogyam-owned. The shared sign-in logic (@aarogyam/auth): email code or password, rate-limit
// messages, and wording that never says whether an account exists. Created in the browser only.
// Only the headless "/supabase" entry: the package root also exports its Base UI sign-in
// screens, which this site replaces with its own.
import type { createSupabaseAuthClient } from "@aarogyam/auth/supabase";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

type EmailCodeAuthClient = ReturnType<typeof createSupabaseAuthClient>;

let client: Promise<EmailCodeAuthClient> | undefined;

export const signInConfigured = SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";

export function getAuthClient(): Promise<EmailCodeAuthClient> {
  client ??= import("@aarogyam/auth/supabase").then(({ createSupabaseAuthClient }) =>
    createSupabaseAuthClient({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, storageKey: "aarogyam-site-auth" }),
  );
  return client;
}
