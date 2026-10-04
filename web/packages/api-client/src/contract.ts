/**
 * The draft Aarogyam API contract, as JSON on the wire (snake_case).
 *
 * Hand-written from the agreed draft. When the API publishes `docs/api/openapi.json`, replace
 * the body of this file with aliases to the generated types, for example
 * `export type Patient = components["schemas"]["Patient"]`. `schemas.ts` is type-checked against
 * every type here, so the compiler then lists each place the real contract differs.
 *
 * Optional fields are written `field?: T | null`, which is how generators render a Rust
 * `Option<T>`: the field may be missing or `null`.
 *
 * Marked "draft, fake only": shapes the API has not agreed yet; only the fake client serves them.
 */

/** Every error response: `{"error":{"code","message","field"?}}`, plus an `x-request-id` header. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    field?: string | null;
  };
}

export type Sex = "female" | "male" | "other" | "unknown";

export type ThemeMode = "light" | "dark";

export type PatientStatus = "active" | "inactive" | "deceased" | "merged";

// Neutral host -------------------------------------------------------------------------------

export interface User {
  id: string;
  display_name: string;
  email?: string | null;
  phone_masked?: string | null;
}

/** A clinic the signed-in user belongs to, and the host its portal and API live on. */
export interface ClinicAccess {
  org_id: string;
  slug: string;
  name: string;
  role_key: string;
  role_name: string;
  host: string;
}

/** `GET /api/v1/me` */
export interface MeResponse {
  user: User;
  clinics: ClinicAccess[];
}

// Clinic host --------------------------------------------------------------------------------

export interface ClinicTheme {
  /** Brand colour as `#rrggbb`. */
  brand: string;
  mode: ThemeMode;
}

export interface SessionClinic {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  theme: ClinicTheme;
}

export interface Membership {
  id: string;
  role_key: string;
  role_name: string;
  permissions: string[];
}

/** `GET /api/v1/session` */
export interface SessionResponse {
  clinic: SessionClinic;
  membership: Membership;
  user: User;
}

export interface PatientListItem {
  id: string;
  number: string;
  full_name: string;
  sex: Sex;
  age_years?: number | null;
  phone_masked?: string | null;
  last_visit_at?: string | null;
}

/** `GET /api/v1/patients?q=&limit=&cursor=` */
export interface PatientListResponse {
  items: PatientListItem[];
  next_cursor?: string | null;
}

/** `POST /api/v1/patients` */
export interface CreatePatientRequest {
  full_name: string;
  sex: Sex;
  date_of_birth?: string;
  age_years?: number;
  /** E.164, for example `+919876543210`. */
  phone?: string;
  email?: string;
  preferred_language?: string;
}

/** `GET /api/v1/patients/{id}`, and the `201` body of `POST /api/v1/patients`. */
export interface Patient {
  id: string;
  number: string;
  full_name: string;
  sex: Sex;
  date_of_birth?: string | null;
  birth_date_estimated: boolean;
  phone?: string | null;
  email?: string | null;
  preferred_language: string;
  status: PatientStatus;
  created_at: string;
  last_visit_at?: string | null;
}

// Clinic host, draft, fake only ---------------------------------------------------------------

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

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
  patient: {
    id: string;
    number: string;
    full_name: string;
    sex: Sex;
    age_years?: number | null;
  };
  practitioner: {
    id: string;
    display_name: string;
  };
}

/** Present only for members with `finance.view`. Amounts are in paise. */
export interface TodayMoney {
  collected_paise: number;
  pending_dues_paise: number;
  pending_dues_patients: number;
}

export type AttentionKind = "follow_up" | "treatment_plan" | "dues" | "stock" | "lab";

export interface TodayAttention {
  kind: AttentionKind;
  count: number;
  amount_paise?: number | null;
}

/** `GET /api/v1/today` (draft, fake only) */
export interface TodayResponse {
  /** The clinic's local date, `YYYY-MM-DD`. */
  date: string;
  /** When the server built this view; waiting times are measured from here. */
  as_of: string;
  appointments: TodayAppointment[];
  money?: TodayMoney | null;
  attention: TodayAttention[];
}

// Console host -------------------------------------------------------------------------------

export type Specialty = "dental";

export type ClinicStatus = "trial" | "active" | "suspended" | "churned";

export interface ConsoleClinic {
  id: string;
  slug: string;
  name: string;
  specialty: Specialty;
  status: ClinicStatus;
  created_at: string;
}

/** `GET /api/v1/console/clinics` */
export interface ConsoleClinicListResponse {
  items: ConsoleClinic[];
  next_cursor?: string | null;
}

export interface ClinicDomain {
  hostname: string;
  kind: "portal" | "website";
  is_primary: boolean;
  verified_at?: string | null;
}

/** `GET /api/v1/console/clinics/{id}` (draft, fake only) and the `201` body of the create call. */
export interface ConsoleClinicDetail extends ConsoleClinic {
  timezone: string;
  domains: ClinicDomain[];
  owner: {
    display_name: string;
    email?: string | null;
    phone_masked?: string | null;
  };
  plan?: {
    key: string;
    name: string;
  } | null;
}

/** `POST /api/v1/console/clinics` */
export interface CreateClinicRequest {
  name: string;
  slug: string;
  specialty: Specialty;
  owner: {
    display_name: string;
    email?: string;
    /** E.164. */
    phone?: string;
  };
  timezone?: string;
}

// Console host, draft, fake only -------------------------------------------------------------

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

export interface QualityDay {
  /** `YYYY-MM-DD` */
  day: string;
  total: number;
  passed: number;
}

/** The latest run and the daily trend of one suite in one environment. */
export interface QualitySuiteStatus {
  suite: TestSuite;
  environment: QualityEnvironment;
  last_run?: QualityRun | null;
  trend: QualityDay[];
}

export interface FlakyTest {
  test_name: string;
  suite: TestSuite;
  environment: QualityEnvironment;
  flaky_runs: number;
  total_runs: number;
  last_seen_at: string;
}

/** A failed test or canary step that carries the API request ID, to open with `sk request`. */
export interface FailingRequest {
  request_id: string;
  suite: TestSuite;
  environment: QualityEnvironment;
  test_name: string;
  failed_at: string;
  /** Trimmed, never patient data. */
  error_message?: string | null;
}

/** `GET /api/v1/console/quality` (draft, fake only) */
export interface QualityReport {
  generated_at: string;
  suites: QualitySuiteStatus[];
  flaky_tests: FlakyTest[];
  failing_requests: FailingRequest[];
}

export type MetricsRange = "1h" | "24h" | "7d";

/** Sent as `environment=`; an assumption on top of the draft, which only listed `range`. */
export type MetricsEnvironment = "staging" | "production";

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
  /** Requests in the whole range. */
  requests: number;
  /** Rates are ratios from 0 to 1. */
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
  connections_used: number;
  connections_max: number;
  /** 0 to 1. */
  cache_hit_ratio: number;
  size_bytes: number;
  slow_queries: SlowQuery[];
  tables: TableHealth[];
}

export interface EdgeMetrics {
  requests: number;
  rate_4xx: number;
  rate_5xx: number;
  cpu_p95_ms: number;
  page_views: number;
  lcp_p75_ms: number;
  inp_p75_ms: number;
  cls_p75: number;
}

/** `GET /api/v1/console/metrics?range=1h|24h|7d` (draft, fake only) */
export interface MetricsResponse {
  generated_at: string;
  range: MetricsRange;
  api: ApiMetrics;
  db: DatabaseMetrics;
  /** `null` until edge analytics are connected. */
  edge: EdgeMetrics | null;
}

/** `POST /api/v1/dev/token` with `{ "auth_uid" }` (development builds of the API only). */
export interface DevTokenResponse {
  access_token: string;
  /** Seconds. */
  expires_in: number;
}
