import { Fragment, useEffect, useRef } from "react";

import "./calendar.css";

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
 * Working spans for a column (minutes after midnight). If empty, the whole column is shaded.
 * If undefined, use the default `workingMinutes` prop for a single range.
 */
export type ColumnWorkingSpans = { startMin: number; endMin: number }[] | undefined;

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
  workingMinutes,
  workingSpans,
  onSelect,
  summary,
}: {
  columns: readonly GridColumn[];
  events: readonly GridEvent[];
  startHour: number;
  endHour: number;
  /** Minutes after local midnight now, drawn in columns with `showNow`. */
  nowMinute?: number;
  /** The clinic's usual working span (minutes after midnight); time outside it is shaded. Ignored if `workingSpans` is provided. */
  workingMinutes?: { start: number; end: number };
  /** Per-column working spans (minutes after midnight). A column with spans is shaded outside them; no spans means use `workingMinutes`. */
  workingSpans?: readonly ColumnWorkingSpans[] | undefined;
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
    const target = Math.max(0, top);
    if (typeof el.scrollTo === "function") el.scrollTo({ top: target, behavior: "smooth" });
    else el.scrollTop = target;
    // Only on first show; later scrolling belongs to the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderShading(columnIndex: number, columnSpans: ColumnWorkingSpans) {
    // If spans are explicitly defined for this column, use them
    if (columnSpans !== undefined) {
      if (columnSpans.length === 0) {
        // Empty spans means the doctor is off: shade the whole column
        return <div className="mk-tg-off" aria-hidden="true" style={{ top: 0, height: "100%" }} />;
      }
      // Shade before first span, between spans, and after last span
      const shading: React.JSX.Element[] = [];
      let prevEnd = startHour * 60;
      for (const span of columnSpans) {
        const spanStart = Math.max(span.startMin, startHour * 60);
        const spanEnd = Math.min(span.endMin, endHour * 60);
        if (spanStart > prevEnd) {
          shading.push(
            <div
              key={`off-before-${span.startMin.toString()}`}
              className="mk-tg-off"
              aria-hidden="true"
              style={{ top: `${String(offsetPercent(prevEnd, startHour, endHour))}%`, height: `${String(offsetPercent(spanStart, startHour, endHour) - offsetPercent(prevEnd, startHour, endHour))}%` }}
            />,
          );
        }
        prevEnd = Math.max(prevEnd, spanEnd);
      }
      if (prevEnd < endHour * 60) {
        shading.push(
          <div
            key={`off-after-${prevEnd.toString()}`}
            className="mk-tg-off"
            aria-hidden="true"
            style={{ bottom: 0, height: `${String(100 - offsetPercent(prevEnd, startHour, endHour))}%` }}
          />,
        );
      }
      return <Fragment key={`shading-${columnIndex.toString()}`}>{shading}</Fragment>;
    }
    // No spans defined: use the default workingMinutes
    if (workingMinutes === undefined) return null;
    return (
      <>
        <div className="mk-tg-off" aria-hidden="true" style={{ top: 0, height: `${String(offsetPercent(Math.min(Math.max(workingMinutes.start, startHour * 60), endHour * 60), startHour, endHour))}%` }} />
        <div className="mk-tg-off" aria-hidden="true" style={{ bottom: 0, height: `${String(100 - offsetPercent(Math.min(Math.max(workingMinutes.end, startHour * 60), endHour * 60), startHour, endHour))}%` }} />
      </>
    );
  }

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
        {columns.map((c, i) => {
          const packed = packColumns(events.filter((e) => e.columnId === c.id));
          const columnSpans = workingSpans !== undefined ? workingSpans[i] : undefined;
          return (
            <div key={c.id} className={`mk-tg-col ${c.current === true ? "current" : ""}`} style={{ backgroundSize: `100% ${String(HOUR_HEIGHT)}px` }}>
              {renderShading(i, columnSpans)}
              {packed.map(({ item, column, columns: span }) => {
                const top = `${String(offsetPercent(item.startMin, startHour, endHour))}%`;
                const left = `calc(${String((column / span) * 100)}% + 2px)`;
                const roomy = item.endMin - item.startMin >= 40;
                return (
                  <Fragment key={item.id}>
                    <button
                      type="button"
                      className={`mk-tg-ev mk-evchip ${item.tone}`}
                      aria-label={item.label}
                      style={{
                        top,
                        height: `calc(${String(((item.endMin - item.startMin) / ((endHour - startHour) * 60)) * 100)}% - 2px)`,
                        left,
                        width: `calc(${String(100 / span)}% - 4px)`,
                      }}
                      onClick={() => {
                        onSelect(item.id);
                      }}
                    >
                      <b>{item.title}</b>
                      {roomy && item.subtitle !== undefined ? <span>{item.subtitle}</span> : null}
                    </button>
                    <div className={`mk-tip ${item.tone}`} role="tooltip" aria-hidden="true" style={{ top, left }}>
                      <b>{item.title}</b>
                      {item.subtitle === undefined ? null : <span>{item.subtitle}</span>}
                    </div>
                  </Fragment>
                );
              })}
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
