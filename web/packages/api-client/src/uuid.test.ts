import { afterEach, describe, expect, it, vi } from "vitest";

import { randomUuid } from "./uuid.js";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const real = globalThis.crypto;

describe("randomUuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes a v4 UUID where crypto.randomUUID is missing (plain http)", () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(V4);
    }
  });

  it("uses the native one when present", () => {
    expect(randomUuid()).toMatch(V4);
  });
});
