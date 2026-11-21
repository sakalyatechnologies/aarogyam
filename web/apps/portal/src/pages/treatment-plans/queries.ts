/** Treatment plans: list, propose, accept and carry out. Kept apart from the shared `queries.ts`. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type Acceptance, type FinishedItemStatus, type NewPlan, type PatientId, type PlanId, type PlanItem } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";
import { invalidateMouth } from "../../queries.js";

export function usePlans(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["plans", access.org_id, patientId],
    queryFn: ({ signal }) => (patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.listPlans(patientId, { signal }))),
    enabled: patientId !== undefined,
  });
}

export function useCreatePlan(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPlan) => unwrap(api.createPlan(patientId, input)),
    onSuccess: () => {
      invalidateMouth(queryClient, access.org_id);
      return queryClient.invalidateQueries({ queryKey: ["plans", access.org_id, patientId] });
    },
  });
}

export function useAcceptPlan(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: PlanId; input: Acceptance }) => unwrap(api.acceptPlan(id, input)),
    onSuccess: () => {
      invalidateMouth(queryClient, access.org_id);
      return queryClient.invalidateQueries({ queryKey: ["plans", access.org_id, patientId] });
    },
  });
}

/** Marks an accepted plan item done or cancelled; the plan follows (in progress, then completed). */
export function useSetPlanItemStatus(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ item, status }: { item: PlanItem; status: FinishedItemStatus }) => unwrap(api.setPlanItemStatus(item.id, status)),
    onSuccess: () => {
      invalidateMouth(queryClient, access.org_id);
      return queryClient.invalidateQueries({ queryKey: ["plans", access.org_id, patientId] });
    },
  });
}
