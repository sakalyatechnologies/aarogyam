/** Display formatting for Indian users: Indian digit grouping, rupees, local dates. */

const LOCALE = "en-IN";
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** `123456` → `1,23,456`. */
export function formatNumber(value: number): string {
  return integer.format(value);
}

/** A ratio from 0 to 1 as a percentage: `0.9982` → `99.82%`. */
export function formatPercent(ratio: number, fractionDigits = 1): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(ratio);
}

/** Paise as rupees: `2850000` → `₹28,500`; keeps paise only when there are some. */
export function formatRupees(paise: number): string {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(paise / 100);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** `2791728742` → `2.6 GB` (powers of 1024). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit] ?? "B"}`;
}

/** Milliseconds for latency: `38` → `38 ms`, `1840` → `1.84 s`. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** `3 Oct 2026` */
export function formatDate(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}

/** `3 Oct 2026, 11:30 am` */
export function formatDateTime(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** `11:30 am` */
export function formatTime(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/**
 * How long before `now` something happened: `5 min ago`, `3 hr ago`. Takes `now` (usually the
 * server's `generated_at`) instead of reading the clock, so rendering stays pure.
 */
export function formatRelative(iso: string, now: string | Date): string {
  const elapsed = new Date(iso).getTime() - new Date(now).getTime();
  const format = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "short" });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(elapsed) >= size) {
      return format.format(Math.round(elapsed / size), unit);
    }
  }
  return "just now";
}
