// The fake's live-event bus: one per fixtures object, so every client on the same fake backend (another tab, another
// signed-in person) hears what the others write, as the real stream would tell them.
import type { LiveEvent } from "../sse.js";
import type { Fixtures } from "./fixtures.js";

type Listener = (event: LiveEvent) => void;
interface Bus {
  listeners: Set<Listener>;
  seq: number;
}

const buses = new WeakMap<Fixtures, Bus>();
const busOf = (state: Fixtures): Bus => {
  let bus = buses.get(state);
  if (bus === undefined) buses.set(state, (bus = { listeners: new Set(), seq: 0 }));
  return bus;
};

/** Tells every open stream on this fake backend; IDs only, like the API. */
export function publishFakeEvent(state: Fixtures, type: string, data: { kind: string; id: string; branch_id?: string | null }): void {
  const bus = busOf(state);
  const event: LiveEvent = { type, id: String(++bus.seq), data: { branch_id: null, ...data } };
  for (const listener of [...bus.listeners]) listener(event);
}

/** Listens until `signal` aborts; returns when it does. */
export function listenFakeEvents(state: Fixtures, signal: AbortSignal, onEvent: Listener): Promise<void> {
  const bus = busOf(state);
  return new Promise((resolve) => {
    const done = () => {
      bus.listeners.delete(onEvent);
      resolve();
    };
    if (signal.aborted) {
      done();
      return;
    }
    bus.listeners.add(onEvent);
    signal.addEventListener("abort", done, { once: true });
    onEvent({ type: "ready", data: {} });
  });
}
