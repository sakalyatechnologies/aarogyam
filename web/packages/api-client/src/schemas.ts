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

export const visitId = z.string().min(1).brand<"VisitId">();
export type VisitId = z.output<typeof visitId>;

export const noteId = z.string().min(1).brand<"NoteId">();
export type NoteId = z.output<typeof noteId>;

export const observationId = z.string().min(1).brand<"ObservationId">();
export type ObservationId = z.output<typeof observationId>;

export const procedureId = z.string().min(1).brand<"ProcedureId">();
export type ProcedureId = z.output<typeof procedureId>;

export const planId = z.string().min(1).brand<"PlanId">();
export type PlanId = z.output<typeof planId>;

export const chartEntryId = z.string().min(1).brand<"ChartEntryId">();
export type ChartEntryId = z.output<typeof chartEntryId>;

export const attachmentId = z.string().min(1).brand<"AttachmentId">();
export type AttachmentId = z.output<typeof attachmentId>;

export const allergyId = z.string().min(1).brand<"AllergyId">();
export type AllergyId = z.output<typeof allergyId>;

export const conditionId = z.string().min(1).brand<"ConditionId">();
export type ConditionId = z.output<typeof conditionId>;

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
  /** The next booked or confirmed appointment; absent on a freshly registered patient. */
  next_appointment: z.object({ starts_at: timestamp, practitioner: z.string() }).nullable().exactOptional(),
  /** Owed on issued bills; null without `billing.read`. */
  balance_paise: paise.nullable().exactOptional(),
  /** Received in total; null without `billing.read`. */
  lifetime_paid_paise: paise.nullable().exactOptional(),
  recall_due: z.boolean(),
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

// Clinical flags: allergies and conditions (M4) --------------------------------------------------

export const codeSystem = z.enum(["icd10", "icd11", "snomed", "loinc", "custom"]) satisfies z.ZodType<C.CodeSystem>;
export const code = z.object({ system: codeSystem, code: z.string() }) satisfies z.ZodType<C.Code>;
export type Code = z.output<typeof code>;

export const clinicalSource = z.enum(["clinician", "assistant", "patient", "import"]) satisfies z.ZodType<C.ClinicalSource>;
export type ClinicalSource = z.output<typeof clinicalSource>;

export const clinicalStatus = z.enum(["active", "resolved", "entered_in_error"]) satisfies z.ZodType<C.ClinicalStatus>;
export type ClinicalStatus = z.output<typeof clinicalStatus>;

export const severity = z.enum(["mild", "moderate", "severe"]) satisfies z.ZodType<C.Severity>;
export type Severity = z.output<typeof severity>;

export const allergy = z.object({
  id: allergyId,
  substance: z.string(),
  reaction: optionalText,
  severity,
  status: clinicalStatus,
  source: clinicalSource,
  code: code.nullable().exactOptional(),
  verified_by: membershipId.nullable().exactOptional(),
  created_at: timestamp,
  updated_at: timestamp,
}) satisfies z.ZodType<C.Allergy>;
export type Allergy = z.output<typeof allergy>;

export const allergyList = z.object({ items: z.array(allergy) }) satisfies z.ZodType<C.AllergyList>;
export type AllergyPage = z.output<typeof allergyList>;

/** Body of `POST /api/v1/patients/{id}/allergies` and `PATCH .../allergies/{allergy_id}`. */
export type AllergyFields = C.AllergyFields;

export const condition = z.object({
  id: conditionId,
  display_text: z.string(),
  flagged: z.boolean(),
  status: clinicalStatus,
  source: clinicalSource,
  onset: date.nullable().exactOptional(),
  note: optionalText,
  code: code.nullable().exactOptional(),
  verified_by: membershipId.nullable().exactOptional(),
  visit_id: visitId.nullable().exactOptional(),
  created_at: timestamp,
  updated_at: timestamp,
}) satisfies z.ZodType<C.Condition>;
export type Condition = z.output<typeof condition>;

export const conditionList = z.object({ items: z.array(condition) }) satisfies z.ZodType<C.ConditionList>;
export type ConditionPage = z.output<typeof conditionList>;

/** Body of `POST /api/v1/patients/{id}/conditions` and `PATCH .../conditions/{condition_id}`. */
export type ConditionFields = C.ConditionFields;

export const clinicalFlags = z.object({
  allergies: z.array(allergy),
  allergy_count: count,
  conditions: z.array(condition),
  condition_count: count,
  severe_allergy: z.boolean(),
  details_hidden: z.boolean(),
}) satisfies z.ZodType<C.ClinicalFlags>;
export type ClinicalFlags = z.output<typeof clinicalFlags>;

// Visits, notes, vitals and procedures (M4) ------------------------------------------------------

export const visitStatus = z.enum(["open", "closed"]) satisfies z.ZodType<C.VisitStatus>;
export type VisitStatus = z.output<typeof visitStatus>;

export const visit = z.object({
  id: visitId,
  number: z.string(),
  patient_id: patientId,
  clinician: member,
  appointment_id: appointmentId.nullable().exactOptional(),
  chief_complaint: optionalText,
  status: visitStatus,
  started_at: timestamp,
  ended_at: optionalTimestamp,
}) satisfies z.ZodType<C.Visit>;
export type Visit = z.output<typeof visit>;

export const visitList = z.object({ items: z.array(visit) }) satisfies z.ZodType<C.VisitList>;
export type VisitPage = z.output<typeof visitList>;

/** Body of `POST /api/v1/patients/{id}/visits`. */
export type NewVisit = C.NewVisit;

export const timelineEventKind = z.enum(["visit", "note", "procedure", "attachment"]) satisfies z.ZodType<C.TimelineEventKind>;
export type TimelineEventKind = z.output<typeof timelineEventKind>;

export const timelineEvent = z.object({
  id: z.string().min(1),
  kind: timelineEventKind,
  at: timestamp,
  title: z.string(),
  detail: optionalText,
  status: optionalText,
  by: member.nullable().exactOptional(),
  visit_id: visitId.nullable().exactOptional(),
  amount_paise: paise.nullable().exactOptional(),
}) satisfies z.ZodType<C.TimelineEvent>;
export type TimelineEvent = z.output<typeof timelineEvent>;

export const timeline = z.object({ items: z.array(timelineEvent) }) satisfies z.ZodType<C.Timeline>;
export type Timeline = z.output<typeof timeline>;

export const noteKind = z.enum(["soap", "progress", "procedure", "intake", "front_desk"]) satisfies z.ZodType<C.NoteKind>;
export type NoteKind = z.output<typeof noteKind>;

export const noteStatus = z.enum(["draft", "signed", "conflict", "entered_in_error"]) satisfies z.ZodType<C.NoteStatus>;
export type NoteStatus = z.output<typeof noteStatus>;

export const noteSource = z.enum(["typed", "voice", "ai_draft"]) satisfies z.ZodType<C.NoteSource>;
export type NoteSource = z.output<typeof noteSource>;

export const noteSections = z.object({
  subjective: optionalText,
  objective: optionalText,
  assessment: optionalText,
  plan: optionalText,
}) satisfies z.ZodType<C.NoteSections>;
export type NoteSections = z.output<typeof noteSections>;

const addendum = z.object({ id: z.string().min(1), author: member, body: z.string(), created_at: timestamp }) satisfies z.ZodType<C.Addendum>;
export type Addendum = z.output<typeof addendum>;

export const note = z.object({
  id: noteId,
  visit_id: visitId,
  author: member,
  kind: noteKind,
  source: noteSource,
  status: noteStatus,
  sections: noteSections,
  addenda: z.array(addendum),
  error_reason: optionalText,
  conflicts_with_id: noteId.nullable().exactOptional(),
  signed_at: optionalTimestamp,
  created_at: timestamp,
  updated_at: timestamp,
}) satisfies z.ZodType<C.Note>;
export type Note = z.output<typeof note>;

/** Body of `POST /api/v1/visits/{id}/notes` and `PATCH /api/v1/notes/{id}`. */
export type NoteContent = C.NoteContent;
/** Body of `POST /api/v1/notes/{id}/addenda`. */
export type NewAddendum = C.NewAddendum;
/** Body of every `.../entered-in-error` action. */
export type EnteredInError = C.EnteredInError;

export const observationKind = z.enum([
  "bp_systolic",
  "bp_diastolic",
  "pulse",
  "temperature",
  "spo2",
  "weight",
  "height",
  "blood_sugar",
]) satisfies z.ZodType<C.ObservationKind>;
export type ObservationKind = z.output<typeof observationKind>;

export const observationStatus = z.enum(["final", "corrected", "entered_in_error"]) satisfies z.ZodType<C.ObservationStatus>;
export type ObservationStatus = z.output<typeof observationStatus>;

export const observation = z.object({
  id: observationId,
  visit_id: visitId.nullable().exactOptional(),
  kind: observationKind,
  value: z.number(),
  unit: z.string(),
  code: optionalText,
  status: observationStatus,
  source: clinicalSource,
  supersedes_id: observationId.nullable().exactOptional(),
  error_reason: optionalText,
  recorded_at: timestamp,
}) satisfies z.ZodType<C.Observation>;
export type Observation = z.output<typeof observation>;

export const observationList = z.object({ items: z.array(observation) }) satisfies z.ZodType<C.ObservationList>;
export type ObservationPage = z.output<typeof observationList>;

/** Body of `POST /api/v1/visits/{id}/observations`. */
export type NewReadings = C.NewReadings;

export const toothSurface = z.enum(["M", "O", "D", "B", "L"]) satisfies z.ZodType<C.ToothSurface>;
export type ToothSurface = z.output<typeof toothSurface>;

export const procedureStatus = z.enum(["planned", "done", "entered_in_error"]) satisfies z.ZodType<C.ProcedureStatus>;
export type ProcedureStatus = z.output<typeof procedureStatus>;

export const procedure = z.object({
  id: procedureId,
  visit_id: visitId,
  clinician: member,
  name: z.string(),
  code: code.nullable().exactOptional(),
  tooth: count.nullable().exactOptional(),
  surfaces: z.array(toothSurface),
  status: procedureStatus,
  note: optionalText,
  price_paise: paise.nullable().exactOptional(),
  plan_item_id: z.string().min(1).nullable().exactOptional(),
  performed_at: optionalTimestamp,
  error_reason: optionalText,
  created_at: timestamp,
}) satisfies z.ZodType<C.Procedure>;
export type Procedure = z.output<typeof procedure>;

export const procedureList = z.object({ items: z.array(procedure) }) satisfies z.ZodType<C.ProcedureList>;
export type ProcedurePage = z.output<typeof procedureList>;

/** Body of `POST /api/v1/visits/{id}/procedures`. */
export type NewProcedure = C.NewProcedure;

export const planStatus = z.enum(["proposed", "accepted", "in_progress", "completed", "declined"]) satisfies z.ZodType<C.PlanStatus>;
export type PlanStatus = z.output<typeof planStatus>;

export const planItemStatus = z.enum(["proposed", "accepted", "done", "cancelled"]) satisfies z.ZodType<C.PlanItemStatus>;
export type PlanItemStatus = z.output<typeof planItemStatus>;

/** The statuses `PATCH /api/v1/treatment-plan-items/{id}` accepts. */
export type FinishedItemStatus = "done" | "cancelled";

const planItem = z.object({
  id: z.string().min(1),
  name: z.string(),
  code: code.nullable().exactOptional(),
  tooth: count.nullable().exactOptional(),
  surfaces: z.array(toothSurface),
  phase: z.number().int().min(1),
  estimate_paise: paise,
  status: planItemStatus,
  procedure_id: procedureId.nullable().exactOptional(),
}) satisfies z.ZodType<C.PlanItem>;
export type PlanItem = z.output<typeof planItem>;

export const plan = z.object({
  id: planId,
  patient_id: patientId,
  visit_id: visitId.nullable().exactOptional(),
  clinician: member,
  title: z.string(),
  status: planStatus,
  items: z.array(planItem),
  estimate_paise: paise,
  created_at: timestamp,
  accepted_at: optionalTimestamp,
}) satisfies z.ZodType<C.Plan>;
export type Plan = z.output<typeof plan>;

export const planList = z.object({ items: z.array(plan) }) satisfies z.ZodType<C.PlanList>;
export type PlanPage = z.output<typeof planList>;

/** Body of `POST /api/v1/patients/{id}/treatment-plans`. */
export type NewPlan = C.NewPlan;
/** Body of `POST /api/v1/treatment-plans/{id}/accept`. */
export type Acceptance = C.Acceptance;

export const visitDetail = z.object({
  visit,
  notes: z.array(note),
  observations: z.array(observation),
  procedures: z.array(procedure),
  chart_entries: z.array(
    z.object({
      id: z.string().min(1),
      tooth: count,
      surface: toothSurface.nullable().exactOptional(),
      finding: z.string(),
      status: z.string(),
      note: optionalText,
      effective_at: timestamp,
      recorded_by: membershipId.nullable().exactOptional(),
      supersedes_id: z.string().min(1).nullable().exactOptional(),
      visit_id: visitId.nullable().exactOptional(),
    }),
  ),
  attachments: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.string(),
      mime_type: z.string(),
      size_bytes: count,
      sha256: z.string(),
      caption: optionalText,
      tooth: count.nullable().exactOptional(),
      taken_at: optionalTimestamp,
      visit_id: visitId.nullable().exactOptional(),
      created_at: timestamp,
    }),
  ),
}) satisfies z.ZodType<C.VisitDetail>;
export type VisitDetail = z.output<typeof visitDetail>;

// Dental chart (M4) -------------------------------------------------------------------------------

export const chartFinding = z.enum([
  "sound",
  "caries",
  "filled",
  "crown",
  "missing",
  "implant",
  "root_canal",
  "bridge",
  "fractured",
  "watch",
]) satisfies z.ZodType<C.ChartFinding>;
export type ChartFinding = z.output<typeof chartFinding>;

export const chartEntryStatus = z.enum(["current", "superseded", "entered_in_error"]) satisfies z.ZodType<C.ChartEntryStatus>;
export type ChartEntryStatus = z.output<typeof chartEntryStatus>;

export const chartEntry = z.object({
  id: chartEntryId,
  tooth: count,
  surface: toothSurface.nullable().exactOptional(),
  finding: chartFinding,
  note: optionalText,
  status: chartEntryStatus,
  recorded_by: membershipId.nullable().exactOptional(),
  supersedes_id: chartEntryId.nullable().exactOptional(),
  visit_id: visitId.nullable().exactOptional(),
  effective_at: timestamp,
}) satisfies z.ZodType<C.ChartEntry>;
export type ChartEntry = z.output<typeof chartEntry>;

export const dentalChart = z.object({ current: z.array(chartEntry), history: z.array(chartEntry) }) satisfies z.ZodType<C.DentalChart>;
export type DentalChart = z.output<typeof dentalChart>;

/** Body of `POST /api/v1/patients/{id}/dental-chart`. */
export type NewChartEntries = C.NewChartEntries;

// Patient files (M4) ------------------------------------------------------------------------------

export const attachmentKind = z.enum(["photo", "xray", "report", "document", "audio", "consent"]) satisfies z.ZodType<C.AttachmentKind>;
export type AttachmentKind = z.output<typeof attachmentKind>;

export const attachment = z.object({
  id: attachmentId,
  kind: attachmentKind,
  mime_type: z.string(),
  size_bytes: count,
  sha256: z.string(),
  caption: optionalText,
  tooth: count.nullable().exactOptional(),
  taken_at: optionalTimestamp,
  visit_id: visitId.nullable().exactOptional(),
  created_at: timestamp,
}) satisfies z.ZodType<C.Attachment>;
export type Attachment = z.output<typeof attachment>;

export const attachmentList = z.object({ items: z.array(attachment) }) satisfies z.ZodType<C.AttachmentList>;
export type AttachmentPage = z.output<typeof attachmentList>;

export const downloadLink = z.object({ url: z.string().min(1), expires_at: timestamp }) satisfies z.ZodType<C.DownloadLink>;
export type DownloadLink = z.output<typeof downloadLink>;

// Onboarding: registration, applications, clinic detail (M2.5) ------------------------------------

export const applicationId = z.string().min(1).brand<"ApplicationId">();
export type ApplicationId = z.output<typeof applicationId>;

/** Body of `POST /api/v1/registrations`. */
export type NewRegistration = C.NewRegistration;

export const registrationReceived = z.object({ status: z.string(), message: z.string() }) satisfies z.ZodType<C.RegistrationReceived>;
export type RegistrationReceived = z.output<typeof registrationReceived>;

export const applicationStatus = z.enum(["pending", "approved", "rejected"]) satisfies z.ZodType<C.ApplicationStatus>;
export type ApplicationStatus = z.output<typeof applicationStatus>;

export const application = z.object({
  id: applicationId,
  clinic_name: z.string(),
  city: z.string(),
  specialty: z.string(),
  contact_name: z.string(),
  email: z.string(),
  phone: optionalText,
  message: optionalText,
  status: z.string(),
  submissions: z.number().int(),
  clinic_id: clinicId.nullable().exactOptional(),
  decided_at: optionalTimestamp,
  decided_by: optionalText,
  decision_reason: optionalText,
  created_at: timestamp,
  updated_at: timestamp,
}) satisfies z.ZodType<C.Application>;
export type Application = z.output<typeof application>;

export const applications = z.object({ items: z.array(application) }) satisfies z.ZodType<C.Applications>;
export type Applications = z.output<typeof applications>;

/** Body of `POST /api/v1/console/applications/{id}/approve`. */
export type ApproveApplication = C.ApproveApplication;

export const approvedApplication = z.object({
  clinic_id: clinicId,
  slug: z.string().min(1),
  portal_host: z.string().min(1),
  invitation_id: invitationId,
  invite_link: z.string().min(1),
  invite_expires_at: timestamp,
  account_ready: z.boolean(),
}) satisfies z.ZodType<C.ApprovedApplication>;
export type ApprovedApplication = z.output<typeof approvedApplication>;

/** Body of `POST /api/v1/console/applications/{id}/reject`. */
export type RejectApplication = C.RejectApplication;

export const clinicMemberStatus = z.enum(["invited", "active", "suspended", "left"]) satisfies z.ZodType<C.ClinicMemberStatus>;
export type ClinicMemberStatus = z.output<typeof clinicMemberStatus>;

export const clinicMember = z.object({
  membership_id: membershipId,
  display_name: z.string(),
  email: optionalText,
  role_key: z.string(),
  role_name: z.string(),
  status: z.string(),
  joined_at: optionalTimestamp,
}) satisfies z.ZodType<C.ClinicMember>;
export type ClinicMember = z.output<typeof clinicMember>;

export const clinicInvitation = z.object({
  id: invitationId,
  email: optionalText,
  role_key: z.string(),
  role_name: z.string(),
  expires_at: timestamp,
  created_at: timestamp,
}) satisfies z.ZodType<C.ClinicInvitation>;
export type ClinicInvitation = z.output<typeof clinicInvitation>;

export const clinicDetail = z.object({
  id: clinicId,
  slug: z.string().min(1),
  name: z.string(),
  specialty: z.string(),
  status: clinicStatus,
  timezone: z.string().min(1),
  created_at: timestamp,
  hosts: z.array(z.string()),
  active_members: count,
  patients: count,
  pending_invitations: count,
  members: z.array(clinicMember),
  invitations: z.array(clinicInvitation),
}) satisfies z.ZodType<C.ClinicDetail>;
export type ClinicDetail = z.output<typeof clinicDetail>;

/** Body of `POST /api/v1/console/clinics/{id}/invitations`. */
export type NewClinicInvitation = C.NewClinicInvitation;

export const clinicInvited = z.object({
  id: invitationId,
  email: z.string(),
  role_key: z.string(),
  invite_link: z.string().min(1),
  expires_at: timestamp,
  account_ready: z.boolean(),
}) satisfies z.ZodType<C.ClinicInvited>;
export type ClinicInvited = z.output<typeof clinicInvited>;

// Billing (M5) --------------------------------------------------------------------------------

export const drugId = z.string().min(1).brand<"DrugId">();
export type DrugId = z.output<typeof drugId>;

export const drug = z.object({
  id: drugId,
  generic_name: z.string(),
  brand_name: optionalText,
  form: z.string(),
  strength: z.string(),
  default_dose: z.string(),
  default_frequency: z.string(),
  default_timing: optionalText,
  default_duration_days: count.nullable().exactOptional(),
}) satisfies z.ZodType<C.Drug>;
export type Drug = z.output<typeof drug>;

export const drugList = z.object({ items: z.array(drug) }) satisfies z.ZodType<C.DrugList>;
export type DrugList = z.output<typeof drugList>;

/** Body of `POST /api/v1/drugs/search`. */
export type DrugSearch = C.DrugSearch;

export const priceItemId = z.string().min(1).brand<"PriceItemId">();
export type PriceItemId = z.output<typeof priceItemId>;

export const priceItem = z.object({
  id: priceItemId,
  name: z.string(),
  code: optionalText,
  category: optionalText,
  price_paise: paise,
  taxable: z.boolean(),
  gst_rate: z.number().int(),
  sac_hsn: optionalText,
  active: z.boolean(),
}) satisfies z.ZodType<C.PriceItem>;
export type PriceItem = z.output<typeof priceItem>;

export const priceItemList = z.object({ items: z.array(priceItem) }) satisfies z.ZodType<C.PriceItemList>;
export type PriceItemPage = z.output<typeof priceItemList>;

/** Body of `POST`/`PATCH /api/v1/price-items`. */
export type PriceItemValues = C.PriceItemValues;

export const patientRef = z.object({ id: patientId, name: z.string(), number: patientNumber }) satisfies z.ZodType<C.PatientRef>;
export type PatientRef = z.output<typeof patientRef>;

/** Body of a void with a reason: `POST /invoices/{id}/void`, `POST /payments/{id}/void`. */
export type Reason = C.Reason;

export const invoiceId = z.string().min(1).brand<"InvoiceId">();
export type InvoiceId = z.output<typeof invoiceId>;

export const invoiceStatus = z.enum(["draft", "issued", "void"]) satisfies z.ZodType<C.InvoiceStatus>;
export type InvoiceStatus = z.output<typeof invoiceStatus>;

export const invoiceLine = z.object({
  line_no: z.number().int(),
  description: z.string(),
  price_item_id: priceItemId.nullable().exactOptional(),
  procedure_id: procedureId.nullable().exactOptional(),
  quantity: z.number().int(),
  unit_price_paise: paise,
  discount_paise: paise,
  gst_rate: z.number().int(),
  sac_hsn: optionalText,
  taxable_paise: paise,
  cgst_paise: paise,
  sgst_paise: paise,
  igst_paise: paise,
  total_paise: paise,
}) satisfies z.ZodType<C.InvoiceLine>;
export type InvoiceLine = z.output<typeof invoiceLine>;

export const invoice = z.object({
  id: invoiceId,
  status: invoiceStatus,
  number: optionalText,
  patient: patientRef,
  encounter_id: optionalText,
  items: z.array(invoiceLine),
  subtotal_paise: paise,
  discount_paise: paise,
  taxable_paise: paise,
  cgst_paise: paise,
  sgst_paise: paise,
  igst_paise: paise,
  tax_paise: paise,
  round_off_paise: paise,
  total_paise: paise,
  paid_paise: paise,
  balance_paise: paise,
  payment_state: z.string().nullable().exactOptional(),
  methods: z.array(z.string()),
  notes: optionalText,
  place_of_supply: optionalText,
  doc_type: optionalText,
  recipient: z.record(z.string(), z.unknown()).nullable().exactOptional(),
  supplier: z.record(z.string(), z.unknown()).nullable().exactOptional(),
  replaces_invoice_id: invoiceId.nullable().exactOptional(),
  void_reason: optionalText,
  voided_at: optionalTimestamp,
  created_at: timestamp,
  issued_at: optionalTimestamp,
}) satisfies z.ZodType<C.Invoice>;
export type Invoice = z.output<typeof invoice>;

export const invoiceList = z.object({ items: z.array(invoice) }) satisfies z.ZodType<C.InvoiceList>;
export type InvoicePage = z.output<typeof invoiceList>;

/** A line on `NewInvoice`/`InvoiceEdit`: from a price list entry, or free text. */
export type InvoiceLineInput = C.InvoiceLineInput;
/** Body of `POST /api/v1/invoices`. */
export type NewInvoice = C.NewInvoice;
/** Body of `PATCH /api/v1/invoices/{id}`. */
export type InvoiceEdit = C.InvoiceEdit;

export const paymentId = z.string().min(1).brand<"PaymentId">();
export type PaymentId = z.output<typeof paymentId>;

export const paymentMethod = z.enum(["cash", "upi", "card", "bank"]) satisfies z.ZodType<C.PaymentMethod>;
export type PaymentMethod = z.output<typeof paymentMethod>;

export const allocation = z.object({ invoice_id: invoiceId, amount_paise: paise }) satisfies z.ZodType<C.Allocation>;
export type Allocation = z.output<typeof allocation>;

export const payment = z.object({
  id: paymentId,
  number: z.string(),
  status: z.string(),
  patient: patientRef,
  method: z.string(),
  amount_paise: paise,
  allocated_paise: paise,
  unallocated_paise: paise,
  allocations: z.array(allocation),
  reference: optionalText,
  received_at: timestamp,
  void_reason: optionalText,
}) satisfies z.ZodType<C.Payment>;
export type Payment = z.output<typeof payment>;

export const paymentList = z.object({ items: z.array(payment) }) satisfies z.ZodType<C.PaymentList>;
export type PaymentPage = z.output<typeof paymentList>;

/** Body of `POST /api/v1/payments`; sent with an `Idempotency-Key` header. */
export type NewPayment = C.NewPayment;

export const dayTotal = z.object({ date, amount_paise: paise, payments: count }) satisfies z.ZodType<C.DayTotal>;
export type DayTotal = z.output<typeof dayTotal>;

export const methodTotal = z.object({
  method: z.string(),
  amount_paise: paise,
  payments: count,
  share_bps: z.number().int(),
}) satisfies z.ZodType<C.MethodTotal>;
export type MethodTotal = z.output<typeof methodTotal>;

export const mixItem = z.object({ category: z.string(), amount_paise: paise, share_bps: z.number().int() }) satisfies z.ZodType<C.MixItem>;
export type MixItem = z.output<typeof mixItem>;

export const collections = z.object({
  from: date,
  to: date,
  collected_paise: paise,
  invoiced_paise: paise,
  outstanding_paise: paise,
  invoices: count,
  payments: count,
  by_day: z.array(dayTotal),
  by_week: z.array(dayTotal),
  by_method: z.array(methodTotal),
  revenue_mix: z.array(mixItem),
}) satisfies z.ZodType<C.Collections>;
export type Collections = z.output<typeof collections>;

export const agingBuckets = z.object({
  "0_30": count,
  "31_60": count,
  "61_90": count,
  "90_plus": count,
}) satisfies z.ZodType<C.AgingBuckets>;
export type AgingBuckets = z.output<typeof agingBuckets>;

export const pendingItem = z.object({
  invoice_id: invoiceId,
  number: optionalText,
  patient: patientRef,
  total_paise: paise,
  paid_paise: paise,
  balance_paise: paise,
  issued_at: optionalTimestamp,
  age_days: z.number().int(),
  bucket: z.string(),
}) satisfies z.ZodType<C.PendingItem>;
export type PendingItem = z.output<typeof pendingItem>;

export const pendingReport = z.object({
  outstanding_paise: paise,
  patients: count,
  buckets: agingBuckets,
  items: z.array(pendingItem),
}) satisfies z.ZodType<C.PendingReport>;
export type PendingReport = z.output<typeof pendingReport>;

export const todayMoney = z.object({
  date,
  collected_paise: paise,
  collected_this_month_paise: paise,
  invoiced_paise: paise,
  invoices_today: count,
  payments_today: count,
  pending_dues_paise: paise,
  pending_dues_patients: count,
  pending: z.array(pendingItem),
  revenue_mix: z.array(mixItem),
  upi_share_bps: z.number().int(),
}) satisfies z.ZodType<C.TodayMoney>;
export type TodayMoney = z.output<typeof todayMoney>;

// Prescriptions (M5) ----------------------------------------------------------------------------

export const prescriptionId = z.string().min(1).brand<"PrescriptionId">();
export type PrescriptionId = z.output<typeof prescriptionId>;

export const prescriptionStatus = z.enum(["draft", "issued", "cancelled"]) satisfies z.ZodType<C.PrescriptionStatus>;
export type PrescriptionStatus = z.output<typeof prescriptionStatus>;

export const alertSeverity = z.enum(["info", "caution", "serious"]) satisfies z.ZodType<C.AlertSeverity>;
export type AlertSeverity = z.output<typeof alertSeverity>;

export const alert = z.object({
  kind: z.string(),
  severity: z.string(),
  message: z.string(),
  line_no: z.number().int().nullable().exactOptional(),
  action: optionalText,
  override_reason: optionalText,
}) satisfies z.ZodType<C.Alert>;
export type Alert = z.output<typeof alert>;

export const rxItem = z.object({
  drug_id: drugId.nullable().exactOptional(),
  drug_name: optionalText,
  form: optionalText,
  strength: optionalText,
  dose: optionalText,
  frequency: optionalText,
  timing: optionalText,
  duration_days: count.nullable().exactOptional(),
  instructions: optionalText,
}) satisfies z.ZodType<C.RxItem>;
export type RxItem = z.output<typeof rxItem>;

/** Body of `POST`/`PATCH` of a draft prescription. */
export type RxValues = C.RxValues;

export const printData = z.object({
  letterhead: z.record(z.string(), z.unknown()),
  doctor: z.record(z.string(), z.unknown()),
  patient: z.record(z.string(), z.unknown()),
  footer: optionalText,
  verify_path: z.string(),
  brand_line: z.string(),
}) satisfies z.ZodType<C.PrintData>;
export type PrintData = z.output<typeof printData>;

export const prescription = z.object({
  id: prescriptionId,
  status: prescriptionStatus,
  number: optionalText,
  patient: patientRef,
  encounter_id: optionalText,
  diagnosis_text: optionalText,
  items: z.array(rxItem),
  advice: optionalText,
  follow_up_on: optionalText,
  language: z.string(),
  alerts: z.array(alert),
  override_reason: optionalText,
  supersedes_id: prescriptionId.nullable().exactOptional(),
  superseded_by: prescriptionId.nullable().exactOptional(),
  cancel_reason: optionalText,
  cancelled_at: optionalTimestamp,
  created_at: timestamp,
  issued_at: optionalTimestamp,
  print: printData.nullable().exactOptional(),
}) satisfies z.ZodType<C.Prescription>;
export type Prescription = z.output<typeof prescription>;

export const prescriptionList = z.object({ items: z.array(prescription) }) satisfies z.ZodType<C.PrescriptionList>;
export type PrescriptionPage = z.output<typeof prescriptionList>;

/** Body of `POST /api/v1/prescriptions/{id}/issue`. */
export type IssueRequest = C.IssueRequest;

export const issueBlocked = z.object({ code: z.string(), alerts: z.array(alert) }) satisfies z.ZodType<C.IssueBlocked>;
export type IssueBlocked = z.output<typeof issueBlocked>;

/** Body of `POST /api/v1/prescriptions/{id}/cancel`. */
export type CancelRequest = C.CancelRequest;

export const cancelled = z.object({
  cancelled: prescription,
  draft: prescription.nullable().exactOptional(),
}) satisfies z.ZodType<C.Cancelled>;
export type Cancelled = z.output<typeof cancelled>;

export const shareLink = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  pin: z.string().min(1),
  expires_at: timestamp,
}) satisfies z.ZodType<C.ShareLink>;
export type ShareLink = z.output<typeof shareLink>;

export const sharedPreview = z.object({
  resource: z.string(),
  state: z.string(),
  clinic_name: z.string(),
  expires_at: timestamp,
}) satisfies z.ZodType<C.SharedPreview>;
export type SharedPreview = z.output<typeof sharedPreview>;

/** Body of `POST /api/v1/shared/{token}/open`. */
export type OpenRequest = C.OpenRequest;

export const verification = z.object({
  status: z.string(),
  number: optionalText,
  clinic_name: z.string(),
  issued_on: optionalText,
}) satisfies z.ZodType<C.Verification>;
export type Verification = z.output<typeof verification>;

// Requests -----------------------------------------------------------------------------------

/** Body of `POST /api/v1/patients`. */
export type NewPatient = C.NewPatient;

/** Body of `POST /api/v1/console/clinics`. */
export type NewClinic = C.NewClinic;

/** Body of `POST /api/v1/invitations/accept`. */
export type AcceptInvitation = C.AcceptInvitation;
