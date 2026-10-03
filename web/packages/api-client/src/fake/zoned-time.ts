/** Wall-clock helpers for a clinic's time zone, using only `Intl`. */

const MINUTE = 60_000;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(instant: Date, timeZone: string): Parts {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = format.formatToParts(instant).find((p) => p.type === type);
    return part === undefined ? 0 : Number.parseInt(part.value, 10);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Minutes the zone is ahead of UTC at `instant` (330 for Asia/Kolkata). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / MINUTE);
}

/** The local date (`YYYY-MM-DD`) and minutes after midnight at `instant` in `timeZone`. */
export function localClock(instant: Date, timeZone: string): { date: string; minutes: number } {
  const p = partsIn(instant, timeZone);
  const date = `${String(p.year)}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { date, minutes: p.hour * 60 + p.minute };
}

/** The instant when the wall clock in `timeZone` shows `minutes` after midnight on `date`. */
export function atLocalTime(date: string, minutes: number, timeZone: string): Date {
  const [year = 1970, month = 1, day = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  const guess = new Date(Date.UTC(year, month - 1, day, 0, minutes));
  return new Date(guess.getTime() - offsetMinutes(guess, timeZone) * MINUTE);
}
