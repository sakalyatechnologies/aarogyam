/** Patient 360 mutations that have no home in the shared `queries.ts`, kept here so this work never touches it. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type AllergyFields,
  type AllergyId,
  type AttachmentId,
  type ConsentId,
  type PatientFilter,
  type PatientId,
  type RecordConsent,
  type WithdrawConsent,
} from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

/** Edits an allergy, including marking it inactive; refreshes the clinical flags. */
export function useEditAllergy(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: AllergyId; input: AllergyFields }) => unwrap(api.editAllergy(patientId, id, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clinical-flags", access.org_id, patientId] }),
  });
}

/**
 * The patient list: recent patients while the box is empty, otherwise a search, narrowed by the
 * quick filters. The term travels in a POST body, never a URL; the filters are flags.
 */
export function usePatientList(q: string, filter: PatientFilter) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patients", access.org_id, q, filter.withBalance === true, filter.recallsDue === true, filter.newThisMonth === true],
    queryFn: ({ signal }) =>
      unwrap(q === "" ? api.listPatients({ signal, ...filter }) : api.searchPatients({ q, limit: 50, ...filter }, { signal })),
    placeholderData: keepPreviousData,
  });
}

/** A patient's summary note and visit notes, for the Notes tab. */
export function usePatientNotes(patientId: PatientId) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patient-notes", access.org_id, patientId],
    queryFn: ({ signal }) => unwrap(api.getPatientNotes(patientId, { signal })),
  });
}

/** Saves the summary note; `expectedVersion` is what the editor read, so a change made meanwhile is refused (`412`). */
export function useSaveSummaryNote(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, expectedVersion }: { body: string; expectedVersion: number | undefined }) =>
      unwrap(api.savePatientSummaryNote(patientId, { body }, expectedVersion)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-notes", access.org_id, patientId] }),
  });
}

/** A patient's consent records (DPDP), newest first. */
export function useConsents(patientId: PatientId) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patient-consents", access.org_id, patientId],
    queryFn: ({ signal }) => unwrap(api.listConsents(patientId, { signal })),
  });
}

/** Records that the patient was shown the clinic's notice and agreed. */
export function useRecordConsent(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordConsent) => unwrap(api.recordConsent(patientId, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-consents", access.org_id, patientId] }),
  });
}

/** Records that the patient withdrew a consent. */
export function useWithdrawConsent(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: ConsentId; input: WithdrawConsent }) => unwrap(api.withdrawConsent(id, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-consents", access.org_id, patientId] }),
  });
}

/** Who has patient-app access to this record, for Patient 360. */
export function usePatientAppAccess(patientId: PatientId, enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patient-app-access", access.org_id, patientId],
    queryFn: ({ signal }) => unwrap(api.getPatientAppAccess(patientId, { signal })),
    enabled,
  });
}

/** "Invite to patient app": a new code, shown once, emailed to the record's address. */
export function useInvitePatientToApp(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.invitePatientToApp(patientId)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-app-access", access.org_id, patientId] }),
  });
}

/** Confirms or declines a match the patient asked for, or revokes an active link. */
export function useDecidePatientLink(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "confirm" | "decline" | "revoke" }) => unwrap(api.decidePatientLink(id, decision)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-app-access", access.org_id, patientId] }),
  });
}

/** Shares a file with the patient in their app, or stops sharing it. */
export function useSetFileSharing(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, shared }: { id: AttachmentId; shared: boolean }) => unwrap(api.setAttachmentSharing(id, { shared_with_patient: shared })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attachments", access.org_id, patientId] }),
  });
}
