/** Converting between a clinic's local wall-clock time and the UTC instants the API uses. */

const MINUTE = 60_000;

function offsetMinutes(instant: Date, timeZone: string): number {
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
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return Math.round((asUtc - instant.getTime()) / MINUTE);
}

/** The instant (ISO, UTC) when the wall clock in `timeZone` shows `time` (`HH:MM`) on `date` (`YYYY-MM-DD`). */
export function localInstant(date: string, time: string, timeZone: string): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  const [hour = 0, minute = 0] = time.split(":").map((part) => Number.parseInt(part, 10));
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - offsetMinutes(guess, timeZone) * MINUTE).toISOString();
}

/** The local date (`YYYY-MM-DD`) and fractional hour (9.5 for 9:30) of an instant in `timeZone`. */
export function localDateHour(iso: string, timeZone: string): { date: string; hour: number } {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = format.formatToParts(new Date(iso)).find((p) => p.type === type);
    return part === undefined ? 0 : Number.parseInt(part.value, 10);
  };
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${String(year)}-${pad(month)}-${pad(day)}`, hour: read("hour") + read("minute") / 60 };
}

/** The Monday (`YYYY-MM-DD`) of the week containing `date`, treating Monday as the first day. */
export function mondayOf(date: string): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  const instant = new Date(Date.UTC(year, month - 1, day));
  const weekday = instant.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  instant.setUTCDate(instant.getUTCDate() + diff);
  return instant.toISOString().slice(0, 10);
}

/** `date` plus `days` (which may be negative), as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  const instant = new Date(Date.UTC(year, month - 1, day));
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/** Today's date (`YYYY-MM-DD`) in `timeZone`. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The first day of the month containing `date`. */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** `date` moved by `months` whole months, landing on the 1st (the month grid only needs the month). */
export function addMonths(date: string, months: number): string {
  const [year = 1970, month = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  const instant = new Date(Date.UTC(year, month - 1 + months, 1));
  return instant.toISOString().slice(0, 10);
}

/** The Monday-first weeks (7 dates each) that cover the month containing `date`, padded with neighbouring days. */
export function monthWeeks(date: string): string[][] {
  const first = monthStartOf(date);
  const last = addDays(addMonths(first, 1), -1);
  const start = mondayOf(first);
  const weeks: string[][] = [];
  for (let cursor = start; cursor <= last; cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
  }
  return weeks;
}
