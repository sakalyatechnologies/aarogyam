/** Patient 360 mutations that have no home in the shared `queries.ts`, kept here so this work never touches it. */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { unwrap, type AllergyFields, type AllergyId, type PatientId } from "@aarogyam/api-client";

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
