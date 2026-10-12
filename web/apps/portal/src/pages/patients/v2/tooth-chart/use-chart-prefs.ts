import { useCallback, useState } from "react";

/** Rows and the 3D arch are the quick views; Classic is the odontogram with its five surfaces. */
export type ChartLook = "rows" | "arch" | "classic";
export type ChartDentition = "adult" | "child";
export interface ChartPrefs {
  look: ChartLook;
  dentition: ChartDentition;
}

/** One key per person, like the layout choice, so two staff sharing a browser keep their own. */
export const chartPrefsKey = (userId: string): string => `aarogyam.portal.tooth-chart.${userId}`;

const DEFAULTS: ChartPrefs = { look: "rows", dentition: "adult" };

function read(userId: string): ChartPrefs {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage.getItem(chartPrefsKey(userId)) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const look = "look" in parsed ? parsed.look : undefined;
    const dentition = "dentition" in parsed ? parsed.dentition : undefined;
    return { look: look === "arch" || look === "classic" ? look : "rows", dentition: dentition === "child" ? "child" : "adult" };
  } catch {
    return DEFAULTS;
  }
}

/** The look (Rows, 3D arch or Classic) and dentition (adult 32 or child 20) this person last chose, remembered in this browser. */
export function useChartPrefs(userId: string): [ChartPrefs, (patch: Partial<ChartPrefs>) => void] {
  const [prefs, setPrefs] = useState<ChartPrefs>(() => read(userId));
  const update = useCallback(
    (patch: Partial<ChartPrefs>) => {
      setPrefs((before) => {
        const next = { ...before, ...patch };
        try {
          globalThis.localStorage.setItem(chartPrefsKey(userId), JSON.stringify(next));
        } catch {
          // Blocked storage: the choice holds for this visit only.
        }
        return next;
      });
    },
    [userId],
  );
  return [prefs, update];
}
