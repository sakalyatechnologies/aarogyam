import { useCallback, useState } from "react";

/** A true/false choice remembered in this browser; works (unremembered) when storage is blocked. */
export function useStoredFlag(key: string, initial = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = globalThis.localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        globalThis.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Blocked storage: the choice holds for this visit only.
      }
    },
    [key],
  );
  return [value, set];
}
