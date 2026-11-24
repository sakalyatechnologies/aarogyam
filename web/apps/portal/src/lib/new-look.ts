import { useSyncExternalStore } from "react";

/** The old per-browser "New look" switch key. The switch is gone (founder, Nov 2026); the key is only cleared. */
export const NEW_LOOK_KEY = "aarogyam.portal.new-look";

/**
 * Unit tests keep the classic screens as their default and opt in (or out) through this key where they test
 * a screen. Everywhere else the new look is always on and the stored key is ignored.
 */
const TEST_MODE = import.meta.env.MODE === "test";

if (!TEST_MODE) {
  try {
    globalThis.localStorage.removeItem(NEW_LOOK_KEY);
  } catch {
    // Blocked storage: nothing to clear.
  }
}

function read(): boolean {
  if (!TEST_MODE) return true;
  try {
    return globalThis.localStorage.getItem(NEW_LOOK_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener("storage", onChange);
  return () => {
    globalThis.removeEventListener("storage", onChange);
  };
}

/** Whether the new look is on: always, outside unit tests. */
export function useNewLook(): [boolean] {
  const on = useSyncExternalStore(subscribe, read, () => !TEST_MODE);
  return [on];
}
