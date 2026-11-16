import { Armchair, CalendarCheck, CalendarClock, Check, CircleHelp, Hourglass, TriangleAlert, UserX } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import "./calendar.css";
import { VisitKindTag, type VisitKind } from "./visit-kind-tag.js";

import { clockLabel, offsetPercent, packColumns } from "../../lib/time-grid.js";
import type { Span } from "../../lib/slots.js";

export interface GridColumn {
  id: string;
  label: string;
  dateLabel?: string;
  /** Highlights the header (today's column in the week). */
  current?: boolean;
  /** Draws the now-line in this column. */
  showNow?: boolean;
  /** Working spans for this column (minutes after midnight). Empty means off that day; undefined falls back to workingMinutes. */
  working?: readonly Span[];
  /** Approved time off that day, drawn as a band behind the appointments: the label ("Away · name") is all anyone sees. */
  away?: readonly AwayBandShape[];
}

export interface AwayBandShape {
  id: string;
  label: string;
  startMin: number;
  endMin: number;
}

export interface GridEvent {
  id: string;
  columnId: string;
  startMin: number;
  endMin: number;
  title: string;
  subtitle?: string;
  /** New patient or follow-up; shown as a tag in the hover card. */
  visitKind?: VisitKind;
  /** Colour class from the status legend (`g`, `a`, `b`, `i`, `n`, `r`, or `q` for dashed requests). */
  tone: string;
  /** Accessible name; also the hover text. */
  label: string;
  /** Status icon in the chip's corner, so status never rests on colour alone. */
  status?: EventStatus;
  /** Which doctor colour (0 to `DOCTOR_TONES - 1`) the chip's left bar takes. */
  doctorTone?: number;
  /** Room for a small tag (say "New patient" or "Follow-up") next to the name; shown when the chip is wide enough. */
  tag?: ReactNode;
}

/** What the status icon on a chip says. */
export type EventStatus = "requested" | "booked" | "confirmed" | "arrived" | "in_chair" | "completed" | "no_show" | "emergency";

const STATUS_ICON: Readonly<Record<EventStatus, typeof Check>> = {
  requested: CircleHelp,
  booked: CalendarClock,
  confirmed: CalendarCheck,
  arrived: Hourglass,
  in_chair: Armchair,
  completed: Check,
  no_show: UserX,
  emergency: TriangleAlert,
};

/** Whether the element is focused the way a keyboard does it (not by a mouse press); true where the browser cannot tell. */
function keyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** How many doctor colours (`.d0` to `.d5` in calendar.css) the calendar cycles through. */
export const DOCTOR_TONES = 6;

/** The empty slot someone chose to book: the column and the start minute (half-hour steps). */
export interface BookSlot {
  columnId: string;
  startMin: number;
}

const SLOT_MINUTES = 30;

/** Pixels per hour; half-hour lines sit at half of it. */
export const HOUR_HEIGHT = 72;


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
  onSelect,
  onBook,
  summary,
}: {
  columns: readonly GridColumn[];
  events: readonly GridEvent[];
  startHour: number;
  endHour: number;
  /** Minutes after local midnight now, drawn in columns with `showNow`. */
  nowMinute?: number;
  /** The clinic's usual working span (minutes after midnight); time outside it is shaded. Ignored when a column has `working` spans. */
  workingMinutes?: { start: number; end: number };
  onSelect: (id: string) => void;
  /** Choosing an empty slot (click, or arrow keys then Enter) asks to book it; without it the slots are not interactive. */
  onBook?: (slot: BookSlot) => void;
  summary: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const height = (endHour - startHour) * HOUR_HEIGHT;
  const template = `56px repeat(${String(columns.length)}, minmax(104px, 1fr))`;
  const showsNow = nowMinute !== undefined && columns.some((c) => c.showNow === true);
  const firstStart = events.reduce((min, e) => Math.min(min, e.startMin), Number.POSITIVE_INFINITY);

  // Open on the current time, else the first visit, else the clinic's opening hour, so the working day is in view.
  // The visits often arrive after the grid shows, so place it again once, when they do.
  const hasEvents = Number.isFinite(firstStart);
  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const opening = workingMinutes?.start ?? startHour * 60;
    const focus = showsNow ? nowMinute : hasEvents ? Math.min(firstStart, opening + 120) : opening;
    const offset = ((focus - startHour * 60) / 60) * HOUR_HEIGHT;
    // The now line sits a third of the way down; a first visit sits half an hour below the column headers, never cut off.
    const top = showsNow ? offset - Math.max(el.clientHeight / 3, HOUR_HEIGHT / 2) : offset - HOUR_HEIGHT / 2;
    const target = Math.max(0, top);
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: target, behavior: calm ? "auto" : "smooth" });
    else el.scrollTop = target;
    // Only on first show and when the visits first arrive; later scrolling belongs to the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEvents]);

  // The empty slot under the pointer or the keyboard cursor, drawn as a "+ Book 10:30 am" ghost.
  const [slot, setSlot] = useState<(BookSlot & { by: "pointer" | "key" }) | undefined>(undefined);
  const ghost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (slot?.by === "key" && typeof ghost.current?.scrollIntoView === "function") ghost.current.scrollIntoView({ block: "nearest" });
  }, [slot]);
  const slotAt = (clientY: number, el: HTMLElement): number => {
    const index = Math.floor(((clientY - el.getBoundingClientRect().top) / HOUR_HEIGHT) * (60 / SLOT_MINUTES));
    return Math.min(endHour * 60 - SLOT_MINUTES, Math.max(startHour * 60, startHour * 60 + index * SLOT_MINUTES));
  };
  const hoverSlot = (columnId: string, event: MouseEvent<HTMLElement>) => {
    if (onBook === undefined) return;
    if (event.target !== event.currentTarget) {
      setSlot((prev) => (prev?.by === "pointer" ? undefined : prev));
      return;
    }
    const startMin = slotAt(event.clientY, event.currentTarget);
    setSlot((prev) => (prev?.columnId === columnId && prev.startMin === startMin && prev.by === "pointer" ? prev : { columnId, startMin, by: "pointer" }));
  };
  const first = startHour * 60;
  const last = endHour * 60 - SLOT_MINUTES;
  /** Where the keyboard cursor starts in a column: now when it is on show, else the clinic's opening time. */
  const initialSlot = () => Math.min(last, Math.max(first, Math.floor((showsNow ? nowMinute : (workingMinutes?.start ?? first)) / SLOT_MINUTES) * SLOT_MINUTES));
  const keySlot = (columnId: string, event: KeyboardEvent<HTMLElement>) => {
    if (onBook === undefined || event.target !== event.currentTarget) return;
    const current = slot?.columnId === columnId ? slot.startMin : initialSlot();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? SLOT_MINUTES : -SLOT_MINUTES;
      setSlot({ columnId, startMin: Math.min(last, Math.max(first, current + step)), by: "key" });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onBook({ columnId, startMin: current });
    }
  };
  const nowInView = showsNow && nowMinute >= startHour * 60 && nowMinute <= endHour * 60;

  function renderShading(column: GridColumn) {
    if (column.working !== undefined) {
      if (column.working.length === 0) {
        // Empty spans means the doctor is off: shade the whole column
        return <div className="mk-tg-off" aria-hidden="true" style={{ top: 0, height: "100%" }} />;
      }
      // Shade before first span, between spans, and after last span
      const shading: React.JSX.Element[] = [];
      let prevEnd = startHour * 60;
      for (const span of column.working) {
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
      return <Fragment key={`shading-${column.id}`}>{shading}</Fragment>;
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
        {columns.map((c) => {
          const count = events.filter((e) => e.columnId === c.id).length;
          return (
            <div key={c.id} className={`mk-dh ${c.current === true ? "today" : ""}`}>
              {c.label}
              {c.dateLabel === undefined || c.dateLabel === "" ? null : <b>{c.dateLabel}</b>}
              <small className={count === 0 ? "none" : ""}>{count === 0 ? "No visits" : `${String(count)} ${count === 1 ? "visit" : "visits"}`}</small>
            </div>
          );
        })}
      </div>
      <div className="mk-tg-body" style={{ gridTemplateColumns: template, height }}>
        <div className="mk-tg-hours" aria-hidden="true">
          {hours.map((h) => (
            <span key={h} style={{ top: (h - startHour) * HOUR_HEIGHT }}>
              {clockLabel(h * 60)}
            </span>
          ))}
          {nowInView ? (
            <em className="mk-tg-nowtag" style={{ top: `${String(offsetPercent(nowMinute, startHour, endHour))}%` }}>
              {clockLabel(nowMinute)}
            </em>
          ) : null}
        </div>
        {columns.map((c) => {
          const packed = packColumns(events.filter((e) => e.columnId === c.id));
          return (
            <div
              key={c.id}
              className={`mk-tg-col ${c.current === true ? "current" : ""} ${onBook === undefined ? "" : "bookable"}`}
              style={{ backgroundSize: `100% ${String(HOUR_HEIGHT)}px` }}
              {...(onBook === undefined
                ? {}
                : {
                    role: "group",
                    tabIndex: 0,
                    "aria-label": `${c.label}${c.dateLabel === undefined || c.dateLabel === "" ? "" : ` ${c.dateLabel}`}: free time. Arrow keys choose a time, Enter books it.`,
                    onMouseMove: (event: MouseEvent<HTMLElement>) => {
                      hoverSlot(c.id, event);
                    },
                    onMouseLeave: () => {
                      setSlot((prev) => (prev?.by === "pointer" ? undefined : prev));
                    },
                    onClick: (event: MouseEvent<HTMLElement>) => {
                      if (event.target === event.currentTarget) onBook({ columnId: c.id, startMin: slotAt(event.clientY, event.currentTarget) });
                    },
                    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                      keySlot(c.id, event);
                    },
                    onFocus: (event: React.FocusEvent<HTMLElement>) => {
                      if (event.target === event.currentTarget && keyboardFocus(event.currentTarget)) setSlot({ columnId: c.id, startMin: initialSlot(), by: "key" });
                    },
                    onBlur: (event: React.FocusEvent<HTMLElement>) => {
                      if (event.target === event.currentTarget) setSlot((prev) => (prev?.by === "key" ? undefined : prev));
                    },
                  })}
            >
              {renderShading(c)}
              {(c.away ?? []).map((band, index, all) => {
                const from = Math.max(band.startMin, startHour * 60);
                const to = Math.min(band.endMin, endHour * 60);
                if (to <= from) return null;
                const top = offsetPercent(from, startHour, endHour);
                return (
                  <div
                    key={band.id}
                    className="mk-tg-away"
                    role="note"
                    aria-label={band.label}
                    style={{
                      top: `${String(top)}%`,
                      height: `${String(offsetPercent(to, startHour, endHour) - top)}%`,
                      left: `${String((index / all.length) * 100)}%`,
                      width: `${String(100 / all.length)}%`,
                    }}
                  >
                    <span>{band.label}</span>
                  </div>
                );
              })}
              {packed.map(({ item, column, columns: span }) => {
                const top = `${String(offsetPercent(item.startMin, startHour, endHour))}%`;
                const left = `calc(${String((column / span) * 100)}% + 2px)`;
                const roomy = item.endMin - item.startMin >= SLOT_MINUTES;
                const Icon = item.status === undefined ? undefined : STATUS_ICON[item.status];
                return (
                  <Fragment key={item.id}>
                    <button
                      type="button"
                      className={`mk-tg-ev mk-evchip ${item.tone}${item.doctorTone === undefined ? "" : ` d${String(item.doctorTone % DOCTOR_TONES)}`}`}
                      data-cols={span}
                      data-status={item.status}
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
                      <span className="mk-ev-top">
                        <b>{item.title}</b>
                        {item.tag === undefined ? null : <span className="mk-ev-tag">{item.tag}</span>}
                        {Icon === undefined ? null : <Icon className="mk-ev-ic" aria-hidden="true" />}
                      </span>
                      {roomy && item.subtitle !== undefined ? <span className="mk-ev-sub">{item.subtitle}</span> : null}
                    </button>
                    <div className={`mk-tip ${item.tone}`} role="tooltip" aria-hidden="true" style={{ top, left }}>
                      <b>{item.title}</b>
                      {item.subtitle === undefined ? null : <span>{item.subtitle}</span>}
                      {item.visitKind === undefined ? null : <VisitKindTag kind={item.visitKind} />}
                    </div>
                  </Fragment>
                );
              })}
              {slot?.columnId === c.id && onBook !== undefined ? (
                <div ref={ghost} className="mk-tg-ghost" aria-hidden="true" style={{ top: `${String(offsetPercent(slot.startMin, startHour, endHour))}%`, height: `${String((SLOT_MINUTES / ((endHour - startHour) * 60)) * 100)}%` }}>
                  + Book {clockLabel(slot.startMin)}
                </div>
              ) : null}
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
