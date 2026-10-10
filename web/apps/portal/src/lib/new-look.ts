import { useCallback, useSyncExternalStore } from "react";

/** The per-user "New look" switch for the redesigned portal screens, remembered in this browser. */
export const NEW_LOOK_KEY = "aarogyam.portal.new-look";

const CHANGED = "aarogyam:new-look";

/** The choice for this visit when storage is blocked. */
let memory = false;

function read(): boolean {
  try {
    return globalThis.localStorage.getItem(NEW_LOOK_KEY) === "1";
  } catch {
    return memory;
  }
}

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener(CHANGED, onChange);
  globalThis.addEventListener("storage", onChange);
  return () => {
    globalThis.removeEventListener(CHANGED, onChange);
    globalThis.removeEventListener("storage", onChange);
  };
}

/**
 * Whether the new look is on. Shared by every component that reads it, so flipping it in the account menu
 * changes the screen underneath at once (a plain stored flag would only update the component that set it).
 * Interim: the shell work will replace this with a real preference.
 */
export function useNewLook(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    memory = next;
    try {
      globalThis.localStorage.setItem(NEW_LOOK_KEY, next ? "1" : "0");
    } catch {
      // Blocked storage: the switch holds for this visit only.
    }
    globalThis.dispatchEvent(new Event(CHANGED));
  }, []);
  return [on, set];
}
