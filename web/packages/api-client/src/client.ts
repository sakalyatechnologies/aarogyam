/** The one interface both the HTTP client and the fake client implement. */

import type { ApiResult } from "./result.js";
import type { FileSharing, PatientAppAccess, PatientAppInvitation, PatientLinkDecided } from "./contract.js";
import type { Handoff, HandoffSession, NewHandoff, RedeemHandoff, SlugCheck, SlugQuery } from "./schemas.js";
import type { ImportChoices, ImportSession, ImportSessionId, IncompleteList, PatientGapId, SmartImportResult } from "./schemas.js";
import type { Allergy, MonthSummary, OpenLabOrderPage, PhoneMatchPage, QuickPicks, StartedVisit, WalkIn, WalkInRequest } from "./schemas.js";
import type {
  AcceptInvitation,
  Acceptance,
  AllergyFields,
  AllergyId,
  AllergyPage,
  ApplicationId,
  ApplicationStatus,
  Applications,
  Availability,
  AppointmentChanges,
  AppointmentId,
  AppointmentPage,
  ApproveApplication,
  ApprovedApplication,
  Attachment,
  AttachmentId,
  AttachmentPage,
  Booked,
  BookingOptions,
  SitePage,
  SitePhoto,
  PhotoChanges,
  SetupUpdate,
  Setup,
  WebsiteChanges,
  WebsiteSettings,
  Cancelled,
  CancelRequest,
  ClinicDetail,
  ClinicId,
  ClinicInvited,
  ResentOwnerInvitation,
  ClinicSettings,
  ClinicSettingsChanges,
  Letterhead,
  LetterheadDocument,
  LetterheadSlot,
  ClinicalFlags,
  Collections,
  ConditionFields,
  ConditionPage,
  ConsoleClinicPage,
  CreatedClinic,
  CreatedInvitation,
  DentalChart,
  DentalTerm,
  DownloadLink,
  DrugList,
  DrugSearch,
  ImportResult,
  Invoice,
  InvoiceEdit,
  InvoiceId,
  InvoicePage,
  IssueRequest,
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
  NewBooking,
  NewAddendum,
  NewChartEntries,
  NewDentalTerm,
  NewPlan,
  NewClinic,
  NewClinicInvitation,
  NewInvitation,
  NewInvoice,
  NewLeave,
  NewPatient,
  NewPayment,
  NewProcedure,
  NewReadings,
  NewRegistration,
  NewVisit,
  Note,
  NoteContent,
  NoteId,
  ObservationPage,
  Patient,
  PatientChanges,
  PatientId,
  PlanId,
  PlanPage,
  PatientImport,
  PatientPage,
  Payment,
  PaymentId,
  PaymentPage,
  PendingReport,
  Practitioner,
  PractitionerFields,
  PractitionerId,
  PractitionerPage,
  IssuedPrescription,
  Prescription,
  PrescriptionId,
  PrescriptionPage,
  AdjustStock,
  ExpireBatch,
  ExpiringPage,
  InventoryItem,
  InventoryItemDetail,
  InventoryItemId,
  InventoryItemPage,
  InventoryItemValues,
  ReceiveStock,
  StockBatchId,
  StockChange,
  StockSummary,
  Supplier,
  SupplierId,
  SupplierPage,
  SupplierValues,
  UseStock,
  PriceItem,
  PriceItemId,
  PriceItemPage,
  PriceItemValues,
  Procedure,
  ProcedureId,
  ProcedurePage,
  QualityReport,
  QueueDayPage,
  QueueToken,
  QueueTokenId,
  Reason,
  RegistrationReceived,
  RejectApplication,
  Roles,
  AccessCatalogue,
  RoleDetail,
  RolePermissionsUpdate,
  SavedRole,
  NewRole,
  Room,
  RoomFields,
  RoomId,
  RoomPage,
  RxValues,
  SavedAppointment,
  Session,
  SessionId,
  ShareLink,
  SharedPreview,
  Staff,
  StatusChange,
  StatusChanged,
  FinishedItemStatus,
  Joined,
  PatientNotes,
  ConsentId,
  ConsentPage,
  Consent,
  RecordConsent,
  WithdrawConsent,
  SummaryContent,
  SummaryNote,
  Timeline,
  TodayMoney,
  Analytics,
  AnalyticsBucket,
  Expense,
  ExpenseId,
  ExpenseList,
  NewExpense,
  TokenStatusChange,
  Today,
  Verification,
  Visit,
  VisitDetail,
  VisitId,
  VisitPage,
  WalkInBody,
  WorkingHours,
} from "./schemas.js";

export interface RequestOptions {
  /** Cancels the request, for example when a search term changes. */
  signal?: AbortSignal | undefined;
}

/** Which patients the list shows. Flags only, so nothing personal reaches a URL. */
export interface PatientFilter {
  /** Issued bills with something left to pay; needs `billing.read`. */
  withBalance?: boolean | undefined;
  /** An open recall due on or before today. */
  recallsDue?: boolean | undefined;
  /** Registered this month, in the clinic's time zone. */
  newThisMonth?: boolean | undefined;
}

export interface PatientSearch extends PatientFilter {
  /** Name, clinic number or phone. Sent in the request body, never in a URL. */
  q: string;
  limit?: number | undefined;
}

/** Which clinic day Today shows. */
export interface TodayOptions extends RequestOptions {
  /** Local day, `YYYY-MM-DD`; today when left out. A past day shows what was done, a future day what is booked. */
  date?: string | undefined;
}

/** Narrows the queue. */
export interface QueueOptions extends RequestOptions {
  /** Only this doctor's tokens. */
  practitionerId?: PractitionerId | undefined;
}

export interface DateRange {
  /** First local day, `YYYY-MM-DD`. */
  from: string;
  /** Last local day, `YYYY-MM-DD`; at most 42 days counting both. */
  to: string;
}

/** The Analytics range: up to 731 days, grouped by month (default) or week. */
export interface AnalyticsQuery extends Partial<DateRange> {
  bucket?: AnalyticsBucket | undefined;
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
  /** Any host, signed in: a one-time code that signs the caller in on `host` (a clinic they are a member of, or the console for staff). 404 otherwise. */
  createHandoff(input: NewHandoff, options?: RequestOptions): Promise<ApiResult<Handoff>>;
  /** The target host, signed out: trades a handoff code for a session here. 404 when unknown, used, expired or for another host. */
  redeemHandoff(input: RedeemHandoff, options?: RequestOptions): Promise<ApiResult<HandoffSession>>;

  /** Clinic host: the clinic, its branding, and the caller's role and permissions. */
  getSession(options?: RequestOptions): Promise<ApiResult<Session>>;
  /** Clinic host: recently seen patients. Needs `patients.read`. */
  listPatients(options?: RequestOptions & PatientFilter): Promise<ApiResult<PatientPage>>;
  /** Clinic host: `POST /patients/search`. Needs `patients.read`. */
  searchPatients(search: PatientSearch, options?: RequestOptions): Promise<ApiResult<PatientPage>>;
  /** Clinic host: needs `patients.read`; contact details are masked without `patients.contact`. */
  getPatient(id: PatientId, options?: RequestOptions): Promise<ApiResult<Patient>>;
  /** Clinic host: needs `patients.write`. */
  createPatient(input: NewPatient, options?: RequestOptions): Promise<ApiResult<Patient>>;
  /**
   * Clinic host: a clinic day's schedule, chairs, counts, queue, completed visits, attention list and team. Today unless
   * `options.date` is given. `money` and each completed visit's bill figures arrive only with `finance.view`. Needs `appointments.read`.
   */
  getToday(options?: TodayOptions): Promise<ApiResult<Today>>;
  /** Clinic host: appointments per day for a clinic month (`YYYY-MM`), for the calendar's busy days. Needs `appointments.read`. */
  getMonthSummary(month: string, options?: RequestOptions): Promise<ApiResult<MonthSummary>>;
  /** Clinic host: lab work that still needs something done, soonest due first, with its derived stage and late flag. Needs `labs.read`. */
  listOpenLabOrders(options?: RequestOptions): Promise<ApiResult<OpenLabOrderPage>>;
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
  listQueue(date: string | undefined, options?: QueueOptions): Promise<ApiResult<QueueDayPage>>;
  /** Clinic host: issues a token to a patient without an appointment. Needs `appointments.write`. */
  addWalkIn(input: WalkInBody, options?: RequestOptions): Promise<ApiResult<QueueToken>>;
  /** Clinic host: moves a token along; a token with an appointment moves the appointment too. Needs `appointments.write`. */
  setQueueStatus(id: QueueTokenId, change: TokenStatusChange, options?: RequestOptions): Promise<ApiResult<QueueToken>>;
  /** Clinic host: the doctor sends a waiting patient in (`called`); repeating changes nothing. Needs `clinical.write`. */
  callQueueToken(id: QueueTokenId, options?: RequestOptions): Promise<ApiResult<QueueToken>>;

  /** Clinic host: imports patients from CSV; `preview` saves nothing, `commit` saves the valid rows. Needs `patients.write`. */
  importPatients(input: PatientImport, options?: RequestOptions): Promise<ApiResult<ImportResult>>;
  /** Clinic host: uploads a CSV or Excel file (form field `file`, optional `sheet`) and suggests a field per column. Needs `patients.write`. */
  uploadImportFile(form: FormData, options?: RequestOptions): Promise<ApiResult<ImportSession>>;
  /** Clinic host: checks every row of an uploaded file through the mapping; saves nothing. Needs `patients.write`. */
  previewImport(id: ImportSessionId, choices: ImportChoices, options?: RequestOptions): Promise<ApiResult<SmartImportResult>>;
  /** Clinic host: imports an uploaded file in one transaction; repeating it returns the same result. Needs `patients.write`. */
  commitImport(id: ImportSessionId, choices: ImportChoices, options?: RequestOptions): Promise<ApiResult<SmartImportResult>>;
  /** Clinic host: ends an import session without importing and clears its rows. Needs `patients.write`. */
  discardImport(id: ImportSessionId, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: imported patients still missing details, the front desk's to-do list. Needs `patients.read`. */
  listIncompletePatients(options?: RequestOptions): Promise<ApiResult<IncompleteList>>;
  /** Clinic host: takes a patient off the to-do list. Needs `patients.write`. */
  dismissIncompletePatient(id: PatientGapId, options?: RequestOptions): Promise<ApiResult<void>>;

  /** Clinic host: members, their roles and status, and pending invitations. Needs `staff.manage`. */
  listStaff(options?: RequestOptions): Promise<ApiResult<Staff>>;
  /** Clinic host: invites someone by email. Needs `staff.manage`; only an owner may invite an owner. */
  inviteStaff(input: NewInvitation, options?: RequestOptions): Promise<ApiResult<CreatedInvitation>>;
  /** Clinic host: changes a member's role or status. Needs `staff.manage`. */
  changeStaffMember(membershipId: MembershipId, changes: MemberChanges, options?: RequestOptions): Promise<ApiResult<Member>>;
  /** Clinic host: the clinic's roles and what each may do, for choosing a role. Needs `staff.manage`. */
  listRoles(options?: RequestOptions): Promise<ApiResult<Roles>>;
  /** Clinic host: every permission in plain words, with its scopes, and the standard roles' defaults. Needs `roles.manage`. */
  getAccessCatalogue(options?: RequestOptions): Promise<ApiResult<AccessCatalogue>>;
  /** Clinic host: one role, its defaults, member count and latest changes. Needs `roles.manage`. */
  getRole(key: string, options?: RequestOptions): Promise<ApiResult<RoleDetail>>;
  /** Clinic host: replaces a role's permissions. Needs `roles.manage`; not the owner role, not your own, nothing you don't hold. */
  setRolePermissions(key: string, update: RolePermissionsUpdate, options?: RequestOptions): Promise<ApiResult<SavedRole>>;
  /** Clinic host: a custom role copied from a standard role. Needs `roles.manage`. */
  createRole(input: NewRole, options?: RequestOptions): Promise<ApiResult<RoleDetail>>;
  /** Clinic host: removes a custom role nobody has. Needs `roles.manage`. */
  deleteRole(key: string, options?: RequestOptions): Promise<ApiResult<void>>;

  /** Clinic host: the clinic's profile, GSTIN, address, phone, UPI ID and branding. Needs `settings.manage`. */
  getClinicSettings(options?: RequestOptions): Promise<ApiResult<ClinicSettings>>;
  /** Clinic host: changes the clinic's settings. Needs `settings.manage`. */
  updateClinicSettings(changes: ClinicSettingsChanges, options?: RequestOptions): Promise<ApiResult<ClinicSettings>>;

  /** Clinic host: what a document prints for the clinic: letterhead, details, doctors, image links. Needs `patients.read`. */
  getLetterhead(options?: RequestOptions): Promise<ApiResult<LetterheadDocument>>;
  /** Clinic host: uploads the letterhead image or the logo (PNG or JPEG, up to 2 MB; form field `file`). Needs `settings.manage`. */
  uploadLetterheadImage(slot: LetterheadSlot, form: FormData, options?: RequestOptions): Promise<ApiResult<Letterhead>>;
  /** Clinic host: removes the letterhead image or the logo. Needs `settings.manage`. */
  removeLetterheadImage(slot: LetterheadSlot, options?: RequestOptions): Promise<ApiResult<Letterhead>>;

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
  /** Console host: recent quality runs, each suite's pass-rate trend, and the newest failures. */
  getQuality(limit?: number, options?: RequestOptions): Promise<ApiResult<QualityReport>>;

  /** Clinic host: Patient 360's safety banner. Needs `patients.read`; substances and conditions need `clinical.read`. */
  getClinicalFlags(id: PatientId, options?: RequestOptions): Promise<ApiResult<ClinicalFlags>>;
  /** Clinic host: a patient's allergies, active and severe first. Needs `clinical.read`. */
  listAllergies(id: PatientId, options?: RequestOptions): Promise<ApiResult<AllergyPage>>;
  /** Clinic host: records an allergy. Needs `clinical.write`. */
  addAllergy(id: PatientId, input: AllergyFields, options?: RequestOptions): Promise<ApiResult<AllergyPage["items"][number]>>;
  /** Clinic host: edits an allergy: resolve it, change its severity or reaction. Needs `clinical.write`. */
  editAllergy(id: PatientId, allergyId: AllergyId, input: AllergyFields, options?: RequestOptions): Promise<ApiResult<AllergyPage["items"][number]>>;
  /** Clinic host: a patient's conditions, active first. Needs `clinical.read`. */
  listConditions(id: PatientId, options?: RequestOptions): Promise<ApiResult<ConditionPage>>;
  /** Clinic host: records a condition. Needs `clinical.write`. */
  addCondition(id: PatientId, input: ConditionFields, options?: RequestOptions): Promise<ApiResult<ConditionPage["items"][number]>>;

  /** Clinic host: a patient's visits, notes, procedures and files, newest first. Needs `clinical.read`. */
  getTimeline(id: PatientId, options?: RequestOptions): Promise<ApiResult<Timeline>>;
  /** Clinic host: a patient's consent records (DPDP), newest first. Needs `patients.read`. */
  listConsents(id: PatientId, options?: RequestOptions): Promise<ApiResult<ConsentPage>>;
  /** Clinic host: records that the patient saw the clinic's notice and agreed. Needs `patients.write`. */
  recordConsent(id: PatientId, input: RecordConsent, options?: RequestOptions): Promise<ApiResult<Consent>>;
  /** Clinic host: records that the patient withdrew a consent. Needs `patients.write`. */
  withdrawConsent(id: ConsentId, input: WithdrawConsent, options?: RequestOptions): Promise<ApiResult<Consent>>;
  /** Clinic host: a patient's summary note and visit notes, for Patient 360. Needs `clinical.read`. */
  getPatientNotes(id: PatientId, options?: RequestOptions): Promise<ApiResult<PatientNotes>>;
  /**
   * Clinic host: saves the patient's summary note (the first save creates it). Pass the
   * `row_version` you read as `expectedVersion` to refuse the save (`412`) if it changed since.
   * Needs `clinical.write`.
   */
  savePatientSummaryNote(id: PatientId, content: SummaryContent, expectedVersion?: number, options?: RequestOptions): Promise<ApiResult<SummaryNote>>;
  /** Clinic host: a patient's visits, newest first. Needs `clinical.read`. */
  listVisits(id: PatientId, options?: RequestOptions): Promise<ApiResult<VisitPage>>;
  /** Clinic host: everything recorded in one visit. Needs `clinical.read`. */
  getVisit(id: VisitId, options?: RequestOptions): Promise<ApiResult<VisitDetail>>;
  /** Clinic host: starts a visit. One open visit per appointment. Needs `clinical.write`. */
  startVisit(patientId: PatientId, input: NewVisit, options?: RequestOptions): Promise<ApiResult<Visit>>;
  /** Clinic host: closes a visit. Needs `clinical.write`. */
  closeVisit(id: VisitId, options?: RequestOptions): Promise<ApiResult<Visit>>;

  /** Clinic host: writes a draft clinical note. Needs `clinical.write`. */
  createNote(visitId: VisitId, content: NoteContent, options?: RequestOptions): Promise<ApiResult<Note>>;
  /** Clinic host: replaces a draft's sections (and kind); only its author may. Needs `clinical.write`. */
  editNote(id: NoteId, content: NoteContent, options?: RequestOptions): Promise<ApiResult<Note>>;
  /** Clinic host: signs a note; it can no longer change except by addendum. Needs `clinical.write`. */
  signNote(id: NoteId, options?: RequestOptions): Promise<ApiResult<Note>>;

  /** Clinic host: adds an addendum to a signed note; addenda are never edited or removed. Needs `clinical.write`. */
  addAddendum(id: NoteId, input: NewAddendum, options?: RequestOptions): Promise<ApiResult<Note>>;

  /** Clinic host: records vital signs together. Needs `clinical.write`. */
  recordObservations(visitId: VisitId, input: NewReadings, options?: RequestOptions): Promise<ApiResult<ObservationPage>>;

  /** Clinic host: a patient's procedures, newest first. Needs `clinical.read`. */
  listProcedures(id: PatientId, options?: RequestOptions): Promise<ApiResult<ProcedurePage>>;
  /** Clinic host: records a procedure, planned or done. Needs `clinical.write`. */
  recordProcedure(visitId: VisitId, input: NewProcedure, options?: RequestOptions): Promise<ApiResult<Procedure>>;
  /** Clinic host: marks a planned procedure done. Needs `clinical.write`. */
  completeProcedure(id: ProcedureId, options?: RequestOptions): Promise<ApiResult<Procedure>>;

  /** Clinic host: a patient's treatment plans, newest first. Needs `clinical.read`. */
  listPlans(id: PatientId, options?: RequestOptions): Promise<ApiResult<PlanPage>>;
  /** Clinic host: proposes a treatment plan with an estimate per item. Needs `clinical.write`. */
  createPlan(id: PatientId, input: NewPlan, options?: RequestOptions): Promise<ApiResult<PlanPage["items"][number]>>;
  /** Clinic host: records the patient's acceptance of a proposed plan. Needs `clinical.write`. */
  acceptPlan(id: PlanId, input: Acceptance, options?: RequestOptions): Promise<ApiResult<PlanPage["items"][number]>>;
  /** Clinic host: marks an accepted plan item done or cancelled; the plan follows. Needs `clinical.write`; 409 once finished. */
  setPlanItemStatus(itemId: string, status: FinishedItemStatus, options?: RequestOptions): Promise<ApiResult<PlanPage["items"][number]>>;

  /** Clinic host: a patient's dental chart; teeth without entries are sound. Needs `clinical.read`. */
  getDentalChart(id: PatientId, tooth?: number, options?: RequestOptions): Promise<ApiResult<DentalChart>>;
  /** Clinic host: records chart findings. Needs `clinical.write`. */
  recordChartEntries(id: PatientId, input: NewChartEntries, options?: RequestOptions): Promise<ApiResult<DentalChart>>;
  /** Clinic host: adds a procedure or material to the clinic's list; a label already there (or seeded) returns that term. Needs `clinical.write`. */
  addDentalTerm(input: NewDentalTerm, options?: RequestOptions): Promise<ApiResult<DentalTerm>>;

  /** Clinic host: a patient's files, newest first. Needs `clinical.read`. */
  listAttachments(id: PatientId, options?: RequestOptions): Promise<ApiResult<AttachmentPage>>;
  /** Clinic host: uploads a file (JPEG, PNG, PDF, DICOM or a voice recording, up to 10 MB; a recording carries `note_id`, `duration_seconds`, `language`, and for a signed note `addendum_id`). Needs `clinical.write`. */
  uploadAttachment(id: PatientId, form: FormData, options?: RequestOptions): Promise<ApiResult<Attachment>>;
  /** Clinic host: a short-lived link to download a file. Needs `clinical.read`. */
  getDownloadLink(id: AttachmentId, options?: RequestOptions): Promise<ApiResult<DownloadLink>>;
  /** Clinic host: shares a file with the patient in their app, or stops sharing it. Needs `clinical.write`. */
  setAttachmentSharing(id: AttachmentId, sharing: FileSharing, options?: RequestOptions): Promise<ApiResult<FileSharing>>;

  /** Clinic host: who has patient-app access to a record, and whether a code is waiting. Needs `patients.read`. */
  getPatientAppAccess(id: PatientId, options?: RequestOptions): Promise<ApiResult<PatientAppAccess>>;
  /** Clinic host: "Invite to patient app": a new link code (shown once) emailed to the record's address. Needs `patients.write`. */
  invitePatientToApp(id: PatientId, options?: RequestOptions): Promise<ApiResult<PatientAppInvitation>>;
  /** Clinic host: confirms or declines a match the patient asked for, or revokes an active link. Needs `patients.write`. */
  decidePatientLink(id: string, decision: "confirm" | "decline" | "revoke", options?: RequestOptions): Promise<ApiResult<PatientLinkDecided>>;

  /** Any host: applies to join Aarogyam. Throttled per IP; the same answer whether or not the address already applied. */
  submitRegistration(input: NewRegistration, options?: RequestOptions): Promise<ApiResult<RegistrationReceived>>;

  /** Console host: applications, newest first. */
  listApplications(status: ApplicationStatus | undefined, options?: RequestOptions): Promise<ApiResult<Applications>>;
  /** Console host: approves an application, creating the clinic, the owner's account and invitation. */
  /** Console host: whether a clinic address is free, with free suggestions when it isn't. Sakalya staff only. */
  checkSlug(query: SlugQuery, options?: RequestOptions): Promise<ApiResult<SlugCheck>>;
  approveApplication(id: ApplicationId, input: ApproveApplication, options?: RequestOptions): Promise<ApiResult<ApprovedApplication>>;
  /** Console host: rejects an application with an optional reason. */
  rejectApplication(id: ApplicationId, input: RejectApplication, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Console host: one clinic, with its staff and pending invitations. */
  getClinicDetail(id: ClinicId, options?: RequestOptions): Promise<ApiResult<ClinicDetail>>;
  /** Console host: invites a doctor or other staff member to a clinic, by email and role. */
  inviteToClinic(id: ClinicId, input: NewClinicInvitation, options?: RequestOptions): Promise<ApiResult<ClinicInvited>>;
  /** Sends the owner's invitation again (new link, old one stops working) while the owner hasn't joined. */
  resendOwnerInvitation(id: ClinicId, options?: RequestOptions): Promise<ApiResult<ResentOwnerInvitation>>;

  /** Clinic host: finds medicines in the shared catalogue. Needs `prescriptions.issue`. */
  searchDrugs(input: DrugSearch, options?: RequestOptions): Promise<ApiResult<DrugList>>;

  /** Clinic host: the clinic's price list. Needs `billing.read`. */
  listPriceItems(options?: RequestOptions): Promise<ApiResult<PriceItemPage>>;
  /** Clinic host: adds a price list entry. Needs `settings.manage`. */
  addPriceItem(input: PriceItemValues, options?: RequestOptions): Promise<ApiResult<PriceItem>>;
  /** Clinic host: changes a price list entry. Needs `settings.manage`. */
  changePriceItem(id: PriceItemId, input: PriceItemValues, options?: RequestOptions): Promise<ApiResult<PriceItem>>;

  /** Clinic host: stock levels with counts for the summary cards, critical first. Needs `inventory.read`. */
  getStock(options?: RequestOptions): Promise<ApiResult<StockSummary>>;
  /** Clinic host: items at or below their reorder level, worst first. Needs `inventory.read`. */
  listLowStock(options?: RequestOptions): Promise<ApiResult<InventoryItemPage>>;
  /** Clinic host: batches with stock left that expire within `days` days (30 by default) or already have. Needs `inventory.read`. */
  listExpiring(days?: number, options?: RequestOptions): Promise<ApiResult<ExpiringPage>>;
  /** Clinic host: the stock items by name, each with its level. Needs `inventory.read`. */
  listInventoryItems(options?: RequestOptions): Promise<ApiResult<InventoryItemPage>>;
  /** Clinic host: one item with its batches and latest movements. Needs `inventory.read`. */
  getInventoryItem(id: InventoryItemId, options?: RequestOptions): Promise<ApiResult<InventoryItemDetail>>;
  /** Clinic host: adds a stock item. Needs `inventory.manage`. */
  addInventoryItem(input: InventoryItemValues, options?: RequestOptions): Promise<ApiResult<InventoryItem>>;
  /** Clinic host: changes a stock item. Needs `inventory.manage`. */
  changeInventoryItem(id: InventoryItemId, input: InventoryItemValues, options?: RequestOptions): Promise<ApiResult<InventoryItem>>;
  /** Clinic host: removes an item that has nothing on the shelf. Needs `inventory.manage`. */
  removeInventoryItem(id: InventoryItemId, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: the suppliers by name. Needs `inventory.read`. */
  listSuppliers(options?: RequestOptions): Promise<ApiResult<SupplierPage>>;
  /** Clinic host: adds a supplier. Needs `inventory.manage`. */
  addSupplier(input: SupplierValues, options?: RequestOptions): Promise<ApiResult<Supplier>>;
  /** Clinic host: changes a supplier. Needs `inventory.manage`. */
  changeSupplier(id: SupplierId, input: SupplierValues, options?: RequestOptions): Promise<ApiResult<Supplier>>;
  /** Clinic host: removes a supplier from the list. Needs `inventory.manage`. */
  removeSupplier(id: SupplierId, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: adds a delivery to stock. Needs `inventory.manage`. */
  receiveStock(input: ReceiveStock, options?: RequestOptions): Promise<ApiResult<StockChange>>;
  /** Clinic host: uses stock, earliest expiry first; 409 when the usable stock is short. Needs `inventory.manage`. */
  useStock(input: UseStock, options?: RequestOptions): Promise<ApiResult<StockChange>>;
  /** Clinic host: corrects stock after a count; a reason is required. Needs `inventory.manage`. */
  adjustStock(input: AdjustStock, options?: RequestOptions): Promise<ApiResult<StockChange>>;
  /** Clinic host: writes off what is left of an expired batch. Needs `inventory.manage`. */
  expireBatch(id: StockBatchId, input: ExpireBatch, options?: RequestOptions): Promise<ApiResult<StockChange>>;

  /** Clinic host: bills, newest first, without lines. Needs `billing.read`. */
  listInvoices(
    filter: { status?: string | undefined; patientId?: PatientId | undefined } & Partial<DateRange>,
    options?: RequestOptions,
  ): Promise<ApiResult<InvoicePage>>;
  /** Clinic host: opens a bill with its lines. Needs `billing.read`. */
  getInvoice(id: InvoiceId, options?: RequestOptions): Promise<ApiResult<Invoice>>;
  /** Clinic host: starts a draft bill for a patient. Needs `billing.write`. */
  createInvoice(input: NewInvoice, options?: RequestOptions): Promise<ApiResult<Invoice>>;
  /** Clinic host: edits a draft bill. Needs `billing.write`. */
  editInvoice(id: InvoiceId, changes: InvoiceEdit, options?: RequestOptions): Promise<ApiResult<Invoice>>;
  /** Clinic host: issues a draft: GST per line, a number, frozen. Needs `billing.write`. */
  issueInvoice(id: InvoiceId, options?: RequestOptions): Promise<ApiResult<Invoice>>;
  /** Clinic host: voids a bill with a reason. Needs `billing.write`. */
  voidInvoice(id: InvoiceId, reason: Reason, options?: RequestOptions): Promise<ApiResult<Invoice>>;

  /** Clinic host: payments received, newest first. Needs `billing.read`. */
  listPayments(range: Partial<DateRange>, options?: RequestOptions): Promise<ApiResult<PaymentPage>>;
  /** Clinic host: one payment, for its receipt. Needs `billing.read`. */
  getPayment(id: PaymentId, options?: RequestOptions): Promise<ApiResult<Payment>>;
  /** Clinic host: records a payment; `idempotencyKey` should be generated once per submission. Needs `billing.write`. */
  recordPayment(input: NewPayment, idempotencyKey: string, options?: RequestOptions): Promise<ApiResult<Payment>>;
  /** Clinic host: voids a payment with a reason. Needs `billing.write`. */
  voidPayment(id: PaymentId, reason: Reason, options?: RequestOptions): Promise<ApiResult<Payment>>;

  /**
   * Clinic host: collections by day, week and method, and the revenue mix. With `weeks` (1 to 52, not with `from` or `to`),
   * the last that many weeks, the current one included. Needs `finance.view`.
   */
  getCollections(range: Partial<DateRange> & { weeks?: number | undefined }, options?: RequestOptions): Promise<ApiResult<Collections>>;
  /** Clinic host: issued bills with a balance, oldest first. Needs `finance.view`. */
  getPendingReport(options?: RequestOptions): Promise<ApiResult<PendingReport>>;
  /** Clinic host: today's collections, pending dues and revenue mix for the Today screen. Needs `finance.view`. */
  getTodayMoney(options?: RequestOptions): Promise<ApiResult<TodayMoney>>;

  /** Clinic host: expenses spent in the range, newest day first, voided ones included. Needs `finance.view`. */
  listExpenses(range: Partial<DateRange>, options?: RequestOptions): Promise<ApiResult<ExpenseList>>;
  /** Clinic host: records an expense. Needs `expenses.write`. */
  recordExpense(input: NewExpense, options?: RequestOptions): Promise<ApiResult<Expense>>;
  /** Clinic host: voids an expense with a reason; it stops counting in reports. Needs `finance.view`. */
  voidExpense(id: ExpenseId, reason: Reason, options?: RequestOptions): Promise<ApiResult<Expense>>;
  /** Clinic host: chair use, money, patients and busy hours by month or week; money is null without `finance.view`. Needs `analytics.view`. */
  getAnalytics(query: AnalyticsQuery, options?: RequestOptions): Promise<ApiResult<Analytics>>;

  /** Clinic host: a patient's prescriptions, newest first. Needs `clinical.read`. */
  listPrescriptions(patientId: PatientId, options?: RequestOptions): Promise<ApiResult<PrescriptionPage>>;
  /** Clinic host: the patient's last issued prescription, for Quick Rx. Needs `clinical.read`. */
  getLastPrescription(patientId: PatientId, options?: RequestOptions): Promise<ApiResult<Prescription>>;
  /** Clinic host: opens a prescription with its print data. Needs `clinical.read`. */
  getPrescription(id: PrescriptionId, options?: RequestOptions): Promise<ApiResult<Prescription>>;
  /** Clinic host: starts a draft prescription. Needs `prescriptions.issue`. */
  createPrescription(patientId: PatientId, input: RxValues, options?: RequestOptions): Promise<ApiResult<Prescription>>;
  /** Clinic host: edits a draft. Needs `prescriptions.issue`. */
  editPrescription(id: PrescriptionId, input: RxValues, options?: RequestOptions): Promise<ApiResult<Prescription>>;
  /** Clinic host: issues a draft; `409` with alerts when an override reason is needed. Needs `prescriptions.issue`. */
  issuePrescription(id: PrescriptionId, input: IssueRequest, options?: RequestOptions): Promise<ApiResult<IssuedPrescription>>;
  /** Clinic host: cancels an issued prescription, starting a corrected draft by default. Needs `prescriptions.issue`. */
  cancelPrescription(id: PrescriptionId, input: CancelRequest, options?: RequestOptions): Promise<ApiResult<Cancelled>>;
  /** Clinic host: makes a seven-day link with a PIN for the patient to open the prescription. Needs `prescriptions.issue`. */
  createShareLink(id: PrescriptionId, options?: RequestOptions): Promise<ApiResult<ShareLink>>;

  /** Any host, public: whether a share link exists and which clinic sent it. */
  getSharedPreview(token: string, options?: RequestOptions): Promise<ApiResult<SharedPreview>>;
  /** Clinic host, public: the clinic's letterhead for a share link's page (no patient data). */
  getSharedLetterhead(token: string, options?: RequestOptions): Promise<ApiResult<LetterheadDocument>>;
  /** Any host, public: opens a shared prescription with its PIN. */
  openShared(token: string, pin: string, options?: RequestOptions): Promise<ApiResult<Prescription>>;
  /** Any host, public: the QR code's check that a prescription is genuine. */
  verifyPrescription(token: string, options?: RequestOptions): Promise<ApiResult<Verification>>;

  /** Clinic host, public: the clinic's name, booking settings and the doctors patients may pick. */
  getBookingOptions(options?: RequestOptions): Promise<ApiResult<BookingOptions>>;
  /** Clinic host, public: a doctor's free slots on a local day (`YYYY-MM-DD`). */
  getAvailability(date: string, practitionerId: string, options?: RequestOptions): Promise<ApiResult<Availability>>;
  /** Clinic host, verified-email sign-in (no membership needed): requests or books a slot. */
  createOnlineBooking(input: NewBooking, options?: RequestOptions): Promise<ApiResult<Booked>>;

  /** Clinic host: the website's settings, pictures and a preview of the page. Needs `settings.manage`. */
  getWebsiteSettings(options?: RequestOptions): Promise<ApiResult<WebsiteSettings>>;
  /** Clinic host: changes the website's design, content, published state or domain. Needs `settings.manage`. */
  updateWebsite(changes: WebsiteChanges, options?: RequestOptions): Promise<ApiResult<WebsiteSettings>>;
  /** Clinic host: the clinic's first-run setup (step statuses). Needs `settings.manage`. */
  getSetup(options?: RequestOptions): Promise<ApiResult<Setup>>;
  /** Clinic host: answers a setup step, closes the "Finish setting up" card or says how the clinic practises. Needs `settings.manage`. */
  updateSetup(update: SetupUpdate, options?: RequestOptions): Promise<ApiResult<Setup>>;
  /** Clinic host: the signed-in member's own setup (a doctor's one screen). */
  getMySetup(options?: RequestOptions): Promise<ApiResult<Setup>>;
  /** Clinic host: answers the member's own step. */
  updateMySetup(update: SetupUpdate, options?: RequestOptions): Promise<ApiResult<Setup>>;
  /** Clinic host: the doctor record linked to the signed-in member; `404` when they are not a doctor. */
  getMyPractitioner(options?: RequestOptions): Promise<ApiResult<Practitioner>>;
  /** Clinic host: a doctor's own name, qualifications, registration number and specialty. */
  changeMyPractitioner(changes: PractitionerFields, options?: RequestOptions): Promise<ApiResult<Practitioner>>;
  /** Clinic host: the signed-in doctor's weekly hours. */
  getMyWorkingHours(options?: RequestOptions): Promise<ApiResult<WorkingHours>>;
  /** Clinic host: replaces the signed-in doctor's weekly hours. */
  setMyWorkingHours(hours: WorkingHours, options?: RequestOptions): Promise<ApiResult<WorkingHours>>;
  /** Clinic host: uploads a website picture (form fields `file`, `kind`, `alt`). Needs `settings.manage`. */
  uploadWebsitePhoto(form: FormData, options?: RequestOptions): Promise<ApiResult<SitePhoto>>;
  /** Clinic host: changes a picture's description. Needs `settings.manage`. */
  describeWebsitePhoto(id: string, changes: PhotoChanges, options?: RequestOptions): Promise<ApiResult<SitePhoto>>;
  /** Clinic host: removes a picture. Needs `settings.manage`. */
  deleteWebsitePhoto(id: string, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host, public: the published website; `404` while it is not published. */
  getPublicSite(options?: RequestOptions): Promise<ApiResult<SitePage>>;

  // Walk-in fast path.
  /** Clinic host: registers (or picks) a walk-in, records reported allergies and desk consents, and issues a token, in one step. Needs `intake.write`, `patients.write` and `appointments.write`. */
  registerWalkIn(input: WalkInRequest, options?: RequestOptions): Promise<ApiResult<WalkIn>>;
  /** Clinic host: patients registered with a phone (sent in the body), with only id, number, name, age and sex. Needs `patients.read`. */
  lookupPatientsByPhone(phone: string, options?: RequestOptions): Promise<ApiResult<PhoneMatchPage>>;
  /** Clinic host: seats a token and starts (or returns) its visit. Needs `clinical.write`. */
  startVisitFromQueue(id: QueueTokenId, options?: RequestOptions): Promise<ApiResult<StartedVisit>>;
  /** Clinic host: confirms an allergy the patient reported at the desk. Needs `clinical.write`. */
  confirmAllergy(id: PatientId, allergyId: AllergyId, options?: RequestOptions): Promise<ApiResult<Allergy>>;
  /** Clinic host: the specialty's quick picks (allergies, complaints, findings, procedures, advice, medicine sets). Needs `patients.read` or `clinical.read`. */
  getQuickPicks(options?: RequestOptions): Promise<ApiResult<QuickPicks>>;
}
