/**
 * The API contract, as JSON on the wire.
 *
 * Generated from `docs/api/openapi.json` into `generated/openapi.ts` (`pnpm --filter
 * @aarogyam/api-client generate`). Only three kinds of type are written by hand here:
 * 1. Refinements where the spec leaves an object untyped (metrics `api`, `db` and `edge`).
 * 2. The error body, which the spec does not describe.
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
export type OnlineBooking = Schemas["OnlineBooking"];
export type OnlineBookingChanges = Schemas["OnlineBookingChanges"];
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

export type Sex = "female" | "male" | "other" | "unknown";

// Rooms, practitioners, hours and leave (M3) ---------------------------------------------------

export type Room = Schemas["Room"];
export type RoomFields = Schemas["RoomFields"];
export type RoomList = Schemas["RoomList"];
export type RoomKind = "chair" | "room" | "lab";

export type Practitioner = Schemas["Practitioner"];
export type PractitionerFields = Schemas["PractitionerFields"];
export type PractitionerList = Schemas["PractitionerList"];
export type PractitionerBrief = Schemas["PractitionerBrief"];

export type WorkingHours = Schemas["WorkingHours"];
export type WorkingShift = Schemas["WorkingShift"];

export type Leave = Schemas["Leave"];
export type LeaveList = Schemas["LeaveList"];
export type NewLeave = Schemas["NewLeave"];

// Appointments (M3) -----------------------------------------------------------------------------

export type PatientBrief = Schemas["PatientBrief"];
export type Appointment = Schemas["Appointment"];
export type AppointmentChanges = Schemas["AppointmentChanges"];
export type AppointmentList = Schemas["AppointmentList"];
export type NewAppointmentBody = Schemas["NewAppointmentBody"];
export type BookingWarning = Schemas["BookingWarning"];
export type SavedAppointment = Schemas["SavedAppointment"];
export type StatusChange = Schemas["StatusChange"];
export type StatusChanged = Schemas["StatusChanged"];

/** These replace the web draft's `scheduled`/`in_progress`/`teleconsult` (`docs/decisions.md`, 4 Oct). */
export type AppointmentStatus = "requested" | "booked" | "confirmed" | "arrived" | "in_chair" | "completed" | "cancelled" | "no_show";
export type AppointmentKind = "new" | "follow_up" | "procedure" | "emergency";
export type AppointmentSource = "front_desk" | "phone" | "website" | "app" | "whatsapp";
export type BookingWarningCode = "practitioner_busy" | "practitioner_on_leave" | "outside_working_hours";

// Queue (M3) --------------------------------------------------------------------------------------

export type QueueDay = Schemas["QueueDay"];
export type QueueToken = Schemas["QueueToken"];
export type WalkInBody = Schemas["WalkInBody"];
export type TokenStatusChange = Schemas["TokenStatusChange"];
export type QueueTokenStatus = "waiting" | "in_chair" | "done" | "left";

// Today (M3) --------------------------------------------------------------------------------------

export type TodayResponse = Schemas["TodayResponse"];
export type TodayCounts = Schemas["TodayCounts"];
export type ChairStatus = Schemas["ChairStatus"];
export type ChairAppointment = Schemas["ChairAppointment"];
export type AttentionItem = Schemas["AttentionItem"];
export type AttentionPatient = Schemas["AttentionPatient"];
export type HourBar = Schemas["HourBar"];
export type TeamMemberToday = Schemas["TeamMemberToday"];
export type TodayShift = Schemas["TodayShift"];
export type AttentionKind = "late_arrival" | "long_wait";
export type ChairOccupancy = "in_use" | "free";

// Patient import (M3) --------------------------------------------------------------------------

export type PatientImport = Schemas["PatientImport"];
export type ImportResult = Schemas["ImportResult"];
export type ImportRow = Schemas["ImportRow"];
export type ImportMode = "preview" | "commit";

// Clinical flags: allergies and conditions (M4) --------------------------------------------------

export type Code = Schemas["Code"];
export type CodeSystem = "icd10" | "icd11" | "snomed" | "loinc" | "custom";
export type ClinicalSource = "clinician" | "assistant" | "patient" | "import";
export type ClinicalStatus = "active" | "resolved" | "entered_in_error";
export type Severity = "mild" | "moderate" | "severe";

export type Allergy = Schemas["Allergy"];
export type AllergyFields = Schemas["AllergyFields"];
export type AllergyList = Schemas["AllergyList"];

export type Condition = Schemas["Condition"];
export type ConditionFields = Schemas["ConditionFields"];
export type ConditionList = Schemas["ConditionList"];

export type ClinicalFlags = Schemas["ClinicalFlags"];

// Visits, notes, vitals and procedures (M4) ------------------------------------------------------

export type MemberRef = Schemas["MemberRef"];
export type Visit = Schemas["Visit"];
export type VisitDetail = Schemas["VisitDetail"];
export type VisitList = Schemas["VisitList"];
export type NewVisit = Schemas["NewVisit"];
export type VisitStatus = "open" | "closed";

export type Timeline = Schemas["Timeline"];
export type TimelineEvent = Schemas["TimelineEvent"];
export type TimelineEventKind = "visit" | "note" | "procedure" | "attachment";

export type Note = Schemas["Note"];
export type NoteContent = Schemas["NoteContent"];
export type NoteSections = Schemas["NoteSections"];
export type NoteKind = "soap" | "progress" | "procedure" | "intake" | "front_desk";
export type NoteStatus = "draft" | "signed" | "conflict" | "entered_in_error";
export type NoteSource = "typed" | "voice" | "ai_draft";
export type Addendum = Schemas["Addendum"];
export type NewAddendum = Schemas["NewAddendum"];
export type EnteredInError = Schemas["EnteredInError"];

export type ObservationKind = "bp_systolic" | "bp_diastolic" | "pulse" | "temperature" | "spo2" | "weight" | "height" | "blood_sugar";
export type ObservationStatus = "final" | "corrected" | "entered_in_error";
export type Observation = Schemas["Observation"];
export type ObservationList = Schemas["ObservationList"];
export type NewReading = Schemas["NewReading"];
export type NewReadings = Schemas["NewReadings"];

export type WorkFields = Schemas["WorkFields"];
export type ProcedureStatus = "planned" | "done" | "entered_in_error";
export type Procedure = Schemas["Procedure"];
export type ProcedureList = Schemas["ProcedureList"];
export type NewProcedure = Schemas["NewProcedure"];

export type PlanStatus = "proposed" | "accepted" | "in_progress" | "completed" | "declined";
export type PlanItemStatus = "proposed" | "accepted" | "done" | "cancelled";
export type ToothSurface = "M" | "O" | "D" | "B" | "L";
export type Plan = Schemas["Plan"];
export type PlanItem = Schemas["PlanItem"];
export type PlanList = Schemas["PlanList"];
export type NewPlan = Schemas["NewPlan"];
export type NewPlanItem = Schemas["NewPlanItem"];
export type Acceptance = Schemas["Acceptance"];

// Dental chart (M4) -------------------------------------------------------------------------------

export type ChartFinding =
  | "sound"
  | "caries"
  | "filled"
  | "crown"
  | "missing"
  | "implant"
  | "root_canal"
  | "bridge"
  | "fractured"
  | "watch";
export type ChartEntryStatus = "current" | "superseded" | "entered_in_error";
export type ChartEntry = Schemas["ChartEntry"];
export type DentalChart = Schemas["DentalChart"];
export type NewChartEntry = Schemas["NewChartEntry"];
export type NewChartEntries = Schemas["NewChartEntries"];

// Patient files (M4) ------------------------------------------------------------------------------

export type AttachmentKind = "photo" | "xray" | "report" | "document" | "audio" | "consent";
export type Attachment = Schemas["Attachment"];
export type AttachmentList = Schemas["AttachmentList"];
export type DownloadLink = Schemas["DownloadLink"];

// Onboarding: registration, applications, clinic detail (M2.5) ------------------------------------

export type NewRegistration = Schemas["NewRegistration"];
export type RegistrationReceived = Schemas["RegistrationReceived"];
export type ApplicationStatus = "pending" | "approved" | "rejected";
export type Application = Schemas["Application"];
export type Applications = Schemas["Applications"];
export type ApproveApplication = Schemas["ApproveApplication"];
export type ApprovedApplication = Schemas["ApprovedApplication"];
export type RejectApplication = Schemas["RejectApplication"];

export type ClinicMemberStatus = "invited" | "active" | "suspended" | "left";
export type ClinicMember = Schemas["ClinicMember"];
export type ClinicInvitation = Schemas["ClinicInvitation"];
export type ClinicDetail = Schemas["ClinicDetail"];
export type NewClinicInvitation = Schemas["NewClinicInvitation"];
export type ClinicInvited = Schemas["ClinicInvited"];

// Billing (M5) --------------------------------------------------------------------------------

export type Drug = Schemas["Drug"];
export type DrugList = Schemas["DrugList"];
export type DrugSearch = Schemas["DrugSearch"];

export type PriceItem = Schemas["PriceItem"];
export type PriceItemValues = Schemas["PriceItemValues"];
export type PriceItemList = Schemas["PriceItemList"];

export type PatientRef = Schemas["PatientRef"];
export type Reason = Schemas["Reason"];

// Stock ---------------------------------------------------------------------------------------

export type Supplier = Schemas["Supplier"];
export type SupplierList = Schemas["SupplierList"];
export type SupplierValues = Schemas["SupplierValues"];
export type InventoryItem = Schemas["InventoryItem"];
export type InventoryItemValues = Schemas["ItemValues"];
export type InventoryItemList = Schemas["ItemList"];
export type InventoryItemDetail = Schemas["ItemDetailResponse"];
export type StockLevel = Schemas["StockLevel"];
export type StockCounts = Schemas["StockCountsResponse"];
export type StockSummary = Schemas["StockSummary"];
export type StockBatch = Schemas["StockBatch"];
export type StockMovement = Schemas["StockMovement"];
export type StockChange = Schemas["StockChangeResponse"];
export type ExpiringBatch = Schemas["ExpiringBatch"];
export type ExpiringList = Schemas["ExpiringList"];
export type LowStockAlert = Schemas["LowStockAlert"];
export type ReceiveStock = Schemas["ReceiveBody"];
export type UseStock = Schemas["UseBody"];
export type AdjustStock = Schemas["AdjustBody"];
export type ExpireBatch = Schemas["ExpireBody"];

export type InvoiceStatus = "draft" | "issued" | "void";
export type PaymentState = "unpaid" | "partial" | "paid";
export type PaymentMethod = "cash" | "upi" | "card" | "bank";

export type InvoiceLine = Schemas["InvoiceLine"];
export type InvoiceLineInput = Schemas["InvoiceLineInput"];
export type Invoice = Schemas["Invoice"];
export type InvoiceList = Schemas["InvoiceList"];
export type NewInvoice = Schemas["NewInvoice"];
export type InvoiceEdit = Schemas["InvoiceEdit"];

export type Allocation = Schemas["Allocation"];
export type Payment = Schemas["Payment"];
export type PaymentList = Schemas["PaymentList"];
export type NewPayment = Schemas["NewPayment"];

export type DayTotal = Schemas["DayTotal"];
export type MethodTotal = Schemas["MethodTotal"];
export type MixItem = Schemas["MixItem"];
export type Collections = Schemas["Collections"];
export type AgingBuckets = Schemas["AgingBuckets"];
export type PendingItem = Schemas["PendingItem"];
export type PendingReport = Schemas["PendingReport"];
export type TodayMoney = Schemas["TodayMoney"];

// Prescriptions (M5) ----------------------------------------------------------------------------

export type PrescriptionStatus = "draft" | "issued" | "cancelled";
export type AlertSeverity = "info" | "caution" | "serious";

export type RxItem = Schemas["RxItem"];
export type RxValues = Schemas["RxValues"];
export type PrintData = Schemas["PrintData"];
export type Alert = Schemas["Alert"];
export type Prescription = Schemas["Prescription"];
export type PrescriptionList = Schemas["PrescriptionList"];
export type IssueRequest = Schemas["IssueRequest"];
export type IssueBlocked = Schemas["IssueBlocked"];
export type IssuedPrescription = Schemas["IssuedPrescription"];
export type PatientMessage = Schemas["PatientMessage"];
export type CancelRequest = Schemas["CancelRequest"];
export type Cancelled = Schemas["Cancelled"];
export type ShareLink = Schemas["ShareLink"];
export type SharedPreview = Schemas["SharedPreview"];
export type OpenRequest = Schemas["OpenRequest"];
export type Verification = Schemas["Verification"];

// Patient self-booking (public, on the clinic host) -----------------------------------------------

export type BookableDoctor = Schemas["BookableDoctor"];
export type BookingOptions = Schemas["BookingOptions"];
export type Availability = Schemas["Availability"];
export type NewBooking = Schemas["NewBooking"];
export type Booked = Schemas["Booked"];

// Quality dashboard -----------------------------------------------------------------------------

/** `unit`, `db`, `web` or `e2e`. Kept open (not a literal union) since the recorder names its own
 * suites; the console shows whatever `kind` it recorded. */
export type SuiteKind = string;

export type QualityFailure = Schemas["QualityFailure"];
export type QualitySuite = Schemas["QualitySuite"];
export type QualityRun = Schemas["QualityRun"];
export type QualityTrendPoint = Schemas["QualityTrendPoint"];
export type QualityTrend = Schemas["QualityTrend"];
export type QualityFailingTest = Schemas["QualityFailingTest"];
export type QualityReport = Schemas["QualityReport"];
