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
    const view = "view" in parsed ? parsed.view : undefined;
    return { look: look === "arch" || look === "classic" ? look : "rows", dentition: "adult", view: view === "health" ? "health" : "treatment" };
  } catch {
    return DEFAULTS;
  }
}

/**
 * The look (Rows, 3D arch or Classic) and view (Treatment or Health) this person last chose, remembered in this browser. The
 * dentition is not remembered: it belongs to the patient (see the chart block), so one child never hides the next adult's 32 teeth.
 */
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

export const moreDetailsKey = (userId: string): string => `aarogyam.portal.tooth-more.${userId}`;

/** Whether the tooth panel's "More details" is open: collapsed until this person opens it, then remembered in this browser. */
export function useMoreDetails(userId: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return globalThis.localStorage.getItem(moreDetailsKey(userId)) === "1";
    } catch {
      return false;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        globalThis.localStorage.setItem(moreDetailsKey(userId), next ? "1" : "0");
      } catch {
        // Blocked storage: the choice holds for this visit only.
      }
    },
    [userId],
  );
  return [open, update];
}
