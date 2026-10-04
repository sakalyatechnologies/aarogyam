/** Treatment plans: list, propose, accept and carry out. Kept apart from the shared `queries.ts`. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type Acceptance, type NewPlan, type PatientId, type PlanId, type PlanItem, type VisitId } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

export function usePlans(patientId: PatientId) {
  const { api, access } = useClinic();
  return useQuery({ queryKey: ["plans", access.org_id, patientId], queryFn: ({ signal }) => unwrap(api.listPlans(patientId, { signal })) });
}

export function useCreatePlan(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPlan) => unwrap(api.createPlan(patientId, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans", access.org_id, patientId] }),
  });
}

export function useAcceptPlan(patientId: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: PlanId; input: Acceptance }) => unwrap(api.acceptPlan(id, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans", access.org_id, patientId] }),
  });
}

/** The API has no item-status call: an item is done when a procedure that carries it out is recorded. */
export function useCompletePlanItem(patientId: PatientId, visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: PlanItem) =>
      unwrap(
        api.recordProcedure(visitId, {
          name: item.name,
          ...(item.tooth == null ? {} : { tooth: item.tooth }),
          surfaces: item.surfaces,
          plan_item_id: item.id,
          status: "done",
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plans", access.org_id, patientId] });
      void queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", access.org_id] });
    },
  });
}
