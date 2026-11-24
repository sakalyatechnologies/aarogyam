import type { QueueToken, WalkIn } from "../index.js";

/** The queue token of a walk-in that was checked in; fails the test when there is none. */
export function tokenOf(walkIn: WalkIn): QueueToken {
  if (walkIn.token === undefined) throw new Error("expected a queue token");
  return walkIn.token;
}
