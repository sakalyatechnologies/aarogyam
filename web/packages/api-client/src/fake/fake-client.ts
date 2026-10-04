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
import {
  ROLES,
  type FakeAppointment,
  type FakeClinic,
  type FakeLeave,
  type FakeMembership,
  type FakePatient,
  type FakePlatformUser,
  type FakePractitioner,
  type FakeQueueToken,
  type FakeRole,
  type FakeRoom,
  type FakeUser,
  type Fixtures,
} from "./fixtures.js";
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

  interface Invitation {
    id: string;
    clinicId: string;
    email: string;
    /** `"owner"` for a clinic-creation invite; a role key for a staff invite. */
    roleKey: string;
    createdAt: string;
    expiresAt: string;
    used: boolean;
  }
  /** Invitations made by createClinic or inviteStaff, by token. */
  const invitations = new Map<string, Invitation>();

  function roleByKey(key: string): FakeRole | undefined {
    return Object.values(ROLES).find((candidate) => candidate.key === key);
  }

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
      // A JSON round trip, as on the wire, then the real decoder. `undefined` (a 204) has no
      // wire form to round-trip: `JSON.stringify` would produce the un-parseable text "undefined".
      const wire: unknown = outcome.body === undefined ? undefined : JSON.parse(JSON.stringify(outcome.body));
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
          const membership: FakeMembership = {
            id: fakeUuid(random, clock()),
            user_id: who.id,
            clinic_id: invitation.clinicId,
            role: roleByKey(invitation.roleKey) ?? OWNER,
            status: "active",
            joined_at: clock().toISOString(),
          };
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
          return reply(buildToday(state, caller.clinic, clock()) satisfies C.TodayResponse);
        }),

      updatePatient: (id, changes, opts) =>
        respond(S.patient, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = clinicPatients(caller).find((p) => p.id === id);
          if (found === undefined) {
            return notFound;
          }
          const touchesContact = changes.phone !== undefined || changes.email !== undefined;
          if (touchesContact && !hasPermission(caller.membership.role.permissions, "patients.contact")) {
            return refuse(403, "forbidden", "You don't have permission to do that.");
          }
          const problem = validatePatientChanges(changes, clock());
          if (problem !== null) {
            return problem;
          }
          if (changes.full_name != null) found.full_name = changes.full_name.trim().replace(/\s+/g, " ");
          if (changes.sex != null) found.sex = S.sex.catch(found.sex).parse(changes.sex);
          if (changes.date_of_birth !== undefined) {
            found.date_of_birth = changes.date_of_birth === "" ? null : changes.date_of_birth;
            found.birth_date_estimated = false;
          } else if (changes.age_years != null) {
            found.date_of_birth = `${String(clock().getUTCFullYear() - changes.age_years)}-01-01`;
            found.birth_date_estimated = true;
          }
          if (changes.phone !== undefined) found.phone = changes.phone === "" ? null : changes.phone;
          if (changes.email !== undefined) found.email = changes.email === "" ? null : changes.email;
          if (changes.preferred_language != null) found.preferred_language = changes.preferred_language;
          return reply(wirePatient(found, caller) satisfies C.Patient);
        }),

      listRooms: (opts) =>
        respond(S.roomList, opts?.signal, async () => {
          const caller = await inClinic("appointments.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = state.rooms
            .filter((r) => r.clinic_id === caller.clinic.id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(wireRoom);
          return reply({ items } satisfies C.RoomList);
        }),

      addRoom: (input, opts) =>
        respond(S.room, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const name = (input.name ?? "").trim();
          if (name.length < 1 || name.length > 60) {
            return invalid("name", "must be 1 to 60 characters");
          }
          const kindParsed = S.roomKind.safeParse(input.kind ?? "chair");
          if (!kindParsed.success) {
            return invalid("kind", "must be chair, room or lab");
          }
          const sortOrder = input.sort_order ?? state.rooms.filter((r) => r.clinic_id === caller.clinic.id).length;
          const record: FakeRoom = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            branch_id: input.branch_id ?? caller.clinic.id,
            name,
            kind: kindParsed.data,
            active: input.active ?? true,
            sort_order: sortOrder,
          };
          state.rooms.push(record);
          return reply(wireRoom(record) satisfies C.Room);
        }),

      changeRoom: (id, changes, opts) =>
        respond(S.room, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.rooms.find((r) => r.id === id && r.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (changes.name != null) {
            const name = changes.name.trim();
            if (name.length < 1 || name.length > 60) {
              return invalid("name", "must be 1 to 60 characters");
            }
            found.name = name;
          }
          if (changes.kind != null) {
            const kindParsed = S.roomKind.safeParse(changes.kind);
            if (!kindParsed.success) {
              return invalid("kind", "must be chair, room or lab");
            }
            found.kind = kindParsed.data;
          }
          if (changes.active != null) found.active = changes.active;
          if (changes.sort_order != null) found.sort_order = changes.sort_order;
          return reply(wireRoom(found) satisfies C.Room);
        }),

      removeRoom: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.rooms.find((r) => r.id === id && r.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          const now = clock().toISOString();
          const hasUpcoming = state.appointments.some(
            (a) => a.room_id === id && a.ends_at > now && a.status !== "cancelled" && a.status !== "no_show",
          );
          if (hasUpcoming) {
            return refuse(409, "conflict", "This chair has upcoming appointments.");
          }
          state.rooms = state.rooms.filter((r) => r.id !== id);
          return { ok: true, body: undefined };
        }),

      listPractitioners: (opts) =>
        respond(S.practitionerList, opts?.signal, async () => {
          const caller = await inClinic("appointments.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = state.practitioners
            .filter((p) => p.clinic_id === caller.clinic.id)
            .sort((a, b) => a.display_name.localeCompare(b.display_name))
            .map(wirePractitioner);
          return reply({ items } satisfies C.PractitionerList);
        }),

      addPractitioner: (input, opts) =>
        respond(S.practitioner, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const name = (input.display_name ?? "").trim();
          if (name.length < 1 || name.length > 120) {
            return invalid("display_name", "must be 1 to 120 characters");
          }
          if (input.calendar_color != null && !HEX_COLOR.test(input.calendar_color)) {
            return invalid("calendar_color", "must be a #RRGGBB colour");
          }
          const record: FakePractitioner = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            display_name: name,
            calendar_color: input.calendar_color ?? "#64748b",
            active: input.active ?? true,
            membership_id: input.membership_id ?? null,
            registration_number: input.registration_number ?? null,
            specialty: input.specialty ?? null,
          };
          state.practitioners.push(record);
          return reply(wirePractitioner(record) satisfies C.Practitioner);
        }),

      changePractitioner: (id, changes, opts) =>
        respond(S.practitioner, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.practitioners.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (changes.display_name != null) {
            const name = changes.display_name.trim();
            if (name.length < 1 || name.length > 120) {
              return invalid("display_name", "must be 1 to 120 characters");
            }
            found.display_name = name;
          }
          if (changes.calendar_color != null) {
            if (!HEX_COLOR.test(changes.calendar_color)) {
              return invalid("calendar_color", "must be a #RRGGBB colour");
            }
            found.calendar_color = changes.calendar_color;
          }
          if (changes.active != null) found.active = changes.active;
          if (changes.membership_id !== undefined) found.membership_id = changes.membership_id === "" ? null : changes.membership_id;
          if (changes.registration_number !== undefined) {
            found.registration_number = changes.registration_number === "" ? null : changes.registration_number;
          }
          if (changes.specialty !== undefined) found.specialty = changes.specialty === "" ? null : changes.specialty;
          return reply(wirePractitioner(found) satisfies C.Practitioner);
        }),

      removePractitioner: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.practitioners.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          const now = clock().toISOString();
          const hasUpcoming = state.appointments.some(
            (a) => a.practitioner_id === id && a.ends_at > now && a.status !== "cancelled" && a.status !== "no_show",
          );
          if (hasUpcoming) {
            return refuse(409, "conflict", "This doctor has upcoming appointments.");
          }
          state.practitioners = state.practitioners.filter((p) => p.id !== id);
          state.workingShifts = state.workingShifts.filter((s) => s.practitioner_id !== id);
          return { ok: true, body: undefined };
        }),

      getWorkingHours: (id, opts) =>
        respond(S.workingHours, opts?.signal, async () => {
          const caller = await inClinic("appointments.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.practitioners.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          return reply({ shifts: wireShifts(state, id) } satisfies C.WorkingHours);
        }),

      setWorkingHours: (id, hours, opts) =>
        respond(S.workingHours, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.practitioners.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          for (const shift of hours.shifts) {
            if (!Number.isInteger(shift.weekday) || shift.weekday < 1 || shift.weekday > 7) {
              return invalid("shifts", "weekday must be 1 to 7");
            }
            if (shift.starts >= shift.ends) {
              return invalid("shifts", "end must be after the start");
            }
          }
          state.workingShifts = state.workingShifts.filter((s) => s.practitioner_id !== id);
          const now = clock();
          for (const shift of hours.shifts) {
            state.workingShifts.push({
              id: fakeUuid(random, now),
              clinic_id: caller.clinic.id,
              practitioner_id: id,
              branch_id: shift.branch_id ?? caller.clinic.id,
              weekday: shift.weekday,
              starts: shift.starts,
              ends: shift.ends,
            });
          }
          return reply({ shifts: wireShifts(state, id) } satisfies C.WorkingHours);
        }),

      listLeave: (range, opts) =>
        respond(S.leaveList, opts?.signal, async () => {
          const caller = await inClinic("appointments.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const fromIso = atLocalTime(range.from, 0, caller.clinic.timezone).toISOString();
          const toIso = atLocalTime(range.to, 1440, caller.clinic.timezone).toISOString();
          const items = state.leave
            .filter((l) => l.clinic_id === caller.clinic.id && l.starts_at < toIso && l.ends_at > fromIso)
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
            .map(wireLeave);
          return reply({ items } satisfies C.LeaveList);
        }),

      addLeave: (input, opts) =>
        respond(S.leave, opts?.signal, async () => {
          const caller = await inClinic("appointments.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const practitioner = state.practitioners.find((p) => p.id === input.practitioner_id && p.clinic_id === caller.clinic.id);
          if (practitioner === undefined) {
            return invalid("practitioner_id", "unknown doctor");
          }
          if (Date.parse(input.ends_at) <= Date.parse(input.starts_at)) {
            return invalid("ends_at", "must be after the start");
          }
          const record: FakeLeave = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            practitioner_id: input.practitioner_id,
            starts_at: input.starts_at,
            ends_at: input.ends_at,
            reason: input.reason ?? null,
          };
          state.leave.push(record);
          return reply(wireLeave(record) satisfies C.Leave);
        }),

      removeLeave: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("appointments.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.leave.find((l) => l.id === id && l.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          state.leave = state.leave.filter((l) => l.id !== id);
          return { ok: true, body: undefined };
        }),

      listAppointments: (filter, opts) =>
        respond(S.appointmentList, opts?.signal, async () => {
          const caller = await inClinic("appointments.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const fromIso = atLocalTime(filter.from, 0, caller.clinic.timezone).toISOString();
          const toIso = atLocalTime(filter.to, 1440, caller.clinic.timezone).toISOString();
          const now = clock();
          const items = state.appointments
            .filter((a) => a.clinic_id === caller.clinic.id && a.starts_at >= fromIso && a.starts_at < toIso)
            .filter((a) => filter.roomId === undefined || a.room_id === filter.roomId)
            .filter((a) => filter.practitionerId === undefined || a.practitioner_id === filter.practitionerId)
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
            .flatMap((a) => {
              const wired = wireAppointment(a, state, now);
              return wired === undefined ? [] : [wired];
            });
          return reply({ items } satisfies C.AppointmentList);
        }),

      bookAppointment: (input, opts) =>
        respond(S.savedAppointment, opts?.signal, async () => {
          const caller = await inClinic("appointments.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === input.patient_id)) {
            return invalid("patient_id", "unknown patient");
          }
          const practitioner = state.practitioners.find((p) => p.id === input.practitioner_id && p.clinic_id === caller.clinic.id);
          if (practitioner === undefined) {
            return invalid("practitioner_id", "unknown doctor");
          }
          const startsAt = input.starts_at;
          const endsAt = input.ends_at;
          if (Date.parse(endsAt) <= Date.parse(startsAt)) {
            return invalid("ends_at", "must be after the start");
          }
          const durationMinutes = (Date.parse(endsAt) - Date.parse(startsAt)) / 60_000;
          if (durationMinutes < 5 || durationMinutes > 720) {
            return invalid("ends_at", "must be 5 minutes to 12 hours after the start");
          }
          let roomId: string | null = null;
          if (input.room_id != null && input.room_id !== "") {
            const roomRecord = state.rooms.find((r) => r.id === input.room_id && r.clinic_id === caller.clinic.id);
            if (roomRecord === undefined) {
              return invalid("room_id", "unknown chair or room");
            }
            const overlap = state.appointments.some(
              (a) =>
                a.clinic_id === caller.clinic.id &&
                a.room_id === input.room_id &&
                a.status !== "cancelled" &&
                a.status !== "no_show" &&
                overlaps(a.starts_at, a.ends_at, startsAt, endsAt),
            );
            if (overlap) {
              return refuse(409, "conflict", "That chair is already booked then.");
            }
            roomId = input.room_id;
          }
          const warnings = bookingWarnings(state, caller.clinic, input.practitioner_id, startsAt, endsAt, undefined);
          const record: FakeAppointment = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            branch_id: input.branch_id ?? caller.clinic.id,
            patient_id: input.patient_id,
            practitioner_id: input.practitioner_id,
            room_id: roomId,
            starts_at: startsAt,
            ends_at: endsAt,
            status: "booked",
            kind: S.appointmentKind.catch("follow_up").parse(input.kind ?? "follow_up"),
            source: S.appointmentSource.catch("front_desk").parse(input.source ?? "front_desk"),
            reason: input.reason ?? null,
            notes: input.notes ?? null,
            cancel_reason: null,
            arrived_at: null,
            seated_at: null,
            completed_at: null,
            token_number: null,
          };
          state.appointments.push(record);
          const wired = wireAppointment(record, state, clock());
          if (wired === undefined) {
            return notFound;
          }
          return reply({ appointment: wired, warnings } satisfies C.SavedAppointment);
        }),

      changeAppointment: (id, changes, opts) =>
        respond(S.savedAppointment, opts?.signal, async () => {
          const caller = await inClinic("appointments.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.appointments.find((a) => a.id === id && a.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status === "completed" || found.status === "cancelled" || found.status === "no_show") {
            return refuse(409, "conflict", "That appointment can't be changed any more.");
          }
          const nextStart = changes.starts_at ?? found.starts_at;
          const nextEnd =
            changes.ends_at ??
            (changes.starts_at != null
              ? new Date(Date.parse(changes.starts_at) + (Date.parse(found.ends_at) - Date.parse(found.starts_at))).toISOString()
              : found.ends_at);
          if (Date.parse(nextEnd) <= Date.parse(nextStart)) {
            return invalid("ends_at", "must be after the start");
          }
          const nextRoomId = changes.room_id === undefined ? found.room_id ?? null : changes.room_id === "" ? null : changes.room_id;
          const nextPractitionerId = changes.practitioner_id ?? found.practitioner_id;
          if (changes.practitioner_id != null) {
            const practitioner = state.practitioners.find((p) => p.id === changes.practitioner_id && p.clinic_id === caller.clinic.id);
            if (practitioner === undefined) {
              return invalid("practitioner_id", "unknown doctor");
            }
          }
          if (nextRoomId != null) {
            const roomRecord = state.rooms.find((r) => r.id === nextRoomId && r.clinic_id === caller.clinic.id);
            if (roomRecord === undefined) {
              return invalid("room_id", "unknown chair or room");
            }
            const overlap = state.appointments.some(
              (a) =>
                a.id !== id &&
                a.clinic_id === caller.clinic.id &&
                a.room_id === nextRoomId &&
                a.status !== "cancelled" &&
                a.status !== "no_show" &&
                overlaps(a.starts_at, a.ends_at, nextStart, nextEnd),
            );
            if (overlap) {
              return refuse(409, "conflict", "That chair is already booked then.");
            }
          }
          const warnings = bookingWarnings(state, caller.clinic, nextPractitionerId, nextStart, nextEnd, id);
          found.starts_at = nextStart;
          found.ends_at = nextEnd;
          found.room_id = nextRoomId;
          found.practitioner_id = nextPractitionerId;
          if (changes.kind != null) found.kind = S.appointmentKind.catch(found.kind).parse(changes.kind);
          if (changes.reason !== undefined) found.reason = changes.reason === "" ? null : changes.reason;
          if (changes.notes !== undefined) found.notes = changes.notes === "" ? null : changes.notes;
          const wired = wireAppointment(found, state, clock());
          if (wired === undefined) {
            return notFound;
          }
          return reply({ appointment: wired, warnings } satisfies C.SavedAppointment);
        }),

      setAppointmentStatus: (id, change, opts) =>
        respond(S.statusChanged, opts?.signal, async () => {
          const caller = await inClinic("appointments.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.appointments.find((a) => a.id === id && a.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          const parsedStatus = S.appointmentStatus.safeParse(change.status);
          if (!parsedStatus.success) {
            return invalid("status", "unknown status");
          }
          const target = parsedStatus.data;
          if (found.status === "completed" || found.status === "cancelled" || found.status === "no_show") {
            return refuse(409, "conflict", "That appointment is already finished.");
          }
          if (target === "cancelled" && (change.reason ?? "").trim() === "") {
            return invalid("reason", "a reason is required to cancel");
          }
          if (target === "no_show" && found.status !== "booked" && found.status !== "confirmed") {
            return refuse(409, "conflict", "Only a booked appointment can be marked no-show.");
          }
          if (target !== "cancelled" && target !== "no_show") {
            const currentIndex = APPOINTMENT_ORDER.indexOf(found.status);
            const targetIndex = APPOINTMENT_ORDER.indexOf(target);
            if (targetIndex <= currentIndex) {
              return refuse(409, "conflict", "That status doesn't come next.");
            }
          }
          const now = clock();
          let queueTokenId: string | null = null;
          found.status = target;
          if (target === "cancelled") {
            found.cancel_reason = change.reason ?? null;
          } else if (target === "arrived") {
            found.arrived_at = now.toISOString();
            const day = localClock(now, caller.clinic.timezone).date;
            const nextNumber =
              1 +
              Math.max(
                0,
                ...state.queueTokens
                  .filter((t) => t.clinic_id === caller.clinic.id && t.branch_id === found.branch_id && t.day === day)
                  .map((t) => t.token_number),
              );
            const token: FakeQueueToken = {
              id: fakeUuid(random, now),
              clinic_id: caller.clinic.id,
              branch_id: found.branch_id,
              day,
              token_number: nextNumber,
              patient_id: found.patient_id,
              practitioner_id: found.practitioner_id,
              appointment_id: found.id,
              status: "waiting",
              issued_at: now.toISOString(),
              called_at: null,
              done_at: null,
            };
            state.queueTokens.push(token);
            found.token_number = nextNumber;
            queueTokenId = token.id;
          } else if (target === "in_chair") {
            found.seated_at = now.toISOString();
            const token = state.queueTokens.find((t) => t.appointment_id === found.id);
            if (token !== undefined) {
              token.status = "in_chair";
              token.called_at = now.toISOString();
              queueTokenId = token.id;
            }
          } else if (target === "completed") {
            found.completed_at = now.toISOString();
            const token = state.queueTokens.find((t) => t.appointment_id === found.id);
            if (token !== undefined) {
              token.status = "done";
              token.done_at = now.toISOString();
              queueTokenId = token.id;
            }
          }
          const wired = wireAppointment(found, state, now);
          if (wired === undefined) {
            return notFound;
          }
          return reply({ appointment: wired, queue_token_id: queueTokenId } satisfies C.StatusChanged);
        }),

      listQueue: (dateValue, opts) =>
        respond(S.queueDay, opts?.signal, async () => {
          const caller = await inClinic("appointments.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const now = clock();
          const day = dateValue ?? localClock(now, caller.clinic.timezone).date;
          const items = state.queueTokens
            .filter((t) => t.clinic_id === caller.clinic.id && t.day === day)
            .sort((a, b) => a.token_number - b.token_number)
            .flatMap((t) => {
              const wired = wireQueueToken(t, state, now);
              return wired === undefined ? [] : [wired];
            });
          return reply({ date: day, items } satisfies C.QueueDay);
        }),

      addWalkIn: (input, opts) =>
        respond(S.queueToken, opts?.signal, async () => {
          const caller = await inClinic("appointments.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === input.patient_id)) {
            return invalid("patient_id", "unknown patient");
          }
          if (input.practitioner_id != null) {
            const practitioner = state.practitioners.find((p) => p.id === input.practitioner_id && p.clinic_id === caller.clinic.id);
            if (practitioner === undefined) {
              return invalid("practitioner_id", "unknown doctor");
            }
          }
          const now = clock();
          const branchId = input.branch_id ?? caller.clinic.id;
          const day = localClock(now, caller.clinic.timezone).date;
          const nextNumber =
            1 +
            Math.max(
              0,
              ...state.queueTokens
                .filter((t) => t.clinic_id === caller.clinic.id && t.branch_id === branchId && t.day === day)
                .map((t) => t.token_number),
            );
          const token: FakeQueueToken = {
            id: fakeUuid(random, now),
            clinic_id: caller.clinic.id,
            branch_id: branchId,
            day,
            token_number: nextNumber,
            patient_id: input.patient_id,
            practitioner_id: input.practitioner_id ?? null,
            appointment_id: null,
            status: "waiting",
            issued_at: now.toISOString(),
            called_at: null,
            done_at: null,
          };
          state.queueTokens.push(token);
          const wired = wireQueueToken(token, state, now);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.QueueToken);
        }),

      setQueueStatus: (id, change, opts) =>
        respond(S.queueToken, opts?.signal, async () => {
          const caller = await inClinic("appointments.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.queueTokens.find((t) => t.id === id && t.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          const parsed = S.queueTokenStatus.safeParse(change.status);
          if (!parsed.success || parsed.data === "waiting") {
            return invalid("status", "must be in_chair, done or left");
          }
          if (found.status === "done" || found.status === "left") {
            return refuse(409, "conflict", "That token is already finished.");
          }
          const now = clock();
          found.status = parsed.data;
          if (parsed.data === "in_chair") found.called_at = now.toISOString();
          if (parsed.data === "done" || parsed.data === "left") found.done_at = now.toISOString();
          if (found.appointment_id != null) {
            const appt = state.appointments.find((a) => a.id === found.appointment_id);
            if (appt !== undefined) {
              if (parsed.data === "in_chair" && appt.status === "arrived") {
                appt.status = "in_chair";
                appt.seated_at = now.toISOString();
              } else if (parsed.data === "done" && appt.status !== "completed") {
                appt.status = "completed";
                appt.completed_at = now.toISOString();
              }
            }
          }
          const wired = wireQueueToken(found, state, now);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.QueueToken);
        }),

      importPatients: (input, opts) =>
        respond(S.importResult, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const parsedMode = S.importMode.safeParse(input.mode);
          if (!parsedMode.success) {
            return invalid("mode", "must be preview or commit");
          }
          const rows = parseCsv(input.csv);
          if (rows.length < 2) {
            return invalid("csv", "no data rows found");
          }
          if (rows.length > 5001) {
            return invalid("csv", "at most 5,000 rows");
          }
          const header = rows[0] ?? [];
          const dataRows = rows.slice(1);
          const columnIndex = new Map<string, number>();
          for (const [field, column] of Object.entries(input.mapping)) {
            const index = header.findIndex((h) => h.trim().toLowerCase() === column.trim().toLowerCase());
            if (index >= 0) columnIndex.set(field, index);
          }
          const now = clock();
          const existingNumbers = state.patients.filter((p) => p.clinic_id === caller.clinic.id).map((p) => Number(p.number.split("-")[1] ?? 0));
          let nextNumber = 1 + Math.max(0, ...existingNumbers);
          const resultRows: C.ImportRow[] = [];
          for (const [rowIndex, cells] of dataRows.entries()) {
            const line = rowIndex + 2;
            const get = (field: string): string | undefined => {
              const index = columnIndex.get(field);
              const value = index === undefined ? undefined : cells[index];
              return value?.trim();
            };
            const fullName = get("full_name") ?? "";
            const errors: string[] = [];
            if (fullName.length < 1 || fullName.length > 200) {
              errors.push("full_name: must be 1 to 200 characters of text");
            }
            const sexRaw = get("sex");
            let sexValue: C.Sex = "unknown";
            if (sexRaw != null && sexRaw !== "") {
              const sexParsed = S.sex.safeParse(sexRaw.toLowerCase());
              if (sexParsed.success) {
                sexValue = sexParsed.data;
              } else {
                errors.push("sex: must be female, male, other or unknown");
              }
            }
            const phoneRaw = get("phone");
            const phone = phoneRaw == null || phoneRaw === "" ? null : phoneRaw.startsWith("+") ? phoneRaw : `+91${phoneRaw}`;
            if (phone != null && !(E164.test(phone) && (!phone.startsWith("+91") || INDIAN_MOBILE.test(phone)))) {
              errors.push("phone: invalid phone number");
            }
            const emailRaw = get("email");
            if (emailRaw != null && emailRaw !== "" && !EMAIL.test(emailRaw)) {
              errors.push("email: invalid email address");
            }
            const dobRaw = get("date_of_birth");
            const ageRaw = get("age_years");
            if (dobRaw != null && dobRaw !== "" && ageRaw != null && ageRaw !== "") {
              errors.push("date_of_birth: give a date of birth or an age, not both");
            }

            if (errors.length > 0) {
              resultRows.push({ line, valid: false, errors, patient_id: null, number: null });
              continue;
            }
            if (input.mode === "commit") {
              const number = `${caller.clinic.number_prefix}-${String(nextNumber)}`;
              nextNumber += 1;
              const record: FakePatient = {
                clinic_id: caller.clinic.id,
                id: fakeUuid(random, now),
                number,
                full_name: fullName.replace(/\s+/g, " "),
                sex: sexValue,
                date_of_birth: dobRaw ?? null,
                birth_date_estimated: (dobRaw == null || dobRaw === "") && ageRaw != null && ageRaw !== "",
                phone,
                email: emailRaw == null || emailRaw === "" ? null : emailRaw,
                preferred_language: get("preferred_language") ?? "en-IN",
                status: "active",
                created_at: now.toISOString(),
                last_visit_at: null,
              };
              state.patients.push(record);
              resultRows.push({ line, valid: true, errors: [], patient_id: record.id, number: record.number });
            } else {
              resultRows.push({ line, valid: true, errors: [], patient_id: null, number: null });
            }
          }
          const validCount = resultRows.filter((r) => r.valid).length;
          return reply({
            mode: input.mode,
            total: resultRows.length,
            valid: validCount,
            invalid: resultRows.length - validCount,
            import_id: input.mode === "commit" ? fakeUuid(random, now) : null,
            rows: resultRows,
          } satisfies C.ImportResult);
        }),

      listStaff: (opts) =>
        respond(S.staffResponse, opts?.signal, async () => {
          const caller = await inClinic("staff.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const members = state.memberships
            .filter((m) => m.clinic_id === caller.clinic.id)
            .map((m) => wireMember(m, state))
            .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.display_name.localeCompare(b.display_name));
          const pending = [...invitations.entries()]
            .filter(([, inv]) => inv.clinicId === caller.clinic.id && !inv.used && inv.expiresAt > clock().toISOString())
            .map(([, inv]): C.PendingInvitation => ({ id: inv.id, email: inv.email, role_key: inv.roleKey, created_at: inv.createdAt, expires_at: inv.expiresAt }))
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
          return reply({ members, invitations: pending } satisfies C.Staff);
        }),

      inviteStaff: (input, opts) =>
        respond(S.createdInvitation, opts?.signal, async () => {
          const caller = await inClinic("staff.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!EMAIL.test(input.email)) {
            return invalid("email", "invalid email address");
          }
          const role = roleByKey(input.role_key);
          if (role === undefined) {
            return invalid("role_key", "unknown role");
          }
          if (role.key === "owner" && caller.membership.role.key !== "owner") {
            return refuse(403, "forbidden", "Only an owner may invite an owner.");
          }
          const now = clock();
          const id = fakeUuid(random, now);
          const expiresAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
          const token = random.hex(32);
          invitations.set(token, { id, clinicId: caller.clinic.id, email: input.email, roleKey: role.key, createdAt: now.toISOString(), expiresAt, used: false });
          return reply({ id, email: input.email, role_key: role.key, expires_at: expiresAt, invite_token: token } satisfies C.CreatedInvitation);
        }),

      changeStaffMember: (membershipId, changes, opts) =>
        respond(S.member, opts?.signal, async () => {
          const caller = await inClinic("staff.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const target = state.memberships.find((m) => m.id === membershipId && m.clinic_id === caller.clinic.id);
          if (target === undefined) {
            return notFound;
          }
          if (target.id === caller.membership.id) {
            return refuse(409, "conflict", "You can't change your own membership.");
          }
          const nextRole = changes.role_key == null ? undefined : roleByKey(changes.role_key);
          if (changes.role_key != null && nextRole === undefined) {
            return invalid("role_key", "unknown role");
          }
          const rawStatus = changes.status ?? undefined;
          const nextStatus = rawStatus === undefined ? undefined : parseMemberStatus(rawStatus);
          if (rawStatus !== undefined && nextStatus === undefined) {
            return invalid("status", "unknown status");
          }
          const touchesOwner = target.role.key === "owner" || nextRole?.key === "owner";
          if (touchesOwner && caller.membership.role.key !== "owner") {
            return refuse(403, "forbidden", "Only an owner may do this.");
          }
          const wasActiveOwner = target.role.key === "owner" && (target.status ?? "active") === "active";
          const leavingOwner = wasActiveOwner && ((nextRole !== undefined && nextRole.key !== "owner") || (nextStatus !== undefined && nextStatus !== "active"));
          if (leavingOwner) {
            const otherActiveOwners = state.memberships.filter(
              (m) => m.clinic_id === caller.clinic.id && m.id !== target.id && m.role.key === "owner" && (m.status ?? "active") === "active",
            );
            if (otherActiveOwners.length === 0) {
              return refuse(409, "conflict", "The last active owner can't be changed.");
            }
          }
          if (nextRole !== undefined) target.role = nextRole;
          if (nextStatus !== undefined) target.status = nextStatus;
          return reply(wireMember(target, state) satisfies C.Member);
        }),

      listRoles: (opts) =>
        respond(S.rolesResponse, opts?.signal, async () => {
          const caller = await inClinic("staff.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = Object.values(ROLES)
            .map(
              (role): C.Role => ({
                id: role.key,
                key: role.key,
                name: role.name,
                description: null,
                is_template: true,
                permissions: role.permissions.map((key): C.RolePermission => ({ key, scope: "all" })),
              }),
            )
            .sort((a, b) => a.name.localeCompare(b.name));
          return reply({ items } satisfies C.Roles);
        }),

      getClinicSettings: (opts) =>
        respond(S.clinicSettings, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          return reply(wireClinicSettings(caller.clinic) satisfies C.ClinicSettings);
        }),

      updateClinicSettings: (changes, opts) =>
        respond(S.clinicSettings, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const problem = validateClinicSettingsChanges(changes);
          if (problem !== null) {
            return problem;
          }
          const clinic = caller.clinic;
          if (changes.name != null) clinic.name = changes.name;
          if (changes.legal_name !== undefined) clinic.legal_name = changes.legal_name === "" ? null : changes.legal_name;
          if (changes.gstin !== undefined) clinic.gstin = changes.gstin === "" ? null : changes.gstin;
          if (changes.timezone != null) clinic.timezone = changes.timezone;
          if (changes.phone !== undefined) {
            clinic.phone = changes.phone === "" || changes.phone === null ? null : normalizeClinicPhone(changes.phone);
          }
          if (changes.upi_id !== undefined) clinic.upi_id = changes.upi_id === "" ? null : changes.upi_id;
          if (changes.prescription_footer !== undefined) clinic.prescription_footer = changes.prescription_footer === "" ? null : changes.prescription_footer;
          if (changes.address !== undefined) clinic.address = changes.address ?? {};
          if (changes.branding !== undefined) {
            const rawMode = changes.branding?.mode ?? undefined;
            clinic.branding = {
              brand: changes.branding?.brand ?? clinic.branding.brand,
              mode: (rawMode === undefined ? undefined : parseThemeMode(rawMode)) ?? clinic.branding.mode,
            };
          }
          return reply(wireClinicSettings(clinic) satisfies C.ClinicSettings);
        }),

      listMySessions: (opts) =>
        respond(S.mySessionsResponse, opts?.signal, async () => {
          const id = await subject();
          if (id === undefined) {
            return signedOut;
          }
          const now = clock().toISOString();
          const mine = state.sessions
            .filter((s) => s.user_id === id && !s.revoked && s.expires_at > now)
            .sort((a, b) => b.last_active_at.localeCompare(a.last_active_at));
          const newest = mine[0];
          return reply({
            items: mine.map(
              (s): C.MySession => ({
                id: s.id,
                audience: s.audience,
                created_at: s.created_at,
                last_active_at: s.last_active_at,
                expires_at: s.expires_at,
                current: s === newest,
              }),
            ),
          } satisfies C.MySessions);
        }),

      revokeMySession: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const userId = await subject();
          if (userId === undefined) {
            return signedOut;
          }
          const found = state.sessions.find((s) => s.id === id && s.user_id === userId);
          if (found === undefined) {
            return notFound;
          }
          found.revoked = true;
          return { ok: true, body: undefined };
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
            const expiresAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
            invitations.set(inviteToken, {
              id: fakeUuid(random, now),
              clinicId: clinic.id,
              email: input.owner_email,
              roleKey: "owner",
              createdAt: now.toISOString(),
              expiresAt,
              used: false,
            });
            return reply({
              id: clinic.id,
              slug,
              portal_host: clinic.host,
              invitation_id: fakeUuid(random, now),
              invite_token: inviteToken,
              invite_expires_at: expiresAt,
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

function validatePatientChanges(changes: C.PatientChanges, now: Date): Outcome | null {
  if (changes.full_name != null) {
    const name = changes.full_name.trim();
    if (name.length < 1 || name.length > 200) {
      return invalid("full_name", "full_name must be 1 to 200 characters of text");
    }
  }
  if (changes.sex != null && !S.sex.safeParse(changes.sex).success) {
    return invalid("sex", "must be female, male, other or unknown");
  }
  if (changes.date_of_birth != null && changes.date_of_birth !== "") {
    const dob = new Date(`${changes.date_of_birth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime()) || dob > now || dob.getUTCFullYear() < now.getUTCFullYear() - 130) {
      return invalid("date_of_birth", "must be a real date, not in the future");
    }
  }
  if (changes.age_years != null && (!Number.isInteger(changes.age_years) || changes.age_years < 0 || changes.age_years > 130)) {
    return invalid("age_years", "must be between 0 and 130");
  }
  if (
    changes.phone != null &&
    changes.phone !== "" &&
    !(E164.test(changes.phone) && (!changes.phone.startsWith("+91") || INDIAN_MOBILE.test(changes.phone)))
  ) {
    return invalid("phone", "invalid phone number");
  }
  if (changes.email != null && changes.email !== "" && !EMAIL.test(changes.email)) {
    return invalid("email", "invalid email address");
  }
  return null;
}

function parseMemberStatus(value: string): "invited" | "active" | "suspended" | "left" | undefined {
  return value === "invited" || value === "active" || value === "suspended" || value === "left" ? value : undefined;
}

function parseThemeMode(value: string): "light" | "dark" | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** A membership plus its person's name, status and branches, as the API serves it. */
function wireMember(membership: FakeMembership, state: Fixtures): C.Member {
  const user = state.users.find((u) => u.id === membership.user_id);
  return {
    id: membership.id,
    user_id: membership.user_id,
    display_name: user?.display_name ?? "Unknown",
    role_key: membership.role.key,
    role_name: membership.role.name,
    status: membership.status ?? "active",
    branches: [],
    joined_at: membership.joined_at ?? null,
  };
}

function wireClinicSettings(clinic: FakeClinic): C.ClinicSettings {
  return {
    name: clinic.name,
    legal_name: clinic.legal_name ?? null,
    gstin: clinic.gstin ?? null,
    timezone: clinic.timezone,
    phone: clinic.phone ?? null,
    upi_id: clinic.upi_id ?? null,
    prescription_footer: clinic.prescription_footer ?? null,
    address: {
      line1: clinic.address?.line1 ?? null,
      line2: clinic.address?.line2 ?? null,
      city: clinic.address?.city ?? null,
      state: clinic.address?.state ?? null,
      pincode: clinic.address?.pincode ?? null,
    },
    branding: { brand: clinic.branding.brand, mode: clinic.branding.mode },
  };
}

/** `9876543210` or `+919876543210` both become `+919876543210`: +91 is assumed without a country code. */
function normalizeClinicPhone(raw: string): string {
  return raw.startsWith("+") ? raw : `+91${raw}`;
}

const UPI_ID = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function validateClinicSettingsChanges(changes: C.ClinicSettingsChanges): Outcome | null {
  if (changes.name != null && (changes.name.length < 1 || changes.name.length > 200)) {
    return invalid("name", "must be 1 to 200 characters");
  }
  if (changes.phone != null && changes.phone !== "") {
    const phone = normalizeClinicPhone(changes.phone);
    if (!(E164.test(phone) && (!phone.startsWith("+91") || INDIAN_MOBILE.test(phone)))) {
      return invalid("phone", "invalid phone number");
    }
  }
  if (changes.upi_id != null && changes.upi_id !== "" && !UPI_ID.test(changes.upi_id)) {
    return invalid("upi_id", "invalid UPI ID");
  }
  if (changes.gstin != null && changes.gstin !== "" && !GSTIN.test(changes.gstin)) {
    return invalid("gstin", "invalid GSTIN");
  }
  if (changes.prescription_footer != null && changes.prescription_footer.length > 500) {
    return invalid("prescription_footer", "must be at most 500 characters");
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

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const APPOINTMENT_ORDER: readonly C.AppointmentStatus[] = ["booked", "confirmed", "arrived", "in_chair", "completed"];

function wireRoom(r: FakeRoom): C.Room {
  return { id: r.id, branch_id: r.branch_id, name: r.name, kind: r.kind, active: r.active, sort_order: r.sort_order };
}

function wirePractitioner(p: FakePractitioner): C.Practitioner {
  return {
    id: p.id,
    display_name: p.display_name,
    calendar_color: p.calendar_color,
    active: p.active,
    membership_id: p.membership_id ?? null,
    registration_number: p.registration_number ?? null,
    specialty: p.specialty ?? null,
  };
}

function wirePractitionerBrief(p: FakePractitioner): C.PractitionerBrief {
  return { id: p.id, display_name: p.display_name, calendar_color: p.calendar_color };
}

function wireLeave(l: FakeLeave): C.Leave {
  return { id: l.id, practitioner_id: l.practitioner_id, starts_at: l.starts_at, ends_at: l.ends_at, reason: l.reason ?? null };
}

function wireShifts(state: Fixtures, practitionerId: string): C.WorkingShift[] {
  return state.workingShifts
    .filter((s) => s.practitioner_id === practitionerId)
    .map((s) => ({ weekday: s.weekday, starts: s.starts, ends: s.ends, branch_id: s.branch_id }));
}

function wirePatientBrief(p: FakePatient, now: Date): C.PatientBrief {
  return { id: p.id, number: p.number, full_name: p.full_name, sex: p.sex, age_years: ageYears(p.date_of_birth, now) };
}

function wireAppointment(appt: FakeAppointment, state: Fixtures, now: Date): C.Appointment | undefined {
  const patient = state.patients.find((p) => p.id === appt.patient_id);
  const practitioner = state.practitioners.find((p) => p.id === appt.practitioner_id);
  if (patient === undefined || practitioner === undefined) {
    return undefined;
  }
  const room = appt.room_id == null ? undefined : state.rooms.find((r) => r.id === appt.room_id);
  return {
    id: appt.id,
    branch_id: appt.branch_id,
    starts_at: appt.starts_at,
    ends_at: appt.ends_at,
    status: appt.status,
    kind: appt.kind,
    source: appt.source,
    reason: appt.reason ?? null,
    notes: appt.notes ?? null,
    has_notes: appt.notes != null && appt.notes !== "",
    room: room?.name ?? null,
    room_id: appt.room_id ?? null,
    patient: wirePatientBrief(patient, now),
    practitioner: wirePractitionerBrief(practitioner),
    arrived_at: appt.arrived_at ?? null,
    seated_at: appt.seated_at ?? null,
    completed_at: appt.completed_at ?? null,
    cancel_reason: appt.cancel_reason ?? null,
    token_number: appt.token_number ?? null,
  };
}

function wireQueueToken(token: FakeQueueToken, state: Fixtures, now: Date): C.QueueToken | undefined {
  const patient = state.patients.find((p) => p.id === token.patient_id);
  if (patient === undefined) {
    return undefined;
  }
  const practitioner = token.practitioner_id == null ? null : state.practitioners.find((p) => p.id === token.practitioner_id) ?? null;
  const waitUntil = token.status === "waiting" ? now.toISOString() : token.called_at ?? token.done_at ?? now.toISOString();
  const waitMinutes = Math.max(0, Math.round((Date.parse(waitUntil) - Date.parse(token.issued_at)) / 60_000));
  return {
    id: token.id,
    branch_id: token.branch_id,
    day: token.day,
    token_number: token.token_number,
    patient: wirePatientBrief(patient, now),
    practitioner: practitioner === null ? null : wirePractitionerBrief(practitioner),
    appointment_id: token.appointment_id ?? null,
    status: token.status,
    issued_at: token.issued_at,
    called_at: token.called_at ?? null,
    done_at: token.done_at ?? null,
    wait_minutes: waitMinutes,
  };
}

/** Whether two `[start, end)` instants (as ISO strings) overlap. */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map((part) => Number.parseInt(part, 10));
  return h * 60 + m;
}

/** 1 Monday to 7 Sunday, for a `YYYY-MM-DD` local date. */
function isoWeekday(date: string): number {
  const [year = 1970, month = 1, day = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function withinWorkingHours(state: Fixtures, clinic: FakeClinic, practitionerId: string, startsAt: string, endsAt: string): boolean {
  const start = localClock(new Date(startsAt), clinic.timezone);
  const end = localClock(new Date(endsAt), clinic.timezone);
  if (start.date !== end.date) {
    return false;
  }
  const weekday = isoWeekday(start.date);
  return state.workingShifts
    .filter((s) => s.clinic_id === clinic.id && s.practitioner_id === practitionerId && s.weekday === weekday)
    .some((s) => toMinutes(s.starts) <= start.minutes && end.minutes <= toMinutes(s.ends));
}

/** Warnings for booking or moving an appointment: busy elsewhere, on leave, or outside hours. Never blocks. */
function bookingWarnings(
  state: Fixtures,
  clinic: FakeClinic,
  practitionerId: string,
  startsAt: string,
  endsAt: string,
  excludeAppointmentId: string | undefined,
): C.BookingWarning[] {
  const warnings: C.BookingWarning[] = [];
  const busy = state.appointments.some(
    (a) =>
      a.id !== excludeAppointmentId &&
      a.clinic_id === clinic.id &&
      a.practitioner_id === practitionerId &&
      a.status !== "cancelled" &&
      a.status !== "no_show" &&
      overlaps(a.starts_at, a.ends_at, startsAt, endsAt),
  );
  if (busy) {
    warnings.push({ code: "practitioner_busy", message: "This doctor is booked in another chair at this time." });
  }
  const onLeave = state.leave.some(
    (l) => l.clinic_id === clinic.id && l.practitioner_id === practitionerId && overlaps(l.starts_at, l.ends_at, startsAt, endsAt),
  );
  if (onLeave) {
    warnings.push({ code: "practitioner_on_leave", message: "This doctor is on leave at this time." });
  }
  if (!withinWorkingHours(state, clinic, practitionerId, startsAt, endsAt)) {
    warnings.push({ code: "outside_working_hours", message: "This is outside the doctor's working hours." });
  }
  return warnings;
}

/** A small CSV parser: commas, quoted fields (with escaped `""`), and `\n` or `\r\n` line endings. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch ?? "";
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // Ignore; a following "\n" ends the row.
    } else {
      field += ch ?? "";
    }
  }
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * Today at the clinic, from appointments and queue tokens whose status and timing were worked
 * out once when fixtures built (relative to the fixture's own clock), not recomputed per request.
 */
function buildToday(state: Fixtures, clinic: FakeClinic, now: Date): C.TodayResponse {
  const { date } = localClock(now, clinic.timezone);
  const todaysAppointments = state.appointments.filter((a) => a.clinic_id === clinic.id && localClock(new Date(a.starts_at), clinic.timezone).date === date);
  const wired = todaysAppointments.flatMap((a) => {
    const w = wireAppointment(a, state, now);
    return w === undefined ? [] : [w];
  });
  const todaysTokens = state.queueTokens.filter((t) => t.clinic_id === clinic.id && t.day === date);

  const counts: C.TodayCounts = {
    total: wired.filter((a) => a.status !== "cancelled").length,
    booked: wired.filter((a) => a.status === "booked" || a.status === "confirmed").length,
    arrived: wired.filter((a) => a.status === "arrived").length,
    in_chair: wired.filter((a) => a.status === "in_chair").length,
    done: wired.filter((a) => a.status === "completed").length,
    cancelled: wired.filter((a) => a.status === "cancelled").length,
    no_shows: wired.filter((a) => a.status === "no_show").length,
    waiting: todaysTokens.filter((t) => t.status === "waiting").length,
  };

  const byHour = new Map<number, { booked: number; completed: number }>();
  for (const a of wired) {
    if (a.status === "cancelled") continue;
    const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: clinic.timezone }).format(new Date(a.starts_at)));
    const bucket = byHour.get(hour) ?? { booked: 0, completed: 0 };
    bucket.booked += 1;
    if (a.status === "completed") bucket.completed += 1;
    byHour.set(hour, bucket);
  }
  const by_hour: C.HourBar[] = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, booked: v.booked, completed: v.completed }));

  const toChairAppointment = (a: C.Appointment): C.ChairAppointment => ({
    appointment_id: a.id,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    status: a.status,
    patient: a.patient,
    practitioner: a.practitioner,
  });
  const chairs: C.ChairStatus[] = state.rooms
    .filter((r) => r.clinic_id === clinic.id && r.active && r.kind === "chair")
    .map((r) => {
      const roomAppointments = wired
        .filter((a) => a.room_id === r.id && a.status !== "cancelled" && a.status !== "no_show")
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const current = roomAppointments.find((a) => a.status === "in_chair");
      const next = roomAppointments.find(
        (a) => a.id !== current?.id && (a.status === "booked" || a.status === "confirmed" || a.status === "arrived"),
      );
      return {
        room_id: r.id,
        name: r.name,
        kind: r.kind,
        status: current === undefined ? "free" : "in_use",
        current: current === undefined ? null : toChairAppointment(current),
        next: next === undefined ? null : toChairAppointment(next),
      } satisfies C.ChairStatus;
    });

  const attention: C.AttentionItem[] = [];
  for (const a of wired) {
    if (a.status !== "booked" && a.status !== "confirmed") continue;
    const lateMinutes = Math.round((now.getTime() - Date.parse(a.starts_at)) / 60_000);
    if (lateMinutes >= 15) {
      attention.push({
        kind: "late_arrival",
        message: `${String(lateMinutes)} minutes late`,
        minutes: lateMinutes,
        patient: { id: a.patient.id, number: a.patient.number, full_name: a.patient.full_name },
        appointment_id: a.id,
        queue_token_id: null,
      });
    }
  }
  for (const t of todaysTokens) {
    if (t.status !== "waiting") continue;
    const waitMinutes = Math.max(0, Math.round((now.getTime() - Date.parse(t.issued_at)) / 60_000));
    if (waitMinutes < 30) continue;
    const patient = state.patients.find((p) => p.id === t.patient_id);
    if (patient === undefined) continue;
    attention.push({
      kind: "long_wait",
      message: `Waiting ${String(waitMinutes)} minutes`,
      minutes: waitMinutes,
      patient: { id: patient.id, number: patient.number, full_name: patient.full_name },
      appointment_id: t.appointment_id ?? null,
      queue_token_id: t.id,
    });
  }
  attention.sort((a, b) => b.minutes - a.minutes);

  const recent_patients = todaysTokens
    .slice()
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
    .flatMap((t) => {
      const w = wireQueueToken(t, state, now);
      return w === undefined ? [] : [w];
    })
    .slice(0, 10);

  const weekday = isoWeekday(date);
  const dayStart = atLocalTime(date, 0, clinic.timezone).toISOString();
  const dayEnd = atLocalTime(date, 1440, clinic.timezone).toISOString();
  const team: C.TeamMemberToday[] = state.practitioners
    .filter((p) => p.clinic_id === clinic.id && p.active)
    .map((p) => {
      const shifts = state.workingShifts
        .filter((s) => s.clinic_id === clinic.id && s.practitioner_id === p.id && s.weekday === weekday)
        .map((s): C.TodayShift => ({ starts: s.starts, ends: s.ends }));
      const onLeave = state.leave.some((l) => l.clinic_id === clinic.id && l.practitioner_id === p.id && overlaps(l.starts_at, l.ends_at, dayStart, dayEnd));
      const appointments = wired.filter((a) => a.practitioner.id === p.id && a.status !== "cancelled").length;
      return { practitioner: wirePractitionerBrief(p), specialty: p.specialty ?? null, on_leave: onLeave, appointments, shifts } satisfies C.TeamMemberToday;
    })
    .filter((member) => member.shifts.length > 0);

  return {
    date,
    as_of: now.toISOString(),
    counts,
    appointments: wired,
    by_hour,
    chairs,
    attention,
    recent_patients,
    team,
  };
}
