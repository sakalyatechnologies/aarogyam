/** The real client: `fetch` against one API host, decoding every response at the boundary. */

import type { z } from "zod";

import type { ApiClient, DateRange } from "./client.js";
import { failure, parseApiError, success, type ApiResult } from "./result.js";
import {
  appointmentList,
  clinicSettings,
  consoleClinics,
  createdClinic,
  createdInvitation,
  devTokenResponse,
  importResult,
  joined,
  leave,
  leaveList,
  meResponse,
  member,
  metricsResponse,
  mySessionsResponse,
  patient,
  patientList,
  practitioner,
  practitionerList,
  qualityReport,
  queueDay,
  queueToken,
  requestId,
  room,
  roomList,
  rolesResponse,
  savedAppointment,
  sessionResponse,
  staffResponse,
  statusChanged,
  todayResponse,
  voidResponse,
  workingHours,
  type RequestId,
} from "./schemas.js";

/** Returns the current access token, or `null` when signed out. */
export type TokenSource = () => Promise<string | null> | string | null;

export interface HttpClientOptions {
  /** Defaults to the global `fetch`; tests pass their own. */
  fetch?: typeof fetch;
}

type Query = Readonly<Record<string, string | number | undefined>>;

interface Call<T> {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  schema: z.ZodType<T>;
  query?: Query;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

/**
 * Creates a client for the API at `baseUrl`: an origin such as
 * `http://sunrise.localtest.me:5173`, or `""` for the page's own origin (the usual case).
 */
export function createHttpClient(baseUrl: string, getToken: TokenSource, options: HttpClientOptions = {}): ApiClient {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const root = baseUrl.replace(/\/+$/, "");

  async function call<T>({ method, path, schema, query, body, signal }: Call<T>): Promise<ApiResult<T>> {
    const headers = new Headers({ accept: "application/json" });
    const token = await getToken();
    if (token !== null && token !== "") {
      headers.set("authorization", `Bearer ${token}`);
    }
    // Patient data must never sit in the browser's HTTP cache.
    const init: RequestInit = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }
    if (signal !== undefined) {
      init.signal = signal;
    }

    let response: Response;
    try {
      response = await send(`${root}${path}${toSearch(query)}`, init);
    } catch (thrown) {
      return failure(
        signal?.aborted === true || isAbortError(thrown)
          ? { status: 0, code: "aborted", message: "The request was cancelled." }
          : { status: 0, code: "network_error", message: "Can't reach Aarogyam. Check your connection and try again." },
      );
    }

    const id = readRequestId(response);
    const payload = await readJson(response);
    if (!response.ok) {
      return failure(parseApiError(response.status, payload, id));
    }
    const decoded = schema.safeParse(payload);
    if (!decoded.success) {
      // The issues may quote values from the body, so they are never surfaced.
      return failure({
        status: response.status,
        code: "invalid_response",
        message: "The server sent a response this app doesn't understand. Please reload.",
        ...(id === undefined ? {} : { requestId: id }),
      });
    }
    return success(decoded.data);
  }

  return {
    getMe: (opts) => call({ method: "GET", path: "/api/v1/me", schema: meResponse, signal: opts?.signal }),
    acceptInvitation: (input, opts) =>
      call({ method: "POST", path: "/api/v1/invitations/accept", schema: joined, body: input, signal: opts?.signal }),
    getSession: (opts) => call({ method: "GET", path: "/api/v1/session", schema: sessionResponse, signal: opts?.signal }),
    listPatients: (opts) => call({ method: "GET", path: "/api/v1/patients", schema: patientList, signal: opts?.signal }),
    searchPatients: (search, opts) =>
      call({
        method: "POST",
        path: "/api/v1/patients/search",
        schema: patientList,
        body: { q: search.q.trim(), ...(search.limit === undefined ? {} : { limit: search.limit }) },
        signal: opts?.signal,
      }),
    getPatient: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}`, schema: patient, signal: opts?.signal }),
    createPatient: (input, opts) =>
      call({ method: "POST", path: "/api/v1/patients", schema: patient, body: input, signal: opts?.signal }),
    getToday: (opts) => call({ method: "GET", path: "/api/v1/today", schema: todayResponse, signal: opts?.signal }),
    updatePatient: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/patients/${encodeURIComponent(id)}`, schema: patient, body: changes, signal: opts?.signal }),

    listRooms: (opts) => call({ method: "GET", path: "/api/v1/rooms", schema: roomList, signal: opts?.signal }),
    addRoom: (input, opts) => call({ method: "POST", path: "/api/v1/rooms", schema: room, body: input, signal: opts?.signal }),
    changeRoom: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/rooms/${encodeURIComponent(id)}`, schema: room, body: changes, signal: opts?.signal }),
    removeRoom: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/rooms/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),

    listPractitioners: (opts) => call({ method: "GET", path: "/api/v1/practitioners", schema: practitionerList, signal: opts?.signal }),
    addPractitioner: (input, opts) =>
      call({ method: "POST", path: "/api/v1/practitioners", schema: practitioner, body: input, signal: opts?.signal }),
    changePractitioner: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/practitioners/${encodeURIComponent(id)}`, schema: practitioner, body: changes, signal: opts?.signal }),
    removePractitioner: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/practitioners/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),
    getWorkingHours: (id, opts) =>
      call({ method: "GET", path: `/api/v1/practitioners/${encodeURIComponent(id)}/working-hours`, schema: workingHours, signal: opts?.signal }),
    setWorkingHours: (id, hours, opts) =>
      call({
        method: "PATCH",
        path: `/api/v1/practitioners/${encodeURIComponent(id)}/working-hours`,
        schema: workingHours,
        body: hours,
        signal: opts?.signal,
      }),

    listLeave: (range, opts) =>
      call({ method: "GET", path: "/api/v1/leave-blocks", schema: leaveList, query: dateQuery(range), signal: opts?.signal }),
    addLeave: (input, opts) => call({ method: "POST", path: "/api/v1/leave-blocks", schema: leave, body: input, signal: opts?.signal }),
    removeLeave: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/leave-blocks/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),

    listAppointments: (filter, opts) =>
      call({
        method: "GET",
        path: "/api/v1/appointments",
        schema: appointmentList,
        query: { ...dateQuery(filter), room_id: filter.roomId, practitioner_id: filter.practitionerId },
        signal: opts?.signal,
      }),
    bookAppointment: (input, opts) =>
      call({ method: "POST", path: "/api/v1/appointments", schema: savedAppointment, body: input, signal: opts?.signal }),
    changeAppointment: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/appointments/${encodeURIComponent(id)}`, schema: savedAppointment, body: changes, signal: opts?.signal }),
    setAppointmentStatus: (id, change, opts) =>
      call({ method: "POST", path: `/api/v1/appointments/${encodeURIComponent(id)}/status`, schema: statusChanged, body: change, signal: opts?.signal }),

    listQueue: (dateValue, opts) =>
      call({ method: "GET", path: "/api/v1/queue", schema: queueDay, query: { date: dateValue }, signal: opts?.signal }),
    addWalkIn: (input, opts) => call({ method: "POST", path: "/api/v1/queue", schema: queueToken, body: input, signal: opts?.signal }),
    setQueueStatus: (id, change, opts) =>
      call({ method: "POST", path: `/api/v1/queue/${encodeURIComponent(id)}/status`, schema: queueToken, body: change, signal: opts?.signal }),

    importPatients: (input, opts) =>
      call({ method: "POST", path: "/api/v1/imports/patients", schema: importResult, body: input, signal: opts?.signal }),

    listStaff: (opts) => call({ method: "GET", path: "/api/v1/staff", schema: staffResponse, signal: opts?.signal }),
    inviteStaff: (input, opts) =>
      call({ method: "POST", path: "/api/v1/staff/invitations", schema: createdInvitation, body: input, signal: opts?.signal }),
    changeStaffMember: (membershipId, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/staff/${encodeURIComponent(membershipId)}`, schema: member, body: changes, signal: opts?.signal }),
    listRoles: (opts) => call({ method: "GET", path: "/api/v1/roles", schema: rolesResponse, signal: opts?.signal }),

    getClinicSettings: (opts) => call({ method: "GET", path: "/api/v1/settings/clinic", schema: clinicSettings, signal: opts?.signal }),
    updateClinicSettings: (changes, opts) =>
      call({ method: "PATCH", path: "/api/v1/settings/clinic", schema: clinicSettings, body: changes, signal: opts?.signal }),

    listMySessions: (opts) => call({ method: "GET", path: "/api/v1/me/sessions", schema: mySessionsResponse, signal: opts?.signal }),
    revokeMySession: (id, opts) =>
      call({ method: "POST", path: `/api/v1/me/sessions/${encodeURIComponent(id)}/revoke`, schema: voidResponse, signal: opts?.signal }),

    listClinics: (opts) =>
      call({ method: "GET", path: "/api/v1/console/clinics", schema: consoleClinics, signal: opts?.signal }),
    createClinic: (input, opts) =>
      call({ method: "POST", path: "/api/v1/console/clinics", schema: createdClinic, body: input, signal: opts?.signal }),
    getMetrics: (range, opts) =>
      call({ method: "GET", path: "/api/v1/console/metrics", schema: metricsResponse, query: { range }, signal: opts?.signal }),
    getQualityReport: (opts) =>
      call({ method: "GET", path: "/api/v1/console/quality", schema: qualityReport, signal: opts?.signal }),
  };
}

function dateQuery(range: DateRange): Query {
  return { from: range.from, to: range.to };
}

function toSearch(query: Query | undefined): string {
  if (query === undefined) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function readRequestId(response: Response): RequestId | undefined {
  const parsed = requestId.safeParse(response.headers.get("x-request-id"));
  return parsed.success ? parsed.data : undefined;
}

/** The body as JSON, or `undefined` when it is empty or not JSON (a proxy's HTML error page). */
async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text === "") {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function isAbortError(thrown: unknown): boolean {
  return thrown instanceof Error && thrown.name === "AbortError";
}

/**
 * Development sign-in against a local API: trades a person's `auth_uid` (and, for someone new,
 * their email) for an access token at `POST /api/v1/dev/token`, cached until a minute before
 * it expires.
 */
export function createDevTokenSource(
  baseUrl: string,
  options: HttpClientOptions = {},
): (person: { id: string; email?: string | undefined }) => Promise<string | null> {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const cache = new Map<string, { token: string; until: number }>();
  return async ({ id: authUid, email }) => {
    const cached = cache.get(authUid);
    if (cached !== undefined && cached.until > Date.now()) {
      return cached.token;
    }
    try {
      const response = await send(`${baseUrl.replace(/\/+$/, "")}/api/v1/dev/token`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        // A verified email in the token lets a new person accept an invitation.
        body: JSON.stringify(email === undefined ? { auth_uid: authUid } : { auth_uid: authUid, email }),
        cache: "no-store",
      });
      const decoded = devTokenResponse.safeParse(response.ok ? await readJson(response) : undefined);
      if (!decoded.success) {
        return null;
      }
      cache.set(authUid, { token: decoded.data.access_token, until: Date.now() + (decoded.data.expires_in - 60) * 1000 });
      return decoded.data.access_token;
    } catch {
      return null;
    }
  };
}
