import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type NewPatient, type PatientRef } from "@aarogyam/api-client";

import { useClinic } from "./clinic.js";

/** Patient data stays in memory only and is keyed by clinic host, so clinics never mix. */
export function usePatientSearch(q: string) {
  const { api, access } = useClinic();
  return useInfiniteQuery({
    queryKey: ["patients", access.host, q],
    // "" asks for the first page; later pages pass the API's cursor.
    queryFn: ({ pageParam, signal }) =>
      unwrap(api.listPatients({ q, limit: 20, cursor: pageParam === "" ? undefined : pageParam }, { signal })),
    initialPageParam: "",
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function usePatient(ref: PatientRef | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patient", access.host, ref],
    queryFn: ({ signal }) => (ref === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getPatient(ref, { signal }))),
    enabled: ref !== undefined,
  });
}

export function useCreatePatient() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPatient) => unwrap(api.createPatient(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patients", access.host] }),
  });
}

export function useToday() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["today", access.host],
    queryFn: ({ signal }) => unwrap(api.getToday({ signal })),
    refetchInterval: 60_000,
  });
}
