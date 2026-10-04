/** The one interface both the HTTP client and the fake client implement. */

import type { ApiResult } from "./result.js";
import type {
  AcceptInvitation,
  ClinicSettings,
  ClinicSettingsChanges,
  ConsoleClinicPage,
  CreatedClinic,
  CreatedInvitation,
  Me,
  Member,
  MemberChanges,
  MembershipId,
  Metrics,
  MetricsRange,
  MySessions,
  NewClinic,
  NewInvitation,
  NewPatient,
  Patient,
  PatientChanges,
  PatientId,
  PatientPage,
  QualityReport,
  Roles,
  Session,
  SessionId,
  Staff,
  Joined,
  Today,
} from "./schemas.js";

export interface RequestOptions {
  /** Cancels the request, for example when a search term changes. */
  signal?: AbortSignal | undefined;
}

export interface PatientSearch {
  /** Name, clinic number or phone. Sent in the request body, never in a URL. */
  q: string;
  limit?: number | undefined;
}

/**
 * Calls to the Aarogyam API. A client is bound to one host, and the API resolves the clinic from
 * that host name: `getMe` works on any host, clinic calls need a clinic host, console calls the
 * console host.
 */
export interface ApiClient {
  /** The signed-in user's clinics and the host of each. */
  getMe(options?: RequestOptions): Promise<ApiResult<Me>>;
  /** Any host: joins the clinic an invitation is for. 404 when unknown, used or expired; 409 when the email differs. */
  acceptInvitation(input: AcceptInvitation, options?: RequestOptions): Promise<ApiResult<Joined>>;

  /** Clinic host: the clinic, its branding, and the caller's role and permissions. */
  getSession(options?: RequestOptions): Promise<ApiResult<Session>>;
  /** Clinic host: recently seen patients. Needs `patients.read`. */
  listPatients(options?: RequestOptions): Promise<ApiResult<PatientPage>>;
  /** Clinic host: `POST /patients/search`. Needs `patients.read`. */
  searchPatients(search: PatientSearch, options?: RequestOptions): Promise<ApiResult<PatientPage>>;
  /** Clinic host: needs `patients.read`; contact details are masked without `patients.contact`. */
  getPatient(id: PatientId, options?: RequestOptions): Promise<ApiResult<Patient>>;
  /** Clinic host: needs `patients.write`. */
  createPatient(input: NewPatient, options?: RequestOptions): Promise<ApiResult<Patient>>;
  /** Clinic host (draft, fake only): needs `appointments.read`. */
  getToday(options?: RequestOptions): Promise<ApiResult<Today>>;
  /** Clinic host: edits a patient's details. Needs `patients.write`, and `patients.contact` to change phone or email. */
  updatePatient(id: PatientId, changes: PatientChanges, options?: RequestOptions): Promise<ApiResult<Patient>>;

  /** Clinic host: members, their roles and status, and pending invitations. Needs `staff.manage`. */
  listStaff(options?: RequestOptions): Promise<ApiResult<Staff>>;
  /** Clinic host: invites someone by email. Needs `staff.manage`; only an owner may invite an owner. */
  inviteStaff(input: NewInvitation, options?: RequestOptions): Promise<ApiResult<CreatedInvitation>>;
  /** Clinic host: changes a member's role or status. Needs `staff.manage`. */
  changeStaffMember(membershipId: MembershipId, changes: MemberChanges, options?: RequestOptions): Promise<ApiResult<Member>>;
  /** Clinic host: the clinic's roles and what each may do, for choosing a role. Needs `staff.manage`. */
  listRoles(options?: RequestOptions): Promise<ApiResult<Roles>>;

  /** Clinic host: the clinic's profile, GSTIN, address, phone, UPI ID and branding. Needs `settings.manage`. */
  getClinicSettings(options?: RequestOptions): Promise<ApiResult<ClinicSettings>>;
  /** Clinic host: changes the clinic's settings. Needs `settings.manage`. */
  updateClinicSettings(changes: ClinicSettingsChanges, options?: RequestOptions): Promise<ApiResult<ClinicSettings>>;

  /** Any host: where the signed-in person is signed in. */
  listMySessions(options?: RequestOptions): Promise<ApiResult<MySessions>>;
  /** Any host: signs one of the person's own sessions out. */
  revokeMySession(id: SessionId, options?: RequestOptions): Promise<ApiResult<void>>;

  /** Console host. */
  listClinics(options?: RequestOptions): Promise<ApiResult<ConsoleClinicPage>>;
  /** Console host: creates the clinic and the owner's invitation. */
  createClinic(input: NewClinic, options?: RequestOptions): Promise<ApiResult<CreatedClinic>>;
  /** Console host: service health for a time range. */
  getMetrics(range: MetricsRange, options?: RequestOptions): Promise<ApiResult<Metrics>>;
  /** Console host (draft, fake only). */
  getQualityReport(options?: RequestOptions): Promise<ApiResult<QualityReport>>;
}
