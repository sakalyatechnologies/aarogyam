import { describe, expect, it } from "vitest";

import { createDevAuth } from "./index.js";

const people = [
  { id: "p1", displayName: "Aarav Kulkarni", email: "aarav@sakalya.example" },
  { id: "p2", displayName: "Isha Nair" },
];

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("createDevAuth", () => {
  it("signs in as a seeded person and hands out that person's token", async () => {
    const auth = createDevAuth({ people, tokenFor: (id) => `fake:${id}`, storage: memoryStorage() });
    expect(auth.getState()).toEqual({ status: "signed_out" });
    expect(await auth.getAccessToken()).toBeNull();

    let changes = 0;
    auth.subscribe(() => {
      changes += 1;
    });
    auth.signInAs("p1");

    expect(changes).toBe(1);
    expect(auth.getState()).toEqual({
      status: "signed_in",
      user: { id: "p1", email: "aarav@sakalya.example", displayName: "Aarav Kulkarni" },
    });
    expect(await auth.getAccessToken()).toBe("fake:p1");
  });

  it("remembers the choice across a reload, and forgets it on sign-out", async () => {
    const storage = memoryStorage();
    createDevAuth({ people, tokenFor: (id) => id, storage }).signInAs("p2");

    const reloaded = createDevAuth({ people, tokenFor: (id) => id, storage });
    expect(reloaded.getState().status).toBe("signed_in");

    await reloaded.signOut();
    expect(createDevAuth({ people, tokenFor: (id) => id, storage }).getState()).toEqual({ status: "signed_out" });
  });

  it("ignores people who are not in the list", () => {
    const auth = createDevAuth({ people, tokenFor: (id) => id, storage: null });
    auth.signInAs("intruder");
    expect(auth.getState()).toEqual({ status: "signed_out" });
  });
});
