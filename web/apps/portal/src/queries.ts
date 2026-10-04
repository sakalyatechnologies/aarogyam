import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type AllergyFields,
  type AppointmentChanges,
  type AppointmentFilter,
  type AppointmentId,
  type AttachmentId,
  type ClinicSettingsChanges,
  type ConditionFields,
  type DateRange,
  type LeaveId,
  type MemberChanges,
  type MembershipId,
  type NewAppointmentBody,
  type NewChartEntries,
  type NewInvitation,
  type NewLeave,
  type NewPatient,
  type NewProcedure,
  type NewReadings,
  type NewVisit,
  type NoteContent,
  type NoteId,
  type PatientChanges,
  type PatientId,
  type PatientImport,
  type PractitionerFields,
  type PractitionerId,
  type ProcedureId,
  type QueueTokenId,
  type RoomFields,
  type RoomId,
  type SessionId,
  type StatusChange,
  type TokenStatusChange,
  type VisitId,
  type WalkInBody,
  type WorkingHours,
} from "@aarogyam/api-client";
import { useClinic } from "./clinic.js";

/**
 * Recent patients while the box is empty, otherwise a search. The term travels in a POST body,
 * never a URL. Results live only in memory, keyed by clinic host so clinics never mix.
 */
export function usePatients(q: string) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patients", access.org_id, q],
    queryFn: ({ signal }) => unwrap(q === "" ? api.listPatients({ signal }) : api.searchPatients({ q, limit: 50 }, { signal })),
    placeholderData: keepPreviousData,
  });
}

export function usePatient(id: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patient", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getPatient(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useCreatePatient() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPatient) => unwrap(api.createPatient(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patients", access.org_id] }),
  });
}

export function useToday() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["today", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getToday({ signal })),
    refetchInterval: 60_000,
  });
}

export function useUpdatePatient(id: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: PatientChanges) => unwrap(api.updatePatient(id, changes)),
    onSuccess: (patient) => {
      queryClient.setQueryData(["patient", access.org_id, id], patient);
      void queryClient.invalidateQueries({ queryKey: ["patients", access.org_id] });
    },
  });
}

export function useClinicSettings() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["clinic-settings", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getClinicSettings({ signal })),
  });
}

export function useUpdateClinicSettings() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: ClinicSettingsChanges) => unwrap(api.updateClinicSettings(changes)),
    onSuccess: (settings) => {
      queryClient.setQueryData(["clinic-settings", access.org_id], settings);
    },
  });
}

export function useStaff() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["staff", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listStaff({ signal })),
  });
}

export function useRoles() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["roles", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listRoles({ signal })),
    staleTime: Infinity,
  });
}

export function useInviteStaff() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewInvitation) => unwrap(api.inviteStaff(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff", access.org_id] }),
  });
}

export function useChangeStaffMember() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: MembershipId; changes: MemberChanges }) => unwrap(api.changeStaffMember(id, changes)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff", access.org_id] }),
  });
}

export function useMySessions() {
  const { api } = useClinic();
  return useQuery({
    queryKey: ["my-sessions"],
    queryFn: ({ signal }) => unwrap(api.listMySessions({ signal })),
  });
}

export function useRevokeSession() {
  const { api } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: SessionId) => unwrap(api.revokeMySession(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-sessions"] }),
  });
}

// Rooms and practitioners (Settings -> Chairs and doctors, and the Calendar's pickers) ---------

export function useRooms() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["rooms", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listRooms({ signal })),
  });
}

export function useAddRoom() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RoomFields) => unwrap(api.addRoom(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rooms", access.org_id] }),
  });
}

export function useChangeRoom() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: RoomId; changes: RoomFields }) => unwrap(api.changeRoom(id, changes)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rooms", access.org_id] }),
  });
}

export function useRemoveRoom() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: RoomId) => unwrap(api.removeRoom(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rooms", access.org_id] }),
  });
}

export function usePractitioners() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["practitioners", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listPractitioners({ signal })),
  });
}

export function useAddPractitioner() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PractitionerFields) => unwrap(api.addPractitioner(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["practitioners", access.org_id] }),
  });
}

export function useChangePractitioner() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: PractitionerId; changes: PractitionerFields }) => unwrap(api.changePractitioner(id, changes)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["practitioners", access.org_id] }),
  });
}

export function useRemovePractitioner() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: PractitionerId) => unwrap(api.removePractitioner(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["practitioners", access.org_id] }),
  });
}

export function useWorkingHours(id: PractitionerId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["working-hours", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no practitioner")) : unwrap(api.getWorkingHours(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useSetWorkingHours() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hours }: { id: PractitionerId; hours: WorkingHours }) => unwrap(api.setWorkingHours(id, hours)),
    onSuccess: (_hours, { id }) => queryClient.invalidateQueries({ queryKey: ["working-hours", access.org_id, id] }),
  });
}

export function useLeave(range: DateRange) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["leave", access.org_id, range.from, range.to],
    queryFn: ({ signal }) => unwrap(api.listLeave(range, { signal })),
  });
}

export function useAddLeave() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewLeave) => unwrap(api.addLeave(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave", access.org_id] }),
  });
}

export function useRemoveLeave() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: LeaveId) => unwrap(api.removeLeave(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave", access.org_id] }),
  });
}

// Calendar and appointments ---------------------------------------------------------------------

export function useAppointments(filter: AppointmentFilter) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["appointments", access.org_id, filter.from, filter.to, filter.roomId, filter.practitionerId],
    queryFn: ({ signal }) => unwrap(api.listAppointments(filter, { signal })),
    placeholderData: keepPreviousData,
  });
}

function invalidateSchedule(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  void queryClient.invalidateQueries({ queryKey: ["appointments", orgId] });
  void queryClient.invalidateQueries({ queryKey: ["today", orgId] });
  void queryClient.invalidateQueries({ queryKey: ["queue", orgId] });
}

export function useBookAppointment() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAppointmentBody) => unwrap(api.bookAppointment(input)),
    onSuccess: () => { invalidateSchedule(queryClient, access.org_id); },
  });
}

export function useChangeAppointment() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: AppointmentId; changes: AppointmentChanges }) => unwrap(api.changeAppointment(id, changes)),
    onSuccess: () => { invalidateSchedule(queryClient, access.org_id); },
  });
}

export function useSetAppointmentStatus() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: AppointmentId; change: StatusChange }) => unwrap(api.setAppointmentStatus(id, change)),
    onSuccess: () => { invalidateSchedule(queryClient, access.org_id); },
  });
}

// Queue -------------------------------------------------------------------------------------

export function useQueue(date?: string) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["queue", access.org_id, date],
    queryFn: ({ signal }) => unwrap(api.listQueue(date, { signal })),
    refetchInterval: 30_000,
  });
}

export function useAddWalkIn() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WalkInBody) => unwrap(api.addWalkIn(input)),
    onSuccess: () => { invalidateSchedule(queryClient, access.org_id); },
  });
}

export function useSetQueueStatus() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: QueueTokenId; change: TokenStatusChange }) => unwrap(api.setQueueStatus(id, change)),
    onSuccess: () => { invalidateSchedule(queryClient, access.org_id); },
  });
}

// Patient import ------------------------------------------------------------------------------

export function useImportPatients() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PatientImport) => unwrap(api.importPatients(input)),
    onSuccess: (result) => {
      if (result.mode === "commit") {
        void queryClient.invalidateQueries({ queryKey: ["patients", access.org_id] });
      }
    },
  });
}

// Clinical: flags, timeline, visits, notes, vitals, procedures, dental chart, files (M4) ---------

export function useClinicalFlags(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["clinical-flags", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getClinicalFlags(patientId, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useAddAllergy(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AllergyFields) => unwrap(api.addAllergy(patientId, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clinical-flags", access.org_id, patientId] }),
  });
}

export function useAddCondition(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConditionFields) => unwrap(api.addCondition(patientId, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clinical-flags", access.org_id, patientId] }),
  });
}

export function useTimeline(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["timeline", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getTimeline(patientId, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useVisits(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["visits", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.listVisits(patientId, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useVisit(visitId: VisitId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["visit", access.org_id, visitId],
    queryFn: ({ signal }) => (visitId === undefined ? Promise.reject(new Error("no visit")) : unwrap(api.getVisit(visitId, { signal }))),
    enabled: visitId !== undefined,
  });
}

function invalidatePatientRecord(queryClient: ReturnType<typeof useQueryClient>, orgId: string, patientId: PatientId) {
  void queryClient.invalidateQueries({ queryKey: ["timeline", orgId, patientId] });
  void queryClient.invalidateQueries({ queryKey: ["visits", orgId, patientId] });
  void queryClient.invalidateQueries({ queryKey: ["procedures", orgId, patientId] });
  void queryClient.invalidateQueries({ queryKey: ["dental-chart", orgId, patientId] });
}

export function useStartVisit(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewVisit) => unwrap(api.startVisit(patientId, input)),
    onSuccess: () => {
      invalidatePatientRecord(queryClient, access.org_id, patientId);
    },
  });
}

export function useCloseVisit(patientId: PatientId, visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.closeVisit(visitId)),
    onSuccess: () => {
      invalidatePatientRecord(queryClient, access.org_id, patientId);
      void queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] });
    },
  });
}

export function useCreateNote(visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: NoteContent) => unwrap(api.createNote(visitId, content)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] }),
  });
}

export function useSignNote(visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: NoteId) => unwrap(api.signNote(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", access.org_id] });
    },
  });
}

export function useRecordObservations(visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewReadings) => unwrap(api.recordObservations(visitId, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] }),
  });
}

export function useProcedures(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["procedures", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.listProcedures(patientId, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useRecordProcedure(visitId: VisitId, patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewProcedure) => unwrap(api.recordProcedure(visitId, input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] });
      void queryClient.invalidateQueries({ queryKey: ["procedures", access.org_id, patientId] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", access.org_id, patientId] });
    },
  });
}

export function useCompleteProcedure(visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ProcedureId) => unwrap(api.completeProcedure(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] }),
  });
}

export function useDentalChart(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["dental-chart", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getDentalChart(patientId, undefined, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useRecordChartEntries(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewChartEntries) => unwrap(api.recordChartEntries(patientId, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dental-chart", access.org_id, patientId] }),
  });
}

export function useAttachments(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["attachments", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.listAttachments(patientId, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useUploadAttachment(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => unwrap(api.uploadAttachment(patientId, form)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attachments", access.org_id, patientId] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", access.org_id, patientId] });
    },
  });
}

export function useDownloadLink() {
  const { api } = useClinic();
  return useMutation({ mutationFn: (id: AttachmentId) => unwrap(api.getDownloadLink(id)) });
}
