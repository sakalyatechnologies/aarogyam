/** The real client: `fetch` against one API host, decoding every response at the boundary. */

import type { z } from "zod";

import type { ApiClient, DateRange } from "./client.js";
import { failure, parseApiError, success, type ApiResult } from "./result.js";
import {
  allergy,
  allergyList,
  plan,
  planList,
  applications,
  appointmentList,
  approvedApplication,
  attachment,
  availability,
  booked,
  sitePage,
  sitePhoto,
  setup,
  websiteSettings,
  bookingOptions,
  attachmentList,
  cancelled,
  clinicDetail,
  clinicInvited,
  resentOwnerInvitation,
  clinicSettings,
  letterhead,
  letterheadDocument,
  clinicalFlags,
  collections,
  analytics,
  expense,
  expenseList,
  condition,
  conditionList,
  consoleClinics,
  createdClinic,
  createdInvitation,
  dentalChart,
  dashboardLayoutView,
  dentalTerm,
  devTokenResponse,
  downloadLink,
  fileSharing,
  patientAppAccess,
  patientAppInvitation,
  patientLinkDecided,
  drugList,
  importResult,
  importSession,
  incompleteList,
  smartImportResult,
  invoice,
  invoiceList,
  handoff,
  handoffSession,
  joined,
  leave,
  leaveList,
  meResponse,
  member,
  metricsResponse,
  mySessionsResponse,
  note,
  observationList,
  patient,
  patientList,
  payment,
  paymentList,
  pendingReport,
  practitioner,
  practitionerList,
  issuedPrescription,
  prescription,
  prescriptionList,
  priceItem,
  priceItemList,
  expiringList,
  inventoryItem,
  inventoryItemDetail,
  inventoryItemList,
  stockChange,
  stockSummary,
  supplier,
  supplierList,
  procedure,
  procedureList,
  qualityReport,
  queueDay,
  queueToken,
  monthSummary,
  openLabOrderPage,
  registrationReceived,
  requestId,
  room,
  roomList,
  rolesResponse,
  accessCatalogue,
  roleDetail,
  savedRole,
  savedAppointment,
  sessionResponse,
  slugCheck,
  shareLink,
  sharedPreview,
  staffResponse,
  statusChanged,
  patientNotes,
  consent,
  consentList,
  summaryNote,
  timeline,
  todayMoney,
  todayResponse,
  verification,
  visit,
  visitDetail,
  visitList,
  voidResponse,
  workingHours,
  type RequestId,
} from "./schemas.js";
import { phoneMatches, quickPicks, startedVisit, walkIn } from "./schemas.js";
import { markedRead, notificationList, notificationSettings, profile, revokedSessions, unreadCount } from "./schemas.js";

/** Returns the current access token, or `null` when signed out. */
export type TokenSource = () => Promise<string | null> | string | null;

export interface HttpClientOptions {
  /** Defaults to the global `fetch`; tests pass their own. */
  fetch?: typeof fetch;
}

type Query = Readonly<Record<string, string | number | undefined>>;

interface Call<T> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  schema: z.ZodType<T>;
  query?: Query;
  body?: unknown;
  /** Extra request headers, such as `Idempotency-Key`. */
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal | undefined;
}

/**
 * Creates a client for the API at `baseUrl`: an origin such as
 * `http://sunrise.localtest.me:5173`, or `""` for the page's own origin (the usual case).
 */
export function createHttpClient(baseUrl: string, getToken: TokenSource, options: HttpClientOptions = {}): ApiClient {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const root = baseUrl.replace(/\/+$/, "");

  async function call<T>({ method, path, schema, query, body, headers: extraHeaders, signal }: Call<T>): Promise<ApiResult<T>> {
    const headers = new Headers({ accept: "application/json" });
    const token = await getToken();
    if (token !== null && token !== "") {
      headers.set("authorization", `Bearer ${token}`);
    }
    if (extraHeaders !== undefined) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        headers.set(key, value);
      }
    }
    // Patient data must never sit in the browser's HTTP cache.
    const init: RequestInit = { method, headers, cache: "no-store" };
    if (body instanceof FormData) {
      // The browser sets `content-type` itself, with the multipart boundary.
      init.body = body;
    } else if (body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }
    if (signal !== undefined) {
      init.signal = signal;
    }

    let response: Response;
    try {
      response = await send(`${root}${path}${toSearch(query)}`, init);
    } catch (thrown) {
      return failure(
        signal?.aborted === true || isAbortError(thrown)
          ? { status: 0, code: "aborted", message: "The request was cancelled." }
          : { status: 0, code: "network_error", message: "Can't reach Aarogyam. Check your connection and try again." },
      );
    }

    const id = readRequestId(response);
    const payload = await readJson(response);
    if (!response.ok) {
      return failure(parseApiError(response.status, payload, id));
    }
    const decoded = schema.safeParse(payload);
    if (!decoded.success) {
      // The issues may quote values from the body, so they are never surfaced.
      return failure({
        status: response.status,
        code: "invalid_response",
        message: "The server sent a response this app doesn't understand. Please reload.",
        ...(id === undefined ? {} : { requestId: id }),
      });
    }
    return success(decoded.data);
  }

  return {
    getMe: (opts) => call({ method: "GET", path: "/api/v1/me", schema: meResponse, signal: opts?.signal }),
    acceptInvitation: (input, opts) =>
      call({ method: "POST", path: "/api/v1/invitations/accept", schema: joined, body: input, signal: opts?.signal }),
    createHandoff: (input, opts) => call({ method: "POST", path: "/api/v1/auth/handoff", schema: handoff, body: input, signal: opts?.signal }),
    redeemHandoff: (input, opts) =>
      call({ method: "POST", path: "/api/v1/auth/handoff/redeem", schema: handoffSession, body: input, signal: opts?.signal }),
    getSession: (opts) => call({ method: "GET", path: "/api/v1/session", schema: sessionResponse, signal: opts?.signal }),
    listPatients: (opts) =>
      call({
        method: "GET",
        path: "/api/v1/patients",
        schema: patientList,
        query: {
          with_balance: opts?.withBalance === true ? "true" : undefined,
          recalls_due: opts?.recallsDue === true ? "true" : undefined,
          new_this_month: opts?.newThisMonth === true ? "true" : undefined,
        },
        signal: opts?.signal,
      }),
    searchPatients: (search, opts) =>
      call({
        method: "POST",
        path: "/api/v1/patients/search",
        schema: patientList,
        body: {
          q: search.q.trim(),
          ...(search.limit === undefined ? {} : { limit: search.limit }),
          ...(search.withBalance === true ? { with_balance: true } : {}),
          ...(search.recallsDue === true ? { recalls_due: true } : {}),
          ...(search.newThisMonth === true ? { new_this_month: true } : {}),
        },
        signal: opts?.signal,
      }),
    getPatient: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}`, schema: patient, signal: opts?.signal }),
    createPatient: (input, opts) =>
      call({ method: "POST", path: "/api/v1/patients", schema: patient, body: input, signal: opts?.signal }),
    getToday: (opts) => call({ method: "GET", path: "/api/v1/today", schema: todayResponse, query: { date: opts?.date }, signal: opts?.signal }),
    getMonthSummary: (month, opts) =>
      call({ method: "GET", path: "/api/v1/appointments/month-summary", schema: monthSummary, query: { month }, signal: opts?.signal }),
    listOpenLabOrders: (opts) =>
      call({ method: "GET", path: "/api/v1/lab-orders", schema: openLabOrderPage, query: { open: "1" }, signal: opts?.signal }),
    updatePatient: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/patients/${encodeURIComponent(id)}`, schema: patient, body: changes, signal: opts?.signal }),

    listRooms: (opts) => call({ method: "GET", path: "/api/v1/rooms", schema: roomList, signal: opts?.signal }),
    addRoom: (input, opts) => call({ method: "POST", path: "/api/v1/rooms", schema: room, body: input, signal: opts?.signal }),
    changeRoom: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/rooms/${encodeURIComponent(id)}`, schema: room, body: changes, signal: opts?.signal }),
    removeRoom: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/rooms/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),

    listPractitioners: (opts) => call({ method: "GET", path: "/api/v1/practitioners", schema: practitionerList, signal: opts?.signal }),
    addPractitioner: (input, opts) =>
      call({ method: "POST", path: "/api/v1/practitioners", schema: practitioner, body: input, signal: opts?.signal }),
    changePractitioner: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/practitioners/${encodeURIComponent(id)}`, schema: practitioner, body: changes, signal: opts?.signal }),
    removePractitioner: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/practitioners/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),
    getWorkingHours: (id, opts) =>
      call({ method: "GET", path: `/api/v1/practitioners/${encodeURIComponent(id)}/working-hours`, schema: workingHours, signal: opts?.signal }),
    setWorkingHours: (id, hours, opts) =>
      call({
        method: "PUT",
        path: `/api/v1/practitioners/${encodeURIComponent(id)}/working-hours`,
        schema: workingHours,
        body: hours,
        signal: opts?.signal,
      }),

    listLeave: (range, opts) =>
      call({ method: "GET", path: "/api/v1/leave-blocks", schema: leaveList, query: dateQuery(range), signal: opts?.signal }),
    addLeave: (input, opts) => call({ method: "POST", path: "/api/v1/leave-blocks", schema: leave, body: input, signal: opts?.signal }),
    removeLeave: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/leave-blocks/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),

    listAppointments: (filter, opts) =>
      call({
        method: "GET",
        path: "/api/v1/appointments",
        schema: appointmentList,
        query: { ...dateQuery(filter), room_id: filter.roomId, practitioner_id: filter.practitionerId },
        signal: opts?.signal,
      }),
    bookAppointment: (input, opts) =>
      call({ method: "POST", path: "/api/v1/appointments", schema: savedAppointment, body: input, signal: opts?.signal }),
    changeAppointment: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/appointments/${encodeURIComponent(id)}`, schema: savedAppointment, body: changes, signal: opts?.signal }),
    setAppointmentStatus: (id, change, opts) =>
      call({ method: "POST", path: `/api/v1/appointments/${encodeURIComponent(id)}/status`, schema: statusChanged, body: change, signal: opts?.signal }),

    listQueue: (dateValue, opts) =>
      call({
        method: "GET",
        path: "/api/v1/queue",
        schema: queueDay,
        query: { date: dateValue, practitioner_id: opts?.practitionerId },
        signal: opts?.signal,
      }),
    addWalkIn: (input, opts) => call({ method: "POST", path: "/api/v1/queue", schema: queueToken, body: input, signal: opts?.signal }),
    callQueueToken: (id, opts) =>
      call({ method: "POST", path: `/api/v1/queue/${encodeURIComponent(id)}/call`, schema: queueToken, signal: opts?.signal }),
    setQueueStatus: (id, change, opts) =>
      call({ method: "POST", path: `/api/v1/queue/${encodeURIComponent(id)}/status`, schema: queueToken, body: change, signal: opts?.signal }),

    importPatients: (input, opts) =>
      call({ method: "POST", path: "/api/v1/imports/patients", schema: importResult, body: input, signal: opts?.signal }),
    uploadImportFile: (form, opts) =>
      call({ method: "POST", path: "/api/v1/imports/sessions", schema: importSession, body: form, signal: opts?.signal }),
    previewImport: (id, choices, opts) =>
      call({
        method: "POST",
        path: `/api/v1/imports/sessions/${encodeURIComponent(id)}/preview`,
        schema: smartImportResult,
        body: choices,
        signal: opts?.signal,
      }),
    commitImport: (id, choices, opts) =>
      call({
        method: "POST",
        path: `/api/v1/imports/sessions/${encodeURIComponent(id)}/commit`,
        schema: smartImportResult,
        body: choices,
        signal: opts?.signal,
      }),
    discardImport: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/imports/sessions/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),
    listIncompletePatients: (opts) => call({ method: "GET", path: "/api/v1/imports/incomplete", schema: incompleteList, signal: opts?.signal }),
    dismissIncompletePatient: (id, opts) =>
      call({
        method: "POST",
        path: `/api/v1/imports/incomplete/${encodeURIComponent(id)}/dismiss`,
        schema: voidResponse,
        signal: opts?.signal,
      }),

    getClinicalFlags: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/clinical-flags`, schema: clinicalFlags, signal: opts?.signal }),
    listAllergies: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/allergies`, schema: allergyList, signal: opts?.signal }),
    addAllergy: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/patients/${encodeURIComponent(id)}/allergies`, schema: allergy, body: input, signal: opts?.signal }),
    editAllergy: (id, allergyId, input, opts) =>
      call({
        method: "PATCH",
        path: `/api/v1/patients/${encodeURIComponent(id)}/allergies/${encodeURIComponent(allergyId)}`,
        schema: allergy,
        body: input,
        signal: opts?.signal,
      }),
    listConditions: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/conditions`, schema: conditionList, signal: opts?.signal }),
    addCondition: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/patients/${encodeURIComponent(id)}/conditions`, schema: condition, body: input, signal: opts?.signal }),

    getTimeline: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/timeline`, schema: timeline, signal: opts?.signal }),
    listConsents: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/consents`, schema: consentList, signal: opts?.signal }),
    recordConsent: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/patients/${encodeURIComponent(id)}/consents`, schema: consent, body: input, signal: opts?.signal }),
    withdrawConsent: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/consents/${encodeURIComponent(id)}/withdraw`, schema: consent, body: input, signal: opts?.signal }),
    getPatientNotes: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/notes`, schema: patientNotes, signal: opts?.signal }),
    savePatientSummaryNote: (id, content, expectedVersion, opts) =>
      call({
        method: "PUT",
        path: `/api/v1/patients/${encodeURIComponent(id)}/summary-note`,
        schema: summaryNote,
        body: content,
        ...(expectedVersion === undefined ? {} : { headers: { "If-Match": `"${String(expectedVersion)}"` } }),
        signal: opts?.signal,
      }),
    listVisits: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/visits`, schema: visitList, signal: opts?.signal }),
    getVisit: (id, opts) => call({ method: "GET", path: `/api/v1/visits/${encodeURIComponent(id)}`, schema: visitDetail, signal: opts?.signal }),
    startVisit: (patientId, input, opts) =>
      call({ method: "POST", path: `/api/v1/patients/${encodeURIComponent(patientId)}/visits`, schema: visit, body: input, signal: opts?.signal }),
    closeVisit: (id, opts) => call({ method: "POST", path: `/api/v1/visits/${encodeURIComponent(id)}/close`, schema: visit, signal: opts?.signal }),

    createNote: (visitId, content, opts) =>
      call({ method: "POST", path: `/api/v1/visits/${encodeURIComponent(visitId)}/notes`, schema: note, body: content, signal: opts?.signal }),
    editNote: (id, content, opts) =>
      call({ method: "PATCH", path: `/api/v1/notes/${encodeURIComponent(id)}`, schema: note, body: content, signal: opts?.signal }),
    signNote: (id, opts) => call({ method: "POST", path: `/api/v1/notes/${encodeURIComponent(id)}/sign`, schema: note, signal: opts?.signal }),

    addAddendum: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/notes/${encodeURIComponent(id)}/addenda`, schema: note, body: input, signal: opts?.signal }),

    recordObservations: (visitId, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/visits/${encodeURIComponent(visitId)}/observations`,
        schema: observationList,
        body: input,
        signal: opts?.signal,
      }),

    listPlans: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/treatment-plans`, schema: planList, signal: opts?.signal }),
    createPlan: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/patients/${encodeURIComponent(id)}/treatment-plans`, schema: plan, body: input, signal: opts?.signal }),
    acceptPlan: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/treatment-plans/${encodeURIComponent(id)}/accept`, schema: plan, body: input, signal: opts?.signal }),
    setPlanItemStatus: (itemId, status, opts) =>
      call({ method: "PATCH", path: `/api/v1/treatment-plan-items/${encodeURIComponent(itemId)}`, schema: plan, body: { status }, signal: opts?.signal }),

    listProcedures: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/procedures`, schema: procedureList, signal: opts?.signal }),
    recordProcedure: (visitId, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/visits/${encodeURIComponent(visitId)}/procedures`,
        schema: procedure,
        body: input,
        signal: opts?.signal,
      }),
    completeProcedure: (id, opts) =>
      call({ method: "POST", path: `/api/v1/procedures/${encodeURIComponent(id)}/complete`, schema: procedure, signal: opts?.signal }),

    getDentalChart: (id, tooth, opts) =>
      call({
        method: "GET",
        path: `/api/v1/patients/${encodeURIComponent(id)}/dental-chart`,
        schema: dentalChart,
        query: { tooth },
        signal: opts?.signal,
      }),
    recordChartEntries: (id, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/patients/${encodeURIComponent(id)}/dental-chart`,
        schema: dentalChart,
        body: input,
        signal: opts?.signal,
      }),
    addDentalTerm: (input, opts) => call({ method: "POST", path: "/api/v1/dental-terms", schema: dentalTerm, body: input, signal: opts?.signal }),

    listAttachments: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/attachments`, schema: attachmentList, signal: opts?.signal }),
    uploadAttachment: (id, form, opts) =>
      call({ method: "POST", path: `/api/v1/patients/${encodeURIComponent(id)}/attachments`, schema: attachment, body: form, signal: opts?.signal }),
    getDownloadLink: (id, opts) =>
      call({ method: "GET", path: `/api/v1/attachments/${encodeURIComponent(id)}/download`, schema: downloadLink, signal: opts?.signal }),
    setAttachmentSharing: (id, sharing, opts) =>
      call({ method: "PUT", path: `/api/v1/attachments/${encodeURIComponent(id)}/sharing`, schema: fileSharing, body: sharing, signal: opts?.signal }),
    getPatientAppAccess: (id, opts) =>
      call({ method: "GET", path: `/api/v1/patients/${encodeURIComponent(id)}/app-access`, schema: patientAppAccess, signal: opts?.signal }),
    invitePatientToApp: (id, opts) =>
      call({ method: "POST", path: `/api/v1/patients/${encodeURIComponent(id)}/app-invitations`, schema: patientAppInvitation, signal: opts?.signal }),
    decidePatientLink: (id, decision, opts) =>
      call({ method: "POST", path: `/api/v1/patient-links/${encodeURIComponent(id)}/${decision}`, schema: patientLinkDecided, signal: opts?.signal }),

    listStaff: (opts) => call({ method: "GET", path: "/api/v1/staff", schema: staffResponse, signal: opts?.signal }),
    inviteStaff: (input, opts) =>
      call({ method: "POST", path: "/api/v1/staff/invitations", schema: createdInvitation, body: input, signal: opts?.signal }),
    changeStaffMember: (membershipId, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/staff/${encodeURIComponent(membershipId)}`, schema: member, body: changes, signal: opts?.signal }),
    listRoles: (opts) => call({ method: "GET", path: "/api/v1/roles", schema: rolesResponse, signal: opts?.signal }),
    getAccessCatalogue: (opts) => call({ method: "GET", path: "/api/v1/permissions", schema: accessCatalogue, signal: opts?.signal }),
    getRole: (key, opts) => call({ method: "GET", path: `/api/v1/roles/${encodeURIComponent(key)}`, schema: roleDetail, signal: opts?.signal }),
    setRolePermissions: (key, update, opts) =>
      call({ method: "PUT", path: `/api/v1/roles/${encodeURIComponent(key)}/permissions`, schema: savedRole, body: update, signal: opts?.signal }),
    createRole: (input, opts) => call({ method: "POST", path: "/api/v1/roles", schema: roleDetail, body: input, signal: opts?.signal }),
    deleteRole: (key, opts) => call({ method: "DELETE", path: `/api/v1/roles/${encodeURIComponent(key)}`, schema: voidResponse, signal: opts?.signal }),

    getMyDashboardLayout: (opts) => call({ method: "GET", path: "/api/v1/me/dashboard-layout", schema: dashboardLayoutView, signal: opts?.signal }),
    saveMyDashboardLayout: (layout, opts) =>
      call({ method: "PUT", path: "/api/v1/me/dashboard-layout", schema: dashboardLayoutView, body: layout, signal: opts?.signal }),
    resetMyDashboardLayout: (opts) => call({ method: "DELETE", path: "/api/v1/me/dashboard-layout", schema: dashboardLayoutView, signal: opts?.signal }),
    getDashboardLayout: (opts) => call({ method: "GET", path: "/api/v1/settings/dashboard-layout", schema: dashboardLayoutView, signal: opts?.signal }),
    saveDashboardLayout: (layout, opts) =>
      call({ method: "PUT", path: "/api/v1/settings/dashboard-layout", schema: dashboardLayoutView, body: layout, signal: opts?.signal }),
    resetDashboardLayout: (opts) => call({ method: "DELETE", path: "/api/v1/settings/dashboard-layout", schema: dashboardLayoutView, signal: opts?.signal }),
    getClinicSettings: (opts) => call({ method: "GET", path: "/api/v1/settings/clinic", schema: clinicSettings, signal: opts?.signal }),
    updateClinicSettings: (changes, opts) =>
      call({ method: "PATCH", path: "/api/v1/settings/clinic", schema: clinicSettings, body: changes, signal: opts?.signal }),

    getLetterhead: (opts) => call({ method: "GET", path: "/api/v1/letterhead", schema: letterheadDocument, signal: opts?.signal }),
    uploadLetterheadImage: (slot, form, opts) =>
      call({ method: "PUT", path: `/api/v1/settings/letterhead/images/${slot}`, schema: letterhead, body: form, signal: opts?.signal }),
    removeLetterheadImage: (slot, opts) =>
      call({ method: "DELETE", path: `/api/v1/settings/letterhead/images/${slot}`, schema: letterhead, signal: opts?.signal }),

    getNotificationSettings: (opts) =>
      call({ method: "GET", path: "/api/v1/settings/notifications", schema: notificationSettings, signal: opts?.signal }),
    updateNotificationSettings: (changes, opts) =>
      call({ method: "PATCH", path: "/api/v1/settings/notifications", schema: notificationSettings, body: changes, signal: opts?.signal }),
    uploadClinicLogo: (form, opts) =>
      call({ method: "POST", path: "/api/v1/settings/clinic/logo", schema: clinicSettings, body: form, signal: opts?.signal }),

    listNotifications: (params, opts) =>
      call({
        method: "GET",
        path: "/api/v1/notifications",
        schema: notificationList,
        query: { unread_only: params?.unreadOnly === true ? "true" : undefined, limit: params?.limit, before: params?.before },
        signal: opts?.signal,
      }),
    countUnreadNotifications: (opts) =>
      call({ method: "GET", path: "/api/v1/notifications/count", schema: unreadCount, signal: opts?.signal }),
    markNotificationRead: (id, opts) =>
      call({ method: "POST", path: `/api/v1/notifications/${encodeURIComponent(id)}/read`, schema: voidResponse, signal: opts?.signal }),
    markAllNotificationsRead: (opts) =>
      call({ method: "POST", path: "/api/v1/notifications/read-all", schema: markedRead, signal: opts?.signal }),

    listMySessions: (opts) => call({ method: "GET", path: "/api/v1/me/sessions", schema: mySessionsResponse, signal: opts?.signal }),
    revokeMySession: (id, opts) =>
      call({ method: "POST", path: `/api/v1/me/sessions/${encodeURIComponent(id)}/revoke`, schema: voidResponse, signal: opts?.signal }),
    revokeOtherSessions: (opts) =>
      call({ method: "POST", path: "/api/v1/me/sessions/revoke-others", schema: revokedSessions, signal: opts?.signal }),
    updateMe: (changes, opts) => call({ method: "PATCH", path: "/api/v1/me", schema: profile, body: changes, signal: opts?.signal }),

    listClinics: (opts) =>
      call({ method: "GET", path: "/api/v1/console/clinics", schema: consoleClinics, signal: opts?.signal }),
    createClinic: (input, opts) =>
      call({ method: "POST", path: "/api/v1/console/clinics", schema: createdClinic, body: input, signal: opts?.signal }),
    getMetrics: (range, opts) =>
      call({ method: "GET", path: "/api/v1/console/metrics", schema: metricsResponse, query: { range }, signal: opts?.signal }),
    getQuality: (limit, opts) =>
      call({
        method: "GET",
        path: "/api/v1/console/quality",
        schema: qualityReport,
        query: { limit },
        signal: opts?.signal,
      }),

    submitRegistration: (input, opts) =>
      call({ method: "POST", path: "/api/v1/registrations", schema: registrationReceived, body: input, signal: opts?.signal }),

    listApplications: (status, opts) =>
      call({ method: "GET", path: "/api/v1/console/applications", schema: applications, query: { status }, signal: opts?.signal }),
    checkSlug: (query, opts) =>
      call({
        method: "GET",
        path: "/api/v1/console/slugs",
        schema: slugCheck,
        query: { name: query.name, slug: query.slug, city: query.city },
        signal: opts?.signal,
      }),
    approveApplication: (id, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/console/applications/${encodeURIComponent(id)}/approve`,
        schema: approvedApplication,
        body: input,
        signal: opts?.signal,
      }),
    rejectApplication: (id, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/console/applications/${encodeURIComponent(id)}/reject`,
        schema: voidResponse,
        body: input,
        signal: opts?.signal,
      }),
    getClinicDetail: (id, opts) =>
      call({ method: "GET", path: `/api/v1/console/clinics/${encodeURIComponent(id)}`, schema: clinicDetail, signal: opts?.signal }),
    inviteToClinic: (id, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/console/clinics/${encodeURIComponent(id)}/invitations`,
        schema: clinicInvited,
        body: input,
        signal: opts?.signal,
      }),
    resendOwnerInvitation: (id, opts) =>
      call({
        method: "POST",
        path: `/api/v1/console/clinics/${encodeURIComponent(id)}/owner-invitation/resend`,
        schema: resentOwnerInvitation,
        signal: opts?.signal,
      }),

    searchDrugs: (input, opts) =>
      call({ method: "POST", path: "/api/v1/drugs/search", schema: drugList, body: input, signal: opts?.signal }),

    listPriceItems: (opts) => call({ method: "GET", path: "/api/v1/price-items", schema: priceItemList, signal: opts?.signal }),
    addPriceItem: (input, opts) =>
      call({ method: "POST", path: "/api/v1/price-items", schema: priceItem, body: input, signal: opts?.signal }),
    changePriceItem: (id, input, opts) =>
      call({ method: "PATCH", path: `/api/v1/price-items/${encodeURIComponent(id)}`, schema: priceItem, body: input, signal: opts?.signal }),

    getStock: (opts) => call({ method: "GET", path: "/api/v1/stock", schema: stockSummary, signal: opts?.signal }),
    listLowStock: (opts) => call({ method: "GET", path: "/api/v1/stock/low", schema: inventoryItemList, signal: opts?.signal }),
    listExpiring: (days, opts) =>
      call({ method: "GET", path: "/api/v1/stock/expiring", schema: expiringList, query: { days }, signal: opts?.signal }),
    listInventoryItems: (opts) => call({ method: "GET", path: "/api/v1/inventory-items", schema: inventoryItemList, signal: opts?.signal }),
    getInventoryItem: (id, opts) =>
      call({ method: "GET", path: `/api/v1/inventory-items/${encodeURIComponent(id)}`, schema: inventoryItemDetail, signal: opts?.signal }),
    addInventoryItem: (input, opts) =>
      call({ method: "POST", path: "/api/v1/inventory-items", schema: inventoryItem, body: input, signal: opts?.signal }),
    changeInventoryItem: (id, input, opts) =>
      call({
        method: "PATCH",
        path: `/api/v1/inventory-items/${encodeURIComponent(id)}`,
        schema: inventoryItem,
        body: input,
        signal: opts?.signal,
      }),
    removeInventoryItem: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/inventory-items/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),
    listSuppliers: (opts) => call({ method: "GET", path: "/api/v1/suppliers", schema: supplierList, signal: opts?.signal }),
    addSupplier: (input, opts) => call({ method: "POST", path: "/api/v1/suppliers", schema: supplier, body: input, signal: opts?.signal }),
    changeSupplier: (id, input, opts) =>
      call({ method: "PATCH", path: `/api/v1/suppliers/${encodeURIComponent(id)}`, schema: supplier, body: input, signal: opts?.signal }),
    removeSupplier: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/suppliers/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),
    receiveStock: (input, opts) =>
      call({ method: "POST", path: "/api/v1/stock/receive", schema: stockChange, body: input, signal: opts?.signal }),
    useStock: (input, opts) => call({ method: "POST", path: "/api/v1/stock/use", schema: stockChange, body: input, signal: opts?.signal }),
    adjustStock: (input, opts) =>
      call({ method: "POST", path: "/api/v1/stock/adjust", schema: stockChange, body: input, signal: opts?.signal }),
    expireBatch: (id, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/stock/batches/${encodeURIComponent(id)}/expire`,
        schema: stockChange,
        body: input,
        signal: opts?.signal,
      }),

    listInvoices: (filter, opts) =>
      call({
        method: "GET",
        path: "/api/v1/invoices",
        schema: invoiceList,
        query: { status: filter.status, from: filter.from, to: filter.to, patient_id: filter.patientId },
        signal: opts?.signal,
      }),
    getInvoice: (id, opts) => call({ method: "GET", path: `/api/v1/invoices/${encodeURIComponent(id)}`, schema: invoice, signal: opts?.signal }),
    createInvoice: (input, opts) => call({ method: "POST", path: "/api/v1/invoices", schema: invoice, body: input, signal: opts?.signal }),
    editInvoice: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/invoices/${encodeURIComponent(id)}`, schema: invoice, body: changes, signal: opts?.signal }),
    issueInvoice: (id, opts) =>
      call({ method: "POST", path: `/api/v1/invoices/${encodeURIComponent(id)}/issue`, schema: invoice, signal: opts?.signal }),
    voidInvoice: (id, reason, opts) =>
      call({ method: "POST", path: `/api/v1/invoices/${encodeURIComponent(id)}/void`, schema: invoice, body: reason, signal: opts?.signal }),

    listPayments: (range, opts) =>
      call({ method: "GET", path: "/api/v1/payments", schema: paymentList, query: { from: range.from, to: range.to }, signal: opts?.signal }),
    getPayment: (id, opts) => call({ method: "GET", path: `/api/v1/payments/${encodeURIComponent(id)}`, schema: payment, signal: opts?.signal }),
    recordPayment: (input, idempotencyKey, opts) =>
      call({
        method: "POST",
        path: "/api/v1/payments",
        schema: payment,
        body: input,
        headers: { "Idempotency-Key": idempotencyKey },
        signal: opts?.signal,
      }),
    voidPayment: (id, reason, opts) =>
      call({ method: "POST", path: `/api/v1/payments/${encodeURIComponent(id)}/void`, schema: payment, body: reason, signal: opts?.signal }),

    getCollections: (range, opts) =>
      call({ method: "GET", path: "/api/v1/reports/collections", schema: collections, query: { from: range.from, to: range.to, weeks: range.weeks }, signal: opts?.signal }),
    getPendingReport: (opts) => call({ method: "GET", path: "/api/v1/reports/pending", schema: pendingReport, signal: opts?.signal }),
    getTodayMoney: (opts) => call({ method: "GET", path: "/api/v1/today/money", schema: todayMoney, signal: opts?.signal }),
    listExpenses: (range, opts) =>
      call({ method: "GET", path: "/api/v1/expenses", schema: expenseList, query: { from: range.from, to: range.to }, signal: opts?.signal }),
    recordExpense: (input, opts) => call({ method: "POST", path: "/api/v1/expenses", schema: expense, body: input, signal: opts?.signal }),
    voidExpense: (id, reason, opts) =>
      call({ method: "POST", path: `/api/v1/expenses/${encodeURIComponent(id)}/void`, schema: expense, body: reason, signal: opts?.signal }),
    getAnalytics: (query, opts) =>
      call({
        method: "GET",
        path: "/api/v1/reports/analytics",
        schema: analytics,
        query: { from: query.from, to: query.to, bucket: query.bucket },
        signal: opts?.signal,
      }),

    listPrescriptions: (patientId, opts) =>
      call({
        method: "GET",
        path: `/api/v1/patients/${encodeURIComponent(patientId)}/prescriptions`,
        schema: prescriptionList,
        signal: opts?.signal,
      }),
    getLastPrescription: (patientId, opts) =>
      call({
        method: "GET",
        path: `/api/v1/patients/${encodeURIComponent(patientId)}/prescriptions/last`,
        schema: prescription,
        signal: opts?.signal,
      }),
    getPrescription: (id, opts) =>
      call({ method: "GET", path: `/api/v1/prescriptions/${encodeURIComponent(id)}`, schema: prescription, signal: opts?.signal }),
    createPrescription: (patientId, input, opts) =>
      call({
        method: "POST",
        path: `/api/v1/patients/${encodeURIComponent(patientId)}/prescriptions`,
        schema: prescription,
        body: input,
        signal: opts?.signal,
      }),
    editPrescription: (id, input, opts) =>
      call({ method: "PATCH", path: `/api/v1/prescriptions/${encodeURIComponent(id)}`, schema: prescription, body: input, signal: opts?.signal }),
    issuePrescription: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/prescriptions/${encodeURIComponent(id)}/issue`, schema: issuedPrescription, body: input, signal: opts?.signal }),
    cancelPrescription: (id, input, opts) =>
      call({ method: "POST", path: `/api/v1/prescriptions/${encodeURIComponent(id)}/cancel`, schema: cancelled, body: input, signal: opts?.signal }),
    createShareLink: (id, opts) =>
      call({ method: "POST", path: `/api/v1/prescriptions/${encodeURIComponent(id)}/share`, schema: shareLink, signal: opts?.signal }),

    getSharedPreview: (token, opts) =>
      call({ method: "GET", path: `/api/v1/shared/${encodeURIComponent(token)}`, schema: sharedPreview, signal: opts?.signal }),
    getSharedLetterhead: (token, opts) =>
      call({ method: "GET", path: `/api/v1/shared/${encodeURIComponent(token)}/letterhead`, schema: letterheadDocument, signal: opts?.signal }),
    openShared: (token, pin, opts) =>
      call({ method: "POST", path: `/api/v1/shared/${encodeURIComponent(token)}/open`, schema: prescription, body: { pin }, signal: opts?.signal }),
    verifyPrescription: (token, opts) =>
      call({ method: "GET", path: `/api/v1/verify/prescriptions/${encodeURIComponent(token)}`, schema: verification, signal: opts?.signal }),

    getBookingOptions: (opts) => call({ method: "GET", path: "/api/v1/public/booking", schema: bookingOptions, signal: opts?.signal }),
    getAvailability: (date, practitionerId, opts) =>
      call({
        method: "GET",
        path: "/api/v1/public/availability",
        query: { date, practitioner_id: practitionerId },
        schema: availability,
        signal: opts?.signal,
      }),
    createOnlineBooking: (input, opts) =>
      call({ method: "POST", path: "/api/v1/public/bookings", schema: booked, body: input, signal: opts?.signal }),

    getWebsiteSettings: (opts) => call({ method: "GET", path: "/api/v1/settings/website", schema: websiteSettings, signal: opts?.signal }),
    updateWebsite: (changes, opts) =>
      call({ method: "PATCH", path: "/api/v1/settings/website", schema: websiteSettings, body: changes, signal: opts?.signal }),
    uploadWebsitePhoto: (form, opts) =>
      call({ method: "POST", path: "/api/v1/settings/website/photos", schema: sitePhoto, body: form, signal: opts?.signal }),
    describeWebsitePhoto: (id, changes, opts) =>
      call({ method: "PATCH", path: `/api/v1/settings/website/photos/${encodeURIComponent(id)}`, schema: sitePhoto, body: changes, signal: opts?.signal }),
    deleteWebsitePhoto: (id, opts) =>
      call({ method: "DELETE", path: `/api/v1/settings/website/photos/${encodeURIComponent(id)}`, schema: voidResponse, signal: opts?.signal }),
    getSetup: (opts) => call({ method: "GET", path: "/api/v1/settings/onboarding", schema: setup, signal: opts?.signal }),
    updateSetup: (update, opts) =>
      call({ method: "PATCH", path: "/api/v1/settings/onboarding", schema: setup, body: update, signal: opts?.signal }),
    getMySetup: (opts) => call({ method: "GET", path: "/api/v1/me/onboarding", schema: setup, signal: opts?.signal }),
    updateMySetup: (update, opts) =>
      call({ method: "PATCH", path: "/api/v1/me/onboarding", schema: setup, body: update, signal: opts?.signal }),
    getMyPractitioner: (opts) => call({ method: "GET", path: "/api/v1/me/practitioner", schema: practitioner, signal: opts?.signal }),
    changeMyPractitioner: (changes, opts) =>
      call({ method: "PATCH", path: "/api/v1/me/practitioner", schema: practitioner, body: changes, signal: opts?.signal }),
    getMyWorkingHours: (opts) => call({ method: "GET", path: "/api/v1/me/working-hours", schema: workingHours, signal: opts?.signal }),
    setMyWorkingHours: (hours, opts) =>
      call({ method: "PUT", path: "/api/v1/me/working-hours", schema: workingHours, body: hours, signal: opts?.signal }),
    getPublicSite: (opts) => call({ method: "GET", path: "/api/v1/public/site", schema: sitePage, signal: opts?.signal }),

    // Walk-in fast path.
    registerWalkIn: (input, opts) => call({ method: "POST", path: "/api/v1/walk-ins", schema: walkIn, body: input, signal: opts?.signal }),
    lookupPatientsByPhone: (phone, opts) =>
      call({ method: "POST", path: "/api/v1/patients/lookup", schema: phoneMatches, body: { phone }, signal: opts?.signal }),
    startVisitFromQueue: (id, opts) =>
      call({ method: "POST", path: `/api/v1/queue/${encodeURIComponent(id)}/start-visit`, schema: startedVisit, signal: opts?.signal }),
    confirmAllergy: (id, allergyId, opts) =>
      call({
        method: "POST",
        path: `/api/v1/patients/${encodeURIComponent(id)}/allergies/${encodeURIComponent(allergyId)}/confirm`,
        schema: allergy,
        signal: opts?.signal,
      }),
    getQuickPicks: (opts) => call({ method: "GET", path: "/api/v1/quick-picks", schema: quickPicks, signal: opts?.signal }),
  };
}

function dateQuery(range: DateRange): Query {
  return { from: range.from, to: range.to };
}

function toSearch(query: Query | undefined): string {
  if (query === undefined) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function readRequestId(response: Response): RequestId | undefined {
  const parsed = requestId.safeParse(response.headers.get("x-request-id"));
  return parsed.success ? parsed.data : undefined;
}

/** The body as JSON, or `undefined` when it is empty or not JSON (a proxy's HTML error page). */
async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text === "") {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function isAbortError(thrown: unknown): boolean {
  return thrown instanceof Error && thrown.name === "AbortError";
}

/**
 * Development sign-in against a local API: trades a person's `auth_uid` (and, for someone new,
 * their email) for an access token at `POST /api/v1/dev/token`, cached until a minute before
 * it expires.
 */
export function createDevTokenSource(
  baseUrl: string,
  options: HttpClientOptions = {},
): (person: { id: string; email?: string | undefined }) => Promise<string | null> {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const cache = new Map<string, { token: string; until: number }>();
  return async ({ id: authUid, email }) => {
    const cached = cache.get(authUid);
    if (cached !== undefined && cached.until > Date.now()) {
      return cached.token;
    }
    try {
      const response = await send(`${baseUrl.replace(/\/+$/, "")}/api/v1/dev/token`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        // A verified email in the token lets a new person accept an invitation.
        body: JSON.stringify(email === undefined ? { auth_uid: authUid } : { auth_uid: authUid, email }),
        cache: "no-store",
      });
      const decoded = devTokenResponse.safeParse(response.ok ? await readJson(response) : undefined);
      if (!decoded.success) {
        return null;
      }
      cache.set(authUid, { token: decoded.data.access_token, until: Date.now() + (decoded.data.expires_in - 60) * 1000 });
      return decoded.data.access_token;
    } catch {
      return null;
    }
  };
}
