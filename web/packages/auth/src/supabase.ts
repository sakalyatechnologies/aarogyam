/**
 * Email one-time-code (and optional password) sign-in through Supabase Auth. Imported on its own path so builds that
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
  signInWithOtp(credentials: {
    email: string;
    options: { shouldCreateUser: boolean; emailRedirectTo?: string };
  }): Promise<{ error: SupabaseError | null }>;
  verifyOtp(params: { email: string; token: string; type: "email" } | { token_hash: string; type: "magiclink" }): Promise<{
    data: { session: SupabaseSession | null };
    error: SupabaseError | null;
  }>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { session: SupabaseSession | null };
    error: SupabaseError | null;
  }>;
  updateUser(attributes: { password: string }): Promise<{ error: SupabaseError | null }>;
  /** PKCE: trades the `?code=` query parameter of a magic-link email for a session. */
  exchangeCodeForSession(code: string): Promise<{ data: { session: SupabaseSession | null }; error: SupabaseError | null }>;
  /** The older implicit flow: a `#access_token`/`#refresh_token` fragment straight from the email. */
  setSession(params: { access_token: string; refresh_token: string }): Promise<{
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

export interface SupabaseAuthOptions {
  /**
   * Where the email's sign-in link sends the browser back to (`/auth/callback`). Omit for a
   * code-only flow, such as in tests.
   */
  redirectTo?: string;
}

/** Wraps Supabase's auth client in the `EmailCodeAuthClient` boundary. */
export function createSupabaseAuth(api: SupabaseAuthApi, options: SupabaseAuthOptions = {}): EmailCodeAuthClient {
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
        const { error } = await api.signInWithOtp({
          email,
          options:
            options.redirectTo === undefined
              ? { shouldCreateUser: false }
              : { shouldCreateUser: false, emailRedirectTo: options.redirectTo },
        });
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
    signInWithPassword: async (email, password) => {
      try {
        const { data, error } = await api.signInWithPassword({ email, password });
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
        // Wrong password, unknown email, unconfirmed or disabled account: one answer for all.
        return failed("invalid_credentials", AUTH_MESSAGES.invalidCredentials);
      } catch {
        return failed("network", AUTH_MESSAGES.network);
      }
    },
    setPassword: async (password) => {
      try {
        const { error } = await api.updateUser({ password });
        if (error === null) {
          return { ok: true };
        }
        if (isRateLimited(error)) {
          return failed("rate_limited", AUTH_MESSAGES.rateLimited);
        }
        if (isNetworkFailure(error)) {
          return failed("network", AUTH_MESSAGES.network);
        }
        if (error.code === "weak_password") {
          return failed("weak_password", AUTH_MESSAGES.weakPassword);
        }
        if (error.code === "same_password") {
          return failed("weak_password", "That is already your password. Choose a different one.");
        }
        return failed("rejected", AUTH_MESSAGES.passwordRejected);
      } catch {
        return failed("network", AUTH_MESSAGES.network);
      }
    },
    verifyTokenHash: async (tokenHash) => {
      try {
        const { data, error } = await api.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
        if (error === null) {
          store.set(fromSession(data.session));
          return { ok: true };
        }
        if (isRateLimited(error)) {
          return failed("rate_limited", AUTH_MESSAGES.rateLimited);
        }
        return isNetworkFailure(error) ? failed("network", AUTH_MESSAGES.network) : failed("invalid_code", EXPIRED_LINK);
      } catch {
        return failed("network", AUTH_MESSAGES.network);
      }
    },
    completeRedirect: async (url) => {
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");
        if (code !== null) {
          const { data, error } = await api.exchangeCodeForSession(code);
          if (error !== null) {
            return isNetworkFailure(error) ? failed("network", AUTH_MESSAGES.network) : failed("invalid_code", EXPIRED_LINK);
          }
          store.set(fromSession(data.session));
          return { ok: true };
        }
        const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
        const hashParams = new URLSearchParams(hash);
        if (hashParams.get("error_description") !== null || hashParams.get("error") !== null) {
          return failed("invalid_code", EXPIRED_LINK);
        }
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        if (accessToken !== null && refreshToken !== null) {
          const { data, error } = await api.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error !== null) {
            return isNetworkFailure(error) ? failed("network", AUTH_MESSAGES.network) : failed("invalid_code", EXPIRED_LINK);
          }
          store.set(fromSession(data.session));
          return { ok: true };
        }
        return failed("invalid_code", "This sign-in link is incomplete. Request a new code or link.");
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

const EXPIRED_LINK = "This sign-in link is invalid or has expired. Request a new code or link.";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** Keeps each app's session separate in storage. */
  storageKey: string;
}

/** The real thing: a Supabase client for `config`, wrapped in the boundary. */
export function createSupabaseAuthClient(config: SupabaseConfig): EmailCodeAuthClient {
  const supabase = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: config.storageKey, flowType: "pkce" },
  });
  // `completeRedirect` reads the callback URL itself, so Supabase's own listener never races it.
  const redirectTo = typeof window === "undefined" ? undefined : `${window.location.origin}/auth/callback`;
  return createSupabaseAuth(supabase.auth, redirectTo === undefined ? {} : { redirectTo });
}
