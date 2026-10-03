/**
 * An in-memory stand-in for the API that behaves like it: it checks the token, resolves the
 * clinic from the host, checks membership and permissions, validates input with field errors,
 * and serves responses through the same decoders as the real client.
 */

import type { z } from "zod";

import type { ApiClient, PatientQuery, PatientRef, RequestOptions } from "../client.js";
import type * as C from "../contract.js";
import type { TokenSource } from "../http-client.js";
import { hasPermission, type Permission } from "../permissions.js";
import { failure, success, type ApiError, type ApiResult } from "../result.js";
import * as S from "../schemas.js";
import type { FakeClinic, FakeMembership, FakePatient, FakePlatformUser, FakeUser, Fixtures } from "./fixtures.js";
import { createMetrics } from "./metrics.js";
import { createRandom, fakeUuid } from "./random.js";
import { atLocalTime, localClock } from "./zoned-time.js";

const TOKEN_PREFIX = "fake:";

/** The bearer token the fake accepts for a fixture user. */
export function fakeTokenFor(userId: string): string {
  return `${TOKEN_PREFIX}${userId}`;
}

export interface FakeClientOptions {
  /** The clinic host this client talks to, such as `smilecatchers.localtest.me:8080`. */
  host?: string;
  getToken?: TokenSource;
  /** Simulated network delay in milliseconds. Defaults to 0. */
  latencyMs?: number;
  /** The clock. Defaults to the real time. */
  now?: () => Date;
}

export interface FakeBackend {
  /** A client bound to one host; every client of a backend shares its data. */
  client(options?: FakeClientOptions): ApiClient;
  /** Fixture clinic staff to sign in as, for the portal's dev sign-in screen. */
  users(): readonly FakeUser[];
  /** Fixture Sakalya team members, for the console's dev sign-in screen. */
  platformUsers(): readonly FakePlatformUser[];
}

type Problem = Omit<ApiError, "requestId">;
type Outcome = { ok: true; body: unknown } | { ok: false; problem: Problem };

/** A success body; call sites add `satisfies` with the contract type. */
const reply = (body: unknown): Outcome => ({ ok: true, body });
const refuse = (status: number, code: string, message: string, field?: string): Outcome => ({
  ok: false,
  problem: field === undefined ? { status, code, message } : { status, code, message, field },
});
const invalid = (field: string, message: string): Outcome => refuse(422, "validation_failed", message, field);

const RESERVED_SLUGS = new Set(["www", "api", "app", "admin", "console", "status", "mail", "help", "support", "docs", "static", "assets"]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates a fake API over a private copy of `fixtures`. */
export function createFakeBackend(fixtures: Fixtures): FakeBackend {
  const state = structuredClone(fixtures);
  const random = createRandom(7);

  function client(options: FakeClientOptions = {}): ApiClient {
    const clock = options.now ?? (() => new Date());
    const latency = options.latencyMs ?? 0;
    const getToken = options.getToken ?? (() => null);

    async function respond<T>(schema: z.ZodType<T>, signal: AbortSignal | undefined, handle: () => Promise<Outcome> | Outcome): Promise<ApiResult<T>> {
      if (!(await pause(latency, signal))) {
        return failure({ status: 0, code: "aborted", message: "The request was cancelled." });
      }
      const outcome = await handle();
      if (!outcome.ok) {
        return failure({ ...outcome.problem, requestId: S.requestId.parse(fakeUuid(random, clock())) });
      }
      // A JSON round trip, as on the wire, then the real decoder.
      const wire: unknown = JSON.parse(JSON.stringify(outcome.body));
      const decoded = schema.safeParse(wire);
      return decoded.success
        ? success(decoded.data)
        : failure({ status: 200, code: "invalid_response", message: "The fake API served a body its own decoder rejects." });
    }

    async function tokenSubject(): Promise<string | undefined> {
      const token = await getToken();
      return token?.startsWith(TOKEN_PREFIX) === true ? token.slice(TOKEN_PREFIX.length) : undefined;
    }

    const signedOut = refuse(401, "unauthenticated", "Your session has ended. Please sign in again.");

    async function signedIn(): Promise<FakeUser | Outcome> {
      const subject = await tokenSubject();
      return state.users.find((u) => u.id === subject) ?? signedOut;
    }

    /** Console calls: only Sakalya team members. */
    async function inConsole(handle: () => Outcome): Promise<Outcome> {
      const subject = await tokenSubject();
      if (state.platformUsers.some((u) => u.id === subject)) {
        return handle();
      }
      return state.users.some((u) => u.id === subject) ? refuse(403, "forbidden", "You don't have permission to do that.") : signedOut;
    }

    interface ClinicCaller {
      user: FakeUser;
      clinic: FakeClinic;
      membership: FakeMembership;
    }

    async function inClinic(permission?: Permission): Promise<ClinicCaller | Outcome> {
      const user = await signedIn();
      if (!("display_name" in user)) {
        return user;
      }
      const clinic = state.clinics.find((c) => c.host === options.host);
      if (clinic === undefined) {
        return refuse(404, "clinic_not_found", "There is no clinic at this address.");
      }
      const membership = state.memberships.find((m) => m.user_id === user.id && m.clinic_id === clinic.id);
      if (membership === undefined) {
        return refuse(403, "not_a_member", "You are not a member of this clinic.");
      }
      if (permission !== undefined && !hasPermission(membership.role.permissions, permission)) {
        return refuse(403, "forbidden", "You don't have permission to do that.");
      }
      return { user, clinic, membership };
    }

    const isCaller = (value: ClinicCaller | Outcome): value is ClinicCaller => "clinic" in value;

    return {
      getMe: (opts) =>
        respond(S.meResponse, opts?.signal, async () => {
          const user = await signedIn();
          if (!("display_name" in user)) {
            return user;
          }
          const clinics = state.memberships
            .filter((m) => m.user_id === user.id)
            .flatMap((m): C.ClinicAccess[] => {
              const clinic = state.clinics.find((c) => c.id === m.clinic_id);
              return clinic === undefined
                ? []
                : [{ org_id: clinic.id, slug: clinic.slug, name: clinic.name, role_key: m.role.key, role_name: m.role.name, host: clinic.host }];
            });
          return reply({ user: wireUser(user), clinics } satisfies C.MeResponse);
        }),

      getSession: (opts) =>
        respond(S.sessionResponse, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          const { clinic, membership, user } = caller;
          return reply({
            clinic: { id: clinic.id, slug: clinic.slug, name: clinic.name, timezone: clinic.timezone, theme: clinic.theme },
            membership: {
              id: membership.id,
              role_key: membership.role.key,
              role_name: membership.role.name,
              permissions: [...membership.role.permissions],
            },
            user: wireUser(user),
          } satisfies C.SessionResponse);
        }),

      listPatients: (query: PatientQuery, opts?: RequestOptions) =>
        respond(S.patientListResponse, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const offset = query.cursor === undefined ? 0 : Number(query.cursor);
          if (!Number.isInteger(offset) || offset < 0) {
            return refuse(400, "invalid_cursor", "That page of results has expired. Search again.");
          }
          const limit = Math.min(100, Math.max(1, query.limit ?? 20));
          const now = clock();
          const found = searchPatients(
            state.patients.filter((p) => p.clinic_id === caller.clinic.id && p.status !== "merged"),
            query.q ?? "",
          );
          const page = found.slice(offset, offset + limit);
          return reply({
            items: page.map((p) => ({
              id: p.id,
              number: p.number,
              full_name: p.full_name,
              sex: p.sex,
              age_years: ageYears(p.date_of_birth, now),
              phone_masked: maskPhone(p.phone),
              last_visit_at: p.last_visit_at ?? null,
            })),
            next_cursor: offset + limit < found.length ? String(offset + limit) : null,
          } satisfies C.PatientListResponse);
        }),

      getPatient: (ref: PatientRef, opts?: RequestOptions) =>
        respond(S.patient, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.patients.find((p) => p.clinic_id === caller.clinic.id && (p.id === ref || p.number === ref));
          // Another clinic's patient is "not found", never "forbidden".
          return found === undefined ? refuse(404, "patient_not_found", "We couldn't find that patient.") : reply(found satisfies C.Patient);
        }),

      createPatient: (input, opts) =>
        respond(S.patient, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const now = clock();
          const problem = validateNewPatient(input, now);
          if (problem !== null) {
            return problem;
          }
          const clinicPatients = state.patients.filter((p) => p.clinic_id === caller.clinic.id);
          const next = 1 + Math.max(1000, ...clinicPatients.map((p) => Number(p.number.split("-")[1] ?? 0)));
          const estimated = input.date_of_birth === undefined && input.age_years !== undefined;
          const record: FakePatient = {
            clinic_id: caller.clinic.id,
            id: fakeUuid(random, now),
            number: `${caller.clinic.number_prefix}-${String(next)}`,
            full_name: input.full_name.trim().replace(/\s+/g, " "),
            sex: input.sex,
            date_of_birth: input.date_of_birth ?? (estimated ? `${String(now.getUTCFullYear() - (input.age_years ?? 0))}-01-01` : null),
            birth_date_estimated: estimated,
            phone: input.phone ?? null,
            email: input.email ?? null,
            preferred_language: input.preferred_language ?? "en-IN",
            status: "active",
            created_at: now.toISOString(),
            last_visit_at: null,
          };
          state.patients.push(record);
          return reply(record satisfies C.Patient);
        }),

      getToday: (opts) =>
        respond(S.todayResponse, opts?.signal, async () => {
          const caller = await inClinic("appointments.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const withMoney = hasPermission(caller.membership.role.permissions, "finance.view");
          return reply(buildToday(state, caller.clinic, clock(), withMoney) satisfies C.TodayResponse);
        }),

      listClinics: (opts) =>
        respond(S.consoleClinicListResponse, opts?.signal, () =>
          inConsole(() => reply({
            items: [...state.clinics]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((c) => ({ id: c.id, slug: c.slug, name: c.name, specialty: c.specialty, status: c.status, created_at: c.created_at })),
            next_cursor: null,
          } satisfies C.ConsoleClinicListResponse)),
        ),

      getClinic: (id, opts) =>
        respond(S.consoleClinicDetail, opts?.signal, () =>
          inConsole(() => {
            const clinic = state.clinics.find((c) => c.id === id);
            return clinic === undefined ? refuse(404, "clinic_not_found", "We couldn't find that clinic.") : reply(wireClinicDetail(clinic) satisfies C.ConsoleClinicDetail);
          }),
        ),

      createClinic: (input, opts) =>
        respond(S.consoleClinicDetail, opts?.signal, () =>
          inConsole(() => {
          const problem = validateNewClinic(input, state.clinics);
          if (problem !== null) {
            return problem;
          }
          const now = clock();
          const clinic: FakeClinic = {
            id: fakeUuid(random, now),
            slug: input.slug,
            name: input.name.trim(),
            host: `${input.slug}.localtest.me:8080`,
            timezone: input.timezone ?? "Asia/Kolkata",
            theme: { brand: "#14a89a", mode: "light" },
            specialty: input.specialty,
            status: "trial",
            created_at: now.toISOString(),
            number_prefix: input.slug.slice(0, 2).toUpperCase(),
            domains: [{ hostname: `${input.slug}.aarogyam.example`, kind: "portal", is_primary: true, verified_at: now.toISOString() }],
            owner: {
              display_name: input.owner.display_name.trim(),
              ...(input.owner.email === undefined ? {} : { email: input.owner.email }),
              ...(input.owner.phone === undefined ? {} : { phone: input.owner.phone }),
            },
            plan: { key: "trial", name: "Trial" },
          };
          state.clinics.push(clinic);
          return reply(wireClinicDetail(clinic) satisfies C.ConsoleClinicDetail);
          }),
        ),

      getMetrics: (query, opts) =>
        respond(S.metricsResponse, opts?.signal, () =>
          inConsole(() => reply(createMetrics(query.range, query.environment ?? "production", clock()) satisfies C.MetricsResponse)),
        ),

      getQualityReport: (opts) =>
        respond(S.qualityReport, opts?.signal, () => inConsole(() => reply(state.quality satisfies C.QualityReport))),
    };
  }

  return { client, users: () => state.users, platformUsers: () => state.platformUsers };
}

/** A fake client over its own copy of `fixtures`. Use `createFakeBackend` to share data between hosts. */
export function createFakeClient(fixtures: Fixtures, options: FakeClientOptions = {}): ApiClient {
  return createFakeBackend(fixtures).client(options);
}

/** Waits `ms`, resolving `false` if the request is cancelled first. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) {
    return Promise.resolve(false);
  }
  if (ms <= 0) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(true);
    }, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve(false);
      },
      { once: true },
    );
  });
}

function wireUser(user: FakeUser): C.User {
  return { id: user.id, display_name: user.display_name, email: user.email ?? null, phone_masked: maskPhone(user.phone) };
}

function wireClinicDetail(clinic: FakeClinic): C.ConsoleClinicDetail {
  return {
    id: clinic.id,
    slug: clinic.slug,
    name: clinic.name,
    specialty: clinic.specialty,
    status: clinic.status,
    created_at: clinic.created_at,
    timezone: clinic.timezone,
    domains: clinic.domains,
    owner: { display_name: clinic.owner.display_name, email: clinic.owner.email ?? null, phone_masked: maskPhone(clinic.owner.phone) },
    plan: clinic.plan ?? null,
  };
}

/** `+91 ••••• •3210`, as the API masks phone numbers in lists. */
function maskPhone(phone: string | null | undefined): string | null {
  if (phone == null || phone.length < 8) {
    return null;
  }
  const last4 = phone.slice(-4);
  return phone.startsWith("+91") ? `+91 ••••• •${last4}` : `${phone.slice(0, 3)} •••• ${last4}`;
}

function ageYears(dateOfBirth: string | null | undefined, now: Date): number | null {
  if (dateOfBirth == null) {
    return null;
  }
  const [year = 0, month = 1, day = 1] = dateOfBirth.split("-").map((part) => Number.parseInt(part, 10));
  const hadBirthday = now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  return Math.max(0, now.getUTCFullYear() - year - (hadBirthday ? 0 : 1));
}

/** Name (word prefixes, any order), clinic number, or at least four digits of the phone. */
function searchPatients(patients: readonly FakePatient[], q: string): FakePatient[] {
  const query = q.trim().toLowerCase();
  const recent = (a: FakePatient, b: FakePatient) =>
    (b.last_visit_at ?? "").localeCompare(a.last_visit_at ?? "") || b.created_at.localeCompare(a.created_at);
  if (query === "") {
    return [...patients].sort(recent);
  }
  const tokens = query.split(/\s+/);
  const digits = query.replace(/\D/g, "");
  const score = (p: FakePatient): number => {
    const number = p.number.toLowerCase();
    if (number === query || number.endsWith(`-${query}`)) return 4;
    const words = p.full_name.toLowerCase().split(/\s+/);
    if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 3;
    if (digits.length >= 4 && digits === query.replace(/[\s+-]/g, "") && (p.phone ?? "").replace(/\D/g, "").includes(digits)) return 2;
    if (p.full_name.toLowerCase().includes(query) || number.includes(query)) return 1;
    return 0;
  };
  return patients
    .map((p) => ({ p, s: score(p) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || recent(a.p, b.p))
    .map(({ p }) => p);
}

function validateNewPatient(input: C.CreatePatientRequest, now: Date): Outcome | null {
  const name = input.full_name.trim();
  if (name.length < 2 || name.length > 120) {
    return invalid("full_name", "Enter the patient's full name.");
  }
  if (!S.sex.safeParse(input.sex).success) {
    return invalid("sex", "Choose an option.");
  }
  if (input.date_of_birth !== undefined && input.age_years !== undefined) {
    return invalid("date_of_birth", "Give a date of birth or an age, not both.");
  }
  if (input.date_of_birth !== undefined) {
    const dob = new Date(`${input.date_of_birth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime()) || dob > now || dob.getUTCFullYear() < now.getUTCFullYear() - 130) {
      return invalid("date_of_birth", "Enter a real date of birth, not in the future.");
    }
  }
  if (input.age_years !== undefined && (!Number.isInteger(input.age_years) || input.age_years < 0 || input.age_years > 130)) {
    return invalid("age_years", "Enter an age between 0 and 130.");
  }
  if (input.phone !== undefined && !(E164.test(input.phone) && (!input.phone.startsWith("+91") || INDIAN_MOBILE.test(input.phone)))) {
    return invalid("phone", "Enter a valid mobile number.");
  }
  if (input.email !== undefined && !EMAIL.test(input.email)) {
    return invalid("email", "Enter a valid email address.");
  }
  return null;
}

function validateNewClinic(input: C.CreateClinicRequest, clinics: readonly FakeClinic[]): Outcome | null {
  if (input.name.trim().length < 2) {
    return invalid("name", "Enter the clinic's name.");
  }
  if (!SLUG.test(input.slug) || input.slug.includes("--")) {
    return invalid("slug", "Use 3 to 30 lowercase letters, digits or single hyphens.");
  }
  if (RESERVED_SLUGS.has(input.slug)) {
    return invalid("slug", "That address is reserved.");
  }
  if (clinics.some((c) => c.slug === input.slug)) {
    return refuse(409, "slug_taken", "That address is already taken.", "slug");
  }
  if (input.owner.display_name.trim().length < 2) {
    return invalid("owner.display_name", "Enter the owner's name.");
  }
  if (input.owner.email === undefined && input.owner.phone === undefined) {
    return invalid("owner.email", "Give the owner's email or mobile number.");
  }
  if (input.owner.email !== undefined && !EMAIL.test(input.owner.email)) {
    return invalid("owner.email", "Enter a valid email address.");
  }
  if (input.owner.phone !== undefined && !E164.test(input.owner.phone)) {
    return invalid("owner.phone", "Enter a valid mobile number.");
  }
  if (input.timezone !== undefined && !isTimeZone(input.timezone)) {
    return invalid("timezone", "Choose a time zone from the list.");
  }
  return null;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Today's schedule with statuses worked out from the clock, held inside clinic hours so the page
 * always has someone in the chair, people waiting and people to come.
 */
function buildToday(state: Fixtures, clinic: FakeClinic, now: Date, withMoney: boolean): C.TodayResponse {
  const entries = state.schedule.filter((e) => e.clinic_id === clinic.id).sort((a, b) => a.start_minutes - b.start_minutes);
  const { date, minutes } = localClock(now, clinic.timezone);
  const first = entries[0]?.start_minutes ?? 540;
  const last = entries.at(-1)?.start_minutes ?? 1080;
  const clockMinutes = Math.min(Math.max(minutes, first + 40), last + 20);
  const at = (local: number) => atLocalTime(date, local, clinic.timezone).toISOString();
  let inChair = false;
  let waiting = 0;

  const appointments = entries.flatMap((entry, index): C.TodayAppointment[] => {
    const patient = state.patients.find((p) => p.id === entry.patient_id);
    if (patient === undefined) {
      return [];
    }
    const end = entry.start_minutes + entry.duration_minutes;
    let status: C.AppointmentStatus;
    let arrived: number | null = null;
    if (entry.outcome === "cancelled") {
      status = "cancelled";
    } else if (end <= clockMinutes) {
      status = entry.outcome === "no_show" ? "no_show" : "completed";
      arrived = status === "completed" ? entry.start_minutes - 6 : null;
    } else if (!inChair && entry.start_minutes <= clockMinutes) {
      status = "in_progress";
      arrived = entry.start_minutes - 9;
      inChair = true;
    } else if (waiting < 2) {
      status = "arrived";
      arrived = clockMinutes - (waiting === 0 ? 12 : 5);
      waiting += 1;
    } else {
      status = index % 3 === 0 ? "scheduled" : "confirmed";
    }
    return [
      {
        id: entry.id,
        starts_at: at(entry.start_minutes),
        ends_at: at(end),
        status,
        kind: entry.kind,
        reason: entry.reason,
        room: entry.room,
        arrived_at: arrived === null ? null : at(arrived),
        patient: {
          id: patient.id,
          number: patient.number,
          full_name: patient.full_name,
          sex: patient.sex,
          age_years: ageYears(patient.date_of_birth, now),
        },
        practitioner: entry.practitioner,
      },
    ];
  });

  const day = state.days.find((d) => d.clinic_id === clinic.id);
  return {
    date,
    as_of: at(clockMinutes),
    appointments,
    money: withMoney ? (day?.money ?? null) : null,
    attention: withMoney ? (day?.attention ?? []) : (day?.attention ?? []).filter((a) => a.kind !== "dues"),
  };
}
