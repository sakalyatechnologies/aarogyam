/** Patient 360 mutations that have no home in the shared `queries.ts`, kept here so this work never touches it. */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type AllergyFields,
  type AllergyId,
  type AttachmentId,
  type ConsentId,
  type PatientFilter,
  type PatientListOptions,
  type PatientId,
  type RecordConsent,
  type SetConsentSignature,
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

/** Most matches a search returns, best first; the page sorts only these. */
export const SEARCH_LIMIT = 50;

/** The order the server sorts the empty-box list in; `null` is newest registered first. */
export type DirectoryOrder = { sort: NonNullable<PatientListOptions["sort"]>; dir: "asc" | "desc" } | null;

/**
 * A search (the box has text): `POST /patients/search`, narrowed by the quick filters. The term
 * travels in the body, never a URL; the filters are flags. Off while the box is empty.
 */
export function usePatientList(q: string, filter: PatientFilter) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patients", access.org_id, q, filter.withBalance === true, filter.recallsDue === true, filter.newThisMonth === true],
    queryFn: ({ signal }) => unwrap(api.searchPatients({ q, limit: SEARCH_LIMIT, ...filter }, { signal })),
    placeholderData: keepPreviousData,
    enabled: q !== "",
  });
}

/**
 * The directory while the box is empty: the server sorts, filters and pages (`sort`, `dir`,
 * `offset`), so the order covers every patient, not only the newest. Pages append as `fetchNextPage`
 * runs, following `has_more`.
 */
export function usePatientDirectory(filter: PatientFilter, order: DirectoryOrder, pageSize: number, enabled: boolean) {
  const { api, access } = useClinic();
  return useInfiniteQuery({
    queryKey: ["patients", access.org_id, "directory", filter.withBalance === true, filter.recallsDue === true, filter.newThisMonth === true, order?.sort ?? "recent", order?.dir ?? "default", pageSize],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      unwrap(api.listPatients({ signal, ...filter, sort: order?.sort, dir: order?.dir, offset: pageParam, limit: pageSize })),
    getNextPageParam: (last, pages) => (last.has_more === true ? pages.reduce((n, page) => n + page.items.length, 0) : undefined),
    placeholderData: keepPreviousData,
    enabled,
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

/** Attaches the photo or scan of the signed form to a consent already recorded. */
export function useSetConsentSignature(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: ConsentId; input: SetConsentSignature }) => unwrap(api.setConsentSignature(patientId, id, input)),
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
