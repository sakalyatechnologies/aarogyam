/** The real client: `fetch` against one API host, decoding every response at the boundary. */

import type { z } from "zod";

import type { ApiClient, PatientQuery, RequestOptions } from "./client.js";
import { failure, parseApiError, success, type ApiResult } from "./result.js";
import {
  consoleClinicDetail,
  consoleClinicListResponse,
  meResponse,
  metricsResponse,
  patient,
  patientListResponse,
  qualityReport,
  requestId,
  sessionResponse,
  todayResponse,
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
  method: "GET" | "POST";
  path: string;
  schema: z.ZodType<T>;
  query?: Query;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

/**
 * Creates a client for the API at `baseUrl`: an origin such as
 * `https://smilecatchers.aarogyam.example`, or `""` for the page's own origin.
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
    getSession: (opts) =>
      call({ method: "GET", path: "/api/v1/session", schema: sessionResponse, signal: opts?.signal }),
    listPatients: (query: PatientQuery, opts?: RequestOptions) =>
      call({
        method: "GET",
        path: "/api/v1/patients",
        schema: patientListResponse,
        query: { q: query.q?.trim(), limit: query.limit, cursor: query.cursor },
        signal: opts?.signal,
      }),
    getPatient: (ref, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(ref)}`, schema: patient, signal: opts?.signal }),
    createPatient: (input, opts) =>
      call({ method: "POST", path: "/api/v1/patients", schema: patient, body: input, signal: opts?.signal }),
    getToday: (opts) => call({ method: "GET", path: "/api/v1/today", schema: todayResponse, signal: opts?.signal }),
    listClinics: (opts) =>
      call({ method: "GET", path: "/api/v1/console/clinics", schema: consoleClinicListResponse, signal: opts?.signal }),
    getClinic: (id, opts) =>
      call({
        method: "GET",
        path: `/api/v1/console/clinics/${encodeURIComponent(id)}`,
        schema: consoleClinicDetail,
        signal: opts?.signal,
      }),
    createClinic: (input, opts) =>
      call({ method: "POST", path: "/api/v1/console/clinics", schema: consoleClinicDetail, body: input, signal: opts?.signal }),
    getMetrics: (query, opts) =>
      call({
        method: "GET",
        path: "/api/v1/console/metrics",
        schema: metricsResponse,
        query: { range: query.range, environment: query.environment },
        signal: opts?.signal,
      }),
    getQualityReport: (opts) =>
      call({ method: "GET", path: "/api/v1/console/quality", schema: qualityReport, signal: opts?.signal }),
  };
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
