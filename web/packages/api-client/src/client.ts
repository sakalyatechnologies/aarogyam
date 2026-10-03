/** The one interface both the HTTP client and the fake client implement. */

import type { ApiResult } from "./result.js";
import type {
  ClinicId,
  ConsoleClinicDetail,
  ConsoleClinicPage,
  Me,
  Metrics,
  MetricsEnvironment,
  MetricsRange,
  NewClinic,
  NewPatient,
  Patient,
  PatientId,
  PatientNumber,
  PatientPage,
  QualityReport,
  Session,
  Today,
} from "./schemas.js";

export interface RequestOptions {
  /** Cancels the request, for example when a search term changes. */
  signal?: AbortSignal | undefined;
}

export interface MetricsQuery {
  range: MetricsRange;
  environment?: MetricsEnvironment | undefined;
}

export interface PatientQuery {
  /** Name, number or phone. */
  q?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/** A patient reference for URLs and lookups: the clinic number (`SC-1042`) or the ID. */
export type PatientRef = PatientId | PatientNumber;

/**
 * Calls to the Aarogyam API. A client is bound to one host, and the API resolves the clinic from
 * that host name: use a neutral-host client for `getMe`, a clinic-host client for clinic calls,
 * and a console-host client for console calls.
 */
export interface ApiClient {
  /** Neutral host: the signed-in user and their clinics. */
  getMe(options?: RequestOptions): Promise<ApiResult<Me>>;

  /** Clinic host: the clinic, its theme, and the caller's role and permissions. */
  getSession(options?: RequestOptions): Promise<ApiResult<Session>>;
  /** Clinic host: needs `patients.read`. */
  listPatients(query: PatientQuery, options?: RequestOptions): Promise<ApiResult<PatientPage>>;
  /** Clinic host: needs `patients.read`. */
  getPatient(ref: PatientRef, options?: RequestOptions): Promise<ApiResult<Patient>>;
  /** Clinic host: needs `patients.write`. */
  createPatient(input: NewPatient, options?: RequestOptions): Promise<ApiResult<Patient>>;
  /** Clinic host (draft, fake only): needs `appointments.read`. */
  getToday(options?: RequestOptions): Promise<ApiResult<Today>>;

  /** Console host. */
  listClinics(options?: RequestOptions): Promise<ApiResult<ConsoleClinicPage>>;
  /** Console host (draft, fake only). */
  getClinic(id: ClinicId, options?: RequestOptions): Promise<ApiResult<ConsoleClinicDetail>>;
  /** Console host. */
  createClinic(input: NewClinic, options?: RequestOptions): Promise<ApiResult<ConsoleClinicDetail>>;
  /** Console host (draft, fake only): service health for a time range. */
  getMetrics(query: MetricsQuery, options?: RequestOptions): Promise<ApiResult<Metrics>>;
  /** Console host (draft, fake only). */
  getQualityReport(options?: RequestOptions): Promise<ApiResult<QualityReport>>;
}
