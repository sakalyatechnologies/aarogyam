/**
 * Runtime decoders for every response, so data entering the apps is validated once at the
 * boundary and carries typed identifiers from then on.
 *
 * Each schema `satisfies` its contract type in `contract.ts`: when generated types replace that
 * file, any disagreement between these decoders and the real API fails the type check.
 */

import { z } from "zod";

import type * as C from "./contract.js";

// Identifiers and values ---------------------------------------------------------------------

export const userId = z.string().min(1).brand<"UserId">();
export type UserId = z.output<typeof userId>;

export const clinicId = z.string().min(1).brand<"ClinicId">();
export type ClinicId = z.output<typeof clinicId>;

export const membershipId = z.string().min(1).brand<"MembershipId">();
export type MembershipId = z.output<typeof membershipId>;

export const patientId = z.string().min(1).brand<"PatientId">();
export type PatientId = z.output<typeof patientId>;

/** The clinic's readable patient number, such as `SC-1042`: safe for URLs, said aloud by staff. */
export const patientNumber = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{0,7}-\d{1,9}$/)
  .brand<"PatientNumber">();
export type PatientNumber = z.output<typeof patientNumber>;

export const appointmentId = z.string().min(1).brand<"AppointmentId">();
export type AppointmentId = z.output<typeof appointmentId>;

export const practitionerId = z.string().min(1).brand<"PractitionerId">();
export type PractitionerId = z.output<typeof practitionerId>;

export const qualityRunId = z.string().min(1).brand<"QualityRunId">();
export type QualityRunId = z.output<typeof qualityRunId>;

/** An amount of money in paise (1 rupee = 100 paise). */
export const paise = z.number().int().brand<"Paise">();
export type Paise = z.output<typeof paise>;

/** A server request ID from the `x-request-id` header. */
export const requestId = z.string().min(1).brand<"RequestId">();
export type RequestId = z.output<typeof requestId>;

const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const optionalText = z.string().nullable().exactOptional();
const optionalTimestamp = timestamp.nullable().exactOptional();
const count = z.number().int().nonnegative();

export const sex = z.enum(["female", "male", "other", "unknown"]) satisfies z.ZodType<C.Sex>;
export type Sex = z.output<typeof sex>;

export const themeMode = z.enum(["light", "dark"]) satisfies z.ZodType<C.ThemeMode>;
export type ThemeMode = z.output<typeof themeMode>;

// Errors -------------------------------------------------------------------------------------

export const errorBody = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    field: optionalText,
  }),
}) satisfies z.ZodType<C.ErrorBody>;

// Neutral host -------------------------------------------------------------------------------

const user = z.object({
  id: userId,
  display_name: z.string(),
  email: optionalText,
  phone_masked: optionalText,
}) satisfies z.ZodType<C.User>;
export type User = z.output<typeof user>;

const clinicAccess = z.object({
  org_id: clinicId,
  slug: z.string().min(1),
  name: z.string(),
  role_key: z.string(),
  role_name: z.string(),
  host: z.string().min(1),
}) satisfies z.ZodType<C.ClinicAccess>;
export type ClinicAccess = z.output<typeof clinicAccess>;

export const meResponse = z.object({
  user,
  clinics: z.array(clinicAccess),
}) satisfies z.ZodType<C.MeResponse>;
export type Me = z.output<typeof meResponse>;

// Clinic host --------------------------------------------------------------------------------

export const sessionResponse = z.object({
  clinic: z.object({
    id: clinicId,
    slug: z.string().min(1),
    name: z.string(),
    timezone: z.string().min(1),
    theme: z.object({ brand: z.string(), mode: themeMode }),
  }),
  membership: z.object({
    id: membershipId,
    role_key: z.string(),
    role_name: z.string(),
    permissions: z.array(z.string()),
  }),
  user,
}) satisfies z.ZodType<C.SessionResponse>;
export type Session = z.output<typeof sessionResponse>;

const patientListItem = z.object({
  id: patientId,
  number: patientNumber,
  full_name: z.string(),
  sex,
  age_years: count.nullable().exactOptional(),
  phone_masked: optionalText,
  last_visit_at: optionalTimestamp,
}) satisfies z.ZodType<C.PatientListItem>;
export type PatientListItem = z.output<typeof patientListItem>;

export const patientListResponse = z.object({
  items: z.array(patientListItem),
  next_cursor: optionalText,
}) satisfies z.ZodType<C.PatientListResponse>;
export type PatientPage = z.output<typeof patientListResponse>;

export const patient = z.object({
  id: patientId,
  number: patientNumber,
  full_name: z.string(),
  sex,
  date_of_birth: date.nullable().exactOptional(),
  birth_date_estimated: z.boolean(),
  phone: optionalText,
  email: optionalText,
  preferred_language: z.string(),
  status: z.enum(["active", "inactive", "deceased", "merged"]),
  created_at: timestamp,
  last_visit_at: optionalTimestamp,
}) satisfies z.ZodType<C.Patient>;
export type Patient = z.output<typeof patient>;
export type PatientStatus = Patient["status"];

const appointmentStatus = z.enum([
  "scheduled",
  "confirmed",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]) satisfies z.ZodType<C.AppointmentStatus>;
export type AppointmentStatus = z.output<typeof appointmentStatus>;

const attentionKind = z.enum(["follow_up", "treatment_plan", "dues", "stock", "lab"]) satisfies z.ZodType<
  C.AttentionKind
>;
export type AttentionKind = z.output<typeof attentionKind>;

const todayAppointment = z.object({
  id: appointmentId,
  starts_at: timestamp,
  ends_at: timestamp,
  status: appointmentStatus,
  kind: z.enum(["new", "follow_up", "procedure", "teleconsult"]),
  reason: optionalText,
  room: optionalText,
  arrived_at: optionalTimestamp,
  patient: z.object({
    id: patientId,
    number: patientNumber,
    full_name: z.string(),
    sex,
    age_years: count.nullable().exactOptional(),
  }),
  practitioner: z.object({ id: practitionerId, display_name: z.string() }),
}) satisfies z.ZodType<C.TodayAppointment>;
export type TodayAppointment = z.output<typeof todayAppointment>;

export const todayResponse = z.object({
  date,
  as_of: timestamp,
  appointments: z.array(todayAppointment),
  money: z
    .object({ collected_paise: paise, pending_dues_paise: paise, pending_dues_patients: count })
    .nullable()
    .exactOptional(),
  attention: z.array(
    z.object({ kind: attentionKind, count, amount_paise: paise.nullable().exactOptional() }),
  ),
}) satisfies z.ZodType<C.TodayResponse>;
export type Today = z.output<typeof todayResponse>;

// Console host -------------------------------------------------------------------------------

export const specialty = z.enum(["dental"]) satisfies z.ZodType<C.Specialty>;
export type Specialty = z.output<typeof specialty>;

export const clinicStatus = z.enum(["trial", "active", "suspended", "churned"]) satisfies z.ZodType<
  C.ClinicStatus
>;
export type ClinicStatus = z.output<typeof clinicStatus>;

const consoleClinicFields = {
  id: clinicId,
  slug: z.string().min(1),
  name: z.string(),
  specialty,
  status: clinicStatus,
  created_at: timestamp,
};

const consoleClinic = z.object(consoleClinicFields) satisfies z.ZodType<C.ConsoleClinic>;
export type ConsoleClinic = z.output<typeof consoleClinic>;

export const consoleClinicListResponse = z.object({
  items: z.array(consoleClinic),
  next_cursor: optionalText,
}) satisfies z.ZodType<C.ConsoleClinicListResponse>;
export type ConsoleClinicPage = z.output<typeof consoleClinicListResponse>;

export const consoleClinicDetail = z.object({
  ...consoleClinicFields,
  timezone: z.string().min(1),
  domains: z.array(
    z.object({
      hostname: z.string().min(1),
      kind: z.enum(["portal", "website"]),
      is_primary: z.boolean(),
      verified_at: optionalTimestamp,
    }),
  ),
  owner: z.object({ display_name: z.string(), email: optionalText, phone_masked: optionalText }),
  plan: z.object({ key: z.string(), name: z.string() }).nullable().exactOptional(),
}) satisfies z.ZodType<C.ConsoleClinicDetail>;
export type ConsoleClinicDetail = z.output<typeof consoleClinicDetail>;
export type ClinicDomain = ConsoleClinicDetail["domains"][number];

export const testSuite = z.enum(["unit", "integration", "e2e_web", "e2e_mobile", "canary", "load"]) satisfies z.ZodType<
  C.TestSuite
>;
export type TestSuite = z.output<typeof testSuite>;

export const qualityEnvironment = z.enum(["ci", "staging", "production"]) satisfies z.ZodType<
  C.QualityEnvironment
>;
export type QualityEnvironment = z.output<typeof qualityEnvironment>;

const runStatus = z.enum(["running", "passed", "failed", "cancelled"]) satisfies z.ZodType<C.RunStatus>;
export type RunStatus = z.output<typeof runStatus>;

const qualityRun = z.object({
  id: qualityRunId,
  status: runStatus,
  started_at: timestamp,
  finished_at: optionalTimestamp,
  total: count,
  passed: count,
  failed: count,
  skipped: count,
  flaky: count,
  commit_sha: optionalText,
  run_url: optionalText,
}) satisfies z.ZodType<C.QualityRun>;
export type QualityRun = z.output<typeof qualityRun>;

export const qualityReport = z.object({
  generated_at: timestamp,
  suites: z.array(
    z.object({
      suite: testSuite,
      environment: qualityEnvironment,
      last_run: qualityRun.nullable().exactOptional(),
      trend: z.array(z.object({ day: date, total: count, passed: count })),
    }),
  ),
  flaky_tests: z.array(
    z.object({
      test_name: z.string(),
      suite: testSuite,
      environment: qualityEnvironment,
      flaky_runs: count,
      total_runs: count,
      last_seen_at: timestamp,
    }),
  ),
  failing_requests: z.array(
    z.object({
      request_id: requestId,
      suite: testSuite,
      environment: qualityEnvironment,
      test_name: z.string(),
      failed_at: timestamp,
      error_message: optionalText,
    }),
  ),
}) satisfies z.ZodType<C.QualityReport>;
export type QualityReport = z.output<typeof qualityReport>;
export type QualitySuiteStatus = QualityReport["suites"][number];
export type FlakyTest = QualityReport["flaky_tests"][number];
export type FailingRequest = QualityReport["failing_requests"][number];

export const metricsRange = z.enum(["1h", "24h", "7d"]) satisfies z.ZodType<C.MetricsRange>;
export type MetricsRange = z.output<typeof metricsRange>;

export const metricsEnvironment = z.enum(["staging", "production"]) satisfies z.ZodType<C.MetricsEnvironment>;
export type MetricsEnvironment = z.output<typeof metricsEnvironment>;

const ratio = z.number().min(0).max(1);
const millis = z.number().nonnegative();

export const metricsResponse = z.object({
  generated_at: timestamp,
  range: metricsRange,
  api: z.object({
    requests: count,
    success_rate: ratio,
    rate_4xx: ratio,
    rate_5xx: ratio,
    p50_ms: millis,
    p95_ms: millis,
    p99_ms: millis,
    series: z.array(z.object({ at: timestamp, requests: count, errors: count, p95_ms: millis })),
    routes: z.array(
      z.object({
        method: z.string(),
        route: z.string(),
        requests: count,
        error_rate: ratio,
        p95_ms: millis,
        p99_ms: millis,
      }),
    ),
  }),
  db: z.object({
    connections_used: count,
    connections_max: count,
    cache_hit_ratio: ratio,
    size_bytes: count,
    slow_queries: z.array(z.object({ query_id: z.string(), calls: count, mean_ms: millis, total_ms: millis })),
    tables: z.array(z.object({ name: z.string(), live_rows: count, dead_rows: count, size_bytes: count })),
  }),
  edge: z
    .object({
      requests: count,
      rate_4xx: ratio,
      rate_5xx: ratio,
      cpu_p95_ms: millis,
      page_views: count,
      lcp_p75_ms: millis,
      inp_p75_ms: millis,
      cls_p75: z.number().nonnegative(),
    })
    .nullable(),
}) satisfies z.ZodType<C.MetricsResponse>;
export type Metrics = z.output<typeof metricsResponse>;
export type ApiMetrics = Metrics["api"];
export type RouteMetrics = ApiMetrics["routes"][number];
export type DatabaseMetrics = Metrics["db"];
export type SlowQuery = DatabaseMetrics["slow_queries"][number];
export type TableHealth = DatabaseMetrics["tables"][number];
export type EdgeMetrics = NonNullable<Metrics["edge"]>;

/** `POST /api/v1/dev/token` (development only). */
export const devTokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
}) satisfies z.ZodType<C.DevTokenResponse>;
export type DevToken = z.output<typeof devTokenResponse>;

// Requests -----------------------------------------------------------------------------------

/** Body of `POST /api/v1/patients`. */
export type NewPatient = C.CreatePatientRequest;

/** Body of `POST /api/v1/console/clinics`. */
export type NewClinic = C.CreateClinicRequest;
