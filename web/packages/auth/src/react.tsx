import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

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
