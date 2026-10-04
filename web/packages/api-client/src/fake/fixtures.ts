/**
 * Synthetic data for the fake client: two dental clinics with staff, about sixty patients and a
 * day's schedule, plus console clinics and test results. No real patients: names are random
 * combinations of common names, phones sit in one made-up block and emails use example.com.
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
  role: "admin" | "support";
  description: string;
}

export interface FakeClinic {
  id: string;
  slug: string;
  name: string;
  /** The clinic host the API resolves this clinic from. */
  host: string;
  timezone: string;
  theme: C.ClinicTheme;
  specialty: C.Specialty;
  status: C.ClinicStatus;
  created_at: string;
  /** `SC` in `SC-1042`. */
  number_prefix: string;
  domains: C.ClinicDomain[];
  owner: { display_name: string; email?: string; phone?: string };
  plan?: { key: string; name: string };
}

export interface FakeMembership {
  id: string;
  user_id: string;
  clinic_id: string;
  role: FakeRole;
}

export interface FakePatient extends C.Patient {
  clinic_id: string;
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
  attention: C.TodayAttention[];
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
    permissions: ["patients.read", "patients.write", "appointments.read", "appointments.write", "finance.view"],
  },
  doctor: {
    key: "doctor",
    name: "Doctor",
    permissions: ["patients.read", "patients.write", "appointments.read", "appointments.write"],
  },
  frontDesk: {
    key: "front_desk",
    name: "Front desk",
    permissions: ["patients.read", "patients.write", "appointments.read", "appointments.write"],
  },
  assistant: { key: "assistant", name: "Assistant", permissions: ["patients.read", "appointments.read"] },
  consultant: { key: "consultant", name: "Visiting consultant", permissions: ["appointments.read"] },
} as const satisfies Record<string, FakeRole>;

/** Builds the full synthetic data set. Deterministic for a given seed and `now`. */
export function createFixtures(options: FixtureOptions = {}): Fixtures {
  const random = createRandom(options.seed ?? 20261003);
  const now = options.now ?? new Date();
  const id = (daysAgo = 400): string => fakeUuid(random, new Date(now.getTime() - daysAgo * DAY));

  // Fixed IDs: they double as Supabase auth_uids for POST /api/v1/dev/token against a seeded API.
  const users = {
    anika: {
      id: "0199a000-0000-7000-8000-000000000001",
      display_name: "Dr. Anika Rao",
      email: "anika.rao@example.com",
      phone: "+919876500011",
      description: "Owner at Smile Catchers and doctor at Hasya Dental Studio: sees money and can switch clinics.",
    },
    farhan: {
      id: "0199a000-0000-7000-8000-000000000002",
      display_name: "Dr. Farhan Shaikh",
      email: "farhan.shaikh@example.com",
      description: "Associate doctor at Smile Catchers.",
    },
    sunita: {
      id: "0199a000-0000-7000-8000-000000000003",
      display_name: "Sunita Pawar",
      phone: "+919876500013",
      description: "Front desk at Smile Catchers: registers and finds patients.",
    },
    ravi: {
      id: "0199a000-0000-7000-8000-000000000004",
      display_name: "Ravi Kamble",
      description: "Assistant at Smile Catchers: can look patients up but not register them.",
    },
    vivek: {
      id: "0199a000-0000-7000-8000-000000000005",
      display_name: "Dr. Vivek Menon",
      email: "vivek.menon@example.com",
      description: "Visiting orthodontist at Smile Catchers: sees today's appointments, not the patient list.",
    },
  } satisfies Record<string, FakeUser>;

  const smile: FakeClinic = {
    id: id(14),
    slug: "smilecatchers",
    name: "Smile Catchers",
    host: "smilecatchers.localtest.me:8080",
    timezone: "Asia/Kolkata",
    theme: { brand: "#14a89a", mode: "light" },
    specialty: "dental",
    status: "active",
    created_at: isoDaysAgo(now, 14),
    number_prefix: "SC",
    domains: [
      { hostname: "smilecatchers.aarogyam.example", kind: "portal", is_primary: true, verified_at: isoDaysAgo(now, 14) },
      { hostname: "www.smilecatchers.example", kind: "website", is_primary: false, verified_at: null },
    ],
    owner: { display_name: users.anika.display_name, email: users.anika.email, phone: users.anika.phone },
    plan: { key: "pilot", name: "Pilot" },
  };
  const hasya: FakeClinic = {
    id: id(6),
    slug: "hasya",
    name: "Hasya Dental Studio",
    host: "hasya.localtest.me:8080",
    timezone: "Asia/Kolkata",
    theme: { brand: "#2563eb", mode: "dark" },
    specialty: "dental",
    status: "trial",
    created_at: isoDaysAgo(now, 6),
    number_prefix: "HD",
    domains: [{ hostname: "hasya.aarogyam.example", kind: "portal", is_primary: true, verified_at: isoDaysAgo(now, 6) }],
    owner: { display_name: "Dr. Kavita Joshi", email: "kavita.joshi@example.com" },
    plan: { key: "trial", name: "Trial" },
  };

  const memberships: FakeMembership[] = [
    { id: id(), user_id: users.anika.id, clinic_id: smile.id, role: ROLES.owner },
    { id: id(), user_id: users.anika.id, clinic_id: hasya.id, role: ROLES.doctor },
    { id: id(), user_id: users.farhan.id, clinic_id: smile.id, role: ROLES.doctor },
    { id: id(), user_id: users.sunita.id, clinic_id: smile.id, role: ROLES.frontDesk },
    { id: id(), user_id: users.ravi.id, clinic_id: smile.id, role: ROLES.assistant },
    { id: id(), user_id: users.vivek.id, clinic_id: smile.id, role: ROLES.consultant },
  ];

  const smilePatients = makePatients(random, smile, 48, now, 1001, 10_000);
  const hasyaPatients = makePatients(random, hasya, 12, now, 2001, 20_000);

  const practitioners = {
    anika: { id: id(), display_name: users.anika.display_name },
    farhan: { id: id(), display_name: users.farhan.display_name },
    vivek: { id: id(), display_name: users.vivek.display_name },
    kavita: { id: id(), display_name: "Dr. Kavita Joshi" },
  };

  const schedule: FakeScheduleEntry[] = [
    ...makeSchedule(random, smile, smilePatients, now, [
      { at: "09:00", who: practitioners.anika, room: "Chair 1" },
      { at: "09:30", who: practitioners.farhan, room: "Chair 2", outcome: "no_show" },
      { at: "10:00", who: practitioners.anika, room: "Chair 1" },
      { at: "10:30", who: practitioners.farhan, room: "Chair 2" },
      { at: "11:00", who: practitioners.anika, room: "Chair 1" },
      { at: "11:30", who: practitioners.farhan, room: "Chair 2" },
      { at: "12:00", who: practitioners.anika, room: "Chair 1" },
      { at: "12:30", who: practitioners.farhan, room: "Chair 2", outcome: "cancelled" },
      { at: "14:00", who: practitioners.anika, room: "Chair 1" },
      { at: "14:30", who: practitioners.farhan, room: "Chair 2" },
      { at: "15:00", who: practitioners.anika, room: "Chair 1" },
      { at: "16:00", who: practitioners.vivek, room: "Chair 2", reason: "Braces review" },
      { at: "16:30", who: practitioners.vivek, room: "Chair 2", reason: "Aligner check" },
      { at: "17:00", who: practitioners.farhan, room: "Chair 1" },
      { at: "17:30", who: practitioners.anika, room: "Chair 1" },
    ]),
    ...makeSchedule(random, hasya, hasyaPatients, now, [
      { at: "10:00", who: practitioners.kavita, room: "Chair 1" },
      { at: "11:00", who: practitioners.anika, room: "Chair 1" },
      { at: "12:00", who: practitioners.kavita, room: "Chair 1" },
      { at: "17:00", who: practitioners.anika, room: "Chair 1" },
      { at: "18:00", who: practitioners.kavita, room: "Chair 1" },
      { at: "18:30", who: practitioners.anika, room: "Chair 1" },
    ]),
  ];

  const days: FakeClinicDay[] = [
    {
      clinic_id: smile.id,
      money: { collected_paise: 2_850_000, pending_dues_paise: 6_400_000, pending_dues_patients: 5 },
      attention: [
        { kind: "follow_up", count: 3 },
        { kind: "treatment_plan", count: 2 },
        { kind: "dues", count: 5, amount_paise: 6_400_000 },
        { kind: "stock", count: 4 },
        { kind: "lab", count: 1 },
      ],
    },
    {
      clinic_id: hasya.id,
      money: { collected_paise: 640_000, pending_dues_paise: 1_250_000, pending_dues_patients: 2 },
      attention: [
        { kind: "follow_up", count: 1 },
        { kind: "dues", count: 2, amount_paise: 1_250_000 },
      ],
    },
  ];

  const platformUsers: FakePlatformUser[] = [
    {
      id: "0199a000-0000-7000-8000-0000000000a1",
      display_name: "Aarav Kulkarni",
      email: "aarav@sakalya.example",
      role: "admin",
      description: "Sakalya admin: creates clinics and watches service health.",
    },
    {
      id: "0199a000-0000-7000-8000-0000000000a2",
      display_name: "Isha Nair",
      email: "isha@sakalya.example",
      role: "support",
      description: "Sakalya support: looks after clinics day to day.",
    },
  ];

  return {
    users: Object.values(users),
    platformUsers,
    clinics: [smile, hasya, ...makeConsoleOnlyClinics(random, now)],
    memberships,
    patients: [...smilePatients, ...hasyaPatients],
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
  const rows: readonly [string, string, C.ClinicStatus, number, string][] = [
    ["Dantashree Dental Clinic", "dantashree", "active", 45, "Dr. Rohini Kale"],
    ["Pearl Smile Dental", "pearlsmile", "active", 38, "Dr. Sameer Naik"],
    ["Sparsh Dental Care", "sparsh", "trial", 9, "Dr. Neha Deshmukh"],
    ["Kshitij Dental Studio", "kshitij", "suspended", 60, "Dr. Aditya Thakur"],
    ["Navi Smile Dental", "navismile", "churned", 120, "Dr. Imran Khan"],
    ["Ujjwal Dental Care", "ujjwal", "trial", 2, "Dr. Pallavi Sawant"],
  ];
  return rows.map(([name, slug, status, daysAgo, owner]) => {
    const createdAt = new Date(now.getTime() - daysAgo * DAY - random.int(0, 600) * 60_000);
    const first = owner.split(" ")[1] ?? "owner";
    return {
      id: fakeUuid(random, createdAt),
      slug,
      name,
      host: `${slug}.localtest.me:8080`,
      timezone: "Asia/Kolkata",
      theme: { brand: "#14a89a", mode: "light" },
      specialty: "dental",
      status,
      created_at: createdAt.toISOString(),
      number_prefix: slug.slice(0, 2).toUpperCase(),
      domains: [
        {
          hostname: `${slug}.aarogyam.example`,
          kind: "portal",
          is_primary: true,
          verified_at: createdAt.toISOString(),
        },
      ],
      owner: { display_name: owner, email: `${first.toLowerCase()}@example.com` },
      plan: status === "trial" ? { key: "trial", name: "Trial" } : { key: "clinic", name: "Clinic" },
    };
  });
}
