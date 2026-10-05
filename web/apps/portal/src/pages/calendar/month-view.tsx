import "./calendar.css";

import { monthWeeks } from "../../lib/time.js";

export interface MonthItem {
  id: string;
  /** Clinic-local date, `YYYY-MM-DD`. */
  date: string;
  startMin: number;
  /** Text for the chip, e.g. `10:30 am Asha Rao`. */
  label: string;
  /** Colour class from the status legend. */
  tone: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN = 2;

/** A month at a glance: each day shows its first appointments and "+N more"; choosing a day opens it. */
export function MonthView({
  month,
  today,
  items,
  onOpenDay,
  onSelect,
}: {
  /** Any date in the month to show. */
  month: string;
  today: string;
  items: readonly MonthItem[];
  onOpenDay: (date: string) => void;
  onSelect: (id: string) => void;
}) {
  const weeks = monthWeeks(month);
  const monthKey = month.slice(0, 7);
  const byDay = new Map<string, MonthItem[]>();
  for (const item of [...items].sort((a, b) => a.startMin - b.startMin)) {
    byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  }
  return (
    <div className="mk-month" role="group" aria-label={`Appointments in ${monthKey}`}>
      {WEEKDAYS.map((d) => (
        <div key={d} className="mk-dh">
          {d}
        </div>
      ))}
      {weeks.flat().map((date) => {
        const day = byDay.get(date) ?? [];
        const more = day.length - SHOWN;
        return (
          <div key={date} className={`mk-mday ${date.startsWith(monthKey) ? "" : "out"} ${date === today ? "today" : ""}`}>
            <button
              type="button"
              className="mk-mnum"
              aria-label={`${date}, ${String(day.length)} ${day.length === 1 ? "appointment" : "appointments"}. Open day`}
              onClick={() => {
                onOpenDay(date);
              }}
            >
              {Number(date.slice(8, 10))}
              {day.length > 0 ? <span className="mk-mcount">{day.length}</span> : null}
            </button>
            {day.slice(0, SHOWN).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mk-evchip ${item.tone}`}
                title={item.label}
                onClick={() => {
                  onSelect(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
            {more > 0 ? (
              <button
                type="button"
                className="mk-more"
                onClick={() => {
                  onOpenDay(date);
                }}
              >
                +{more} more
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
