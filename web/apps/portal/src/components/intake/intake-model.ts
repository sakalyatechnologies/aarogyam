import type { PatientIntake } from "@aarogyam/api-client";

/** What a registration form holds for the case-paper fields: strings while editing, converted on save. */
export interface IntakeValues {
  bloodGroup: string;
  occupation: string;
  /** Ten digits, or a masked number kept as the API sent it. */
  altPhone: string;
  callTime: string;
  emergencyName: string;
  emergencyPhone: string;
  referredBy: string;
  heardVia: string;
  heardViaText: string;
  health: readonly string[];
  healthOther: string;
  allergies: string;
  doctorName: string;
  doctorPhone: string;
  doctorAddress: string;
  pregnant: boolean;
  dueDate: string;
  nursing: boolean;
}

export const EMPTY_INTAKE: IntakeValues = {
  bloodGroup: "",
  occupation: "",
  altPhone: "",
  callTime: "",
  emergencyName: "",
  emergencyPhone: "",
  referredBy: "",
  heardVia: "",
  heardViaText: "",
  health: [],
  healthOther: "",
  allergies: "",
  doctorName: "",
  doctorPhone: "",
  doctorAddress: "",
  pregnant: false,
  dueDate: "",
  nursing: false,
};

/** The lists the forms offer; the QR page and the staff form both come with them. */
export interface IntakeChoices {
  health_flags: readonly { code: string; label: string }[];
  blood_groups: readonly { code: string; label: string }[];
  call_times: readonly { code: string; label: string }[];
  heard_via: readonly { code: string; label: string }[];
}

const text = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** A stored phone for the form: ten digits when it is a full +91 number, otherwise as sent (masked). */
function phoneIn(value: string | null | undefined): string {
  if (value == null) return "";
  return /^\+91[6-9]\d{9}$/.test(value) ? value.slice(3) : value;
}

export const isMasked = (value: string): boolean => value.includes("*");

type PhoneKey = "altPhone" | "emergencyPhone" | "doctorPhone";
export type IntakeProblems = Partial<Record<PhoneKey, string>>;

/** The phone fields' problems; a masked value is kept, never checked. */
export function intakeProblems(values: IntakeValues): IntakeProblems {
  const problems: IntakeProblems = {};
  for (const field of ["altPhone", "emergencyPhone", "doctorPhone"] as const) {
    const value = values[field].trim();
    if (value !== "" && !isMasked(value) && !/^[6-9]\d{9}$/.test(value)) problems[field] = "Enter a 10-digit mobile number, or leave it empty.";
  }
  return problems;
}

/** The API body for the form. The women's fields go only for a female patient. A masked phone goes back unchanged. */
export function toIntake(values: IntakeValues, female: boolean): PatientIntake {
  const out: PatientIntake = {};
  const set = (key: "blood_group" | "occupation" | "alt_phone" | "call_time" | "emergency_contact_name" | "emergency_contact_phone" | "referred_by" | "heard_via" | "heard_via_text" | "health_other" | "family_doctor_name" | "family_doctor_phone" | "family_doctor_address" | "due_date", value: string | null) => {
    if (value !== null) out[key] = value;
  };
  set("blood_group", text(values.bloodGroup));
  set("occupation", text(values.occupation));
  set("alt_phone", text(values.altPhone));
  set("call_time", text(values.callTime));
  set("emergency_contact_name", text(values.emergencyName));
  set("emergency_contact_phone", text(values.emergencyPhone));
  set("referred_by", text(values.referredBy));
  set("heard_via", text(values.heardVia));
  if (values.heardVia === "other") set("heard_via_text", text(values.heardViaText));
  set("health_other", text(values.healthOther));
  set("family_doctor_name", text(values.doctorName));
  set("family_doctor_phone", text(values.doctorPhone));
  set("family_doctor_address", text(values.doctorAddress));
  if (female) {
    if (values.pregnant) {
      out.pregnant = true;
      set("due_date", text(values.dueDate));
    }
    if (values.nursing) out.nursing = true;
  }
  return out;
}

/** The form's values for a saved intake (health and allergies are kept as they were). */
export function fromIntake(intake: PatientIntake | null | undefined): IntakeValues {
  return {
    bloodGroup: intake?.blood_group ?? "",
    occupation: intake?.occupation ?? "",
    altPhone: phoneIn(intake?.alt_phone),
    callTime: intake?.call_time ?? "",
    emergencyName: intake?.emergency_contact_name ?? "",
    emergencyPhone: phoneIn(intake?.emergency_contact_phone),
    referredBy: intake?.referred_by ?? "",
    heardVia: intake?.heard_via ?? "",
    heardViaText: intake?.heard_via_text ?? "",
    health: [],
    healthOther: intake?.health_other ?? "",
    allergies: "",
    doctorName: intake?.family_doctor_name ?? "",
    doctorPhone: phoneIn(intake?.family_doctor_phone),
    doctorAddress: intake?.family_doctor_address ?? "",
    pregnant: intake?.pregnant ?? false,
    dueDate: intake?.due_date ?? "",
    nursing: intake?.nursing ?? false,
  };
}

/** Ticks or unticks a checklist code. "None" clears the others, and any other code clears "None". */
export function toggleHealth(values: IntakeValues, code: string): IntakeValues {
  const on = values.health.includes(code);
  let health: string[];
  if (on) health = values.health.filter((c) => c !== code);
  else if (code === "none") health = ["none"];
  else health = [...values.health.filter((c) => c !== "none"), code];
  return {
    ...values,
    health,
    ...(code === "pregnant" ? { pregnant: !on } : {}),
    ...(code === "nursing" ? { nursing: !on } : {}),
  };
}

/** The pregnant or nursing tick; with the checklist shown it ticks the matching checklist chip too. */
export function setWomenFlag(values: IntakeValues, flag: "pregnant" | "nursing", on: boolean, withChecklist: boolean): IntakeValues {
  const next: IntakeValues = { ...values, [flag]: on };
  if (!withChecklist) return next;
  const has = values.health.includes(flag);
  if (on && !has) return { ...next, health: [...values.health.filter((c) => c !== "none"), flag] };
  if (!on && has) return { ...next, health: values.health.filter((c) => c !== flag) };
  return next;
}
