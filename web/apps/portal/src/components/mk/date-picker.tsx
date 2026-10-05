// moves to sakalya-web
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { addDays, addMonths, monthWeeks } from "../../lib/time.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** `Mon, 5 Oct 2026`. */
export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export interface DatePickerProps {
  /** `YYYY-MM-DD`. */
  value: string;
  onChange: (date: string) => void;
  /** Earliest choosable day (`YYYY-MM-DD`); earlier days are disabled. */
  min?: string | undefined;
  /** Highlighted as today. */
  today: string;
  /** The id of the trigger button, so a `Field` label points at it. */
  id?: string | undefined;
  className?: string | undefined;
}

/**
 * A date field that opens a month grid: today ringed, the chosen day filled, days before `min` disabled.
 * Arrow keys move by day and week, PageUp/PageDown by month, Home/End to the week's ends, Enter picks, Escape closes.
 */
export function DatePicker({ value, onChange, min, today, id, className = "" }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const disabled = (date: string) => min !== undefined && date < min;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("pointerdown", away);
    };
  }, [open]);

  // Keep focus on the cursor day while the grid is open.
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLElement>(`[data-date="${cursor}"]`)?.focus();
  }, [open, cursor]);

  const show = () => {
    setCursor(value);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (date: string) => {
    if (disabled(date)) return;
    onChange(date);
    close();
  };
  const move = (event: KeyboardEvent) => {
    const steps: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
      Home: () => addDays(cursor, -(weekdayIndex(cursor))),
      End: () => addDays(cursor, 6 - weekdayIndex(cursor)),
    };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setCursor(step());
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const monthKey = cursor.slice(0, 7);
  const monthLabel = new Date(`${cursor.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div ref={root} className={`mk-dp ${className}`}>
      <button ref={trigger} id={id} type="button" aria-label={`Date, ${longDate(value)}`} className="mk-dp-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? gridId : undefined} onClick={open ? close : show}>
        <CalendarDays aria-hidden="true" className="size-4" />
        <span>{longDate(value)}</span>
      </button>
      {open ? (
        <div id={gridId} className="mk-dp-pop" role="dialog" aria-label="Choose a date">
          <div className="mk-dp-head">
            <button type="button" className="mk-dp-nav" aria-label="Previous month" onClick={() => { setCursor(addMonths(cursor, -1)); }}>
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <b aria-live="polite">{monthLabel}</b>
            <button type="button" className="mk-dp-nav" aria-label="Next month" onClick={() => { setCursor(addMonths(cursor, 1)); }}>
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div ref={grid} role="grid" aria-label={monthLabel} className="mk-dp-grid" onKeyDown={move}>
            {WEEKDAYS.map((d) => (
              <span key={d} className="mk-dp-wd" aria-hidden="true">
                {d.slice(0, 2)}
              </span>
            ))}
            {monthWeeks(cursor).flat().map((date) => (
              <button
                key={date}
                type="button"
                role="gridcell"
                data-date={date}
                tabIndex={date === cursor ? 0 : -1}
                disabled={disabled(date)}
                aria-selected={date === value}
                aria-current={date === today ? "date" : undefined}
                aria-label={longDate(date)}
                className={`mk-dp-day ${date.startsWith(monthKey) ? "" : "out"} ${date === today ? "today" : ""} ${date === value ? "sel" : ""}`}
                onClick={() => {
                  pick(date);
                }}
              >
                {Number(date.slice(8, 10))}
              </button>
            ))}
          </div>
          <div className="mk-dp-foot">
            <button
              type="button"
              className="mk-dp-link"
              disabled={disabled(today)}
              onClick={() => {
                pick(today);
              }}
            >
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Monday 0 to Sunday 6. */
function weekdayIndex(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}
