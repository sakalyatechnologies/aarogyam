/** Patient 360 mutations that have no home in the shared `queries.ts`, kept here so this work never touches it. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type AllergyFields, type AllergyId, type PatientFilter, type PatientId } from "@aarogyam/api-client";

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
