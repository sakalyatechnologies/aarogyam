/** Development sign-in: pick a seeded person. No network, no password, never in production. */

import { createAuthStore, type AuthState, type DevAuthClient, type DevPerson } from "./auth-client.js";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DevAuthOptions {
  people: readonly DevPerson[];
  /** The bearer token the (fake) API accepts for a person. */
  tokenFor: (personId: string) => string;
  /** Where the choice survives a reload. Defaults to `sessionStorage`, so it ends with the tab. */
  storage?: KeyValueStorage | null;
  storageKey?: string;
}

function sessionStorageOrNull(): KeyValueStorage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function signedIn(person: DevPerson): AuthState {
  return { status: "signed_in", user: { id: person.id, email: person.email, displayName: person.displayName } };
}

export function createDevAuth(options: DevAuthOptions): DevAuthClient {
  const storage = options.storage === undefined ? sessionStorageOrNull() : options.storage;
  const key = options.storageKey ?? "aarogyam.dev-auth";
  const find = (id: string | null) => options.people.find((person) => person.id === id);

  let saved: DevPerson | undefined;
  try {
    saved = find(storage?.getItem(key) ?? null);
  } catch {
    saved = undefined;
  }
  const store = createAuthStore(saved === undefined ? { status: "signed_out" } : signedIn(saved));

  return {
    kind: "dev",
    people: options.people,
    getState: store.get,
    subscribe: store.subscribe,
    getAccessToken: () => {
      const state = store.get();
      return Promise.resolve(state.status === "signed_in" ? options.tokenFor(state.user.id) : null);
    },
    signInAs: (personId) => {
      const person = find(personId);
      if (person === undefined) {
        return;
      }
      try {
        storage?.setItem(key, person.id);
      } catch {
        // Storage can be unavailable (private mode); signing in still works for this page.
      }
      store.set(signedIn(person));
    },
    signOut: () => {
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing stored.
      }
      store.set({ status: "signed_out" });
      return Promise.resolve();
    },
  };
}
