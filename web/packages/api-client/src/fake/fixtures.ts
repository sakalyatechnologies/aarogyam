/**
 * Synthetic data for the fake client, matching the API's development seed: the same people
 * (by auth_uid), the same two fictional clinics and hosts, plus about sixty patients, a day's
 * schedule, console-only clinics and test results. Names are random combinations of common
 * names, phones sit in one made-up block and emails use example.com.
 */

import type * as C from "../contract.js";
import type { Permission } from "../permissions.js";
import { DENTAL_REASONS, FEMALE_NAMES, MALE_NAMES, SURNAMES } from "./names.js";
import { createQualityReport } from "./quality.js";
import { createRandom, fakeUuid, type Random } from "./random.js";
import { atLocalTime, localClock } from "./zoned-time.js";

const DAY = 86_400_000;

export interface FakeRole {
  key: string;
  name: string;
  permissions: readonly Permission[];
}

export interface FakeUser {
  id: string;
  display_name: string;
  email?: string;
  /** E.164; served masked. */
  phone?: string;
  /** What signing in as this user shows, for the dev sign-in screen. */
  description: string;
}

/** A Sakalya team member who signs in to the console. */
export interface FakePlatformUser {
  id: string;
  display_name: string;
  email: string;
  role: "owner" | "support" | "onboarding" | "analyst";
  description: string;
}

export interface FakeAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface FakeClinic {
  id: string;
  slug: string;
  name: string;
  /** The clinic host the API resolves this clinic from. */
  host: string;
  /** Whether the edge serves `host` yet; `ready` when absent. New clinics start `pending`. */
  address_status?: "pending" | "ready" | "failed";
  /** Why making `host` work failed. */
  address_error?: string;
  timezone: string;
  specialty: string;
  status: "trial" | "active" | "suspended" | "churned";
  created_at: string;
  /** `SD` in `SD-9`. */
  number_prefix: string;
  branding: { brand: string; mode: "light" | "dark" };
  /** The main branch's address, for `GET /settings/clinic`. */
  address?: FakeAddress;
  /** The main branch's phone. */
  phone?: string | null;
  /** UPI ID shown on bills. */
  upi_id?: string | null;
  legal_name?: string | null;
  gstin?: string | null;
  prescription_footer?: string | null;
  /** Online booking settings; anything left out uses the API's default. */
  online_booking?: Partial<C.OnlineBooking>;
  /** The letterhead settings; anything left out uses the API's default. */
  letterhead?: Partial<Omit<C.Letterhead, "has_image" | "has_logo">>;
  /** Object URLs of the uploaded letterhead image and logo. */
  letterhead_images?: { letterhead?: string; logo?: string };
}

/** A device or browser where a person is signed in, for `GET /me/sessions`. */
export interface FakeSession {
  id: string;
  user_id: string;
  audience: "clinic" | "patient" | "platform";
  created_at: string;
  last_active_at: string;
  expires_at: string;
  revoked: boolean;
}

export interface FakeMembership {
  id: string;
  user_id: string;
  clinic_id: string;
  role: FakeRole;
  /** Defaults to `"active"` when left out. */
  status?: "invited" | "active" | "suspended" | "left";
  joined_at?: string;
}

export interface FakePatient
  extends Omit<C.Patient, "sex" | "status" | "age_years" | "next_appointment" | "balance_paise" | "lifetime_paid_paise" | "recall_due" | "row_version"> {
  clinic_id: string;
  sex: C.Sex;
  status: "active" | "inactive" | "deceased" | "merged";
}

/** A chair, room or lab. Fixtures model one branch per clinic, so `branch_id` is the clinic's id. */
export interface FakeRoom {
  id: string;
  clinic_id: string;
  branch_id: string;
  name: string;
  kind: C.RoomKind;
  active: boolean;
  sort_order: number;
}

/** A doctor who sees patients, separate from the `FakeUser`/membership that signs them in. */
export interface FakePractitioner {
  id: string;
  clinic_id: string;
  display_name: string;
  calendar_color: string;
  active: boolean;
  membership_id?: string | null;
  registration_number?: string | null;
  qualifications?: string | null;
  specialty?: string | null;
}

/** One stretch of a doctor's week, local time. */
export interface FakeWorkingShift {
  id: string;
  clinic_id: string;
  practitioner_id: string;
  branch_id: string;
  /** 1 Monday to 7 Sunday. */
  weekday: number;
  starts: string;
  ends: string;
}

export interface FakeLeave {
  id: string;
  clinic_id: string;
  practitioner_id: string;
  starts_at: string;
  ends_at: string;
  reason?: string | null;
}

/** A booked appointment. Status, arrival and completion are worked out once when fixtures build. */
export interface FakeAppointment {
  id: string;
  clinic_id: string;
  branch_id: string;
  patient_id: string;
  practitioner_id: string;
  room_id?: string | null;
  starts_at: string;
  ends_at: string;
  status: C.AppointmentStatus;
  kind: C.AppointmentKind;
  source: C.AppointmentSource;
  reason?: string | null;
  notes?: string | null;
  cancel_reason?: string | null;
  arrived_at?: string | null;
  seated_at?: string | null;
  completed_at?: string | null;
  token_number?: number | null;
  /** The verified person who booked it online, when they did. */
  booked_by_account?: string | null;
}

/** A waiting-room token, issued when a patient (booked or walk-in) arrives. */
export interface FakeQueueToken {
  id: string;
  clinic_id: string;
  branch_id: string;
  day: string;
  token_number: number;
  patient_id: string;
  practitioner_id?: string | null;
  appointment_id?: string | null;
  status: C.QueueTokenStatus;
  issued_at: string;
  called_at?: string | null;
  done_at?: string | null;
}

/** An allergy, server-shaped except for `clinic_id`. */
export interface FakeAllergy {
  id: string;
  clinic_id: string;
  patient_id: string;
  substance: string;
  reaction?: string | null;
  severity: C.Severity;
  status: C.ClinicalStatus;
  source: C.ClinicalSource;
  code?: C.Code | null;
  verified_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeCondition {
  id: string;
  clinic_id: string;
  patient_id: string;
  display_text: string;
  flagged: boolean;
  status: C.ClinicalStatus;
  source: C.ClinicalSource;
  code?: C.Code | null;
  note?: string | null;
  onset?: string | null;
  verified_by?: string | null;
  visit_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeVisit {
  id: string;
  clinic_id: string;
  patient_id: string;
  clinician_membership_id: string;
  number: string;
  appointment_id?: string | null;
  chief_complaint?: string | null;
  status: C.VisitStatus;
  started_at: string;
  ended_at?: string | null;
}

export interface FakeNote {
  id: string;
  clinic_id: string;
  visit_id: string;
  author_membership_id: string;
  kind: C.NoteKind;
  source: C.NoteSource;
  status: C.NoteStatus;
  sections: C.NoteSections;
  addenda: { id: string; author_membership_id: string; body: string; created_at: string }[];
  error_reason?: string | null;
  conflicts_with_id?: string | null;
  signed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeSummaryNote {
  clinic_id: string;
  patient_id: string;
  body: string;
  row_version: number;
  updated_at: string;
  updated_by_membership_id: string;
}

export interface FakeObservation {
  id: string;
  clinic_id: string;
  patient_id: string;
  visit_id?: string | null;
  kind: C.ObservationKind;
  value: number;
  unit: string;
  status: C.ObservationStatus;
  source: C.ClinicalSource;
  supersedes_id?: string | null;
  error_reason?: string | null;
  recorded_at: string;
}

export interface FakeProcedure {
  id: string;
  clinic_id: string;
  patient_id: string;
  visit_id: string;
  clinician_membership_id: string;
  name: string;
  tooth?: number | null;
  surfaces: C.ToothSurface[];
  status: C.ProcedureStatus;
  note?: string | null;
  price_paise?: number | null;
  plan_item_id?: string | null;
  performed_at?: string | null;
  error_reason?: string | null;
  created_at: string;
}

export interface FakePlanItem {
  id: string;
  name: string;
  code?: C.Code | null;
  tooth?: number | null;
  surfaces: C.ToothSurface[];
  phase: number;
  estimate_paise: number;
  status: C.PlanItemStatus;
  procedure_id?: string | null;
}

export interface FakePlan {
  id: string;
  clinic_id: string;
  patient_id: string;
  visit_id?: string | null;
  clinician_membership_id: string;
  title: string;
  status: C.PlanStatus;
  items: FakePlanItem[];
  created_at: string;
  accepted_at?: string | null;
}

export interface FakeChartEntry {
  id: string;
  clinic_id: string;
  patient_id: string;
  tooth: number;
  surface?: C.ToothSurface | null;
  finding: C.ChartFinding;
  /** Term ids: seeded or a FakeDentalTerm's. */
  procedure?: string | null;
  material?: string | null;
  note?: string | null;
  status: C.ChartEntryStatus;
  recorded_by?: string | null;
  supersedes_id?: string | null;
  visit_id?: string | null;
  effective_at: string;
}

export interface FakeAttachment {
  id: string;
  clinic_id: string;
  patient_id: string;
  visit_id?: string | null;
  kind: C.AttachmentKind;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  caption?: string | null;
  label?: string | null;
  tooth?: number | null;
  taken_at?: string | null;
  created_at: string;
  note_id?: string | null;
  addendum_id?: string | null;
  duration_seconds?: number | null;
  language?: string | null;
  /** Shown in the patient's app. */
  shared_with_patient?: boolean;
  /** Where the fake serves its bytes from: a blob URL, since there is no real server. */
  url: string;
}

/** A clinic's application to join Aarogyam, console-only. */
export interface FakeApplication {
  id: string;
  clinic_name: string;
  city: string;
  specialty: string;
  contact_name: string;
  email: string;
  phone?: string | null;
  message?: string | null;
  status: "pending" | "approved" | "rejected";
  submissions: number;
  clinic_id?: string | null;
  decided_at?: string | null;
  decided_by?: string | null;
  decision_reason?: string | null;
  created_at: string;
  updated_at: string;
}

/** Where a clinic buys materials. */
export interface FakeSupplier {
  id: string;
  clinic_id: string;
  name: string;
  phone?: string | null;
  gstin?: string | null;
  active: boolean;
}

/** A material or medicine a clinic keeps in stock. */
export interface FakeInventoryItem {
  id: string;
  clinic_id: string;
  name: string;
  category?: string | null;
  unit: "piece" | "ml" | "g" | "box" | "pack";
  reorder_level: number;
  active: boolean;
}

/** A delivery of an item: how much arrived and how much is left. */
export interface FakeStockBatch {
  id: string;
  clinic_id: string;
  item_id: string;
  supplier_id?: string | null;
  batch_no?: string | null;
  expiry?: string | null;
  received_quantity: number;
  quantity: number;
  unit_cost_paise: number;
  received_on: string;
}

/** One change in stock, per batch touched. Never edited. */
export interface FakeStockMovement {
  id: string;
  clinic_id: string;
  item_id: string;
  batch_id: string;
  kind: "receive" | "use" | "adjust" | "expire";
  quantity: number;
  reason?: string | null;
  at: string;
  by?: string | null;
}

/** A price list entry. */
export interface FakePriceItem {
  id: string;
  clinic_id: string;
  name: string;
  code?: string | null;
  category?: string | null;
  price_paise: number;
  taxable: boolean;
  gst_rate: number;
  sac_hsn?: string | null;
  active: boolean;
}

/** A bill line, as billed (GST split and totals computed when the line is added). */
export interface FakeInvoiceLine {
  line_no: number;
  description: string;
  price_item_id?: string | null;
  procedure_id?: string | null;
  quantity: number;
  unit_price_paise: number;
  discount_paise: number;
  gst_rate: number;
  sac_hsn?: string | null;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
}

/** A bill. Draft totals are a live preview of `items`; issued bills freeze what they printed. */
export interface FakeInvoice {
  id: string;
  clinic_id: string;
  patient_id: string;
  status: "draft" | "issued" | "void";
  number?: string | null;
  encounter_id?: string | null;
  items: FakeInvoiceLine[];
  notes?: string | null;
  place_of_supply?: string | null;
  replaces_invoice_id?: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  created_at: string;
  issued_at?: string | null;
}

/** A payment, with the bills it covers. */
export interface FakePayment {
  id: string;
  clinic_id: string;
  patient_id: string;
  number: string;
  status: "received" | "void";
  method: "cash" | "upi" | "card" | "bank";
  amount_paise: number;
  allocations: { invoice_id: string; amount_paise: number }[];
  reference?: string | null;
  received_at: string;
  void_reason?: string | null;
  idempotency_key: string;
}

/** An entry in the shared medicine catalogue (clinic-agnostic). */
export interface FakeDrug {
  id: string;
  generic_name: string;
  brand_name?: string | null;
  form: string;
  strength: string;
  default_dose: string;
  default_frequency: string;
  default_timing?: string | null;
  default_duration_days?: number | null;
}

/** One medicine on a prescription. */
export interface FakeRxItem {
  drug_id?: string | null;
  drug_name?: string | null;
  form?: string | null;
  strength?: string | null;
  dose?: string | null;
  frequency?: string | null;
  timing?: string | null;
  duration_days?: number | null;
  instructions?: string | null;
}

/** An allergy or other safety alert recorded when a prescription was issued. */
export interface FakeAlert {
  kind: string;
  severity: "info" | "caution" | "serious";
  message: string;
  line_no?: number | null;
  action?: string | null;
  override_reason?: string | null;
}

export interface FakePrescription {
  id: string;
  clinic_id: string;
  patient_id: string;
  status: "draft" | "issued" | "cancelled";
  number?: string | null;
  encounter_id?: string | null;
  diagnosis_text?: string | null;
  items: FakeRxItem[];
  advice?: string | null;
  follow_up_on?: string | null;
  language: string;
  alerts: FakeAlert[];
  override_reason?: string | null;
  supersedes_id?: string | null;
  superseded_by?: string | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  issued_at?: string | null;
  /** The QR code's token, set once issued. */
  verify_token?: string | null;
  issued_by_membership_id?: string | null;
}

/** A patient-facing link to one issued prescription, locked after too many wrong PINs. */
export interface FakeShareLink {
  id: string;
  clinic_id: string;
  prescription_id: string;
  token: string;
  pin: string;
  created_at: string;
  expires_at: string;
  failed_attempts: number;
  locked: boolean;
}

export interface Fixtures {
  users: FakeUser[];
  platformUsers: FakePlatformUser[];
  clinics: FakeClinic[];
  memberships: FakeMembership[];
  patients: FakePatient[];
  rooms: FakeRoom[];
  practitioners: FakePractitioner[];
  workingShifts: FakeWorkingShift[];
  leave: FakeLeave[];
  appointments: FakeAppointment[];
  queueTokens: FakeQueueToken[];
  allergies: FakeAllergy[];
  conditions: FakeCondition[];
  visits: FakeVisit[];
  notes: FakeNote[];
  /** Patient summary notes, made on first save. */
  summaryNotes?: FakeSummaryNote[];
  observations: FakeObservation[];
  procedures: FakeProcedure[];
  chartEntries: FakeChartEntry[];
  /** Procedures and materials clinics added, made on first use. */
  dentalTerms?: import("./dental-terms.js").FakeDentalTerm[];
  plans: FakePlan[];
  attachments: FakeAttachment[];
  sessions: FakeSession[];
  applications: FakeApplication[];
  priceItems: FakePriceItem[];
  suppliers: FakeSupplier[];
  inventoryItems: FakeInventoryItem[];
  stockBatches: FakeStockBatch[];
  stockMovements: FakeStockMovement[];
  invoices: FakeInvoice[];
  payments: FakePayment[];
  drugs: FakeDrug[];
  prescriptions: FakePrescription[];
  shareLinks: FakeShareLink[];
  /** Clinic websites, made on first use. */
  websites?: import("./website.js").FakeSite[];
  websitePhotos?: import("./website.js").FakePhoto[];
  /** First-run setup per clinic and member; with no entry, a person counts as set up already (dismissed). */
  setups?: import("./setup.js").FakeSetup[];
  quality: C.QualityReport;
}

export interface FixtureOptions {
  /** Same seed, same data. */
  seed?: number;
  /** The moment the data is built around; defaults to now. */
  now?: Date;
}

export const ROLES = {
  owner: {
    key: "owner",
    name: "Owner",
    permissions: [
      "patients.read",
      "patients.write",
      "patients.contact",
      "appointments.read",
      "appointments.write",
      "clinical.read",
      "clinical.write",
      "billing.read",
      "billing.write",
      "prescriptions.issue",
      "finance.view",
      "settings.manage",
      "staff.manage",
      "roles.manage",
      "audit.view",
      "reports.export",
      "inventory.read",
      "inventory.manage",
    ],
  },
  doctor: {
    key: "doctor",
    name: "Doctor",
    permissions: [
      "patients.read",
      "patients.write",
      "patients.contact",
      "appointments.read",
      "appointments.write",
      "clinical.read",
      "clinical.write",
      "prescriptions.issue",
      "inventory.read",
    ],
  },
  frontDesk: {
    key: "front_desk",
    name: "Front desk",
    permissions: [
      "patients.read",
      "patients.write",
      "patients.contact",
      "appointments.read",
      "appointments.write",
      "billing.read",
      "billing.write",
      "inventory.read",
      "inventory.manage",
    ],
  },
  assistant: { key: "assistant", name: "Assistant", permissions: ["patients.read", "appointments.read", "clinical.read", "inventory.read"] },
  consultant: { key: "consultant", name: "Visiting consultant", permissions: ["appointments.read", "clinical.read"] },
  finance: {
    key: "finance",
    name: "Finance",
    permissions: ["patients.read", "billing.read", "billing.write", "finance.view", "reports.export"],
  },
} as const satisfies Record<string, FakeRole>;

/** The permission catalogue, as `aarogyam.permissions` seeds it. */
export const PERMISSION_CATALOGUE: readonly { key: Permission; module: string; description: string; scopes: readonly ("all" | "own" | "assigned")[] }[] = [
  { key: "appointments.read", module: "appointments", description: "See the calendar and queue", scopes: ["all", "own", "assigned"] },
  { key: "appointments.write", module: "appointments", description: "Book, move and cancel appointments", scopes: ["all", "own", "assigned"] },
  { key: "audit.view", module: "audit", description: "See the change history and access record", scopes: ["all"] },
  { key: "billing.read", module: "billing", description: "See bills and payments", scopes: ["all"] },
  { key: "billing.write", module: "billing", description: "Create bills and take payments", scopes: ["all"] },
  { key: "clinical.read", module: "clinical", description: "See visits, notes, charts and files", scopes: ["all", "own", "assigned"] },
  { key: "clinical.write", module: "clinical", description: "Record visits, notes, charts and files", scopes: ["all", "own", "assigned"] },
  { key: "finance.view", module: "finance", description: "See revenue, expenses and salaries", scopes: ["all"] },
  { key: "inventory.manage", module: "inventory", description: "Receive, use and adjust stock; edit items and suppliers", scopes: ["all"] },
  { key: "inventory.read", module: "inventory", description: "See stock levels, suppliers and expiry dates", scopes: ["all"] },
  { key: "patients.contact", module: "patients", description: "See full phone numbers and email addresses", scopes: ["all"] },
  { key: "patients.read", module: "patients", description: "See patients and their records", scopes: ["all", "own", "assigned"] },
  { key: "patients.write", module: "patients", description: "Register and edit patients", scopes: ["all"] },
  { key: "prescriptions.issue", module: "prescriptions", description: "Issue and cancel prescriptions", scopes: ["all", "own", "assigned"] },
  { key: "reports.export", module: "reports", description: "Export data to Excel", scopes: ["all"] },
  { key: "roles.manage", module: "roles", description: "Choose what each role can see and do", scopes: ["all"] },
  { key: "settings.manage", module: "settings", description: "Change clinic settings, branding and templates", scopes: ["all"] },
  { key: "staff.manage", module: "staff", description: "Invite staff and change their roles", scopes: ["all"] },
];

/** Builds the full synthetic data set. Deterministic for a given seed and `now`. */
export function createFixtures(options: FixtureOptions = {}): Fixtures {
  const random = createRandom(options.seed ?? 20261003);
  const now = options.now ?? new Date();
  const id = (daysAgo = 400): string => fakeUuid(random, new Date(now.getTime() - daysAgo * DAY));

  // The API's development seed: the same auth_uids sign in through POST /api/v1/dev/token.
  const users = {
    asha: {
      id: "a1a1a1a1-0000-4000-8000-000000000001",
      display_name: "Asha Kulkarni",
      email: "asha.kulkarni@example.com",
      phone: "+919876500011",
      description: "Owner at Sunrise Dental: sees the day's money and every permission.",
    },
    dev: {
      id: "a1a1a1a1-0000-4000-8000-000000000002",
      display_name: "Dr Dev Rao",
      email: "dev.rao@example.com",
      description: "Doctor at Sunrise Dental and visiting consultant at Lotus Dental Care: can switch clinics.",
    },
    farah: {
      id: "a1a1a1a1-0000-4000-8000-000000000003",
      display_name: "Farah Shaikh",
      phone: "+919876500013",
      description: "Front desk at Sunrise Dental: registers and finds patients.",
    },
    bina: {
      id: "b1b1b1b1-0000-4000-8000-000000000001",
      display_name: "Bina Joshi",
      email: "bina.joshi@example.com",
      description: "Owner at Lotus Dental Care.",
    },
  } satisfies Record<string, FakeUser>;

  const sunrise: FakeClinic = {
    id: id(14),
    slug: "sunrise",
    name: "Sunrise Dental",
    host: "sunrise.localtest.me",
    timezone: "Asia/Kolkata",
    branding: { brand: "#14a89a", mode: "light" },
    specialty: "dental",
    status: "trial",
    created_at: isoDaysAgo(now, 14),
    number_prefix: "SD",
    legal_name: "Sunrise Dental Care LLP",
    gstin: "27AAAPL1234C1Z5",
    phone: "+912226581234",
    upi_id: "sunrisedental@okicici",
    address: { line1: "12 Church Road", line2: "Near Bandra Station", city: "Mumbai", state: "Maharashtra", pincode: "400050" },
    prescription_footer: "Sunrise Dental · Open Mon–Sat, 9 AM–7 PM",
  };
  const lotus: FakeClinic = {
    id: id(6),
    slug: "lotus",
    name: "Lotus Dental Care",
    host: "lotus.localtest.me",
    timezone: "Asia/Kolkata",
    branding: { brand: "#db2777", mode: "light" },
    specialty: "dental",
    status: "trial",
    created_at: isoDaysAgo(now, 6),
    number_prefix: "LD",
  };

  const sunriseOwnerMembership = { id: id(), user_id: users.asha.id, clinic_id: sunrise.id, role: ROLES.owner };
  const sunriseDoctorMembership = { id: id(), user_id: users.dev.id, clinic_id: sunrise.id, role: ROLES.doctor };
  const lotusOwnerMembership = { id: id(), user_id: users.bina.id, clinic_id: lotus.id, role: ROLES.owner };

  const memberships: FakeMembership[] = [
    sunriseOwnerMembership,
    sunriseDoctorMembership,
    { id: id(), user_id: users.dev.id, clinic_id: lotus.id, role: ROLES.consultant },
    { id: id(), user_id: users.farah.id, clinic_id: sunrise.id, role: ROLES.frontDesk },
    lotusOwnerMembership,
  ];

  const sunrisePatients = makePatients(random, sunrise, 48, now, 1, 10_000);
  const lotusPatients = makePatients(random, lotus, 12, now, 1, 20_000);

  const sunriseChair1 = makeRoom(random, now, sunrise, "Chair 1", 0);
  const sunriseChair2 = makeRoom(random, now, sunrise, "Chair 2", 1);
  const lotusChair1 = makeRoom(random, now, lotus, "Chair 1", 0);
  const sunriseRooms = [sunriseChair1, sunriseChair2];
  const lotusRooms = [lotusChair1];

  // Asha also sees a few patients at Lotus as a guest dentist, with no membership there.
  const sunriseAsha: FakePractitioner = {
    id: id(),
    clinic_id: sunrise.id,
    display_name: users.asha.display_name,
    calendar_color: "#136650",
    active: true,
    membership_id: sunriseOwnerMembership.id,
    specialty: "Prosthodontics",
  };
  const sunriseDev: FakePractitioner = {
    id: id(),
    clinic_id: sunrise.id,
    display_name: users.dev.display_name,
    calendar_color: "#2563eb",
    active: true,
    membership_id: sunriseDoctorMembership.id,
    specialty: "Orthodontics",
  };
  const lotusBina: FakePractitioner = {
    id: id(),
    clinic_id: lotus.id,
    display_name: users.bina.display_name,
    calendar_color: "#db2777",
    active: true,
    membership_id: lotusOwnerMembership.id,
    specialty: "General dentistry",
  };
  const lotusAsha: FakePractitioner = {
    id: id(),
    clinic_id: lotus.id,
    display_name: users.asha.display_name,
    calendar_color: "#136650",
    active: true,
    membership_id: null,
    specialty: "Prosthodontics",
  };
  const practitioners: FakePractitioner[] = [sunriseAsha, sunriseDev, lotusBina, lotusAsha];

  const workingShifts: FakeWorkingShift[] = [
    ...makeWeeklyShifts(random, now, sunrise, sunriseAsha, "09:00", "18:00"),
    ...makeWeeklyShifts(random, now, sunrise, sunriseDev, "09:00", "18:00"),
    ...makeWeeklyShifts(random, now, lotus, lotusBina, "10:00", "19:00"),
    ...makeWeeklyShifts(random, now, lotus, lotusAsha, "11:00", "13:00"),
  ];

  const leave: FakeLeave[] = [
    {
      id: id(),
      clinic_id: sunrise.id,
      practitioner_id: sunriseDev.id,
      starts_at: isoDaysAhead(now, 10),
      ends_at: isoDaysAhead(now, 12),
      reason: "Conference",
    },
  ];

  const { appointments: sunriseAppointments, queueTokens: sunriseQueueTokens } = makeClinicDay(random, sunrise, sunrisePatients, now, [
    { at: "09:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "09:30", who: sunriseDev, room: sunriseChair2, outcome: "no_show" },
    { at: "10:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "10:30", who: sunriseDev, room: sunriseChair2 },
    { at: "11:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "11:30", who: sunriseDev, room: sunriseChair2 },
    { at: "12:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "12:30", who: sunriseDev, room: sunriseChair2, outcome: "cancelled" },
    { at: "14:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "14:30", who: sunriseDev, room: sunriseChair2 },
    { at: "15:00", who: sunriseAsha, room: sunriseChair1 },
    { at: "16:00", who: sunriseDev, room: sunriseChair2, reason: "Braces review" },
    { at: "16:30", who: sunriseDev, room: sunriseChair2, reason: "Aligner check" },
    { at: "17:00", who: sunriseDev, room: sunriseChair1 },
    { at: "17:30", who: sunriseAsha, room: sunriseChair1 },
  ]);
  const { appointments: lotusAppointments, queueTokens: lotusQueueTokens } = makeClinicDay(random, lotus, lotusPatients, now, [
    { at: "10:00", who: lotusBina, room: lotusChair1 },
    { at: "11:00", who: lotusAsha, room: lotusChair1 },
    { at: "12:00", who: lotusBina, room: lotusChair1 },
    { at: "17:00", who: lotusBina, room: lotusChair1 },
    { at: "18:00", who: lotusBina, room: lotusChair1 },
    { at: "18:30", who: lotusBina, room: lotusChair1 },
  ]);

  const rooms = [...sunriseRooms, ...lotusRooms];
  const appointments = [...sunriseAppointments, ...lotusAppointments];
  const queueTokens = [...sunriseQueueTokens, ...lotusQueueTokens];

  const platformUsers: FakePlatformUser[] = [
    {
      id: "c1c1c1c1-0000-4000-8000-000000000001",
      display_name: "Sakalya Admin",
      email: "admin@sakalya.example",
      role: "owner",
      description: "Sakalya platform owner: clinics, service health and quality.",
    },
  ];

  // A little seeded clinical history: one patient with flags, another with one closed visit.
  const flagPatient = sunrisePatients[2];
  const visitPatient = sunrisePatients[5];

  const allergies: FakeAllergy[] =
    flagPatient === undefined
      ? []
      : [
          {
            id: id(),
            clinic_id: sunrise.id,
            patient_id: flagPatient.id,
            substance: "Penicillin",
            reaction: "Rash and swelling",
            severity: "severe",
            status: "active",
            source: "clinician",
            verified_by: sunriseDoctorMembership.id,
            created_at: isoDaysAgo(now, 120),
            updated_at: isoDaysAgo(now, 120),
          },
        ];

  const conditions: FakeCondition[] =
    flagPatient === undefined
      ? []
      : [
          {
            id: id(),
            clinic_id: sunrise.id,
            patient_id: flagPatient.id,
            display_text: "Type 2 diabetes",
            flagged: true,
            status: "active",
            source: "clinician",
            verified_by: sunriseDoctorMembership.id,
            created_at: isoDaysAgo(now, 200),
            updated_at: isoDaysAgo(now, 200),
          },
        ];

  const pastVisit: FakeVisit | undefined =
    visitPatient === undefined
      ? undefined
      : {
          id: id(),
          clinic_id: sunrise.id,
          patient_id: visitPatient.id,
          clinician_membership_id: sunriseDoctorMembership.id,
          number: "V-1",
          appointment_id: null,
          chief_complaint: "Toothache, lower right",
          status: "closed",
          started_at: isoDaysAgo(now, 30),
          ended_at: isoDaysAgo(now, 30),
        };

  const visits: FakeVisit[] = pastVisit === undefined ? [] : [pastVisit];

  const notes: FakeNote[] =
    pastVisit === undefined
      ? []
      : [
          {
            id: id(),
            clinic_id: sunrise.id,
            visit_id: pastVisit.id,
            author_membership_id: sunriseDoctorMembership.id,
            kind: "soap",
            source: "typed",
            status: "signed",
            sections: {
              subjective: "Pain on chewing, lower right molar.",
              objective: "Caries on 46 distal surface.",
              assessment: "Dental caries, 46.",
              plan: "Composite filling.",
            },
            addenda: [],
            signed_at: pastVisit.ended_at ?? null,
            created_at: pastVisit.started_at,
            updated_at: pastVisit.ended_at ?? pastVisit.started_at,
          },
        ];

  const observations: FakeObservation[] =
    pastVisit === undefined || visitPatient === undefined
      ? []
      : [
          {
            id: id(),
            clinic_id: sunrise.id,
            patient_id: visitPatient.id,
            visit_id: pastVisit.id,
            kind: "pulse",
            value: 76,
            unit: "/min",
            status: "final",
            source: "clinician",
            recorded_at: pastVisit.started_at,
          },
        ];

  const procedures: FakeProcedure[] =
    pastVisit === undefined || visitPatient === undefined
      ? []
      : [
          {
            id: id(),
            clinic_id: sunrise.id,
            patient_id: visitPatient.id,
            visit_id: pastVisit.id,
            clinician_membership_id: sunriseDoctorMembership.id,
            name: "Composite filling",
            tooth: 46,
            surfaces: ["D"],
            status: "done",
            price_paise: 180_000,
            performed_at: pastVisit.ended_at ?? null,
            created_at: pastVisit.started_at,
          },
        ];

  const chartEntries: FakeChartEntry[] =
    pastVisit === undefined || visitPatient === undefined
      ? []
      : [
          {
            id: id(),
            clinic_id: sunrise.id,
            patient_id: visitPatient.id,
            tooth: 46,
            surface: "D",
            finding: "filled",
            procedure: "filling",
            material: "composite",
            status: "current",
            recorded_by: sunriseDoctorMembership.id,
            visit_id: pastVisit.id,
            effective_at: pastVisit.ended_at ?? pastVisit.started_at,
          },
        ];

  const attachments: FakeAttachment[] = [];

  const sessions: FakeSession[] = Object.values(users).flatMap((user): FakeSession[] => [
    {
      id: id(),
      user_id: user.id,
      audience: "clinic",
      created_at: isoDaysAgo(now, 3),
      last_active_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 7 * DAY).toISOString(),
      revoked: false,
    },
    {
      id: id(),
      user_id: user.id,
      audience: "clinic",
      created_at: isoDaysAgo(now, 20),
      last_active_at: isoDaysAgo(now, 9),
      expires_at: isoDaysAgo(now, -1),
      revoked: false,
    },
  ]);

  // Applications to join Aarogyam (console only; unrelated to the seeded clinics above).
  const applications: FakeApplication[] = [
    {
      id: id(),
      clinic_name: "Smile Care Dental",
      city: "Pune",
      specialty: "dental",
      contact_name: "Rohit Deshmukh",
      email: "rohit@smilecare.example",
      phone: "+919876501234",
      message: "We're a two-chair clinic looking to go digital.",
      status: "pending",
      submissions: 1,
      created_at: isoDaysAgo(now, 2),
      updated_at: isoDaysAgo(now, 2),
    },
    {
      id: id(),
      clinic_name: "Riverside Family Dentistry",
      city: "Nashik",
      specialty: "dental",
      contact_name: "Priya Kulkarni",
      email: "priya@riversidedental.example",
      phone: null,
      message: null,
      status: "pending",
      submissions: 2,
      created_at: isoDaysAgo(now, 5),
      updated_at: isoDaysAgo(now, 1),
    },
    {
      id: id(),
      clinic_name: "Wellness General Clinic",
      city: "Nagpur",
      specialty: "general",
      contact_name: "Imran Shaikh",
      email: "imran@wellnessgeneral.example",
      phone: "+919876505678",
      message: "Interested after seeing Sunrise Dental's portal.",
      status: "rejected",
      submissions: 1,
      decided_at: isoDaysAgo(now, 10),
      decided_by: platformUsers[0]?.id ?? null,
      decision_reason: "Outside the dental/general pilot area for now.",
      created_at: isoDaysAgo(now, 14),
      updated_at: isoDaysAgo(now, 10),
    },
  ];

  // Price list (Sunrise only; health-care services are GST-exempt, medicines are taxable).
  const priceItems: FakePriceItem[] = [
    { id: id(), clinic_id: sunrise.id, name: "Consultation", code: "CONS", category: "consultation", price_paise: 50_000, taxable: false, gst_rate: 0, sac_hsn: "9993", active: true },
    { id: id(), clinic_id: sunrise.id, name: "Scaling and polishing", code: "SCAL", category: "preventive", price_paise: 150_000, taxable: false, gst_rate: 0, sac_hsn: "9993", active: true },
    { id: id(), clinic_id: sunrise.id, name: "Composite filling", code: "FILL", category: "restorative", price_paise: 180_000, taxable: false, gst_rate: 0, sac_hsn: "9993", active: true },
    { id: id(), clinic_id: sunrise.id, name: "Root canal treatment", code: "RCT", category: "endodontics", price_paise: 600_000, taxable: false, gst_rate: 0, sac_hsn: "9993", active: true },
    { id: id(), clinic_id: sunrise.id, name: "Tooth extraction", code: "EXT", category: "oral_surgery", price_paise: 120_000, taxable: false, gst_rate: 0, sac_hsn: "9993", active: true },
    { id: id(), clinic_id: sunrise.id, name: "Medicines (dispensed)", code: "MED", category: "medicines", price_paise: 20_000, taxable: true, gst_rate: 12, sac_hsn: "3004", active: true },
  ];

  // Stock (Sunrise): the dashboard's six materials, one with a batch about to expire.
  const dayOn = (days: number): string => new Date(now.getTime() + days * DAY).toISOString().slice(0, 10);
  const suppliers: FakeSupplier[] = [
    { id: id(), clinic_id: sunrise.id, name: "Pune Dental Depot", phone: "+919800010001", gstin: "27AABCP1234F1Z5", active: true },
    { id: id(), clinic_id: sunrise.id, name: "MedSupply Traders", phone: "+919800010002", gstin: null, active: true },
  ];
  const [depot, traders] = suppliers;
  const stockSeed: readonly [name: string, category: string, unit: FakeInventoryItem["unit"], reorder: number, batches: readonly [qty: number, expiryDays: number | null, supplier: FakeSupplier | undefined][]][] = [
    ["Composite A2", "restorative", "piece", 40, [[4, 400, depot]]],
    ["Brackets 022", "ortho", "piece", 30, [[32, null, depot]]],
    ["Implant 4.2×10", "surgical", "piece", 30, [[12, 700, traders]]],
    ["Gloves (box)", "disposables", "box", 50, [[58, 500, traders]]],
    ["Anesthetic cartridges", "anesthesia", "piece", 20, [[10, 21, depot], [12, 300, depot]]],
    ["Polish cups", "disposables", "piece", 40, [[9, null, traders]]],
  ];
  const inventoryItems: FakeInventoryItem[] = [];
  const stockBatches: FakeStockBatch[] = [];
  const stockMovements: FakeStockMovement[] = [];
  for (const [name, category, unit, reorder, batches] of stockSeed) {
    const item: FakeInventoryItem = { id: id(), clinic_id: sunrise.id, name, category, unit, reorder_level: reorder, active: true };
    inventoryItems.push(item);
    for (const [quantity, expiryDays, source] of batches) {
      const batch: FakeStockBatch = {
        id: id(),
        clinic_id: sunrise.id,
        item_id: item.id,
        supplier_id: source?.id ?? null,
        batch_no: null,
        expiry: expiryDays === null ? null : dayOn(expiryDays),
        received_quantity: quantity,
        quantity,
        unit_cost_paise: 2_500,
        received_on: dayOn(-30),
      };
      stockBatches.push(batch);
      stockMovements.push({ id: id(), clinic_id: sunrise.id, item_id: item.id, batch_id: batch.id, kind: "receive", quantity, reason: null, at: isoDaysAgo(now, 30), by: users.asha.id });
    }
  }

  function invoiceLine(input: { price_item_id?: string | null; description: string; quantity: number; unit_price_paise: number; gst_rate: number; taxable: boolean; line_no: number }): FakeInvoiceLine {
    const taxablePaise = input.taxable ? input.quantity * input.unit_price_paise : 0;
    const tax = Math.round(taxablePaise * (input.gst_rate / 100));
    const cgst = Math.round(tax / 2);
    const sgst = tax - cgst;
    return {
      line_no: input.line_no,
      description: input.description,
      price_item_id: input.price_item_id ?? null,
      procedure_id: null,
      quantity: input.quantity,
      unit_price_paise: input.unit_price_paise,
      discount_paise: 0,
      gst_rate: input.gst_rate,
      sac_hsn: null,
      taxable_paise: input.quantity * input.unit_price_paise,
      cgst_paise: cgst,
      sgst_paise: sgst,
      igst_paise: 0,
      total_paise: input.quantity * input.unit_price_paise + tax,
    };
  }

  const scaling = priceItems[1];
  const filling = priceItems[2];
  const invoicePatientA = sunrisePatients[0];
  const invoicePatientB = sunrisePatients[1];
  const invoices: FakeInvoice[] = [];
  const payments: FakePayment[] = [];

  if (invoicePatientA !== undefined && scaling !== undefined) {
    const line = invoiceLine({ price_item_id: scaling.id, description: scaling.name, quantity: 1, unit_price_paise: scaling.price_paise, gst_rate: 0, taxable: false, line_no: 1 });
    const invoice: FakeInvoice = {
      id: id(),
      clinic_id: sunrise.id,
      patient_id: invoicePatientA.id,
      status: "issued",
      number: "SD/26-27/000001",
      items: [line],
      notes: null,
      created_at: isoDaysAgo(now, 6),
      issued_at: isoDaysAgo(now, 6),
    };
    invoices.push(invoice);
    payments.push({
      id: id(),
      clinic_id: sunrise.id,
      patient_id: invoicePatientA.id,
      number: "RC/26-27/000001",
      status: "received",
      method: "upi",
      amount_paise: line.total_paise,
      allocations: [{ invoice_id: invoice.id, amount_paise: line.total_paise }],
      reference: "UPI-REF-001",
      received_at: isoDaysAgo(now, 6),
      idempotency_key: `seed-${invoice.id}`,
    });
  }

  if (invoicePatientB !== undefined && filling !== undefined) {
    const line = invoiceLine({ price_item_id: filling.id, description: filling.name, quantity: 1, unit_price_paise: filling.price_paise, gst_rate: 0, taxable: false, line_no: 1 });
    const invoice: FakeInvoice = {
      id: id(),
      clinic_id: sunrise.id,
      patient_id: invoicePatientB.id,
      status: "issued",
      number: "SD/26-27/000002",
      items: [line],
      notes: null,
      created_at: isoDaysAgo(now, 2),
      issued_at: isoDaysAgo(now, 2),
    };
    invoices.push(invoice);
    const partial = Math.round(line.total_paise / 2);
    payments.push({
      id: id(),
      clinic_id: sunrise.id,
      patient_id: invoicePatientB.id,
      number: "RC/26-27/000002",
      status: "received",
      method: "cash",
      amount_paise: partial,
      allocations: [{ invoice_id: invoice.id, amount_paise: partial }],
      reference: null,
      received_at: isoDaysAgo(now, 2),
      idempotency_key: `seed-${invoice.id}`,
    });
  }

  // A shared medicine catalogue, common dental and general-practice drugs.
  const drugs: FakeDrug[] = [
    { id: id(), generic_name: "AMOXICILLIN", brand_name: "Mox", form: "capsule", strength: "500 mg", default_dose: "1 capsule", default_frequency: "1-1-1", default_timing: "after_food", default_duration_days: 5 },
    { id: id(), generic_name: "METRONIDAZOLE", brand_name: "Flagyl", form: "tablet", strength: "400 mg", default_dose: "1 tablet", default_frequency: "1-1-1", default_timing: "after_food", default_duration_days: 5 },
    { id: id(), generic_name: "IBUPROFEN", brand_name: "Brufen", form: "tablet", strength: "400 mg", default_dose: "1 tablet", default_frequency: "1-0-1", default_timing: "after_food", default_duration_days: 3 },
    { id: id(), generic_name: "PARACETAMOL", brand_name: "Crocin", form: "tablet", strength: "650 mg", default_dose: "1 tablet", default_frequency: "1-1-1", default_timing: "after_food", default_duration_days: 3 },
    { id: id(), generic_name: "DICLOFENAC", brand_name: "Voveran", form: "tablet", strength: "50 mg", default_dose: "1 tablet", default_frequency: "1-0-1", default_timing: "after_food", default_duration_days: 3 },
    { id: id(), generic_name: "AZITHROMYCIN", brand_name: "Azithral", form: "tablet", strength: "500 mg", default_dose: "1 tablet", default_frequency: "1-0-0", default_timing: "after_food", default_duration_days: 3 },
    { id: id(), generic_name: "CHLORHEXIDINE", brand_name: "Hexidine", form: "mouthwash", strength: "0.2%", default_dose: "10 ml rinse", default_frequency: "0-0-2", default_timing: "after_food", default_duration_days: 7 },
    { id: id(), generic_name: "KETOROLAC", brand_name: "Ketorol", form: "tablet", strength: "10 mg", default_dose: "1 tablet", default_frequency: "1-0-1", default_timing: "after_food", default_duration_days: 3 },
    { id: id(), generic_name: "PANTOPRAZOLE", brand_name: "Pantocid", form: "tablet", strength: "40 mg", default_dose: "1 tablet", default_frequency: "1-0-0", default_timing: "before_food", default_duration_days: 5 },
    { id: id(), generic_name: "DOXYCYCLINE", brand_name: "Doxy", form: "capsule", strength: "100 mg", default_dose: "1 capsule", default_frequency: "1-0-1", default_timing: "after_food", default_duration_days: 7 },
    { id: id(), generic_name: "CETIRIZINE", brand_name: "Cetrizine", form: "tablet", strength: "10 mg", default_dose: "1 tablet", default_frequency: "0-0-1", default_timing: "bedtime", default_duration_days: 5 },
    { id: id(), generic_name: "CLINDAMYCIN", brand_name: "Clincin", form: "capsule", strength: "300 mg", default_dose: "1 capsule", default_frequency: "1-1-1", default_timing: "after_food", default_duration_days: 5 },
    { id: id(), generic_name: "TRANEXAMIC ACID", brand_name: "Tranexa", form: "tablet", strength: "500 mg", default_dose: "1 tablet", default_frequency: "1-1-1", default_timing: "after_food", default_duration_days: 3 },
    { id: id(), generic_name: "BENZOCAINE GEL", brand_name: "Mucopain", form: "gel", strength: "20%", default_dose: "apply locally", default_frequency: "sos", default_timing: "sos", default_duration_days: null },
    { id: id(), generic_name: "MULTIVITAMIN", brand_name: "Becosules", form: "capsule", strength: "—", default_dose: "1 capsule", default_frequency: "1-0-0", default_timing: "after_food", default_duration_days: 10 },
  ];

  // One issued prescription on the past visit, so Quick Rx and Patient 360 have something to show.
  const amoxicillin = drugs[0];
  const ibuprofen = drugs[2];
  const prescriptions: FakePrescription[] =
    visitPatient === undefined || pastVisit === undefined
      ? []
      : [
          {
            id: id(),
            clinic_id: sunrise.id,
            patient_id: visitPatient.id,
            status: "issued",
            number: "RX-1",
            encounter_id: pastVisit.id,
            diagnosis_text: "Dental caries, 46",
            items: [
              amoxicillin === undefined
                ? { drug_name: "AMOXICILLIN", strength: "500 mg", dose: "1 capsule", frequency: "1-1-1", timing: "after_food", duration_days: 5 }
                : { drug_id: amoxicillin.id, drug_name: amoxicillin.generic_name, form: amoxicillin.form, strength: amoxicillin.strength, dose: amoxicillin.default_dose, frequency: amoxicillin.default_frequency, timing: amoxicillin.default_timing ?? null, duration_days: amoxicillin.default_duration_days ?? null },
              ibuprofen === undefined
                ? { drug_name: "IBUPROFEN", strength: "400 mg", dose: "1 tablet", frequency: "1-0-1", timing: "after_food", duration_days: 3 }
                : { drug_id: ibuprofen.id, drug_name: ibuprofen.generic_name, form: ibuprofen.form, strength: ibuprofen.strength, dose: ibuprofen.default_dose, frequency: ibuprofen.default_frequency, timing: ibuprofen.default_timing ?? null, duration_days: ibuprofen.default_duration_days ?? null },
            ],
            advice: "Soft diet for two days. Avoid chewing on the treated side.",
            follow_up_on: null,
            language: "en-IN",
            alerts: [],
            created_at: pastVisit.started_at,
            issued_at: pastVisit.ended_at ?? pastVisit.started_at,
          },
        ];

  const shareLinks: FakeShareLink[] = [];

  return {
    users: Object.values(users),
    platformUsers,
    clinics: [sunrise, lotus, ...makeConsoleOnlyClinics(random, now)],
    memberships,
    patients: [...sunrisePatients, ...lotusPatients],
    rooms,
    practitioners,
    workingShifts,
    leave,
    appointments,
    queueTokens,
    allergies,
    conditions,
    visits,
    notes,
    observations,
    procedures,
    chartEntries,
    plans: [],
    attachments,
    sessions,
    applications,
    priceItems,
    suppliers,
    inventoryItems,
    stockBatches,
    stockMovements,
    invoices,
    payments,
    drugs,
    prescriptions,
    shareLinks,
    quality: createQualityReport(random, now),
  };
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY).toISOString();
}

function isoDaysAhead(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY).toISOString();
}

function isoDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function pickAge(random: Random): number {
  const band = random.next();
  if (band < 0.15) return random.int(4, 14);
  if (band < 0.4) return random.int(15, 30);
  if (band < 0.75) return random.int(31, 50);
  return random.int(51, 82);
}

function pickLanguage(random: Random): string {
  const roll = random.next();
  if (roll < 0.4) return "en-IN";
  if (roll < 0.75) return "mr-IN";
  if (roll < 0.95) return "hi-IN";
  return "gu-IN";
}

function emailFor(first: string, last: string, random: Random): string {
  const clean = (part: string) => part.toLowerCase().replace(/[^a-z]/g, "");
  return `${clean(first)}.${clean(last)}${String(random.int(1, 99))}@example.com`;
}

function makePatients(
  random: Random,
  clinic: FakeClinic,
  count: number,
  now: Date,
  firstNumber: number,
  phoneBlock: number,
): FakePatient[] {
  const patients: FakePatient[] = [];
  const names = new Set<string>();
  let familyPhone: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const roll = random.next();
    const sex: C.Sex = roll < 0.51 ? "female" : roll < 0.99 ? "male" : "other";
    let fullName = "";
    let first = "";
    let last = "";
    for (let attempt = 0; attempt < 20 && (fullName === "" || names.has(fullName)); attempt += 1) {
      first = random.pick(sex === "male" ? MALE_NAMES : sex === "female" ? FEMALE_NAMES : [...FEMALE_NAMES, ...MALE_NAMES]);
      last = random.pick(SURNAMES);
      fullName = `${first} ${last}`;
    }
    names.add(fullName);

    const age = pickAge(random);
    const createdAt = new Date(now.getTime() - random.int(7, 700) * DAY - random.int(0, 600) * 60_000);
    const estimated = random.chance(0.2);
    const dateOfBirth = estimated
      ? `${String(now.getUTCFullYear() - age)}-01-01`
      : isoDate(new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()) - random.int(1, 360) * DAY));

    // Children often share a parent's number: a phone is contact, never identity.
    const ownPhone = `+919876${String(phoneBlock + index * 37).padStart(6, "0").slice(-6)}`;
    const phone = age < 15 && familyPhone !== undefined && random.chance(0.6) ? familyPhone : random.chance(0.92) ? ownPhone : null;
    if (age >= 18 && phone !== null) {
      familyPhone = phone;
    }

    const visited = random.chance(0.85);
    const lastVisit = visited
      ? new Date(createdAt.getTime() + random.next() * (now.getTime() - DAY - createdAt.getTime())).toISOString()
      : null;

    patients.push({
      clinic_id: clinic.id,
      id: fakeUuid(random, createdAt),
      number: `${clinic.number_prefix}-${String(firstNumber + index)}`,
      full_name: fullName,
      sex,
      date_of_birth: dateOfBirth,
      birth_date_estimated: estimated,
      phone,
      email: age >= 18 && random.chance(0.35) ? emailFor(first, last, random) : null,
      preferred_language: pickLanguage(random),
      status: random.chance(0.96) ? "active" : "inactive",
      created_at: createdAt.toISOString(),
      last_visit_at: lastVisit,
    });
  }
  return patients;
}

function makeRoom(random: Random, now: Date, clinic: FakeClinic, name: string, sortOrder: number): FakeRoom {
  return {
    id: fakeUuid(random, new Date(now.getTime() - (10 - sortOrder) * DAY)),
    clinic_id: clinic.id,
    branch_id: clinic.id,
    name,
    kind: "chair",
    active: true,
    sort_order: sortOrder,
  };
}

function makeWeeklyShifts(
  random: Random,
  now: Date,
  clinic: FakeClinic,
  practitioner: FakePractitioner,
  starts: string,
  ends: string,
): FakeWorkingShift[] {
  return [1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: fakeUuid(random, new Date(now.getTime() - weekday * DAY)),
    clinic_id: clinic.id,
    practitioner_id: practitioner.id,
    branch_id: clinic.id,
    weekday,
    starts,
    ends,
  }));
}

interface SlotPlan {
  at: string;
  who: FakePractitioner;
  room: FakeRoom;
  reason?: string;
  outcome?: "cancelled" | "no_show";
}

/**
 * Builds one clinic day's appointments, with status, arrival and completion worked out once
 * relative to `now`, plus the queue tokens for whoever has arrived (numbered by arrival order).
 */
function makeClinicDay(
  random: Random,
  clinic: FakeClinic,
  patients: readonly FakePatient[],
  now: Date,
  plan: readonly SlotPlan[],
): { appointments: FakeAppointment[]; queueTokens: FakeQueueToken[] } {
  const pool = patients.filter((p) => p.status === "active");
  const { date, minutes: rawClockMinutes } = localClock(now, clinic.timezone);
  const slots = plan.map((slot, index) => {
    const [hours = 9, mins = 0] = slot.at.split(":").map((part) => Number.parseInt(part, 10));
    return { ...slot, index, startMinutes: hours * 60 + mins };
  });
  const first = slots[0]?.startMinutes ?? 540;
  const last = slots.at(-1)?.startMinutes ?? 1080;
  const clockMinutes = Math.min(Math.max(rawClockMinutes, first + 40), last + 20);
  const at = (local: number) => atLocalTime(date, local, clinic.timezone).toISOString();

  let inChair = false;
  let waiting = 0;
  const appointments: FakeAppointment[] = [];
  const arrivals: { appointment: FakeAppointment; arrivedAt: string; seatedAt: string | null; doneAt: string | null }[] = [];

  for (const slot of slots) {
    const reason = slot.reason ?? random.pick(DENTAL_REASONS);
    const patient = pool[(slot.index * 3) % pool.length] ?? random.pick(pool);
    const endMinutes = slot.startMinutes + 30;
    const kind: C.AppointmentKind =
      reason === "Consultation" ? "new" : reason.includes("sitting 2") || reason.includes("review") ? "follow_up" : "procedure";

    let status: C.AppointmentStatus;
    let arrivedAt: number | null = null;
    let seatedAt: number | null = null;
    let completedAt: number | null = null;
    if (slot.outcome === "cancelled") {
      status = "cancelled";
    } else if (endMinutes <= clockMinutes) {
      status = slot.outcome === "no_show" ? "no_show" : "completed";
      if (status === "completed") {
        arrivedAt = slot.startMinutes - 6;
        seatedAt = slot.startMinutes - 3;
        completedAt = endMinutes;
      }
    } else if (!inChair && slot.startMinutes <= clockMinutes) {
      status = "in_chair";
      arrivedAt = slot.startMinutes - 9;
      seatedAt = slot.startMinutes - 2;
      inChair = true;
    } else if (waiting < 2) {
      status = "arrived";
      arrivedAt = clockMinutes - (waiting === 0 ? 12 : 5);
      waiting += 1;
    } else {
      status = slot.index % 3 === 0 ? "booked" : "confirmed";
    }

    const appointment: FakeAppointment = {
      id: fakeUuid(random, new Date(now.getTime() - random.int(1, 20) * DAY)),
      clinic_id: clinic.id,
      branch_id: clinic.id,
      patient_id: patient.id,
      practitioner_id: slot.who.id,
      room_id: slot.room.id,
      starts_at: at(slot.startMinutes),
      ends_at: at(endMinutes),
      status,
      kind,
      source: "front_desk",
      reason,
      arrived_at: arrivedAt === null ? null : at(arrivedAt),
      seated_at: seatedAt === null ? null : at(seatedAt),
      completed_at: completedAt === null ? null : at(completedAt),
      cancel_reason: status === "cancelled" ? "Patient requested" : null,
      token_number: null,
    };
    appointments.push(appointment);
    if (arrivedAt !== null) {
      arrivals.push({
        appointment,
        arrivedAt: at(arrivedAt),
        seatedAt: seatedAt === null ? null : at(seatedAt),
        doneAt: completedAt === null ? null : at(completedAt),
      });
    }
  }

  arrivals.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));
  const queueTokens: FakeQueueToken[] = arrivals.map((entry, index) => {
    const tokenNumber = index + 1;
    entry.appointment.token_number = tokenNumber;
    const tokenStatus: C.QueueTokenStatus =
      entry.appointment.status === "completed" ? "done" : entry.appointment.status === "in_chair" ? "in_chair" : "waiting";
    return {
      id: fakeUuid(random, new Date(entry.arrivedAt)),
      clinic_id: clinic.id,
      branch_id: clinic.id,
      day: date,
      token_number: tokenNumber,
      patient_id: entry.appointment.patient_id,
      practitioner_id: entry.appointment.practitioner_id,
      appointment_id: entry.appointment.id,
      status: tokenStatus,
      issued_at: entry.arrivedAt,
      called_at: entry.seatedAt,
      done_at: entry.doneAt,
    };
  });

  return { appointments, queueTokens };
}

/** Clinics that exist only in the console listing: no staff or patients behind them. */
function makeConsoleOnlyClinics(random: Random, now: Date): FakeClinic[] {
  const rows: readonly [string, string, FakeClinic["status"], number, string][] = [
    ["Dantashree Dental Clinic", "dantashree", "active", 45, "Dr. Rohini Kale"],
    ["Pearl Smile Dental", "pearlsmile", "active", 38, "Dr. Sameer Naik"],
    ["Sparsh Dental Care", "sparsh", "trial", 9, "Dr. Neha Deshmukh"],
    ["Kshitij Dental Studio", "kshitij", "suspended", 60, "Dr. Aditya Thakur"],
    ["Navi Smile Dental", "navismile", "churned", 120, "Dr. Imran Khan"],
    ["Ujjwal Dental Care", "ujjwal", "trial", 2, "Dr. Pallavi Sawant"],
  ];
  return rows.map(([name, slug, status, daysAgo]) => {
    const createdAt = new Date(now.getTime() - daysAgo * DAY - random.int(0, 600) * 60_000);
    return {
      id: fakeUuid(random, createdAt),
      slug,
      name,
      host: `${slug}.localtest.me`,
      timezone: "Asia/Kolkata",
      branding: { brand: "#14a89a", mode: "light" },
      specialty: "dental",
      status,
      created_at: createdAt.toISOString(),
      number_prefix: slug.slice(0, 2).toUpperCase(),
    } satisfies FakeClinic;
  });
}
