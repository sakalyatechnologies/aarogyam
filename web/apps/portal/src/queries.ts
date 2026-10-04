import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type NewPatient, type PatientId } from "@aarogyam/api-client";

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
