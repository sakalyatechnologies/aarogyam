import type { ReactNode } from "react";

import type { Tone } from "@sakalya/ui";

const ACCENT: Readonly<Record<Tone, string>> = {
  neutral: "before:bg-border",
  success: "before:bg-success",
  warning: "before:bg-warning",
  danger: "before:bg-danger",
  info: "before:bg-info",
  primary: "before:bg-primary",
};

/** The console's summary tile in the portal mock-up's style: label, big number, a note, an accent edge. */
export function Tile({ label, value, note, tone = "neutral" }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-surface px-5 py-4 shadow-card before:absolute before:inset-y-0 before:left-0 before:w-1 ${ACCENT[tone]}`}
    >
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-text">{value}</p>
      {note === undefined ? null : <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}
