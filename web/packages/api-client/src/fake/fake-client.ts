/**
 * An in-memory stand-in for the API that behaves like it: it checks the token, resolves the
 * clinic from the host, checks membership and permissions, masks contact details without
 * `patients.contact`, answers input errors as `field: message`, and serves responses through
 * the same decoders as the real client.
 */

import type { z } from "zod";

import type { ApiClient, PatientFilter } from "../client.js";
import type * as C from "../contract.js";
import type { TokenSource } from "../http-client.js";
import { hasPermission, type Permission } from "../permissions.js";
import { failure, parseApiError, success, type ApiResult } from "../result.js";
import * as S from "../schemas.js";
import {
  PERMISSION_CATALOGUE,
  ROLES,
  type FakeAllergy,
  type FakeConsent,
  type FakePlan,
  type FakePlanItem,
  type FakeAlert,
  type FakeApplication,
  type FakeAppointment,
  type FakeAttachment,
  type FakeChartEntry,
  type FakeClinic,
  type FakeCondition,
  type FakeDrug,
  type FakeInvoice,
  type FakeInvoiceLine,
  type FakeLeave,
  type FakeMembership,
  type FakeNote,
  type FakeSummaryNote,
  type FakeObservation,
  type FakePatient,
  type FakePayment,
  type FakePlatformUser,
  type FakePractitioner,
  type FakePrescription,
  type FakeInventoryItem,
  type FakePriceItem,
  type FakeStockBatch,
  type FakeStockMovement,
  type FakeSupplier,
  type FakeProcedure,
  type FakeQueueToken,
  type FakeRole,
  type FakeRoom,
  type FakeRxItem,
  type FakeShareLink,
  type FakeUser,
  type FakeVisit,
  type Fixtures,
} from "./fixtures.js";
import { clinicTerms } from "./dental-terms.js";
import { createMetrics } from "./metrics.js";
import { buildPage, checkChanges, cleanContent, isPhotoKind, parseDomain, photosOf, siteOf, wirePhoto, wireSettings, type FakePhoto } from "./website.js";
import { createRandom, fakeUuid } from "./random.js";
import { CLINIC_STEPS, MEMBER_STEPS, applySetup, setupOf, wireSetup } from "./setup.js";
import { MAX_MOVEMENT, addDays, byUrgency, daysBetween, isExpired, isStockUnit, levelOf, pickFefo, wireItem } from "./stock.js";
import { readCsv, readRow, suggestColumns, type CsvTable } from "./smart-import.js";
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

type Outcome = { ok: true; body: unknown } | { ok: false; status: number; body: C.ErrorBody | C.IssueBlocked };

/** A success body; call sites add `satisfies` with the contract type. */
const reply = (body: unknown): Outcome => ({ ok: true, body });
const refuse = (status: number, code: string, message: string): Outcome => ({ ok: false, status, body: { error: { code, message } } });
/** Input errors as the API sends them: the field, a colon, then what is wrong. */
const invalid = (field: string, problem: string): Outcome => refuse(400, "invalid_request", `${field}: ${problem}`);
const notFound = refuse(404, "not_found", "Not found.");
/** A consent record as the API sends it: without the fake's clinic and patient keys. */
const wireConsent = (c: FakeConsent): C.Consent => ({
  id: c.id,
  purpose: c.purpose,
  notice_version: c.notice_version,
  given_at: c.given_at,
  method: c.method,
  recorded_by: c.recorded_by,
  status: c.status,
  ...(c.withdrawn_at === undefined ? {} : { withdrawn_at: c.withdrawn_at }),
  ...(c.withdrawn_by === undefined ? {} : { withdrawn_by: c.withdrawn_by }),
  ...(c.withdrawn_method === undefined ? {} : { withdrawn_method: c.withdrawn_method }),
  ...(c.note === undefined ? {} : { note: c.note }),
  ...(c.withdrawal_note === undefined ? {} : { withdrawal_note: c.withdrawal_note }),
});
/** `409` when issuing a prescription hits allergy alerts without an override reason. */
const blocked = (alerts: C.Alert[]): Outcome => ({ ok: false, status: 409, body: { code: "allergy_alerts", alerts } });
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
  /** Patient-app links and waiting codes, per patient (the fake keeps them in memory only). */
  const appAccess = new Map<string, { links: C.PatientAppLink[]; code_expires_at: string | null }>();
  const appAccessOf = (patient: string) => {
    let found = appAccess.get(patient);
    if (found === undefined) {
      found = { links: [], code_expires_at: null };
      appAccess.set(patient, found);
    }
    return found;
  };

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
  /** Session handoffs by code: who, for which host, until when, and whether used. */
  const handoffs = new Map<string, { personId: string; host: string; expiresAt: number; used: boolean }>();
  /** Payment ids already recorded for an `Idempotency-Key`, so a retry returns the first payment. */
  const paymentByIdempotencyKey = new Map<string, string>();
  /** Smart import sessions by id: the file's rows until imported or discarded. */
  const importSessions = new Map<
    string,
    { clinicId: string; fileName: string; table: CsvTable | undefined; status: "open" | "committed" | "discarded"; result?: C.SmartImportResult }
  >();
  /** Patients imported without some details: the to-do list. */
  const patientGaps: { id: string; clinicId: string; patientId: string; fileName: string; row: number; missing: C.IncompletePatient["missing"]; importedAt: string; dismissed: boolean }[] = [];

  /** A clinic's own copy of a role: editable, with its change record. */
  interface ClinicRole {
    key: string;
    name: string;
    description: string | null;
    isTemplate: boolean;
    templateKey: string | null;
    permissions: C.RolePermission[];
    history: C.RoleChange[];
    /** What memberships with this role point at; replaced on every change. */
    role: FakeRole;
  }
  const clinicRoles = new Map<string, ClinicRole[]>();
  const sortGrants = (grants: readonly C.RolePermission[]) => [...grants].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const asFakeRole = (key: string, name: string, grants: readonly C.RolePermission[]): FakeRole => ({
    key,
    name,
    permissions: grants.map((g) => g.key).filter((k): k is Permission => PERMISSION_CATALOGUE.some((p) => p.key === k)),
  });

  /** The clinic's roles, copied from the templates the first time they are needed. */
  function rolesOf(clinicId: string): ClinicRole[] {
    let roles = clinicRoles.get(clinicId);
    if (roles === undefined) {
      roles = Object.values(ROLES).map((template) => {
        const permissions = sortGrants(template.permissions.map((key) => ({ key, scope: "all" as const })));
        return { key: template.key, name: template.name, description: null, isTemplate: true, templateKey: template.key, permissions, history: [], role: asFakeRole(template.key, template.name, permissions) };
      });
      clinicRoles.set(clinicId, roles);
      for (const m of state.memberships) {
        if (m.clinic_id === clinicId) {
          const own = roles.find((r) => r.key === m.role.key);
          if (own !== undefined) m.role = own.role;
        }
      }
    }
    return roles;
  }

  function roleByKey(key: string, clinicId?: string): FakeRole | undefined {
    if (clinicId !== undefined) {
      return rolesOf(clinicId).find((candidate) => candidate.key === key)?.role;
    }
    return Object.values(ROLES).find((candidate) => candidate.key === key);
  }

  function membersWith(clinicId: string, key: string): number {
    return state.memberships.filter((m) => m.clinic_id === clinicId && m.role.key === key && (m.status ?? "active") !== "left").length;
  }

  function wireRole(clinicId: string, role: ClinicRole): C.Role {
    return { id: role.key, key: role.key, name: role.name, description: role.description, is_template: role.isTemplate, permissions: role.permissions, member_count: membersWith(clinicId, role.key) };
  }

  function roleDetailOf(clinicId: string, role: ClinicRole): C.RoleDetail {
    const template = Object.values(ROLES).find((t) => t.key === role.templateKey);
    return {
      ...wireRole(clinicId, role),
      template_key: role.templateKey,
      editable: role.key !== "owner",
      default_permissions: sortGrants(template?.permissions.map((key) => ({ key, scope: "all" as const })) ?? []),
      history: role.history.slice(0, 10),
    };
  }

  /** Sets a role's permissions; its members' checks follow at once. */
  function setGrants(clinicId: string, role: ClinicRole, grants: C.RolePermission[]) {
    role.permissions = grants;
    role.role = asFakeRole(role.key, role.name, grants);
    for (const m of state.memberships) {
      if (m.clinic_id === clinicId && m.role.key === role.key) m.role = role.role;
    }
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

    /** Preview or commit of a fake import session. */
    async function smartImport(id: string, choices: C.ImportChoices, commit: boolean): Promise<Outcome> {
      const caller = await inClinic("patients.write");
      if (!isCaller(caller)) {
        return caller;
      }
      const session = importSessions.get(id);
      if (session?.clinicId !== caller.clinic.id) {
        return notFound;
      }
      if (session.result !== undefined) {
        return commit ? reply(session.result) : refuse(409, "conflict", "this file has already been imported");
      }
      if (session.table === undefined) {
        return refuse(409, "conflict", "this import session has ended; upload the file again");
      }
      if (choices.mapping.full_name === undefined) {
        return invalid("mapping", "choose the column with the patient's name");
      }
      const now = clock();
      const decisions = new Map((choices.rows ?? []).map((d) => [d.row, d.choice]));
      const firstOf = new Map<string, number>();
      const rows: C.SmartImportRow[] = [];
      const existingNumbers = state.patients.filter((p) => p.clinic_id === caller.clinic.id).map((p) => Number(p.number.split("-")[1] ?? 0));
      let nextNumber = 1 + Math.max(0, ...existingNumbers);
      for (const { line, cells } of session.table.rows) {
        const read = readRow(line, cells, choices.mapping, now);
        const row: C.SmartImportRow = { row: line, action: "import", missing: [], errors: read.errors, warnings: read.warnings, duplicate_of: null, values: {} };
        rows.push(row);
        if (read.name === undefined) {
          row.action = commit ? "failed" : "fail";
          continue;
        }
        const key = read.phone === null ? undefined : `${read.phone}|${read.name.toLowerCase()}`;
        const existing =
          key === undefined
            ? undefined
            : state.patients.find((p) => p.clinic_id === caller.clinic.id && `${p.phone ?? ""}|${p.full_name.toLowerCase()}` === key);
        const earlier = key === undefined ? undefined : firstOf.get(key);
        const choice = decisions.get(line) ?? (existing !== undefined || earlier !== undefined ? (choices.duplicates ?? "skip") : "import");
        if (existing !== undefined) row.duplicate_of = { patient_id: existing.id, number: existing.number, row: null };
        else if (earlier !== undefined) row.duplicate_of = { patient_id: null, number: null, row: earlier };
        if (choice === "skip") {
          row.action = commit ? "skipped" : "skip";
          row.errors = [row.duplicate_of == null ? "skipped by choice" : "same phone and name as another record"];
          continue;
        }
        if (choice === "merge" && row.duplicate_of != null) {
          row.action = commit ? "merged" : "merge";
          if (commit && existing !== undefined) {
            if (existing.sex === "unknown") existing.sex = read.sex;
            existing.date_of_birth ??= read.dateOfBirth;
            existing.email ??= read.email;
            row.patient_id = existing.id;
            row.number = existing.number;
          }
          continue;
        }
        if (key !== undefined && !firstOf.has(key)) firstOf.set(key, line);
        row.action = commit ? "imported" : "import";
        row.missing = read.missing;
        row.values = commit
          ? {}
          : Object.fromEntries(
              Object.entries({ full_name: read.name, phone: read.phone, sex: read.sex === "unknown" ? null : read.sex, date_of_birth: read.dateOfBirth }).filter(
                (entry): entry is [string, string] => entry[1] !== null,
              ),
            );
        if (commit) {
          const record: FakePatient = {
            clinic_id: caller.clinic.id,
            id: fakeUuid(random, now),
            number: `${caller.clinic.number_prefix}-${String(nextNumber)}`,
            full_name: read.name,
            sex: read.sex,
            date_of_birth: read.dateOfBirth,
            birth_date_estimated: read.estimated,
            phone: read.phone,
            email: read.email,
            preferred_language: "en-IN",
            status: "active",
            created_at: now.toISOString(),
            last_visit_at: null,
          };
          nextNumber += 1;
          state.patients.push(record);
          row.patient_id = record.id;
          row.number = record.number;
          if (read.missing.length > 0) {
            patientGaps.push({
              id: fakeUuid(random, now),
              clinicId: caller.clinic.id,
              patientId: record.id,
              fileName: session.fileName,
              row: line,
              missing: read.missing,
              importedAt: now.toISOString(),
              dismissed: false,
            });
          }
        }
      }
      const count = (...actions: C.SmartImportRow["action"][]) => rows.filter((r) => actions.includes(r.action)).length;
      const result: C.SmartImportResult = {
        import_id: commit ? fakeUuid(random, now) : null,
        total: rows.length,
        imported: count("import", "imported"),
        incomplete: rows.filter((r) => r.missing.length > 0).length,
        merged: count("merge", "merged"),
        skipped: count("skip", "skipped"),
        failed: count("fail", "failed"),
        notes: choices.mapping.balance === undefined ? [] : ["balance: amounts owed are not imported; record opening balances in Billing"],
        rows,
      };
      if (commit) {
        session.result = result;
        session.status = "committed";
        session.table = undefined;
      }
      return reply(result);
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

    /** The clinic's local date. */
    function clinicToday(clinic: FakeClinic): string {
      return localClock(clock(), clinic.timezone).date;
    }

    function clinicLevels(clinic: FakeClinic): C.StockLevel[] {
      const today = clinicToday(clinic);
      return state.inventoryItems.filter((i) => i.clinic_id === clinic.id).map((i) => levelOf(i, state.stockBatches, today));
    }

    function inventoryItemOf(clinic: FakeClinic, id: string): FakeInventoryItem | undefined {
      return state.inventoryItems.find((i) => i.id === id && i.clinic_id === clinic.id);
    }

    function inventoryItemNamed(clinic: FakeClinic, name: string): FakeInventoryItem | undefined {
      return state.inventoryItems.find((i) => i.clinic_id === clinic.id && i.name.toLowerCase() === name.toLowerCase());
    }

    function record(caller: Caller, item: FakeInventoryItem, batch: FakeStockBatch, kind: FakeStockMovement["kind"], quantity: number, reason: string | null): FakeStockMovement {
      const movement: FakeStockMovement = {
        id: fakeUuid(random, clock()),
        clinic_id: caller.clinic.id,
        item_id: item.id,
        batch_id: batch.id,
        kind,
        quantity,
        reason,
        at: clock().toISOString(),
        by: caller.user.id,
      };
      state.stockMovements.push(movement);
      return movement;
    }

    function stockChangeOf(clinic: FakeClinic, item: FakeInventoryItem, movements: readonly FakeStockMovement[]): C.StockChange {
      return {
        stock: levelOf(item, state.stockBatches, clinicToday(clinic)),
        movements: movements.map(wireMovement),
      };
    }


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
        row_version: 1,
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
        ...patientSummary(state, p, clock(), hasPermission(caller.membership.role.permissions, "billing.read")),
      };
    };

    /** The list filters; the fake has no recalls, so none is ever due. */
    const filterPatients = (patients: FakePatient[], filter: PatientFilter, caller: Caller): FakePatient[] | Outcome => {
      if (filter.withBalance === true && !hasPermission(caller.membership.role.permissions, "billing.read")) {
        return refuse(403, "forbidden", "Your role can't do that.");
      }
      const month = localClock(clock(), caller.clinic.timezone).date.slice(0, 7);
      return patients.filter(
        (p) =>
          (filter.withBalance !== true || (patientSummary(state, p, clock(), true).balance_paise ?? 0) > 0) &&
          filter.recallsDue !== true &&
          (filter.newThisMonth !== true || localClock(new Date(p.created_at), caller.clinic.timezone).date.slice(0, 7) === month),
      );
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
          return reply({ clinics, console_access: state.platformUsers.some((u) => u.id === user.id), staff_mfa_required: true } satisfies C.Me);
        }),

      createHandoff: (input, opts) =>
        respond(S.handoff, opts?.signal, async () => {
          const id = await subject();
          const host = input.host.trim().toLowerCase();
          const staff = state.platformUsers.some((u) => u.id === id);
          const user = state.users.find((u) => u.id === id);
          if (!staff && user === undefined) {
            return signedOut;
          }
          const clinic = state.clinics.find((c) => c.host === host);
          const member =
            clinic !== undefined && user !== undefined && state.memberships.some((m) => m.user_id === user.id && m.clinic_id === clinic.id);
          // The console for staff, or a clinic the caller belongs to; anything else looks unknown.
          if (!(member || (staff && host.startsWith("console")))) {
            return notFound;
          }
          const code = random.hex(32);
          const now = clock();
          handoffs.set(code, { personId: id ?? "", host, expiresAt: now.getTime() + 60_000, used: false });
          return reply({
            code,
            host,
            expires_at: new Date(now.getTime() + 60_000).toISOString(),
            redirect_url: `https://${host}/auth/handoff#code=${code}`,
          } satisfies C.Handoff);
        }),

      redeemHandoff: (input, opts) =>
        respond(S.handoffSession, opts?.signal, () => {
          const found = handoffs.get(input.code);
          if (found === undefined || found.used) {
            return notFound;
          }
          found.used = true;
          if (found.host !== options.host || found.expiresAt <= clock().getTime()) {
            return notFound;
          }
          return reply({ kind: "dev", access_token: fakeTokenFor({ id: found.personId }) } satisfies C.HandoffSession);
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
            role: roleByKey(invitation.roleKey, invitation.clinicId) ?? OWNER,
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
          const filtered = filterPatients(clinicPatients(caller), opts ?? {}, caller);
          if (!Array.isArray(filtered)) {
            return filtered;
          }
          const items = searchPatients(filtered, "").slice(0, 50);
          return reply({ items: items.map((p) => wirePatient(p, caller)) } satisfies C.PatientList);
        }),

      searchPatients: (search, opts) =>
        respond(S.patientList, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const limit = Math.min(100, Math.max(1, search.limit ?? 20));
          const filtered = filterPatients(clinicPatients(caller), search, caller);
          if (!Array.isArray(filtered)) {
            return filtered;
          }
          const items = searchPatients(filtered, search.q).slice(0, limit);
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
          const today = buildToday(state, caller.clinic, clock());
          if (hasPermission(caller.membership.role.permissions, "inventory.read")) {
            const low = byUrgency(clinicLevels(caller.clinic)).filter((l) => l.item.active && (l.status === "low" || l.status === "critical"));
            today.low_stock = low.map((l) => ({
              item_id: l.item.id,
              name: l.item.name,
              unit: l.item.unit,
              on_hand: l.on_hand,
              reorder_level: l.item.reorder_level,
              status: l.status,
            }));
          }
          return reply(today satisfies C.TodayResponse);
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
            qualifications: input.qualifications ?? null,
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
          if (changes.qualifications !== undefined) found.qualifications = changes.qualifications === "" ? null : changes.qualifications;
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
          return replaceShifts(state, caller.clinic, id, hours, () => fakeUuid(random, clock()));
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
          if (found.status === "requested" && target !== "confirmed" && target !== "cancelled") {
            return invalid("status", "a requested appointment can only be confirmed or declined");
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

      uploadImportFile: (form, opts) =>
        respond(S.importSession, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const file = form.get("file");
          if (!(file instanceof File)) {
            return invalid("file", "is required");
          }
          if (file.size > 5 * 1024 * 1024) {
            return refuse(413, "too_large", "file: must be at most 5 MB");
          }
          if (/\.xlsx?$/i.test(file.name)) {
            return invalid("file", "the demo reads CSV files only");
          }
          const table = readCsv(await file.text());
          if (table === undefined || table.rows.length === 0) {
            return invalid("file", "the file has no rows under its header");
          }
          const now = clock();
          const id = fakeUuid(random, now);
          importSessions.set(id, { clinicId: caller.clinic.id, fileName: file.name, table, status: "open" });
          return reply({
            id,
            file_name: file.name,
            kind: "csv",
            sheets: [],
            sheet: null,
            header_row: (table.rows[0]?.line ?? 2) - 1,
            headers: table.headers,
            row_count: table.rows.length,
            sample: table.rows.slice(0, 5).map((r) => table.headers.map((_, i) => r.cells[i] ?? "")),
            suggestions: suggestColumns(table.headers),
            expires_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
          } satisfies C.ImportSession);
        }),

      previewImport: (id, choices, opts) =>
        respond(S.smartImportResult, opts?.signal, async () => smartImport(id, choices, false)),

      commitImport: (id, choices, opts) =>
        respond(S.smartImportResult, opts?.signal, async () => smartImport(id, choices, true)),

      discardImport: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const session = importSessions.get(id);
          if (session?.clinicId !== caller.clinic.id) {
            return notFound;
          }
          if (session.status === "open") {
            session.status = "discarded";
            session.table = undefined;
          }
          return reply(undefined);
        }),

      listIncompletePatients: (opts) =>
        respond(S.incompleteList, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items: C.IncompletePatient[] = [];
          for (const gap of patientGaps) {
            const patient = state.patients.find((p) => p.id === gap.patientId);
            if (gap.clinicId !== caller.clinic.id || gap.dismissed || patient === undefined) continue;
            const missing = gap.missing.filter((m) =>
              m === "phone" ? patient.phone == null : m === "sex" ? patient.sex === "unknown" : patient.date_of_birth == null,
            );
            if (missing.length === 0) continue;
            items.push({
              id: gap.id,
              patient_id: patient.id,
              number: patient.number,
              full_name: patient.full_name,
              missing,
              file_name: gap.fileName,
              sheet: null,
              row: gap.row,
              imported_at: gap.importedAt,
            });
          }
          return reply({ items } satisfies C.IncompleteList);
        }),

      dismissIncompletePatient: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const gap = patientGaps.find((g) => g.id === id && g.clinicId === caller.clinic.id);
          if (gap === undefined) {
            return notFound;
          }
          gap.dismissed = true;
          return reply(undefined);
        }),

      getClinicalFlags: (id, opts) =>
        respond(S.clinicalFlags, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const detailsAllowed = hasPermission(caller.membership.role.permissions, "clinical.read");
          const allergies = state.allergies
            .filter((a) => a.clinic_id === caller.clinic.id && a.patient_id === id && a.status === "active")
            .sort((a, b) => Number(b.severity === "severe") - Number(a.severity === "severe"));
          const conditions = state.conditions.filter(
            (c) => c.clinic_id === caller.clinic.id && c.patient_id === id && c.status === "active" && c.flagged,
          );
          return reply({
            allergies: detailsAllowed ? allergies.map(wireAllergy) : [],
            allergy_count: allergies.length,
            conditions: detailsAllowed ? conditions.map(wireCondition) : [],
            condition_count: conditions.length,
            severe_allergy: allergies.some((a) => a.severity === "severe"),
            details_hidden: !detailsAllowed,
            allergies_reviewed: allergies.length > 0 ? "has_allergies" : "unknown",
          } satisfies C.ClinicalFlags);
        }),

      listAllergies: (id, opts) =>
        respond(S.allergyList, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const items = state.allergies
            .filter((a) => a.clinic_id === caller.clinic.id && a.patient_id === id)
            .sort((a, b) => Number(b.severity === "severe") - Number(a.severity === "severe") || b.created_at.localeCompare(a.created_at))
            .map(wireAllergy);
          return reply({ items } satisfies C.AllergyList);
        }),

      addAllergy: (id, input, opts) =>
        respond(S.allergy, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const substance = (input.substance ?? "").trim();
          if (substance.length < 1 || substance.length > 200) {
            return invalid("substance", "must be 1 to 200 characters");
          }
          const severityParsed = S.severity.safeParse(input.severity ?? "moderate");
          if (!severityParsed.success) {
            return invalid("severity", "must be mild, moderate or severe");
          }
          const sourceParsed = S.clinicalSource.safeParse(input.source ?? "clinician");
          if (!sourceParsed.success) {
            return invalid("source", "must be clinician, assistant, patient or import");
          }
          const now = clock().toISOString();
          const record: FakeAllergy = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            patient_id: id,
            substance,
            reaction: input.reaction ?? null,
            severity: severityParsed.data,
            status: "active",
            source: sourceParsed.data,
            code: input.code ?? null,
            verified_by: caller.membership.id,
            created_at: now,
            updated_at: now,
          };
          state.allergies.push(record);
          return reply(wireAllergy(record) satisfies C.Allergy);
        }),

      editAllergy: (id, allergyIdValue, input, opts) =>
        respond(S.allergy, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.allergies.find((a) => a.id === allergyIdValue && a.patient_id === id && a.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (input.substance != null) {
            const substance = input.substance.trim();
            if (substance.length < 1 || substance.length > 200) {
              return invalid("substance", "must be 1 to 200 characters");
            }
            found.substance = substance;
          }
          if (input.severity != null) {
            const severityParsed = S.severity.safeParse(input.severity);
            if (!severityParsed.success) {
              return invalid("severity", "must be mild, moderate or severe");
            }
            found.severity = severityParsed.data;
          }
          if (input.status != null) {
            const statusParsed = S.clinicalStatus.safeParse(input.status);
            if (!statusParsed.success) {
              return invalid("status", "must be active, resolved or entered_in_error");
            }
            found.status = statusParsed.data;
          }
          if (input.reaction !== undefined) {
            found.reaction = input.reaction === "" ? null : input.reaction;
          }
          found.updated_at = clock().toISOString();
          return reply(wireAllergy(found) satisfies C.Allergy);
        }),

      listConditions: (id, opts) =>
        respond(S.conditionList, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const items = state.conditions
            .filter((c) => c.clinic_id === caller.clinic.id && c.patient_id === id)
            .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.created_at.localeCompare(a.created_at))
            .map(wireCondition);
          return reply({ items } satisfies C.ConditionList);
        }),

      addCondition: (id, input, opts) =>
        respond(S.condition, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const displayText = (input.display_text ?? "").trim();
          if (displayText.length < 1 || displayText.length > 300) {
            return invalid("display_text", "must be 1 to 300 characters");
          }
          const now = clock().toISOString();
          const record: FakeCondition = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            patient_id: id,
            display_text: displayText,
            flagged: input.flagged ?? false,
            status: "active",
            source: S.clinicalSource.catch("clinician").parse(input.source ?? "clinician"),
            code: input.code ?? null,
            note: input.note ?? null,
            onset: input.onset ?? null,
            verified_by: caller.membership.id,
            visit_id: input.visit_id ?? null,
            created_at: now,
            updated_at: now,
          };
          state.conditions.push(record);
          return reply(wireCondition(record) satisfies C.Condition);
        }),

      listConsents: (id, opts) =>
        respond(S.consentList, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const items = (state.consents ?? [])
            .filter((c) => c.clinic_id === caller.clinic.id && c.patient_id === id)
            .sort((a, b) => b.given_at.localeCompare(a.given_at))
            .map(wireConsent);
          return reply({ items } satisfies C.ConsentList);
        }),

      recordConsent: (id, input, opts) =>
        respond(S.consent, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const purpose = S.consentPurpose.safeParse(input.purpose);
          if (!purpose.success) {
            return invalid("purpose", "unknown value");
          }
          const method = S.consentMethod.safeParse(input.method);
          if (!method.success) {
            return invalid("method", "unknown value");
          }
          const version = input.notice_version;
          if (version.length < 1 || version.length > 40 || version !== version.trim()) {
            return invalid("notice_version", "must be 1 to 40 characters, without spaces at either end");
          }
          const note = (input.note ?? "").trim();
          if (note.length > 500) {
            return invalid("note", "must be at most 500 characters of plain text");
          }
          const consents = (state.consents ??= []);
          if (consents.some((c) => c.clinic_id === caller.clinic.id && c.patient_id === id && c.purpose === purpose.data && c.status === "given")) {
            return refuse(409, "conflict", "this patient already has an active consent for that purpose; withdraw it first");
          }
          const now = clock().toISOString();
          const record: FakeConsent = {
            id: S.consentId.parse(fakeUuid(random, clock())),
            clinic_id: caller.clinic.id,
            patient_id: id,
            purpose: purpose.data,
            notice_version: version,
            given_at: input.given_at ?? now,
            method: method.data,
            recorded_by: caller.user.display_name,
            status: "given",
            ...(note === "" ? {} : { note }),
          };
          consents.push(record);
          return reply(wireConsent(record) satisfies C.Consent);
        }),

      withdrawConsent: (id, input, opts) =>
        respond(S.consent, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = (state.consents ?? []).find((c) => c.id === id && c.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          const method = S.consentMethod.safeParse(input.method);
          if (!method.success) {
            return invalid("method", "unknown value");
          }
          if (found.status === "withdrawn") {
            return refuse(409, "conflict", "that consent was already withdrawn");
          }
          found.status = "withdrawn";
          found.withdrawn_at = clock().toISOString();
          found.withdrawn_by = caller.user.display_name;
          found.withdrawn_method = method.data;
          const note = (input.note ?? "").trim();
          if (note !== "") {
            found.withdrawal_note = note;
          }
          return reply(wireConsent(found) satisfies C.Consent);
        }),

      getPatientNotes: (id, opts) =>
        respond(S.patientNotes, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const stored = (state.summaryNotes ?? []).find((s) => s.clinic_id === caller.clinic.id && s.patient_id === id);
          const visitNotes = state.notes
            .filter((n) => n.clinic_id === caller.clinic.id)
            .flatMap((n): C.VisitNote[] => {
              const visit = state.visits.find((v) => v.id === n.visit_id && v.patient_id === id);
              const author = memberRefOf(state, n.author_membership_id);
              if (visit === undefined || author === undefined) {
                return [];
              }
              return [
                {
                  id: n.id,
                  visit_id: n.visit_id,
                  visit_number: visit.number,
                  kind: n.kind,
                  status: n.status,
                  sections: n.sections,
                  author,
                  signed_at: n.signed_at ?? null,
                  created_at: n.created_at,
                  updated_at: n.updated_at,
                  row_version: 1,
                  addenda_count: n.addenda.length,
                },
              ];
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
          const summary = stored === undefined ? null : wireSummary(stored, state);
          return reply({ summary, visit_notes: visitNotes } satisfies C.PatientNotes);
        }),

      savePatientSummaryNote: (id, content, expectedVersion, opts) =>
        respond(S.summaryNote, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          if (/<[A-Za-z/!?]|!\[|\]\(|`/.test(content.body)) {
            return refuse(400, "invalid_request", "body: use only headings, lists, bold and italic; no HTML, links, images or code");
          }
          const summaries = (state.summaryNotes ??= []);
          const found = summaries.find((s) => s.clinic_id === caller.clinic.id && s.patient_id === id);
          if (expectedVersion !== undefined && expectedVersion !== (found?.row_version ?? 0)) {
            return refuse(412, "stale_version", "The note changed since you read it.");
          }
          const body = content.body.trim();
          const now = clock().toISOString();
          let record = found;
          if (record === undefined) {
            record = { clinic_id: caller.clinic.id, patient_id: id, body, row_version: 1, updated_at: now, updated_by_membership_id: caller.membership.id };
            summaries.push(record);
          } else if (record.body !== body) {
            record.body = body;
            record.row_version += 1;
            record.updated_at = now;
            record.updated_by_membership_id = caller.membership.id;
          }
          return reply(wireSummary(record, state) satisfies C.SummaryNote);
        }),

      getTimeline: (id, opts) =>
        respond(S.timeline, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const events: C.TimelineEvent[] = [];
          for (const v of state.visits.filter((entry) => entry.clinic_id === caller.clinic.id && entry.patient_id === id)) {
            const clinician = memberRefOf(state, v.clinician_membership_id);
            events.push({
              id: v.id,
              kind: "visit",
              at: v.started_at,
              title: v.number,
              detail: v.chief_complaint ?? null,
              status: v.status,
              by: clinician ?? null,
              visit_id: v.id,
              amount_paise: null,
            });
          }
          for (const n of state.notes.filter((entry) => entry.clinic_id === caller.clinic.id && entry.status === "signed")) {
            const parentVisit = state.visits.find((v) => v.id === n.visit_id && v.patient_id === id);
            if (parentVisit === undefined) {
              continue;
            }
            const author = memberRefOf(state, n.author_membership_id);
            events.push({
              id: n.id,
              kind: "note",
              at: n.signed_at ?? n.created_at,
              title: `${n.kind} note`,
              detail: n.sections.assessment ?? n.sections.subjective ?? null,
              status: n.status,
              by: author ?? null,
              visit_id: n.visit_id,
              amount_paise: null,
            });
          }
          for (const p of state.procedures.filter(
            (entry) => entry.clinic_id === caller.clinic.id && entry.patient_id === id && entry.status !== "entered_in_error",
          )) {
            const clinician = memberRefOf(state, p.clinician_membership_id);
            events.push({
              id: p.id,
              kind: "procedure",
              at: p.performed_at ?? p.created_at,
              title: p.name,
              detail: p.tooth == null ? null : `Tooth ${String(p.tooth)}`,
              status: p.status,
              by: clinician ?? null,
              visit_id: p.visit_id,
              amount_paise: p.price_paise ?? null,
            });
          }
          for (const a of state.attachments.filter((entry) => entry.clinic_id === caller.clinic.id && entry.patient_id === id)) {
            events.push({
              id: a.id,
              kind: "attachment",
              at: a.created_at,
              title: a.kind,
              detail: a.caption ?? null,
              status: null,
              by: null,
              visit_id: a.visit_id ?? null,
              amount_paise: null,
            });
          }
          events.sort((a, b) => b.at.localeCompare(a.at));
          return reply({ items: events } satisfies C.Timeline);
        }),

      listVisits: (id, opts) =>
        respond(S.visitList, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const items = state.visits
            .filter((v) => v.clinic_id === caller.clinic.id && v.patient_id === id)
            .sort((a, b) => b.started_at.localeCompare(a.started_at))
            .flatMap((v) => {
              const wired = wireVisit(v, state);
              return wired === undefined ? [] : [wired];
            });
          return reply({ items } satisfies C.VisitList);
        }),

      getVisit: (id, opts) =>
        respond(S.visitDetail, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.visits.find((v) => v.id === id && v.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          const wiredVisit = wireVisit(found, state);
          if (wiredVisit === undefined) {
            return notFound;
          }
          const notes = state.notes
            .filter((n) => n.visit_id === id)
            .flatMap((n) => {
              const wired = wireNote(n, state);
              return wired === undefined ? [] : [wired];
            });
          const observations = state.observations.filter((o) => o.visit_id === id).map(wireObservation);
          const procedures = state.procedures
            .filter((p) => p.visit_id === id)
            .flatMap((p) => {
              const wired = wireProcedure(p, state);
              return wired === undefined ? [] : [wired];
            });
          const chart_entries = state.chartEntries.filter((c) => c.visit_id === id).map((c) => wireChartEntry(c, state));
          const attachments = state.attachments.filter((a) => a.visit_id === id).map(wireAttachment);
          return reply({ visit: wiredVisit, notes, observations, procedures, chart_entries, attachments } satisfies C.VisitDetail);
        }),

      startVisit: (patientIdValue, input, opts) =>
        respond(S.visit, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === patientIdValue)) {
            return notFound;
          }
          if (input.appointment_id != null) {
            const clash = state.visits.some(
              (v) => v.clinic_id === caller.clinic.id && v.appointment_id === input.appointment_id && v.status === "open",
            );
            if (clash) {
              return refuse(409, "conflict", "That appointment already has an open visit.");
            }
          }
          const now = clock();
          const number = `V-${String(1 + state.visits.filter((v) => v.clinic_id === caller.clinic.id).length)}`;
          const record: FakeVisit = {
            id: fakeUuid(random, now),
            clinic_id: caller.clinic.id,
            patient_id: patientIdValue,
            clinician_membership_id: caller.membership.id,
            number,
            appointment_id: input.appointment_id ?? null,
            chief_complaint: input.chief_complaint ?? null,
            status: "open",
            started_at: now.toISOString(),
            ended_at: null,
          };
          state.visits.push(record);
          const wired = wireVisit(record, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Visit);
        }),

      closeVisit: (id, opts) =>
        respond(S.visit, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.visits.find((v) => v.id === id && v.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status === "closed") {
            return refuse(409, "conflict", "That visit is already closed.");
          }
          found.status = "closed";
          found.ended_at = clock().toISOString();
          const wired = wireVisit(found, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Visit);
        }),

      createNote: (visitIdValue, content, opts) =>
        respond(S.note, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const parentVisit = state.visits.find((v) => v.id === visitIdValue && v.clinic_id === caller.clinic.id);
          if (parentVisit === undefined) {
            return notFound;
          }
          if (parentVisit.status === "closed") {
            return refuse(409, "conflict", "That visit is closed.");
          }
          const kindParsed = S.noteKind.safeParse(content.kind ?? "soap");
          if (!kindParsed.success) {
            return invalid("kind", "unknown note kind");
          }
          const now = clock().toISOString();
          const record: FakeNote = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            visit_id: visitIdValue,
            author_membership_id: caller.membership.id,
            kind: kindParsed.data,
            source: "typed",
            status: "draft",
            sections: {
              subjective: content.sections?.subjective ?? null,
              objective: content.sections?.objective ?? null,
              assessment: content.sections?.assessment ?? null,
              plan: content.sections?.plan ?? null,
            },
            addenda: [],
            signed_at: null,
            created_at: now,
            updated_at: now,
          };
          state.notes.push(record);
          const wired = wireNote(record, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Note);
        }),

      editNote: (id, content, opts) =>
        respond(S.note, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.notes.find((n) => n.id === id && n.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.author_membership_id !== caller.membership.id) {
            return refuse(403, "forbidden", "Only the author may change this note.");
          }
          if (found.status !== "draft") {
            return refuse(409, "conflict", "A signed note can't be changed; add an addendum.");
          }
          found.sections = {
            subjective: content.sections?.subjective ?? null,
            objective: content.sections?.objective ?? null,
            assessment: content.sections?.assessment ?? null,
            plan: content.sections?.plan ?? null,
          };
          found.updated_at = clock().toISOString();
          const wired = wireNote(found, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Note);
        }),

      signNote: (id, opts) =>
        respond(S.note, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.notes.find((n) => n.id === id && n.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.author_membership_id !== caller.membership.id) {
            return refuse(403, "forbidden", "Only the author may sign this note.");
          }
          if (found.status !== "draft") {
            return refuse(409, "conflict", "That note can't be signed any more.");
          }
          const hasContent = [found.sections.subjective, found.sections.objective, found.sections.assessment, found.sections.plan].some(
            (section) => section != null && section.trim() !== "",
          );
          if (!hasContent) {
            return invalid("sections", "write at least one section before signing");
          }
          const now = clock().toISOString();
          found.status = "signed";
          found.signed_at = now;
          found.updated_at = now;
          const wired = wireNote(found, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Note);
        }),

      addAddendum: (id, input, opts) =>
        respond(S.note, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.notes.find((n) => n.id === id && n.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "signed") {
            return refuse(409, "conflict", "Only a signed note takes an addendum.");
          }
          const body = input.body.trim();
          if (body.length < 1 || body.length > 10_000) {
            return invalid("body", "must be 1 to 10,000 characters");
          }
          found.addenda.push({ id: fakeUuid(random, clock()), author_membership_id: caller.membership.id, body, created_at: clock().toISOString() });
          const wired = wireNote(found, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Note);
        }),

      recordObservations: (visitIdValue, input, opts) =>
        respond(S.observationList, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const parentVisit = state.visits.find((v) => v.id === visitIdValue && v.clinic_id === caller.clinic.id);
          if (parentVisit === undefined) {
            return notFound;
          }
          if (input.readings.length < 1 || input.readings.length > 20) {
            return invalid("readings", "give 1 to 20 readings");
          }
          const sourceParsed = S.clinicalSource.safeParse(input.source ?? "clinician");
          if (!sourceParsed.success) {
            return invalid("source", "unknown source");
          }
          const now = clock();
          const recordedAt = input.recorded_at ?? now.toISOString();
          const created: FakeObservation[] = [];
          for (const reading of input.readings) {
            const kindParsed = S.observationKind.safeParse(reading.kind);
            if (!kindParsed.success) {
              return invalid("kind", "unknown reading kind");
            }
            created.push({
              id: fakeUuid(random, now),
              clinic_id: caller.clinic.id,
              patient_id: parentVisit.patient_id,
              visit_id: visitIdValue,
              kind: kindParsed.data,
              value: reading.value,
              unit: reading.unit ?? OBSERVATION_UNITS[kindParsed.data],
              status: "final",
              source: sourceParsed.data,
              supersedes_id: reading.supersedes_id ?? null,
              recorded_at: recordedAt,
            });
          }
          state.observations.push(...created);
          return reply({ items: created.map(wireObservation) } satisfies C.ObservationList);
        }),

      listPlans: (id, opts) =>
        respond(S.planList, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const items = state.plans
            .filter((p) => p.clinic_id === caller.clinic.id && p.patient_id === id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .flatMap((p) => {
              const wired = wirePlan(p, state);
              return wired === undefined ? [] : [wired];
            });
          return reply({ items } satisfies C.PlanList);
        }),

      createPlan: (id, input, opts) =>
        respond(S.plan, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const title = input.title.trim();
          if (title.length < 1 || title.length > 200) {
            return invalid("title", "must be 1 to 200 characters");
          }
          if (input.items.length < 1 || input.items.length > 50) {
            return invalid("items", "give 1 to 50 items");
          }
          const items: FakePlanItem[] = [];
          for (const item of input.items) {
            const name = (item.name ?? "").trim();
            if (name.length < 1 || name.length > 200) {
              return invalid("items", "each item needs a name of 1 to 200 characters");
            }
            if (!Number.isInteger(item.estimate_paise) || item.estimate_paise < 0) {
              return invalid("items", "each estimate must be zero or more paise");
            }
            items.push({
              id: fakeUuid(random, clock()),
              name,
              tooth: item.tooth ?? null,
              surfaces: parseSurfaces(item.surfaces),
              phase: item.phase ?? 1,
              estimate_paise: item.estimate_paise,
              status: "proposed",
              procedure_id: null,
            });
          }
          const record: FakePlan = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            patient_id: id,
            visit_id: input.visit_id ?? null,
            clinician_membership_id: caller.membership.id,
            title,
            status: "proposed",
            items,
            created_at: clock().toISOString(),
            accepted_at: null,
          };
          state.plans.push(record);
          const wired = wirePlan(record, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Plan);
        }),

      acceptPlan: (id, input, opts) =>
        respond(S.plan, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.plans.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "proposed") {
            return refuse(409, "conflict", "Only a proposed plan can be accepted.");
          }
          const chosen = input.item_ids ?? found.items.map((i) => i.id);
          for (const item of found.items) {
            item.status = chosen.includes(item.id) ? "accepted" : "cancelled";
          }
          found.status = "accepted";
          found.accepted_at = clock().toISOString();
          const wired = wirePlan(found, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Plan);
        }),

      setPlanItemStatus: (itemId, status, opts) =>
        respond(S.plan, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.plans.find((p) => p.clinic_id === caller.clinic.id && p.items.some((i) => i.id === itemId));
          const item = found?.items.find((i) => i.id === itemId);
          if (found === undefined || item === undefined) {
            return notFound;
          }
          if (item.status !== "accepted") {
            return refuse(409, "conflict", "Only an accepted item can be finished.");
          }
          item.status = status;
          found.status = found.items.some((i) => i.status === "accepted") ? "in_progress" : "completed";
          const wired = wirePlan(found, state);
          return wired === undefined ? notFound : reply(wired satisfies C.Plan);
        }),

      listProcedures: (id, opts) =>
        respond(S.procedureList, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const items = state.procedures
            .filter((p) => p.clinic_id === caller.clinic.id && p.patient_id === id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .flatMap((p) => {
              const wired = wireProcedure(p, state);
              return wired === undefined ? [] : [wired];
            });
          return reply({ items } satisfies C.ProcedureList);
        }),

      recordProcedure: (visitIdValue, input, opts) =>
        respond(S.procedure, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const parentVisit = state.visits.find((v) => v.id === visitIdValue && v.clinic_id === caller.clinic.id);
          if (parentVisit === undefined) {
            return notFound;
          }
          const name = (input.name ?? "").trim();
          if (name.length < 1 || name.length > 200) {
            return invalid("name", "must be 1 to 200 characters");
          }
          const statusParsed = S.procedureStatus.safeParse(input.status ?? "done");
          if (!statusParsed.success || statusParsed.data === "entered_in_error") {
            return invalid("status", "must be done or planned");
          }
          const surfaces = parseSurfaces(input.surfaces);
          const now = clock().toISOString();
          const record: FakeProcedure = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            patient_id: parentVisit.patient_id,
            visit_id: visitIdValue,
            clinician_membership_id: caller.membership.id,
            name,
            tooth: input.tooth ?? null,
            surfaces,
            status: statusParsed.data,
            note: input.note ?? null,
            price_paise: input.price_paise ?? null,
            plan_item_id: input.plan_item_id ?? null,
            performed_at: statusParsed.data === "done" ? now : null,
            created_at: now,
          };
          state.procedures.push(record);
          if (record.plan_item_id != null && record.status === "done") {
            markPlanItemDone(state, record.plan_item_id, record.id);
          }
          const wired = wireProcedure(record, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Procedure);
        }),

      completeProcedure: (id, opts) =>
        respond(S.procedure, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.procedures.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "planned") {
            return refuse(409, "conflict", "That procedure is already finished.");
          }
          found.status = "done";
          found.performed_at = clock().toISOString();
          const wired = wireProcedure(found, state);
          if (wired === undefined) {
            return notFound;
          }
          return reply(wired satisfies C.Procedure);
        }),

      getDentalChart: (id, tooth, opts) =>
        respond(S.dentalChart, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const current = state.chartEntries.filter((c) => c.clinic_id === caller.clinic.id && c.patient_id === id && c.status === "current");
          const history =
            tooth === undefined
              ? []
              : state.chartEntries
                  .filter((c) => c.clinic_id === caller.clinic.id && c.patient_id === id && c.tooth === tooth)
                  .sort((a, b) => b.effective_at.localeCompare(a.effective_at));
          return reply({ current: current.map((c) => wireChartEntry(c, state)), history: history.map((c) => wireChartEntry(c, state)), terms: clinicTerms(state.dentalTerms, caller.clinic.id) } satisfies C.DentalChart);
        }),

      recordChartEntries: (id, input, opts) =>
        respond(S.dentalChart, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          if (input.entries.length < 1 || input.entries.length > 64) {
            return invalid("entries", "give 1 to 64 entries");
          }
          const now = clock().toISOString();
          for (const entry of input.entries) {
            const findingParsed = S.chartFinding.safeParse(entry.finding);
            if (!findingParsed.success) {
              return invalid("finding", "unknown finding");
            }
            const terms = clinicTerms(state.dentalTerms, caller.clinic.id);
            for (const kind of ["procedure", "material"] as const) {
              const wanted = entry[kind];
              if (wanted != null && !terms.some((t) => t.kind === kind && t.id === wanted)) {
                return invalid("entries", `unknown ${kind}`);
              }
            }
            if (findingParsed.data === "sound" && (entry.procedure != null || entry.material != null)) {
              return invalid("entries", "sound clears the tooth; leave the procedure and material out");
            }
            const surface = entry.surface ?? null;
            const existing = state.chartEntries.find(
              (c) =>
                c.clinic_id === caller.clinic.id &&
                c.patient_id === id &&
                c.status === "current" &&
                c.tooth === entry.tooth &&
                (c.surface ?? null) === surface,
            );
            if (existing !== undefined) {
              existing.status = "superseded";
            }
            const record: FakeChartEntry = {
              id: fakeUuid(random, clock()),
              clinic_id: caller.clinic.id,
              patient_id: id,
              tooth: entry.tooth,
              surface: parseSurface(surface),
              finding: findingParsed.data,
              procedure: entry.procedure ?? null,
              material: entry.material ?? null,
              note: entry.note ?? null,
              status: "current",
              recorded_by: caller.membership.id,
              supersedes_id: existing?.id ?? null,
              visit_id: input.visit_id ?? null,
              effective_at: now,
            };
            state.chartEntries.push(record);
          }
          const current = state.chartEntries.filter((c) => c.clinic_id === caller.clinic.id && c.patient_id === id && c.status === "current");
          return reply({ current: current.map((c) => wireChartEntry(c, state)), history: [], terms: clinicTerms(state.dentalTerms, caller.clinic.id) } satisfies C.DentalChart);
        }),

      addDentalTerm: (input, opts) =>
        respond(S.dentalTerm, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const kind = S.dentalTermKind.safeParse(input.kind);
          if (!kind.success) {
            return invalid("kind", "must be procedure or material");
          }
          const label = input.label.split(/\s+/).filter((w) => w !== "").join(" ");
          if (label.length < 1 || label.length > 80) {
            return invalid("label", "label must be 1 to 80 characters");
          }
          const found = clinicTerms(state.dentalTerms, caller.clinic.id).find(
            (t) => t.kind === kind.data && (t.id === label || t.label.toLowerCase() === label.toLowerCase()),
          );
          if (found !== undefined) {
            return reply(found satisfies C.DentalTerm);
          }
          const term = { id: fakeUuid(random, clock()), clinic_id: caller.clinic.id, kind: kind.data, label };
          (state.dentalTerms ??= []).push(term);
          return reply({ id: term.id, kind: term.kind, label, own: true } satisfies C.DentalTerm);
        }),

      listAttachments: (id, opts) =>
        respond(S.attachmentList, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const items = state.attachments
            .filter((a) => a.clinic_id === caller.clinic.id && a.patient_id === id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map(wireAttachment);
          return reply({ items } satisfies C.AttachmentList);
        }),

      uploadAttachment: (id, form, opts) =>
        respond(S.attachment, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!clinicPatients(caller).some((p) => p.id === id)) {
            return notFound;
          }
          const file = form.get("file");
          if (!(file instanceof File)) {
            return invalid("file", "choose a file");
          }
          if (file.size > 10 * 1024 * 1024) {
            return refuse(413, "payload_too_large", "That file is larger than 10 MB.");
          }
          const kindParsed = S.attachmentKind.safeParse(form.get("kind") ?? "document");
          if (!kindParsed.success) {
            return invalid("kind", "unknown file kind");
          }
          const captionRaw = form.get("caption");
          const labelRaw = form.get("label");
          const toothRaw = form.get("tooth");
          const visitRaw = form.get("visit_id");
          const noteRaw = form.get("note_id");
          const addendumRaw = form.get("addendum_id");
          const durationRaw = form.get("duration_seconds");
          const languageRaw = form.get("language");
          const linkedNote =
            typeof noteRaw === "string" && noteRaw !== "" ? state.notes.find((n) => n.id === noteRaw && n.clinic_id === caller.clinic.id) : undefined;
          if (typeof noteRaw === "string" && noteRaw !== "") {
            if (linkedNote === undefined) {
              return notFound;
            }
            if (linkedNote.status === "draft" ? linkedNote.author_membership_id !== caller.membership.id : typeof addendumRaw !== "string" || addendumRaw === "") {
              return invalid("note_id", "that note takes no recording from you");
            }
          }
          if (kindParsed.data === "audio") {
            const seconds = typeof durationRaw === "string" ? Number.parseInt(durationRaw, 10) : Number.NaN;
            if (!(seconds >= 1 && seconds <= 600)) {
              return invalid("duration_seconds", "must be 1 to 600");
            }
          }
          if (linkedNote?.status === "draft") {
            linkedNote.source = "voice";
          }
          if (typeof labelRaw === "string" && labelRaw.trim().length > 60) {
            return invalid("label", "must be at most 60 characters");
          }
          const toothParsed = typeof toothRaw === "string" && toothRaw !== "" ? Number.parseInt(toothRaw, 10) : undefined;
          const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : `blob:fake/${fakeUuid(random, clock())}`;
          const record: FakeAttachment = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            patient_id: id,
            visit_id: linkedNote?.visit_id ?? (typeof visitRaw === "string" && visitRaw !== "" ? visitRaw : null),
            note_id: linkedNote?.id ?? null,
            addendum_id: typeof addendumRaw === "string" && addendumRaw !== "" ? addendumRaw : null,
            duration_seconds: typeof durationRaw === "string" && durationRaw !== "" ? Number.parseInt(durationRaw, 10) : null,
            language: typeof languageRaw === "string" && languageRaw !== "" ? languageRaw : null,
            kind: kindParsed.data,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
            sha256: random.hex(64),
            caption: typeof captionRaw === "string" && captionRaw !== "" ? captionRaw : null,
            label: typeof labelRaw === "string" && labelRaw.trim() !== "" ? labelRaw.trim() : null,
            tooth: toothParsed ?? null,
            taken_at: null,
            created_at: clock().toISOString(),
            url,
          };
          state.attachments.push(record);
          return reply(wireAttachment(record) satisfies C.Attachment);
        }),

      getDownloadLink: (id, opts) =>
        respond(S.downloadLink, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.attachments.find((a) => a.id === id && a.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          return reply({ url: found.url, expires_at: new Date(clock().getTime() + 5 * 60_000).toISOString() } satisfies C.DownloadLink);
        }),

      setAttachmentSharing: (id, sharing, opts) =>
        respond(S.fileSharing, opts?.signal, async () => {
          const caller = await inClinic("clinical.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.attachments.find((a) => a.id === id && a.clinic_id === caller.clinic.id && a.kind !== "audio");
          if (found === undefined) {
            return notFound;
          }
          found.shared_with_patient = sharing.shared_with_patient;
          return reply({ shared_with_patient: sharing.shared_with_patient } satisfies C.FileSharing);
        }),

      getPatientAppAccess: (id, opts) =>
        respond(S.patientAppAccess, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const patient = clinicPatients(caller).find((p) => p.id === id);
          if (patient === undefined) {
            return notFound;
          }
          const access = appAccessOf(id);
          return reply({ links: access.links, code_expires_at: access.code_expires_at, has_email: patient.email != null } satisfies C.PatientAppAccess);
        }),

      invitePatientToApp: (id, opts) =>
        respond(S.patientAppInvitation, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const patient = clinicPatients(caller).find((p) => p.id === id);
          if (patient === undefined) {
            return notFound;
          }
          if (patient.email == null) {
            return refuse(409, "conflict", "add the patient's email first: they sign in to the app with it");
          }
          const alphabet = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "M", "N", "P", "Q", "R", "S", "T", "V", "W", "X", "Y", "Z"];
          const half = () => Array.from({ length: 5 }, () => random.pick(alphabet)).join("");
          const expires = new Date(clock().getTime() + 7 * 86_400_000).toISOString();
          appAccessOf(id).code_expires_at = expires;
          return reply({ code: `${half()}-${half()}`, expires_at: expires, emailed: true } satisfies C.PatientAppInvitation);
        }),

      decidePatientLink: (id, decision, opts) =>
        respond(S.patientLinkDecided, opts?.signal, async () => {
          const caller = await inClinic("patients.write");
          if (!isCaller(caller)) {
            return caller;
          }
          for (const patient of clinicPatients(caller)) {
            const link = appAccess.get(patient.id)?.links.find((l) => l.id === id);
            if (link === undefined) {
              continue;
            }
            const from = decision === "revoke" ? "active" : "pending";
            if (link.status !== from) {
              return notFound;
            }
            link.status = decision === "confirm" ? "active" : decision === "decline" ? "declined" : "revoked";
            if (decision === "confirm") {
              link.linked_at = clock().toISOString();
            }
            if (decision === "revoke") {
              link.revoked_at = clock().toISOString();
            }
            return reply({ id, status: link.status } satisfies C.PatientLinkDecided);
          }
          return notFound;
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
          const role = roleByKey(input.role_key, caller.clinic.id);
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
          const nextRole = changes.role_key == null ? undefined : roleByKey(changes.role_key, caller.clinic.id);
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
          // Both the team list (staff.manage) and the roles editor (roles.manage) need the list.
          let caller = await inClinic("staff.manage");
          if (!isCaller(caller) && !caller.ok && caller.status === 403) {
            caller = await inClinic("roles.manage");
          }
          if (!isCaller(caller)) {
            return caller;
          }
          const items = rolesOf(caller.clinic.id)
            .map((role): C.Role => wireRole(caller.clinic.id, role))
            .sort((a, b) => Number(b.is_template) - Number(a.is_template) || a.name.localeCompare(b.name));
          return reply({ items } satisfies C.Roles);
        }),

      getAccessCatalogue: (opts) =>
        respond(S.accessCatalogue, opts?.signal, async () => {
          const caller = await inClinic("roles.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const templates = Object.values(ROLES)
            .map(
              (t): C.RoleTemplate => ({
                key: t.key,
                name: t.name,
                description: t.name,
                permissions: sortGrants(t.permissions.map((key) => ({ key, scope: "all" }))),
              }),
            )
            .sort((a, b) => a.name.localeCompare(b.name));
          return reply({ permissions: PERMISSION_CATALOGUE.map((p) => ({ ...p, scopes: [...p.scopes] })), templates } satisfies C.AccessCatalogue);
        }),

      getRole: (key, opts) =>
        respond(S.roleDetail, opts?.signal, async () => {
          const caller = await inClinic("roles.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const role = rolesOf(caller.clinic.id).find((r) => r.key === key);
          return role === undefined ? notFound : reply(roleDetailOf(caller.clinic.id, role));
        }),

      setRolePermissions: (key, update, opts) =>
        respond(S.savedRole, opts?.signal, async () => {
          const caller = await inClinic("roles.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const role = rolesOf(caller.clinic.id).find((r) => r.key === key);
          if (role === undefined) {
            return notFound;
          }
          if (role.key === "owner") {
            return refuse(403, "forbidden", "the owner role always has full access and can't be changed or removed");
          }
          if (role.key === caller.membership.role.key) {
            return refuse(409, "conflict", "you can't change your own role's access; ask an owner");
          }
          const grants: C.RolePermission[] = [];
          for (const item of update.permissions) {
            const entry = PERMISSION_CATALOGUE.find((p) => p.key === item.key);
            const scope = item.scope ?? "all";
            if (entry === undefined) {
              return invalid("permissions", `unknown permission ${item.key}`);
            }
            if (scope !== "all" && scope !== "own" && scope !== "assigned") {
              return invalid("permissions", "scope must be all, own or assigned");
            }
            if (!entry.scopes.includes(scope)) {
              return invalid("permissions", `${item.key} can't be limited to ${scope} records`);
            }
            if (grants.some((g) => g.key === item.key)) {
              return invalid("permissions", `${item.key} is listed twice`);
            }
            grants.push({ key: item.key, scope });
          }
          const held: readonly string[] = caller.membership.role.permissions;
          const granting = grants.some((g) => !held.includes(g.key) && !role.permissions.some((p) => p.key === g.key && (p.scope === "all" || p.scope === g.scope)));
          if (granting) {
            return refuse(403, "forbidden", "you can only give access you have yourself");
          }
          const after = sortGrants(grants);
          const changed = JSON.stringify(after) !== JSON.stringify(role.permissions);
          if (changed) {
            role.history.unshift({
              id: fakeUuid(random, clock()),
              action: "permissions_changed",
              at: clock().toISOString(),
              changed_by: caller.user.id,
              changed_by_name: caller.user.display_name,
              before: role.permissions,
              after,
            });
            setGrants(caller.clinic.id, role, after);
          }
          return reply({ id: role.key, key: role.key, name: role.name, description: role.description, is_template: role.isTemplate, permissions: after, changed } satisfies C.SavedRole);
        }),

      createRole: (input, opts) =>
        respond(S.roleDetail, opts?.signal, async () => {
          const caller = await inClinic("roles.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const name = input.name.trim();
          if (name === "" || name.length > 80) {
            return invalid("name", "must be 1 to 80 characters");
          }
          const key = (input.key ?? name.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "")).slice(0, 40);
          if (!/^[a-z_]{2,40}$/.test(key)) {
            return invalid("key", "use 2 to 40 lower-case letters a to z and underscores");
          }
          if (input.template_key === "owner") {
            return invalid("template_key", "start from another role; only the owner role has full access");
          }
          const template = rolesOf(caller.clinic.id).find((r) => r.isTemplate && r.key === input.template_key);
          if (template === undefined) {
            return invalid("template_key", "is not a standard role");
          }
          const roles = rolesOf(caller.clinic.id);
          if (roles.some((r) => r.key === key)) {
            return refuse(409, "conflict", "a role with that key already exists");
          }
          const defaults = sortGrants(Object.values(ROLES).find((t) => t.key === template.key)?.permissions.map((k) => ({ key: k, scope: "all" as const })) ?? []);
          const role: ClinicRole = {
            key,
            name,
            description: input.description ?? null,
            isTemplate: false,
            templateKey: template.key,
            permissions: defaults,
            history: [{ id: fakeUuid(random, clock()), action: "created", at: clock().toISOString(), changed_by: caller.user.id, changed_by_name: caller.user.display_name, before: [], after: defaults }],
            role: asFakeRole(key, name, defaults),
          };
          roles.push(role);
          return reply(roleDetailOf(caller.clinic.id, role));
        }),

      deleteRole: (key, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("roles.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const roles = rolesOf(caller.clinic.id);
          const role = roles.find((r) => r.key === key);
          if (role === undefined) {
            return notFound;
          }
          if (role.key === "owner") {
            return refuse(403, "forbidden", "the owner role always has full access and can't be changed or removed");
          }
          if (role.isTemplate) {
            return refuse(409, "conflict", "standard roles can be edited or reset, not removed");
          }
          if (membersWith(caller.clinic.id, key) > 0) {
            return refuse(409, "conflict", "people still have this role or are invited with it; move them to another role first");
          }
          roles.splice(roles.indexOf(role), 1);
          return reply(undefined);
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
          if (changes.letterhead != null) {
            const letterheadProblem = validateLetterheadChanges(changes.letterhead, clinic, state.practitioners);
            if (letterheadProblem !== null) {
              return letterheadProblem;
            }
            applyLetterheadChanges(clinic, changes.letterhead);
          }
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
          if (changes.online_booking != null) {
            const next = { ...bookingSettings(clinic) };
            for (const [key, value] of Object.entries(changes.online_booking)) {
              if (value != null) {
                Object.assign(next, { [key]: value });
              }
            }
            clinic.online_booking = next;
          }
          if (changes.branding !== undefined) {
            const rawMode = changes.branding?.mode ?? undefined;
            clinic.branding = {
              brand: changes.branding?.brand ?? clinic.branding.brand,
              mode: (rawMode === undefined ? undefined : parseThemeMode(rawMode)) ?? clinic.branding.mode,
            };
          }
          return reply(wireClinicSettings(clinic) satisfies C.ClinicSettings);
        }),

      getLetterhead: (opts) =>
        respond(S.letterheadDocument, opts?.signal, async () => {
          const caller = await inClinic("patients.read");
          if (!isCaller(caller)) {
            return caller;
          }
          return reply(wireLetterheadDocument(caller.clinic, state.practitioners) satisfies C.LetterheadDocument);
        }),

      uploadLetterheadImage: (slot, form, opts) =>
        respond(S.letterhead, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const file = form.get("file");
          if (!(file instanceof File) || file.size === 0) {
            return invalid("image", "image must be a PNG or JPEG of at most 2 MB");
          }
          if (file.size > 2 * 1024 * 1024) {
            return refuse(413, "payload_too_large", "image: must be at most 2 MB");
          }
          if (file.type !== "image/png" && file.type !== "image/jpeg") {
            return invalid("image", "image must be a PNG or JPEG of at most 2 MB");
          }
          const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : `blob:fake/${fakeUuid(random, clock())}`;
          caller.clinic.letterhead_images = { ...caller.clinic.letterhead_images, [slot]: url };
          return reply(wireLetterhead(caller.clinic) satisfies C.Letterhead);
        }),

      removeLetterheadImage: (slot, opts) =>
        respond(S.letterhead, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const images = caller.clinic.letterhead_images ?? {};
          caller.clinic.letterhead_images = {
            ...(slot !== "letterhead" && images.letterhead !== undefined ? { letterhead: images.letterhead } : {}),
            ...(slot !== "logo" && images.logo !== undefined ? { logo: images.logo } : {}),
          };
          return reply(wireLetterhead(caller.clinic) satisfies C.Letterhead);
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
                  address_status: c.address_status ?? "ready",
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
              address_status: "pending",
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

      getQuality: (limit, opts) =>
        respond(S.qualityReport, opts?.signal, () =>
          inConsole(() => {
            const runs = state.quality.runs.slice(0, limit ?? 30);
            return reply({ ...state.quality, runs } satisfies C.QualityReport);
          }),
        ),

      submitRegistration: (input, opts) =>
        respond(S.registrationReceived, opts?.signal, () => {
          const clinicName = input.clinic_name.trim();
          const city = input.city.trim();
          const contactName = input.contact_name.trim();
          const email = input.email.trim();
          if (clinicName.length < 2) return invalid("clinic_name", "enter the clinic's name");
          if (city.length < 2) return invalid("city", "enter the clinic's city");
          if (contactName.length < 2) return invalid("contact_name", "enter a contact name");
          if (!EMAIL.test(email)) return invalid("email", "invalid email address");
          const specialty = input.specialty === "general" ? "general" : "dental";
          const now = clock();
          const existing = state.applications.find((a) => a.status === "pending" && a.email.toLowerCase() === email.toLowerCase());
          if (existing !== undefined) {
            existing.submissions += 1;
            existing.clinic_name = clinicName;
            existing.city = city;
            existing.specialty = specialty;
            existing.contact_name = contactName;
            existing.phone = input.phone ?? existing.phone ?? null;
            existing.message = input.message ?? existing.message ?? null;
            existing.updated_at = now.toISOString();
          } else {
            state.applications.push({
              id: fakeUuid(random, now),
              clinic_name: clinicName,
              city,
              specialty,
              contact_name: contactName,
              email,
              phone: input.phone ?? null,
              message: input.message ?? null,
              status: "pending",
              submissions: 1,
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            });
          }
          return reply({
            status: "received",
            message: "Thanks. We'll be in touch within a couple of working days.",
          } satisfies C.RegistrationReceived);
        }),

      listApplications: (status, opts) =>
        respond(S.applications, opts?.signal, () =>
          inConsole(() => {
            const items = state.applications
              .filter((a) => status === undefined || a.status === status)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map(wireApplication);
            return reply({ items } satisfies C.Applications);
          }),
        ),

      checkSlug: (query, opts) =>
        respond(S.slugCheck, opts?.signal, () =>
          inConsole(() => {
            const typed = query.slug?.trim() ?? "";
            const slug = typed === "" ? deriveSlug(query.name) : typed;
            const host = `${slug}.localtest.me`;
            if (!SLUG.test(slug) || slug.includes("--") || RESERVED_SLUGS.has(slug)) {
              const problem = RESERVED_SLUGS.has(slug) ? "is reserved" : "use 3 to 30 lowercase letters, digits or single hyphens";
              return reply({ slug, portal_host: host, available: false, problem, suggestions: [deriveSlug(query.name)] } satisfies C.SlugCheck);
            }
            const taken = (s: string) => state.clinics.some((c) => c.slug === s);
            if (!taken(slug)) {
              return reply({ slug, portal_host: host, available: true, problem: null, suggestions: [] } satisfies C.SlugCheck);
            }
            const city = query.city === undefined ? "" : deriveSlug(query.city);
            const candidates = [city === "" ? "" : `${slug}-${city}`, `${slug}-${random.hex(3).slice(0, 3)}`, `${slug}-${random.hex(3).slice(0, 3)}`];
            const suggestions = candidates.filter((s) => s !== "" && SLUG.test(s) && !taken(s));
            return reply({ slug, portal_host: host, available: false, problem: null, suggestions } satisfies C.SlugCheck);
          }),
        ),

      approveApplication: (id, input, opts) =>
        respond(S.approvedApplication, opts?.signal, async () => {
          const callerId = await subject();
          return inConsole(() => {
            const application = state.applications.find((a) => a.id === id);
            if (application === undefined || application.status !== "pending") {
              return notFound;
            }
            const slug = input.slug ?? deriveSlug(application.clinic_name);
            const problem = validateNewClinic(
              { name: application.clinic_name, slug, specialty: application.specialty, owner_email: application.email },
              slug,
              state.clinics,
            );
            if (problem !== null) {
              return problem;
            }
            const now = clock();
            const clinic: FakeClinic = {
              id: fakeUuid(random, now),
              slug,
              name: application.clinic_name,
              host: `${slug}.localtest.me`,
              timezone: "Asia/Kolkata",
              branding: { brand: "#14a89a", mode: "light" },
              specialty: application.specialty,
              status: "trial",
              created_at: now.toISOString(),
              number_prefix: slug.slice(0, 2).toUpperCase(),
              address_status: "pending",
            };
            state.clinics.push(clinic);
            const invitationId = fakeUuid(random, now);
            const token = random.hex(32);
            const expiresAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
            invitations.set(token, {
              id: invitationId,
              clinicId: clinic.id,
              email: application.email,
              roleKey: "owner",
              createdAt: now.toISOString(),
              expiresAt,
              used: false,
            });
            application.status = "approved";
            application.clinic_id = clinic.id;
            application.decided_at = now.toISOString();
            application.decided_by = callerId ?? null;
            application.updated_at = now.toISOString();
            return reply({
              clinic_id: clinic.id,
              slug,
              portal_host: clinic.host,
              invitation_id: invitationId,
              invite_link: `https://${clinic.host}/invite#${token}`,
              invite_expires_at: expiresAt,
              account_ready: true,
            } satisfies C.ApprovedApplication);
          });
        }),

      rejectApplication: (id, input, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const callerId = await subject();
          return inConsole(() => {
            const application = state.applications.find((a) => a.id === id);
            if (application === undefined || application.status !== "pending") {
              return notFound;
            }
            const now = clock();
            application.status = "rejected";
            application.decided_at = now.toISOString();
            application.decided_by = callerId ?? null;
            application.decision_reason = input.reason ?? null;
            application.updated_at = now.toISOString();
            return { ok: true, body: undefined };
          });
        }),

      getClinicDetail: (id, opts) =>
        respond(S.clinicDetail, opts?.signal, () =>
          inConsole(() => {
            const clinic = state.clinics.find((c) => c.id === id);
            if (clinic === undefined) {
              return notFound;
            }
            const members = state.memberships.filter((m) => m.clinic_id === clinic.id).map((m) => wireClinicMember(m, state));
            const now = clock().toISOString();
            const pending = [...invitations.entries()]
              .filter(([, inv]) => inv.clinicId === clinic.id && !inv.used && inv.expiresAt > now)
              .map(
                ([, inv]): C.ClinicInvitation => ({
                  id: inv.id,
                  email: inv.email,
                  role_key: inv.roleKey,
                  role_name: roleByKey(inv.roleKey)?.name ?? inv.roleKey,
                  expires_at: inv.expiresAt,
                  created_at: inv.createdAt,
                }),
              )
              .sort((a, b) => b.created_at.localeCompare(a.created_at));
            return reply({
              id: clinic.id,
              slug: clinic.slug,
              name: clinic.name,
              specialty: clinic.specialty,
              status: clinic.status,
              timezone: clinic.timezone,
              created_at: clinic.created_at,
              hosts: [clinic.host],
              address_status: clinic.address_status ?? "ready",
              address_error: clinic.address_error ?? null,
              active_members: members.filter((m) => m.status === "active").length,
              patients: state.patients.filter((p) => p.clinic_id === clinic.id).length,
              pending_invitations: pending.length,
              members,
              invitations: pending,
            } satisfies C.ClinicDetail);
          }),
        ),

      inviteToClinic: (id, input, opts) =>
        respond(S.clinicInvited, opts?.signal, () =>
          inConsole(() => {
            const clinic = state.clinics.find((c) => c.id === id);
            if (clinic === undefined) {
              return notFound;
            }
            if (!EMAIL.test(input.email)) {
              return invalid("email", "invalid email address");
            }
            const role = roleByKey(input.role_key);
            if (role === undefined) {
              return invalid("role_key", "unknown role");
            }
            const now = clock();
            const invitationId = fakeUuid(random, now);
            const token = random.hex(32);
            const expiresAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
            invitations.set(token, {
              id: invitationId,
              clinicId: clinic.id,
              email: input.email,
              roleKey: role.key,
              createdAt: now.toISOString(),
              expiresAt,
              used: false,
            });
            return reply({
              id: invitationId,
              email: input.email,
              role_key: role.key,
              invite_link: `https://${clinic.host}/invite#${token}`,
              expires_at: expiresAt,
              account_ready: true,
            } satisfies C.ClinicInvited);
          }),
        ),

      resendOwnerInvitation: (id, opts) =>
        respond(S.resentOwnerInvitation, opts?.signal, () =>
          inConsole(() => {
            const clinic = state.clinics.find((c) => c.id === id);
            if (clinic === undefined) {
              return notFound;
            }
            const owner = [...invitations.entries()]
              .filter(([, inv]) => inv.clinicId === clinic.id && inv.roleKey === "owner")
              .sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt))[0];
            if (owner === undefined) {
              return notFound;
            }
            const [oldToken, invitation] = owner;
            if (invitation.used) {
              return refuse(409, "conflict", "The owner has already joined.");
            }
            invitations.delete(oldToken);
            const token = random.hex(32);
            const expiresAt = new Date(clock().getTime() + 7 * 86_400_000).toISOString();
            invitations.set(token, { ...invitation, expiresAt });
            return reply({
              id: invitation.id,
              email: invitation.email,
              invite_link: `https://${clinic.host}/invite#${token}`,
              expires_at: expiresAt,
            } satisfies C.ResentOwnerInvitation);
          }),
        ),

      searchDrugs: (input, opts) =>
        respond(S.drugList, opts?.signal, async () => {
          const caller = await inClinic("prescriptions.issue");
          if (!isCaller(caller)) {
            return caller;
          }
          const q = (input.q ?? "").trim().toLowerCase();
          const limit = input.limit ?? 20;
          const matches = state.drugs.filter(
            (d) => q === "" || d.generic_name.toLowerCase().includes(q) || (d.brand_name ?? "").toLowerCase().includes(q) || d.strength.toLowerCase().includes(q),
          );
          const sorted = matches.sort((a, b) => {
            const aStarts = a.generic_name.toLowerCase().startsWith(q) ? 0 : 1;
            const bStarts = b.generic_name.toLowerCase().startsWith(q) ? 0 : 1;
            return aStarts - bStarts || a.generic_name.localeCompare(b.generic_name);
          });
          return reply({ items: sorted.slice(0, limit).map(wireDrug) } satisfies C.DrugList);
        }),

      listPriceItems: (opts) =>
        respond(S.priceItemList, opts?.signal, async () => {
          const caller = await inClinic("billing.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = state.priceItems
            .filter((p) => p.clinic_id === caller.clinic.id)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(wirePriceItem);
          return reply({ items } satisfies C.PriceItemList);
        }),

      addPriceItem: (input, opts) =>
        respond(S.priceItem, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const name = (input.name ?? "").trim();
          if (name.length < 1) {
            return invalid("name", "name is required");
          }
          const price = input.price_paise;
          if (price == null || !Number.isInteger(price) || price < 0) {
            return invalid("price_paise", "price_paise is required");
          }
          const code = input.code == null || input.code === "" ? null : input.code;
          if (code !== null && state.priceItems.some((p) => p.clinic_id === caller.clinic.id && p.code === code)) {
            return refuse(409, "conflict", "another entry has this code");
          }
          const gstRate = input.gst_rate ?? 0;
          const taxable = input.taxable ?? gstRate > 0;
          const item: FakePriceItem = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            name,
            code,
            category: input.category ?? null,
            price_paise: price,
            taxable,
            gst_rate: gstRate,
            sac_hsn: input.sac_hsn ?? null,
            active: input.active ?? true,
          };
          state.priceItems.push(item);
          return reply(wirePriceItem(item) satisfies C.PriceItem);
        }),

      changePriceItem: (id, input, opts) =>
        respond(S.priceItem, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const item = state.priceItems.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (item === undefined) {
            return notFound;
          }
          if (input.code !== undefined) {
            const code = input.code === "" || input.code === null ? null : input.code;
            if (code !== null && state.priceItems.some((p) => p.id !== item.id && p.clinic_id === caller.clinic.id && p.code === code)) {
              return refuse(409, "conflict", "another entry has this code");
            }
            item.code = code;
          }
          if (input.name != null) item.name = input.name;
          if (input.category !== undefined) item.category = input.category === "" ? null : input.category;
          if (input.price_paise != null) item.price_paise = input.price_paise;
          if (input.taxable != null) item.taxable = input.taxable;
          if (input.gst_rate != null) item.gst_rate = input.gst_rate;
          if (input.sac_hsn !== undefined) item.sac_hsn = input.sac_hsn === "" ? null : input.sac_hsn;
          if (input.active != null) item.active = input.active;
          return reply(wirePriceItem(item) satisfies C.PriceItem);
        }),

      getStock: (opts) =>
        respond(S.stockSummary, opts?.signal, async () => {
          const caller = await inClinic("inventory.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const levels = byUrgency(clinicLevels(caller.clinic));
          const active = levels.filter((l) => l.item.active);
          const count = (status: C.StockLevel["status"]): number => active.filter((l) => l.status === status).length;
          return reply({
            counts: { critical: count("critical"), low: count("low"), expiring: count("expiring"), ok: count("ok") },
            items: levels,
          } satisfies C.StockSummary);
        }),

      listLowStock: (opts) =>
        respond(S.inventoryItemList, opts?.signal, async () => {
          const caller = await inClinic("inventory.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = byUrgency(clinicLevels(caller.clinic)).filter((l) => l.item.active && (l.status === "low" || l.status === "critical"));
          return reply({ items } satisfies C.InventoryItemList);
        }),

      listExpiring: (days, opts) =>
        respond(S.expiringList, opts?.signal, async () => {
          const caller = await inClinic("inventory.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const ahead = days ?? 30;
          if (!Number.isInteger(ahead) || ahead < 0 || ahead > 3650) {
            return invalid("days", "must be between 0 and 3650");
          }
          const today = clinicToday(caller.clinic);
          const items = state.stockBatches
            .filter((b) => b.clinic_id === caller.clinic.id && b.quantity > 0 && b.expiry != null && b.expiry <= addDays(today, ahead))
            .flatMap((b) => {
              const item = state.inventoryItems.find((i) => i.id === b.item_id);
              return item === undefined || b.expiry == null
                ? []
                : [{ batch_id: b.id, item_id: item.id, item_name: item.name, unit: item.unit, batch_no: b.batch_no ?? null, expiry: b.expiry, quantity: b.quantity, days_left: daysBetween(today, b.expiry) }];
            })
            .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.item_name.localeCompare(b.item_name));
          return reply({ items } satisfies C.ExpiringList);
        }),

      listInventoryItems: (opts) =>
        respond(S.inventoryItemList, opts?.signal, async () => {
          const caller = await inClinic("inventory.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = clinicLevels(caller.clinic).sort((a, b) => a.item.name.localeCompare(b.item.name));
          return reply({ items } satisfies C.InventoryItemList);
        }),

      getInventoryItem: (id, opts) =>
        respond(S.inventoryItemDetail, opts?.signal, async () => {
          const caller = await inClinic("inventory.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const item = inventoryItemOf(caller.clinic, id);
          if (item === undefined) {
            return notFound;
          }
          const batches = state.stockBatches.filter((b) => b.item_id === item.id);
          return reply({
            stock: levelOf(item, batches, clinicToday(caller.clinic)),
            batches: [...batches]
              .sort((a, b) => Number(a.quantity === 0) - Number(b.quantity === 0) || (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"))
              .map(wireBatch),
            movements: state.stockMovements
              .filter((m) => m.item_id === item.id)
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 50)
              .map(wireMovement),
          } satisfies C.InventoryItemDetail);
        }),

      addInventoryItem: (input, opts) =>
        respond(S.inventoryItem, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const name = (input.name ?? "").trim();
          if (name === "") {
            return invalid("name", "is required");
          }
          const unit = input.unit ?? "piece";
          if (!isStockUnit(unit)) {
            return invalid("unit", "must be piece, ml, g, box or pack");
          }
          const reorder = input.reorder_level ?? 0;
          if (!Number.isInteger(reorder) || reorder < 0 || reorder > MAX_MOVEMENT) {
            return invalid("reorder_level", "must be between 0 and 1000000");
          }
          if (inventoryItemNamed(caller.clinic, name) !== undefined) {
            return refuse(409, "conflict", "an item has this name");
          }
          const item: FakeInventoryItem = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            name,
            category: (input.category ?? "").trim().toLowerCase() || null,
            unit,
            reorder_level: reorder,
            active: input.active ?? true,
          };
          state.inventoryItems.push(item);
          return reply(wireItem(item) satisfies C.InventoryItem);
        }),

      changeInventoryItem: (id, input, opts) =>
        respond(S.inventoryItem, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const item = inventoryItemOf(caller.clinic, id);
          if (item === undefined) {
            return notFound;
          }
          if (input.name != null) {
            const name = input.name.trim();
            if (name === "") {
              return invalid("name", "is required");
            }
            const same = inventoryItemNamed(caller.clinic, name);
            if (same !== undefined && same.id !== item.id) {
              return refuse(409, "conflict", "an item has this name");
            }
            item.name = name;
          }
          if (input.unit != null) {
            if (!isStockUnit(input.unit)) {
              return invalid("unit", "must be piece, ml, g, box or pack");
            }
            item.unit = input.unit;
          }
          if (input.reorder_level != null) {
            if (!Number.isInteger(input.reorder_level) || input.reorder_level < 0 || input.reorder_level > MAX_MOVEMENT) {
              return invalid("reorder_level", "must be between 0 and 1000000");
            }
            item.reorder_level = input.reorder_level;
          }
          if (input.category != null) item.category = input.category.trim().toLowerCase() || null;
          if (input.active != null) item.active = input.active;
          return reply(wireItem(item) satisfies C.InventoryItem);
        }),

      removeInventoryItem: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const item = inventoryItemOf(caller.clinic, id);
          if (item === undefined) {
            return notFound;
          }
          if (state.stockBatches.some((b) => b.item_id === item.id && b.quantity > 0)) {
            return refuse(409, "conflict", "the item still has stock; use or write it off first");
          }
          state.inventoryItems = state.inventoryItems.filter((i) => i.id !== item.id);
          return { ok: true, body: undefined };
        }),

      listSuppliers: (opts) =>
        respond(S.supplierList, opts?.signal, async () => {
          const caller = await inClinic("inventory.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = state.suppliers
            .filter((s) => s.clinic_id === caller.clinic.id)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(wireSupplier);
          return reply({ items } satisfies C.SupplierList);
        }),

      addSupplier: (input, opts) =>
        respond(S.supplier, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const name = (input.name ?? "").trim();
          if (name === "") {
            return invalid("name", "is required");
          }
          if (state.suppliers.some((s) => s.clinic_id === caller.clinic.id && s.name.toLowerCase() === name.toLowerCase())) {
            return refuse(409, "conflict", "a supplier has this name");
          }
          const phone = (input.phone ?? "").trim();
          const e164 = phone === "" ? null : phone.startsWith("+") ? phone.replace(/\s/g, "") : `+91${phone.replace(/\D/g, "")}`;
          if (e164 !== null && !E164.test(e164)) {
            return invalid("phone", "must be a phone number");
          }
          const supplier: FakeSupplier = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            name,
            phone: e164,
            gstin: (input.gstin ?? "").trim().toUpperCase() || null,
            active: input.active ?? true,
          };
          state.suppliers.push(supplier);
          return reply(wireSupplier(supplier) satisfies C.Supplier);
        }),

      changeSupplier: (id, input, opts) =>
        respond(S.supplier, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const supplier = state.suppliers.find((s) => s.id === id && s.clinic_id === caller.clinic.id);
          if (supplier === undefined) {
            return notFound;
          }
          if (input.name != null) {
            const name = input.name.trim();
            if (name === "") {
              return invalid("name", "is required");
            }
            if (state.suppliers.some((s) => s.id !== supplier.id && s.clinic_id === caller.clinic.id && s.name.toLowerCase() === name.toLowerCase())) {
              return refuse(409, "conflict", "a supplier has this name");
            }
            supplier.name = name;
          }
          if (input.phone != null) supplier.phone = input.phone.trim() === "" ? null : input.phone.trim();
          if (input.gstin != null) supplier.gstin = input.gstin.trim().toUpperCase() || null;
          if (input.active != null) supplier.active = input.active;
          return reply(wireSupplier(supplier) satisfies C.Supplier);
        }),

      removeSupplier: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!state.suppliers.some((s) => s.id === id && s.clinic_id === caller.clinic.id)) {
            return notFound;
          }
          state.suppliers = state.suppliers.filter((s) => s.id !== id);
          return { ok: true, body: undefined };
        }),

      receiveStock: (input, opts) =>
        respond(S.stockChange, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_MOVEMENT) {
            return invalid("quantity", "must be between 1 and 1000000");
          }
          const cost = input.unit_cost_paise ?? 0;
          if (!Number.isInteger(cost) || cost < 0) {
            return invalid("unit_cost_paise", "must not be negative");
          }
          const item = inventoryItemOf(caller.clinic, input.item_id);
          if (item === undefined) {
            return notFound;
          }
          const supplierId = input.supplier_id == null || input.supplier_id === "" ? null : input.supplier_id;
          if (supplierId !== null && !state.suppliers.some((s) => s.id === supplierId && s.clinic_id === caller.clinic.id)) {
            return notFound;
          }
          const today = clinicToday(caller.clinic);
          const batch: FakeStockBatch = {
            id: fakeUuid(random, clock()),
            clinic_id: caller.clinic.id,
            item_id: item.id,
            supplier_id: supplierId,
            batch_no: input.batch_no?.trim() || null,
            expiry: input.expiry || null,
            received_quantity: input.quantity,
            quantity: input.quantity,
            unit_cost_paise: cost,
            received_on: input.received_on || today,
          };
          state.stockBatches.push(batch);
          const movement = record(caller, item, batch, "receive", input.quantity, null);
          return reply(stockChangeOf(caller.clinic, item, [movement]) satisfies C.StockChange);
        }),

      useStock: (input, opts) =>
        respond(S.stockChange, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_MOVEMENT) {
            return invalid("quantity", "must be between 1 and 1000000");
          }
          const item = inventoryItemOf(caller.clinic, input.item_id);
          if (item === undefined) {
            return notFound;
          }
          const picks = pickFefo(
            state.stockBatches.filter((b) => b.item_id === item.id),
            input.quantity,
            clinicToday(caller.clinic),
          );
          if (picks === null) {
            return refuse(409, "conflict", "not enough stock on the shelf");
          }
          const reason = input.reason?.trim() || null;
          const movements = picks.map(({ batch, take }) => {
            batch.quantity -= take;
            return record(caller, item, batch, "use", -take, reason);
          });
          return reply(stockChangeOf(caller.clinic, item, movements) satisfies C.StockChange);
        }),

      adjustStock: (input, opts) =>
        respond(S.stockChange, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!Number.isInteger(input.quantity) || input.quantity === 0 || Math.abs(input.quantity) > MAX_MOVEMENT) {
            return invalid("quantity", "must be between 1 and 1000000");
          }
          const reason = input.reason.trim();
          if (reason === "") {
            return invalid("reason", "is required");
          }
          const item = inventoryItemOf(caller.clinic, input.item_id);
          if (item === undefined) {
            return notFound;
          }
          const mine = state.stockBatches.filter((b) => b.item_id === item.id);
          const today = clinicToday(caller.clinic);
          if (input.quantity > 0) {
            const latest = [...mine].sort((a, b) => b.received_on.localeCompare(a.received_on))[0];
            const batch: FakeStockBatch = {
              id: fakeUuid(random, clock()),
              clinic_id: caller.clinic.id,
              item_id: item.id,
              supplier_id: null,
              batch_no: null,
              expiry: input.expiry || null,
              received_quantity: input.quantity,
              quantity: input.quantity,
              unit_cost_paise: latest?.unit_cost_paise ?? 0,
              received_on: today,
            };
            state.stockBatches.push(batch);
            return reply(stockChangeOf(caller.clinic, item, [record(caller, item, batch, "adjust", input.quantity, reason)]) satisfies C.StockChange);
          }
          // A recount sees expired stock too.
          const picks = pickFefo(mine, -input.quantity, today, true);
          if (picks === null) {
            return refuse(409, "conflict", "not enough stock on the shelf");
          }
          const movements = picks.map(({ batch, take }) => {
            batch.quantity -= take;
            return record(caller, item, batch, "adjust", -take, reason);
          });
          return reply(stockChangeOf(caller.clinic, item, movements) satisfies C.StockChange);
        }),

      expireBatch: (id, input, opts) =>
        respond(S.stockChange, opts?.signal, async () => {
          const caller = await inClinic("inventory.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const batch = state.stockBatches.find((b) => b.id === id && b.clinic_id === caller.clinic.id);
          const item = batch === undefined ? undefined : state.inventoryItems.find((i) => i.id === batch.item_id);
          if (batch === undefined || item === undefined) {
            return notFound;
          }
          if (batch.quantity === 0) {
            return refuse(409, "conflict", "the batch is already empty");
          }
          if (!isExpired(batch.expiry, clinicToday(caller.clinic))) {
            return refuse(409, "conflict", "the batch has not expired");
          }
          const left = batch.quantity;
          batch.quantity = 0;
          const movement = record(caller, item, batch, "expire", -left, input.reason?.trim() || "expired");
          return reply(stockChangeOf(caller.clinic, item, [movement]) satisfies C.StockChange);
        }),

      listInvoices: (filter, opts) =>
        respond(S.invoiceList, opts?.signal, async () => {
          const caller = await inClinic("billing.read");
          if (!isCaller(caller)) {
            return caller;
          }
          let items = state.invoices.filter((i) => i.clinic_id === caller.clinic.id);
          if (filter.status !== undefined) items = items.filter((i) => i.status === filter.status);
          if (filter.patientId !== undefined) items = items.filter((i) => i.patient_id === filter.patientId);
          const from = filter.from;
          const to = filter.to;
          if (from !== undefined) items = items.filter((i) => (i.issued_at ?? i.created_at).slice(0, 10) >= from);
          if (to !== undefined) items = items.filter((i) => (i.issued_at ?? i.created_at).slice(0, 10) <= to);
          const sorted = items.sort((a, b) => (b.issued_at ?? b.created_at).localeCompare(a.issued_at ?? a.created_at)).slice(0, 50);
          return reply({ items: sorted.map((i) => wireInvoice(i, state, true)) } satisfies C.InvoiceList);
        }),

      getInvoice: (id, opts) =>
        respond(S.invoice, opts?.signal, async () => {
          const caller = await inClinic("billing.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.invoices.find((i) => i.id === id && i.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          return reply(wireInvoice(found, state, false) satisfies C.Invoice);
        }),

      createInvoice: (input, opts) =>
        respond(S.invoice, opts?.signal, async () => {
          const caller = await inClinic("billing.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const patient = state.patients.find((p) => p.id === input.patient_id && p.clinic_id === caller.clinic.id);
          if (patient === undefined) {
            return notFound;
          }
          const clinicPriceItems = state.priceItems.filter((p) => p.clinic_id === caller.clinic.id);
          const lines: FakeInvoiceLine[] = [];
          let lineNo = 1;
          for (const rawLine of input.items ?? []) {
            const built = buildInvoiceLine(lineNo, rawLine, clinicPriceItems);
            if ("error" in built) {
              return built.error;
            }
            lines.push(built.line);
            lineNo += 1;
          }
          const now = clock();
          const invoiceRecord: FakeInvoice = {
            id: fakeUuid(random, now),
            clinic_id: caller.clinic.id,
            patient_id: patient.id,
            status: "draft",
            encounter_id: input.encounter_id ?? null,
            items: lines,
            notes: input.notes ?? null,
            place_of_supply: input.place_of_supply ?? null,
            replaces_invoice_id: input.replaces_invoice_id ?? null,
            created_at: now.toISOString(),
          };
          state.invoices.push(invoiceRecord);
          return reply(wireInvoice(invoiceRecord, state, false) satisfies C.Invoice);
        }),

      editInvoice: (id, changes, opts) =>
        respond(S.invoice, opts?.signal, async () => {
          const caller = await inClinic("billing.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.invoices.find((i) => i.id === id && i.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "draft") {
            return refuse(409, "conflict", "the bill is issued or void");
          }
          if (changes.items !== undefined && changes.items !== null) {
            const clinicPriceItems = state.priceItems.filter((p) => p.clinic_id === caller.clinic.id);
            const lines: FakeInvoiceLine[] = [];
            let lineNo = 1;
            for (const rawLine of changes.items) {
              const built = buildInvoiceLine(lineNo, rawLine, clinicPriceItems);
              if ("error" in built) {
                return built.error;
              }
              lines.push(built.line);
              lineNo += 1;
            }
            found.items = lines;
          }
          if (changes.encounter_id !== undefined) found.encounter_id = changes.encounter_id === "" ? null : changes.encounter_id;
          if (changes.notes !== undefined) found.notes = changes.notes === "" ? null : changes.notes;
          if (changes.place_of_supply !== undefined) found.place_of_supply = changes.place_of_supply === "" ? null : changes.place_of_supply;
          return reply(wireInvoice(found, state, false) satisfies C.Invoice);
        }),

      issueInvoice: (id, opts) =>
        respond(S.invoice, opts?.signal, async () => {
          const caller = await inClinic("billing.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.invoices.find((i) => i.id === id && i.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "draft") {
            return refuse(409, "conflict", "already issued or void");
          }
          if (found.items.length === 0) {
            return refuse(400, "invalid_request", "the bill has no lines");
          }
          const now = clock();
          found.status = "issued";
          found.number = nextInvoiceNumber(state, caller.clinic);
          found.issued_at = now.toISOString();
          return reply(wireInvoice(found, state, false) satisfies C.Invoice);
        }),

      voidInvoice: (id, reason, opts) =>
        respond(S.invoice, opts?.signal, async () => {
          const caller = await inClinic("billing.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.invoices.find((i) => i.id === id && i.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "issued") {
            return refuse(409, "conflict", "already void, or not issued");
          }
          if (reason.reason.trim().length < 3) {
            return invalid("reason", "give a short reason");
          }
          if (paymentsFor(state, found.id).length > 0) {
            return refuse(409, "conflict", "payments still count towards it");
          }
          found.status = "void";
          found.void_reason = reason.reason;
          found.voided_at = clock().toISOString();
          return reply(wireInvoice(found, state, false) satisfies C.Invoice);
        }),

      listPayments: (range, opts) =>
        respond(S.paymentList, opts?.signal, async () => {
          const caller = await inClinic("billing.read");
          if (!isCaller(caller)) {
            return caller;
          }
          let items = state.payments.filter((p) => p.clinic_id === caller.clinic.id);
          const from = range.from;
          const to = range.to;
          if (from !== undefined) items = items.filter((p) => p.received_at.slice(0, 10) >= from);
          if (to !== undefined) items = items.filter((p) => p.received_at.slice(0, 10) <= to);
          const sorted = items.sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 100);
          return reply({ items: sorted.map((p) => wirePayment(p, state)) } satisfies C.PaymentList);
        }),

      getPayment: (id, opts) =>
        respond(S.payment, opts?.signal, async () => {
          const caller = await inClinic("billing.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.payments.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          return reply(wirePayment(found, state) satisfies C.Payment);
        }),

      recordPayment: (input, idempotencyKey, opts) =>
        respond(S.payment, opts?.signal, async () => {
          const caller = await inClinic("billing.write");
          if (!isCaller(caller)) {
            return caller;
          }
          if (idempotencyKey.trim() === "") {
            return invalid("idempotency_key", "an Idempotency-Key is required");
          }
          const already = paymentByIdempotencyKey.get(idempotencyKey);
          if (already !== undefined) {
            const existing = state.payments.find((p) => p.id === already);
            if (existing !== undefined) {
              return reply(wirePayment(existing, state) satisfies C.Payment);
            }
          }
          const patient = state.patients.find((p) => p.id === input.patient_id && p.clinic_id === caller.clinic.id);
          if (patient === undefined) {
            return notFound;
          }
          if (!Number.isInteger(input.amount_paise) || input.amount_paise <= 0) {
            return invalid("amount_paise", "must be more than zero");
          }
          const method = input.method;
          if (method !== "cash" && method !== "upi" && method !== "card" && method !== "bank") {
            return invalid("method", "unknown payment method");
          }
          const allocations: { invoice_id: string; amount_paise: number }[] = [];
          let allocatedTotal = 0;
          for (const alloc of input.allocations ?? []) {
            const invoiceFound = state.invoices.find((i) => i.id === alloc.invoice_id && i.clinic_id === caller.clinic.id && i.patient_id === patient.id);
            if (invoiceFound === undefined) {
              return notFound;
            }
            if (invoiceFound.status !== "issued") {
              return refuse(409, "conflict", "a bill isn't issued");
            }
            const wired = wireInvoice(invoiceFound, state, false);
            if (alloc.amount_paise > wired.balance_paise) {
              return invalid("allocations", "an allocation is past a bill's balance");
            }
            allocations.push({ invoice_id: invoiceFound.id, amount_paise: alloc.amount_paise });
            allocatedTotal += alloc.amount_paise;
          }
          if (allocatedTotal > input.amount_paise) {
            return invalid("allocations", "allocations can't exceed the payment");
          }
          // The API refuses a payment above the balance due on the bills it pays.
          if (allocations.length > 0) {
            const balanceDue = allocations.reduce((sum, a) => {
              const bill = state.invoices.find((i) => i.id === a.invoice_id);
              return sum + (bill === undefined ? 0 : wireInvoice(bill, state, false).balance_paise);
            }, 0);
            if (input.amount_paise > balanceDue) {
              return invalid("amount", "must not be more than the balance due");
            }
          }
          const now = clock();
          const paymentRecord: FakePayment = {
            id: fakeUuid(random, now),
            clinic_id: caller.clinic.id,
            patient_id: patient.id,
            number: nextReceiptNumber(state, caller.clinic),
            status: "received",
            method,
            amount_paise: input.amount_paise,
            allocations,
            reference: input.reference ?? null,
            received_at: now.toISOString(),
            idempotency_key: idempotencyKey,
          };
          state.payments.push(paymentRecord);
          paymentByIdempotencyKey.set(idempotencyKey, paymentRecord.id);
          return reply(wirePayment(paymentRecord, state) satisfies C.Payment);
        }),

      voidPayment: (id, reason, opts) =>
        respond(S.payment, opts?.signal, async () => {
          const caller = await inClinic("billing.write");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.payments.find((p) => p.id === id && p.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "received") {
            return refuse(409, "conflict", "already void");
          }
          if (reason.reason.trim().length < 3) {
            return invalid("reason", "give a short reason");
          }
          found.status = "void";
          found.void_reason = reason.reason;
          return reply(wirePayment(found, state) satisfies C.Payment);
        }),

      getCollections: (range, opts) =>
        respond(S.collections, opts?.signal, async () => {
          const caller = await inClinic("finance.view");
          if (!isCaller(caller)) {
            return caller;
          }
          const now = clock();
          const to = range.to ?? dateOnly(now);
          const from = range.from ?? dateOnly(new Date(new Date(`${to}T00:00:00Z`).getTime() - 6 * 86_400_000));
          if (from > to) {
            return invalid("from", "must be before to");
          }
          const days = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
          if (days > 366) {
            return invalid("from", "the range is too long");
          }
          const clinicPayments = state.payments.filter(
            (p) => p.clinic_id === caller.clinic.id && p.status === "received" && p.received_at.slice(0, 10) >= from && p.received_at.slice(0, 10) <= to,
          );
          const invoicesInRange = state.invoices.filter(
            (i) => i.clinic_id === caller.clinic.id && i.status === "issued" && (i.issued_at ?? "").slice(0, 10) >= from && (i.issued_at ?? "").slice(0, 10) <= to,
          );
          const outstanding = state.invoices
            .filter((i) => i.clinic_id === caller.clinic.id && i.status === "issued")
            .reduce((sum, i) => sum + wireInvoice(i, state, false).balance_paise, 0);
          return reply({
            from,
            to,
            collected_paise: clinicPayments.reduce((sum, p) => sum + p.amount_paise, 0),
            invoiced_paise: invoicesInRange.reduce((sum, i) => sum + computeInvoiceAmounts(i.items).total_paise, 0),
            outstanding_paise: outstanding,
            invoices: invoicesInRange.length,
            payments: clinicPayments.length,
            by_day: buildDayTotals(clinicPayments, from, to),
            by_week: buildWeekTotals(clinicPayments, from, to),
            by_method: buildMethodTotals(clinicPayments),
            revenue_mix: buildRevenueMix(invoicesInRange, state.priceItems.filter((p) => p.clinic_id === caller.clinic.id)),
          } satisfies C.Collections);
        }),

      getPendingReport: (opts) =>
        respond(S.pendingReport, opts?.signal, async () => {
          const caller = await inClinic("finance.view");
          if (!isCaller(caller)) {
            return caller;
          }
          const items = pendingItemsFor(state, caller.clinic.id, clock()).sort((a, b) => (a.issued_at ?? "").localeCompare(b.issued_at ?? ""));
          const buckets = { "0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 };
          for (const item of items) {
            buckets[item.bucket] += 1;
          }
          return reply({
            outstanding_paise: items.reduce((sum, i) => sum + i.balance_paise, 0),
            patients: new Set(items.map((i) => i.patient.id)).size,
            buckets,
            items,
          } satisfies C.PendingReport);
        }),

      getTodayMoney: (opts) =>
        respond(S.todayMoney, opts?.signal, async () => {
          const caller = await inClinic("finance.view");
          if (!isCaller(caller)) {
            return caller;
          }
          const now = clock();
          const today = dateOnly(now);
          const monthStart = `${today.slice(0, 7)}-01`;
          const paymentsToday = state.payments.filter(
            (p) => p.clinic_id === caller.clinic.id && p.status === "received" && p.received_at.slice(0, 10) === today,
          );
          const paymentsThisMonth = state.payments.filter(
            (p) => p.clinic_id === caller.clinic.id && p.status === "received" && p.received_at.slice(0, 10) >= monthStart && p.received_at.slice(0, 10) <= today,
          );
          const invoicesToday = state.invoices.filter(
            (i) => i.clinic_id === caller.clinic.id && i.status === "issued" && (i.issued_at ?? "").slice(0, 10) === today,
          );
          const invoicesThisMonth = state.invoices.filter(
            (i) => i.clinic_id === caller.clinic.id && i.status === "issued" && (i.issued_at ?? "").slice(0, 10) >= monthStart && (i.issued_at ?? "").slice(0, 10) <= today,
          );
          const pending = pendingItemsFor(state, caller.clinic.id, now);
          const pendingTop5 = [...pending].sort((a, b) => b.balance_paise - a.balance_paise).slice(0, 5);
          const methodTotalsThisMonth = buildMethodTotals(paymentsThisMonth);
          return reply({
            date: today,
            collected_paise: paymentsToday.reduce((sum, p) => sum + p.amount_paise, 0),
            collected_this_month_paise: paymentsThisMonth.reduce((sum, p) => sum + p.amount_paise, 0),
            invoiced_paise: invoicesToday.reduce((sum, i) => sum + computeInvoiceAmounts(i.items).total_paise, 0),
            invoices_today: invoicesToday.length,
            payments_today: paymentsToday.length,
            pending: pendingTop5,
            pending_dues_paise: pending.reduce((sum, i) => sum + i.balance_paise, 0),
            pending_dues_patients: new Set(pending.map((i) => i.patient.id)).size,
            revenue_mix: buildRevenueMix(invoicesThisMonth, state.priceItems.filter((p) => p.clinic_id === caller.clinic.id)),
            upi_share_bps: methodTotalsThisMonth.find((m) => m.method === "upi")?.share_bps ?? 0,
          } satisfies C.TodayMoney);
        }),

      listPrescriptions: (patientId, opts) =>
        respond(S.prescriptionList, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const patient = state.patients.find((p) => p.id === patientId && p.clinic_id === caller.clinic.id);
          if (patient === undefined) {
            return notFound;
          }
          const items = state.prescriptions
            .filter((rx) => rx.patient_id === patientId && rx.clinic_id === caller.clinic.id)
            .sort((a, b) => (b.issued_at ?? b.created_at).localeCompare(a.issued_at ?? a.created_at))
            .map((rx) => wirePrescription(rx, state));
          return reply({ items } satisfies C.PrescriptionList);
        }),

      getLastPrescription: (patientId, opts) =>
        respond(S.prescription, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const patient = state.patients.find((p) => p.id === patientId && p.clinic_id === caller.clinic.id);
          if (patient === undefined) {
            return notFound;
          }
          const last = state.prescriptions
            .filter((rx) => rx.patient_id === patientId && rx.clinic_id === caller.clinic.id && rx.status === "issued")
            .sort((a, b) => (b.issued_at ?? "").localeCompare(a.issued_at ?? ""))[0];
          if (last === undefined) {
            return notFound;
          }
          return reply(wirePrescription(last, state) satisfies C.Prescription);
        }),

      getPrescription: (id, opts) =>
        respond(S.prescription, opts?.signal, async () => {
          const caller = await inClinic("clinical.read");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.prescriptions.find((rx) => rx.id === id && rx.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          return reply(wirePrescription(found, state) satisfies C.Prescription);
        }),

      createPrescription: (patientId, input, opts) =>
        respond(S.prescription, opts?.signal, async () => {
          const caller = await inClinic("prescriptions.issue");
          if (!isCaller(caller)) {
            return caller;
          }
          const patient = state.patients.find((p) => p.id === patientId && p.clinic_id === caller.clinic.id);
          if (patient === undefined) {
            return notFound;
          }
          const itemsResult = buildRxItems(input.items ?? []);
          if ("error" in itemsResult) {
            return itemsResult.error;
          }
          const now = clock();
          const rx: FakePrescription = {
            id: fakeUuid(random, now),
            clinic_id: caller.clinic.id,
            patient_id: patient.id,
            status: "draft",
            encounter_id: input.encounter_id ?? null,
            diagnosis_text: input.diagnosis_text ?? null,
            items: itemsResult.items,
            advice: input.advice ?? null,
            follow_up_on: input.follow_up_on ?? null,
            language: input.language ?? patient.preferred_language,
            alerts: [],
            created_at: now.toISOString(),
            issued_by_membership_id: caller.membership.id,
          };
          state.prescriptions.push(rx);
          return reply(wirePrescription(rx, state) satisfies C.Prescription);
        }),

      editPrescription: (id, input, opts) =>
        respond(S.prescription, opts?.signal, async () => {
          const caller = await inClinic("prescriptions.issue");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.prescriptions.find((rx) => rx.id === id && rx.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "draft") {
            return refuse(409, "conflict", "issued or cancelled");
          }
          if (input.items !== undefined && input.items !== null) {
            const itemsResult = buildRxItems(input.items);
            if ("error" in itemsResult) {
              return itemsResult.error;
            }
            found.items = itemsResult.items;
          }
          if (input.encounter_id !== undefined) found.encounter_id = input.encounter_id === "" ? null : input.encounter_id;
          if (input.diagnosis_text !== undefined) found.diagnosis_text = input.diagnosis_text === "" ? null : input.diagnosis_text;
          if (input.advice !== undefined) found.advice = input.advice === "" ? null : input.advice;
          if (input.follow_up_on !== undefined) found.follow_up_on = input.follow_up_on === "" ? null : input.follow_up_on;
          if (input.language != null) found.language = input.language;
          return reply(wirePrescription(found, state) satisfies C.Prescription);
        }),

      issuePrescription: (id, input, opts) =>
        respond(S.issuedPrescription, opts?.signal, async () => {
          const caller = await inClinic("prescriptions.issue");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.prescriptions.find((rx) => rx.id === id && rx.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "draft") {
            return refuse(409, "conflict", "already issued or void");
          }
          if (found.items.length === 0) {
            return refuse(400, "invalid_request", "no medicines");
          }
          const detected = findAllergyAlerts(state, found.patient_id, caller.clinic.id, found.items, state.drugs);
          const overrideReason = input.override_reason ?? undefined;
          if (detected.length > 0 && (overrideReason === undefined || overrideReason.trim() === "")) {
            return blocked(detected.map((a) => ({ ...a, line_no: a.line_no ?? null, action: null, override_reason: null })));
          }
          const now = clock();
          found.status = "issued";
          found.number = nextPrescriptionNumber(state, caller.clinic);
          found.issued_at = now.toISOString();
          found.issued_by_membership_id = caller.membership.id;
          found.verify_token = random.hex(24);
          if (detected.length > 0) {
            found.alerts = detected.map((a) => ({ ...a, action: "overridden", override_reason: overrideReason ?? null }));
            found.override_reason = overrideReason ?? null;
          }
          const patient = state.patients.find((p) => p.id === found.patient_id);
          let patientMessage: C.PatientMessage;
          if (input.notify_patient === false) {
            patientMessage = { status: "not_sent", reason: "declined" };
          } else if (patient?.email == null || patient.email === "") {
            patientMessage = { status: "not_sent", reason: "no_email" };
          } else {
            const link: FakeShareLink = {
              id: fakeUuid(random, now),
              clinic_id: caller.clinic.id,
              prescription_id: found.id,
              token: random.hex(32),
              pin: String(random.int(100_000, 999_999)),
              created_at: now.toISOString(),
              expires_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
              failed_attempts: 0,
              locked: false,
            };
            state.shareLinks.push(link);
            patientMessage = { status: "sent", pin: link.pin, expires_at: link.expires_at };
          }
          return reply({ ...wirePrescription(found, state), patient_message: patientMessage } satisfies C.IssuedPrescription);
        }),

      cancelPrescription: (id, input, opts) =>
        respond(S.cancelled, opts?.signal, async () => {
          const caller = await inClinic("prescriptions.issue");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.prescriptions.find((rx) => rx.id === id && rx.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "issued") {
            return refuse(409, "conflict", "not issued");
          }
          if (input.reason.trim().length < 3) {
            return invalid("reason", "give a short reason");
          }
          const now = clock();
          found.status = "cancelled";
          found.cancel_reason = input.reason;
          found.cancelled_at = now.toISOString();
          let draft: FakePrescription | undefined;
          if (input.reissue !== false) {
            draft = {
              id: fakeUuid(random, now),
              clinic_id: caller.clinic.id,
              patient_id: found.patient_id,
              status: "draft",
              encounter_id: found.encounter_id ?? null,
              diagnosis_text: found.diagnosis_text ?? null,
              items: found.items.map((i) => ({ ...i })),
              advice: found.advice ?? null,
              follow_up_on: found.follow_up_on ?? null,
              language: found.language,
              alerts: [],
              supersedes_id: found.id,
              created_at: now.toISOString(),
              issued_by_membership_id: caller.membership.id,
            };
            state.prescriptions.push(draft);
            found.superseded_by = draft.id;
          }
          return reply({
            cancelled: wirePrescription(found, state),
            draft: draft === undefined ? null : wirePrescription(draft, state),
          } satisfies C.Cancelled);
        }),

      createShareLink: (id, opts) =>
        respond(S.shareLink, opts?.signal, async () => {
          const caller = await inClinic("prescriptions.issue");
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.prescriptions.find((rx) => rx.id === id && rx.clinic_id === caller.clinic.id);
          if (found === undefined) {
            return notFound;
          }
          if (found.status !== "issued") {
            return refuse(409, "conflict", "not issued");
          }
          const now = clock();
          const link: FakeShareLink = {
            id: fakeUuid(random, now),
            clinic_id: caller.clinic.id,
            prescription_id: found.id,
            token: random.hex(32),
            pin: String(random.int(100_000, 999_999)),
            created_at: now.toISOString(),
            expires_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
            failed_attempts: 0,
            locked: false,
          };
          state.shareLinks.push(link);
          return reply({ id: link.id, token: link.token, pin: link.pin, expires_at: link.expires_at } satisfies C.ShareLink);
        }),

      getSharedPreview: (token, opts) =>
        respond(S.sharedPreview, opts?.signal, () => {
          const link = state.shareLinks.find((l) => l.token === token);
          if (link === undefined) {
            return notFound;
          }
          const clinic = state.clinics.find((c) => c.id === link.clinic_id);
          const now = clock();
          const linkState = link.locked ? "locked" : new Date(link.expires_at) < now ? "expired" : "usable";
          return reply({
            resource: "prescription",
            state: linkState,
            clinic_name: clinic?.name ?? "",
            expires_at: link.expires_at,
          } satisfies C.SharedPreview);
        }),

      getSharedLetterhead: (token, opts) =>
        respond(S.letterheadDocument, opts?.signal, () => {
          const link = state.shareLinks.find((l) => l.token === token);
          const clinic = link === undefined ? undefined : state.clinics.find((c) => c.id === link.clinic_id);
          return clinic === undefined ? notFound : reply(wireLetterheadDocument(clinic, state.practitioners) satisfies C.LetterheadDocument);
        }),

      openShared: (token, pin, opts) =>
        respond(S.prescription, opts?.signal, () => {
          const link = state.shareLinks.find((l) => l.token === token);
          if (link === undefined) {
            return notFound;
          }
          const now = clock();
          if (new Date(link.expires_at) < now) {
            return refuse(410, "expired", "This link has expired.");
          }
          if (link.locked) {
            return refuse(423, "locked", "This link is locked after too many wrong PINs.");
          }
          if (link.pin !== pin) {
            link.failed_attempts += 1;
            const left = Math.max(0, 5 - link.failed_attempts);
            if (left === 0) {
              link.locked = true;
              return refuse(423, "locked", "Too many wrong PINs. Ask the clinic for a new link.");
            }
            return refuse(403, "forbidden", `Wrong PIN. ${String(left)} ${left === 1 ? "try" : "tries"} left.`);
          }
          link.failed_attempts = 0;
          const rx = state.prescriptions.find((r) => r.id === link.prescription_id);
          if (rx === undefined) {
            return notFound;
          }
          return reply(wirePrescription(rx, state) satisfies C.Prescription);
        }),

      getBookingOptions: (opts) =>
        respond(S.bookingOptions, opts?.signal, () => {
          const clinic = state.clinics.find((c) => c.host === options.host);
          if (clinic === undefined || clinic.status === "suspended" || clinic.status === "churned") {
            return notFound;
          }
          const settings = bookingSettings(clinic);
          const doctors = settings.enabled
            ? state.practitioners
                .filter((p) => p.clinic_id === clinic.id && p.active && state.workingShifts.some((s) => s.practitioner_id === p.id))
                .map((p): C.BookableDoctor => ({ id: p.id, name: p.display_name, specialty: p.specialty ?? null }))
            : [];
          return reply({
            clinic_name: clinic.name,
            timezone: clinic.timezone,
            today: clinicToday(clinic),
            enabled: settings.enabled,
            slot_minutes: settings.slot_minutes,
            auto_confirm: settings.auto_confirm,
            horizon_days: settings.horizon_days,
            doctors,
          } satisfies C.BookingOptions);
        }),

      getAvailability: (date, practitionerId, opts) =>
        respond(S.availability, opts?.signal, () => {
          const clinic = state.clinics.find((c) => c.host === options.host);
          if (clinic === undefined || !bookingSettings(clinic).enabled) {
            return notFound;
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return invalid("date", "must be YYYY-MM-DD");
          }
          if (!state.practitioners.some((p) => p.id === practitionerId && p.clinic_id === clinic.id && p.active)) {
            return invalid("practitioner_id", "no such doctor");
          }
          return reply({
            date,
            practitioner_id: practitionerId,
            slot_minutes: bookingSettings(clinic).slot_minutes,
            slots: freeSlots(state, clinic, practitionerId, date, clock()),
          } satisfies C.Availability);
        }),

      getWebsiteSettings: (opts) =>
        respond(S.websiteSettings, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          return reply(wireSettings(state, caller.clinic, siteOf(state, caller.clinic.id), bookingSettings(caller.clinic).enabled) satisfies C.WebsiteSettings);
        }),

      updateWebsite: (changes, opts) =>
        respond(S.websiteSettings, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const clinic = caller.clinic;
          const site = siteOf(state, clinic.id);
          const doctors = state.practitioners.filter((p) => p.clinic_id === clinic.id).map((p) => p.id);
          const portraits = photosOf(state, clinic.id).filter((p) => p.kind === "doctor").map((p) => p.id);
          const problem = checkChanges(changes, site, doctors, portraits);
          if (problem !== null) {
            return invalid(problem[0], problem[1]);
          }
          if (changes.layout != null) site.layout = changes.layout === "multi" ? "multi" : "one";
          if (changes.template != null && changes.template !== site.template) {
            site.template = changes.template;
            site.palette = wireSettings(state, clinic, site, true).templates.find((t) => t.id === changes.template)?.palettes[0] ?? site.palette;
          }
          if (changes.palette != null) site.palette = changes.palette;
          if (changes.fonts != null) site.fonts = changes.fonts;
          if (changes.content != null) site.content = cleanContent(changes.content);
          if (changes.custom_domain != null) {
            const domain = parseDomain(changes.custom_domain);
            if (domain === null) {
              site.custom_domain = null;
              site.domain_status = "none";
              site.domain_token = null;
            } else if (domain !== site.custom_domain) {
              site.custom_domain = domain;
              site.domain_status = "pending";
              site.domain_token = `aarogyam-verify-${fakeUuid(random, clock()).replaceAll("-", "").slice(0, 24)}`;
            }
          }
          if (changes.published != null) {
            if (changes.published && !site.published) {
              site.published_at = clock().toISOString();
            }
            site.published = changes.published;
          }
          return reply(wireSettings(state, clinic, site, bookingSettings(clinic).enabled) satisfies C.WebsiteSettings);
        }),

      uploadWebsitePhoto: (form, opts) =>
        respond(S.sitePhoto, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const file = form.get("file");
          if (!(file instanceof File)) {
            return invalid("file", "choose a picture");
          }
          if (file.size > 5 * 1024 * 1024) {
            return refuse(413, "payload_too_large", "That picture is larger than 5 MB.");
          }
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            return invalid("file", "must be a JPEG, PNG or WebP picture");
          }
          const rawKind = form.get("kind");
          const kind = typeof rawKind === "string" && rawKind !== "" ? rawKind : "gallery";
          if (!isPhotoKind(kind)) {
            return invalid("kind", "unknown picture kind");
          }
          const alt = form.get("alt");
          state.websitePhotos ??= [];
          if (kind === "logo" || kind === "hero" || kind === "about") {
            state.websitePhotos = state.websitePhotos.filter((p) => !(p.clinic_id === caller.clinic.id && p.kind === kind));
          }
          const id = fakeUuid(random, clock());
          const photo: FakePhoto = {
            id,
            clinic_id: caller.clinic.id,
            kind,
            alt: typeof alt === "string" && alt.trim() !== "" ? alt.trim() : null,
            url: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : `blob:fake/${id}`,
          };
          state.websitePhotos.push(photo);
          return reply(wirePhoto(photo) satisfies C.SitePhoto);
        }),

      describeWebsitePhoto: (id, changes, opts) =>
        respond(S.sitePhoto, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const photo = photosOf(state, caller.clinic.id).find((p) => p.id === id);
          if (photo === undefined) {
            return notFound;
          }
          photo.alt = changes.alt.trim() === "" ? null : changes.alt.trim();
          return reply(wirePhoto(photo) satisfies C.SitePhoto);
        }),

      deleteWebsitePhoto: (id, opts) =>
        respond(S.voidResponse, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          if (!photosOf(state, caller.clinic.id).some((p) => p.id === id)) {
            return notFound;
          }
          state.websitePhotos = (state.websitePhotos ?? []).filter((p) => p.id !== id);
          const site = siteOf(state, caller.clinic.id);
          for (const doctor of site.content.doctors) {
            if (doctor.photo_id === id) doctor.photo_id = null;
          }
          return { ok: true, body: undefined };
        }),

      getSetup: (opts) =>
        respond(S.setup, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          return reply(wireSetup(setupOf(state, `clinic:${caller.clinic.id}`), CLINIC_STEPS));
        }),

      updateSetup: (update, opts) =>
        respond(S.setup, opts?.signal, async () => {
          const caller = await inClinic("settings.manage");
          if (!isCaller(caller)) {
            return caller;
          }
          const result = applySetup(state, `clinic:${caller.clinic.id}`, CLINIC_STEPS, update, true);
          return typeof result === "string" ? invalid(result.split(": ")[0] ?? "step", result.split(": ")[1] ?? result) : reply(result);
        }),

      getMySetup: (opts) =>
        respond(S.setup, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          return reply(wireSetup(setupOf(state, `member:${caller.membership.id}`), MEMBER_STEPS));
        }),

      updateMySetup: (update, opts) =>
        respond(S.setup, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          const result = applySetup(state, `member:${caller.membership.id}`, MEMBER_STEPS, update, false);
          return typeof result === "string" ? invalid(result.split(": ")[0] ?? "step", result.split(": ")[1] ?? result) : reply(result);
        }),

      getMyPractitioner: (opts) =>
        respond(S.practitioner, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.practitioners.find((p) => p.clinic_id === caller.clinic.id && p.membership_id === caller.membership.id);
          return found === undefined ? notFound : reply(wirePractitioner(found));
        }),

      changeMyPractitioner: (changes, opts) =>
        respond(S.practitioner, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          let found = state.practitioners.find((p) => p.clinic_id === caller.clinic.id && p.membership_id === caller.membership.id);
          if (found === undefined) {
            // Only someone who can issue prescriptions gets a doctor record, made on first save.
            if (!hasPermission(caller.membership.role.permissions, "prescriptions.issue")) {
              return notFound;
            }
            found = {
              id: fakeUuid(random, clock()),
              clinic_id: caller.clinic.id,
              display_name: caller.user.display_name,
              calendar_color: "#64748b",
              active: true,
              membership_id: caller.membership.id,
              registration_number: null,
              qualifications: null,
              specialty: null,
            };
            state.practitioners.push(found);
          }
          if (changes.display_name != null) {
            const name = changes.display_name.trim();
            if (name.length < 1 || name.length > 120) {
              return invalid("display_name", "must be 1 to 120 characters");
            }
            found.display_name = name;
          }
          for (const [field, max] of [["registration_number", 40], ["qualifications", 160], ["specialty", 80]] as const) {
            const given = changes[field];
            if (given != null) {
              if (given.trim().length > max) {
                return invalid(field, `must be at most ${String(max)} characters`);
              }
              found[field] = given.trim() === "" ? null : given.trim();
            }
          }
          return reply(wirePractitioner(found));
        }),

      getMyWorkingHours: (opts) =>
        respond(S.workingHours, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.practitioners.find((p) => p.clinic_id === caller.clinic.id && p.membership_id === caller.membership.id);
          return found === undefined ? notFound : reply({ shifts: wireShifts(state, found.id) } satisfies C.WorkingHours);
        }),

      setMyWorkingHours: (hours, opts) =>
        respond(S.workingHours, opts?.signal, async () => {
          const caller = await inClinic();
          if (!isCaller(caller)) {
            return caller;
          }
          const found = state.practitioners.find((p) => p.clinic_id === caller.clinic.id && p.membership_id === caller.membership.id);
          if (found === undefined) {
            return notFound;
          }
          return replaceShifts(state, caller.clinic, found.id, hours, () => fakeUuid(random, clock()));
        }),

      getPublicSite: (opts) =>
        respond(S.sitePage, opts?.signal, () => {
          const clinic = state.clinics.find((c) => c.host === options.host);
          if (clinic === undefined || clinic.status === "suspended" || clinic.status === "churned") {
            return notFound;
          }
          const site = siteOf(state, clinic.id);
          if (!site.published) {
            return notFound;
          }
          return reply(buildPage(state, clinic, site, bookingSettings(clinic).enabled) satisfies C.SitePage);
        }),

      createOnlineBooking: (input, opts) =>
        respond(S.booked, opts?.signal, async () => {
          const who = await claims();
          if (who === undefined) {
            return signedOut;
          }
          const clinic = state.clinics.find((c) => c.host === options.host);
          if (clinic === undefined || !bookingSettings(clinic).enabled) {
            return notFound;
          }
          if (who.email === undefined) {
            return refuse(403, "email_required", "Verify your email address to book.");
          }
          const email = who.email.trim().toLowerCase();
          const doctor = state.practitioners.find((p) => p.id === input.practitioner_id && p.clinic_id === clinic.id && p.active);
          if (doctor === undefined) {
            return invalid("practitioner_id", "no such doctor");
          }
          if (input.full_name.trim() === "") {
            return invalid("full_name", "must be 1 to 200 characters");
          }
          const phone = normalizeClinicPhone(input.phone.replace(/\s+/g, ""));
          if (!INDIAN_MOBILE.test(phone) && !E164.test(phone)) {
            return invalid("phone", "invalid phone number");
          }
          const now = clock();
          const open = state.appointments.filter(
            (a) =>
              a.clinic_id === clinic.id &&
              a.booked_by_account === who.id &&
              (a.status === "requested" || a.status === "booked" || a.status === "confirmed") &&
              Date.parse(a.ends_at) > now.getTime(),
          ).length;
          if (open >= MAX_OPEN_SELF_BOOKINGS) {
            return refuse(409, "conflict", "you already have the most upcoming booking requests this clinic allows; wait for one to be answered");
          }
          const start = new Date(input.starts_at);
          const day = localClock(start, clinic.timezone).date;
          if (!freeSlots(state, clinic, doctor.id, day, now).some((slot) => Date.parse(slot) === start.getTime())) {
            return refuse(409, "conflict", "that time is no longer available; choose another");
          }
          const settings = bookingSettings(clinic);
          let patient = state.patients.find((p) => p.clinic_id === clinic.id && p.email?.toLowerCase() === email && p.status === "active");
          const isNew = patient === undefined;
          if (patient === undefined) {
            const numbers = state.patients.filter((p) => p.clinic_id === clinic.id).map((p) => Number(p.number.split("-")[1] ?? 0));
            patient = {
              clinic_id: clinic.id,
              id: fakeUuid(random, now),
              number: `${clinic.number_prefix}-${String(1 + Math.max(0, ...numbers))}`,
              full_name: input.full_name.trim().replace(/\s+/g, " "),
              sex: "unknown",
              date_of_birth: null,
              birth_date_estimated: false,
              phone,
              email,
              preferred_language: "en-IN",
              status: "active",
              created_at: now.toISOString(),
              last_visit_at: null,
            } satisfies FakePatient;
            state.patients.push(patient);
          }
          const record: FakeAppointment = {
            id: fakeUuid(random, now),
            clinic_id: clinic.id,
            branch_id: clinic.id,
            patient_id: patient.id,
            practitioner_id: doctor.id,
            room_id: null,
            starts_at: start.toISOString(),
            ends_at: new Date(start.getTime() + settings.slot_minutes * 60_000).toISOString(),
            status: settings.auto_confirm ? "confirmed" : "requested",
            kind: isNew ? "new" : "follow_up",
            source: "website",
            reason: input.reason ?? null,
            notes: null,
            cancel_reason: null,
            arrived_at: null,
            seated_at: null,
            completed_at: null,
            token_number: null,
            booked_by_account: who.id,
          };
          state.appointments.push(record);
          const offsetStart = localIso(day, localClock(start, clinic.timezone).minutes, clinic.timezone);
          const endLocal = localClock(new Date(record.ends_at), clinic.timezone);
          return reply({
            id: record.id,
            status: record.status === "confirmed" ? "confirmed" : "requested",
            starts_at: offsetStart,
            ends_at: localIso(endLocal.date, endLocal.minutes, clinic.timezone),
            doctor_name: doctor.display_name,
            clinic_name: clinic.name,
          } satisfies C.Booked);
        }),

      verifyPrescription: (token, opts) =>
        respond(S.verification, opts?.signal, () => {
          const rx = state.prescriptions.find((r) => r.verify_token === token);
          if (rx === undefined) {
            return notFound;
          }
          const clinic = state.clinics.find((c) => c.id === rx.clinic_id);
          return reply({
            status: rx.status === "cancelled" ? "cancelled" : "valid",
            number: rx.number ?? null,
            clinic_name: clinic?.name ?? "",
            issued_on: rx.issued_at == null ? null : rx.issued_at.slice(0, 10),
          } satisfies C.Verification);
        }),
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
    specialty: clinic.specialty,
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
    online_booking: bookingSettings(clinic),
    letterhead: wireLetterhead(clinic),
  };
}

const LETTERHEAD_TEMPLATES = ["logo_left", "classic", "modern_band", "minimal_line", "two_doctor", "bilingual"] as const;
const LETTERHEAD_DEFAULTS: Omit<C.Letterhead, "has_image" | "has_logo"> = {
  mode: "template",
  template: "classic",
  accent: null,
  show: { logo: true, doctors: true, registration: true, address: true, phone: true, email: true, timings: true, gstin: false },
  local_name: null,
  footer: null,
  email: null,
  timings: null,
  doctor_ids: [],
};

/** The stored settings over the defaults; upload mode without an image is template mode, as in the API. */
function effectiveLetterhead(clinic: FakeClinic): Omit<C.Letterhead, "has_image" | "has_logo"> {
  const stored = clinic.letterhead ?? {};
  const hasImage = clinic.letterhead_images?.letterhead !== undefined;
  const mode = stored.mode === "upload" && !hasImage ? "template" : (stored.mode ?? LETTERHEAD_DEFAULTS.mode);
  return { ...LETTERHEAD_DEFAULTS, ...stored, mode, show: { ...LETTERHEAD_DEFAULTS.show, ...stored.show } };
}

function wireLetterhead(clinic: FakeClinic): C.Letterhead {
  const images = clinic.letterhead_images ?? {};
  return { ...effectiveLetterhead(clinic), has_image: images.letterhead !== undefined, has_logo: images.logo !== undefined };
}

const LETTERHEAD_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;

/** Mirrors the API's letterhead rules, naming the same fields. */
function validateLetterheadChanges(changes: C.LetterheadChanges, clinic: FakeClinic, practitioners: readonly FakePractitioner[]): Outcome | null {
  const next = wireLetterhead(clinic);
  if (changes.mode != null && changes.mode !== "upload" && changes.mode !== "template") {
    return invalid("letterhead.mode", "mode must be upload or template");
  }
  if ((changes.mode ?? next.mode) === "upload" && !next.has_image) {
    return invalid("letterhead.mode", "upload a letterhead image before choosing upload mode");
  }
  if (changes.template != null && !LETTERHEAD_TEMPLATES.some((t) => t === changes.template)) {
    return invalid("letterhead.template", "template must be one of the listed designs");
  }
  if (changes.accent != null && changes.accent !== "" && !HEX_COLOR.test(changes.accent)) {
    return invalid("letterhead.accent", "accent must be a colour like #0F766E");
  }
  if (changes.local_name != null && changes.local_name.length > 120) {
    return invalid("letterhead.local_name", "local_name must be at most 120 characters");
  }
  if (changes.footer != null && changes.footer.length > 200) {
    return invalid("letterhead.footer", "footer must be at most 200 characters");
  }
  if (changes.email != null && changes.email !== "" && !LETTERHEAD_EMAIL.test(changes.email)) {
    return invalid("letterhead.email", "email must be a valid email address");
  }
  if (changes.timings != null && changes.timings.length > 200) {
    return invalid("letterhead.timings", "timings must be at most 200 characters");
  }
  if (changes.doctor_ids != null) {
    const ids = changes.doctor_ids;
    const mine = (id: string) => practitioners.some((p) => p.id === id && p.clinic_id === clinic.id);
    if (ids.length > 4 || new Set(ids).size !== ids.length || !ids.every(mine)) {
      return invalid("letterhead.doctor_ids", "doctor_ids must list at most 4 different doctors of this clinic");
    }
  }
  return null;
}

function applyLetterheadChanges(clinic: FakeClinic, changes: C.LetterheadChanges): void {
  const rest = effectiveLetterhead(clinic);
  const show = { ...rest.show };
  for (const [key, value] of Object.entries(changes.show ?? {})) {
    if (typeof value === "boolean" && key in show) {
      Object.assign(show, { [key]: value });
    }
  }
  const text = (given: string | null | undefined, kept: string | null | undefined): string | null =>
    given == null ? (kept ?? null) : given.trim() === "" ? null : given.trim();
  clinic.letterhead = {
    ...rest,
    mode: changes.mode === "upload" || changes.mode === "template" ? changes.mode : rest.mode,
    template: LETTERHEAD_TEMPLATES.find((t) => t === changes.template) ?? rest.template,
    accent: changes.accent == null ? (rest.accent ?? null) : changes.accent === "" ? null : changes.accent.toUpperCase(),
    show,
    local_name: text(changes.local_name, rest.local_name),
    footer: text(changes.footer, rest.footer),
    email: text(changes.email, rest.email)?.toLowerCase() ?? null,
    timings: text(changes.timings, rest.timings),
    doctor_ids: changes.doctor_ids ?? rest.doctor_ids,
  };
}

function wireLetterheadDocument(clinic: FakeClinic, practitioners: readonly FakePractitioner[]): C.LetterheadDocument {
  const letterhead = wireLetterhead(clinic);
  const active = practitioners.filter((p) => p.clinic_id === clinic.id && p.active).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const chosen = letterhead.doctor_ids.length === 0 ? active.slice(0, 4) : letterhead.doctor_ids.flatMap((id) => active.filter((p) => p.id === id));
  const images = clinic.letterhead_images ?? {};
  return {
    clinic: {
      name: clinic.name,
      legal_name: clinic.legal_name ?? null,
      gstin: clinic.gstin ?? null,
      address: {
        line1: clinic.address?.line1 ?? null,
        line2: clinic.address?.line2 ?? null,
        city: clinic.address?.city ?? null,
        state: clinic.address?.state ?? null,
        pincode: clinic.address?.pincode ?? null,
      },
      phone: clinic.phone ?? null,
    },
    brand: clinic.branding.brand,
    letterhead,
    doctors: chosen.map((p) => ({
      name: p.display_name,
      qualifications: p.qualifications ?? null,
      registration_number: p.registration_number ?? null,
      specialty: p.specialty ?? null,
    })),
    image_url: letterhead.mode === "upload" ? (images.letterhead ?? null) : null,
    logo_url: images.logo ?? null,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

const BOOKING_DEFAULTS: C.OnlineBooking = {
  enabled: true,
  slot_minutes: 15,
  buffer_minutes: 0,
  auto_confirm: false,
  horizon_days: 30,
  min_notice_minutes: 60,
};
/** Most open self-bookings one verified person may hold in a clinic. */
const MAX_OPEN_SELF_BOOKINGS = 2;

function bookingSettings(clinic: FakeClinic): C.OnlineBooking {
  return { ...BOOKING_DEFAULTS, ...clinic.online_booking };
}

/** `9876543210` or `+919876543210` both become `+919876543210`: +91 is assumed without a country code. */
function normalizeClinicPhone(raw: string): string {
  return raw.startsWith("+") ? raw : `+91${raw}`;
}

const UPI_ID = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function validateOnlineBooking(changes: C.OnlineBookingChanges): Outcome | null {
  const { slot_minutes: slot, buffer_minutes: buffer, horizon_days: horizon, min_notice_minutes: notice } = changes;
  if (slot != null && (slot < 5 || slot > 240 || slot % 5 !== 0)) {
    return invalid("booking.slot_minutes", "must be 5 to 240 minutes, in steps of 5");
  }
  if (buffer != null && (buffer < 0 || buffer > 120)) {
    return invalid("booking.buffer_minutes", "must be 0 to 120 minutes");
  }
  if (horizon != null && (horizon < 1 || horizon > 180)) {
    return invalid("booking.horizon_days", "must be 1 to 180 days");
  }
  if (notice != null && (notice < 0 || notice > 10_080)) {
    return invalid("booking.min_notice_minutes", "must be 0 to 10080 minutes");
  }
  return null;
}

function validateClinicSettingsChanges(changes: C.ClinicSettingsChanges): Outcome | null {
  if (changes.online_booking != null) {
    const problem = validateOnlineBooking(changes.online_booking);
    if (problem !== null) {
      return problem;
    }
  }
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
const APPOINTMENT_ORDER: readonly C.AppointmentStatus[] = ["requested", "booked", "confirmed", "arrived", "in_chair", "completed"];

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
    qualifications: p.qualifications ?? null,
    specialty: p.specialty ?? null,
  };
}

function wirePractitionerBrief(p: FakePractitioner): C.PractitionerBrief {
  return { id: p.id, display_name: p.display_name, calendar_color: p.calendar_color };
}

function wireLeave(l: FakeLeave): C.Leave {
  return { id: l.id, practitioner_id: l.practitioner_id, starts_at: l.starts_at, ends_at: l.ends_at, reason: l.reason ?? null };
}

/** Replaces a doctor's weekly hours after the API's checks (weekday 1 to 7, end after start, no overlap). */
function replaceShifts(state: Fixtures, clinic: FakeClinic, practitionerId: string, hours: C.WorkingHours, newId: () => string): Outcome {
  for (const shift of hours.shifts) {
    if (!Number.isInteger(shift.weekday) || shift.weekday < 1 || shift.weekday > 7) {
      return invalid("shifts", "weekday must be 1 to 7");
    }
    if (shift.starts >= shift.ends) {
      return invalid("shifts", "end must be after the start");
    }
  }
  const sorted = [...hours.shifts].sort((a, b) => a.weekday - b.weekday || a.starts.localeCompare(b.starts));
  for (let i = 1; i < sorted.length; i += 1) {
    const [before, after] = [sorted[i - 1], sorted[i]];
    if (before !== undefined && after !== undefined && before.weekday === after.weekday && after.starts < before.ends) {
      return invalid("shifts", "shifts on one day must not overlap");
    }
  }
  state.workingShifts = state.workingShifts.filter((s) => s.practitioner_id !== practitionerId);
  for (const shift of hours.shifts) {
    state.workingShifts.push({
      id: newId(),
      clinic_id: clinic.id,
      practitioner_id: practitionerId,
      branch_id: shift.branch_id ?? clinic.id,
      weekday: shift.weekday,
      starts: shift.starts,
      ends: shift.ends,
    });
  }
  return reply({ shifts: wireShifts(state, practitionerId) } satisfies C.WorkingHours);
}

function wireShifts(state: Fixtures, practitionerId: string): C.WorkingShift[] {
  return state.workingShifts
    .filter((s) => s.practitioner_id === practitionerId)
    .map((s) => ({ weekday: s.weekday, starts: s.starts, ends: s.ends, branch_id: s.branch_id }));
}

/** What the list and the record header add to a patient: the next booking and the money. */
function patientSummary(
  state: Fixtures,
  p: FakePatient,
  now: Date,
  money: boolean,
): {
  next_appointment: { starts_at: string; practitioner: string } | null;
  balance_paise: number | null;
  lifetime_paid_paise: number | null;
  recall_due: boolean;
} {
  const next = state.appointments
    .filter((a) => a.patient_id === p.id && (a.status === "booked" || a.status === "confirmed") && new Date(a.starts_at) >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const practitioner = next === undefined ? undefined : state.practitioners.find((x) => x.id === next.practitioner_id);
  const balance = state.invoices
    .filter((i) => i.patient_id === p.id && i.status === "issued")
    .reduce((sum, i) => sum + wireInvoice(i, state, false).balance_paise, 0);
  const paid = state.payments.filter((x) => x.patient_id === p.id && x.status === "received").reduce((sum, x) => sum + x.amount_paise, 0);
  return {
    next_appointment: next === undefined || practitioner === undefined ? null : { starts_at: next.starts_at, practitioner: practitioner.display_name },
    balance_paise: money ? balance : null,
    lifetime_paid_paise: money ? paid : null,
    recall_due: false,
  };
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
    row_version: 1,
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

/** The member a clinical record names, as the API shows them there: ID and display name. */
function memberRefOf(state: Fixtures, membershipId: string): C.MemberRef | undefined {
  const membership = state.memberships.find((m) => m.id === membershipId);
  if (membership === undefined) {
    return undefined;
  }
  const member = wireMember(membership, state);
  return { id: member.id, name: member.display_name };
}

function wireAllergy(a: FakeAllergy): C.Allergy {
  return {
    id: a.id,
    substance: a.substance,
    reaction: a.reaction ?? null,
    severity: a.severity,
    status: a.status,
    source: a.source,
    code: a.code ?? null,
    verified_by: a.verified_by ?? null,
    confirmed: a.verified_by != null,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

function wireCondition(c: FakeCondition): C.Condition {
  return {
    id: c.id,
    display_text: c.display_text,
    flagged: c.flagged,
    status: c.status,
    source: c.source,
    code: c.code ?? null,
    note: c.note ?? null,
    onset: c.onset ?? null,
    verified_by: c.verified_by ?? null,
    visit_id: c.visit_id ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function wireVisit(v: FakeVisit, state: Fixtures): C.Visit | undefined {
  const clinician = memberRefOf(state, v.clinician_membership_id);
  if (clinician === undefined) {
    return undefined;
  }
  return {
    id: v.id,
    number: v.number,
    patient_id: v.patient_id,
    clinician,
    appointment_id: v.appointment_id ?? null,
    chief_complaint: v.chief_complaint ?? null,
    status: v.status,
    started_at: v.started_at,
    ended_at: v.ended_at ?? null,
  };
}

function wireSummary(s: FakeSummaryNote, state: Fixtures): C.SummaryNote {
  return {
    body: s.body,
    row_version: s.row_version,
    updated_at: s.updated_at,
    updated_by: memberRefOf(state, s.updated_by_membership_id)?.name ?? null,
  };
}

function wireNote(n: FakeNote, state: Fixtures): C.Note | undefined {
  const author = memberRefOf(state, n.author_membership_id);
  if (author === undefined) {
    return undefined;
  }
  const addenda = n.addenda.flatMap((addendum): C.Addendum[] => {
    const addendumAuthor = memberRefOf(state, addendum.author_membership_id);
    return addendumAuthor === undefined ? [] : [{ id: addendum.id, author: addendumAuthor, body: addendum.body, created_at: addendum.created_at }];
  });
  return {
    id: n.id,
    row_version: 1,
    visit_id: n.visit_id,
    author,
    kind: n.kind,
    source: n.source,
    status: n.status,
    sections: n.sections,
    addenda,
    error_reason: n.error_reason ?? null,
    conflicts_with_id: n.conflicts_with_id ?? null,
    signed_at: n.signed_at ?? null,
    created_at: n.created_at,
    updated_at: n.updated_at,
  };
}

function wireObservation(o: FakeObservation): C.Observation {
  return {
    id: o.id,
    visit_id: o.visit_id ?? null,
    kind: o.kind,
    value: o.value,
    unit: o.unit,
    status: o.status,
    source: o.source,
    supersedes_id: o.supersedes_id ?? null,
    error_reason: o.error_reason ?? null,
    recorded_at: o.recorded_at,
  };
}

function wirePlan(p: FakePlan, state: Fixtures): C.Plan | undefined {
  const clinician = memberRefOf(state, p.clinician_membership_id);
  if (clinician === undefined) {
    return undefined;
  }
  return {
    id: p.id,
    patient_id: p.patient_id,
    visit_id: p.visit_id ?? null,
    clinician,
    title: p.title,
    status: p.status,
    items: p.items.map((i) => ({
      id: i.id,
      name: i.name,
      code: i.code ?? null,
      tooth: i.tooth ?? null,
      surfaces: i.surfaces,
      phase: i.phase,
      estimate_paise: i.estimate_paise,
      status: i.status,
      procedure_id: i.procedure_id ?? null,
    })),
    estimate_paise: p.items.filter((i) => i.status !== "cancelled").reduce((sum, i) => sum + i.estimate_paise, 0),
    created_at: p.created_at,
    accepted_at: p.accepted_at ?? null,
  };
}

/** A done procedure carrying out a plan item finishes the item, and the plan once every kept item is done. */
function markPlanItemDone(state: Fixtures, itemId: string, procedureId: string): void {
  for (const plan of state.plans) {
    const item = plan.items.find((i) => i.id === itemId);
    if (item === undefined) {
      continue;
    }
    item.status = "done";
    item.procedure_id = procedureId;
    const kept = plan.items.filter((i) => i.status !== "cancelled");
    plan.status = kept.every((i) => i.status === "done") ? "completed" : "in_progress";
  }
}

function wireProcedure(p: FakeProcedure, state: Fixtures): C.Procedure | undefined {
  const clinician = memberRefOf(state, p.clinician_membership_id);
  if (clinician === undefined) {
    return undefined;
  }
  return {
    id: p.id,
    visit_id: p.visit_id,
    clinician,
    name: p.name,
    tooth: p.tooth ?? null,
    surfaces: p.surfaces,
    status: p.status,
    note: p.note ?? null,
    price_paise: p.price_paise ?? null,
    plan_item_id: p.plan_item_id ?? null,
    performed_at: p.performed_at ?? null,
    error_reason: p.error_reason ?? null,
    created_at: p.created_at,
  };
}

function wireChartEntry(c: FakeChartEntry, state: Fixtures): C.ChartEntry {
  const terms = clinicTerms(state.dentalTerms, c.clinic_id);
  const term = (id: string | null | undefined) => (id == null ? null : (terms.find((t) => t.id === id) ?? null));
  return {
    id: c.id,
    tooth: c.tooth,
    surface: c.surface ?? null,
    finding: c.finding,
    procedure: term(c.procedure),
    material: term(c.material),
    note: c.note ?? null,
    status: c.status,
    recorded_by: c.recorded_by ?? null,
    supersedes_id: c.supersedes_id ?? null,
    visit_id: c.visit_id ?? null,
    effective_at: c.effective_at,
  };
}

function wireAttachment(a: FakeAttachment): C.Attachment {
  return {
    shared_with_patient: a.shared_with_patient ?? false,
    id: a.id,
    kind: a.kind,
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
    sha256: a.sha256,
    caption: a.caption ?? null,
    label: a.label ?? null,
    tooth: a.tooth ?? null,
    taken_at: a.taken_at ?? null,
    visit_id: a.visit_id ?? null,
    created_at: a.created_at,
    note_id: a.note_id ?? null,
    addendum_id: a.addendum_id ?? null,
    duration_seconds: a.duration_seconds ?? null,
    language: a.language ?? null,
  };
}

const OBSERVATION_UNITS: Readonly<Record<C.ObservationKind, string>> = {
  bp_systolic: "mmHg",
  bp_diastolic: "mmHg",
  pulse: "/min",
  temperature: "Cel",
  spo2: "%",
  weight: "kg",
  height: "cm",
  blood_sugar: "mg/dL",
};

function parseSurface(value: string | null | undefined): C.ToothSurface | null {
  return value === "M" || value === "O" || value === "D" || value === "B" || value === "L" ? value : null;
}

function parseSurfaces(values: readonly string[] | undefined): C.ToothSurface[] {
  return (values ?? []).flatMap((value) => {
    const parsed = parseSurface(value);
    return parsed === null ? [] : [parsed];
  });
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

/** `2026-10-05T09:00:00+05:30`: a local time with the zone's offset, as the API sends slots. */
function localIso(date: string, minutes: number, timezone: string): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  const offset = Math.round((Date.UTC(year, month - 1, day, 0, minutes) - atLocalTime(date, minutes, timezone).getTime()) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date}T${two(Math.floor(minutes / 60))}:${two(minutes % 60)}:00${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** The slots a patient may take: working hours minus leave minus active appointments (widened by the buffer). */
function freeSlots(state: Fixtures, clinic: FakeClinic, practitionerId: string, date: string, now: Date): string[] {
  const settings = bookingSettings(clinic);
  const ahead = daysBetween(localClock(now, clinic.timezone).date, date);
  if (ahead < 0 || ahead >= settings.horizon_days) {
    return [];
  }
  const weekday = isoWeekday(date);
  const earliest = now.getTime() + settings.min_notice_minutes * 60_000;
  const buffer = settings.buffer_minutes * 60_000;
  const slots: string[] = [];
  for (const shift of state.workingShifts.filter((s) => s.clinic_id === clinic.id && s.practitioner_id === practitionerId && s.weekday === weekday)) {
    for (let at = toMinutes(shift.starts); at + settings.slot_minutes <= toMinutes(shift.ends); at += settings.slot_minutes) {
      const start = atLocalTime(date, at, clinic.timezone).getTime();
      const end = start + settings.slot_minutes * 60_000;
      const taken =
        state.appointments.some(
          (a) =>
            a.clinic_id === clinic.id &&
            a.practitioner_id === practitionerId &&
            a.status !== "cancelled" &&
            a.status !== "no_show" &&
            Date.parse(a.starts_at) < end + buffer &&
            start - buffer < Date.parse(a.ends_at),
        ) || state.leave.some((l) => l.clinic_id === clinic.id && l.practitioner_id === practitionerId && Date.parse(l.starts_at) < end && start < Date.parse(l.ends_at));
      if (start >= earliest && !taken) {
        slots.push(localIso(date, at, clinic.timezone));
      }
    }
  }
  return slots.sort();
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

// Onboarding: applications, clinic detail -------------------------------------------------------

function wireApplication(a: FakeApplication): C.Application {
  return {
    id: a.id,
    clinic_name: a.clinic_name,
    city: a.city,
    specialty: a.specialty,
    contact_name: a.contact_name,
    email: a.email,
    phone: a.phone ?? null,
    message: a.message ?? null,
    status: a.status,
    submissions: a.submissions,
    clinic_id: a.clinic_id ?? null,
    decided_at: a.decided_at ?? null,
    decided_by: a.decided_by ?? null,
    decision_reason: a.decision_reason ?? null,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

/** A membership plus its person's name, email and status, for the console's clinic detail. */
function wireClinicMember(m: FakeMembership, state: Fixtures): C.ClinicMember {
  const user = state.users.find((u) => u.id === m.user_id);
  return {
    membership_id: m.id,
    display_name: user?.display_name ?? "Unknown",
    email: user?.email ?? null,
    role_key: m.role.key,
    role_name: m.role.name,
    status: m.status ?? "active",
    joined_at: m.joined_at ?? null,
  };
}

// Billing: price list, invoices, payments, reports -----------------------------------------------

function wireDrug(d: FakeDrug): C.Drug {
  return {
    id: d.id,
    generic_name: d.generic_name,
    brand_name: d.brand_name ?? null,
    form: d.form,
    strength: d.strength,
    default_dose: d.default_dose,
    default_frequency: d.default_frequency,
    default_timing: d.default_timing ?? null,
    default_duration_days: d.default_duration_days ?? null,
  };
}

function wireSupplier(s: FakeSupplier): C.Supplier {
  return { id: s.id, name: s.name, phone: s.phone ?? null, gstin: s.gstin ?? null, active: s.active };
}

function wireBatch(b: FakeStockBatch): C.StockBatch {
  return {
    id: b.id,
    supplier_id: b.supplier_id ?? null,
    batch_no: b.batch_no ?? null,
    expiry: b.expiry ?? null,
    received_quantity: b.received_quantity,
    quantity: b.quantity,
    unit_cost_paise: b.unit_cost_paise,
    received_on: b.received_on,
  };
}

function wireMovement(m: FakeStockMovement): C.StockMovement {
  return { id: m.id, batch_id: m.batch_id, kind: m.kind, quantity: m.quantity, reason: m.reason ?? null, at: m.at, by: m.by ?? null };
}

function wirePriceItem(p: FakePriceItem): C.PriceItem {
  return {
    id: p.id,
    name: p.name,
    code: p.code ?? null,
    category: p.category ?? null,
    price_paise: p.price_paise,
    taxable: p.taxable,
    gst_rate: p.gst_rate,
    sac_hsn: p.sac_hsn ?? null,
    active: p.active,
  };
}

function patientRefFor(state: Fixtures, patientId: string): C.PatientRef {
  const patient = state.patients.find((p) => p.id === patientId);
  return patient === undefined ? { id: patientId, name: "Unknown", number: "?" } : { id: patient.id, name: patient.full_name, number: patient.number };
}

/** Builds one bill line from a price list entry or free text, computing GST on the discounted base. */
function buildInvoiceLine(
  lineNo: number,
  input: C.InvoiceLineInput,
  priceItems: readonly FakePriceItem[],
): { line: FakeInvoiceLine } | { error: Outcome } {
  const priced = input.price_item_id == null ? undefined : priceItems.find((p) => p.id === input.price_item_id);
  if (input.price_item_id != null && priced === undefined) {
    return { error: invalid("items", "unknown price list entry") };
  }
  const description = input.description ?? priced?.name;
  if (description == null || description.trim() === "") {
    return { error: invalid("items", "description is required for a free-text line") };
  }
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { error: invalid("items", "quantity must be at least 1") };
  }
  const unitPrice = input.unit_price_paise ?? priced?.price_paise;
  if (unitPrice == null) {
    return { error: invalid("items", "unit_price_paise is required for a free-text line") };
  }
  const gstRate = input.gst_rate ?? priced?.gst_rate ?? 0;
  const taxable = priced?.taxable ?? gstRate > 0;
  const discount = input.discount_paise ?? 0;
  const grossTaxable = Math.max(0, quantity * unitPrice - discount);
  const taxablePaise = taxable ? grossTaxable : 0;
  const tax = Math.round(taxablePaise * (gstRate / 100));
  const cgst = Math.round(tax / 2);
  const sgst = tax - cgst;
  return {
    line: {
      line_no: lineNo,
      description,
      price_item_id: input.price_item_id ?? null,
      procedure_id: input.procedure_id ?? null,
      quantity,
      unit_price_paise: unitPrice,
      discount_paise: discount,
      gst_rate: gstRate,
      sac_hsn: input.sac_hsn ?? priced?.sac_hsn ?? null,
      taxable_paise: taxablePaise,
      cgst_paise: cgst,
      sgst_paise: sgst,
      igst_paise: 0,
      total_paise: grossTaxable + tax,
    },
  };
}

function wireInvoiceLine(l: FakeInvoiceLine): C.InvoiceLine {
  return {
    line_no: l.line_no,
    description: l.description,
    price_item_id: l.price_item_id ?? null,
    procedure_id: l.procedure_id ?? null,
    quantity: l.quantity,
    unit_price_paise: l.unit_price_paise,
    discount_paise: l.discount_paise,
    gst_rate: l.gst_rate,
    sac_hsn: l.sac_hsn ?? null,
    taxable_paise: l.taxable_paise,
    cgst_paise: l.cgst_paise,
    sgst_paise: l.sgst_paise,
    igst_paise: l.igst_paise,
    total_paise: l.total_paise,
  };
}

function computeInvoiceAmounts(items: readonly FakeInvoiceLine[]) {
  const subtotal_paise = items.reduce((sum, l) => sum + l.quantity * l.unit_price_paise, 0);
  const discount_paise = items.reduce((sum, l) => sum + l.discount_paise, 0);
  const taxable_paise = items.reduce((sum, l) => sum + l.taxable_paise, 0);
  const cgst_paise = items.reduce((sum, l) => sum + l.cgst_paise, 0);
  const sgst_paise = items.reduce((sum, l) => sum + l.sgst_paise, 0);
  const igst_paise = items.reduce((sum, l) => sum + l.igst_paise, 0);
  const rawTotal = items.reduce((sum, l) => sum + l.total_paise, 0);
  const rounded = Math.round(rawTotal / 100) * 100;
  return {
    subtotal_paise,
    discount_paise,
    taxable_paise,
    cgst_paise,
    sgst_paise,
    igst_paise,
    tax_paise: cgst_paise + sgst_paise + igst_paise,
    round_off_paise: rounded - rawTotal,
    total_paise: rounded,
  };
}

function paymentsFor(state: Fixtures, invoiceId: string): FakePayment[] {
  return state.payments.filter((p) => p.status === "received" && p.allocations.some((a) => a.invoice_id === invoiceId));
}

function wireInvoice(inv: FakeInvoice, state: Fixtures, forList: boolean): C.Invoice {
  const clinic = state.clinics.find((c) => c.id === inv.clinic_id);
  const patient = state.patients.find((p) => p.id === inv.patient_id);
  const amounts = computeInvoiceAmounts(inv.items);
  const coveringPayments = paymentsFor(state, inv.id);
  const paidPaise = coveringPayments.reduce((sum, p) => sum + (p.allocations.find((a) => a.invoice_id === inv.id)?.amount_paise ?? 0), 0);
  const balance = inv.status === "issued" ? Math.max(0, amounts.total_paise - paidPaise) : 0;
  const paymentState: string | null = inv.status === "issued" ? (paidPaise <= 0 ? "unpaid" : balance > 0 ? "partial" : "paid") : null;
  return {
    id: inv.id,
    status: inv.status,
    number: inv.number ?? null,
    patient: patient === undefined ? { id: inv.patient_id, name: "Unknown", number: "?" } : { id: patient.id, name: patient.full_name, number: patient.number },
    encounter_id: inv.encounter_id ?? null,
    items: forList ? [] : inv.items.map(wireInvoiceLine),
    subtotal_paise: amounts.subtotal_paise,
    discount_paise: amounts.discount_paise,
    taxable_paise: amounts.taxable_paise,
    cgst_paise: amounts.cgst_paise,
    sgst_paise: amounts.sgst_paise,
    igst_paise: amounts.igst_paise,
    tax_paise: amounts.tax_paise,
    round_off_paise: amounts.round_off_paise,
    total_paise: amounts.total_paise,
    paid_paise: paidPaise,
    balance_paise: balance,
    payment_state: paymentState,
    methods: [...new Set(coveringPayments.map((p) => p.method))],
    notes: inv.notes ?? null,
    place_of_supply: inv.place_of_supply ?? null,
    doc_type: inv.status === "issued" ? "tax_invoice" : null,
    recipient: patient === undefined ? null : { name: patient.full_name, number: patient.number },
    supplier: clinic === undefined ? null : { name: clinic.name, legal_name: clinic.legal_name ?? null, gstin: clinic.gstin ?? null },
    replaces_invoice_id: inv.replaces_invoice_id ?? null,
    void_reason: inv.void_reason ?? null,
    voided_at: inv.voided_at ?? null,
    created_at: inv.created_at,
    issued_at: inv.issued_at ?? null,
  };
}

function wirePayment(p: FakePayment, state: Fixtures): C.Payment {
  const allocated = p.allocations.reduce((sum, a) => sum + a.amount_paise, 0);
  return {
    id: p.id,
    number: p.number,
    status: p.status,
    patient: patientRefFor(state, p.patient_id),
    method: p.method,
    amount_paise: p.amount_paise,
    allocated_paise: allocated,
    unallocated_paise: p.amount_paise - allocated,
    allocations: p.allocations.map((a) => ({ invoice_id: a.invoice_id, amount_paise: a.amount_paise })),
    reference: p.reference ?? null,
    received_at: p.received_at,
    void_reason: p.void_reason ?? null,
  };
}

function nextInvoiceNumber(state: Fixtures, clinic: FakeClinic): string {
  const count = state.invoices.filter((i) => i.clinic_id === clinic.id && i.number != null).length;
  return `${clinic.number_prefix}/26-27/${String(count + 1).padStart(6, "0")}`;
}

function nextReceiptNumber(state: Fixtures, clinic: FakeClinic): string {
  const count = state.payments.filter((p) => p.clinic_id === clinic.id).length;
  return `RC/26-27/${String(count + 1).padStart(6, "0")}`;
}

function nextPrescriptionNumber(state: Fixtures, clinic: FakeClinic): string {
  const count = state.prescriptions.filter((p) => p.clinic_id === clinic.id && p.number != null).length;
  return `RX-${String(count + 1)}`;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(dateOnly(cursor));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return dateOnly(new Date(d.getTime() - diff * 86_400_000));
}

function buildDayTotals(payments: readonly FakePayment[], from: string, to: string): C.DayTotal[] {
  return eachDate(from, to).map((date) => {
    const dayPayments = payments.filter((p) => p.received_at.slice(0, 10) === date);
    return { date, amount_paise: dayPayments.reduce((sum, p) => sum + p.amount_paise, 0), payments: dayPayments.length };
  });
}

function buildWeekTotals(payments: readonly FakePayment[], from: string, to: string): C.DayTotal[] {
  const weeks = new Map<string, { amount: number; count: number }>();
  for (const date of eachDate(from, to)) {
    const key = weekStart(date);
    if (!weeks.has(key)) {
      weeks.set(key, { amount: 0, count: 0 });
    }
  }
  for (const p of payments) {
    const key = weekStart(p.received_at.slice(0, 10));
    const bucket = weeks.get(key) ?? { amount: 0, count: 0 };
    bucket.amount += p.amount_paise;
    bucket.count += 1;
    weeks.set(key, bucket);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, amount_paise: v.amount, payments: v.count }));
}

function buildMethodTotals(payments: readonly FakePayment[]): C.MethodTotal[] {
  const total = payments.reduce((sum, p) => sum + p.amount_paise, 0);
  const byMethod = new Map<string, { amount: number; count: number }>();
  for (const p of payments) {
    const bucket = byMethod.get(p.method) ?? { amount: 0, count: 0 };
    bucket.amount += p.amount_paise;
    bucket.count += 1;
    byMethod.set(p.method, bucket);
  }
  return [...byMethod.entries()].map(([method, v]) => ({
    method,
    amount_paise: v.amount,
    payments: v.count,
    share_bps: total === 0 ? 0 : Math.round((v.amount / total) * 10_000),
  }));
}

function buildRevenueMix(invoices: readonly FakeInvoice[], priceItems: readonly FakePriceItem[]): C.MixItem[] {
  const total = invoices.reduce((sum, i) => sum + computeInvoiceAmounts(i.items).total_paise, 0);
  const byCategory = new Map<string, number>();
  for (const invoice of invoices) {
    for (const line of invoice.items) {
      const category = (line.price_item_id == null ? undefined : priceItems.find((p) => p.id === line.price_item_id)?.category) ?? "other";
      byCategory.set(category, (byCategory.get(category) ?? 0) + line.total_paise);
    }
  }
  return [...byCategory.entries()].map(([category, amount]) => ({
    category,
    amount_paise: amount,
    share_bps: total === 0 ? 0 : Math.round((amount / total) * 10_000),
  }));
}

function agingBucketFor(ageDays: number): "0_30" | "31_60" | "61_90" | "90_plus" {
  if (ageDays <= 30) return "0_30";
  if (ageDays <= 60) return "31_60";
  if (ageDays <= 90) return "61_90";
  return "90_plus";
}

/** Issued bills with a balance, for both the pending report and Today's money. */
function pendingItemsFor(state: Fixtures, clinicId: string, now: Date): (C.PendingItem & { ageDays: number; bucket: "0_30" | "31_60" | "61_90" | "90_plus" })[] {
  return state.invoices
    .filter((i) => i.clinic_id === clinicId && i.status === "issued")
    .map((invoice) => {
      const wired = wireInvoice(invoice, state, false);
      const issuedAt = invoice.issued_at ?? invoice.created_at;
      const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(issuedAt).getTime()) / 86_400_000));
      const bucket = agingBucketFor(ageDays);
      return {
        invoice_id: invoice.id,
        number: invoice.number ?? null,
        patient: wired.patient,
        total_paise: wired.total_paise,
        paid_paise: wired.paid_paise,
        balance_paise: wired.balance_paise,
        issued_at: invoice.issued_at ?? null,
        age_days: ageDays,
        bucket,
        ageDays,
      };
    })
    .filter((item) => item.balance_paise > 0);
}

// Prescriptions -----------------------------------------------------------------------------------

function wireRxItem(i: FakeRxItem): C.RxItem {
  return {
    drug_id: i.drug_id ?? null,
    drug_name: i.drug_name ?? null,
    form: i.form ?? null,
    strength: i.strength ?? null,
    dose: i.dose ?? null,
    frequency: i.frequency ?? null,
    timing: i.timing ?? null,
    duration_days: i.duration_days ?? null,
    instructions: i.instructions ?? null,
  };
}

function wireAlert(a: FakeAlert): C.Alert {
  return {
    kind: a.kind,
    severity: a.severity,
    message: a.message,
    line_no: a.line_no ?? null,
    action: a.action ?? null,
    override_reason: a.override_reason ?? null,
  };
}

function buildRxItems(items: readonly C.RxItem[]): { items: FakeRxItem[] } | { error: Outcome } {
  const built: FakeRxItem[] = [];
  for (const item of items) {
    if ((item.drug_id == null || item.drug_id === "") && (item.drug_name == null || item.drug_name.trim() === "")) {
      return { error: invalid("items", "give a catalogue drug or a free-text name") };
    }
    built.push({
      drug_id: item.drug_id ?? null,
      drug_name: item.drug_name ?? null,
      form: item.form ?? null,
      strength: item.strength ?? null,
      dose: item.dose ?? null,
      frequency: item.frequency ?? null,
      timing: item.timing ?? null,
      duration_days: item.duration_days ?? null,
      instructions: item.instructions ?? null,
    });
  }
  return { items: built };
}

/** Matches a prescription's medicines against the patient's active allergies, by substance text. */
function findAllergyAlerts(
  state: Fixtures,
  patientId: string,
  clinicId: string,
  items: readonly FakeRxItem[],
  drugs: readonly FakeDrug[],
): FakeAlert[] {
  const allergies = state.allergies.filter((a) => a.patient_id === patientId && a.clinic_id === clinicId && a.status === "active");
  if (allergies.length === 0) {
    return [];
  }
  const alerts: FakeAlert[] = [];
  items.forEach((item, index) => {
    const catalog = item.drug_id == null ? undefined : drugs.find((d) => d.id === item.drug_id);
    const names = [item.drug_name, catalog?.generic_name, catalog?.brand_name]
      .filter((n): n is string => n != null && n !== "")
      .map((n) => n.toLowerCase());
    for (const allergy of allergies) {
      const substance = allergy.substance.toLowerCase();
      if (names.some((name) => name.includes(substance) || substance.includes(name))) {
        alerts.push({
          kind: "allergy",
          severity: allergy.severity === "severe" ? "serious" : allergy.severity === "moderate" ? "caution" : "info",
          message: `${item.drug_name ?? catalog?.generic_name ?? "This medicine"} may conflict with a recorded allergy to ${allergy.substance}.`,
          line_no: index + 1,
        });
      }
    }
  });
  return alerts;
}

function buildPrintData(rx: FakePrescription, state: Fixtures): C.PrintData {
  const clinic = state.clinics.find((c) => c.id === rx.clinic_id);
  const patient = state.patients.find((p) => p.id === rx.patient_id);
  const membership = rx.issued_by_membership_id == null ? undefined : state.memberships.find((m) => m.id === rx.issued_by_membership_id);
  const practitioner = membership === undefined ? undefined : state.practitioners.find((pr) => pr.membership_id === membership.id);
  const doctorUser = membership === undefined ? undefined : state.users.find((u) => u.id === membership.user_id);
  return {
    letterhead: {
      name: clinic?.name ?? "",
      legal_name: clinic?.legal_name ?? null,
      gstin: clinic?.gstin ?? null,
      address: { ...(clinic?.address ?? {}) },
      phone: clinic?.phone ?? null,
      brand: clinic?.branding.brand ?? "#14a89a",
    },
    doctor: { display_name: practitioner?.display_name ?? doctorUser?.display_name ?? null, registration_number: practitioner?.registration_number ?? null },
    patient:
      patient === undefined
        ? {}
        : { name: patient.full_name, number: patient.number, age_years: ageYears(patient.date_of_birth, new Date()), sex: patient.sex },
    footer: clinic?.prescription_footer ?? null,
    verify_path: `/verify/prescriptions/${rx.verify_token ?? ""}`,
    brand_line: "Prescribed with Aarogyam",
  };
}

function wirePrescription(rx: FakePrescription, state: Fixtures): C.Prescription {
  return {
    id: rx.id,
    status: rx.status,
    number: rx.number ?? null,
    patient: patientRefFor(state, rx.patient_id),
    encounter_id: rx.encounter_id ?? null,
    diagnosis_text: rx.diagnosis_text ?? null,
    items: rx.items.map(wireRxItem),
    advice: rx.advice ?? null,
    follow_up_on: rx.follow_up_on ?? null,
    language: rx.language,
    alerts: rx.alerts.map(wireAlert),
    override_reason: rx.override_reason ?? null,
    supersedes_id: rx.supersedes_id ?? null,
    superseded_by: rx.superseded_by ?? null,
    cancel_reason: rx.cancel_reason ?? null,
    cancelled_at: rx.cancelled_at ?? null,
    created_at: rx.created_at,
    issued_at: rx.issued_at ?? null,
    print: rx.status === "issued" ? buildPrintData(rx, state) : null,
  };
}
