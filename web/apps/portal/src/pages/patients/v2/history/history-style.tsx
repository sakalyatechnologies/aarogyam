/**
 * Which history style opens: the member's saved choice (`history_view`), unless they switched for this session only.
 * While the choice loads, or if it fails to load, the full page opens.
 */
import { useSyncExternalStore } from "react";

import { useUiPrefs } from "../../../../queries.js";
import { Pills } from "../kit.js";

export type HistoryStyle = "page" | "popup" | "story";

export const HISTORY_STYLES: readonly { value: HistoryStyle; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "popup", label: "Pop-up" },
  { value: "story", label: "Story" },
];

export const isHistoryStyle = (value: unknown): value is HistoryStyle => value === "page" || value === "popup" || value === "story";

let session: HistoryStyle | undefined;
const listeners = new Set<() => void>();

/** Switches for this session only (nothing is saved); `undefined` goes back to the saved choice. */
export function setSessionHistoryStyle(next: HistoryStyle | undefined) {
  session = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHistoryStyle(): HistoryStyle {
  const saved = useUiPrefs().data?.history_view;
  const picked = useSyncExternalStore(subscribe, () => session);
  return picked ?? (isHistoryStyle(saved) ? saved : "page");
}

/** The small Page, Pop-up, Story switch in each style's header. */
export function HistoryStyleSwitch({ value, onChange }: { value: HistoryStyle; onChange: (next: HistoryStyle) => void }) {
  return <Pills<HistoryStyle> label="History style" options={HISTORY_STYLES} value={value} onChange={onChange} size="sm" />;
}

/** Where a style lives: the full page, or the patient's page with the pop-up or story open. Ids only. */
export function historyTarget(patientPath: string, style: HistoryStyle, visitId: string | undefined): string {
  const visit = visitId === undefined ? "" : `visit=${encodeURIComponent(visitId)}`;
  if (style === "page") return `${patientPath}/history${visit === "" ? "" : `?${visit}`}`;
  return `${patientPath}?history=1${visit === "" ? "" : `&${visit}`}`;
}
