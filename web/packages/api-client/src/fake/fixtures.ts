/**
 * Synthetic data for the fake client, matching the API's development seed: the same people
 * (by auth_uid), the same two fictional clinics and hosts, plus about sixty patients, a day's
 * schedule, console-only clinics and test results. Names are random combinations of common
 * names, phones sit in one made-up block and emails use example.com.
 */

import type * as C from "../contract.js";
import type { Permission } from "../permissions.js";
import { DENTAL_REASONS, FEMALE_NAMES, MALE_NAMES, SURNAMES } from "./names.js";
import { createQualityReport } from "./quality.js";
import { createRandom, fakeUuid, type Random } from "./random.js";

const DAY = 86_400_000;

export interface FakeRole {
  key: string;
  name: string;
  permissions: readonly Permission[];
}

export interface FakeUser {
  id: string;
  display_name: string;
  email?: string;
  /** E.164; served masked. */
  phone?: string;
  /** What signing in as this user shows, for the dev sign-in screen. */
  description: string;
}

/** A Sakalya team member who signs in to the console. */
export interface FakePlatformUser {
  id: string;
  display_name: string;
  email: string;
  role: "owner" | "support" | "onboarding" | "analyst";
  description: string;
}

export interface FakeClinic {
  id: string;
  slug: string;
  name: string;
  /** The clinic host the API resolves this clinic from. */
  host: string;
  timezone: string;
  specialty: string;
  status: "trial" | "active" | "suspended" | "churned";
  created_at: string;
  /** `SD` in `SD-9`. */
  number_prefix: string;
  branding: { brand: string; mode: "light" | "dark" };
}

export interface FakeMembership {
  id: string;
  user_id: string;
  clinic_id: string;
  role: FakeRole;
}

export interface FakePatient extends Omit<C.Patient, "sex" | "status" | "age_years"> {
  clinic_id: string;
  sex: C.Sex;
  status: "active" | "inactive" | "deceased" | "merged";
}

/** A booked slot today. Its status is worked out from the clock when the day is served. */
export interface FakeScheduleEntry {
  id: string;
  clinic_id: string;
  /** Local start, in minutes after midnight. */
  start_minutes: number;
  duration_minutes: number;
  patient_id: string;
  practitioner: { id: string; display_name: string };
  room: string;
  kind: C.AppointmentKind;
  reason: string;
  /** An outcome that holds whatever the time. */
  outcome?: "cancelled" | "no_show";
}

export interface FakeClinicDay {
  clinic_id: string;
  money: C.TodayMoney;
}

export interface Fixtures {
  users: FakeUser[];
  platformUsers: FakePlatformUser[];
  clinics: FakeClinic[];
  memberships: FakeMembership[];
  patients: FakePatient[];
  schedule: FakeScheduleEntry[];
  days: FakeClinicDay[];
  quality: C.QualityReport;
}

export interface FixtureOptions {
  /** Same seed, same data. */
  seed?: number;
  /** The moment the data is built around; defaults to now. */
  now?: Date;
}

export const ROLES = {
  owner: {
    key: "owner",
    name: "Owner",
    permissions: ["patients.read", "patients.write", "patients.contact", "appointments.read", "appointments.write", "billing.read", "finance.view"],
  },
  doctor: {
    key: "doctor",
    name: "Doctor",
    permissions: ["patients.read", "patients.write", "patients.contact", "appointments.read", "appointments.write"],
  },
  frontDesk: {
    key: "front_desk",
    name: "Front desk",
    permissions: ["patients.read", "patients.write", "patients.contact", "appointments.read", "appointments.write", "billing.read"],
  },
  assistant: { key: "assistant", name: "Assistant", permissions: ["patients.read", "appointments.read"] },
  consultant: { key: "consultant", name: "Visiting consultant", permissions: ["appointments.read"] },
} as const satisfies Record<string, FakeRole>;

/** Builds the full synthetic data set. Deterministic for a given seed and `now`. */
export function createFixtures(options: FixtureOptions = {}): Fixtures {
  const random = createRandom(options.seed ?? 20261003);
  const now = options.now ?? new Date();
  const id = (daysAgo = 400): string => fakeUuid(random, new Date(now.getTime() - daysAgo * DAY));

  // The API's development seed: the same auth_uids sign in through POST /api/v1/dev/token.
  const users = {
    asha: {
      id: "a1a1a1a1-0000-4000-8000-000000000001",
      display_name: "Asha Kulkarni",
      email: "asha.kulkarni@example.com",
      phone: "+919876500011",
      description: "Owner at Sunrise Dental: sees the day's money and every permission.",
    },
    dev: {
      id: "a1a1a1a1-0000-4000-8000-000000000002",
      display_name: "Dr Dev Rao",
      email: "dev.rao@example.com",
      description: "Doctor at Sunrise Dental and visiting consultant at Lotus Dental Care: can switch clinics.",
    },
    farah: {
      id: "a1a1a1a1-0000-4000-8000-000000000003",
      display_name: "Farah Shaikh",
      phone: "+919876500013",
      description: "Front desk at Sunrise Dental: registers and finds patients.",
    },
    bina: {
      id: "b1b1b1b1-0000-4000-8000-000000000001",
      display_name: "Bina Joshi",
      email: "bina.joshi@example.com",
      description: "Owner at Lotus Dental Care.",
    },
  } satisfies Record<string, FakeUser>;

  const sunrise: FakeClinic = {
    id: id(14),
    slug: "sunrise",
    name: "Sunrise Dental",
    host: "sunrise.localtest.me",
    timezone: "Asia/Kolkata",
    branding: { brand: "#14a89a", mode: "light" },
    specialty: "dental",
    status: "trial",
    created_at: isoDaysAgo(now, 14),
    number_prefix: "SD",
  };
  const lotus: FakeClinic = {
    id: id(6),
    slug: "lotus",
    name: "Lotus Dental Care",
    host: "lotus.localtest.me",
    timezone: "Asia/Kolkata",
    branding: { brand: "#db2777", mode: "light" },
    specialty: "dental",
    status: "trial",
    created_at: isoDaysAgo(now, 6),
    number_prefix: "LD",
  };

  const memberships: FakeMembership[] = [
    { id: id(), user_id: users.asha.id, clinic_id: sunrise.id, role: ROLES.owner },
    { id: id(), user_id: users.dev.id, clinic_id: sunrise.id, role: ROLES.doctor },
    { id: id(), user_id: users.dev.id, clinic_id: lotus.id, role: ROLES.consultant },
    { id: id(), user_id: users.farah.id, clinic_id: sunrise.id, role: ROLES.frontDesk },
    { id: id(), user_id: users.bina.id, clinic_id: lotus.id, role: ROLES.owner },
  ];


  const sunrisePatients = makePatients(random, sunrise, 48, now, 1, 10_000);
  const lotusPatients = makePatients(random, lotus, 12, now, 1, 20_000);

  const practitioners = {
    asha: { id: id(), display_name: users.asha.display_name },
    dev: { id: id(), display_name: users.dev.display_name },
    bina: { id: id(), display_name: users.bina.display_name },
  };

  const schedule: FakeScheduleEntry[] = [
    ...makeSchedule(random, sunrise, sunrisePatients, now, [
      { at: "09:00", who: practitioners.asha, room: "Chair 1" },
      { at: "09:30", who: practitioners.dev, room: "Chair 2", outcome: "no_show" },
      { at: "10:00", who: practitioners.asha, room: "Chair 1" },
      { at: "10:30", who: practitioners.dev, room: "Chair 2" },
      { at: "11:00", who: practitioners.asha, room: "Chair 1" },
      { at: "11:30", who: practitioners.dev, room: "Chair 2" },
      { at: "12:00", who: practitioners.asha, room: "Chair 1" },
      { at: "12:30", who: practitioners.dev, room: "Chair 2", outcome: "cancelled" },
      { at: "14:00", who: practitioners.asha, room: "Chair 1" },
      { at: "14:30", who: practitioners.dev, room: "Chair 2" },
      { at: "15:00", who: practitioners.asha, room: "Chair 1" },
      { at: "16:00", who: practitioners.dev, room: "Chair 2", reason: "Braces review" },
      { at: "16:30", who: practitioners.dev, room: "Chair 2", reason: "Aligner check" },
      { at: "17:00", who: practitioners.dev, room: "Chair 1" },
      { at: "17:30", who: practitioners.asha, room: "Chair 1" },
    ]),
    ...makeSchedule(random, lotus, lotusPatients, now, [
      { at: "10:00", who: practitioners.bina, room: "Chair 1" },
      { at: "11:00", who: practitioners.asha, room: "Chair 1" },
      { at: "12:00", who: practitioners.bina, room: "Chair 1" },
      { at: "17:00", who: practitioners.asha, room: "Chair 1" },
      { at: "18:00", who: practitioners.bina, room: "Chair 1" },
      { at: "18:30", who: practitioners.asha, room: "Chair 1" },
    ]),
  ];

  const days: FakeClinicDay[] = [
    { clinic_id: sunrise.id, money: { collected_paise: 2_850_000, pending_dues_paise: 6_400_000, pending_dues_patients: 5 } },
    { clinic_id: lotus.id, money: { collected_paise: 640_000, pending_dues_paise: 1_250_000, pending_dues_patients: 2 } },
  ];

  const platformUsers: FakePlatformUser[] = [
    {
      id: "c1c1c1c1-0000-4000-8000-000000000001",
      display_name: "Sakalya Admin",
      email: "admin@sakalya.example",
      role: "owner",
      description: "Sakalya platform owner: clinics, service health and quality.",
    },
  ];

  return {
    users: Object.values(users),
    platformUsers,
    clinics: [sunrise, lotus, ...makeConsoleOnlyClinics(random, now)],
    memberships,
    patients: [...sunrisePatients, ...lotusPatients],
    schedule,
    days,
    quality: createQualityReport(random, now),
  };
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY).toISOString();
}

function isoDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function pickAge(random: Random): number {
  const band = random.next();
  if (band < 0.15) return random.int(4, 14);
  if (band < 0.4) return random.int(15, 30);
  if (band < 0.75) return random.int(31, 50);
  return random.int(51, 82);
}

function pickLanguage(random: Random): string {
  const roll = random.next();
  if (roll < 0.4) return "en-IN";
  if (roll < 0.75) return "mr-IN";
  if (roll < 0.95) return "hi-IN";
  return "gu-IN";
}

function emailFor(first: string, last: string, random: Random): string {
  const clean = (part: string) => part.toLowerCase().replace(/[^a-z]/g, "");
  return `${clean(first)}.${clean(last)}${String(random.int(1, 99))}@example.com`;
}

function makePatients(
  random: Random,
  clinic: FakeClinic,
  count: number,
  now: Date,
  firstNumber: number,
  phoneBlock: number,
): FakePatient[] {
  const patients: FakePatient[] = [];
  const names = new Set<string>();
  let familyPhone: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const roll = random.next();
    const sex: C.Sex = roll < 0.51 ? "female" : roll < 0.99 ? "male" : "other";
    let fullName = "";
    let first = "";
    let last = "";
    for (let attempt = 0; attempt < 20 && (fullName === "" || names.has(fullName)); attempt += 1) {
      first = random.pick(sex === "male" ? MALE_NAMES : sex === "female" ? FEMALE_NAMES : [...FEMALE_NAMES, ...MALE_NAMES]);
      last = random.pick(SURNAMES);
      fullName = `${first} ${last}`;
    }
    names.add(fullName);

    const age = pickAge(random);
    const createdAt = new Date(now.getTime() - random.int(7, 700) * DAY - random.int(0, 600) * 60_000);
    const estimated = random.chance(0.2);
    const dateOfBirth = estimated
      ? `${String(now.getUTCFullYear() - age)}-01-01`
      : isoDate(new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()) - random.int(1, 360) * DAY));

    // Children often share a parent's number: a phone is contact, never identity.
    const ownPhone = `+919876${String(phoneBlock + index * 37).padStart(6, "0").slice(-6)}`;
    const phone = age < 15 && familyPhone !== undefined && random.chance(0.6) ? familyPhone : random.chance(0.92) ? ownPhone : null;
    if (age >= 18 && phone !== null) {
      familyPhone = phone;
    }

    const visited = random.chance(0.85);
    const lastVisit = visited
      ? new Date(createdAt.getTime() + random.next() * (now.getTime() - DAY - createdAt.getTime())).toISOString()
      : null;

    patients.push({
      clinic_id: clinic.id,
      id: fakeUuid(random, createdAt),
      number: `${clinic.number_prefix}-${String(firstNumber + index)}`,
      full_name: fullName,
      sex,
      date_of_birth: dateOfBirth,
      birth_date_estimated: estimated,
      phone,
      email: age >= 18 && random.chance(0.35) ? emailFor(first, last, random) : null,
      preferred_language: pickLanguage(random),
      status: random.chance(0.96) ? "active" : "inactive",
      created_at: createdAt.toISOString(),
      last_visit_at: lastVisit,
    });
  }
  return patients;
}

interface SlotPlan {
  at: string;
  who: { id: string; display_name: string };
  room: string;
  reason?: string;
  outcome?: "cancelled" | "no_show";
}

function makeSchedule(
  random: Random,
  clinic: FakeClinic,
  patients: readonly FakePatient[],
  now: Date,
  plan: readonly SlotPlan[],
): FakeScheduleEntry[] {
  const pool = patients.filter((p) => p.status === "active");
  return plan.map((slot, index) => {
    const [hours = 9, minutes = 0] = slot.at.split(":").map((part) => Number.parseInt(part, 10));
    const reason = slot.reason ?? random.pick(DENTAL_REASONS);
    const patient = pool[(index * 3) % pool.length] ?? random.pick(pool);
    const entry: FakeScheduleEntry = {
      id: fakeUuid(random, new Date(now.getTime() - random.int(1, 20) * DAY)),
      clinic_id: clinic.id,
      start_minutes: hours * 60 + minutes,
      duration_minutes: 30,
      patient_id: patient.id,
      practitioner: slot.who,
      room: slot.room,
      kind: reason === "Consultation" ? "new" : reason.includes("sitting 2") || reason.includes("review") ? "follow_up" : "procedure",
      reason,
    };
    return slot.outcome === undefined ? entry : { ...entry, outcome: slot.outcome };
  });
}

/** Clinics that exist only in the console listing: no staff or patients behind them. */
function makeConsoleOnlyClinics(random: Random, now: Date): FakeClinic[] {
  const rows: readonly [string, string, FakeClinic["status"], number, string][] = [
    ["Dantashree Dental Clinic", "dantashree", "active", 45, "Dr. Rohini Kale"],
    ["Pearl Smile Dental", "pearlsmile", "active", 38, "Dr. Sameer Naik"],
    ["Sparsh Dental Care", "sparsh", "trial", 9, "Dr. Neha Deshmukh"],
    ["Kshitij Dental Studio", "kshitij", "suspended", 60, "Dr. Aditya Thakur"],
    ["Navi Smile Dental", "navismile", "churned", 120, "Dr. Imran Khan"],
    ["Ujjwal Dental Care", "ujjwal", "trial", 2, "Dr. Pallavi Sawant"],
  ];
  return rows.map(([name, slug, status, daysAgo]) => {
    const createdAt = new Date(now.getTime() - daysAgo * DAY - random.int(0, 600) * 60_000);
    return {
      id: fakeUuid(random, createdAt),
      slug,
      name,
      host: `${slug}.localtest.me`,
      timezone: "Asia/Kolkata",
      branding: { brand: "#14a89a", mode: "light" },
      specialty: "dental",
      status,
      created_at: createdAt.toISOString(),
      number_prefix: slug.slice(0, 2).toUpperCase(),
    } satisfies FakeClinic;
  });
}
