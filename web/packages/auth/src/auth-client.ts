/**
 * The sign-in boundary. Apps talk only to an `AuthClient`; which one they get (development
 * picker or Supabase email codes) is decided once at start-up.
 */

export interface AuthUser {
  id: string;
  email?: string | undefined;
  displayName?: string | undefined;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; user: AuthUser };

export type AuthErrorCode = "invalid_email" | "invalid_code" | "rate_limited" | "network";

/**
 * The result of asking for or checking a code. Messages never say whether an account exists,
 * so the sign-in form cannot be used to discover who is registered.
 */
export type AuthOutcome = { ok: true } | { ok: false; code: AuthErrorCode; message: string };

/** Function properties rather than methods, so they can be passed around unbound. */
interface AuthClientBase {
  getState: () => AuthState;
  /** Calls `listener` after every state change; returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
  /** The bearer token for API calls, or `null` when signed out. */
  getAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

/** A person to sign in as without a network, for local development. */
export interface DevPerson {
  id: string;
  displayName: string;
  email?: string | undefined;
  /** What signing in as this person shows. */
  description?: string | undefined;
}

export interface DevAuthClient extends AuthClientBase {
  kind: "dev";
  people: readonly DevPerson[];
  signInAs: (personId: string) => void;
}

/** Sign-in with a one-time code sent by email. */
export interface EmailCodeAuthClient extends AuthClientBase {
  kind: "email_code";
  requestCode: (email: string) => Promise<AuthOutcome>;
  verifyCode: (email: string, code: string) => Promise<AuthOutcome>;
}

export type AuthClient = DevAuthClient | EmailCodeAuthClient;

export const AUTH_MESSAGES = {
  network: "Can't reach the sign-in service. Check your connection and try again.",
  rateLimited: "Too many attempts. Wait a minute, then try again.",
  invalidEmail: "Enter a valid email address, like name@clinic.in.",
  invalidCode: "That code is wrong or has expired. Check the email, or send a new code.",
} as const;

/** A small store for auth state that React reads with `useSyncExternalStore`. */
export function createAuthStore(initial: AuthState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): AuthState => state,
    set: (next: AuthState): void => {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
