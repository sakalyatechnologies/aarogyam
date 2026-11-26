import type { NewArrivalBody } from "@aarogyam/api-client";

import { EMPTY_PIN, isPin, type PinValue } from "../../components/pin-code-fields.js";

/** What the patient types on the QR check-in page. Strings while editing; checked and converted on Continue. */
export interface ArriveValues {
  forSelf: boolean;
  /** The person filling the form, when it is for someone else. */
  contactName: string;
  relation: string;
  firstName: string;
  lastName: string;
  /** Ten digits, +91 assumed. */
  phone: string;
  reasons: readonly string[];
  reasonText: string;
  consentCare: boolean;
  reminders: boolean;
  email: string;
  sex: string;
  /** One field: a whole number of years, or a date of birth as `DD/MM/YYYY` or `YYYY-MM-DD`. */
  ageOrBirth: string;
  pin: PinValue;
  line1: string;
  health: readonly string[];
  allergies: string;
}

export const EMPTY_ARRIVE: ArriveValues = {
  forSelf: true,
  contactName: "",
  relation: "",
  firstName: "",
  lastName: "",
  phone: "",
  reasons: [],
  reasonText: "",
  consentCare: false,
  reminders: false,
  email: "",
  sex: "",
  ageOrBirth: "",
  pin: EMPTY_PIN,
  line1: "",
  health: [],
  allergies: "",
};

export type ArriveField = "contactName" | "relation" | "firstName" | "phone" | "reasons" | "consentCare" | "email" | "ageOrBirth" | "pincode";

export type ArriveProblems = Partial<Record<ArriveField, string>>;

type AgeOrBirth = { kind: "none" } | { kind: "age"; years: number } | { kind: "birth"; date: string } | { kind: "bad" };

/** Reads the one "Age or date of birth" field. `today` is `YYYY-MM-DD`. */
export function parseAgeOrBirth(text: string, today: string): AgeOrBirth {
  const t = text.trim();
  if (t === "") return { kind: "none" };
  if (/^\d{1,3}$/.test(t)) {
    const years = Number(t);
    return years <= 130 ? { kind: "age", years } : { kind: "bad" };
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const parts = dmy === null ? (ymd === null ? undefined : { y: ymd[1], m: ymd[2], d: ymd[3] }) : { y: dmy[3], m: dmy[2], d: dmy[1] };
  if (parts?.y === undefined || parts.m === undefined || parts.d === undefined) return { kind: "bad" };
  const year = Number(parts.y);
  const month = Number(parts.m);
  const day = Number(parts.d);
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return { kind: "bad" };
  const date = `${parts.y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return date > today || year < 1896 ? { kind: "bad" } : { kind: "birth", date };
}

/** What is wrong with the form, field by field. Empty when it can be sent. */
export function arriveProblems(values: ArriveValues, today: string): ArriveProblems {
  const problems: ArriveProblems = {};
  if (values.firstName.trim() === "") problems.firstName = "Enter the first name.";
  if (!/^[6-9]\d{9}$/.test(values.phone)) problems.phone = "Enter a 10-digit mobile number.";
  if (values.reasons.length === 0 && values.reasonText.trim() === "") problems.reasons = "Choose what brings you in, or write a few words.";
  if (!values.consentCare) problems.consentCare = "Please agree so the clinic can treat you.";
  if (!values.forSelf) {
    if (values.contactName.trim() === "") problems.contactName = "Enter your name.";
    if (values.relation === "") problems.relation = "Choose how you are related.";
  }
  if (values.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) problems.email = "Enter a valid email address, or leave it empty.";
  if (parseAgeOrBirth(values.ageOrBirth, today).kind === "bad") problems.ageOrBirth = "Enter an age like 34, or a date of birth like 12/05/1990.";
  if (values.pin.pincode !== "" && !isPin(values.pin.pincode)) problems.pincode = "A PIN code has six digits.";
  return problems;
}

const text = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** The request for a valid form. The key is the QR's own; nothing else identifies the clinic. */
export function arriveBody(key: string, values: ArriveValues, today: string, honeypot: string): NewArrivalBody {
  const when = parseAgeOrBirth(values.ageOrBirth, today);
  const city = text(values.pin.city);
  const address = {
    line1: text(values.line1),
    city,
    district: city,
    state: text(values.pin.state),
    pincode: values.pin.pincode === "" ? null : values.pin.pincode,
  };
  const hasAddress = Object.values(address).some((part) => part !== null);
  return {
    k: key,
    first_name: values.firstName.trim(),
    last_name: text(values.lastName),
    phone: values.phone,
    for_self: values.forSelf,
    contact_name: values.forSelf ? null : values.contactName.trim(),
    relation: values.forSelf ? null : values.relation,
    reasons: [...values.reasons],
    reason_text: text(values.reasonText),
    consent_care: true,
    reminders: values.reminders,
    email: text(values.email),
    sex: values.sex === "" ? null : values.sex,
    age_years: when.kind === "age" ? when.years : null,
    date_of_birth: when.kind === "birth" ? when.date : null,
    address: hasAddress ? address : null,
    health: [...values.health],
    allergies_text: text(values.allergies),
    ...(honeypot === "" ? {} : { website: honeypot }),
  };
}
