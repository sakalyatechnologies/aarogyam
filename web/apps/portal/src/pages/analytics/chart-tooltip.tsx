import type { CSSProperties, ReactNode } from "react";

/** What recharts hands a custom tooltip; only the parts used here. */
interface TooltipEntry {
  name?: string | number | undefined;
  value?: unknown;
  color?: string | undefined;
  dataKey?: unknown;
  payload?: unknown;
}

export interface ChartTooltipProps {
  active?: boolean | undefined;
  label?: ReactNode;
  payload?: readonly TooltipEntry[] | undefined;
  /** Formats a value for display, such as rupees or a percent. */
  format: (value: number) => string;
  /** Adds a total line under the entries (stacked charts). */
  total?: boolean | undefined;
}

/**
 * The one tooltip every Analytics chart uses: the period, then each series with its swatch. Colours
 * are the theme's surface and ink, so it follows the clinic's light or dark theme.
 */
export function ChartTooltip({ active, label, payload, format, total }: ChartTooltipProps) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const rows = payload.filter((entry) => typeof entry.value === "number");
  const sum = rows.reduce((s, entry) => s + Number(entry.value), 0);
  const first: unknown = payload[0]?.payload;
  const heading = typeof first === "object" && first !== null && "tip" in first && typeof first.tip === "string" ? first.tip : label;
  return (
    <div className="an-tip" role="presentation">
      {heading === undefined || heading === "" ? null : <div className="an-tip-h">{heading}</div>}
      <ul>
        {rows.map((entry, index) => (
          <li key={`${String(entry.name ?? "")}-${String(index)}`}>
            <span className="an-sw" style={swatch(entry.color)} aria-hidden="true" />
            {entry.name}
            <b>{format(Number(entry.value))}</b>
          </li>
        ))}
        {total === true && rows.length > 1 ? (
          <li>
            Total
            <b>{format(sum)}</b>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** A legend of swatches and ink-coloured names; identity never rests on colour alone. */
export function Legend({ items }: { items: readonly { key: string; label: string; color: string }[] }) {
  return (
    <ul className="an-legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className="an-sw" style={swatch(item.color)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A CSS custom property for a swatch's colour. */
export const swatch = (color: string | undefined): CSSProperties => Object.fromEntries([["--sw", color ?? "transparent"]]);

/** The series colour token for position `n` (1-based, fixed order). */
export const series = (n: number) => `var(--chart-${String(Math.min(8, Math.max(1, n)))})`;
