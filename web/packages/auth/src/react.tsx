import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { AuthClient, AuthState } from "./auth-client.js";

const AuthContext = createContext<AuthClient | null>(null);

export interface AuthProviderProps {
  client: AuthClient;
  children: ReactNode;
}

/** Makes the app's `AuthClient` available to every component below. */
export function AuthProvider({ client, children }: AuthProviderProps) {
  return <AuthContext value={client}>{children}</AuthContext>;
}

/** The app's `AuthClient`. */
export function useAuth(): AuthClient {
  const client = useContext(AuthContext);
  if (client === null) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return client;
}

/** The current sign-in state; re-renders when it changes. */
export function useAuthState(): AuthState {
  const client = useAuth();
  return useSyncExternalStore(client.subscribe, client.getState, client.getState);
}

/**
 * Finishes a sign-in that arrived by clicking the email's link, for the `/auth/callback` route:
 * calls `completeRedirect` once with the current URL, then `onSuccess`. Dev sign-in has no link
 * to complete, so it calls `onSuccess` immediately. Returns a message to show instead, if the
 * link was invalid or expired.
 */
export function useCompleteAuthRedirect(onSuccess: () => void): { problem: string | undefined } {
  const auth = useAuth();
  const [problem, setProblem] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    if (auth.kind !== "email_code") {
      onSuccess();
      return;
    }
    void auth.completeRedirect(window.location.href).then((outcome) => {
      if (outcome.ok) {
        onSuccess();
      } else {
        setProblem(outcome.message);
      }
    });
    // Runs once per mount, guarded by `started`; `auth` and `onSuccess` don't change across it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { problem };
}
