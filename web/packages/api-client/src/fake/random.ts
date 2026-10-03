/** A small seeded random source, so fixtures are the same on every run and in every test. */

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** One item of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** Lowercase hex digits. */
  hex(length: number): string;
}

/** Mulberry32: fast, tiny and good enough for synthetic data. Not for anything secret. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) {
        throw new Error("pick needs a non-empty list");
      }
      return item;
    },
    hex: (length) => Array.from({ length }, () => int(0, 15).toString(16)).join(""),
  };
}

/** A UUIDv7-shaped identifier whose time part is `at`, as the API's IDs are. */
export function fakeUuid(random: Random, at: Date): string {
  const time = at.getTime().toString(16).padStart(12, "0").slice(-12);
  const variant = (8 + random.int(0, 3)).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.hex(3)}-${variant}${random.hex(3)}-${random.hex(12)}`;
}
