/** The one interface both the HTTP client and the fake client implement. */

import type { ApiResult } from "./result.js";
import type {
  AcceptInvitation,
  AppointmentChanges,
  AppointmentId,
  AppointmentPage,
  ClinicSettings,
  ClinicSettingsChanges,
  ConsoleClinicPage,
  CreatedClinic,
  CreatedInvitation,
  ImportResult,
  Leave,
  LeaveId,
  LeavePage,
  Me,
  Member,
  MemberChanges,
  MembershipId,
  Metrics,
  MetricsRange,
  MySessions,
  NewAppointmentBody,
  NewClinic,
  NewInvitation,
  NewLeave,
  NewPatient,
  Patient,
  PatientChanges,
  PatientId,
  PatientImport,
  PatientPage,
  Practitioner,
  PractitionerFields,
  PractitionerId,
  PractitionerPage,
  QualityReport,
  QueueDayPage,
  QueueToken,
  QueueTokenId,
  Roles,
  Room,
  RoomFields,
  RoomId,
  RoomPage,
  SavedAppointment,
  Session,
  SessionId,
  Staff,
  StatusChange,
  StatusChanged,
  Joined,
  TokenStatusChange,
  Today,
  WalkInBody,
  WorkingHours,
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

export interface DateRange {
  /** First local day, `YYYY-MM-DD`. */
  from: string;
  /** Last local day, `YYYY-MM-DD`; at most 31 days counting both. */
  to: string;
}

export interface AppointmentFilter extends DateRange {
  roomId?: RoomId | undefined;
  practitionerId?: PractitionerId | undefined;
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
  /** Clinic host: today's schedule, chairs, counts, attention list and team. Needs `appointments.read`. */
  getToday(options?: RequestOptions): Promise<ApiResult<Today>>;
  /** Clinic host: edits a patient's details. Needs `patients.write`, and `patients.contact` to change phone or email. */
  updatePatient(id: PatientId, changes: PatientChanges, options?: RequestOptions): Promise<ApiResult<Patient>>;

  /** Clinic host: the clinic's chairs and rooms, in list order. Needs `appointments.read`. */
  listRooms(options?: RequestOptions): Promise<ApiResult<RoomPage>>;
  /** Clinic host: adds a chair or room. Needs `settings.manage`. */
  addRoom(input: RoomFields, options?: RequestOptions): Promise<ApiResult<Room>>;
  /** Clinic host: renames, moves, retires or reorders a chair or room. Needs `settings.manage`. */
  changeRoom(id: RoomId, changes: RoomFields, options?: RequestOptions): Promise<ApiResult<Room>>;
  /** Clinic host: removes a chair or room with no upcoming appointments. Needs `settings.manage`. */
  removeRoom(id: RoomId, options?: RequestOptions): Promise<ApiResult<void>>;

  /** Clinic host: the clinic's doctors, by name. Needs `appointments.read`. */
  listPractitioners(options?: RequestOptions): Promise<ApiResult<PractitionerPage>>;
  /** Clinic host: adds a doctor. Needs `settings.manage`. */
  addPractitioner(input: PractitionerFields, options?: RequestOptions): Promise<ApiResult<Practitioner>>;
  /** Clinic host: changes a doctor's details. Needs `settings.manage`. */
  changePractitioner(id: PractitionerId, changes: PractitionerFields, options?: RequestOptions): Promise<ApiResult<Practitioner>>;
  /** Clinic host: removes a doctor with no upcoming appointments. Needs `settings.manage`. */
  removePractitioner(id: PractitionerId, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: a doctor's weekly hours. Needs `appointments.read`. */
  getWorkingHours(id: PractitionerId, options?: RequestOptions): Promise<ApiResult<WorkingHours>>;
  /** Clinic host: replaces a doctor's weekly hours; an empty list clears them. Needs `settings.manage`. */
  setWorkingHours(id: PractitionerId, hours: WorkingHours, options?: RequestOptions): Promise<ApiResult<WorkingHours>>;

  /** Clinic host: leave overlapping the local days given. Needs `appointments.read`. */
  listLeave(range: DateRange, options?: RequestOptions): Promise<ApiResult<LeavePage>>;
  /** Clinic host: records a doctor's leave. Needs `appointments.write`. */
  addLeave(input: NewLeave, options?: RequestOptions): Promise<ApiResult<Leave>>;
  /** Clinic host: removes leave. Needs `appointments.write`. */
  removeLeave(id: LeaveId, options?: RequestOptions): Promise<ApiResult<void>>;

  /** Clinic host: appointments starting in the local days given. Needs `appointments.read`. */
  listAppointments(filter: AppointmentFilter, options?: RequestOptions): Promise<ApiResult<AppointmentPage>>;
  /** Clinic host: books an appointment. `409` when the chair is taken; `warnings` for anything else worth knowing. Needs `appointments.write`. */
  bookAppointment(input: NewAppointmentBody, options?: RequestOptions): Promise<ApiResult<SavedAppointment>>;
  /** Clinic host: moves, reassigns or edits an appointment. Needs `appointments.write`. */
  changeAppointment(id: AppointmentId, changes: AppointmentChanges, options?: RequestOptions): Promise<ApiResult<SavedAppointment>>;
  /** Clinic host: moves an appointment's status along, or cancels (with a reason) or marks a no-show. Needs `appointments.write`. */
  setAppointmentStatus(id: AppointmentId, change: StatusChange, options?: RequestOptions): Promise<ApiResult<StatusChanged>>;

  /** Clinic host: the queue of a clinic day, with each token's wait. Needs `appointments.read`. */
  listQueue(date: string | undefined, options?: RequestOptions): Promise<ApiResult<QueueDayPage>>;
  /** Clinic host: issues a token to a patient without an appointment. Needs `appointments.write`. */
  addWalkIn(input: WalkInBody, options?: RequestOptions): Promise<ApiResult<QueueToken>>;
  /** Clinic host: moves a token along; a token with an appointment moves the appointment too. Needs `appointments.write`. */
  setQueueStatus(id: QueueTokenId, change: TokenStatusChange, options?: RequestOptions): Promise<ApiResult<QueueToken>>;

  /** Clinic host: imports patients from CSV; `preview` saves nothing, `commit` saves the valid rows. Needs `patients.write`. */
  importPatients(input: PatientImport, options?: RequestOptions): Promise<ApiResult<ImportResult>>;

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
