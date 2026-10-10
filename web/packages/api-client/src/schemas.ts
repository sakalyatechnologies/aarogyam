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

/** `console_access`: active Sakalya staff, whom central sign-in sends to the console (first, beside any clinics). */
export const meResponse = z.object({ clinics: z.array(myClinic), console_access: z.boolean(), staff_mfa_required: z.boolean() }) satisfies z.ZodType<C.Me>;
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
  /** Bumped on every edit; sent back in `If-Match`. */
  row_version: z.number().int(),
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
  member_count: z.number().int(),
}) satisfies z.ZodType<C.Role>;
export type Role = z.output<typeof role>;

export const rolesResponse = z.object({ items: z.array(role) }) satisfies z.ZodType<C.Roles>;
export type Roles = z.output<typeof rolesResponse>;

const scope = z.enum(["all", "own", "assigned"]);
export type PermissionScope = z.output<typeof scope>;

export const accessCatalogue = z.object({
  permissions: z.array(z.object({ key: z.string(), module: z.string(), description: z.string(), scopes: z.array(scope) })),
  templates: z.array(z.object({ key: z.string(), name: z.string(), description: z.string(), permissions: z.array(rolePermission) })),
}) satisfies z.ZodType<C.AccessCatalogue>;
export type AccessCatalogue = z.output<typeof accessCatalogue>;
export type CataloguePermission = AccessCatalogue["permissions"][number];
export type RoleTemplate = AccessCatalogue["templates"][number];

const roleChange = z.object({
  id: z.string().min(1),
  action: z.enum(["created", "permissions_changed", "deleted"]),
  at: timestamp,
  changed_by: z.string().min(1),
  changed_by_name: optionalText,
  before: z.array(rolePermission),
  after: z.array(rolePermission),
}) satisfies z.ZodType<C.RoleChange>;
export type RoleChange = z.output<typeof roleChange>;

export const roleDetail = z.object({
  id: z.string().min(1),
  key: z.string(),
  name: z.string(),
  description: optionalText,
  is_template: z.boolean(),
  template_key: optionalText,
  editable: z.boolean(),
  permissions: z.array(rolePermission),
  default_permissions: z.array(rolePermission),
  member_count: z.number().int(),
  history: z.array(roleChange),
}) satisfies z.ZodType<C.RoleDetail>;
export type RoleDetail = z.output<typeof roleDetail>;

export const savedRole = z.object({
  id: z.string().min(1),
  key: z.string(),
  name: z.string(),
  description: optionalText,
  is_template: z.boolean(),
  permissions: z.array(rolePermission),
  changed: z.boolean(),
}) satisfies z.ZodType<C.SavedRole>;
export type SavedRole = z.output<typeof savedRole>;

/** Body of `PUT /api/v1/roles/{key}/permissions`: the complete new list. */
export type RolePermissionsUpdate = C.RolePermissionsUpdate;
/** Body of `POST /api/v1/roles`. */
export type NewRole = C.NewRole;

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

export const onlineBooking = z.object({
  enabled: z.boolean(),
  slot_minutes: z.number().int(),
  buffer_minutes: z.number().int(),
  auto_confirm: z.boolean(),
  horizon_days: z.number().int(),
  min_notice_minutes: z.number().int(),
  reminder_minutes: z.number().int(),
}) satisfies z.ZodType<C.OnlineBooking>;
export type OnlineBooking = z.output<typeof onlineBooking>;

export const letterheadTemplate = z.enum(["logo_left", "classic", "modern_band", "minimal_line", "two_doctor", "bilingual"]);
export type LetterheadTemplate = z.output<typeof letterheadTemplate>;

export const letterheadShown = z.object({
  logo: z.boolean(),
  doctors: z.boolean(),
  registration: z.boolean(),
  address: z.boolean(),
  phone: z.boolean(),
  email: z.boolean(),
  timings: z.boolean(),
  gstin: z.boolean(),
}) satisfies z.ZodType<C.LetterheadShown>;
export type LetterheadShown = z.output<typeof letterheadShown>;

export const letterhead = z.object({
  mode: z.enum(["upload", "template"]),
  template: letterheadTemplate,
  accent: optionalText,
  show: letterheadShown,
  local_name: optionalText,
  footer: optionalText,
  email: optionalText,
  timings: optionalText,
  doctor_ids: z.array(practitionerId),
  has_image: z.boolean(),
  has_logo: z.boolean(),
}) satisfies z.ZodType<C.Letterhead>;
export type Letterhead = z.output<typeof letterhead>;

/** Body's `letterhead` part of `PATCH /api/v1/settings/clinic`. */
export type LetterheadChanges = C.LetterheadChanges;

/** Which picture of the letterhead: the full header image, or the logo a design uses. */
export type LetterheadSlot = "letterhead" | "logo";

export const letterheadDocument = z.object({
  clinic: z.object({ name: z.string(), legal_name: optionalText, gstin: optionalText, address, phone: optionalText }),
  brand: optionalText,
  letterhead,
  doctors: z.array(z.object({ name: z.string(), qualifications: optionalText, registration_number: optionalText, specialty: optionalText })),
  image_url: optionalText,
  logo_url: optionalText,
  expires_at: timestamp,
}) satisfies z.ZodType<C.LetterheadDocument>;
export type LetterheadDocument = z.output<typeof letterheadDocument>;

export const clinicSettings = z.object({
  name: z.string(),
  specialty: z.string(),
  legal_name: optionalText,
  gstin: optionalText,
  timezone: z.string(),
  phone: optionalText,
  upi_id: optionalText,
  prescription_footer: optionalText,
  address,
  branding: clinicBranding,
  online_booking: onlineBooking,
  letterhead,
}) satisfies z.ZodType<C.ClinicSettings>;
export type ClinicSettings = z.output<typeof clinicSettings>;

/** The `online_booking` part of `PATCH /api/v1/settings/clinic`. */
export type OnlineBookingChanges = C.OnlineBookingChanges;

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
  "requested",
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
  registration_incomplete: z.boolean().default(false),
}) satisfies z.ZodType<C.PatientBrief>;
export type PatientBrief = z.output<typeof patientBrief>;

export const practitionerBrief = z.object({
  id: practitionerId,
  display_name: z.string(),
  calendar_color: optionalText,
}) satisfies z.ZodType<C.PractitionerBrief>;
export type PractitionerBrief = z.output<typeof practitionerBrief>;

export const appointment = z.object({
  /** Bumped on every edit; sent back in `If-Match`. */
  row_version: z.number().int(),
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
  qualifications: optionalText,
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
  /** The staff membership behind this doctor, when linked: one row per person beside a staff list. */
  member_id: membershipId.nullable().exactOptional(),
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

export const inventoryItemId = z.string().min(1).brand<"InventoryItemId">();
export type InventoryItemId = z.output<typeof inventoryItemId>;

export const supplierId = z.string().min(1).brand<"SupplierId">();
export type SupplierId = z.output<typeof supplierId>;

export const stockBatchId = z.string().min(1).brand<"StockBatchId">();
export type StockBatchId = z.output<typeof stockBatchId>;

/** Where an item's stock stands: out or nearly out, at the reorder level, a batch expiring, or fine. */
export const stockStatus = z.enum(["ok", "low", "critical", "expiring"]);
export type StockStatus = z.output<typeof stockStatus>;

export const stockUnit = z.enum(["piece", "ml", "g", "box", "pack"]);
export type StockUnit = z.output<typeof stockUnit>;

export const lowStockAlert = z.object({
  item_id: inventoryItemId,
  name: z.string(),
  unit: z.string(),
  on_hand: count,
  reorder_level: count,
  status: stockStatus,
}) satisfies z.ZodType<C.LowStockAlert>;
export type LowStockAlert = z.output<typeof lowStockAlert>;

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
  low_stock: z.array(lowStockAlert).nullable().exactOptional(),
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

// Smart import: a clinic's own CSV or Excel file ---------------------------------------------

/** Our fields a column can map to, in the order the mapping step shows them. */
export const importFieldKey = z.enum([
  "full_name",
  "phone",
  "sex",
  "date_of_birth",
  "age_years",
  "email",
  "address",
  "last_visit",
  "file_number",
  "legacy_id",
  "preferred_language",
  "balance",
]);
export type ImportFieldKey = z.output<typeof importFieldKey>;

export const suggestionBasis = z.enum(["saved", "header_and_values", "header", "values", "none"]);
export type SuggestionBasis = z.output<typeof suggestionBasis>;

const columnSuggestion = z.object({
  column: count,
  header: z.string(),
  field: importFieldKey.nullable().exactOptional(),
  confidence: z.number().int().min(0).max(100),
  basis: suggestionBasis,
}) satisfies z.ZodType<C.ColumnSuggestion>;
export type ColumnSuggestion = z.output<typeof columnSuggestion>;

export const importSessionId = z.uuid().brand<"ImportSessionId">();
export type ImportSessionId = z.output<typeof importSessionId>;

export const importSession = z.object({
  id: importSessionId,
  file_name: z.string(),
  kind: z.enum(["csv", "xlsx"]),
  sheets: z.array(z.string()),
  sheet: z.string().nullable().exactOptional(),
  header_row: z.number().int().positive(),
  headers: z.array(z.string()),
  row_count: count,
  sample: z.array(z.array(z.string())),
  suggestions: z.array(columnSuggestion),
  expires_at: timestamp,
}) satisfies z.ZodType<C.ImportSession>;
export type ImportSession = z.output<typeof importSession>;

export const rowChoice = z.enum(["skip", "merge", "import"]);
export type RowChoice = z.output<typeof rowChoice>;

/** Body of the preview and commit of an import session. */
export type ImportChoices = C.ImportChoices;

export const smartImportAction = z.enum(["import", "merge", "skip", "fail", "imported", "merged", "skipped", "failed"]);
export type SmartImportAction = z.output<typeof smartImportAction>;

export const missingDetail = z.enum(["phone", "sex", "date_of_birth"]);
export type MissingDetail = z.output<typeof missingDetail>;

const duplicateRef = z.object({
  patient_id: patientId.nullable().exactOptional(),
  number: patientNumber.nullable().exactOptional(),
  row: z.number().int().positive().nullable().exactOptional(),
}) satisfies z.ZodType<C.DuplicateRef>;

const smartImportRow = z.object({
  row: z.number().int().positive(),
  action: smartImportAction,
  missing: z.array(missingDetail),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  duplicate_of: duplicateRef.nullable().exactOptional(),
  values: z.record(z.string(), z.string()),
  patient_id: patientId.nullable().exactOptional(),
  number: patientNumber.nullable().exactOptional(),
}) satisfies z.ZodType<C.SmartImportRow>;
export type SmartImportRow = z.output<typeof smartImportRow>;

export const smartImportResult = z.object({
  import_id: z.string().min(1).nullable().exactOptional(),
  total: count,
  imported: count,
  incomplete: count,
  merged: count,
  skipped: count,
  failed: count,
  notes: z.array(z.string()),
  rows: z.array(smartImportRow),
}) satisfies z.ZodType<C.SmartImportResult>;
export type SmartImportResult = z.output<typeof smartImportResult>;

export const patientGapId = z.uuid().brand<"PatientGapId">();
export type PatientGapId = z.output<typeof patientGapId>;

const incompletePatient = z.object({
  /** Null for a patient registered here (not imported): nothing to dismiss. */
  id: patientGapId.nullable().exactOptional(),
  patient_id: patientId,
  number: patientNumber,
  full_name: z.string(),
  missing: z.array(missingDetail),
  file_name: z.string().nullable().exactOptional(),
  sheet: z.string().nullable().exactOptional(),
  row: z.number().int().positive().nullable().exactOptional(),
  imported_at: timestamp.nullable().exactOptional(),
}) satisfies z.ZodType<C.IncompletePatient>;
export type IncompletePatient = z.output<typeof incompletePatient>;

export const incompleteList = z.object({ items: z.array(incompletePatient) }) satisfies z.ZodType<C.IncompleteList>;
export type IncompleteList = z.output<typeof incompleteList>;

// Console host -------------------------------------------------------------------------------

export const clinicStatus = z.enum(["trial", "active", "suspended", "churned"]);
export type ClinicStatus = z.output<typeof clinicStatus>;

/** Whether the edge serves a clinic's portal host yet; the outbox job makes it ready. */
export const addressStatus = z.enum(["pending", "ready", "failed"]);
export type AddressStatus = z.output<typeof addressStatus>;

const consoleClinic = z.object({
  id: clinicId,
  slug: z.string().min(1),
  name: z.string(),
  specialty: z.string(),
  status: clinicStatus,
  created_at: timestamp,
  portal_host: optionalText,
  address_status: addressStatus.nullable().exactOptional(),
  active_members: count,
  patients: count,
}) satisfies z.ZodType<C.ConsoleClinic>;
export type ConsoleClinic = z.output<typeof consoleClinic>;

export const consoleClinics = z.object({ items: z.array(consoleClinic) }) satisfies z.ZodType<C.ConsoleClinics>;
export type ConsoleClinicPage = z.output<typeof consoleClinics>;

/** Whether a clinic address is free, with free alternatives (`<name>-<city>`, short suffixes) when it isn't. */
export const slugCheck = z.object({
  slug: z.string(),
  portal_host: z.string(),
  available: z.boolean(),
  problem: optionalText,
  suggestions: z.array(z.string()),
}) satisfies z.ZodType<C.SlugCheck>;
export type SlugCheck = z.output<typeof slugCheck>;

/** What to check: the clinic's name, and the typed address and city when known. */
export interface SlugQuery {
  name: string;
  slug?: string | undefined;
  city?: string | undefined;
}

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

export const metricsRange = z.enum(["1h", "6h", "24h", "7d"]) satisfies z.ZodType<C.MetricsRange>;
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
    timeline_interval_seconds: count.default(60),
    timeline: z
      .array(
        z.object({
          at: timestamp,
          requests: count,
          errors_4xx: count,
          errors_429: count,
          errors_5xx: count,
          p50_ms: millis,
          p95_ms: millis,
          p99_ms: millis,
        }),
      )
      .default([]),
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
export type TimelinePoint = ApiMetrics["timeline"][number];
export type DatabaseMetrics = Metrics["db"];
export type EdgeMetrics = NonNullable<Metrics["edge"]>;

const qualityFailure = z.object({ test: z.string(), message: z.string() }) satisfies z.ZodType<C.QualityFailure>;

const qualitySuite = z.object({
  name: z.string(),
  kind: z.string(),
  passed: count,
  failed: count,
  skipped: count,
  duration_ms: count,
  failures: z.array(qualityFailure),
}) satisfies z.ZodType<C.QualitySuite>;

const qualityRun = z.object({
  run_id: qualityRunId,
  started_at: timestamp,
  finished_at: timestamp,
  environment: z.string(),
  commit: z.string(),
  suites: z.array(qualitySuite),
}) satisfies z.ZodType<C.QualityRun>;

const qualityTrendPoint = z.object({
  run_id: qualityRunId,
  started_at: timestamp,
  pass_rate: z.number().min(0).max(1),
}) satisfies z.ZodType<C.QualityTrendPoint>;

const qualityTrend = z.object({
  name: z.string(),
  kind: z.string(),
  points: z.array(qualityTrendPoint),
}) satisfies z.ZodType<C.QualityTrend>;

const qualityFailingTest = z.object({
  suite: z.string(),
  test: z.string(),
  message: z.string(),
  run_id: qualityRunId,
}) satisfies z.ZodType<C.QualityFailingTest>;

export const qualityReport = z.object({
  runs: z.array(qualityRun),
  trend: z.array(qualityTrend),
  failing: z.array(qualityFailingTest),
}) satisfies z.ZodType<C.QualityReport>;
export type QualityReport = z.output<typeof qualityReport>;
export type QualityFailure = C.QualityFailure;
export type QualitySuite = C.QualitySuite;
export type QualityRun = C.QualityRun;
export type QualityTrendPoint = C.QualityTrendPoint;
export type QualityTrend = C.QualityTrend;
export type QualityFailingTest = C.QualityFailingTest;

/** `POST /api/v1/dev/token` (development builds of the API only). */
export const devTokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
}) satisfies z.ZodType<C.DevTokenResponse>;

/** `POST /api/v1/invitations/accept`: the clinic joined and the new membership. */
export const joined = z.object({ org_id: clinicId, membership_id: membershipId }) satisfies z.ZodType<C.Joined>;
export type Joined = z.output<typeof joined>;

// Central sign-in: the session handoff to a clinic or console host ------------------------------

/** Body of `POST /api/v1/auth/handoff`: the host the signed-in person is going to. */
export type NewHandoff = C.NewHandoff;

/** A one-time code for one host, valid for a minute; send the browser to `redirect_url`. */
export const handoff = z.object({
  code: z.string().min(1),
  host: z.string().min(1),
  expires_at: timestamp,
  redirect_url: z.string().min(1),
}) satisfies z.ZodType<C.Handoff>;
export type Handoff = z.output<typeof handoff>;

/** Body of `POST /api/v1/auth/handoff/redeem`. */
export type RedeemHandoff = C.RedeemHandoff;

/** What signs the person in on this host: a Supabase magic-link token hash, or (locally) a dev token. */
export const handoffSession = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("supabase"), email: z.string().min(1), token_hash: z.string().min(1), access_token: z.null().exactOptional() }),
  z.object({ kind: z.literal("dev"), access_token: z.string().min(1), email: z.null().exactOptional(), token_hash: z.null().exactOptional() }),
]) satisfies z.ZodType<C.HandoffSession>;
export type HandoffSession = z.output<typeof handoffSession>;

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
  /** False for an allergy the patient reported at the desk until a clinician confirms it. */
  confirmed: z.boolean(),
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
  /** Whether the patient was asked: `unknown`, `none_known` ("No known allergies") or `has_allergies`. */
  allergies_reviewed: z.enum(["unknown", "none_known", "has_allergies"]),
}) satisfies z.ZodType<C.ClinicalFlags>;
export type ClinicalFlags = z.output<typeof clinicalFlags>;

// Visits, notes, vitals and procedures (M4) ------------------------------------------------------

/** A member named on a clinical record. Not the staff list's `member`. */
export const memberRef = z.object({ id: membershipId, name: z.string() }) satisfies z.ZodType<C.MemberRef>;
export type MemberRef = z.output<typeof memberRef>;

export const visitStatus = z.enum(["open", "closed"]) satisfies z.ZodType<C.VisitStatus>;
export type VisitStatus = z.output<typeof visitStatus>;

export const visit = z.object({
  id: visitId,
  number: z.string(),
  patient_id: patientId,
  clinician: memberRef,
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
  by: memberRef.nullable().exactOptional(),
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

const addendum = z.object({ id: z.string().min(1), author: memberRef, body: z.string(), created_at: timestamp }) satisfies z.ZodType<C.Addendum>;
export type Addendum = z.output<typeof addendum>;

export const note = z.object({
  /** Bumped on every edit; sent back in `If-Match`. */
  row_version: z.number().int(),
  id: noteId,
  visit_id: visitId,
  author: memberRef,
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

export const summaryNote = z.object({
  /** A strict Markdown subset; render it with `Markdown`, never as HTML. */
  body: z.string(),
  /** Bumped on every change; sent back in `If-Match`. */
  row_version: z.number().int(),
  updated_at: timestamp,
  updated_by: optionalText,
}) satisfies z.ZodType<C.SummaryNote>;
export type SummaryNote = z.output<typeof summaryNote>;

export const visitNote = z.object({
  id: noteId,
  visit_id: visitId,
  visit_number: z.string(),
  kind: noteKind,
  status: noteStatus,
  sections: noteSections,
  author: memberRef,
  signed_at: optionalTimestamp,
  created_at: timestamp,
  updated_at: timestamp,
  row_version: z.number().int(),
  addenda_count: z.number().int(),
}) satisfies z.ZodType<C.VisitNote>;
export type VisitNote = z.output<typeof visitNote>;

export const patientNotes = z.object({
  summary: summaryNote.nullable().exactOptional(),
  visit_notes: z.array(visitNote),
}) satisfies z.ZodType<C.PatientNotes>;
export type PatientNotes = z.output<typeof patientNotes>;

// Notice and consent records (DPDP) ---------------------------------------------------------------

export const consentId = z.uuid().brand<"ConsentId">();
export type ConsentId = z.output<typeof consentId>;
export const consentPurpose = z.enum(["care", "reminders", "promotional", "sharing", "research"]) satisfies z.ZodType<C.ConsentPurpose>;
export type ConsentPurpose = z.output<typeof consentPurpose>;
export const consentMethod = z.enum(["paper", "verbal", "app"]) satisfies z.ZodType<C.ConsentMethod>;
export type ConsentMethod = z.output<typeof consentMethod>;
export const consentStatus = z.enum(["given", "withdrawn"]) satisfies z.ZodType<C.ConsentStatus>;
export type ConsentStatus = z.output<typeof consentStatus>;

export const consent = z.object({
  id: consentId,
  purpose: consentPurpose,
  notice_version: z.string(),
  given_at: timestamp,
  method: consentMethod,
  recorded_by: z.string(),
  status: consentStatus,
  withdrawn_at: optionalTimestamp,
  withdrawn_by: optionalText,
  withdrawn_method: consentMethod.nullable().exactOptional(),
  note: optionalText,
  withdrawal_note: optionalText,
}) satisfies z.ZodType<C.Consent>;
export type Consent = z.output<typeof consent>;

export const consentList = z.object({ items: z.array(consent) }) satisfies z.ZodType<C.ConsentList>;
export type ConsentPage = z.output<typeof consentList>;

/** Body of `POST /api/v1/patients/{id}/consents`. */
export type RecordConsent = C.RecordConsent;
/** Body of `POST /api/v1/consents/{id}/withdraw`. */
export type WithdrawConsent = C.WithdrawConsent;

/** Body of `PUT /api/v1/patients/{id}/summary-note`. */
export type SummaryContent = C.SummaryContent;

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
  clinician: memberRef,
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
  clinician: memberRef,
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

export const attachmentKind = z.enum(["photo", "xray", "report", "document", "audio", "consent"]) satisfies z.ZodType<C.AttachmentKind>;
export type AttachmentKind = z.output<typeof attachmentKind>;

export const attachment = z.object({
  id: attachmentId,
  kind: attachmentKind,
  mime_type: z.string(),
  size_bytes: count,
  sha256: z.string(),
  caption: optionalText,
  /** `OPG`, `Intraoral – upper`, `X-ray`, `Consent` or the clinic's own. */
  label: optionalText,
  tooth: count.nullable().exactOptional(),
  taken_at: optionalTimestamp,
  visit_id: visitId.nullable().exactOptional(),
  created_at: timestamp,
  /** A recording's note. */
  note_id: noteId.nullable().exactOptional(),
  /** The addendum a recording belongs to, when its note is signed. */
  addendum_id: z.string().min(1).nullable().exactOptional(),
  /** A recording's length in seconds. */
  duration_seconds: count.nullable().exactOptional(),
  /** `en-IN`, `hi-IN` or `mr-IN`. */
  language: z.string().nullable().exactOptional(),
  /** Shown in the patient's app; older APIs leave it out. */
  shared_with_patient: z.boolean().default(false),
}) satisfies z.ZodType<C.Attachment>;
export type Attachment = z.output<typeof attachment>;

export const fileSharing = z.object({ shared_with_patient: z.boolean() }) satisfies z.ZodType<C.FileSharing>;

export const patientLinkStatus = z.enum(["pending", "active", "declined", "revoked"]);
export type PatientLinkStatus = z.output<typeof patientLinkStatus>;

export const patientAppLink = z.object({
  id: z.string().min(1),
  status: z.string(),
  linked_via: z.string(),
  account_email: z.string(),
  consented_at: timestamp,
  linked_at: optionalTimestamp,
  revoked_at: optionalTimestamp,
}) satisfies z.ZodType<C.PatientAppLink>;
export type PatientAppLink = z.output<typeof patientAppLink>;

export const patientAppAccess = z.object({
  links: z.array(patientAppLink),
  code_expires_at: optionalTimestamp,
  has_email: z.boolean(),
}) satisfies z.ZodType<C.PatientAppAccess>;
export type PatientAppAccess = z.output<typeof patientAppAccess>;

export const patientAppInvitation = z.object({
  code: z.string().min(1),
  expires_at: timestamp,
  emailed: z.boolean(),
}) satisfies z.ZodType<C.PatientAppInvitation>;
export type PatientAppInvitation = z.output<typeof patientAppInvitation>;

export const patientLinkDecided = z.object({ id: z.string().min(1), status: z.string() }) satisfies z.ZodType<C.PatientLinkDecided>;
export type PatientLinkDecided = z.output<typeof patientLinkDecided>;

export const dentalTermKind = z.enum(["procedure", "material"]) satisfies z.ZodType<C.DentalTermKind>;
export type DentalTermKind = z.output<typeof dentalTermKind>;

/** A procedure or material: seeded (`zirconia`) or the clinic's own (a UUID id, `own`). */
export const dentalTerm = z.object({
  id: z.string().min(1),
  kind: dentalTermKind,
  label: z.string().min(1),
  own: z.boolean(),
  /** Retired: shown on old entries, not offered for new ones. Older servers don't send it. */
  retired: z.boolean().default(false),
}) satisfies z.ZodType<C.DentalTerm>;
export type DentalTerm = z.output<typeof dentalTerm>;
const dentalTermRef = dentalTerm.nullable().exactOptional();

/** Body of `POST /api/v1/dental-terms`. */
export type NewDentalTerm = C.NewDentalTerm;

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
      procedure: dentalTermRef,
      material: dentalTermRef,
      status: z.string(),
      note: optionalText,
      effective_at: timestamp,
      recorded_by: membershipId.nullable().exactOptional(),
      supersedes_id: z.string().min(1).nullable().exactOptional(),
      visit_id: visitId.nullable().exactOptional(),
    }),
  ),
  attachments: z.array(attachment),
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
  procedure: dentalTermRef,
  material: dentalTermRef,
  note: optionalText,
  status: chartEntryStatus,
  recorded_by: membershipId.nullable().exactOptional(),
  supersedes_id: chartEntryId.nullable().exactOptional(),
  visit_id: visitId.nullable().exactOptional(),
  effective_at: timestamp,
}) satisfies z.ZodType<C.ChartEntry>;
export type ChartEntry = z.output<typeof chartEntry>;

export const dentalChart = z.object({
  current: z.array(chartEntry),
  history: z.array(chartEntry),
  terms: z.array(dentalTerm),
}) satisfies z.ZodType<C.DentalChart>;
export type DentalChart = z.output<typeof dentalChart>;

/** Body of `POST /api/v1/patients/{id}/dental-chart`. */
export type NewChartEntries = C.NewChartEntries;

// Patient files (M4) ------------------------------------------------------------------------------

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
  address_status: addressStatus.nullable().exactOptional(),
  address_error: optionalText,
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

export const resentOwnerInvitation = z.object({
  id: invitationId,
  email: z.string(),
  invite_link: z.string().min(1),
  expires_at: timestamp,
}) satisfies z.ZodType<C.ResentOwnerInvitation>;
export type ResentOwnerInvitation = z.output<typeof resentOwnerInvitation>;

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

// Expenses and Analytics ---------------------------------------------------------------------

export const expenseId = z.string().min(1).brand<"ExpenseId">();
export type ExpenseId = z.output<typeof expenseId>;

/** The system categories; stock deliveries count as `material` in analytics automatically. */
export const expenseCategory = z.enum(["salary", "material", "electricity", "lab", "rent", "other"]) satisfies z.ZodType<C.ExpenseCategory>;
export type ExpenseCategory = z.output<typeof expenseCategory>;
export const EXPENSE_CATEGORIES = expenseCategory.options;

export const expense = z.object({
  id: expenseId,
  category: expenseCategory,
  category_name: z.string(),
  spent_on: date,
  amount_paise: paise,
  note: optionalText,
  status: z.string(),
  recorded_by: membershipId,
  created_at: timestamp,
  void_reason: optionalText,
  voided_at: optionalTimestamp,
}) satisfies z.ZodType<C.Expense>;
export type Expense = z.output<typeof expense>;

export const expenseList = z.object({ items: z.array(expense) }) satisfies z.ZodType<C.ExpenseList>;
export type ExpenseList = z.output<typeof expenseList>;

/** Body of `POST /api/v1/expenses`. */
export type NewExpense = C.NewExpense;

export const analyticsBucket = z.enum(["month", "week"]) satisfies z.ZodType<C.AnalyticsBucket>;
export type AnalyticsBucket = z.output<typeof analyticsBucket>;

const chairUtilization = z.object({
  room_id: roomId,
  booked_minutes: count,
  open_minutes: count,
  appointments: count,
  utilization_bps: count,
}) satisfies z.ZodType<C.ChairUtilization>;
export type ChairUtilization = z.output<typeof chairUtilization>;

const categorySpend = z.object({ category: expenseCategory, amount_paise: paise }) satisfies z.ZodType<C.CategorySpend>;
export type CategorySpend = z.output<typeof categorySpend>;

const keyCount = z.object({ key: z.string(), count }) satisfies z.ZodType<C.KeyCount>;
export type KeyCount = z.output<typeof keyCount>;

const analyticsBucketRow = z.object({
  start: date,
  first_day: date,
  last_day: date,
  chair_utilization: z.array(chairUtilization),
  income_paise: paise.nullable().exactOptional(),
  payments: count.nullable().exactOptional(),
  expenses_paise: paise.nullable().exactOptional(),
  expenses: z.array(categorySpend).nullable().exactOptional(),
  stock_purchases_paise: paise.nullable().exactOptional(),
  patients: z.object({ new: count, returning: count }) satisfies z.ZodType<C.PatientMix>,
}) satisfies z.ZodType<C.AnalyticsBucketRow>;
export type AnalyticsBucketRow = z.output<typeof analyticsBucketRow>;

export const analytics = z.object({
  from: date,
  to: date,
  bucket: analyticsBucket,
  open_minutes_per_day: count,
  money_visible: z.boolean(),
  chairs: z.array(
    z.object({ id: roomId, name: z.string(), uses_clinic_hours: z.boolean().default(false) }) satisfies z.ZodType<C.AnalyticsChair>,
  ),
  buckets: z.array(analyticsBucketRow),
  patients: z.object({
    age_bands: z.array(keyCount),
    sex: z.array(keyCount).default([]),
    visit_kinds: z.array(keyCount),
    referral_sources: z.array(keyCount),
  }) satisfies z.ZodType<C.PatientBreakdown>,
  procedures_by_category: z.array(keyCount).default([]),
  chair_time: z
    .object({ treatment: count, consult: count, admin: count })
    .default({ treatment: 0, consult: 0, admin: 0 }) satisfies z.ZodType<C.ChairTimeSplit>,
  visit_sources: z.object({ booked: count, walk_in: count }).default({ booked: 0, walk_in: 0 }) satisfies z.ZodType<C.VisitSources>,
  busy_hours: z.array(
    z.object({ weekday: z.number().int().min(1).max(7), hour: z.number().int().min(0).max(23), visits: count }) satisfies z.ZodType<C.BusyHour>,
  ),
  lab_turnaround: z.object({
    orders_received: count,
    average_days: z.number().min(0).nullable().exactOptional(),
  }) satisfies z.ZodType<C.LabTurnaround>,
}) satisfies z.ZodType<C.Analytics>;
export type Analytics = z.output<typeof analytics>;

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

export const patientMessage = z.object({
  status: z.string(),
  reason: optionalText,
  pin: optionalText,
  expires_at: optionalTimestamp,
}) satisfies z.ZodType<C.PatientMessage>;
export type PatientMessage = z.output<typeof patientMessage>;

/** What issuing returns: the prescription and what happened to the patient's copy. */
export const issuedPrescription = prescription.extend({ patient_message: patientMessage }) satisfies z.ZodType<C.IssuedPrescription>;
export type IssuedPrescription = z.output<typeof issuedPrescription>;

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

// Stock --------------------------------------------------------------------------------------

export const supplier = z.object({
  id: supplierId,
  name: z.string(),
  phone: optionalText,
  gstin: optionalText,
  active: z.boolean(),
}) satisfies z.ZodType<C.Supplier>;
export type Supplier = z.output<typeof supplier>;

export const supplierList = z.object({ items: z.array(supplier) }) satisfies z.ZodType<C.SupplierList>;
export type SupplierPage = z.output<typeof supplierList>;

/** Body of `POST`/`PATCH /api/v1/suppliers`. */
export type SupplierValues = C.SupplierValues;

export const inventoryItem = z.object({
  id: inventoryItemId,
  name: z.string(),
  category: optionalText,
  unit: stockUnit,
  reorder_level: count,
  active: z.boolean(),
}) satisfies z.ZodType<C.InventoryItem>;
export type InventoryItem = z.output<typeof inventoryItem>;

/** Body of `POST`/`PATCH /api/v1/inventory-items`. */
export type InventoryItemValues = C.InventoryItemValues;

export const stockLevel = z.object({
  item: inventoryItem,
  on_hand: count,
  next_expiry: date.nullable().exactOptional(),
  status: stockStatus,
}) satisfies z.ZodType<C.StockLevel>;
export type StockLevel = z.output<typeof stockLevel>;

export const inventoryItemList = z.object({ items: z.array(stockLevel) }) satisfies z.ZodType<C.InventoryItemList>;
export type InventoryItemPage = z.output<typeof inventoryItemList>;

export const stockSummary = z.object({
  counts: z.object({ critical: count, low: count, expiring: count, ok: count }),
  items: z.array(stockLevel),
}) satisfies z.ZodType<C.StockSummary>;
export type StockSummary = z.output<typeof stockSummary>;

export const stockBatch = z.object({
  id: stockBatchId,
  supplier_id: supplierId.nullable().exactOptional(),
  batch_no: optionalText,
  expiry: date.nullable().exactOptional(),
  received_quantity: count,
  quantity: count,
  unit_cost_paise: paise,
  received_on: date,
}) satisfies z.ZodType<C.StockBatch>;
export type StockBatch = z.output<typeof stockBatch>;

export const stockMovementKind = z.enum(["receive", "use", "adjust", "expire"]);

export const stockMovement = z.object({
  id: z.string().min(1),
  batch_id: stockBatchId,
  kind: stockMovementKind,
  quantity: z.number().int(),
  reason: optionalText,
  at: timestamp,
  by: userId.nullable().exactOptional(),
}) satisfies z.ZodType<C.StockMovement>;
export type StockMovement = z.output<typeof stockMovement>;

export const inventoryItemDetail = z.object({
  stock: stockLevel,
  batches: z.array(stockBatch),
  movements: z.array(stockMovement),
}) satisfies z.ZodType<C.InventoryItemDetail>;
export type InventoryItemDetail = z.output<typeof inventoryItemDetail>;

export const stockChange = z.object({
  stock: stockLevel,
  movements: z.array(stockMovement),
}) satisfies z.ZodType<C.StockChange>;
export type StockChange = z.output<typeof stockChange>;

export const expiringBatch = z.object({
  batch_id: stockBatchId,
  item_id: inventoryItemId,
  item_name: z.string(),
  unit: z.string(),
  batch_no: optionalText,
  expiry: date,
  quantity: count,
  days_left: z.number().int(),
}) satisfies z.ZodType<C.ExpiringBatch>;
export type ExpiringBatch = z.output<typeof expiringBatch>;

export const expiringList = z.object({ items: z.array(expiringBatch) }) satisfies z.ZodType<C.ExpiringList>;
export type ExpiringPage = z.output<typeof expiringList>;

/** Bodies of `POST /api/v1/stock/receive`, `/use`, `/adjust` and `/batches/{id}/expire`. */
export type ReceiveStock = C.ReceiveStock;
export type UseStock = C.UseStock;
export type AdjustStock = C.AdjustStock;
export type ExpireBatch = C.ExpireBatch;

// Patient self-booking -------------------------------------------------------------------------------

export const bookableDoctor = z.object({
  id: z.string().min(1),
  name: z.string(),
  specialty: optionalText,
}) satisfies z.ZodType<C.BookableDoctor>;
export type BookableDoctor = z.output<typeof bookableDoctor>;

export const bookingOptions = z.object({
  clinic_name: z.string(),
  timezone: z.string(),
  today: z.string(),
  enabled: z.boolean(),
  slot_minutes: z.number().int(),
  auto_confirm: z.boolean(),
  horizon_days: z.number().int(),
  doctors: z.array(bookableDoctor),
}) satisfies z.ZodType<C.BookingOptions>;
export type BookingOptions = z.output<typeof bookingOptions>;

export const availability = z.object({
  date: z.string(),
  practitioner_id: z.string().min(1),
  slot_minutes: z.number().int(),
  slots: z.array(timestamp),
}) satisfies z.ZodType<C.Availability>;
export type Availability = z.output<typeof availability>;

/** Body of `POST /api/v1/public/bookings`. */
export type NewBooking = C.NewBooking;

export const booked = z.object({
  id: z.string().min(1),
  status: z.enum(["requested", "confirmed"]),
  starts_at: timestamp,
  ends_at: timestamp,
  doctor_name: z.string(),
  clinic_name: z.string(),
}) satisfies z.ZodType<C.Booked>;
export type Booked = z.output<typeof booked>;

// Clinic website ----------------------------------------------------------------------------------

export const siteHero = z.object({ headline: z.string(), subheadline: z.string(), cta_label: z.string() }) satisfies z.ZodType<C.SiteHero>;
export type SiteHero = z.output<typeof siteHero>;

export const siteAbout = z.object({ title: z.string(), body: z.string(), highlights: z.array(z.string()) }) satisfies z.ZodType<C.SiteAbout>;
export type SiteAbout = z.output<typeof siteAbout>;

export const siteReview = z.object({ name: z.string(), rating: z.number().int(), text: z.string() }) satisfies z.ZodType<C.SiteReview>;
export type SiteReview = z.output<typeof siteReview>;

export const siteSocial = z.object({ instagram: z.string(), facebook: z.string(), youtube: z.string() }) satisfies z.ZodType<C.SiteSocial>;
export type SiteSocial = z.output<typeof siteSocial>;

export const siteSeo = z.object({ title: z.string(), description: z.string() }) satisfies z.ZodType<C.SiteSeo>;
export type SiteSeo = z.output<typeof siteSeo>;

export const siteContact = z.object({
  whatsapp: z.string(),
  email: z.string(),
  map_url: z.string(),
  hours_note: z.string(),
}) satisfies z.ZodType<C.SiteContact>;
export type SiteContact = z.output<typeof siteContact>;

export const sitePhoto = z.object({
  id: z.string().min(1),
  kind: z.enum(["logo", "hero", "about", "doctor", "gallery"]),
  url: z.string(),
  alt: optionalText,
}) satisfies z.ZodType<C.SitePhoto>;
export type SitePhoto = z.output<typeof sitePhoto>;

export const siteDoctorProfile = z.object({
  practitioner_id: z.string().min(1),
  qualifications: z.string(),
  bio: z.string(),
  photo_id: z.string().nullable(),
  hidden: z.boolean(),
}) satisfies z.ZodType<C.SiteDoctorProfile>;
export type SiteDoctorProfile = z.output<typeof siteDoctorProfile>;

export const siteServiceNote = z.object({ price_item_id: z.string().min(1), description: z.string() }) satisfies z.ZodType<C.SiteServiceNote>;
export type SiteServiceNote = z.output<typeof siteServiceNote>;

export const siteServices = z.object({
  intro: z.string(),
  show_fees: z.boolean(),
  hidden: z.array(z.string()),
  notes: z.array(siteServiceNote),
}) satisfies z.ZodType<C.SiteServices>;
export type SiteServices = z.output<typeof siteServices>;

export const websiteContent = z.object({
  hero: siteHero,
  about: siteAbout,
  doctors: z.array(siteDoctorProfile),
  services: siteServices,
  reviews: z.array(siteReview),
  contact: siteContact,
  social: siteSocial,
  seo: siteSeo,
}) satisfies z.ZodType<C.WebsiteContent>;
export type WebsiteContent = z.output<typeof websiteContent>;

export const siteDesign = z.object({
  layout: z.enum(["one", "multi"]),
  template: z.string(),
  palette: z.string(),
  fonts: z.string(),
}) satisfies z.ZodType<C.SiteDesign>;
export type SiteDesign = z.output<typeof siteDesign>;

export const siteDay = z.object({ weekday: z.number().int(), spans: z.array(z.array(z.string())) }) satisfies z.ZodType<C.SiteDay>;
export type SiteDay = z.output<typeof siteDay>;

export const siteDoctor = z.object({
  id: z.string().min(1),
  name: z.string(),
  specialty: optionalText,
  qualifications: optionalText,
  bio: optionalText,
  photo: sitePhoto.nullable().exactOptional(),
}) satisfies z.ZodType<C.SiteDoctor>;
export type SiteDoctor = z.output<typeof siteDoctor>;

export const siteService = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: optionalText,
  fee_paise: z.number().int().nullable().exactOptional(),
  description: optionalText,
}) satisfies z.ZodType<C.SiteService>;
export type SiteService = z.output<typeof siteService>;

export const siteAddress = z.object({
  line1: optionalText,
  line2: optionalText,
  city: optionalText,
  state: optionalText,
  pincode: optionalText,
}) satisfies z.ZodType<C.SiteAddress>;
export type SiteAddress = z.output<typeof siteAddress>;

export const siteClinic = z.object({
  name: z.string(),
  brand: optionalText,
  address: siteAddress,
  phone: optionalText,
  whatsapp: optionalText,
  email: optionalText,
  map_url: optionalText,
}) satisfies z.ZodType<C.SiteClinic>;
export type SiteClinic = z.output<typeof siteClinic>;

export const sitePhotos = z.object({
  logo: sitePhoto.nullable().exactOptional(),
  hero: sitePhoto.nullable().exactOptional(),
  about: sitePhoto.nullable().exactOptional(),
  gallery: z.array(sitePhoto),
}) satisfies z.ZodType<C.SitePhotos>;
export type SitePhotos = z.output<typeof sitePhotos>;

/** A clinic's website as the public sees it: the public page data and nothing else. */
export const sitePage = z.object({
  design: siteDesign,
  clinic: siteClinic,
  hours: z.array(siteDay),
  hours_note: optionalText,
  hero: siteHero,
  about: siteAbout,
  doctors: z.array(siteDoctor),
  services_intro: optionalText,
  services: z.array(siteService),
  reviews: z.array(siteReview),
  photos: sitePhotos,
  social: siteSocial,
  seo: siteSeo,
  booking_enabled: z.boolean(),
}) satisfies z.ZodType<C.SitePage>;
export type SitePage = z.output<typeof sitePage>;

export const siteChoice = z.object({
  id: z.string().min(1),
  name: z.string(),
  detail: optionalText,
  fee_paise: z.number().int().nullable().exactOptional(),
}) satisfies z.ZodType<C.SiteChoice>;
export type SiteChoice = z.output<typeof siteChoice>;

export const siteTemplate = z.object({ id: z.string(), palettes: z.array(z.string()) }) satisfies z.ZodType<C.SiteTemplate>;
export type SiteTemplate = z.output<typeof siteTemplate>;

export const siteDomain = z.object({
  custom_domain: optionalText,
  status: z.enum(["none", "pending", "verified", "failed"]),
  verification_token: optionalText,
  checked_at: optionalTimestamp,
  sites_target: z.string(),
  default_address: z.string(),
  address_status: z.enum(["none", "pending", "ready", "failed"]),
  address_error: optionalText,
}) satisfies z.ZodType<C.SiteDomain>;
export type SiteDomain = z.output<typeof siteDomain>;

export const websiteSettings = z.object({
  layout: z.enum(["one", "multi"]),
  template: z.string(),
  palette: z.string(),
  fonts: z.string(),
  content: websiteContent,
  published: z.boolean(),
  published_at: optionalTimestamp,
  domain: siteDomain,
  photos: z.array(sitePhoto),
  preview: sitePage,
  doctors: z.array(siteChoice),
  services: z.array(siteChoice),
  templates: z.array(siteTemplate),
  fonts_available: z.array(z.string()),
}) satisfies z.ZodType<C.WebsiteSettings>;
export type WebsiteSettings = z.output<typeof websiteSettings>;

/** Body of `PATCH /api/v1/settings/website`. Settings left out stay as they are. */
export type WebsiteChanges = C.WebsiteChanges;

/** Body of `PATCH /api/v1/settings/website/photos/{id}`. */
export type PhotoChanges = C.PhotoChanges;

// First-run setup ---------------------------------------------------------------------------------

export const setupStep = z.object({
  key: z.string(),
  status: z.enum(["todo", "done", "skipped"]),
}) satisfies z.ZodType<C.SetupStep>;
export type SetupStep = z.output<typeof setupStep>;

export const setup = z.object({
  standing: z.enum(["new", "in_progress", "complete", "dismissed"]),
  practice: optionalText,
  steps: z.array(setupStep),
}) satisfies z.ZodType<C.Setup>;
export type Setup = z.output<typeof setup>;

/** Body of `PATCH /api/v1/settings/onboarding` and `/api/v1/me/onboarding`. */
export type SetupUpdate = C.SetupUpdate;

// Walk-in fast path ---------------------------------------------------------------------------

/** A registered patient with the phone the desk typed: just enough to say "this is them". */
export const phoneMatch = z.object({
  id: patientId,
  number: z.string(),
  full_name: z.string(),
  age_years: z.number().int().nonnegative().nullable().exactOptional(),
  sex,
}) satisfies z.ZodType<C.PhoneMatch>;
export type PhoneMatch = z.output<typeof phoneMatch>;

export const phoneMatches = z.object({ items: z.array(phoneMatch) }) satisfies z.ZodType<C.PhoneMatches>;
export type PhoneMatchPage = z.output<typeof phoneMatches>;

/** What `POST /api/v1/walk-ins` did. */
export const walkIn = z.object({
  patient,
  registered: z.boolean(),
  token: queueToken,
  allergies_recorded: z.number().int().nonnegative(),
  consents_recorded: z.array(consentPurpose),
}) satisfies z.ZodType<C.WalkIn>;
export type WalkIn = z.output<typeof walkIn>;

/** Body of `POST /api/v1/walk-ins`: `patient` (new) or `patient_id` (registered). */
export type WalkInRequest = C.WalkInRequest;

/** A visit started from a queue token, and the token, now in the chair. */
export const startedVisit = z.object({
  visit,
  token: queueToken,
  created: z.boolean(),
}) satisfies z.ZodType<C.StartedVisit>;
export type StartedVisit = z.output<typeof startedVisit>;

const quickPick = z.object({ id: z.string(), label: z.string() }) satisfies z.ZodType<C.QuickPick>;
const quickTextPick = z.object({ id: z.string(), label: z.string(), text: z.string() }) satisfies z.ZodType<C.QuickTextPick>;

/** The clinic's specialty quick picks: allergies for the desk; complaints, findings, procedures, advice and medicine sets for the doctor. */
export const quickPicks = z.object({
  allergies: z.array(quickPick),
  complaints: z.array(quickTextPick),
  findings: z.array(quickTextPick),
  procedures: z.array(quickPick),
  advice: z.array(quickTextPick),
  medicine_sets: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      items: z.array(
        z.object({
          drug_name: z.string(),
          strength: z.string(),
          form: z.string(),
          dose: z.string(),
          frequency: z.string(),
          timing: z.string().nullable().exactOptional(),
          duration_days: z.number().int().positive().nullable().exactOptional(),
          instructions: z.string().nullable().exactOptional(),
        }),
      ),
    }),
  ),
}) satisfies z.ZodType<C.QuickPicks>;
export type QuickPicks = z.output<typeof quickPicks>;
export type MedicineSet = QuickPicks["medicine_sets"][number];
