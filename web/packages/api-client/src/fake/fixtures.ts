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
import { atLocalTime, localClock } from "./zoned-time.js";

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

export interface FakeAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
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
  /** The main branch's address, for `GET /settings/clinic`. */
  address?: FakeAddress;
  /** The main branch's phone. */
  phone?: string | null;
  /** UPI ID shown on bills. */
  upi_id?: string | null;
  legal_name?: string | null;
  gstin?: string | null;
  prescription_footer?: string | null;
}

/** A device or browser where a person is signed in, for `GET /me/sessions`. */
export interface FakeSession {
  id: string;
  user_id: string;
  audience: "clinic" | "patient" | "platform";
  created_at: string;
  last_active_at: string;
  expires_at: string;
  revoked: boolean;
}

export interface FakeMembership {
  id: string;
  user_id: string;
  clinic_id: string;
  role: FakeRole;
  /** Defaults to `"active"` when left out. */
  status?: "invited" | "active" | "suspended" | "left";
  joined_at?: string;
}

export interface FakePatient extends Omit<C.Patient, "sex" | "status" | "age_years"> {
  clinic_id: string;
  sex: C.Sex;
  status: "active" | "inactive" | "deceased" | "merged";
}

/** A chair, room or lab. Fixtures model one branch per clinic, so `branch_id` is the clinic's id. */
export interface FakeRoom {
  id: string;
  clinic_id: string;
  branch_id: string;
  name: string;
  kind: C.RoomKind;
  active: boolean;
  sort_order: number;
}

/** A doctor who sees patients, separate from the `FakeUser`/membership that signs them in. */
export interface FakePractitioner {
  id: string;
  clinic_id: string;
  display_name: string;
  calendar_color: string;
  active: boolean;
  membership_id?: string | null;
  registration_number?: string | null;
  specialty?: string | null;
}

/** One stretch of a doctor's week, local time. */
export interface FakeWorkingShift {
  id: string;
  clinic_id: string;
  practitioner_id: string;
  branch_id: string;
  /** 1 Monday to 7 Sunday. */
  weekday: number;
  starts: string;
  ends: string;
}

export interface FakeLeave {
  id: string;
  clinic_id: string;
  practitioner_id: string;
  starts_at: string;
  ends_at: string;
  reason?: string | null;
}

/** A booked appointment. Status, arrival and completion are worked out once when fixtures build. */
export interface FakeAppointment {
  id: string;
  clinic_id: string;
  branch_id: string;
  patient_id: string;
  practitioner_id: string;
  room_id?: string | null;
  starts_at: string;
  ends_at: string;
  status: C.AppointmentStatus;
  kind: C.AppointmentKind;
  source: C.AppointmentSource;
  reason?: string | null;
  notes?: string | null;
  cancel_reason?: string | null;
  arrived_at?: string | null;
  seated_at?: string | null;
  completed_at?: string | null;
  token_number?: number | null;
}

/** A waiting-room token, issued when a patient (booked or walk-in) arrives. */
export interface FakeQueueToken {
  id: string;
  clinic_id: string;
  branch_id: string;
  day: string;
  token_number: number;
  patient_id: string;
  practitioner_id?: string | null;
  appointment_id?: string | null;
  status: C.QueueTokenStatus;
  issued_at: string;
  called_at?: string | null;
  done_at?: string | null;
}

export interface Fixtures {
  users: FakeUser[];
  platformUsers: FakePlatformUser[];
  clinics: FakeClinic[];
  memberships: FakeMembership[];
  patients: FakePatient[];
  rooms: FakeRoom[];
  practitioners: FakePractitioner[];
  workingShifts: FakeWorkingShift[];
  leave: FakeLeave[];
  appointments: FakeAppointment[];
  queueTokens: FakeQueueToken[];
  sessions: FakeSession[];
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
    permissions: [
      "patients.read",
      "patients.write",
      "patients.contact",
      "appointments.read",
      "appointments.write",
      "billing.read",
      "finance.view",
      "settings.manage",
      "staff.manage",
    ],
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
    legal_name: "Sunrise Dental Care LLP",
    gstin: "27AAAPL1234C1Z5",
    phone: "+912226581234",
    upi_id: "sunrisedental@okicici",
    address: { line1: "12 Church Road", line2: "Near Bandra Station", city: "Mumbai", state: "Maharashtra", pincode: "400050" },
    prescription_footer: "Sunrise Dental · Open Mon–Sat, 9 AM–7 PM",
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

  const sunriseOwnerMembership = { id: id(), user_id: users.asha.id, clinic_id: sunrise.id, role: ROLES.owner };
  const sunriseDoctorMembership = { id: id(), user_id: users.dev.id, clinic_id: sunrise.id, role: ROLES.doctor };
  const lotusOwnerMembership = { id: id(), user_id: users.bina.id, clinic_id: lotus.id, role: ROLES.owner };

  const memberships: FakeMembership[] = [
    sunriseOwnerMembership,
    sunriseDoctorMembership,
    { id: id(), user_id: users.dev.id, clinic_id: lotus.id, role: ROLES.consultant },
    { id: id(), user_id: users.farah.id, clinic_id: sunrise.id, role: ROLES.frontDesk },
    lotusOwnerMembership,
  ];

  const sunrisePatients = makePatients(random, sunrise, 48, now, 1, 10_000);
  const lotusPatients = makePatients(random, lotus, 12, now, 1, 20_000);

  const sunriseChair1 = makeRoom(random, now, sunrise, "Chair 1", 0);
  const sunriseChair2 = makeRoom(random, now, sunrise, "Chair 2", 1);
  const lotusChair1 = makeRoom(random, now, lotus, "Chair 1", 0);
  const sunriseRooms = [sunriseChair1, sunriseChair2];
  const lotusRooms = [lotusChair1];

  // Asha also sees a few patients at Lotus as a guest dentist, with no membership there.
  const sunriseAsha: FakePractitioner = {
    id: id(),
    clinic_id: sunrise.id,
    display_name: users.asha.display_name,
    calendar_color: "#136650",
    active: true,
    membership_id: sunriseOwnerMembership.id,
    specialty: "Prosthodontics",
  };
  const sunriseDev: FakePractitioner = {
    id: id(),
    clinic_id: sunrise.id,
    display_name: users.dev.display_name,
    calendar_color: "#2563eb",
    active: true,
    membership_id: sunriseDoctorMembership.id,
    specialty: "Orthodontics",
  };
  const lotusBina: FakePractitioner = {
    id: id(),
    clinic_id: lotus.id,
    display_name: users.bina.display_name,
    calendar_color: "#db2777",
    active: true,
    membership_id: lotusOwnerMembership.id,
    specialty: "General dentistry",
  };
  const lotusAsha: FakePractitioner = {
    id: id(),
    clinic_id: lotus.id,
    display_name: users.asha.display_name,
    calendar_color: "#136650",
    active: true,
    membership_id: null,
    specialty: "Prosthodontics",
  };
  const practitioners: FakePractitioner[] = [sunriseAsha, sunriseDev, lotusBina, lotusAsha];

  const workingShifts: FakeWorkingShift[] = [
    ...makeWeeklyShifts(random, now, sunrise, sunriseAsha, "09:00", "18:00"),
    ...makeWeeklyShifts(random, now, sunrise, sunriseDev, "09:00", "18:00"),
    ...makeWeeklyShifts(random, now, lotus, lotusBina, "10:00", "19:00"),
    ...makeWeeklyShifts(random, now, lotus, lotusAsha, "11:00", "13:00"),
  ];

  const leave: FakeLeave[] = [
    {
      id: id(),
      clinic_id: sunrise.id,
      practitioner_id: sunriseDev.id,
      starts_at: isoDaysAhead(now, 10),
      ends_at: isoDaysAhead(now, 12),
      reason: "Conference",
    },
  ];

  const { appointments: sunriseAppointments, queueTokens: sunriseQueueTokens } = makeClinicDay(random, sunrise, sunrisePatients, now, [
    { at: "09:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "09:30", who: sunriseDev, room: sunriseChair2, outcome: "no_show" },
    { at: "10:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "10:30", who: sunriseDev, room: sunriseChair2 },
    { at: "11:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "11:30", who: sunriseDev, room: sunriseChair2 },
    { at: "12:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "12:30", who: sunriseDev, room: sunriseChair2, outcome: "cancelled" },
    { at: "14:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "14:30", who: sunriseDev, room: sunriseChair2 },
    { at: "15:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "16:00", who: sunriseDev, room: sunriseChair2, reason: "Braces review" },
    { at: "16:30", who: sunriseDev, room: sunriseChair2, reason: "Aligner check" },
    { at: "17:00", who: sunriseDev, room: sunriseChair1 },
    { at: "17:30", who: sunriseAsha, room: sunriseChair1 },
  ]);
  const { appointments: lotusAppointments, queueTokens: lotusQueueTokens } = makeClinicDay(random, lotus, lotusPatients, now, [
    { at: "10:00", who: lotusBina, room: lotusChair1 },
    { at: "11:00", who: lotusAsha, room: lotusChair1 },
    { at: "12:00", who: lotusBina, room: lotusChair1 },
    { at: "17:00", who: lotusBina, room: lotusChair1 },
    { at: "18:00", who: lotusBina, room: lotusChair1 },
    { at: "18:30", who: lotusBina, room: lotusChair1 },
  ]);

  const rooms = [...sunriseRooms, ...lotusRooms];
  const appointments = [...sunriseAppointments, ...lotusAppointments];
  const queueTokens = [...sunriseQueueTokens, ...lotusQueueTokens];

  const platformUsers: FakePlatformUser[] = [
    {
      id: "c1c1c1c1-0000-4000-8000-000000000001",
      display_name: "Sakalya Admin",
      email: "admin@sakalya.example",
      role: "owner",
      description: "Sakalya platform owner: clinics, service health and quality.",
    },
  ];

  const sessions: FakeSession[] = Object.values(users).flatMap((user): FakeSession[] => [
    {
      id: id(),
      user_id: user.id,
      audience: "clinic",
      created_at: isoDaysAgo(now, 3),
      last_active_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 7 * DAY).toISOString(),
      revoked: false,
    },
    {
      id: id(),
      user_id: user.id,
      audience: "clinic",
      created_at: isoDaysAgo(now, 20),
      last_active_at: isoDaysAgo(now, 9),
      expires_at: isoDaysAgo(now, -1),
      revoked: false,
    },
  ]);

  return {
    users: Object.values(users),
    platformUsers,
    clinics: [sunrise, lotus, ...makeConsoleOnlyClinics(random, now)],
    memberships,
    patients: [...sunrisePatients, ...lotusPatients],
    rooms,
    practitioners,
    workingShifts,
    leave,
    appointments,
    queueTokens,
    sessions,
    quality: createQualityReport(random, now),
  };
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY).toISOString();
}

function isoDaysAhead(now: Date, days: number): string {
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

function makeRoom(random: Random, now: Date, clinic: FakeClinic, name: string, sortOrder: number): FakeRoom {
  return {
    id: fakeUuid(random, new Date(now.getTime() - (10 - sortOrder) * DAY)),
    clinic_id: clinic.id,
    branch_id: clinic.id,
    name,
    kind: "chair",
    active: true,
    sort_order: sortOrder,
  };
}

function makeWeeklyShifts(
  random: Random,
  now: Date,
  clinic: FakeClinic,
  practitioner: FakePractitioner,
  starts: string,
  ends: string,
): FakeWorkingShift[] {
  return [1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: fakeUuid(random, new Date(now.getTime() - weekday * DAY)),
    clinic_id: clinic.id,
    practitioner_id: practitioner.id,
    branch_id: clinic.id,
    weekday,
    starts,
    ends,
  }));
}

interface SlotPlan {
  at: string;
  who: FakePractitioner;
  room: FakeRoom;
  reason?: string;
  outcome?: "cancelled" | "no_show";
}

/**
 * Builds one clinic day's appointments, with status, arrival and completion worked out once
 * relative to `now`, plus the queue tokens for whoever has arrived (numbered by arrival order).
 */
function makeClinicDay(
  random: Random,
  clinic: FakeClinic,
  patients: readonly FakePatient[],
  now: Date,
  plan: readonly SlotPlan[],
): { appointments: FakeAppointment[]; queueTokens: FakeQueueToken[] } {
  const pool = patients.filter((p) => p.status === "active");
  const { date, minutes: rawClockMinutes } = localClock(now, clinic.timezone);
  const slots = plan.map((slot, index) => {
    const [hours = 9, mins = 0] = slot.at.split(":").map((part) => Number.parseInt(part, 10));
    return { ...slot, index, startMinutes: hours * 60 + mins };
  });
  const first = slots[0]?.startMinutes ?? 540;
  const last = slots.at(-1)?.startMinutes ?? 1080;
  const clockMinutes = Math.min(Math.max(rawClockMinutes, first + 40), last + 20);
  const at = (local: number) => atLocalTime(date, local, clinic.timezone).toISOString();

  let inChair = false;
  let waiting = 0;
  const appointments: FakeAppointment[] = [];
  const arrivals: { appointment: FakeAppointment; arrivedAt: string; seatedAt: string | null; doneAt: string | null }[] = [];

  for (const slot of slots) {
    const reason = slot.reason ?? random.pick(DENTAL_REASONS);
    const patient = pool[(slot.index * 3) % pool.length] ?? random.pick(pool);
    const endMinutes = slot.startMinutes + 30;
    const kind: C.AppointmentKind =
      reason === "Consultation" ? "new" : reason.includes("sitting 2") || reason.includes("review") ? "follow_up" : "procedure";

    let status: C.AppointmentStatus;
    let arrivedAt: number | null = null;
    let seatedAt: number | null = null;
    let completedAt: number | null = null;
    if (slot.outcome === "cancelled") {
      status = "cancelled";
    } else if (endMinutes <= clockMinutes) {
      status = slot.outcome === "no_show" ? "no_show" : "completed";
      if (status === "completed") {
        arrivedAt = slot.startMinutes - 6;
        seatedAt = slot.startMinutes - 3;
        completedAt = endMinutes;
      }
    } else if (!inChair && slot.startMinutes <= clockMinutes) {
      status = "in_chair";
      arrivedAt = slot.startMinutes - 9;
      seatedAt = slot.startMinutes - 2;
      inChair = true;
    } else if (waiting < 2) {
      status = "arrived";
      arrivedAt = clockMinutes - (waiting === 0 ? 12 : 5);
      waiting += 1;
    } else {
      status = slot.index % 3 === 0 ? "booked" : "confirmed";
    }

    const appointment: FakeAppointment = {
      id: fakeUuid(random, new Date(now.getTime() - random.int(1, 20) * DAY)),
      clinic_id: clinic.id,
      branch_id: clinic.id,
      patient_id: patient.id,
      practitioner_id: slot.who.id,
      room_id: slot.room.id,
      starts_at: at(slot.startMinutes),
      ends_at: at(endMinutes),
      status,
      kind,
      source: "front_desk",
      reason,
      arrived_at: arrivedAt === null ? null : at(arrivedAt),
      seated_at: seatedAt === null ? null : at(seatedAt),
      completed_at: completedAt === null ? null : at(completedAt),
      cancel_reason: status === "cancelled" ? "Patient requested" : null,
      token_number: null,
    };
    appointments.push(appointment);
    if (arrivedAt !== null) {
      arrivals.push({
        appointment,
        arrivedAt: at(arrivedAt),
        seatedAt: seatedAt === null ? null : at(seatedAt),
        doneAt: completedAt === null ? null : at(completedAt),
      });
    }
  }

  arrivals.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));
  const queueTokens: FakeQueueToken[] = arrivals.map((entry, index) => {
    const tokenNumber = index + 1;
    entry.appointment.token_number = tokenNumber;
    const tokenStatus: C.QueueTokenStatus =
      entry.appointment.status === "completed" ? "done" : entry.appointment.status === "in_chair" ? "in_chair" : "waiting";
    return {
      id: fakeUuid(random, new Date(entry.arrivedAt)),
      clinic_id: clinic.id,
      branch_id: clinic.id,
      day: date,
      token_number: tokenNumber,
      patient_id: entry.appointment.patient_id,
      practitioner_id: entry.appointment.practitioner_id,
      appointment_id: entry.appointment.id,
      status: tokenStatus,
      issued_at: entry.arrivedAt,
      called_at: entry.seatedAt,
      done_at: entry.doneAt,
    };
  });

  return { appointments, queueTokens };
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
