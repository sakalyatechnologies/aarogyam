/**
 * An in-memory stand-in for the API that behaves like it: it checks the token, resolves the
 * clinic from the host, checks membership and permissions, masks contact details without
 * `patients.contact`, answers input errors as `field: message`, and serves responses through
 * the same decoders as the real client.
 */

import type { z } from "zod";

import type { ApiClient } from "../client.js";
import type * as C from "../contract.js";
import type { TokenSource } from "../http-client.js";
import { hasPermission, type Permission } from "../permissions.js";
import { failure, parseApiError, success, type ApiResult } from "../result.js";
import * as S from "../schemas.js";
import { ROLES, type FakeClinic, type FakeMembership, type FakePatient, type FakePlatformUser, type FakeUser, type Fixtures } from "./fixtures.js";
import { createMetrics } from "./metrics.js";
import { createRandom, fakeUuid } from "./random.js";
import { atLocalTime, localClock } from "./zoned-time.js";

const TOKEN_PREFIX = "fake:";

/** The bearer token the fake accepts for a person; a new person's verified email rides along. */
export function fakeTokenFor(person: { id: string; email?: string | undefined }): string {
  return `${TOKEN_PREFIX}${person.id}${person.email === undefined ? "" : `|${person.email}`}`;
}

export interface FakeClientOptions {
  /** The clinic host this client talks to, such as `sunrise.localtest.me`. */
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
  /** Fixture clinic staff, for the portal's dev sign-in screen. */
  users(): readonly FakeUser[];
  /** Fixture Sakalya team members, for the console's dev sign-in screen. */
  platformUsers(): readonly FakePlatformUser[];
}

type Outcome = { ok: true; body: unknown } | { ok: false; status: number; body: C.ErrorBody };

/** A success body; call sites add `satisfies` with the contract type. */
const reply = (body: unknown): Outcome => ({ ok: true, body });
const refuse = (status: number, code: string, message: string): Outcome => ({ ok: false, status, body: { error: { code, message } } });
/** Input errors as the API sends them: the field, a colon, then what is wrong. */
const invalid = (field: string, problem: string): Outcome => refuse(400, "invalid_request", `${field}: ${problem}`);
const notFound = refuse(404, "not_found", "Not found.");
const OWNER = ROLES.owner;

const RESERVED_SLUGS = new Set(["www", "api", "app", "admin", "console", "status", "mail", "help", "support", "docs", "static", "assets", "test"]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates a fake API over a private copy of `fixtures`. */
export function createFakeBackend(fixtures: Fixtures): FakeBackend {
  const state = structuredClone(fixtures);
  const random = createRandom(7);
  /** Invitations made by createClinic, by token. */
  const invitations = new Map<string, { clinicId: string; email: string; used: boolean }>();

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
        return failure(parseApiError(outcome.status, outcome.body, S.requestId.parse(fakeUuid(random, clock()))));
      }
      // A JSON round trip, as on the wire, then the real decoder.
      const wire: unknown = JSON.parse(JSON.stringify(outcome.body));
      const decoded = schema.safeParse(wire);
      return decoded.success
        ? success(decoded.data)
        : failure({ status: 200, code: "invalid_response", message: "The fake API served a body its own decoder rejects." });
    }

    async function claims(): Promise<{ id: string; email: string | undefined } | undefined> {
      const token = await getToken();
      if (token?.startsWith(TOKEN_PREFIX) !== true) {
        return undefined;
      }
      const [id = "", email] = token.slice(TOKEN_PREFIX.length).split("|");
      return { id, email };
    }

    async function subject(): Promise<string | undefined> {
      return (await claims())?.id;
    }

    const signedOut = refuse(401, "unauthenticated", "sign in to continue");

    interface Caller {
      user: FakeUser;
      clinic: FakeClinic;
      membership: FakeMembership;
    }

    async function inClinic(permission?: Permission): Promise<Caller | Outcome> {
      const id = await subject();
      const user = state.users.find((u) => u.id === id);
      if (user === undefined) {
        return signedOut;
      }
      const clinic = state.clinics.find((c) => c.host === options.host);
      const membership = state.memberships.find((m) => m.user_id === user.id && m.clinic_id === clinic?.id);
      // Not a member looks exactly like no such clinic.
      if (clinic === undefined || membership === undefined) {
        return notFound;
      }
      if (permission !== undefined && !hasPermission(membership.role.permissions, permission)) {
        return refuse(403, "forbidden", "You don't have permission to do that.");
      }
      return { user, clinic, membership };
    }

    const isCaller = (value: Caller | Outcome): value is Caller => "clinic" in value;

    async function inConsole(handle: () => Outcome): Promise<Outcome> {
      const id = await subject();
      if (state.platformUsers.some((u) => u.id === id)) {
        return handle();
      }
      return state.users.some((u) => u.id === id) ? refuse(403, "forbidden", "Sakalya staff only.") : signedOut;
    }

    const wirePatient = (p: FakePatient, caller: Caller): C.Patient => {
      const contact = hasPermission(caller.membership.role.permissions, "patients.contact");
      return {
        id: p.id,
        number: p.number,
        full_name: p.full_name,
        sex: p.sex,
        date_of_birth: p.date_of_birth ?? null,
        birth_date_estimated: p.birth_date_estimated,
        age_years: ageYears(p.date_of_birth, clock()),
        phone: p.phone == null ? null : contact ? p.phone : maskPhone(p.phone),
        email: p.email == null ? null : contact ? p.email : maskEmail(p.email),
        preferred_language: p.preferred_language,
        status: p.status,
        created_at: p.created_at,
        last_visit_at: p.last_visit_at ?? null,
      };
    };

    const clinicPatients = (caller: Caller) => state.patients.filter((p) => p.clinic_id === caller.clinic.id && p.status !== "merged");

    return {
      getMe: (opts) =>
        respond(S.meResponse, opts?.signal, async () => {
          const id = await subject();
          const user = state.users.find((u) => u.id === id) ?? state.platformUsers.find((u) => u.id === id);
          if (user === undefined) {
            return signedOut;
          }
          const clinics = state.memberships
            .filter((m) => m.user_id === user.id)
            .flatMap((m): C.MyClinic[] => {
              const clinic = state.clinics.find((c) => c.id === m.clinic_id);
              return clinic === undefined
                ? []
                : [{ org_id: clinic.id, slug: clinic.slug, name: clinic.name, role_key: m.role.key, role_name: m.role.name, host: clinic.host }];
            });
          return reply({ clinics } satisfies C.Me);
        }),

      acceptInvitation: (input, opts) =>
        respond(S.joined, opts?.signal, async () => {
          const who = await claims();
          if (who === undefined) {
            return signedOut;
          }
          const invitation = invitations.get(input.token);
          if (invitation === undefined || invitation.used) {
            return notFound;
          }
          const known = state.users.find((u) => u.id === who.id);
          const email = who.email ?? known?.email;
          if (email?.toLowerCase() !== invitation.email.toLowerCase()) {
            return refuse(409, "conflict", "this invitation is for a different email");
          }
          if (known === undefined) {
            state.users.push({ id: who.id, display_name: input.display_name ?? email, email, description: "Joined by invitation." });
          }
          invitation.used = true;
          const membership: FakeMembership = { id: fakeUuid(random, clock()), user_id: who.id, clinic_id: invitation.clinicId, role: OWNER };
          state.memberships.push(membership);
          return reply({ org_id: invitation.clinicId, membership_id: membership.id } satisfies C.Joined);
        }),

      getSession: (opts) =>
        respond(S.sessionResponse, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          const { clinic, membership, user } = caller;
          return reply({
            clinic: { id: clinic.id, slug: clinic.slug, name: clinic.name, timezone: clinic.timezone, branding: clinic.branding },
            membership: { id: membership.id, role_key: membership.role.key, permissions: [...membership.role.permissions] },
            user: { id: user.id, display_name: user.display_name },
          } satisfies C.Session);
        }),

      listPatients: (opts) =>
        respond(S.patientList, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = searchPatients(clinicPatients(caller), "").slice(0, 50);
          return reply({ items: items.map((p) => wirePatient(p, caller)) } satisfies C.PatientList);
        }),

      searchPatients: (search, opts) =>
        respond(S.patientList, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const limit = Math.min(100, Math.max(1, search.limit ?? 20));
          const items = searchPatients(clinicPatients(caller), search.q).slice(0, limit);
          return reply({ items: items.map((p) => wirePatient(p, caller)) } satisfies C.PatientList);
        }),

      getPatient: (id, opts) =>
        respond(S.patient, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          // Another clinic's patient is "not found", never "forbidden".
          const found = clinicPatients(caller).find((p) => p.id === id);
          return found === undefined ? notFound : reply(wirePatient(found, caller) satisfies C.Patient);
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
          const numbers = state.patients.filter((p) => p.clinic_id === caller.clinic.id).map((p) => Number(p.number.split("-")[1] ?? 0));
          const estimated = input.date_of_birth == null && input.age_years != null;
          const record: FakePatient = {
            clinic_id: caller.clinic.id,
            id: fakeUuid(random, now),
            number: `${caller.clinic.number_prefix}-${String(1 + Math.max(0, ...numbers))}`,
            full_name: input.full_name.trim().replace(/\s+/g, " "),
            sex: S.sex.catch("unknown").parse(input.sex),
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
          return reply(wirePatient(record, caller) satisfies C.Patient);
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
        respond(S.consoleClinics, opts?.signal, () =>
          inConsole(() =>
            reply({
              items: [...state.clinics]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((c) => ({
                  id: c.id,
                  slug: c.slug,
                  name: c.name,
                  specialty: c.specialty,
                  status: c.status,
                  created_at: c.created_at,
                  portal_host: c.host,
                  active_members: state.memberships.filter((m) => m.clinic_id === c.id).length,
                  patients: state.patients.filter((p) => p.clinic_id === c.id).length,
                })),
            } satisfies C.ConsoleClinics),
          ),
        ),

      createClinic: (input, opts) =>
        respond(S.createdClinic, opts?.signal, () =>
          inConsole(() => {
            const slug = input.slug ?? deriveSlug(input.name);
            const problem = validateNewClinic(input, slug, state.clinics);
            if (problem !== null) {
              return problem;
            }
            const now = clock();
            const clinic: FakeClinic = {
              id: fakeUuid(random, now),
              slug,
              name: input.name.trim(),
              host: `${slug}.localtest.me`,
              timezone: "Asia/Kolkata",
              branding: { brand: "#14a89a", mode: "light" },
              specialty: input.specialty ?? "dental",
              status: "trial",
              created_at: now.toISOString(),
              number_prefix: slug.slice(0, 2).toUpperCase(),
            };
            state.clinics.push(clinic);
            const inviteToken = random.hex(32);
            invitations.set(inviteToken, { clinicId: clinic.id, email: input.owner_email, used: false });
            return reply({
              id: clinic.id,
              slug,
              portal_host: clinic.host,
              invitation_id: fakeUuid(random, now),
              invite_token: inviteToken,
              invite_expires_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
            } satisfies C.CreatedClinic);
          }),
        ),

      getMetrics: (range, opts) =>
        respond(S.metricsResponse, opts?.signal, () => inConsole(() => reply(createMetrics(range, clock()) satisfies C.ServiceMetrics))),

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

/** `+91 ••••• •3210`, as the API masks phones for members without `patients.contact`. */
function maskPhone(phone: string): string {
  return phone.startsWith("+91") ? `+91 ••••• •${phone.slice(-4)}` : `•••• ${phone.slice(-4)}`;
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? "•••" : `${email.charAt(0)}•••${email.slice(at)}`;
}

function ageYears(dateOfBirth: string | null | undefined, now: Date): number | null {
  if (dateOfBirth == null) {
    return null;
  }
  const [year = 0, month = 1, day = 1] = dateOfBirth.split("-").map((part) => Number.parseInt(part, 10));
  const hadBirthday = now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  return Math.max(0, now.getUTCFullYear() - year - (hadBirthday ? 0 : 1));
}

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
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

function validateNewPatient(input: C.NewPatient, now: Date): Outcome | null {
  const name = input.full_name.trim();
  if (name.length < 1 || name.length > 200) {
    return invalid("full_name", "full_name must be 1 to 200 characters of text");
  }
  if (input.sex != null && !S.sex.safeParse(input.sex).success) {
    return invalid("sex", "must be female, male, other or unknown");
  }
  if (input.date_of_birth != null && input.age_years != null) {
    return invalid("date_of_birth", "give a date of birth or an age, not both");
  }
  if (input.date_of_birth != null) {
    const dob = new Date(`${input.date_of_birth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime()) || dob > now || dob.getUTCFullYear() < now.getUTCFullYear() - 130) {
      return invalid("date_of_birth", "must be a real date, not in the future");
    }
  }
  if (input.age_years != null && (!Number.isInteger(input.age_years) || input.age_years < 0 || input.age_years > 130)) {
    return invalid("age_years", "must be between 0 and 130");
  }
  if (input.phone != null && !(E164.test(input.phone) && (!input.phone.startsWith("+91") || INDIAN_MOBILE.test(input.phone)))) {
    return invalid("phone", "invalid phone number");
  }
  if (input.email != null && !EMAIL.test(input.email)) {
    return invalid("email", "invalid email address");
  }
  return null;
}

function validateNewClinic(input: C.NewClinic, slug: string, clinics: readonly FakeClinic[]): Outcome | null {
  if (input.name.trim().length < 2) {
    return invalid("name", "must be 2 to 80 characters");
  }
  if (!SLUG.test(slug) || slug.includes("--")) {
    return invalid("slug", "use 3 to 30 lowercase letters, digits or single hyphens");
  }
  if (RESERVED_SLUGS.has(slug)) {
    return invalid("slug", "is reserved");
  }
  if (clinics.some((c) => c.slug === slug)) {
    return refuse(409, "conflict", "that subdomain is taken");
  }
  if (!EMAIL.test(input.owner_email)) {
    return invalid("owner_email", "invalid email address");
  }
  return null;
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
        patient: { id: patient.id, number: patient.number, full_name: patient.full_name, sex: patient.sex, age_years: ageYears(patient.date_of_birth, now) },
        practitioner: entry.practitioner,
      },
    ];
  });

  const day = state.days.find((d) => d.clinic_id === clinic.id);
  return { date, as_of: at(clockMinutes), appointments, money: withMoney ? (day?.money ?? null) : null };
}
