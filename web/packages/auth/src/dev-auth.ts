/** Development sign-in: pick a seeded person. No network, no password, never in production. */

import { createAuthStore, type AuthState, type DevAuthClient, type DevPerson } from "./auth-client.js";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DevAuthOptions {
  people: readonly DevPerson[];
  /** The bearer token for a person: a fake token, or one fetched from the API's dev endpoint. */
  tokenFor: (person: DevPerson) => string | null | Promise<string | null>;
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

/** What is stored: a seeded person's ID, or a new person as JSON. */
function decode(stored: string | null, people: readonly DevPerson[]): DevPerson | undefined {
  if (stored === null) {
    return undefined;
  }
  if (!stored.startsWith("{")) {
    return people.find((person) => person.id === stored);
  }
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value === "object" && value !== null && "id" in value && "displayName" in value && "email" in value) {
      const { id, displayName, email } = value;
      if (typeof id === "string" && typeof displayName === "string" && typeof email === "string") {
        return { id, displayName, email };
      }
    }
  } catch {
    // Unreadable: signed out.
  }
  return undefined;
}

/**
 * A cookie on the parent domain, so a development sign-in carries across clinic hosts such as
 * `sunrise.localtest.me` and `lotus.localtest.me`. It holds a person's ID, never a token.
 */
export function createParentDomainStorage(domain: string): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const read = (key: string) => {
    const prefix = `${encodeURIComponent(key)}=`;
    const found = document.cookie.split("; ").find((part) => part.startsWith(prefix));
    return found === undefined ? null : decodeURIComponent(found.slice(prefix.length));
  };
  const write = (key: string, value: string, maxAge: number) => {
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; domain=${domain}; path=/; max-age=${String(maxAge)}; SameSite=Lax`;
  };
  return {
    getItem: read,
    setItem: (key, value) => {
      write(key, value, 12 * 3600);
    },
    removeItem: (key) => {
      write(key, "", 0);
    },
  };
}

export function createDevAuth(options: DevAuthOptions): DevAuthClient {
  const storage = options.storage === undefined ? sessionStorageOrNull() : options.storage;
  const key = options.storageKey ?? "aarogyam.dev-auth";
  const find = (id: string | null) => options.people.find((person) => person.id === id);

  let saved: DevPerson | undefined;
  try {
    saved = decode(storage?.getItem(key) ?? null, options.people);
  } catch {
    saved = undefined;
  }
  let current = saved;

  const remember = (person: DevPerson, stored: string) => {
    try {
      storage?.setItem(key, stored);
    } catch {
      // Storage can be unavailable (private mode); signing in still works for this page.
    }
    current = person;
    store.set(signedIn(person));
  };
  const store = createAuthStore(saved === undefined ? { status: "signed_out" } : signedIn(saved));

  return {
    kind: "dev",
    people: options.people,
    getState: store.get,
    subscribe: store.subscribe,
    getAccessToken: async () => (store.get().status === "signed_in" && current !== undefined ? options.tokenFor(current) : null),
    signInAs: (personId) => {
      const person = find(personId);
      if (person !== undefined) {
        remember(person, person.id);
      }
    },
    signInAsNew: ({ displayName, email }) => {
      const person = { id: crypto.randomUUID(), displayName, email };
      remember(person, JSON.stringify(person));
    },
    signOut: () => {
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing stored.
      }
      current = undefined;
      store.set({ status: "signed_out" });
      return Promise.resolve();
    },
  };
}
