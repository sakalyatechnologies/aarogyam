import { useEffect, useRef } from "react";

import { clockLabel, offsetPercent, packColumns } from "../../lib/time-grid.js";

export interface GridColumn {
  id: string;
  label: string;
  dateLabel?: string;
  /** Highlights the header (today's column in the week). */
  current?: boolean;
  /** Draws the now-line in this column. */
  showNow?: boolean;
}

export interface GridEvent {
  id: string;
  columnId: string;
  startMin: number;
  endMin: number;
  title: string;
  subtitle?: string;
  /** Colour class from the status legend (`g`, `a`, `b`, `i`, `n`, `r`, or `q` for dashed requests). */
  tone: string;
  /** Accessible name; also the hover text. */
  label: string;
}

/** Pixels per hour; half-hour lines sit at half of it. */
export const HOUR_HEIGHT = 56;

/**
 * The calendar's time grid: hour rows over the given hours, events absolutely placed by start and sized by
 * duration, overlaps side by side. Scrolls inside its card, with the column headers kept in view.
 */
export function TimeGrid({
  columns,
  events,
  startHour,
  endHour,
  nowMinute,
  onSelect,
  summary,
}: {
  columns: readonly GridColumn[];
  events: readonly GridEvent[];
  startHour: number;
  endHour: number;
  /** Minutes after local midnight now, drawn in columns with `showNow`. */
  nowMinute?: number;
  onSelect: (id: string) => void;
  summary: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const height = (endHour - startHour) * HOUR_HEIGHT;
  const template = `56px repeat(${String(columns.length)}, minmax(104px, 1fr))`;
  const showsNow = nowMinute !== undefined && columns.some((c) => c.showNow === true);
  const firstStart = events.reduce((min, e) => Math.min(min, e.startMin), Number.POSITIVE_INFINITY);

  // Open on the current time (or the first visit), so the working day is in view rather than the grid's top edge.
  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const focus = showsNow ? nowMinute : Number.isFinite(firstStart) ? firstStart : startHour * 60;
    const top = ((focus - startHour * 60) / 60) * HOUR_HEIGHT - el.clientHeight / 3;
    el.scrollTop = Math.max(0, top);
    // Only on first show; later scrolling belongs to the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={scroller} className="mk-tg" role="group" aria-label={summary} tabIndex={-1}>
      <div className="mk-tg-head" style={{ gridTemplateColumns: template }}>
        <div />
        {columns.map((c) => (
          <div key={c.id} className={`mk-dh ${c.current === true ? "today" : ""}`}>
            {c.label}
            {c.dateLabel === undefined || c.dateLabel === "" ? null : <b>{c.dateLabel}</b>}
          </div>
        ))}
      </div>
      <div className="mk-tg-body" style={{ gridTemplateColumns: template, height }}>
        <div className="mk-tg-hours" aria-hidden="true">
          {hours.map((h) => (
            <span key={h} style={{ top: (h - startHour) * HOUR_HEIGHT }}>
              {clockLabel(h * 60)}
            </span>
          ))}
        </div>
        {columns.map((c) => {
          const packed = packColumns(events.filter((e) => e.columnId === c.id));
          return (
            <div key={c.id} className="mk-tg-col" style={{ backgroundSize: `100% ${String(HOUR_HEIGHT)}px` }}>
              {packed.map(({ item, column, columns: span }) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mk-tg-ev mk-evchip ${item.tone}`}
                  title={item.label}
                  aria-label={item.label}
                  style={{
                    top: `${String(offsetPercent(item.startMin, startHour, endHour))}%`,
                    height: `calc(${String(((item.endMin - item.startMin) / ((endHour - startHour) * 60)) * 100)}% - 2px)`,
                    left: `calc(${String((column / span) * 100)}% + 2px)`,
                    width: `calc(${String(100 / span)}% - 4px)`,
                  }}
                  onClick={() => {
                    onSelect(item.id);
                  }}
                >
                  <b>{item.title}</b>
                  {item.subtitle === undefined ? null : <span>{item.subtitle}</span>}
                </button>
              ))}
              {c.showNow === true && nowMinute !== undefined && nowMinute >= startHour * 60 && nowMinute <= endHour * 60 ? (
                <div className="mk-tg-now" role="presentation" style={{ top: `${String(offsetPercent(nowMinute, startHour, endHour))}%` }} data-testid="now-line" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
