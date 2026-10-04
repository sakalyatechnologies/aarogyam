/**
 * Runtime decoders for every response, so data entering the apps is validated once at the
 * boundary and carries typed identifiers from then on.
 *
 * Each schema `satisfies` its contract type, which comes from the generated OpenAPI types:
 * when the spec changes, `pnpm --filter @aarogyam/api-client generate` and the type check list
 * every decoder that no longer agrees.
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

/** A patient's ID: what Patient 360 URLs carry. */
export const patientId = z.uuid().brand<"PatientId">();
export type PatientId = z.output<typeof patientId>;

/** The clinic's readable patient number, such as `SD-9`: said aloud by staff. */
export const patientNumber = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{0,7}-\d{1,9}$/)
  .brand<"PatientNumber">();
export type PatientNumber = z.output<typeof patientNumber>;

export const appointmentId = z.string().min(1).brand<"AppointmentId">();
export type AppointmentId = z.output<typeof appointmentId>;

export const practitionerId = z.string().min(1).brand<"PractitionerId">();
export type PractitionerId = z.output<typeof practitionerId>;

export const roomId = z.string().min(1).brand<"RoomId">();
export type RoomId = z.output<typeof roomId>;

export const leaveId = z.string().min(1).brand<"LeaveId">();
export type LeaveId = z.output<typeof leaveId>;

export const queueTokenId = z.string().min(1).brand<"QueueTokenId">();
export type QueueTokenId = z.output<typeof queueTokenId>;

export const qualityRunId = z.string().min(1).brand<"QualityRunId">();
export type QualityRunId = z.output<typeof qualityRunId>;

export const invitationId = z.string().min(1).brand<"InvitationId">();
export type InvitationId = z.output<typeof invitationId>;

export const sessionId = z.string().min(1).brand<"SessionId">();
export type SessionId = z.output<typeof sessionId>;

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
const ratio = z.number().min(0).max(1);
const millis = z.number().nonnegative();

export const sex = z.enum(["female", "male", "other", "unknown"]) satisfies z.ZodType<C.Sex>;
export type Sex = z.output<typeof sex>;

/** A `204 No Content` response, such as revoking a session. */
export const voidResponse = z.undefined();

export const themeMode = z.enum(["light", "dark"]);
export type ThemeMode = z.output<typeof themeMode>;

// Errors -------------------------------------------------------------------------------------

export const errorBody = z.object({
  error: z.object({ code: z.string().min(1), message: z.string(), field: optionalText }),
}) satisfies z.ZodType<C.ErrorBody>;

// Neutral host -------------------------------------------------------------------------------

const myClinic = z.object({
  org_id: clinicId,
  slug: z.string().min(1),
  name: z.string(),
  role_key: z.string(),
  role_name: z.string(),
  host: optionalText,
}) satisfies z.ZodType<C.MyClinic>;
export type ClinicAccess = z.output<typeof myClinic>;

export const meResponse = z.object({ clinics: z.array(myClinic) }) satisfies z.ZodType<C.Me>;
export type Me = z.output<typeof meResponse>;

// Clinic host --------------------------------------------------------------------------------

const brandingFields = z.object({
  brand: z.string().optional().catch(undefined),
  mode: themeMode.optional().catch(undefined),
});

/** The parts of a clinic's free-form `branding` the portal understands; anything else is ignored. */
export function readBranding(value: Record<string, unknown>): { brand?: string | undefined; mode?: ThemeMode | undefined } {
  const parsed = brandingFields.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export const sessionResponse = z.object({
  clinic: z.object({ id: clinicId, slug: z.string().min(1), name: z.string(), timezone: z.string().min(1), branding: z.record(z.string(), z.unknown()) }),
  membership: z.object({ id: membershipId, role_key: z.string(), permissions: z.array(z.string()) }),
  user: z.object({ id: userId, display_name: z.string() }),
}) satisfies z.ZodType<C.Session>;
export type Session = z.output<typeof sessionResponse>;

export const patient = z.object({
  id: patientId,
  number: patientNumber,
  full_name: z.string(),
  sex,
  date_of_birth: date.nullable().exactOptional(),
  birth_date_estimated: z.boolean(),
  age_years: count.nullable().exactOptional(),
  /** Masked by the API unless the member has `patients.contact`. */
  phone: optionalText,
  email: optionalText,
  preferred_language: z.string(),
  status: z.enum(["active", "inactive", "deceased", "merged"]),
  created_at: timestamp,
  last_visit_at: optionalTimestamp,
}) satisfies z.ZodType<C.Patient>;
export type Patient = z.output<typeof patient>;

export const patientList = z.object({ items: z.array(patient) }) satisfies z.ZodType<C.PatientList>;
export type PatientPage = z.output<typeof patientList>;

// Staff ----------------------------------------------------------------------------------------

const memberStatus = z.enum(["invited", "active", "suspended", "left"]);
export type MemberStatus = z.output<typeof memberStatus>;

const memberBranch = z.object({ id: z.string().min(1), name: z.string() }) satisfies z.ZodType<C.MemberBranch>;

export const member = z.object({
  id: membershipId,
  user_id: userId,
  display_name: z.string(),
  role_key: z.string(),
  role_name: z.string(),
  status: memberStatus,
  branches: z.array(memberBranch),
  joined_at: optionalTimestamp,
}) satisfies z.ZodType<C.Member>;
export type Member = z.output<typeof member>;

export const pendingInvitation = z.object({
  id: invitationId,
  email: optionalText,
  role_key: z.string(),
  created_at: timestamp,
  expires_at: timestamp,
}) satisfies z.ZodType<C.PendingInvitation>;
export type PendingInvitation = z.output<typeof pendingInvitation>;

export const staffResponse = z.object({
  members: z.array(member),
  invitations: z.array(pendingInvitation),
}) satisfies z.ZodType<C.Staff>;
export type Staff = z.output<typeof staffResponse>;

/** What `POST /api/v1/staff/invitations` returns; `invite_token` is shown once. */
export const createdInvitation = z.object({
  id: invitationId,
  email: z.string(),
  role_key: z.string(),
  expires_at: timestamp,
  invite_token: z.string().min(1),
}) satisfies z.ZodType<C.CreatedInvitation>;
export type CreatedInvitation = z.output<typeof createdInvitation>;

const rolePermission = z.object({ key: z.string(), scope: z.enum(["all", "own", "assigned"]) }) satisfies z.ZodType<C.RolePermission>;
export type RolePermission = z.output<typeof rolePermission>;

export const role = z.object({
  id: z.string().min(1),
  key: z.string(),
  name: z.string(),
  description: optionalText,
  is_template: z.boolean(),
  permissions: z.array(rolePermission),
}) satisfies z.ZodType<C.Role>;
export type Role = z.output<typeof role>;

export const rolesResponse = z.object({ items: z.array(role) }) satisfies z.ZodType<C.Roles>;
export type Roles = z.output<typeof rolesResponse>;

/** Body of `POST /api/v1/staff/invitations`. */
export type NewInvitation = C.NewInvitation;
/** Body of `PATCH /api/v1/staff/{membership_id}`. Fields left out stay as they are. */
export type MemberChanges = C.MemberChanges;

// Settings ---------------------------------------------------------------------------------------

export const address = z.object({
  line1: optionalText,
  line2: optionalText,
  city: optionalText,
  state: optionalText,
  pincode: optionalText,
}) satisfies z.ZodType<C.Address>;
export type Address = z.output<typeof address>;

const clinicBranding = z.object({
  brand: optionalText,
  mode: themeMode.nullable().exactOptional(),
}) satisfies z.ZodType<C.Branding>;

export const clinicSettings = z.object({
  name: z.string(),
  legal_name: optionalText,
  gstin: optionalText,
  timezone: z.string(),
  phone: optionalText,
  upi_id: optionalText,
  prescription_footer: optionalText,
  address,
  branding: clinicBranding,
}) satisfies z.ZodType<C.ClinicSettings>;
export type ClinicSettings = z.output<typeof clinicSettings>;

/** Body of `PATCH /api/v1/settings/clinic`. Settings left out stay as they are. */
export type ClinicSettingsChanges = C.ClinicSettingsChanges;

// Sessions -----------------------------------------------------------------------------------

export const mySession = z.object({
  id: sessionId,
  audience: z.enum(["clinic", "patient", "platform"]),
  created_at: timestamp,
  last_active_at: timestamp,
  expires_at: timestamp,
  current: z.boolean(),
}) satisfies z.ZodType<C.MySession>;
export type MySession = z.output<typeof mySession>;

export const mySessionsResponse = z.object({ items: z.array(mySession) }) satisfies z.ZodType<C.MySessions>;
export type MySessions = z.output<typeof mySessionsResponse>;

/** Body of `PATCH /api/v1/patients/{id}`. Fields left out stay as they are. */
export type PatientChanges = C.PatientChanges;

export const appointmentStatus = z.enum([
  "booked",
  "confirmed",
  "arrived",
  "in_chair",
  "completed",
  "cancelled",
  "no_show",
]) satisfies z.ZodType<C.AppointmentStatus>;
export type AppointmentStatus = z.output<typeof appointmentStatus>;

export const appointmentKind = z.enum(["new", "follow_up", "procedure", "emergency"]) satisfies z.ZodType<C.AppointmentKind>;
export type AppointmentKind = z.output<typeof appointmentKind>;

export const appointmentSource = z.enum(["front_desk", "phone", "website", "app", "whatsapp"]) satisfies z.ZodType<C.AppointmentSource>;
export type AppointmentSource = z.output<typeof appointmentSource>;

export const bookingWarningCode = z.enum([
  "practitioner_busy",
  "practitioner_on_leave",
  "outside_working_hours",
]) satisfies z.ZodType<C.BookingWarningCode>;
export type BookingWarningCode = z.output<typeof bookingWarningCode>;

export const patientBrief = z.object({
  id: patientId,
  number: patientNumber,
  full_name: z.string(),
  sex,
  age_years: count.nullable().exactOptional(),
}) satisfies z.ZodType<C.PatientBrief>;
export type PatientBrief = z.output<typeof patientBrief>;

export const practitionerBrief = z.object({
  id: practitionerId,
  display_name: z.string(),
  calendar_color: optionalText,
}) satisfies z.ZodType<C.PractitionerBrief>;
export type PractitionerBrief = z.output<typeof practitionerBrief>;

export const appointment = z.object({
  id: appointmentId,
  branch_id: z.string().min(1),
  starts_at: timestamp,
  ends_at: timestamp,
  status: appointmentStatus,
  kind: appointmentKind,
  source: appointmentSource,
  reason: optionalText,
  notes: optionalText,
  has_notes: z.boolean(),
  room: optionalText,
  room_id: roomId.nullable().exactOptional(),
  patient: patientBrief,
  practitioner: practitionerBrief,
  arrived_at: optionalTimestamp,
  seated_at: optionalTimestamp,
  completed_at: optionalTimestamp,
  cancel_reason: optionalText,
  token_number: count.nullable().exactOptional(),
}) satisfies z.ZodType<C.Appointment>;
export type Appointment = z.output<typeof appointment>;

export const appointmentList = z.object({ items: z.array(appointment) }) satisfies z.ZodType<C.AppointmentList>;
export type AppointmentPage = z.output<typeof appointmentList>;

/** Body of `POST /api/v1/appointments`. */
export type NewAppointmentBody = C.NewAppointmentBody;
/** Body of `PATCH /api/v1/appointments/{id}`. Fields left out stay as they are. */
export type AppointmentChanges = C.AppointmentChanges;
/** Body of `POST /api/v1/appointments/{id}/status` and `POST /api/v1/queue/{id}/status`. */
export type StatusChange = C.StatusChange;
export type TokenStatusChange = C.TokenStatusChange;

export const bookingWarning = z.object({ code: bookingWarningCode, message: z.string() }) satisfies z.ZodType<C.BookingWarning>;
export type BookingWarning = z.output<typeof bookingWarning>;

export const savedAppointment = z.object({ appointment, warnings: z.array(bookingWarning) }) satisfies z.ZodType<C.SavedAppointment>;
export type SavedAppointment = z.output<typeof savedAppointment>;

export const statusChanged = z.object({
  appointment,
  queue_token_id: queueTokenId.nullable().exactOptional(),
}) satisfies z.ZodType<C.StatusChanged>;
export type StatusChanged = z.output<typeof statusChanged>;

// Rooms, practitioners, hours and leave (M3) -----------------------------------------------------

export const roomKind = z.enum(["chair", "room", "lab"]) satisfies z.ZodType<C.RoomKind>;
export type RoomKind = z.output<typeof roomKind>;

export const room = z.object({
  id: roomId,
  branch_id: z.string().min(1),
  name: z.string(),
  kind: roomKind,
  active: z.boolean(),
  sort_order: count,
}) satisfies z.ZodType<C.Room>;
export type Room = z.output<typeof room>;

export const roomList = z.object({ items: z.array(room) }) satisfies z.ZodType<C.RoomList>;
export type RoomPage = z.output<typeof roomList>;

/** Body of `POST /api/v1/rooms` and `PATCH /api/v1/rooms/{id}`. */
export type RoomFields = C.RoomFields;

export const practitioner = z.object({
  id: practitionerId,
  display_name: z.string(),
  calendar_color: z.string(),
  active: z.boolean(),
  membership_id: membershipId.nullable().exactOptional(),
  registration_number: optionalText,
  specialty: optionalText,
}) satisfies z.ZodType<C.Practitioner>;
export type Practitioner = z.output<typeof practitioner>;

export const practitionerList = z.object({ items: z.array(practitioner) }) satisfies z.ZodType<C.PractitionerList>;
export type PractitionerPage = z.output<typeof practitionerList>;

/** Body of `POST /api/v1/practitioners` and `PATCH /api/v1/practitioners/{id}`. */
export type PractitionerFields = C.PractitionerFields;

const workingShift = z.object({
  weekday: z.number().int().min(1).max(7),
  starts: z.string(),
  ends: z.string(),
  branch_id: z.string().min(1).nullable().exactOptional(),
}) satisfies z.ZodType<C.WorkingShift>;
export type WorkingShift = z.output<typeof workingShift>;

export const workingHours = z.object({ shifts: z.array(workingShift) }) satisfies z.ZodType<C.WorkingHours>;
export type WorkingHours = z.output<typeof workingHours>;

export const leave = z.object({
  id: leaveId,
  practitioner_id: practitionerId,
  starts_at: timestamp,
  ends_at: timestamp,
  reason: optionalText,
}) satisfies z.ZodType<C.Leave>;
export type Leave = z.output<typeof leave>;

export const leaveList = z.object({ items: z.array(leave) }) satisfies z.ZodType<C.LeaveList>;
export type LeavePage = z.output<typeof leaveList>;

/** Body of `POST /api/v1/leave-blocks`. */
export type NewLeave = C.NewLeave;

// Queue (M3) --------------------------------------------------------------------------------------

export const queueTokenStatus = z.enum(["waiting", "in_chair", "done", "left"]) satisfies z.ZodType<C.QueueTokenStatus>;
export type QueueTokenStatus = z.output<typeof queueTokenStatus>;

export const queueToken = z.object({
  id: queueTokenId,
  branch_id: z.string().min(1),
  day: date,
  token_number: count,
  patient: patientBrief,
  practitioner: practitionerBrief.nullable().exactOptional(),
  appointment_id: appointmentId.nullable().exactOptional(),
  status: queueTokenStatus,
  issued_at: timestamp,
  called_at: optionalTimestamp,
  done_at: optionalTimestamp,
  wait_minutes: z.number().int().nonnegative(),
}) satisfies z.ZodType<C.QueueToken>;
export type QueueToken = z.output<typeof queueToken>;

export const queueDay = z.object({ date, items: z.array(queueToken) }) satisfies z.ZodType<C.QueueDay>;
export type QueueDayPage = z.output<typeof queueDay>;

/** Body of `POST /api/v1/queue`. */
export type WalkInBody = C.WalkInBody;

// Today (M3) --------------------------------------------------------------------------------------

export const attentionKind = z.enum(["late_arrival", "long_wait"]) satisfies z.ZodType<C.AttentionKind>;
export type AttentionKind = z.output<typeof attentionKind>;

const attentionPatient = z.object({ id: patientId, number: patientNumber, full_name: z.string() }) satisfies z.ZodType<C.AttentionPatient>;

export const attentionItem = z.object({
  kind: attentionKind,
  message: z.string(),
  minutes: z.number().int().nonnegative(),
  patient: attentionPatient,
  appointment_id: appointmentId.nullable().exactOptional(),
  queue_token_id: queueTokenId.nullable().exactOptional(),
}) satisfies z.ZodType<C.AttentionItem>;
export type AttentionItem = z.output<typeof attentionItem>;

const chairAppointment = z.object({
  appointment_id: appointmentId,
  starts_at: timestamp,
  ends_at: timestamp,
  status: appointmentStatus,
  patient: patientBrief,
  practitioner: practitionerBrief,
}) satisfies z.ZodType<C.ChairAppointment>;

export const chairOccupancy = z.enum(["in_use", "free"]) satisfies z.ZodType<C.ChairOccupancy>;
export type ChairOccupancy = z.output<typeof chairOccupancy>;

export const chairStatus = z.object({
  room_id: roomId,
  name: z.string(),
  kind: roomKind,
  status: chairOccupancy,
  current: chairAppointment.nullable().exactOptional(),
  next: chairAppointment.nullable().exactOptional(),
}) satisfies z.ZodType<C.ChairStatus>;
export type ChairStatus = z.output<typeof chairStatus>;

const hourBar = z.object({ hour: z.number().int().min(0).max(23), booked: count, completed: count }) satisfies z.ZodType<C.HourBar>;
export type HourBar = z.output<typeof hourBar>;

const todayShift = z.object({ starts: z.string(), ends: z.string() }) satisfies z.ZodType<C.TodayShift>;
export type TodayShift = z.output<typeof todayShift>;

const teamMemberToday = z.object({
  practitioner: practitionerBrief,
  specialty: optionalText,
  on_leave: z.boolean(),
  appointments: count,
  shifts: z.array(todayShift),
}) satisfies z.ZodType<C.TeamMemberToday>;
export type TeamMemberToday = z.output<typeof teamMemberToday>;

export const todayCounts = z.object({
  total: count,
  booked: count,
  arrived: count,
  in_chair: count,
  done: count,
  cancelled: count,
  no_shows: count,
  waiting: count,
}) satisfies z.ZodType<C.TodayCounts>;
export type TodayCounts = z.output<typeof todayCounts>;

export const todayResponse = z.object({
  date,
  as_of: timestamp,
  counts: todayCounts,
  appointments: z.array(appointment),
  by_hour: z.array(hourBar),
  chairs: z.array(chairStatus),
  attention: z.array(attentionItem),
  recent_patients: z.array(queueToken),
  team: z.array(teamMemberToday),
}) satisfies z.ZodType<C.TodayResponse>;
export type Today = z.output<typeof todayResponse>;

// Patient import (M3) ------------------------------------------------------------------------

export const importMode = z.enum(["preview", "commit"]) satisfies z.ZodType<C.ImportMode>;
export type ImportMode = z.output<typeof importMode>;

const importRow = z.object({
  line: z.number().int().positive(),
  valid: z.boolean(),
  errors: z.array(z.string()),
  patient_id: patientId.nullable().exactOptional(),
  number: patientNumber.nullable().exactOptional(),
}) satisfies z.ZodType<C.ImportRow>;
export type ImportRow = z.output<typeof importRow>;

export const importResult = z.object({
  mode: importMode,
  total: count,
  valid: count,
  invalid: count,
  import_id: z.string().min(1).nullable().exactOptional(),
  rows: z.array(importRow),
}) satisfies z.ZodType<C.ImportResult>;
export type ImportResult = z.output<typeof importResult>;

/** Body of `POST /api/v1/imports/patients`. */
export type PatientImport = C.PatientImport;

// Console host -------------------------------------------------------------------------------

export const clinicStatus = z.enum(["trial", "active", "suspended", "churned"]);
export type ClinicStatus = z.output<typeof clinicStatus>;

const consoleClinic = z.object({
  id: clinicId,
  slug: z.string().min(1),
  name: z.string(),
  specialty: z.string(),
  status: clinicStatus,
  created_at: timestamp,
  portal_host: optionalText,
  active_members: count,
  patients: count,
}) satisfies z.ZodType<C.ConsoleClinic>;
export type ConsoleClinic = z.output<typeof consoleClinic>;

export const consoleClinics = z.object({ items: z.array(consoleClinic) }) satisfies z.ZodType<C.ConsoleClinics>;
export type ConsoleClinicPage = z.output<typeof consoleClinics>;

/** What creating a clinic returns: its portal host and the owner's one-time invitation. */
export const createdClinic = z.object({
  id: clinicId,
  slug: z.string().min(1),
  portal_host: z.string().min(1),
  invitation_id: z.string().min(1),
  invite_token: z.string().min(1),
  invite_expires_at: timestamp,
}) satisfies z.ZodType<C.CreatedClinic>;
export type CreatedClinic = z.output<typeof createdClinic>;

export const metricsRange = z.enum(["1h", "24h", "7d"]) satisfies z.ZodType<C.MetricsRange>;
export type MetricsRange = z.output<typeof metricsRange>;

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
      z.object({ method: z.string(), route: z.string(), requests: count, error_rate: ratio, p95_ms: millis, p99_ms: millis }),
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
}) satisfies z.ZodType<C.ServiceMetrics>;
export type Metrics = z.output<typeof metricsResponse>;
export type ApiMetrics = Metrics["api"];
export type RouteMetrics = ApiMetrics["routes"][number];
export type DatabaseMetrics = Metrics["db"];
export type EdgeMetrics = NonNullable<Metrics["edge"]>;

export const testSuite = z.enum(["unit", "integration", "e2e_web", "e2e_mobile", "canary", "load"]) satisfies z.ZodType<C.TestSuite>;
export const qualityEnvironment = z.enum(["ci", "staging", "production"]) satisfies z.ZodType<C.QualityEnvironment>;

const qualityRun = z.object({
  id: qualityRunId,
  status: z.enum(["running", "passed", "failed", "cancelled"]),
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

/** `POST /api/v1/dev/token` (development builds of the API only). */
export const devTokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
}) satisfies z.ZodType<C.DevTokenResponse>;

/** `POST /api/v1/invitations/accept`: the clinic joined and the new membership. */
export const joined = z.object({ org_id: clinicId, membership_id: membershipId }) satisfies z.ZodType<C.Joined>;
export type Joined = z.output<typeof joined>;

// Requests -----------------------------------------------------------------------------------

/** Body of `POST /api/v1/patients`. */
export type NewPatient = C.NewPatient;

/** Body of `POST /api/v1/console/clinics`. */
export type NewClinic = C.NewClinic;

/** Body of `POST /api/v1/invitations/accept`. */
export type AcceptInvitation = C.AcceptInvitation;
