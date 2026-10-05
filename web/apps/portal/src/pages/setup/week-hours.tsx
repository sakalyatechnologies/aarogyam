import { Plus, X } from "lucide-react";

import type { WorkingHours } from "@aarogyam/api-client";

export interface DayHours {
  enabled: boolean;
  /** One or two shifts (a split day); local `HH:MM`. */
  shifts: { starts: string; ends: string }[];
}

export type WeekHoursValue = Record<number, DayHours>;

const DAYS = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 7, label: "Sunday" },
] as const;

/** Monday to Saturday, 9 to 6: a starting point most clinics change a little. */
export function defaultWeek(): WeekHoursValue {
  const week: WeekHoursValue = {};
  for (const { weekday } of DAYS) {
    week[weekday] = { enabled: weekday <= 6, shifts: [{ starts: "09:00", ends: "18:00" }] };
  }
  return week;
}

/** The API's shifts as one row per day, split shifts as two entries. */
export function weekFromHours(hours: WorkingHours): WeekHoursValue {
  const week: WeekHoursValue = {};
  for (const { weekday } of DAYS) {
    const shifts = hours.shifts
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => a.starts.localeCompare(b.starts))
      .map((s) => ({ starts: s.starts, ends: s.ends }));
    week[weekday] = shifts.length === 0 ? { enabled: false, shifts: [{ starts: "09:00", ends: "18:00" }] } : { enabled: true, shifts };
  }
  return week;
}

/** Only working days become shifts. */
export function hoursFromWeek(week: WeekHoursValue): WorkingHours {
  return {
    shifts: DAYS.flatMap(({ weekday }) => {
      const day = week[weekday];
      return day?.enabled === true ? day.shifts.map((s) => ({ weekday, starts: s.starts, ends: s.ends })) : [];
    }),
  };
}

/** The first problem a week has (an end before a start, shifts that overlap), in words, or `undefined`. */
export function weekProblem(week: WeekHoursValue): string | undefined {
  for (const { weekday, label } of DAYS) {
    const day = week[weekday];
    if (day?.enabled !== true) {
      continue;
    }
    const sorted = [...day.shifts].sort((a, b) => a.starts.localeCompare(b.starts));
    for (const [index, shift] of sorted.entries()) {
      if (shift.starts === "" || shift.ends === "" || shift.starts >= shift.ends) {
        return `${label}: the end must be after the start.`;
      }
      const before = sorted[index - 1];
      if (before !== undefined && shift.starts < before.ends) {
        return `${label}: the two shifts overlap.`;
      }
    }
  }
  return undefined;
}

/**
 * A week of working hours: each day on or off, with a second shift for split days. Plain time
 * fields and buttons, so it works on a phone and with a keyboard.
 */
export function WeekHours({ value, onChange, idPrefix }: { value: WeekHoursValue; onChange: (next: WeekHoursValue) => void; idPrefix: string }) {
  const set = (weekday: number, day: DayHours) => {
    onChange({ ...value, [weekday]: day });
  };
  const monday = value[1];
  return (
    <div className="sw-week">
      {DAYS.map(({ weekday, label }) => {
        const day = value[weekday] ?? { enabled: false, shifts: [{ starts: "09:00", ends: "18:00" }] };
        return (
          <div key={weekday} className="sw-day" role="group" aria-label={label}>
            <label className="sw-daylabel">
              <input
                type="checkbox"
                checked={day.enabled}
                onChange={(event) => {
                  set(weekday, { ...day, enabled: event.target.checked });
                }}
              />
              <span>{label}</span>
            </label>
            {day.enabled ? (
              <div className="sw-shifts">
                {day.shifts.map((shift, index) => (
                  <div key={index} className="sw-shift">
                    <input
                      id={`${idPrefix}-${String(weekday)}-${String(index)}-from`}
                      type="time"
                      className="mk-tin"
                      aria-label={`${label} ${index === 0 ? "start" : "second shift start"}`}
                      value={shift.starts}
                      onChange={(event) => {
                        set(weekday, { ...day, shifts: day.shifts.map((s, i) => (i === index ? { ...s, starts: event.target.value } : s)) });
                      }}
                    />
                    <span aria-hidden="true">to</span>
                    <input
                      type="time"
                      className="mk-tin"
                      aria-label={`${label} ${index === 0 ? "end" : "second shift end"}`}
                      value={shift.ends}
                      onChange={(event) => {
                        set(weekday, { ...day, shifts: day.shifts.map((s, i) => (i === index ? { ...s, ends: event.target.value } : s)) });
                      }}
                    />
                    {index === 1 ? (
                      <button
                        type="button"
                        className="sw-icon"
                        aria-label={`Remove ${label}'s second shift`}
                        onClick={() => {
                          set(weekday, { ...day, shifts: day.shifts.slice(0, 1) });
                        }}
                      >
                        <X aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {day.shifts.length < 2 ? (
                  <button
                    type="button"
                    className="sw-link"
                    onClick={() => {
                      set(weekday, { ...day, shifts: [...day.shifts, { starts: "17:00", ends: "20:00" }] });
                    }}
                  >
                    <Plus aria-hidden="true" /> Add {label}&rsquo;s evening shift
                  </button>
                ) : null}
              </div>
            ) : (
              <span className="sw-off">Closed</span>
            )}
          </div>
        );
      })}
      {monday?.enabled === true ? (
        <button
          type="button"
          className="sw-link"
          onClick={() => {
            const next: WeekHoursValue = { ...value };
            for (const { weekday } of DAYS) {
              const day = value[weekday];
              if (weekday !== 1 && day?.enabled === true) {
                next[weekday] = { enabled: true, shifts: monday.shifts.map((s) => ({ ...s })) };
              }
            }
            onChange(next);
          }}
        >
          Use Monday&rsquo;s hours for every open day
        </button>
      ) : null}
    </div>
  );
}
