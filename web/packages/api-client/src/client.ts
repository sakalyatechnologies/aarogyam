/** The one interface both the HTTP client and the fake client implement. */

import type { ApiResult } from "./result.js";
import type {
  AcceptInvitation,
  Acceptance,
  AllergyFields,
  AllergyId,
  AllergyPage,
  ApplicationId,
  ApplicationStatus,
  Applications,
  AppointmentChanges,
  AppointmentId,
  AppointmentPage,
  ApproveApplication,
  ApprovedApplication,
  Attachment,
  AttachmentId,
  AttachmentPage,
  Cancelled,
  CancelRequest,
  ClinicDetail,
  ClinicId,
  ClinicInvited,
  ClinicSettings,
  ClinicSettingsChanges,
  ClinicalFlags,
  Collections,
  ConditionFields,
  ConditionPage,
  ConsoleClinicPage,
  CreatedClinic,
  CreatedInvitation,
  DentalChart,
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
  NewAddendum,
  NewChartEntries,
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
  Prescription,
  PrescriptionId,
  PrescriptionPage,
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
  Timeline,
  TodayMoney,
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
  listPatients(options?: RequestOptions & PatientFilter): Promise<ApiResult<PatientPage>>;
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

  /** Clinic host: a patient's files, newest first. Needs `clinical.read`. */
  listAttachments(id: PatientId, options?: RequestOptions): Promise<ApiResult<AttachmentPage>>;
  /** Clinic host: uploads a file (JPEG, PNG, PDF or DICOM, up to 10 MB). Needs `clinical.write`. */
  uploadAttachment(id: PatientId, form: FormData, options?: RequestOptions): Promise<ApiResult<Attachment>>;
  /** Clinic host: a short-lived link to download a file. Needs `clinical.read`. */
  getDownloadLink(id: AttachmentId, options?: RequestOptions): Promise<ApiResult<DownloadLink>>;

  /** Any host: applies to join Aarogyam. Throttled per IP; the same answer whether or not the address already applied. */
  submitRegistration(input: NewRegistration, options?: RequestOptions): Promise<ApiResult<RegistrationReceived>>;

  /** Console host: applications, newest first. */
  listApplications(status: ApplicationStatus | undefined, options?: RequestOptions): Promise<ApiResult<Applications>>;
  /** Console host: approves an application, creating the clinic, the owner's account and invitation. */
  approveApplication(id: ApplicationId, input: ApproveApplication, options?: RequestOptions): Promise<ApiResult<ApprovedApplication>>;
  /** Console host: rejects an application with an optional reason. */
  rejectApplication(id: ApplicationId, input: RejectApplication, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Console host: one clinic, with its staff and pending invitations. */
  getClinicDetail(id: ClinicId, options?: RequestOptions): Promise<ApiResult<ClinicDetail>>;
  /** Console host: invites a doctor or other staff member to a clinic, by email and role. */
  inviteToClinic(id: ClinicId, input: NewClinicInvitation, options?: RequestOptions): Promise<ApiResult<ClinicInvited>>;

  /** Clinic host: finds medicines in the shared catalogue. Needs `prescriptions.issue`. */
  searchDrugs(input: DrugSearch, options?: RequestOptions): Promise<ApiResult<DrugList>>;

  /** Clinic host: the clinic's price list. Needs `billing.read`. */
  listPriceItems(options?: RequestOptions): Promise<ApiResult<PriceItemPage>>;
  /** Clinic host: adds a price list entry. Needs `settings.manage`. */
  addPriceItem(input: PriceItemValues, options?: RequestOptions): Promise<ApiResult<PriceItem>>;
  /** Clinic host: changes a price list entry. Needs `settings.manage`. */
  changePriceItem(id: PriceItemId, input: PriceItemValues, options?: RequestOptions): Promise<ApiResult<PriceItem>>;

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

  /** Clinic host: collections by day, week and method, and the revenue mix. Needs `finance.view`. */
  getCollections(range: Partial<DateRange>, options?: RequestOptions): Promise<ApiResult<Collections>>;
  /** Clinic host: issued bills with a balance, oldest first. Needs `finance.view`. */
  getPendingReport(options?: RequestOptions): Promise<ApiResult<PendingReport>>;
  /** Clinic host: today's collections, pending dues and revenue mix for the Today screen. Needs `finance.view`. */
  getTodayMoney(options?: RequestOptions): Promise<ApiResult<TodayMoney>>;

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
  issuePrescription(id: PrescriptionId, input: IssueRequest, options?: RequestOptions): Promise<ApiResult<Prescription>>;
  /** Clinic host: cancels an issued prescription, starting a corrected draft by default. Needs `prescriptions.issue`. */
  cancelPrescription(id: PrescriptionId, input: CancelRequest, options?: RequestOptions): Promise<ApiResult<Cancelled>>;
  /** Clinic host: makes a seven-day link with a PIN for the patient to open the prescription. Needs `prescriptions.issue`. */
  createShareLink(id: PrescriptionId, options?: RequestOptions): Promise<ApiResult<ShareLink>>;

  /** Any host, public: whether a share link exists and which clinic sent it. */
  getSharedPreview(token: string, options?: RequestOptions): Promise<ApiResult<SharedPreview>>;
  /** Any host, public: opens a shared prescription with its PIN. */
  openShared(token: string, pin: string, options?: RequestOptions): Promise<ApiResult<Prescription>>;
  /** Any host, public: the QR code's check that a prescription is genuine. */
  verifyPrescription(token: string, options?: RequestOptions): Promise<ApiResult<Verification>>;
}
