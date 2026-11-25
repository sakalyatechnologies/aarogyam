import { useSyncExternalStore } from "react";

const KEY = "aarogyam.guides.watched";
const EVENT = "aarogyam:guides-watched";

/** The guides this browser has played to the end. Storage can be blocked, so every access is guarded. */
export function readWatched(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let memory: string[] = [];

export function markWatched(id: string): void {
  const next = [...new Set([...readWatched(), ...memory, id])];
  memory = next;
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: the tick holds for this visit only.
  }
  globalThis.dispatchEvent(new Event(EVENT));
}

let cache = "";
function snapshot(): string {
  const joined = [...new Set([...readWatched(), ...memory])].sort().join(",");
  cache = joined === cache ? cache : joined;
  return cache;
}

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener(EVENT, onChange);
  globalThis.addEventListener("storage", onChange);
  return () => {
    globalThis.removeEventListener(EVENT, onChange);
    globalThis.removeEventListener("storage", onChange);
  };
}

/** The ids of the watched guides, updating when one finishes. */
export function useWatched(): ReadonlySet<string> {
  const joined = useSyncExternalStore(subscribe, snapshot, () => "");
  return new Set(joined === "" ? [] : joined.split(","));
}
