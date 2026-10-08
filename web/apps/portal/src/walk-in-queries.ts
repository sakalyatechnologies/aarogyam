/** Queries for the walk-in fast path: one-step walk-ins, the phone lookup, starting a visit from the queue, confirming reported allergies, and the specialty quick picks. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type AllergyId, type PatientId, type QueueTokenId, type WalkInRequest } from "@aarogyam/api-client";

import { useClinic } from "./clinic.js";
import { REFERENCE } from "./lib/cache-policy.js";

function invalidateQueue(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  void queryClient.invalidateQueries({ queryKey: ["queue", orgId] });
  void queryClient.invalidateQueries({ queryKey: ["today", orgId] });
  void queryClient.invalidateQueries({ queryKey: ["appointments", orgId] });
}

export function useRegisterWalkIn() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WalkInRequest) => unwrap(api.registerWalkIn(input)),
    onSuccess: () => {
      invalidateQueue(queryClient, access.org_id);
      void queryClient.invalidateQueries({ queryKey: ["patients", access.org_id] });
    },
  });
}

/** Patients registered with a 10-digit mobile number; idle until the number is complete. */
export function usePhoneLookup(mobile: string) {
  const { api, access } = useClinic();
  const complete = /^[6-9]\d{9}$/.test(mobile);
  return useQuery({
    // The number stays out of the URL; in the cache key it never leaves the tab.
    queryKey: ["phone-lookup", access.org_id, mobile],
    queryFn: ({ signal }) => unwrap(api.lookupPatientsByPhone(`+91${mobile}`, { signal })),
    enabled: complete,
    staleTime: 30_000,
  });
}

export function useStartVisitFromQueue() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: QueueTokenId) => unwrap(api.startVisitFromQueue(id)),
    onSuccess: (started) => {
      invalidateQueue(queryClient, access.org_id);
      void queryClient.invalidateQueries({ queryKey: ["visits", access.org_id, started.visit.patient_id] });
    },
  });
}

export function useConfirmAllergy(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (allergyId: AllergyId) => unwrap(api.confirmAllergy(patientId, allergyId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clinical-flags", access.org_id, patientId] });
      void queryClient.invalidateQueries({ queryKey: ["allergies", access.org_id, patientId] });
    },
  });
}

/** The specialty's quick picks: the same for the whole session. */
export function useQuickPicks() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["quick-picks", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getQuickPicks({ signal })),
    ...REFERENCE,
  });
}
