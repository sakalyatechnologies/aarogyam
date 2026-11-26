/** Queries for the case-paper registration fields: the lists the forms offer and a patient's saved intake. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type PatientId, type PatientIntake } from "@aarogyam/api-client";

import { useClinic } from "./clinic.js";

/** The lists the registration forms offer (health checklist, blood groups, call times, how they heard). */
export function useIntakeOptions(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["intake-options", access.org_id],
    queryFn: ({ signal }) => unwrap(api.intakeOptions({ signal })),
    staleTime: 60 * 60_000,
    enabled,
  });
}

/** A patient's case-paper fields (phones masked without patients.contact). */
export function usePatientIntake(id: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patient-intake", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.patientIntake(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useSetPatientIntake(id: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PatientIntake) => unwrap(api.setPatientIntake(id, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-intake", access.org_id, id] }),
  });
}
