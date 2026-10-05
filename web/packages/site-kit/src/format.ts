/** Small formatters for the public page: money, hours, phone numbers and addresses. */

import type { SiteAddress, SiteDay, SitePage } from "@aarogyam/api-client";

const RUPEES = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** `150000` paise as `₹1,500`; paise are shown only when there are some. */
export function formatFee(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const rest = Math.abs(paise % 100);
  if (rest === 0) {
    return `₹${RUPEES.format(rupees)}`;
  }
  return `₹${RUPEES.format(rupees)}.${String(rest).padStart(2, "0")}`;
}

/** `restorative_care` as `Restorative care`. */
export function categoryLabel(category: string | null | undefined): string {
  const text = (category ?? "").replaceAll("_", " ").trim();
  return text === "" ? "Other treatments" : text.charAt(0).toUpperCase() + text.slice(1);
}

/** `13:30` as `1:30 PM`, `09:00` as `9 AM`. */
export function formatTime(clock: string): string {
  const [h = "0", m = "00"] = clock.split(":");
  const hour = Number.parseInt(h, 10);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return m === "00" ? `${String(twelve)} ${suffix}` : `${String(twelve)}:${m} ${suffix}`;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dayName(weekday: number, short = false): string {
  const name = DAYS[weekday - 1] ?? "";
  return short ? name.slice(0, 3) : name;
}

export interface HoursRow {
  /** `Mon – Fri` or `Sunday`. */
  label: string;
  /** `9 AM – 1 PM, 4 PM – 8 PM`, or `Closed`. */
  text: string;
  closed: boolean;
}

function spansText(day: SiteDay): string {
  return day.spans.map(([from = "", to = ""]) => `${formatTime(from)} – ${formatTime(to)}`).join(", ");
}

/** Opening hours for a week, with days that share hours grouped: `Mon – Fri`. */
export function hoursRows(hours: readonly SiteDay[]): HoursRow[] {
  const byDay = new Map(hours.map((d) => [d.weekday, spansText(d)]));
  const rows: { from: number; to: number; text: string }[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const text = byDay.get(weekday) ?? "";
    const last = rows[rows.length - 1];
    if (last !== undefined && last.text === text && last.to === weekday - 1) {
      last.to = weekday;
    } else {
      rows.push({ from: weekday, to: weekday, text });
    }
  }
  return rows.map((r) => ({
    label: r.from === r.to ? dayName(r.from) : `${dayName(r.from, true)} – ${dayName(r.to, true)}`,
    text: r.text === "" ? "Closed" : r.text,
    closed: r.text === "",
  }));
}

/** How many days a week the clinic is open. */
export function openDays(hours: readonly SiteDay[]): number {
  return hours.filter((d) => d.spans.length > 0).length;
}

/** `+919876543210` as `+91 98765 43210`; other numbers are shown as stored. */
export function prettyPhone(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match === null ? e164 : `+91 ${match[1] ?? ""} ${match[2] ?? ""}`;
}

export const telHref = (e164: string): string => `tel:${e164}`;

export function whatsappHref(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export function addressLines(address: SiteAddress): string[] {
  const cityLine = [address.city, address.state].filter((p): p is string => p != null && p !== "").join(", ");
  const withPin = [cityLine, address.pincode ?? ""].filter((p) => p !== "").join(" – ");
  return [address.line1, address.line2, withPin].filter((p): p is string => p != null && p !== "");
}

export function addressText(address: SiteAddress): string {
  return addressLines(address).join(", ");
}

/** The clinic's own map link, or a search for its address. */
export function directionsHref(site: SitePage): string | null {
  if (site.clinic.map_url != null && site.clinic.map_url !== "") {
    return site.clinic.map_url;
  }
  const text = [site.clinic.name, addressText(site.clinic.address)].filter((p) => p !== "").join(", ");
  return addressText(site.clinic.address) === "" ? null : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/^dr\.?\s+/i, "")
    .split(/\s+/)
    .filter((w) => w !== "");
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}
