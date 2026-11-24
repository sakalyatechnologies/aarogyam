import { useCallback, useState } from "react";

import type { ChartDentition, ChartLook, ChartView } from "@aarogyam/app-kit/chart/types";

export type { ChartDentition, ChartLook, ChartView };
export interface ChartPrefs {
  look: ChartLook;
  dentition: ChartDentition;
  view: ChartView;
}

/** One key per person, like the layout choice, so two staff sharing a browser keep their own. */
export const chartPrefsKey = (userId: string): string => `aarogyam.portal.tooth-chart.${userId}`;

const DEFAULTS: ChartPrefs = { look: "rows", dentition: "adult", view: "treatment" };

function read(userId: string): ChartPrefs {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage.getItem(chartPrefsKey(userId)) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const look = "look" in parsed ? parsed.look : undefined;
    const dentition = "dentition" in parsed ? parsed.dentition : undefined;
    const view = "view" in parsed ? parsed.view : undefined;
    return { look: look === "arch" || look === "classic" ? look : "rows", dentition: dentition === "child" ? "child" : "adult", view: view === "health" ? "health" : "treatment" };
  } catch {
    return DEFAULTS;
  }
}

/** The look (Rows, 3D arch or Classic), dentition (adult 32 or child 20) and view (Treatment or Health) this person last chose, remembered in this browser. */
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
