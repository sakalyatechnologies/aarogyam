/** How patients are shown. Names never go in URLs or page titles; numbers do. */

import { useSyncExternalStore } from "react";

import type { Sex } from "@aarogyam/api-client";

const SEX_LABEL: Readonly<Record<Sex, string>> = { female: "Female", male: "Male", other: "Other", unknown: "Sex not recorded" };

export const SEX_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Not recorded" },
] as const;

export const LANGUAGES = [
  { value: "en-IN", label: "English" },
  { value: "hi-IN", label: "Hindi" },
  { value: "mr-IN", label: "Marathi" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "kn-IN", label: "Kannada" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "bn-IN", label: "Bengali" },
  { value: "pa-IN", label: "Punjabi" },
  { value: "ur-IN", label: "Urdu" },
] as const;

export function languageLabel(code: string): string {
  return LANGUAGES.find((language) => language.value === code)?.label ?? code;
}

/** `34 Y · Female`, `About 34 Y · Female` for an estimate, or just the sex when the age is unknown. */
export function ageSex(age: number | null | undefined, sex: Sex, estimated = false): string {
  if (age == null) {
    return SEX_LABEL[sex];
  }
  return `${estimated ? "About " : ""}${String(age)} Y · ${SEX_LABEL[sex]}`;
}

/** Whole years from a `YYYY-MM-DD` birth date to `today` (`YYYY-MM-DD`). */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by = 0, bm = 1, bd = 1] = dateOfBirth.split("-").map(Number);
  const [ty = 0, tm = 1, td = 1] = today.split("-").map(Number);
  return Math.max(0, ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0));
}

const subscribe = () => () => undefined;
const isoToday = () => new Date().toISOString().slice(0, 10);

/** Today's date, read through React's external-store hook so rendering stays pure. */
export function useTodayDate(): string {
  return useSyncExternalStore(subscribe, isoToday, isoToday);
}

/** Patient 360's address: the clinic number, never the name or phone. */
export function patientPath(patient: { number: string }): string {
  return `/patients/${encodeURIComponent(patient.number)}`;
}

/** `+919876543210` → `+91 98765 43210`. */
export function formatPhone(e164: string): string {
  const national = e164.startsWith("+91") ? e164.slice(3) : e164;
  return e164.startsWith("+91") && national.length === 10 ? `+91 ${national.slice(0, 5)} ${national.slice(5)}` : e164;
}

/** `+91 ••••• •3210` */
export function maskPhone(e164: string): string {
  return e164.startsWith("+91") ? `+91 ••••• •${e164.slice(-4)}` : `•••• ${e164.slice(-4)}`;
}

/** `a•••@example.com` */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? "•••" : `${email.charAt(0)}•••${email.slice(at)}`;
}
