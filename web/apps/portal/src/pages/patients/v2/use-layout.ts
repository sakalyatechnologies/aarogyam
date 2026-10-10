import { useCallback, useState } from "react";

/** The three ways to lay out the patient overview. */
export type P360Layout = "console" | "stage" | "tabs";

export const P360_LAYOUTS: readonly { value: P360Layout; label: string }[] = [
  { value: "console", label: "Console" },
  { value: "stage", label: "Stage + drawers" },
  { value: "tabs", label: "Tabs + ribbon" },
];

/** One key per person, so two staff sharing a browser each keep their own layout. */
export function layoutKey(userId: string): string {
  return `aarogyam.portal.p360-layout.${userId}`;
}

function isLayout(value: string | null): value is P360Layout {
  return P360_LAYOUTS.some((layout) => layout.value === value);
}

/** The layout this person last chose, remembered in this browser (Console until they choose). Works unremembered when storage is blocked. */
export function useP360Layout(userId: string): [P360Layout, (next: P360Layout) => void] {
  const [layout, setLayout] = useState<P360Layout>(() => {
    try {
      const stored = globalThis.localStorage.getItem(layoutKey(userId));
      return isLayout(stored) ? stored : "console";
    } catch {
      return "console";
    }
  });
  const choose = useCallback(
    (next: P360Layout) => {
      setLayout(next);
      try {
        globalThis.localStorage.setItem(layoutKey(userId), next);
      } catch {
        // Blocked storage: the choice holds for this visit only.
      }
    },
    [userId],
  );
  return [layout, choose];
}
