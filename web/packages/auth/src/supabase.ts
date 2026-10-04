/**
 * Email one-time-code sign-in through Supabase Auth. Imported on its own path so builds that
 * use development sign-in never include the Supabase library.
 */

import { createClient } from "@supabase/supabase-js";

import { AUTH_MESSAGES, createAuthStore, type AuthOutcome, type AuthState, type EmailCodeAuthClient } from "./auth-client.js";

interface SupabaseError {
  name: string;
  message: string;
  status?: number | undefined;
  code?: string | undefined;
}

interface SupabaseSession {
  access_token: string;
  user: { id: string; email?: string | undefined };
}

/** The parts of Supabase's auth client this adapter uses. `createClient(...).auth` satisfies it. */
export interface SupabaseAuthApi {
  signInWithOtp(credentials: { email: string; options: { shouldCreateUser: boolean } }): Promise<{ error: SupabaseError | null }>;
  verifyOtp(params: { email: string; token: string; type: "email" }): Promise<{
    data: { session: SupabaseSession | null };
    error: SupabaseError | null;
  }>;
  getSession(): Promise<{ data: { session: SupabaseSession | null } }>;
  onAuthStateChange(callback: (event: string, session: SupabaseSession | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
  signOut(): Promise<{ error: SupabaseError | null }>;
}

const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"]);

function isRateLimited(error: SupabaseError): boolean {
  return error.status === 429 || (error.code !== undefined && RATE_LIMIT_CODES.has(error.code));
}

function isNetworkFailure(error: SupabaseError): boolean {
  return error.name === "AuthRetryableFetchError" || error.status === undefined || error.status === 0;
}

const failed = (code: Exclude<AuthOutcome, { ok: true }>["code"], message: string): AuthOutcome => ({ ok: false, code, message });

function fromSession(session: SupabaseSession | null): AuthState {
  return session === null
    ? { status: "signed_out" }
    : { status: "signed_in", user: { id: session.user.id, email: session.user.email } };
}

/** Wraps Supabase's auth client in the `EmailCodeAuthClient` boundary. */
export function createSupabaseAuth(api: SupabaseAuthApi): EmailCodeAuthClient {
  const store = createAuthStore({ status: "loading" });
  api.onAuthStateChange((_event, session) => {
    store.set(fromSession(session));
  });
  void api.getSession().then(
    ({ data }) => {
      if (store.get().status === "loading") {
        store.set(fromSession(data.session));
      }
    },
    () => {
      store.set({ status: "signed_out" });
    },
  );

  return {
    kind: "email_code",
    getState: store.get,
    subscribe: store.subscribe,
    getAccessToken: async () => {
      const { data } = await api.getSession();
      return data.session?.access_token ?? null;
    },
    requestCode: async (email) => {
      try {
        // Existing accounts only: the console and portal never sign people up.
        const { error } = await api.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (error === null) {
          return { ok: true };
        }
        if (isRateLimited(error)) {
          return failed("rate_limited", AUTH_MESSAGES.rateLimited);
        }
        if (isNetworkFailure(error)) {
          return failed("network", AUTH_MESSAGES.network);
        }
        if (error.code === "email_address_invalid" || error.code === "validation_failed") {
          return failed("invalid_email", AUTH_MESSAGES.invalidEmail);
        }
        // Unknown or disabled accounts look exactly like success, so nobody can probe who is registered.
        return { ok: true };
      } catch {
        return failed("network", AUTH_MESSAGES.network);
      }
    },
    verifyCode: async (email, code) => {
      try {
        const { data, error } = await api.verifyOtp({ email, token: code, type: "email" });
        if (error === null) {
          store.set(fromSession(data.session));
          return { ok: true };
        }
        if (isRateLimited(error)) {
          return failed("rate_limited", AUTH_MESSAGES.rateLimited);
        }
        if (isNetworkFailure(error)) {
          return failed("network", AUTH_MESSAGES.network);
        }
        return failed("invalid_code", AUTH_MESSAGES.invalidCode);
      } catch {
        return failed("network", AUTH_MESSAGES.network);
      }
    },
    signOut: async () => {
      await api.signOut();
      store.set({ status: "signed_out" });
    },
  };
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** Keeps each app's session separate in storage. */
  storageKey: string;
}

/** The real thing: a Supabase client for `config`, wrapped in the boundary. */
export function createSupabaseAuthClient(config: SupabaseConfig): EmailCodeAuthClient {
  const supabase = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: config.storageKey },
  });
  return createSupabaseAuth(supabase.auth);
}
