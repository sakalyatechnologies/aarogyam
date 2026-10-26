/** The one interface both the HTTP client and the fake client implement. */

import type { ApiResult } from "./result.js";
import type {
  Audience,
  AudiencePreview,
  Badges,
  Campaign,
  Campaigns,
  ChatMessage,
  ChatMessageList,
  ConversationList,
  ConversationStarted,
  MessageList,
  MessageTemplates,
  MessagesQueued,
} from "./schemas.js";
import type {
  AffectedAppointmentPage,
  NewTimeOff,
  StaffOpsSettings,
  StaffOpsSettingsChanges,
  TimeOff,
  TimeOffDecision,
  TimeOffId,
  TimeOffPage,
} from "./schemas.js";
import type { AudienceFilter, NewAudience, NewCampaign, NewChatMessage, NewConversation, ScheduleCampaign, SendMessages } from "./contract.js";
import type { FileSharing, PatientAppAccess, PatientAppInvitation, PatientLinkDecided } from "./contract.js";
import type { Handoff, HandoffSession, NewHandoff, RedeemHandoff, SlugCheck, SlugQuery } from "./schemas.js";
import type {
  MarkedRead,
  NotificationList,
  NotificationSettings,
  NotificationSettingsChanges,
  Avatar,
  Profile,
  ProfileUpdate,
  RevokedSessions,
  UnreadCount,
} from "./schemas.js";
import type { MyTasks, Task, TaskHistory, TaskId, TaskList, TaskOccurrence, TaskOccurrenceId, TaskPreview } from "./schemas.js";
import type { CompleteTask, NewTask, TaskChange } from "./contract.js";
import type { ImportChoices, ImportSession, ImportSessionId, IncompleteList, PatientGapId, SmartImportResult } from "./schemas.js";
import type { Allergy, FamilyLink, FamilyList, NewFamilyLink, ConsentLink, ConsentRequestInput, ConsentRequested, ConsentSigned, LabBalance, LabContact, LabContactLogEntry, LabContactValues, LabOrder, LabOrderChanges, LabOrderList, LabOrderState, LabOrderStatusChange, LabPayment, LabPaymentList, LabReminderQueued, LabVendor, LabVendorList, LabVendorValues, MonthSummary, NewLabOrder, NewLabPayment, OpenLabOrderPage, PatientsSummary, PhoneMatchPage, QuickPicks, SignConsentInput, StartedVisit, WalkIn, WalkInRequest, ConflictPolicy, ConflictPolicyChange, MoveAppointment } from "./schemas.js";
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
  DashboardLayout,
  DashboardLayoutView,
  DentalTerm,
  DownloadLink,
  DrugList,
  DrugSearch,
  ImportResult,
  Invoice,
  InvoiceEdit,
  InvoiceId,
  UpiLink,
  CollectSummary,
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
  InventoryItemAlertChanges,
  InventoryItemAlerts,
  StockAnalytics,
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
  MissedListPage,
  Recall,
  RecallListPage,
  QueueDayPage,
  ToCollectPage,
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
  ShareInput,
  ClosedVisit,
  CloseVisitInput,
  FinishedVisit,
  FinishVisitInput,
  VisitLink,
  VisitSummary,
  SavedMedicineSet,
  SavedMedicineSetList,
  MedicineSetInput,
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

/** Filters for the lab order list. */
export interface LabOrderFilter {
  status?: LabOrderState;
  vendorId?: string;
  patientId?: string;
  /** Only work at the lab and past its due date. */
  overdue?: boolean;
  /** Only work that still needs something done. */
  open?: boolean;
}

export interface RequestOptions {
  /** Cancels the request, for example when a search term changes. */
  signal?: AbortSignal | undefined;
}

/** Which patients the list shows. Flags only, so nothing personal reaches a URL. */
/** Filters for `listTaskHistory`. */
export interface TaskHistoryQuery {
  /** First clinic day, `YYYY-MM-DD`; 30 days before `to` by default. */
  from?: string;
  /** Last clinic day, `YYYY-MM-DD`; today by default. At most 92 days after `from`. */
  to?: string;
  /** A member: tasks given to them or to their role, or finished by them. */
  assignee?: string;
  status?: "open" | "done" | "skipped" | "missed";
  templateId?: TaskId;
}

/** Filters for `listNotifications`. */
export interface NotificationQuery {
  /** Only unread ones, from the last 30 days. */
  unreadOnly?: boolean;
  /** Page size, 1 to 100 (default 30). */
  limit?: number;
  /** Only those older than this notification id (the last of the previous page). */
  before?: string;
}

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
  /** Clinic host: lab orders with items, stage and late flag, soonest due first; `open` keeps work that still needs something done. Costs show only with `finance.view`. Needs `labs.read`. */
  listLabOrders(filter?: LabOrderFilter, options?: RequestOptions): Promise<ApiResult<LabOrderList>>;
  /** Clinic host: one lab order with its items and history. Needs `labs.read`. */
  getLabOrder(id: string, options?: RequestOptions): Promise<ApiResult<LabOrder>>;
  /** Clinic host: sends work to a lab (`send` hands it over now, otherwise it stays a draft). Needs `labs.write`. */
  createLabOrder(input: NewLabOrder, options?: RequestOptions): Promise<ApiResult<LabOrder>>;
  /** Clinic host: changes an order's contact, stage text, instructions or due date. Needs `labs.write`. */
  updateLabOrder(id: string, changes: LabOrderChanges, options?: RequestOptions): Promise<ApiResult<LabOrder>>;
  /** Clinic host: moves an order along (409 when the move isn't allowed). Needs `labs.write`. */
  setLabOrderStatus(id: string, change: LabOrderStatusChange, options?: RequestOptions): Promise<ApiResult<LabOrder>>;
  /** Clinic host: emails the lab a reminder, never naming the patient; 409 when the work isn't at the lab or the lab has no email. Needs `labs.write`. */
  remindLab(id: string, options?: RequestOptions): Promise<ApiResult<LabReminderQueued>>;
  /** Clinic host: logs a call, message or visit to the lab; a promised date becomes the due date. Needs `labs.write`. */
  logLabContact(id: string, entry: LabContactLogEntry, options?: RequestOptions): Promise<ApiResult<LabOrder>>;
  /** Clinic host: the labs with their contacts. Needs `labs.read`. */
  listLabVendors(options?: RequestOptions): Promise<ApiResult<LabVendorList>>;
  /** Clinic host: adds a lab. Needs `labs.write`. */
  createLabVendor(input: LabVendorValues, options?: RequestOptions): Promise<ApiResult<LabVendor>>;
  /** Clinic host: changes a lab. Needs `labs.write`. */
  updateLabVendor(id: string, changes: LabVendorValues, options?: RequestOptions): Promise<ApiResult<LabVendor>>;
  /** Clinic host: adds a person at a lab. Needs `labs.write`. */
  createLabContact(vendorId: string, input: LabContactValues, options?: RequestOptions): Promise<ApiResult<LabContact>>;
  /** Clinic host: changes a person at a lab. Needs `labs.write`. */
  updateLabContact(id: string, changes: LabContactValues, options?: RequestOptions): Promise<ApiResult<LabContact>>;
  /** Clinic host: what a lab has billed, been paid and is still owed. Needs `finance.view`. */
  getLabBalance(vendorId: string, options?: RequestOptions): Promise<ApiResult<LabBalance>>;
  /** Clinic host: payments to labs, newest first, voided ones included. Needs `finance.view`. */
  listLabPayments(vendorId?: string, options?: RequestOptions): Promise<ApiResult<LabPaymentList>>;
  /** Clinic host: records a payment to a lab and its lab expense. Needs `expenses.write` and `finance.view`. */
  recordLabPayment(input: NewLabPayment, options?: RequestOptions): Promise<ApiResult<LabPayment>>;
  /** Clinic host: voids a payment (and its expense) with a reason. Needs `expenses.write`. */
  voidLabPayment(id: string, reason: Reason, options?: RequestOptions): Promise<ApiResult<LabPayment>>;
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

  /**
   * Clinic host: who is away on the local days given, and the caller's own requests (all of them
   * for `time_off.manage`). Other staff get approved time off only, with no kind or reason.
   * Needs `appointments.read`; at most 42 days.
   */
  listTimeOff(range: DateRange, options?: RequestOptions): Promise<ApiResult<TimeOffPage>>;
  /**
   * Clinic host: asks for time off for yourself (pending, or approved at once when the clinic does
   * not ask for approval). With `membership_id` it records time off for someone else, which
   * needs `time_off.manage` and is approved at once. Needs `time_off.request`.
   */
  requestTimeOff(input: NewTimeOff, options?: RequestOptions): Promise<ApiResult<TimeOff>>;
  /** Clinic host: approves a pending request; a doctor's leave block stops bookings. Needs `time_off.manage`. */
  approveTimeOff(id: TimeOffId, decision?: TimeOffDecision, options?: RequestOptions): Promise<ApiResult<TimeOff>>;
  /** Clinic host: declines a pending request. Needs `time_off.manage`. */
  declineTimeOff(id: TimeOffId, decision?: TimeOffDecision, options?: RequestOptions): Promise<ApiResult<TimeOff>>;
  /** Clinic host: withdraws a pending or approved request and frees the doctor again. The requester or `time_off.manage`. */
  cancelTimeOff(id: TimeOffId, options?: RequestOptions): Promise<ApiResult<TimeOff>>;
  /**
   * Clinic host: the unfinished appointments the leave covers, each with free-doctor suggestions.
   * Moving one is the usual `changeAppointment`. Needs `time_off.manage`.
   */
  listAffectedAppointments(id: TimeOffId, options?: RequestOptions): Promise<ApiResult<AffectedAppointmentPage>>;
  /** Clinic host: whether time off needs approval, and how often open tasks are reminded. Needs `settings.manage`. */
  getStaffOpsSettings(options?: RequestOptions): Promise<ApiResult<StaffOpsSettings>>;
  /** Clinic host: changes those settings; what is left out stays. Needs `settings.manage`. */
  updateStaffOpsSettings(changes: StaffOpsSettingsChanges, options?: RequestOptions): Promise<ApiResult<StaffOpsSettings>>;

  /** Clinic host: appointments starting in the local days given. Needs `appointments.read`. */
  listAppointments(filter: AppointmentFilter, options?: RequestOptions): Promise<ApiResult<AppointmentPage>>;
  /** Clinic host: books an appointment. `409` when the chair is taken; `warnings` for anything else worth knowing. Needs `appointments.write`. */
  bookAppointment(input: NewAppointmentBody, options?: RequestOptions): Promise<ApiResult<SavedAppointment>>;
  /** Clinic host: moves, reassigns or edits an appointment. Needs `appointments.write`. */
  changeAppointment(id: AppointmentId, changes: AppointmentChanges, options?: RequestOptions): Promise<ApiResult<SavedAppointment>>;
  /** Clinic host: moves an appointment's status along, or cancels (with a reason) or marks a no-show. Needs `appointments.write`. */
  setAppointmentStatus(id: AppointmentId, change: StatusChange, options?: RequestOptions): Promise<ApiResult<StatusChanged>>;
  /** Reschedules a requested, booked or confirmed appointment and confirms it. 409 `slot_occupied` when the new time is held. */
  moveAppointment(id: AppointmentId, to: MoveAppointment, options?: RequestOptions): Promise<ApiResult<StatusChanged>>;
  /** A doctor's own answer to a taken time (`null` follows the clinic). Owner reads any; a doctor only their own. */
  getConflictPolicy(id: PractitionerId, options?: RequestOptions): Promise<ApiResult<ConflictPolicy>>;
  setConflictPolicy(id: PractitionerId, policy: ConflictPolicyChange, options?: RequestOptions): Promise<ApiResult<ConflictPolicy>>;

  /** Clinic host: the queue of a clinic day, with each token's wait. Needs `appointments.read`. */
  listQueue(date: string | undefined, options?: QueueOptions): Promise<ApiResult<QueueDayPage>>;
  /** Clinic host: a clinic day's no-shows (today when `date` is left out), ids and numbers only. Needs `appointments.read`. */
  listMissedAppointments(date: string | undefined, options?: RequestOptions): Promise<ApiResult<MissedListPage>>;
  /** Clinic host: earlier days' visits whose bill still has a balance. Needs `payments.collect` or `billing.read`. */
  listQueueToCollect(options?: RequestOptions): Promise<ApiResult<ToCollectPage>>;
  /** Clinic host: open follow-ups, soonest first. Needs `patients.read`. */
  listRecallsDue(options?: RequestOptions): Promise<ApiResult<RecallListPage>>;
  /** Clinic host: marks a follow-up done. Needs `patients.write`. */
  markRecallDone(id: string, options?: RequestOptions): Promise<ApiResult<Recall>>;
  /** Clinic host: dismisses a follow-up no longer needed, with an optional reason (at most 200 characters). Needs `patients.write`. */
  dismissRecall(id: string, input: { reason?: string }, options?: RequestOptions): Promise<ApiResult<Recall>>;
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

  /** Clinic host: unread chat messages and notifications, for the minute poll. Needs `chat.use`. */
  getBadges(options?: RequestOptions): Promise<ApiResult<Badges>>;
  /** Clinic host: queues a message to 1 to 50 patients from an approved template; consent is checked per patient. Needs `messages.send`. */
  sendMessages(input: SendMessages, options?: RequestOptions): Promise<ApiResult<MessagesQueued>>;
  /** Clinic host: the messages sent to one patient, newest first, with their status. Needs `messages.send`. */
  listPatientMessages(patientId: string, options?: RequestOptions): Promise<ApiResult<MessageList>>;
  /** Clinic host: the clinic's message templates; only approved ones are sent. Needs `messages.send`. */
  listMessageTemplates(options?: RequestOptions): Promise<ApiResult<MessageTemplates>>;
  /** Clinic host: saves an audience (a name and one filter). Needs `campaigns.manage`. */
  createAudience(input: NewAudience, options?: RequestOptions): Promise<ApiResult<Audience>>;
  /** Clinic host: counts the patients a filter reaches and returns the `count_token` a campaign needs to be scheduled. Needs `campaigns.manage`. */
  previewAudience(filter: AudienceFilter, options?: RequestOptions): Promise<ApiResult<AudiencePreview>>;
  /** Clinic host: the clinic's campaigns with per-status counts. Needs `campaigns.manage`. */
  listCampaigns(options?: RequestOptions): Promise<ApiResult<Campaigns>>;
  /** Clinic host: one campaign with its counts. Needs `campaigns.manage`. */
  getCampaign(id: string, options?: RequestOptions): Promise<ApiResult<Campaign>>;
  /** Clinic host: makes a draft campaign. Needs `campaigns.manage`. */
  createCampaign(input: NewCampaign, options?: RequestOptions): Promise<ApiResult<Campaign>>;
  /** Clinic host: schedules a campaign; it sends only with the `count_token` from a fresh preview of its audience. Needs `campaigns.manage`. */
  scheduleCampaign(id: string, input: ScheduleCampaign, options?: RequestOptions): Promise<ApiResult<Campaign>>;
  /** Clinic host: cancels a campaign that has not finished sending. Needs `campaigns.manage`. */
  cancelCampaign(id: string, options?: RequestOptions): Promise<ApiResult<Campaign>>;
  /** Clinic host: the caller's conversations with unread counts. Needs `chat.use`. */
  listConversations(limit?: number, options?: RequestOptions): Promise<ApiResult<ConversationList>>;
  /** Clinic host: starts a direct or group chat; a direct one that exists is returned (`created` false). Needs `chat.use`. */
  startConversation(input: NewConversation, options?: RequestOptions): Promise<ApiResult<ConversationStarted>>;
  /** Clinic host: a conversation's messages, oldest first. `after` returns only newer ones, for polling. Needs `chat.use`. */
  listChatMessages(id: string, query?: { after?: string; before?: string; limit?: number }, options?: RequestOptions): Promise<ApiResult<ChatMessageList>>;
  /** Clinic host: posts a message; repeating a `client_id` returns the same message. Needs `chat.use`. */
  postChatMessage(id: string, input: NewChatMessage, options?: RequestOptions): Promise<ApiResult<ChatMessage>>;
  /** Clinic host: marks a conversation read up to a message. Needs `chat.use`. */
  markConversationRead(id: string, messageId: string, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: mutes or unmutes a conversation for the caller (a muted one is not counted in the badge). Needs `chat.use`. */
  muteConversation(id: string, muted: boolean, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: leaves a conversation. Needs `chat.use`. */
  leaveConversation(id: string, options?: RequestOptions): Promise<ApiResult<void>>;

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

  /** Clinic host: the signed-in member's Today layout: their own, else the clinic's default, else MedSync; with the template and widget catalogue. Any member. */
  getMyDashboardLayout(options?: RequestOptions): Promise<ApiResult<DashboardLayoutView>>;
  /** Clinic host: saves the member's own layout (it follows them across devices). `400` names the widget or option the registry refuses. Any member. */
  saveMyDashboardLayout(layout: DashboardLayout, options?: RequestOptions): Promise<ApiResult<DashboardLayoutView>>;
  /** Clinic host: removes the member's own layout and returns the one that applies now (the clinic's default or MedSync). Any member. */
  resetMyDashboardLayout(options?: RequestOptions): Promise<ApiResult<DashboardLayoutView>>;
  /** Clinic host: the clinic's default layout, or MedSync when none was saved; with the catalogue. Needs `settings.manage`. */
  getDashboardLayout(options?: RequestOptions): Promise<ApiResult<DashboardLayoutView>>;
  /** Clinic host: saves the clinic's default layout; members with their own keep it. Needs `settings.manage`. */
  saveDashboardLayout(layout: DashboardLayout, options?: RequestOptions): Promise<ApiResult<DashboardLayoutView>>;
  /** Clinic host: removes the clinic's default, so MedSync applies again. Needs `settings.manage`. */
  resetDashboardLayout(options?: RequestOptions): Promise<ApiResult<DashboardLayoutView>>;

  /** Clinic host: the clinic's notification switches (reminders, receipts, recalls, low stock, overdue lab work) and quiet hours. Needs `settings.manage`. */
  getNotificationSettings(options?: RequestOptions): Promise<ApiResult<NotificationSettings>>;
  /** Clinic host: changes the notification switches; what is left out stays. `400` names a bad quiet-hours field. Needs `settings.manage`. */
  updateNotificationSettings(changes: NotificationSettingsChanges, options?: RequestOptions): Promise<ApiResult<NotificationSettings>>;
  /** Clinic host: uploads the clinic logo (PNG or JPEG, up to 2 MB; form field `file`) and returns the clinic's settings. Needs `settings.manage`. */
  uploadClinicLogo(form: FormData, options?: RequestOptions): Promise<ApiResult<ClinicSettings>>;

  /** Clinic host: the caller's notifications, newest first, each with a portal link (`href`) when it has one. Needs a read permission that one of the kinds uses (appointments, labs, billing or patients). */
  listNotifications(params?: NotificationQuery, options?: RequestOptions): Promise<ApiResult<NotificationList>>;
  /** Clinic host: the bell's number: unread notifications from the last 30 days, at most 100. */
  countUnreadNotifications(options?: RequestOptions): Promise<ApiResult<UnreadCount>>;
  /** Clinic host: marks one notification read for the caller only. `404` when it is not in their clinic or reach. */
  markNotificationRead(id: string, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: marks everything within the caller's reach read. */
  markAllNotificationsRead(options?: RequestOptions): Promise<ApiResult<MarkedRead>>;

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
  /** Any host: signs out every session but the one asking, and says how many it ended. */
  revokeOtherSessions(options?: RequestOptions): Promise<ApiResult<RevokedSessions>>;
  /** Any host: changes the person's own name and phone (across every clinic they belong to). `400` names the field; `409` when another account holds the phone. */
  updateMe(changes: ProfileUpdate, options?: RequestOptions): Promise<ApiResult<Profile>>;
  /** Clinic host: sets the caller's own avatar from a form with exactly one of `preset` (an id such as `tooth_3`) or `file` (PNG or JPEG, up to 2 MB). `400` for neither, both, a bad preset or another file type. */
  putMyAvatar(form: FormData, options?: RequestOptions): Promise<ApiResult<Avatar>>;
  /** Clinic host: removes the caller's own avatar. */
  deleteMyAvatar(options?: RequestOptions): Promise<ApiResult<void>>;

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
  /**
   * Clinic host: closes a visit and, in the same transaction, plans a follow-up (`follow_up_on`,
   * needs `patients.write`) and starts a draft bill linked to the visit (`fee_paise`, needs
   * `billing.write`). 409 `visit_closed` when it is already closed. Needs `clinical.write`.
   */
  closeVisitWith(id: VisitId, input: CloseVisitInput, options?: RequestOptions): Promise<ApiResult<ClosedVisit>>;
  /**
   * Clinic host: finishes a visit in one transaction: signs the caller's draft notes, issues a draft
   * prescription (409 `allergy_alerts` without an override reason), plans the follow-up, starts the
   * draft bill and closes the visit. 409 `visit_closed` when it is already closed. Needs
   * `clinical.write`.
   */
  finishVisit(id: VisitId, input?: FinishVisitInput, options?: RequestOptions): Promise<ApiResult<FinishedVisit>>;
  /** Clinic host: makes a link and PIN for the patient to open the visit summary at `/shared/{token}/visit`. Needs `clinical.write`. */
  shareVisit(id: VisitId, input?: ShareInput, options?: RequestOptions): Promise<ApiResult<VisitLink>>;
  /** Public: opens a visit summary link with its PIN. Five wrong PINs lock the link. */
  openSharedVisit(token: string, pin: string, options?: RequestOptions): Promise<ApiResult<VisitSummary>>;

  /** Clinic host: the clinic's saved medicine sets. Needs `prescriptions.issue` or `clinical.read`. */
  listMedicineSets(options?: RequestOptions): Promise<ApiResult<SavedMedicineSetList>>;
  /** Clinic host: saves a medicine set; 409 when the label is taken. Needs `prescriptions.issue`. */
  createMedicineSet(input: MedicineSetInput, options?: RequestOptions): Promise<ApiResult<SavedMedicineSet>>;
  /** Clinic host: replaces a medicine set's label and medicines. Needs `prescriptions.issue`. */
  updateMedicineSet(id: string, input: MedicineSetInput, options?: RequestOptions): Promise<ApiResult<SavedMedicineSet>>;
  /** Clinic host: deletes a medicine set. Needs `prescriptions.issue`. */
  deleteMedicineSet(id: string, options?: RequestOptions): Promise<ApiResult<void>>;

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
  /** Clinic host: how fast each item (or the one named) is used, how long it lasts and what to reorder. Needs `inventory.read`. */
  getStockAnalytics(params?: { itemId?: InventoryItemId }, options?: RequestOptions): Promise<ApiResult<StockAnalytics>>;
  /** Clinic host: an item's lead time (0 to 120 days) and whether it raises stock alerts. Needs `inventory.manage`. */
  changeInventoryItemAlerts(id: InventoryItemId, input: InventoryItemAlertChanges, options?: RequestOptions): Promise<ApiResult<InventoryItemAlerts>>;
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

  /** Clinic host: the caller's tasks for a clinic day (today by default), plus any still open from earlier. A `confirm_photos` task carries `patients_without_photos_today`. Needs `tasks.use`. */
  listMyTasks(date?: string, options?: RequestOptions): Promise<ApiResult<MyTasks>>;
  /** Clinic host: finishes a task given to the caller or their role, with an optional note and the materials used (taken off the shelf in the same step). The same person again gets 200; anyone else 409; short stock 409 and nothing is recorded. Needs `tasks.use`. */
  completeTask(id: TaskOccurrenceId, input: CompleteTask, options?: RequestOptions): Promise<ApiResult<TaskOccurrence>>;
  /** Clinic host: opens a done or skipped task again; 409 for a missed one. Needs `tasks.manage`. */
  reopenTask(id: TaskOccurrenceId, options?: RequestOptions): Promise<ApiResult<TaskOccurrence>>;
  /** Clinic host: the clinic's recurring tasks, including the standard ones and any switched off. Needs `tasks.manage`. */
  listTasks(options?: RequestOptions): Promise<ApiResult<TaskList>>;
  /** Clinic host: makes a task. Needs `tasks.manage`. */
  createTask(input: NewTask, options?: RequestOptions): Promise<ApiResult<Task>>;
  /** Clinic host: one task. Needs `tasks.manage`. */
  getTask(id: TaskId, options?: RequestOptions): Promise<ApiResult<Task>>;
  /** Clinic host: changes a task; fields left out stay. Needs `tasks.manage`. */
  updateTask(id: TaskId, changes: TaskChange, options?: RequestOptions): Promise<ApiResult<Task>>;
  /** Clinic host: deletes a task; 409 for a standard one, which can only be switched off with `active: false`. Needs `tasks.manage`. */
  deleteTask(id: TaskId, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: the next five times a task falls due. Needs `tasks.manage`. */
  previewTask(id: TaskId, options?: RequestOptions): Promise<ApiResult<TaskPreview>>;
  /** Clinic host: occurrences by clinic day, newest first. Needs `tasks.manage`. */
  listTaskHistory(filter?: TaskHistoryQuery, options?: RequestOptions): Promise<ApiResult<TaskHistory>>;

  /** Clinic host: bills, newest first, without lines. Needs `billing.read`. */
  listInvoices(
    filter: { status?: string | undefined; patientId?: PatientId | undefined } & Partial<DateRange>,
    options?: RequestOptions,
  ): Promise<ApiResult<InvoicePage>>;
  /** Clinic host: opens a bill with its lines. Needs `billing.read`. */
  getInvoice(id: InvoiceId, options?: RequestOptions): Promise<ApiResult<Invoice>>;
  /** Clinic host: the UPI link and QR text for what is left on an issued bill; records nothing. Needs `billing.read`. */
  getInvoiceUpiLink(id: InvoiceId, options?: RequestOptions): Promise<ApiResult<UpiLink>>;
  /**
   * Clinic host: what to collect on a bill (number, total, what is left, the UPI link when the clinic has a UPI ID).
   * Needs `payments.collect` or `billing.read`. `404` when the bill is not in the clinic; `409` for a void bill.
   */
  getInvoiceCollectSummary(id: InvoiceId, options?: RequestOptions): Promise<ApiResult<CollectSummary>>;
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
  /** Clinic host: records a payment; `idempotencyKey` should be generated once per submission. Needs `billing.write`, or `payments.collect` for a bill that is draft or issued with a balance. */
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
  /** Clinic host: like `createShareLink`, with how long the link works (`expires_in_hours`, 24 to 720) and `channel` (`whatsapp`, `sms`, `qr` or `link`). */
  createShareLinkWith(id: PrescriptionId, input: ShareInput, options?: RequestOptions): Promise<ApiResult<ShareLink>>;

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
  /** Clinic host: total, new this month and recalls due (and, with `billing.read`, how many owe money). Needs `patients.read`. */
  getPatientsSummary(options?: RequestOptions): Promise<ApiResult<PatientsSummary>>;
  /** Clinic host: sets the patient's photo (`FormData` with a PNG or JPEG `file` of at most 2 MB). Needs `patients.write`. */
  putPatientPhoto(id: PatientId, form: FormData, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: the patient's photo; `404` when there is none. Needs `patients.read`. */
  getPatientPhoto(id: PatientId, options?: RequestOptions): Promise<ApiResult<Blob>>;
  /** Clinic host: removes the patient's photo. Needs `patients.write`. */
  deletePatientPhoto(id: PatientId, options?: RequestOptions): Promise<ApiResult<void>>;
  /** The patient's relatives (`patients.read`). */
  listFamily(id: PatientId, options?: RequestOptions): Promise<ApiResult<FamilyList>>;
  /** Links a relative (and the patient back to them); `patients.write`. */
  addFamilyLink(id: PatientId, input: NewFamilyLink, options?: RequestOptions): Promise<ApiResult<FamilyLink>>;
  /** Removes a link and its inverse; `patients.write`. */
  removeFamilyLink(id: PatientId, linkId: string, options?: RequestOptions): Promise<ApiResult<void>>;
  /** Clinic host: emails the patient a one-time link to read the notice and sign consent (`409` without an email address). Needs `patients.write`. */
  requestConsent(id: PatientId, input?: ConsentRequestInput, options?: RequestOptions): Promise<ApiResult<ConsentRequested>>;
  /** Clinic host, public: what a consent link shows; `404` for an unknown token. */
  getConsentLink(token: string, options?: RequestOptions): Promise<ApiResult<ConsentLink>>;
  /** Clinic host, public: signs through the link, once (`409` if already signed or expired). */
  signConsentLink(token: string, input: SignConsentInput, options?: RequestOptions): Promise<ApiResult<ConsentSigned>>;
  /** Clinic host: seats a token and starts (or returns) its visit. Needs `clinical.write`. */
  startVisitFromQueue(id: QueueTokenId, options?: RequestOptions): Promise<ApiResult<StartedVisit>>;
  /** Clinic host: confirms an allergy the patient reported at the desk. Needs `clinical.write`. */
  confirmAllergy(id: PatientId, allergyId: AllergyId, options?: RequestOptions): Promise<ApiResult<Allergy>>;
  /** Clinic host: the specialty's quick picks (allergies, complaints, findings, procedures, advice, medicine sets). Needs `patients.read` or `clinical.read`. */
  getQuickPicks(options?: RequestOptions): Promise<ApiResult<QuickPicks>>;
}
