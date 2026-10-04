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
  type FakeClinic,
  type FakeMembership,
  type FakePatient,
  type FakePlatformUser,
  type FakeRole,
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
          const withMoney = hasPermission(caller.membership.role.permissions, "finance.view");
          return reply(buildToday(state, caller.clinic, clock(), withMoney) satisfies C.TodayResponse);
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
