/** Prescriptions: compose, issue with allergy alerts, cancel and reissue, share links. Kept
 * separate from `queries.ts` so this work never touches the same file as patients/visits. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type CancelRequest,
  type DrugSearch,
  type IssueRequest,
  type PatientId,
  type PrescriptionId,
  type RxValues,
} from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

export function useDrugSearch(input: DrugSearch) {
  const { api } = useClinic();
  return useQuery({
    queryKey: ["drugs", input.q, input.limit],
    queryFn: ({ signal }) => unwrap(api.searchDrugs(input, { signal })),
    enabled: (input.q ?? "").trim() !== "",
  });
}

export function usePrescriptions(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["prescriptions", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.listPrescriptions(patientId, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useLastPrescription(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["prescription-last", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getLastPrescription(patientId, { signal }))),
    enabled: patientId !== undefined,
    retry: false,
  });
}

export function usePrescription(id: PrescriptionId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["prescription", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no prescription")) : unwrap(api.getPrescription(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useCreatePrescription(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RxValues) =>
      patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.createPrescription(patientId, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prescriptions", access.org_id, patientId] }),
  });
}

function invalidateRx(queryClient: ReturnType<typeof useQueryClient>, orgId: string, id: PrescriptionId, patientId: PatientId) {
  void queryClient.invalidateQueries({ queryKey: ["prescription", orgId, id] });
  void queryClient.invalidateQueries({ queryKey: ["prescriptions", orgId, patientId] });
}

export function useEditPrescription(id: PrescriptionId, patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RxValues) => unwrap(api.editPrescription(id, input)),
    onSuccess: () => {
      invalidateRx(queryClient, access.org_id, id, patientId);
    },
  });
}

/** Issues a draft. On allergy alerts without an override reason, the promise rejects with an
 * `ApiFailure` whose `error.alerts` holds what to show — the caller decides whether to ask for an
 * override reason and call this again. */
export function useIssuePrescription(id: PrescriptionId, patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueRequest) => unwrap(api.issuePrescription(id, input)),
    onSuccess: () => {
      invalidateRx(queryClient, access.org_id, id, patientId);
    },
  });
}

export function useCancelPrescription(id: PrescriptionId, patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CancelRequest) => unwrap(api.cancelPrescription(id, input)),
    onSuccess: () => {
      invalidateRx(queryClient, access.org_id, id, patientId);
    },
  });
}

export function useCreateShareLink(id: PrescriptionId) {
  const { api } = useClinic();
  return useMutation({ mutationFn: () => unwrap(api.createShareLink(id)) });
}
