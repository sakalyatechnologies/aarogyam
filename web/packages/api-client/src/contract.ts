/**
 * The API contract, as JSON on the wire.
 *
 * Generated from `docs/api/openapi.json` into `generated/openapi.ts` (`pnpm --filter
 * @aarogyam/api-client generate`). Only three kinds of type are written by hand here:
 * 1. Refinements where the spec leaves an object untyped (metrics `api`, `db` and `edge`).
 * 2. The error body, which the spec does not describe.
 * 3. Drafts the API has not built yet, served only by the fake client (Today, Quality).
 * `schemas.ts` is type-checked against every type here.
 */

import type { components } from "./generated/openapi.js";

type Schemas = components["schemas"];

// From the spec -------------------------------------------------------------------------------

export type Me = Schemas["Me"];
export type MyClinic = Schemas["MyClinic"];
export type SessionMembership = Schemas["SessionMembership"];
export type SessionUser = Schemas["SessionUser"];
export type Patient = Schemas["Patient"];
export type PatientList = Schemas["PatientList"];
export type NewPatient = Schemas["NewPatient"];
export type SearchRequest = Schemas["SearchRequest"];
export type ConsoleClinic = Schemas["ConsoleClinic"];
export type ConsoleClinics = Schemas["ConsoleClinics"];
export type NewClinic = Schemas["NewClinic"];
export type CreatedClinic = Schemas["CreatedClinic"];
export type DevTokenRequest = Schemas["DevTokenRequest"];
export type AcceptInvitation = Schemas["AcceptInvitation"];
export type Joined = Schemas["Joined"];
export type DevTokenResponse = Schemas["DevTokenResponse"];
export type PatientChanges = Schemas["PatientChanges"];

export type Member = Schemas["Member"];
export type MemberBranch = Schemas["MemberBranch"];
export type MemberChanges = Schemas["MemberChanges"];
export type PendingInvitation = Schemas["PendingInvitation"];
export type Staff = Schemas["Staff"];
export type NewInvitation = Schemas["NewInvitation"];
export type CreatedInvitation = Schemas["CreatedInvitation"];
export type RolePermission = Schemas["RolePermission"];
export type Role = Schemas["Role"];
export type Roles = Schemas["Roles"];

export type Address = Schemas["Address"];
export type Branding = Schemas["Branding"];
export type ClinicSettings = Schemas["ClinicSettings"];
export type ClinicSettingsChanges = Schemas["ClinicSettingsChanges"];

export type MySession = Schemas["MySession"];
export type MySessions = Schemas["MySessions"];

// Refinements of untyped parts of the spec ----------------------------------------------------

export type Session = Schemas["Session"];
export type SessionClinic = Schemas["SessionClinic"];

export type MetricsRange = "1h" | "24h" | "7d";

export interface ApiMetricsPoint {
  at: string;
  requests: number;
  errors: number;
  p95_ms: number;
}

/** Traffic for one route template, such as `GET /api/v1/patients/{id}`. Never a raw URL. */
export interface RouteMetrics {
  method: string;
  route: string;
  requests: number;
  /** 0 to 1. */
  error_rate: number;
  p95_ms: number;
  p99_ms: number;
}

export interface ApiMetrics {
  [key: string]: unknown;
  /** Requests in the whole range. Rates are ratios from 0 to 1. */
  requests: number;
  success_rate: number;
  rate_4xx: number;
  rate_5xx: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  series: ApiMetricsPoint[];
  routes: RouteMetrics[];
}

/** One `pg_stat_statements` entry, by query ID only: query text can hold literal values. */
export interface SlowQuery {
  query_id: string;
  calls: number;
  mean_ms: number;
  total_ms: number;
}

export interface TableHealth {
  name: string;
  live_rows: number;
  dead_rows: number;
  size_bytes: number;
}

export interface DatabaseMetrics {
  [key: string]: unknown;
  connections_used: number;
  connections_max: number;
  /** 0 to 1. */
  cache_hit_ratio: number;
  size_bytes: number;
  slow_queries: SlowQuery[];
  tables: TableHealth[];
}

export interface EdgeMetrics {
  [key: string]: unknown;
  requests: number;
  rate_4xx: number;
  rate_5xx: number;
  cpu_p95_ms: number;
  page_views: number;
  lcp_p75_ms: number;
  inp_p75_ms: number;
  cls_p75: number;
}

/** `GET /api/v1/console/metrics`. The spec says `edge` is an object; the API sends `null` until it is connected. */
export type ServiceMetrics = Omit<Schemas["ServiceMetrics"], "api" | "db" | "edge"> & {
  api: ApiMetrics;
  db: DatabaseMetrics;
  edge: EdgeMetrics | null;
};

// Not in the spec -----------------------------------------------------------------------------

/** Every error response: `{"error":{"code","message"}}` plus an `x-request-id` header. Input errors start the message with the field: `phone: invalid phone number`. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    field?: string | null;
  };
}

// Drafts, fake only ---------------------------------------------------------------------------

export type Sex = "female" | "male" | "other" | "unknown";

export type AppointmentStatus = "scheduled" | "confirmed" | "arrived" | "in_progress" | "completed" | "cancelled" | "no_show";

export type AppointmentKind = "new" | "follow_up" | "procedure" | "teleconsult";

export interface TodayAppointment {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  kind: AppointmentKind;
  reason?: string | null;
  room?: string | null;
  arrived_at?: string | null;
  patient: { id: string; number: string; full_name: string; sex: Sex; age_years?: number | null };
  practitioner: { id: string; display_name: string };
}

/** Present only for members with `finance.view`. Amounts are in paise. */
export interface TodayMoney {
  collected_paise: number;
  pending_dues_paise: number;
  pending_dues_patients: number;
}

/** `GET /api/v1/today` (draft, fake only). */
export interface TodayResponse {
  /** The clinic's local date, `YYYY-MM-DD`. */
  date: string;
  /** When the server built this view; waiting times are measured from here. */
  as_of: string;
  appointments: TodayAppointment[];
  money?: TodayMoney | null;
}

export type TestSuite = "unit" | "integration" | "e2e_web" | "e2e_mobile" | "canary" | "load";
export type QualityEnvironment = "ci" | "staging" | "production";
export type RunStatus = "running" | "passed" | "failed" | "cancelled";

export interface QualityRun {
  id: string;
  status: RunStatus;
  started_at: string;
  finished_at?: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  commit_sha?: string | null;
  run_url?: string | null;
}

/** `GET /api/v1/console/quality` (draft, fake only). */
export interface QualityReport {
  generated_at: string;
  suites: {
    suite: TestSuite;
    environment: QualityEnvironment;
    last_run?: QualityRun | null;
    trend: { day: string; total: number; passed: number }[];
  }[];
  flaky_tests: {
    test_name: string;
    suite: TestSuite;
    environment: QualityEnvironment;
    flaky_runs: number;
    total_runs: number;
    last_seen_at: string;
  }[];
  failing_requests: {
    request_id: string;
    suite: TestSuite;
    environment: QualityEnvironment;
    test_name: string;
    failed_at: string;
    error_message?: string | null;
  }[];
}
